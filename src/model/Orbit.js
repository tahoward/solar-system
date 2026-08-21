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
import { satelliteMass, systemMass } from '../physics/barycentre.js';
import { log } from '../utils/Logger.js';

const PI_OVER_180 = MATH.PI_OVER_180;

/**
 * Number of representable steps in a float32 mantissa.
 *
 * Used to bound how far the drawn path may drift before rounding in the vertex
 * buffer becomes visible.
 *
 * @type {number}
 */
const FLOAT32_MANTISSA_STEPS = 1 << 23;

/**
 * Eccentricity below which the periapsis direction is treated as undefined.
 *
 * A perfectly circular orbit has no periapsis, so the eccentricity vector
 * degenerates and cannot be normalised for a direction.
 *
 * @type {number}
 */
const MIN_ECCENTRICITY_FOR_PERIAPSIS = 1e-9;

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

const _candidates = [];

const _interior = [];

const _centralWeightedPosition = new THREE.Vector3();
const _centralWeightedVelocity = new THREE.Vector3();
const _centralLocalPosition = new THREE.Vector3();
const _sceneOrigin = new THREE.Vector3();
const _centralStandIn = { mass: 0 };

/**
 * Weights how much of an interior body's mass acts as part of the central mass.
 *
 * By the shell theorem a body well inside the orbit adds its full mass to the
 * effective central mass, while one outside adds none. Switching abruptly between
 * the two would make the drawn ellipse jump as bodies cross the orbit, so this
 * ramps between them with a smoothstep.
 *
 * @param {number} distanceRatio - Interior body's distance from the centre,
 *   divided by the orbit's own radius.
 * @returns {number} Fraction of the interior body's mass to count, in `[0, 1]`.
 */
function interiorShare(distanceRatio) {
    const depth = 1 - distanceRatio;
    if (!(depth > 0)) return 0;
    if (depth >= 1) return 1;

    return depth * depth * (3 - 2 * depth);
}

/**
 * Reciprocal semi-major axis from the most recent osculating-conic read.
 *
 * Returned out of band because {@link Orbit##readOsculatingConic} already returns
 * the eccentricity, and this avoids allocating a result object per frame.
 *
 * @type {number}
 */
let _osculatingInverseSemiMajorAxis = 0;


/**
 * The visible ellipse a body is currently following.
 *
 * The path drawn is the *osculating* conic — the orbit implied by the body's
 * instantaneous position and velocity — rather than the fixed ellipse from its
 * catalogued elements. Because the simulation integrates n-body gravity, those
 * two diverge, and drawing the catalogued one would leave the body visibly off
 * its own line. The conic is re-read from the body's state and the path rebuilt
 * whenever it has drifted enough to show.
 *
 * Three further complications are handled here:
 *
 * - **Which body to orbit.** The reference body is chosen by sphere of influence
 *   rather than taken from the hierarchy, so a body that is captured or escapes
 *   has its orbit redrawn about whatever now dominates it.
 * - **Effective central mass.** Bodies interior to the orbit are folded into the
 *   central mass by the shell theorem, weighted by {@link interiorShare}.
 * - **Barycentric motion.** The path is drawn about the common centre of mass, so
 *   for a comparable pair such as Pluto and Charon a second "companion" loop is
 *   drawn for the reference body's own motion about that point.
 *
 * Geometry is generated directly by stepping eccentric anomaly rather than by
 * sampling the Kepler solver, which keeps the whole path a fixed cost regardless
 * of segment count. Hyperbolic paths are supported for escaping bodies, though
 * they are not displayed.
 */
class Orbit {
    /**
     * Creates an orbit line for a body and adds it to the scene.
     *
     * The catalogued elements passed here seed the path and remain the fallback
     * used when the body's state does not yield a usable conic; from then on the
     * drawn shape tracks the body's actual motion.
     *
     * @param {Body} body - Body whose orbit this draws.
     * @param {number} semiMajorAxis - Semi-major axis in AU.
     * @param {number} eccentricity - Orbital eccentricity, in `[0, 1)`.
     * @param {number} [inclination=0] - Inclination in degrees.
     * @param {Body|null} [parentBody=null] - Body being orbited; `null` for a
     *   top-level body, which orbits the scene origin.
     * @param {number} [longitudeOfAscendingNode=0] - Longitude of the ascending
     *   node, in degrees.
     * @param {number} [argumentOfPeriapsis=0] - Argument of periapsis, in degrees.
     * @param {number} [meanAnomalyAtEpoch=0] - Mean anomaly at epoch, in degrees.
     * @param {number} sceneScale - Scene scale factor; required and must be positive.
     * @throws {Error} If `body` is not an object, if `sceneScale` is not a positive
     *   number, or if the orbital elements fail validation.
     */
    constructor(body, semiMajorAxis, eccentricity, inclination = 0, parentBody = null, longitudeOfAscendingNode = 0, argumentOfPeriapsis = 0, meanAnomalyAtEpoch = 0, sceneScale) {
        if (!body || typeof body !== 'object') {
            throw new Error('Orbit constructor: body must be a valid Body object');
        }
        if (typeof sceneScale !== 'number' || sceneScale <= 0) {
            throw new Error('Orbit constructor: sceneScale must be a positive number');
        }
        ConfigValidator.validateOrbitConfig({ semiMajorAxis, eccentricity, inclination });

        const orbitMaterial = new LineMaterial({
            color: body.markerColor || body.material.color,
            linewidth: 2,
            resolution: new THREE.Vector2(window.innerWidth, window.innerHeight),
            transparent: true,
            opacity: 0.8,
            depthWrite: false,
            depthTest: true
        });
        this.body = body;
        this.parentBody = parentBody;
        this.semiMajorAxis = semiMajorAxis;
        this.sceneScale = sceneScale;
        this.semiMajorAxisVisual = semiMajorAxis * getAUScale(this.sceneScale);
        this.eccentricity = eccentricity;
        this.inclinationRadians = inclination * PI_OVER_180;

        this.longitudeOfAscendingNodeRadians = longitudeOfAscendingNode * PI_OVER_180;
        this.argumentOfPeriapsisRadians = argumentOfPeriapsis * PI_OVER_180;
        this.meanAnomalyAtEpochRadians = meanAnomalyAtEpoch * PI_OVER_180;

        const orbitalMotion = calculateOrbitalMotion(semiMajorAxis, parentBody, body.mass);
        this.n = orbitalMotion.meanMotion;
        this.orbitalPeriod = orbitalMotion.orbitalPeriod;

        this.elements = {
            semiMajorAxis: this.semiMajorAxis,
            eccentricity: this.eccentricity,
            inclinationRadians: this.inclinationRadians,
            longitudeOfAscendingNodeRadians: this.longitudeOfAscendingNodeRadians,
            argumentOfPeriapsisRadians: this.argumentOfPeriapsisRadians,
            meanAnomalyAtEpochRadians: this.meanAnomalyAtEpochRadians,
            meanMotion: this.n
        };

        this.periapsisAxis = new THREE.Vector3();
        this.inPlaneAxis = new THREE.Vector3();
        computePerifocalBasis(this.elements, this.periapsisAxis, this.inPlaneAxis);

        this.drawnEccentricity = this.eccentricity;
        this.drawnSemiMajorAxis = this.semiMajorAxisVisual;
        this.drawnEccentricityVector = new THREE.Vector3();
        this.drawnOrbitNormal = new THREE.Vector3();
        this.drawnInverseSemiMajorAxis = 1 / this.semiMajorAxisVisual;

        this.tiltMatrix = null;
        if (parentBody && parentBody.axialTilt && body.equatorialOrbit && parentBody.axialTilt !== 0) {
            this.tiltMatrix = new THREE.Matrix4();
            this.tiltMatrix.makeRotationZ(parentBody.axialTilt * Math.PI / 180);
        }

        this.currentSegments = ORBIT.LOD.INITIAL_SEGMENTS;
        this.lastLODUpdate = 0;
        this.orbitCenter = new THREE.Vector3();

        const maxPoints = ORBIT.LOD.MAX_SEGMENTS + 2;
        this.pathPoints = new Float64Array(maxPoints * 3);
        this.pathPointCount = 0;

        this.isVisible = true;
        this.pathIsClosed = true;
        this.segmentPositions = new Float32Array((maxPoints - 1) * 6);
        this.pathOrigin = new THREE.Vector3();

        const geometry = new LineSegmentsGeometry();
        geometry.setPositions(this.segmentPositions);
        this.positionBuffer = geometry.attributes.instanceStart.data;
        this.orbitLine = new LineSegments2(geometry, orbitMaterial);

        this.orbitLine.renderOrder = -100;
        this.orbitLine.material.userData = { renderBehindMarkers: true };
        SceneManager.markOverlay(this.orbitLine);

        this.barycentreOffset = new THREE.Vector3();
        this.barycentreShare = 1;

        this.centralPosition = new THREE.Vector3();
        this.centralVelocity = new THREE.Vector3();

        this.companionLine = null;
        this.companionPositions = null;
        this.companionBuffer = null;

        this.referenceBody = null;
        this.#setReferenceBody(this.parentBody);

        this.#updateOrbitCenter();

        this.#buildPath(this.currentSegments, this.#bodyPositionInLineSpace(_bodyLocalPosition));
        this.#writeSegments();

        SceneManager.registerLineMaterial(orbitMaterial);

        if (this.body && this.body.initializeOrbitTrail && typeof this.body.initializeOrbitTrail === 'function') {
            this.body.initializeOrbitTrail();
        }

        SceneManager.registerOrbit(this);
    }

    /**
     * Rebases the orbit onto a different body, moving its line to match.
     *
     * The line is parented to the reference body's group so it follows along
     * without the path having to be rewritten each frame. For an equatorial orbit
     * it is parented to the tilt container instead, which makes the orbit inherit
     * the parent's axial tilt — the plane a close moon actually orbits in. The
     * body itself is reparented to match, keeping their coordinate spaces aligned.
     *
     * @private
     * @param {Body|null} referenceBody - Body to orbit about; `null` uses the scene
     *   origin.
     * @returns {void}
     */
    #setReferenceBody(referenceBody) {
        this.referenceBody = referenceBody;
        this.#updateCentralBody();

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

        if (referenceBody) {
            SceneManager.reparentBody(this.body, referenceBody);
        }

        this.#updateCompanionLine(container);
    }

    /**
     * Recomputes the effective central mass, position and velocity.
     *
     * The reference body alone is not what a distant body orbits: by the shell
     * theorem everything inside the orbit contributes too. Neptune's path about the
     * Sun, for instance, is really about the Sun plus all the interior planets.
     * Each candidate is therefore folded in with the weight
     * {@link interiorShare} gives it, so bodies crossing the orbit do not cause
     * the drawn ellipse to jump.
     *
     * Also derives `barycentreShare` — the fraction of the pair's separation that
     * falls on the body's side of their common centre of mass — and the
     * gravitational parameter matching the scaled-down path that share implies.
     *
     * @private
     * @returns {void}
     */
    #updateCentralBody() {
        const reference = this.referenceBody;
        const centre = reference ? reference.group.position : _sceneOrigin;

        let mass = reference?.mass > 0 ? reference.mass : 1;
        _centralWeightedPosition.copy(centre).multiplyScalar(mass);
        _centralWeightedVelocity.copy(reference?.velocity || _sceneOrigin).multiplyScalar(mass);

        const orbitRadius = this.body.group.position.distanceTo(centre);

        const hierarchy = orbitRadius > 0 ? SceneManager.orbitManager?.hierarchy : null;
        if (hierarchy) {
            collectBodiesFromHierarchy(hierarchy, _interior);

            for (let i = 0; i < _interior.length; i++) {
                const candidate = _interior[i];
                if (candidate === this.body || candidate === reference || !(candidate.mass > 0)) continue;

                const distance = candidate.group.position.distanceTo(centre);
                const counted = candidate.mass * interiorShare(distance / orbitRadius);
                if (counted <= 0) continue;

                _centralWeightedPosition.addScaledVector(candidate.group.position, counted);
                if (candidate.velocity) {
                    _centralWeightedVelocity.addScaledVector(candidate.velocity, counted);
                }
                mass += counted;
            }

            _interior.length = 0;
        }

        this.centralPosition.copy(_centralWeightedPosition).divideScalar(mass);
        this.centralVelocity.copy(_centralWeightedVelocity).divideScalar(mass);
        _centralStandIn.mass = mass;
        const relativeGM = calculateGM(_centralStandIn, this.body.mass);
        this.barycentreShare = reference ? calculateGM(_centralStandIn) / relativeGM : 1;
        this.gravitationalParameter = relativeGM * this.barycentreShare ** 3;
    }

    /**
     * Creates, moves or removes the reference body's own loop about the barycentre.
     *
     * When the two bodies are comparable in mass the reference body traces a
     * visible loop of its own — Pluto and Charon both circle a point between them.
     * The loop is only worth drawing when it would be larger than the reference
     * body itself and this body accounts for a meaningful share of the satellite
     * mass; otherwise it would be hidden inside the body or drown out a genuine
     * primary.
     *
     * @private
     * @param {THREE.Object3D} container - Object the loop should be parented to.
     * @returns {boolean} `true` if a loop was newly built or an existing one
     *   removed, meaning the caller must rewrite the segments.
     */
    #updateCompanionLine(container) {
        const counterpartAxis = this.semiMajorAxisVisual * (1 - this.barycentreShare);
        const satellites = satelliteMass(this.referenceBody);
        const wanted = !!this.referenceBody
            && counterpartAxis > (this.referenceBody.radius || 0)
            && systemMass(this.body) >= satellites * ORBIT.COMPANION_LOOP_MASS_SHARE;

        if (!wanted) {
            const had = !!this.companionLine;
            this.#disposeCompanionLine();
            return had;
        }

        let built = false;
        if (!this.companionLine) {
            built = true;
            const material = new LineMaterial({
                color: this.referenceBody.markerColor || this.referenceBody.material?.color,
                linewidth: 2,
                resolution: new THREE.Vector2(window.innerWidth, window.innerHeight),
                transparent: true,
                opacity: 0.8,
                depthWrite: false,
                depthTest: true
            });

            this.companionPositions = new Float32Array(this.segmentPositions.length);
            const geometry = new LineSegmentsGeometry();
            geometry.setPositions(this.companionPositions);
            this.companionBuffer = geometry.attributes.instanceStart.data;

            this.companionLine = new LineSegments2(geometry, material);
            this.companionLine.renderOrder = -100;
            this.companionLine.material.userData = { renderBehindMarkers: true };
            this.companionLine.visible = this.orbitLine.visible;
            SceneManager.markOverlay(this.companionLine);
            SceneManager.registerLineMaterial(material);

            log.debug('Orbit', `Drawing ${this.referenceBody.name}'s own loop about its centre of mass with ${this.body.name}`);
        }

        if (this.companionLine.parent !== container) {
            if (this.companionLine.parent) {
                this.companionLine.parent.remove(this.companionLine);
            }
            container.add(this.companionLine);
        }

        return built;
    }

    /**
     * Removes the companion loop and releases its GPU resources.
     *
     * @private
     * @returns {void}
     */
    #disposeCompanionLine() {
        if (!this.companionLine) return;

        if (this.companionLine.parent) {
            this.companionLine.parent.remove(this.companionLine);
        }
        this.companionLine.geometry.dispose();
        SceneManager.unregisterLineMaterial(this.companionLine.material);
        this.companionLine.material.dispose();

        this.companionLine = null;
        this.companionPositions = null;
        this.companionBuffer = null;
    }

    /**
     * Picks the body that currently dominates this one gravitationally.
     *
     * The configured parent is not used directly, because bodies here can be
     * captured or thrown out: a dropped mass may fall into orbit about a planet,
     * and a perturbed moon may escape to orbit the Sun. A candidate qualifies only
     * if this body's apoapsis about it fits inside its sphere of influence, and the
     * smallest such sphere wins — the most local host is the one that governs.
     *
     * The incumbent is tested first and kept with a slack factor
     * (`RECAPTURE_RATIO`), which stops the orbit flickering between two hosts for a
     * body sitting on the boundary. Descendants are skipped so a body cannot be
     * made to orbit something that orbits it.
     *
     * @private
     * @returns {Body|null} The dominant body, falling back to the hierarchy root.
     */
    #selectReferenceBody() {
        const rootBody = this.#rootBody();
        const recaptureRatio = ORBIT.SPHERE_OF_INFLUENCE.RECAPTURE_RATIO;

        _candidates.length = 0;
        const hierarchy = SceneManager.orbitManager?.hierarchy;
        if (hierarchy) collectBodiesFromHierarchy(hierarchy, _candidates);

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

            const reach = this.#sphereOfInfluence(candidate);
            if (!(reach < hostReach)) continue;
            if (this.#apoapsisAbout(candidate) > reach * recaptureRatio) continue;

            if (SceneManager.hierarchyManager?.isDescendantOf(candidate.name, this.body.name)) continue;

            host = candidate;
            hostReach = reach;
        }

        _candidates.length = 0;

        return host || rootBody;
    }

    /**
     * Walks up the parent chain to the top of the hierarchy.
     *
     * @private
     * @returns {Body|null} The outermost ancestor — normally the Sun — or `null`
     *   if this body has no parent.
     */
    #rootBody() {
        let body = this.parentBody;
        while (body?.parentBody) {
            body = body.parentBody;
        }
        return body;
    }

    /**
     * Estimates the radius within which a body's gravity dominates its parent's.
     *
     * Uses the Hill sphere, `r ≈ d·∛(m / 3M)`. A body with no parent has unbounded
     * reach, since nothing competes with it.
     *
     * @private
     * @param {Body} body - Candidate host.
     * @returns {number} Radius in scene units, or `Infinity` if unbounded.
     */
    #sphereOfInfluence(body) {
        const outerBody = body.parentBody;
        if (!outerBody || !(body.mass > 0) || !(outerBody.mass > 0)) return Infinity;

        const separation = body.group.position.distanceTo(outerBody.group.position);
        return separation * Math.cbrt(body.mass / (3 * outerBody.mass));
    }

    /**
     * Computes how far this body would recede from a candidate host.
     *
     * Derives the osculating conic from the relative position and velocity and
     * returns its apoapsis. An unbound (parabolic or hyperbolic) path has none, so
     * `Infinity` is returned and the candidate cannot qualify as a host.
     *
     * @private
     * @param {Body} body - Candidate host.
     * @returns {number} Apoapsis distance in scene units, or `Infinity` if the
     *   relative orbit is unbound or indeterminate.
     */
    #apoapsisAbout(body) {
        if (!this.body.velocity || !body.velocity) return Infinity;

        _relativePosition.subVectors(this.body.group.position, body.group.position);
        _relativeVelocity.subVectors(this.body.velocity, body.velocity);

        const mu = calculateGM(body, this.body.mass);
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
     * Reads the conic implied by the body's current position and velocity.
     *
     * This is what makes the drawn line follow the body's real motion instead of
     * its catalogued ellipse. The eccentricity vector and orbit normal are left in
     * the `_eccentricityVector` and `_orbitNormal` scratch vectors, and the
     * reciprocal semi-major axis in `_osculatingInverseSemiMajorAxis`, so nothing
     * is allocated on this per-frame path.
     *
     * @private
     * @param {THREE.Vector3} bodyPosition - Body's position relative to the
     *   effective centre, in line space.
     * @param {number} radius - Length of `bodyPosition`, passed in as the caller
     *   already has it.
     * @returns {number} Eccentricity, or `NaN` if the state is degenerate — a zero
     *   radius, no central mass, or motion straight towards the centre.
     */
    #readOsculatingConic(bodyPosition, radius) {
        const mu = this.gravitationalParameter;
        if (!(radius > 0) || !(mu > 0)) return NaN;

        const velocity = this.#bodyVelocityInLineSpace(_bodyLocalVelocity);
        const speedSquared = velocity.lengthSq();

        _eccentricityVector.copy(bodyPosition).multiplyScalar(speedSquared - mu / radius)
            .addScaledVector(velocity, -bodyPosition.dot(velocity))
            .divideScalar(mu);

        _orbitNormal.crossVectors(bodyPosition, velocity);

        const eccentricity = _eccentricityVector.length();
        if (!Number.isFinite(eccentricity) || _orbitNormal.lengthSq() === 0) return NaN;

        _orbitNormal.normalize();
        _osculatingInverseSemiMajorAxis = 2 / radius - speedSquared / mu;

        return eccentricity;
    }

    /**
     * Determines the conic to draw and its orientation axes.
     *
     * Prefers the osculating conic. Where the state is degenerate it falls back to
     * the catalogued elements, but rotates the perifocal basis so that periapsis
     * sits at the body's actual true anomaly — otherwise the fallback ellipse would
     * be correctly shaped yet visibly offset from the body it belongs to.
     *
     * The axes are written to `_drawnPeriapsisAxis` and `_drawnInPlaneAxis`.
     *
     * @private
     * @param {THREE.Vector3} bodyPosition - Body's position relative to the
     *   effective centre, in line space.
     * @returns {number} Eccentricity of the conic to draw; may be ≥ 1 for an
     *   escaping body.
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
     * Regenerates the path's points from the body's current state.
     *
     * Points are stepped in eccentric anomaly (or hyperbolic anomaly for an
     * unbound path), which yields the conic from cheap trigonometry and avoids
     * running the Kepler solver per vertex. Sampling *starts* at the body's own
     * anomaly, so one vertex always lands exactly on the body and the line is never
     * seen to cut a corner beneath it.
     *
     * Closed paths repeat their first point to seal the ellipse. Open paths are
     * truncated at `ORBIT.OPEN_PATH_RADIUS_RATIO` times the current radius, since a
     * hyperbola has no natural extent.
     *
     * @private
     * @param {number} segments - Requested segment count; clamped to the LOD range.
     * @param {THREE.Vector3} bodyPosition - Body's position relative to the
     *   effective centre, in line space.
     * @returns {void}
     */
    #buildPath(segments, bodyPosition) {
        const steps = Math.max(1, Math.min(segments || this.currentSegments, ORBIT.LOD.MAX_SEGMENTS));
        const points = this.pathPoints;

        const eccentricity = this.#solveDrawnConic(bodyPosition);
        const periapsisAxis = _drawnPeriapsisAxis;
        const inPlaneAxis = _drawnInPlaneAxis;

        const radius = Math.max(bodyPosition.length(), Number.MIN_VALUE);
        const cosTrueAnomaly = bodyPosition.dot(periapsisAxis) / radius;
        const sinTrueAnomaly = bodyPosition.dot(inPlaneAxis) / radius;

        let anchorIndex = 0;
        let semiMajorAxis;

        if (eccentricity < 1) {
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

            const last = steps * 3;
            points[last] = points[0];
            points[last + 1] = points[1];
            points[last + 2] = points[2];
        } else {
            const anchorAnomaly = Math.asinh(
                Math.sqrt(eccentricity * eccentricity - 1) * sinTrueAnomaly
                / (1 + eccentricity * cosTrueAnomaly));
            semiMajorAxis = radius / (eccentricity * Math.cosh(anchorAnomaly) - 1);

            const conjugateAxis = semiMajorAxis * Math.sqrt(eccentricity * eccentricity - 1);
            const farLimit = Math.acosh(Math.max(1,
                (ORBIT.OPEN_PATH_RADIUS_RATIO * radius / semiMajorAxis + 1) / eccentricity));
            const anomalyStep = 2 * farLimit / steps;

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

        this.pathIsClosed = eccentricity < 1;
        this.#applyVisibility();

        this.drawnEccentricityVector.copy(periapsisAxis).multiplyScalar(eccentricity);
        this.drawnOrbitNormal.crossVectors(periapsisAxis, inPlaneAxis);
        this.drawnInverseSemiMajorAxis = (eccentricity < 1 ? 1 : -1) / semiMajorAxis;

        const anchor = anchorIndex * 3;
        this.pathOrigin.set(points[anchor], points[anchor + 1], points[anchor + 2]);
    }

    /**
     * Projects a point from the orbital plane into line space.
     *
     * @private
     * @param {number} index - Point index within `pathPoints`.
     * @param {number} along - Coordinate along the periapsis axis.
     * @param {number} across - Coordinate along the in-plane axis.
     * @param {THREE.Vector3} periapsisAxis - Unit vector towards periapsis.
     * @param {THREE.Vector3} inPlaneAxis - Unit vector perpendicular to it, in plane.
     * @returns {void}
     */
    #writePoint(index, along, across, periapsisAxis, inPlaneAxis) {
        const points = this.pathPoints;
        const offset = index * 3;

        points[offset] = along * periapsisAxis.x + across * inPlaneAxis.x;
        points[offset + 1] = along * periapsisAxis.y + across * inPlaneAxis.y;
        points[offset + 2] = along * periapsisAxis.z + across * inPlaneAxis.z;
    }

    /**
     * Copies the path points into the line's vertex buffer.
     *
     * The path is held in `Float64Array` but the GPU buffer is float32, so
     * positions are rebased on the anchor point before conversion — at Neptune's
     * distance the absolute coordinates would otherwise lose enough precision to
     * make the line visibly ragged. The line's own transform carries the anchor
     * back.
     *
     * The bounding sphere is set explicitly, since `LineSegments2` cannot derive
     * one from a partially filled buffer and the orbit would be wrongly culled.
     *
     * @private
     * @returns {void}
     */
    #writeSegments() {
        const count = this.pathPointCount;
        if (count < 2) {
            this.orbitLine.geometry.instanceCount = 0;
            if (this.companionLine) this.companionLine.geometry.instanceCount = 0;
            return;
        }

        this.#writeCompanionSegments(count);

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

        this.#placeLine();
        this.orbitLine.geometry.instanceCount = count - 1;
        this.positionBuffer.needsUpdate = true;

        const geometry = this.orbitLine.geometry;
        if (!geometry.boundingSphere) {
            geometry.boundingSphere = new THREE.Sphere();
        }
        MathUtils.setSphereFromBox(geometry.boundingSphere, minX, minY, minZ, maxX, maxY, maxZ);
    }

    /**
     * Writes the companion loop by reflecting and rescaling this body's path.
     *
     * Both bodies trace the same conic about their common centre of mass, differing
     * only in size and direction, so the reference body's loop is this path negated
     * and scaled by the inverse mass ratio. No separate conic solve is needed.
     *
     * These points stay centred on the barycentre rather than being rebased, so the
     * bounding sphere is simply the largest radius seen.
     *
     * @private
     * @param {number} count - Number of valid points in `pathPoints`.
     * @returns {void}
     */
    #writeCompanionSegments(count) {
        if (!this.companionLine) return;

        const scale = -(1 - this.barycentreShare) / this.barycentreShare;
        const points = this.pathPoints;
        const positions = this.companionPositions;
        let radius = 0;

        for (let i = 0; i < count - 1; i++) {
            const start = i * 3;
            const end = start + 3;
            const offset = i * 6;

            const x = points[start] * scale;
            const y = points[start + 1] * scale;
            const z = points[start + 2] * scale;

            positions[offset] = x;
            positions[offset + 1] = y;
            positions[offset + 2] = z;
            positions[offset + 3] = points[end] * scale;
            positions[offset + 4] = points[end + 1] * scale;
            positions[offset + 5] = points[end + 2] * scale;

            const distance = x * x + y * y + z * z;
            if (distance > radius) radius = distance;
        }

        this.companionLine.geometry.instanceCount = count - 1;
        this.companionBuffer.needsUpdate = true;

        const geometry = this.companionLine.geometry;
        if (!geometry.boundingSphere) {
            geometry.boundingSphere = new THREE.Sphere();
        }
        geometry.boundingSphere.center.set(0, 0, 0);
        geometry.boundingSphere.radius = Math.sqrt(radius);
    }

    /**
     * Works out how much drift is tolerable before the path must be rebuilt.
     *
     * Expressed as a world-space distance derived from a pixel budget, so nearby
     * orbits are held to a tight tolerance while distant ones are left alone —
     * rebuilding every orbit every frame would be far too expensive.
     *
     * Two limits are combined: the chord budget, beyond which the polyline's
     * faceting would show, and the rounding budget, beyond which float32 error in
     * the vertex buffer would. The tighter of the two applies.
     *
     * @private
     * @param {THREE.Vector3} cameraPosition - Current camera position.
     * @returns {number} Allowable drift in scene units.
     */
    #maxAnchorDrift(cameraPosition) {
        const camera = SceneManager.camera;
        const viewportHeight = SceneManager.renderer.domElement.height || window.innerHeight;
        const distance = Math.max(cameraPosition.distanceTo(this.body.group.position), 1e-9);

        const unitsPerPixel = 2 * distance * Math.tan(camera.fov * PI_OVER_180 / 2) / viewportHeight;
        const pixelBudget = ORBIT.PRECISION.JITTER_PIXEL_BUDGET * unitsPerPixel;

        const eccentricity = this.drawnEccentricity;
        const shapeFactor = Math.max(0.05, Math.sqrt(Math.max(0, 1 - eccentricity * eccentricity)));
        const chordBudget = pixelBudget * this.currentSegments * shapeFactor / Math.PI;
        const roundingBudget = pixelBudget * FLOAT32_MANTISSA_STEPS;

        return Math.min(chordBudget, roundingBudget);
    }

    /**
     * Estimates how far the drawn conic now departs from the body's real one.
     *
     * Compares the current osculating conic against the one the path was built
     * from, converting each difference — in eccentricity vector, orbit normal and
     * reciprocal semi-major axis — into a position error at the body's radius, so
     * the result is directly comparable with {@link Orbit##maxAnchorDrift}. This is
     * what catches an orbit whose *shape* has been perturbed even though the body
     * has not moved far from its anchor.
     *
     * @private
     * @param {THREE.Vector3} bodyPosition - Body's position relative to the
     *   effective centre, in line space.
     * @returns {number} Approximate error in scene units, or 0 if the current state
     *   yields no usable conic.
     */
    #shapeDrift(bodyPosition) {
        const radius = bodyPosition.length();
        const eccentricity = this.#readOsculatingConic(bodyPosition, radius);

        if (!Number.isFinite(eccentricity)) return 0;

        return radius * (_eccentricityVector.distanceTo(this.drawnEccentricityVector)
                + _orbitNormal.distanceTo(this.drawnOrbitNormal))
            + radius * radius
                * Math.abs(_osculatingInverseSemiMajorAxis - this.drawnInverseSemiMajorAxis);
    }

    /**
     * Expresses the body's position in the space the path is drawn in.
     *
     * Converts into the line's parent space, offsets from the effective centre, and
     * scales by `barycentreShare` so the path is the body's share of the pair's
     * motion rather than the full separation. The remainder — the offset from the
     * centre out to the barycentre — is stored in `barycentreOffset` for
     * {@link Orbit##placeLine} to apply as the line's transform.
     *
     * @private
     * @param {THREE.Vector3} target - Vector to write into; mutated and returned.
     * @returns {THREE.Vector3} The `target` vector.
     */
    #bodyPositionInLineSpace(target) {
        target.copy(this.body.group.position);
        _centralLocalPosition.copy(this.centralPosition);

        const parent = this.orbitLine.parent;
        if (parent) {
            parent.worldToLocal(target);
            parent.worldToLocal(_centralLocalPosition);
        }

        target.sub(_centralLocalPosition);

        this.barycentreOffset.copy(target).multiplyScalar(1 - this.barycentreShare)
            .add(_centralLocalPosition);

        return target.multiplyScalar(this.barycentreShare);
    }

    /**
     * Expresses the body's velocity in the space the path is drawn in.
     *
     * The counterpart to {@link Orbit##bodyPositionInLineSpace} — velocity must be
     * transformed consistently with position or the conic derived from the pair
     * would be wrong. Only the parent's rotation is applied, since a velocity has
     * no translation.
     *
     * @private
     * @param {THREE.Vector3} target - Vector to write into; mutated and returned.
     * @returns {THREE.Vector3} The `target` vector.
     */
    #bodyVelocityInLineSpace(target) {
        target.copy(this.body.velocity);

        if (this.referenceBody) {
            target.sub(this.centralVelocity);
        }

        const parent = this.orbitLine.parent;
        if (parent) {
            parent.getWorldQuaternion(_inverseParentRotation).invert();
            target.applyQuaternion(_inverseParentRotation);
        }

        return target.multiplyScalar(this.barycentreShare);
    }

    /**
     * Positions the orbit lines for the current frame.
     *
     * Restores the anchor that {@link Orbit##writeSegments} subtracted out and adds
     * the barycentre offset, which is what lets the line track the barycentre's
     * motion every frame without the path being rebuilt.
     *
     * @private
     * @returns {void}
     */
    #placeLine() {
        this.orbitLine.position.addVectors(this.pathOrigin, this.barycentreOffset);

        if (this.companionLine) {
            this.companionLine.position.copy(this.barycentreOffset);
        }
    }

    /**
     * Requests that the orbit be shown.
     *
     * An unbound path stays hidden regardless, since a hyperbola is not a
     * meaningful orbit to display.
     *
     * @returns {void}
     */
    show() {
        this.isVisible = true;
        this.#applyVisibility();
    }

    /**
     * Hides the orbit and its companion loop.
     *
     * @returns {void}
     */
    hide() {
        this.isVisible = false;
        this.#applyVisibility();
    }

    /**
     * Applies the requested visibility, suppressing unbound paths.
     *
     * @private
     * @returns {void}
     */
    #applyVisibility() {
        const visible = this.isVisible && this.pathIsClosed;

        if (this.orbitLine) this.orbitLine.visible = visible;

        if (this.companionLine) this.companionLine.visible = visible;
    }

    /**
     * Reports whether the orbit is actually being drawn.
     *
     * @returns {boolean} `true` if it is both wanted and shown.
     */
    getVisibility() {
        return this.isVisible && this.orbitLine?.visible;
    }

    /**
     * Caches the reference body's position as the orbit's centre.
     *
     * Used for LOD distance measurement, where the centre of the orbit is a better
     * reference than the body's own moving position.
     *
     * @private
     * @returns {void}
     */
    #updateOrbitCenter() {
        if (this.referenceBody) {
            this.orbitCenter.copy(this.referenceBody.group.position);
        } else {
            this.orbitCenter.set(0, 0, 0);
        }
    }

    /**
     * Chooses a segment count from the orbit's apparent size on screen.
     *
     * Segments are budgeted per screen pixel of outline rather than by distance
     * alone, so a small nearby orbit and a huge distant one both get roughly the
     * detail their appearance warrants.
     *
     * @private
     * @param {THREE.Vector3} cameraPosition - Current camera position.
     * @returns {number} Segment count, clamped to the configured LOD range.
     */
    #calculateLODSegments(cameraPosition) {
        this.#updateOrbitCenter();

        const distance = cameraPosition.distanceTo(this.orbitCenter);

        const camera = SceneManager.camera;
        const viewportHeight = SceneManager.renderer.domElement.height || window.innerHeight;
        const pixelsPerRadian = viewportHeight / (camera.fov * MATH.PI_OVER_180);

        const angularRadius = Math.atan2(this.drawnSemiMajorAxis, Math.max(distance, 1e-6));
        const pixelRadius = angularRadius * pixelsPerRadian;
        const outlinePixels = MATH.TWO_PI * pixelRadius;

        const segments = Math.round(outlinePixels / ORBIT.LOD.TARGET_SEGMENT_PIXELS);

        return Math.max(ORBIT.LOD.MIN_SEGMENTS, Math.min(ORBIT.LOD.MAX_SEGMENTS, segments));
    }

    /**
     * Brings the orbit up to date for the current frame.
     *
     * The per-frame work is deliberately minimal — the effective centre is
     * refreshed and the line repositioned, but the path is only regenerated when
     * something makes it wrong: a change of reference body, a segment count that no
     * longer suits the view, a companion loop appearing or disappearing, or drift
     * past the tolerance from {@link Orbit##maxAnchorDrift}.
     *
     * Segment-count and companion checks are throttled to
     * `ORBIT.LOD.UPDATE_FREQUENCY`, and the count must change by more than
     * `ORBIT.LOD.REBUILD_RATIO` before it is acted on, which prevents rebuilds
     * oscillating as the camera moves.
     *
     * @param {THREE.Vector3} cameraPosition - Current camera position.
     * @returns {void}
     */
    updateLOD(cameraPosition) {
        let needsRebuild = false;

        if (this.parentBody) {
            const referenceBody = this.#selectReferenceBody();
            if (referenceBody !== this.referenceBody) {
                this.#setReferenceBody(referenceBody);
                needsRebuild = true;
            }
        }

        this.#updateCentralBody();

        const bodyPosition = this.#bodyPositionInLineSpace(_bodyLocalPosition);

        this.lastLODUpdate++;
        if (this.lastLODUpdate % Math.round(1 / ORBIT.LOD.UPDATE_FREQUENCY) === 0) {
            const newSegments = this.#calculateLODSegments(cameraPosition);

            const segmentDifference = Math.abs(newSegments - this.currentSegments);
            const thresholdChange = Math.max(8, this.currentSegments * ORBIT.LOD.REBUILD_RATIO);

            if (segmentDifference >= thresholdChange) {
                this.currentSegments = newSegments;
                needsRebuild = true;
            }

            if (this.#updateCompanionLine(this.orbitLine.parent || SceneManager.scene)) {
                needsRebuild = true;
            }
        }

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

        this.#placeLine();
    }

    /**
     * Releases the orbit's GPU resources and detaches both lines.
     *
     * @returns {void}
     */
    dispose() {
        SceneManager.unregisterOrbit(this);

        this.#disposeCompanionLine();

        if (this.orbitLine && this.orbitLine.parent) {
            this.orbitLine.parent.remove(this.orbitLine);
        }

        if (this.orbitLine) {
            if (this.orbitLine.geometry) {
                this.orbitLine.geometry.dispose();
            }
            if (this.orbitLine.material) {
                SceneManager.unregisterLineMaterial(this.orbitLine.material);
                this.orbitLine.material.dispose();
            }
        }

        this.orbitLine = null;
        this.body = null;
    }
}

export default Orbit;
