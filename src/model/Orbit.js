import * as THREE from 'three';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import SceneManager from '../managers/SceneManager.js';
import ConfigValidator from '../utils/ConfigValidator.js';
import MathUtils from '../utils/MathUtils.js';
import { ORBIT, MATH } from '../constants.js';
import {
    calculateGM,
    calculateOrbitalMotion,
    computePerifocalBasis,
    getAUScale
} from '../physics/kepler.js';
import { collectBodiesFromHierarchy } from '../physics/NBodySystem.js';
import { log } from '../utils/Logger.js';

const PI_OVER_180 = MATH.PI_OVER_180;

// Distinct values a float32 mantissa can represent between consecutive powers of two
const FLOAT32_MANTISSA_STEPS = 1 << 23;

// Below this eccentricity the direction of periapsis is numerical noise, so the body's own
// direction stands in for it - on a circle any point may as well be periapsis
const MIN_ECCENTRICITY_FOR_PERIAPSIS = 1e-9;

// Scratch values reused when reading the body's state in the orbit line's own space and when
// working out the ellipse to draw through it
const _bodyLocalPosition = new THREE.Vector3();
const _bodyLocalVelocity = new THREE.Vector3();
const _bodyDirection = new THREE.Vector3();
const _tiltAxis = new THREE.Vector3();
const _eccentricityVector = new THREE.Vector3();
const _orbitNormal = new THREE.Vector3();
const _relativePosition = new THREE.Vector3();
const _relativeVelocity = new THREE.Vector3();
const _drawnPeriapsisAxis = new THREE.Vector3();
const _drawnInPlaneAxis = new THREE.Vector3();
const _inverseParentRotation = new THREE.Quaternion();

// Bodies that might have hold of the one this orbit belongs to, gathered afresh each time it is
// asked - see #selectReferenceBody. Emptied again on the way out, so an orbit disposed of between
// frames is not kept alive by a stale entry.
const _candidates = [];

// Written alongside _eccentricityVector and _orbitNormal by #readOsculatingConic, since a
// number cannot be handed back through a scratch vector
let _osculatingInverseSemiMajorAxis = 0;


class Orbit {
    /**
     * Represents an orbital path for a celestial body.
     */
    constructor(body, semiMajorAxis, eccentricity, inclination = 0, parentBody = null, longitudeOfAscendingNode = 0, argumentOfPeriapsis = 0, meanAnomalyAtEpoch = 0, sceneScale) {
        // Validate configuration using centralized validator
        if (!body || typeof body !== 'object') {
            throw new Error('Orbit constructor: body must be a valid Body object');
        }
        if (typeof sceneScale !== 'number' || sceneScale <= 0) {
            throw new Error('Orbit constructor: sceneScale must be a positive number');
        }
        ConfigValidator.validateOrbitConfig({ semiMajorAxis, eccentricity, inclination });

        const orbitMaterial = new LineMaterial({
            color: body.markerColor || body.material.color, // Use marker color if available, fallback to material color
            linewidth: 2, // Line width in pixels
            resolution: new THREE.Vector2(window.innerWidth, window.innerHeight),
            transparent: true, // Enable transparency for proper depth sorting
            opacity: 0.8, // Slightly transparent so markers show through
            depthWrite: false, // Don't write to depth buffer to avoid conflicts with markers
            depthTest: true // Still test depth for proper ordering
        });
        this.body = body;
        this.parentBody = parentBody; // Store parent body for relative positioning
        this.semiMajorAxis = semiMajorAxis; // Keep in AU for calculations
        // Store the scene scale for consistent scaling with body positions
        this.sceneScale = sceneScale; // Use explicitly passed scale
        this.semiMajorAxisVisual = semiMajorAxis * getAUScale(this.sceneScale); // Scaled for visual display
        this.eccentricity = eccentricity;
        this.inclinationRadians = inclination * PI_OVER_180;

        // Additional orbital elements for accurate positioning
        this.longitudeOfAscendingNodeRadians = longitudeOfAscendingNode * PI_OVER_180;
        this.argumentOfPeriapsisRadians = argumentOfPeriapsis * PI_OVER_180;
        this.meanAnomalyAtEpochRadians = meanAnomalyAtEpoch * PI_OVER_180;

        // Orbital mechanics properties using astronomical units
        const orbitalMotion = calculateOrbitalMotion(semiMajorAxis, parentBody);
        this.n = orbitalMotion.meanMotion; // Mean motion in radians/year
        this.orbitalPeriod = orbitalMotion.orbitalPeriod; // Period in years

        // Orbital elements are fixed for the lifetime of the orbit, so the object the
        // Kepler solver reads from is built once here instead of every frame
        this.elements = {
            semiMajorAxis: this.semiMajorAxis,
            eccentricity: this.eccentricity,
            inclinationRadians: this.inclinationRadians,
            longitudeOfAscendingNodeRadians: this.longitudeOfAscendingNodeRadians,
            argumentOfPeriapsisRadians: this.argumentOfPeriapsisRadians,
            meanAnomalyAtEpochRadians: this.meanAnomalyAtEpochRadians,
            meanMotion: this.n
        };

        // Orientation of the ellipse, used to read a phase back out of a position
        this.periapsisAxis = new THREE.Vector3();
        this.inPlaneAxis = new THREE.Vector3();
        computePerifocalBasis(this.elements, this.periapsisAxis, this.inPlaneAxis);

        // The conic last drawn, which under n-body physics follows the body rather than the
        // catalogue elements - see #solveDrawnConic. Kept in the same form the body's own orbit
        // is read in so the two can be compared every frame; see #shapeDrift.
        this.drawnEccentricity = this.eccentricity;
        this.drawnSemiMajorAxis = this.semiMajorAxisVisual;
        this.drawnEccentricityVector = new THREE.Vector3();
        this.drawnOrbitNormal = new THREE.Vector3();
        this.drawnInverseSemiMajorAxis = 1 / this.semiMajorAxisVisual;

        // Pre-compute tilt matrix for performance (optimization)
        // Only create if parent has axial tilt and this is an equatorial orbit
        this.tiltMatrix = null;
        if (parentBody && parentBody.axialTilt && body.equatorialOrbit && parentBody.axialTilt !== 0) {
            this.tiltMatrix = new THREE.Matrix4();
            this.tiltMatrix.makeRotationZ(parentBody.axialTilt * Math.PI / 180);
        }

        // Moon inclinations are relative to parent's equatorial plane
        // The orbit line will inherit the parent's axial tilt via the tiltContainer hierarchy

        // Level-of-detail properties
        this.currentSegments = ORBIT.LOD.INITIAL_SEGMENTS; // Current number of segments
        this.lastLODUpdate = 0; // Frame counter for LOD updates
        this.orbitCenter = new THREE.Vector3(); // Cache orbit center for distance calculations

        // Orbit path storage. The path is solved once per level of detail into a
        // double-precision array, then written into the GPU buffer relative to a moving
        // origin - see #writeSegments for why the vertex data has to stay small. Both
        // buffers are allocated for the maximum segment count so that changing level of
        // detail rewrites them in place instead of reallocating geometry.
        const maxPoints = ORBIT.LOD.MAX_SEGMENTS + 2; // One extra point closes the loop
        this.pathPoints = new Float64Array(maxPoints * 3);
        this.pathPointCount = 0;
        this.segmentPositions = new Float32Array((maxPoints - 1) * 6); // xyz, xyz per segment
        this.pathOrigin = new THREE.Vector3();

        // Create visual orbit path and store reference for disposal
        const geometry = new LineSegmentsGeometry();
        geometry.setPositions(this.segmentPositions);
        this.positionBuffer = geometry.attributes.instanceStart.data;
        this.orbitLine = new LineSegments2(geometry, orbitMaterial);

        // Set render order to ensure orbit lines render behind markers
        this.orbitLine.renderOrder = -100; // Large negative value ensures orbit lines render before markers
        this.orbitLine.material.userData = { renderBehindMarkers: true }; // Mark for special handling

        // The body this orbit is drawn about, which is its catalogue parent for as long as it
        // keeps going round it - see #selectReferenceBody. Parents the line and sets the
        // gravitational parameter the body's own orbit is read out with.
        this.referenceBody = null;
        this.#setReferenceBody(this.parentBody);

        // Calculate and cache orbit center position for LOD calculations
        this.#updateOrbitCenter();

        // Solve the path only once the line is parented, since the path is anchored to the
        // body's position expressed in the line's own coordinate space
        this.#buildPath(this.currentSegments, this.#bodyPositionInLineSpace(_bodyLocalPosition));
        this.#writeSegments();

        // Register material for resolution updates
        SceneManager.registerLineMaterial(orbitMaterial);

        // Initialize orbit trail for the associated body
        if (this.body && this.body.initializeOrbitTrail && typeof this.body.initializeOrbitTrail === 'function') {
            // Ensure orbit trail exists (won't recreate if already exists)
            this.body.initializeOrbitTrail();
        }

        // Auto-register this orbit with the OrbitManager through SceneManager
        SceneManager.registerOrbit(this);

        // Initial visibility state
        this.isVisible = true;
    }

    /**
     * Draw this orbit about a given body from now on, moving the line into that body's space so
     * that everything solved from the body's state lands in the right place.
     *
     * The line hangs off the reference body in the scene graph, which is what lets the path be
     * solved and stored relative to it. An orbit the catalogue measures from the parent's
     * equatorial plane keeps the parent's tilt container, since that is the frame its elements
     * are quoted in; any other reference is the plain group, an escaped body having no special
     * relationship to the plane its new parent spins in.
     *
     * @param {Object|null} referenceBody - Body to draw about, or null for a root body
     * @private
     */
    #setReferenceBody(referenceBody) {
        this.referenceBody = referenceBody;
        this.gravitationalParameter = calculateGM(referenceBody);

        let container = SceneManager.scene;
        if (referenceBody === this.parentBody && referenceBody?.tiltContainer && this.body.equatorialOrbit) {
            container = referenceBody.tiltContainer;
        } else if (referenceBody?.group) {
            container = referenceBody.group;
        }

        if (this.orbitLine.parent !== container) {
            if (this.orbitLine.parent) {
                this.orbitLine.parent.remove(this.orbitLine);
            }
            container.add(this.orbitLine);
            log.debug('Orbit', `Drawing ${this.body.name}'s orbit about ${referenceBody?.name || 'the scene origin'}`);
        }

        // The body now belongs with its new parent's other children as far as the rest of the
        // scene is concerned, so that selecting that parent shows it
        if (referenceBody) {
            SceneManager.reparentBody(this.body, referenceBody);
        }
    }

    /**
     * Which body this orbit should be drawn about: the one the body is really going round now.
     *
     * A body belongs to another while it keeps a closed orbit about it that fits inside that
     * body's Hill sphere - the region where its pull beats the tug of whatever it orbits in
     * turn. A moon flung off its planet no longer has such an orbit, and drawing its escape
     * path relative to the planet shows a line heading off into the distance rather than the
     * orbit it has actually ended up on. Whatever has taken it instead is not necessarily
     * further out: a moon can be thrown clear and picked up by a passing mass, or a planet
     * dragged off the Sun by one, so every body in the system is a candidate rather than only
     * the ones the catalogue lists as ancestors.
     *
     * More than one candidate holds the body at once - a moon of Saturn is inside the Sun's
     * reach as well as Saturn's - and the innermost of them is the one whose orbit is worth
     * drawing, so the tightest sphere wins. The root body is the fallback, because it holds
     * everything and answers to nothing: a body on an escape path out of the system still has
     * its trajectory drawn about the Sun.
     *
     * Changing hands is deliberately harder than keeping them: a body whose apoapsis sits on a
     * boundary, or one poised between two spheres of much the same size, would otherwise swap
     * references every frame and the line would flicker between the two orbits.
     *
     * @returns {Object|null} The body to draw about
     * @private
     */
    #selectReferenceBody() {
        const rootBody = this.#rootBody();
        const recaptureRatio = ORBIT.SPHERE_OF_INFLUENCE.RECAPTURE_RATIO;

        _candidates.length = 0;
        const hierarchy = SceneManager.orbitManager?.hierarchy;
        if (hierarchy) collectBodiesFromHierarchy(hierarchy, _candidates);

        // Whatever holds the body now gets first refusal, keeping it while the orbit is anywhere
        // inside its sphere, and only losing it to a sphere comfortably smaller than its own.
        // A dropped mass that has since been taken away no longer holds anything, so the
        // incumbent is looked for among the bodies still there rather than taken on trust: its
        // last position and velocity outlive it, and would otherwise keep it in charge of an
        // orbit about a body that is no longer in the scene.
        let host = null;
        let hostReach = Infinity;
        const incumbent = this.referenceBody;
        if (incumbent && incumbent !== rootBody && _candidates.includes(incumbent)) {
            const reach = this.#sphereOfInfluence(incumbent);
            if (this.#apoapsisAbout(incumbent) <= reach) {
                host = incumbent;
                hostReach = reach * recaptureRatio;
            }
        }

        for (let i = 0; i < _candidates.length; i++) {
            const candidate = _candidates[i];
            if (candidate === this.body || candidate === host || candidate === rootBody) continue;

            // Only a tighter hold than the one already found could change the answer, and the
            // reach costs a subtraction where the orbit costs a solve
            const reach = this.#sphereOfInfluence(candidate);
            if (!(reach < hostReach)) continue;
            if (this.#apoapsisAbout(candidate) > reach * recaptureRatio) continue;

            // A body cannot be drawn about something that is already drawn about it, directly
            // or through a chain of others - the two would each be the other's centre
            if (SceneManager.hierarchyManager?.isDescendantOf(candidate.name, this.body.name)) continue;

            host = candidate;
            hostReach = reach;
        }

        _candidates.length = 0;

        return host || rootBody;
    }

    /**
     * The body at the top of this body's catalogue ancestry, which holds everything in the
     * system and is therefore always an answer #selectReferenceBody can fall back on.
     * @returns {Object|null} The root body
     * @private
     */
    #rootBody() {
        let body = this.parentBody;
        while (body?.parentBody) {
            body = body.parentBody;
        }
        return body;
    }

    /**
     * How far a body's gravity reaches: the radius of its Hill sphere within the orbit it keeps
     * around whatever it orbits in turn. A body with nothing outside it reaches everywhere.
     *
     * Measured from catalogue parentage rather than from whatever the body currently orbits, so
     * that one body changing hands cannot move another body's boundaries with it.
     *
     * @param {Object} body - Body whose reach is wanted
     * @returns {number} Hill radius in scene units, or Infinity for the root body
     * @private
     */
    #sphereOfInfluence(body) {
        const outerBody = body.parentBody;
        if (!outerBody || !(body.mass > 0) || !(outerBody.mass > 0)) return Infinity;

        const separation = body.group.position.distanceTo(outerBody.group.position);
        return separation * Math.cbrt(body.mass / (3 * outerBody.mass));
    }

    /**
     * How far out this body's orbit about another one reaches, read from the two state vectors
     * alone. An open path has no far end, so it counts as reaching everywhere - which is what
     * makes it fail every containment test and hand the body on.
     *
     * @param {Object} body - Body the orbit would be measured about
     * @returns {number} Apoapsis distance in scene units, or Infinity if the orbit is not closed
     * @private
     */
    #apoapsisAbout(body) {
        if (!this.body.velocity || !body.velocity) return Infinity;

        _relativePosition.subVectors(this.body.group.position, body.group.position);
        _relativeVelocity.subVectors(this.body.velocity, body.velocity);

        const mu = calculateGM(body);
        const radius = _relativePosition.length();
        if (!(radius > 0) || !(mu > 0)) return Infinity;

        const speedSquared = _relativeVelocity.lengthSq();
        const inverseSemiMajorAxis = 2 / radius - speedSquared / mu;
        _eccentricityVector.copy(_relativePosition).multiplyScalar(speedSquared - mu / radius)
            .addScaledVector(_relativeVelocity, -_relativePosition.dot(_relativeVelocity))
            .divideScalar(mu);
        const eccentricity = _eccentricityVector.length();

        return eccentricity < 1 && inverseSemiMajorAxis > 0
            ? (1 + eccentricity) / inverseSemiMajorAxis
            : Infinity;
    }

    /**
     * Read the body's osculating orbit - the conic it is on right now - out of its position and
     * velocity, into the shared scratch: the eccentricity vector, the unit orbit normal, and the
     * inverse semi-major axis (negative on an escape path, and finite through the parabolic case
     * where the semi-major axis itself is not).
     *
     * @param {THREE.Vector3} bodyPosition - The body's position in the line's coordinate space
     * @param {number} radius - That position's length, which every caller already has
     * @returns {number} Eccentricity of the osculating conic, or NaN if the state describes none
     * @private
     */
    #readOsculatingConic(bodyPosition, radius) {
        const mu = this.gravitationalParameter;
        if (!(radius > 0) || !(mu > 0)) return NaN;

        const velocity = this.#bodyVelocityInLineSpace(_bodyLocalVelocity);
        const speedSquared = velocity.lengthSq();

        // Eccentricity vector: it points at periapsis and its length is the eccentricity
        _eccentricityVector.copy(bodyPosition).multiplyScalar(speedSquared - mu / radius)
            .addScaledVector(velocity, -bodyPosition.dot(velocity))
            .divideScalar(mu);

        // The orbit lies in the plane at right angles to its angular momentum
        _orbitNormal.crossVectors(bodyPosition, velocity);

        const eccentricity = _eccentricityVector.length();
        if (!Number.isFinite(eccentricity) || _orbitNormal.lengthSq() === 0) return NaN;

        _orbitNormal.normalize();
        _osculatingInverseSemiMajorAxis = 2 / radius - speedSquared / mu;

        return eccentricity;
    }

    /**
     * Work out the conic to draw, writing its orientation into the shared drawn-basis vectors
     * and returning its eccentricity.
     *
     * The conic is the body's osculating orbit: the path it is on right now, read out of its
     * position and velocity alone. Under n-body physics that is the trajectory the body will
     * actually follow, so the periapsis and apoapsis drawn are the ones it will really reach,
     * rather than those of the catalogue ellipse it started from - by which point the body may
     * be on a noticeably different orbit, and not even in the same plane. A moon whose orbit
     * has gone unstable draws the stretched ellipse it is really on, and once it is thrown clear
     * the eccentricity passes 1 and #buildPath draws the open escape path instead. Under Kepler
     * motion the state vector still describes the catalogue ellipse, so the solve reproduces it.
     *
     * Falls back to the catalogue ellipse only when the state vector describes no conic at all -
     * no velocity, or motion straight at the parent - tilting it about the in-plane direction at
     * right angles to the body, the smallest rotation that brings the plane onto the body.
     *
     * @param {THREE.Vector3} bodyPosition - The body's position in the line's coordinate space
     * @returns {number} Eccentricity of the conic to draw
     * @private
     */
    #solveDrawnConic(bodyPosition) {
        const radius = bodyPosition.length();
        const eccentricity = this.#readOsculatingConic(bodyPosition, radius);

        if (Number.isFinite(eccentricity)) {
            if (eccentricity > MIN_ECCENTRICITY_FOR_PERIAPSIS) {
                _drawnPeriapsisAxis.copy(_eccentricityVector).divideScalar(eccentricity);
            } else {
                _drawnPeriapsisAxis.copy(bodyPosition).divideScalar(radius);
            }

            _drawnInPlaneAxis.crossVectors(_orbitNormal, _drawnPeriapsisAxis);
            return eccentricity;
        }

        // Catalogue ellipse, rotated onto the body. Its axes lie in the fixed orbital plane, so
        // re-expressing each of them over the rotated pair is the whole of the rotation.
        _drawnPeriapsisAxis.copy(this.periapsisAxis);
        _drawnInPlaneAxis.copy(this.inPlaneAxis);

        const alongPeriapsis = bodyPosition.dot(this.periapsisAxis);
        const acrossPeriapsis = bodyPosition.dot(this.inPlaneAxis);
        const inPlaneRadius = Math.hypot(alongPeriapsis, acrossPeriapsis);

        if (inPlaneRadius > 0) {
            const cosTrueAnomaly = alongPeriapsis / inPlaneRadius;
            const sinTrueAnomaly = acrossPeriapsis / inPlaneRadius;

            _tiltAxis.copy(this.periapsisAxis).multiplyScalar(sinTrueAnomaly)
                .addScaledVector(this.inPlaneAxis, -cosTrueAnomaly);
            _bodyDirection.copy(bodyPosition).divideScalar(radius);

            _drawnPeriapsisAxis.copy(_bodyDirection).multiplyScalar(cosTrueAnomaly)
                .addScaledVector(_tiltAxis, sinTrueAnomaly);
            _drawnInPlaneAxis.copy(_bodyDirection).multiplyScalar(sinTrueAnomaly)
                .addScaledVector(_tiltAxis, -cosTrueAnomaly);
        }

        return this.eccentricity;
    }

    /**
     * Solve the orbital path into the double-precision point buffer, starting from the
     * body and drawn through it.
     *
     * Starting the sweep at the body is what makes the line pass through it. The path is a
     * chain of straight chords, so anywhere between two samples the line cuts inside the true
     * arc - by up to L^2 / 8R for a chord of length L on an arc of radius R. Sampled from a
     * fixed epoch the body could sit anywhere in a chord, and for the outer planets that gap
     * is many times the body's own radius: Pluto's chords are around four scene units long on
     * an orbit 639 units across, while Pluto itself is under two ten-thousandths of a unit
     * wide. Anchoring a sample on the body reduces the error there to whatever it drifts
     * before the path is next rebuilt - see #maxAnchorDrift.
     *
     * Which conic gets drawn is #solveDrawnConic's business; this method only samples it,
     * starting from the phase that conic reaches the body at.
     *
     * Samples are spaced uniformly in eccentric anomaly, which needs no Kepler solve and
     * spreads the chord error almost evenly around the ellipse. Uniform mean anomaly is worse
     * on both counts: it puts the longest chords at periapsis, where the arc curves most. An
     * escape trajectory is sampled the same way in the hyperbolic anomaly, which likewise
     * concentrates the samples around periapsis where the path bends.
     *
     * @param {number} segments - Number of segments to sample the orbit with
     * @param {THREE.Vector3} bodyPosition - The body's position in the line's coordinate space
     * @private
     */
    #buildPath(segments, bodyPosition) {
        const steps = Math.max(1, Math.min(segments || this.currentSegments, ORBIT.LOD.MAX_SEGMENTS));
        const points = this.pathPoints;

        // Orientation and shape of the conic to draw, in the line's own coordinate space
        const eccentricity = this.#solveDrawnConic(bodyPosition);
        const periapsisAxis = _drawnPeriapsisAxis;
        const inPlaneAxis = _drawnInPlaneAxis;

        // The body's phase on that conic follows from its direction alone, and the conic is then
        // sized to reach the body's own distance at that phase. Sizing it rather than moving a
        // vertex onto the body is what keeps the line smooth: there is no threshold at which the
        // correction gives up and lets the line snap away from the body.
        const radius = Math.max(bodyPosition.length(), Number.MIN_VALUE);
        const cosTrueAnomaly = bodyPosition.dot(periapsisAxis) / radius;
        const sinTrueAnomaly = bodyPosition.dot(inPlaneAxis) / radius;

        // Anchor sample, and how many samples of the path come before it
        let anchorIndex = 0;
        let semiMajorAxis;

        if (eccentricity < 1) {
            // Closed orbit: r = a(1 - e*cos E), swept right round and joined up again
            const anchorAnomaly = Math.atan2(
                Math.sqrt(1 - eccentricity * eccentricity) * sinTrueAnomaly,
                eccentricity + cosTrueAnomaly);
            semiMajorAxis = radius / (1 - eccentricity * Math.cos(anchorAnomaly));

            const semiMinorAxis = semiMajorAxis * Math.sqrt(1 - eccentricity * eccentricity);
            const anomalyStep = MATH.TWO_PI / steps;

            for (let i = 0; i < steps; i++) {
                const eccentricAnomaly = anchorAnomaly + i * anomalyStep;
                this.#writePoint(i, semiMajorAxis * (Math.cos(eccentricAnomaly) - eccentricity),
                    semiMinorAxis * Math.sin(eccentricAnomaly), periapsisAxis, inPlaneAxis);
            }

            // Close the loop by repeating the first point at the end
            const last = steps * 3;
            points[last] = points[0];
            points[last + 1] = points[1];
            points[last + 2] = points[2];
        } else {
            // Escape trajectory: r = a(e*cosh H - 1), an open curve with no far end, so it is
            // drawn out to a fixed multiple of the body's own distance. Anything else would need
            // an arbitrary limit in scene units, which would vanish for a moon and swamp the
            // view for a planet. The same expression gives the anomaly as for a closed orbit,
            // with the hyperbolic functions standing in for the circular ones.
            const anchorAnomaly = Math.asinh(
                Math.sqrt(eccentricity * eccentricity - 1) * sinTrueAnomaly
                / (1 + eccentricity * cosTrueAnomaly));
            semiMajorAxis = radius / (eccentricity * Math.cosh(anchorAnomaly) - 1);

            const conjugateAxis = semiMajorAxis * Math.sqrt(eccentricity * eccentricity - 1);
            const farLimit = Math.acosh(Math.max(1,
                (ORBIT.OPEN_PATH_RADIUS_RATIO * radius / semiMajorAxis + 1) / eccentricity));
            const anomalyStep = 2 * farLimit / steps;

            // Put the anchor on the nearest sample of that range, so the drawn path still passes
            // exactly through the body rather than merely close to it
            anchorIndex = anomalyStep > 0
                ? Math.min(steps, Math.max(0, Math.round((anchorAnomaly + farLimit) / anomalyStep)))
                : 0;

            for (let i = 0; i <= steps; i++) {
                const hyperbolicAnomaly = anchorAnomaly + (i - anchorIndex) * anomalyStep;
                this.#writePoint(i,
                    semiMajorAxis * (eccentricity - Math.cosh(hyperbolicAnomaly)),
                    conjugateAxis * Math.sinh(hyperbolicAnomaly), periapsisAxis, inPlaneAxis);
            }
        }

        this.pathPointCount = steps + 1;
        this.drawnEccentricity = eccentricity;
        this.drawnSemiMajorAxis = semiMajorAxis;

        // The same description of the conic that #readOsculatingConic produces, so that what is
        // on screen can be held against what the body is doing without re-deriving it
        this.drawnEccentricityVector.copy(periapsisAxis).multiplyScalar(eccentricity);
        this.drawnOrbitNormal.crossVectors(periapsisAxis, inPlaneAxis);
        this.drawnInverseSemiMajorAxis = (eccentricity < 1 ? 1 : -1) / semiMajorAxis;

        // Anchor point doubles as the origin the vertex data is stored relative to, so the
        // vertex closest to the camera is the one carrying no rounding error at all
        const anchor = anchorIndex * 3;
        this.pathOrigin.set(points[anchor], points[anchor + 1], points[anchor + 2]);
    }

    /**
     * Write one sample of the drawn conic into the path buffer, from its two in-plane
     * coordinates measured from the focus.
     * @param {number} index - Which path point to write
     * @param {number} along - Coordinate along the periapsis axis
     * @param {number} across - Coordinate along the in-plane axis
     * @param {THREE.Vector3} periapsisAxis - Periapsis direction of the drawn conic
     * @param {THREE.Vector3} inPlaneAxis - In-plane direction 90 degrees ahead of it
     * @private
     */
    #writePoint(index, along, across, periapsisAxis, inPlaneAxis) {
        const points = this.pathPoints;
        const offset = index * 3;

        points[offset] = along * periapsisAxis.x + across * inPlaneAxis.x;
        points[offset + 1] = along * periapsisAxis.y + across * inPlaneAxis.y;
        points[offset + 2] = along * periapsisAxis.z + across * inPlaneAxis.z;
    }

    /**
     * Rewrite the GPU segment buffer from the solved path, relative to the current origin.
     *
     * The path itself is held in double precision, but the vertex attribute the shader
     * reads is float32, which only carries about seven significant digits. The outer
     * planets orbit hundreds of scene units from the origin while their own radii are
     * ten-thousandths of a unit, so absolute coordinates were being rounded to a visible
     * fraction of a pixel whenever the camera came close - the line appeared to zig-zag.
     * Subtracting an origin near the body and carrying it on the line's transform keeps
     * the stored numbers small; Three.js composes the model-view matrix in double
     * precision, so the large offset never passes through float32.
     *
     * @private
     */
    #writeSegments() {
        const count = this.pathPointCount;
        if (count < 2) {
            this.orbitLine.geometry.instanceCount = 0;
            return;
        }

        const points = this.pathPoints;
        const positions = this.segmentPositions;
        const ox = this.pathOrigin.x, oy = this.pathOrigin.y, oz = this.pathOrigin.z;

        let minX = Infinity, minY = Infinity, minZ = Infinity;
        let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

        for (let i = 0; i < count - 1; i++) {
            const start = i * 3;
            const end = start + 3;
            const offset = i * 6;

            const startX = points[start] - ox;
            const startY = points[start + 1] - oy;
            const startZ = points[start + 2] - oz;

            positions[offset] = startX;
            positions[offset + 1] = startY;
            positions[offset + 2] = startZ;
            positions[offset + 3] = points[end] - ox;
            positions[offset + 4] = points[end + 1] - oy;
            positions[offset + 5] = points[end + 2] - oz;

            if (startX < minX) minX = startX;
            if (startY < minY) minY = startY;
            if (startZ < minZ) minZ = startZ;
            if (startX > maxX) maxX = startX;
            if (startY > maxY) maxY = startY;
            if (startZ > maxZ) maxZ = startZ;
        }

        // The path closes back onto its first point, so the loop above has already covered
        // every distinct position and the bounds need no separate final point.
        this.orbitLine.position.copy(this.pathOrigin);
        this.orbitLine.geometry.instanceCount = count - 1;
        this.positionBuffer.needsUpdate = true;

        const geometry = this.orbitLine.geometry;
        if (!geometry.boundingSphere) {
            geometry.boundingSphere = new THREE.Sphere();
        }
        MathUtils.setSphereFromBox(geometry.boundingSphere, minX, minY, minZ, maxX, maxY, maxZ);
    }

    /**
     * How far the body may drift from the path's anchor point before the line visibly stops
     * passing through it at the current zoom level.
     *
     * Two independent errors grow with that drift, and both are held to the same budget of
     * screen pixels:
     *
     * - Chord error. The path is a chain of straight chords, so a body sitting a distance s
     *   into a chord of length L on an arc of radius R is missed by about s(L - s) / 2R.
     * - Rounding error. The vertex attribute is float32, which resolves roughly one part in
     *   2^23, so a vertex stored at an offset d from the origin is rounded by about d / 2^23.
     *
     * Measuring both against the world size of one screen pixel turns them into distance
     * budgets that tighten automatically as the camera closes in and relax as it pulls back,
     * so a distant orbit is never rebuilt needlessly.
     *
     * @param {THREE.Vector3} cameraPosition - Current camera position
     * @returns {number} Maximum tolerable drift in scene units
     * @private
     */
    #maxAnchorDrift(cameraPosition) {
        const camera = SceneManager.camera;
        const viewportHeight = SceneManager.renderer.domElement.height || window.innerHeight;
        const distance = Math.max(cameraPosition.distanceTo(this.body.group.position), 1e-9);

        const unitsPerPixel = 2 * distance * Math.tan(camera.fov * PI_OVER_180 / 2) / viewportHeight;
        const pixelBudget = ORBIT.PRECISION.JITTER_PIXEL_BUDGET * unitsPerPixel;

        // Sampled uniformly in eccentric anomaly, the ratio of chord length to radius of
        // curvature is worst at periapsis, where it works out to pi / (n * sqrt(1 - e^2)) -
        // so that is what the drift is measured against. The eccentricity term is floored so
        // that a near-parabolic orbit, or an escape path with no eccentric anomaly at all,
        // cannot end up demanding a rebuild every single frame.
        const eccentricity = this.drawnEccentricity;
        const shapeFactor = Math.max(0.05, Math.sqrt(Math.max(0, 1 - eccentricity * eccentricity)));
        const chordBudget = pixelBudget * this.currentSegments * shapeFactor / Math.PI;
        const roundingBudget = pixelBudget * FLOAT32_MANTISSA_STEPS;

        return Math.min(chordBudget, roundingBudget);
    }

    /**
     * How far the drawn conic has been left behind by the orbit the body is actually on, as a
     * distance in scene units, so that it can be judged against the same budget as the anchor.
     *
     * The anchor check alone only notices the body moving along the drawn path. It cannot notice
     * the path itself going wrong, because a body can be thrown onto a completely different orbit
     * without moving at all - which is exactly what happens when a moon is flung out by a close
     * pass, or the moment n-body physics starts perturbing a body away from its catalogue ellipse.
     * A stale line then keeps drawing the old orbit until the body happens to wander off the
     * anchor, which at low time compression can take seconds.
     *
     * Each way the conic can differ is weighted by how far it moves the curve near the body:
     * turning the eccentricity vector or the orbit plane sweeps the curve through roughly the
     * body's own distance times that change, and changing the inverse semi-major axis stretches
     * the curve by around that distance squared times the change. Comparing eccentricity as a
     * vector rather than as a magnitude and a direction is what keeps a near-circular orbit
     * quiet, since there the direction of periapsis is noise but the vector itself stays small.
     *
     * @param {THREE.Vector3} bodyPosition - The body's position in the line's coordinate space
     * @returns {number} Distance the drawn conic has fallen behind the body's own orbit
     * @private
     */
    #shapeDrift(bodyPosition) {
        const radius = bodyPosition.length();
        const eccentricity = this.#readOsculatingConic(bodyPosition, radius);

        // No conic to compare against, so the drawn fallback is as good as it will get
        if (!Number.isFinite(eccentricity)) return 0;

        return radius * (_eccentricityVector.distanceTo(this.drawnEccentricityVector)
                + _orbitNormal.distanceTo(this.drawnOrbitNormal))
            + radius * radius
                * Math.abs(_osculatingInverseSemiMajorAxis - this.drawnInverseSemiMajorAxis);
    }

    /**
     * Get the body's current position in the orbit line's own coordinate space, which is
     * the parent body's group (or its tilt container) rather than the scene root.
     * @param {THREE.Vector3} target - Vector to write the position into
     * @returns {THREE.Vector3} The body position in the line's local space
     * @private
     */
    #bodyPositionInLineSpace(target) {
        target.copy(this.body.group.position);

        const parent = this.orbitLine.parent;
        if (parent) {
            parent.worldToLocal(target);
        }

        return target;
    }

    /**
     * Get the body's velocity relative to whatever it orbits, in the orbit line's own
     * coordinate space. Unlike a position this only needs the parent's rotation taken off,
     * since a velocity carries no origin.
     * @param {THREE.Vector3} target - Vector to write the velocity into
     * @returns {THREE.Vector3} The relative velocity in the line's local space
     * @private
     */
    #bodyVelocityInLineSpace(target) {
        target.copy(this.body.velocity);

        if (this.referenceBody && this.referenceBody.velocity) {
            target.sub(this.referenceBody.velocity);
        }

        const parent = this.orbitLine.parent;
        if (parent) {
            parent.getWorldQuaternion(_inverseParentRotation).invert();
            target.applyQuaternion(_inverseParentRotation);
        }

        return target;
    }


    /**
     * Show the orbit line
     */
    show() {
        if (this.orbitLine && !this.isVisible) {
            this.orbitLine.visible = true;
            this.isVisible = true;
        }
    }

    /**
     * Hide the orbit line
     */
    hide() {
        if (this.orbitLine && this.isVisible) {
            this.orbitLine.visible = false;
            this.isVisible = false;
        }
    }

    /**
     * Get visibility state of the orbit line
     * @returns {boolean} True if visible, false if hidden
     */
    getVisibility() {
        return this.isVisible && this.orbitLine?.visible;
    }

    /**
     * Update orbit center position for LOD calculations
     * @private
     */
    #updateOrbitCenter() {
        if (this.referenceBody) {
            // Orbit center is at the position of the body being orbited
            this.orbitCenter.copy(this.referenceBody.group.position);
        } else {
            // Root orbit (around origin)
            this.orbitCenter.set(0, 0, 0);
        }
    }

    /**
     * Calculate appropriate number of segments based on camera distance
     * @param {THREE.Vector3} cameraPosition - Current camera position
     * @returns {number} Number of segments to use for orbit line
     * @private
     */
    #calculateLODSegments(cameraPosition) {
        // Update orbit center position
        this.#updateOrbitCenter();

        // Calculate distance from camera to orbit center
        const distance = cameraPosition.distanceTo(this.orbitCenter);

        // Work out how large the orbit appears on screen, then spend one segment per
        // TARGET_SEGMENT_PIXELS of its outline. This keeps every orbit line visually
        // smooth without generating segments far below a pixel in length.
        const camera = SceneManager.camera;
        const viewportHeight = SceneManager.renderer.domElement.height || window.innerHeight;
        const pixelsPerRadian = viewportHeight / (camera.fov * MATH.PI_OVER_180);

        // Sized off the orbit actually drawn, so a body flung onto a far wider path than its
        // catalogue orbit gets the segments that path needs
        const angularRadius = Math.atan2(this.drawnSemiMajorAxis, Math.max(distance, 1e-6));
        const pixelRadius = angularRadius * pixelsPerRadian;
        const outlinePixels = MATH.TWO_PI * pixelRadius;

        const segments = Math.round(outlinePixels / ORBIT.LOD.TARGET_SEGMENT_PIXELS);

        return Math.max(ORBIT.LOD.MIN_SEGMENTS, Math.min(ORBIT.LOD.MAX_SEGMENTS, segments));
    }

    /**
     * Update orbit line level-of-detail based on camera distance
     * @param {THREE.Vector3} cameraPosition - Current camera position
     */
    updateLOD(cameraPosition) {
        let needsRebuild = false;

        // Which body the orbit belongs to comes first, since it decides the space the rest of
        // this works in - the path is solved and stored relative to that body
        if (this.parentBody) {
            const referenceBody = this.#selectReferenceBody();
            if (referenceBody !== this.referenceBody) {
                this.#setReferenceBody(referenceBody);
                needsRebuild = true;
            }
        }

        const bodyPosition = this.#bodyPositionInLineSpace(_bodyLocalPosition);

        // The segment count only has to keep up with the camera, so it is sampled occasionally
        this.lastLODUpdate++;
        if (this.lastLODUpdate % Math.round(1 / ORBIT.LOD.UPDATE_FREQUENCY) === 0) {
            const newSegments = this.#calculateLODSegments(cameraPosition);

            // Only re-solve the path if the segment count changed significantly
            const segmentDifference = Math.abs(newSegments - this.currentSegments);
            const thresholdChange = Math.max(8, this.currentSegments * ORBIT.LOD.REBUILD_RATIO);

            if (segmentDifference >= thresholdChange) {
                this.currentSegments = newSegments;
                needsRebuild = true;
            }
        }

        // The path itself is checked every frame instead, against both ways it goes out of date:
        // the body moving away from the anchor it was drawn through, and the body's orbit no
        // longer being the one drawn. Re-solving is the only thing that fixes either.
        if (!needsRebuild) {
            const maxDrift = this.#maxAnchorDrift(cameraPosition);
            if (bodyPosition.distanceTo(this.pathOrigin) > maxDrift
                || this.#shapeDrift(bodyPosition) > maxDrift) {
                needsRebuild = true;
            }
        }

        if (needsRebuild) {
            this.#buildPath(this.currentSegments, bodyPosition);
            this.#writeSegments();
        }
    }

    /**
     * Clean up orbit resources
     */
    dispose() {
        // Unregister this orbit from OrbitManager through SceneManager
        SceneManager.unregisterOrbit(this);

        // Remove orbit line from its parent (either parent body's group or scene)
        if (this.orbitLine && this.orbitLine.parent) {
            this.orbitLine.parent.remove(this.orbitLine);
        }

        // Dispose orbit line geometry and material
        if (this.orbitLine) {
            if (this.orbitLine.geometry) {
                this.orbitLine.geometry.dispose();
            }
            if (this.orbitLine.material) {
                // Unregister material from SceneManager
                SceneManager.unregisterLineMaterial(this.orbitLine.material);
                this.orbitLine.material.dispose();
            }
        }

        // Clear references
        this.orbitLine = null;
        this.body = null;
    }
}

export default Orbit;
