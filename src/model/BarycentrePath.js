import * as THREE from 'three';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import SceneManager from '../managers/SceneManager.js';
import MathUtils from '../utils/MathUtils.js';
import { BARYCENTRE, MATH } from '../constants.js';
import { calculateGM, getAUScale, solveKeplerEquation } from '../physics/kepler.js';
import { systemMass, systemState } from '../physics/barycentre.js';
import { log } from '../utils/Logger.js';

const PI_OVER_180 = MATH.PI_OVER_180;

// Below this eccentricity the direction of periapsis is numerical noise, so the body's own
// direction stands in for it, as it does in Orbit
const MIN_ECCENTRICITY_FOR_PERIAPSIS = 1e-9;

// Scratch values reused while reading the contributors' orbits and sampling them
const _position = new THREE.Vector3();
const _velocity = new THREE.Vector3();
const _rootVelocity = new THREE.Vector3();
const _eccentricityVector = new THREE.Vector3();
const _orbitNormal = new THREE.Vector3();
const _sample = new THREE.Vector3();
const _offsetSum = new THREE.Vector3();
const _linePosition = new THREE.Vector3();


/**
 * One body's pull on where the system's centre of mass sits: the orbit it is on about the root
 * body, and the share of the separation the root has to answer for.
 *
 * A planet with moons counts as one of these, taken at its own centre of mass and with its moons'
 * masses added in, because that is the point which moves along a clean orbit about the Sun and the
 * mass the Sun answers to from that direction.
 */
class Contributor {
    constructor() {
        this.weight = 0;
        this.frozen = true;
        this.offset = new THREE.Vector3();
        this.periapsisAxis = new THREE.Vector3();
        this.inPlaneAxis = new THREE.Vector3();
        this.semiMajorAxis = 0;
        this.semiMinorAxis = 0;
        this.eccentricity = 0;
        this.meanAnomalyAtEpoch = 0;
        this.meanMotion = 0;
    }

    /**
     * Read the ellipse this contributor is on out of its position and velocity relative to the
     * root body, along with the phase it has reached, so that the same orbit can be evaluated at
     * any time either side of now.
     *
     * A contributor whose state describes no ellipse - an escape path, or a body sitting still -
     * is frozen where it is instead. Its pull on the centre of mass is then right for the present
     * moment and held constant across the rest of the drawn window, which is the best that can be
     * said about a body that will never come back round.
     *
     * @param {THREE.Vector3} position - Position relative to the root body, in scene units
     * @param {THREE.Vector3} velocity - Velocity relative to the root body
     * @param {number} mu - Gravitational parameter of the pair
     */
    read(position, velocity, mu) {
        this.frozen = true;
        this.offset.copy(position);

        const radius = position.length();
        if (!(radius > 0) || !(mu > 0)) return;

        const speedSquared = velocity.lengthSq();
        const inverseSemiMajorAxis = 2 / radius - speedSquared / mu;
        if (!(inverseSemiMajorAxis > 0)) return;

        _eccentricityVector.copy(position).multiplyScalar(speedSquared - mu / radius)
            .addScaledVector(velocity, -position.dot(velocity))
            .divideScalar(mu);
        const eccentricity = _eccentricityVector.length();
        if (!(eccentricity < 1)) return;

        _orbitNormal.crossVectors(position, velocity);
        if (_orbitNormal.lengthSq() === 0) return;

        if (eccentricity > MIN_ECCENTRICITY_FOR_PERIAPSIS) {
            this.periapsisAxis.copy(_eccentricityVector).divideScalar(eccentricity);
        } else {
            this.periapsisAxis.copy(position).divideScalar(radius);
        }
        this.inPlaneAxis.crossVectors(_orbitNormal.normalize(), this.periapsisAxis);

        const semiMajorAxis = 1 / inverseSemiMajorAxis;
        const semiMinorAxis = semiMajorAxis * Math.sqrt(1 - eccentricity * eccentricity);

        // Where the body is on that ellipse now, from the two in-plane coordinates of its
        // position: x = a(cos E - e) and y = b sin E
        const eccentricAnomaly = Math.atan2(
            position.dot(this.inPlaneAxis) / semiMinorAxis,
            position.dot(this.periapsisAxis) / semiMajorAxis + eccentricity);

        this.eccentricity = eccentricity;
        this.semiMajorAxis = semiMajorAxis;
        this.semiMinorAxis = semiMinorAxis;
        this.meanAnomalyAtEpoch = eccentricAnomaly - eccentricity * Math.sin(eccentricAnomaly);
        this.meanMotion = Math.sqrt(mu * inverseSemiMajorAxis ** 3);
        this.frozen = false;
    }

    /**
     * Where this contributor is a given time from now, relative to the root body
     * @param {number} time - Time from the present, in the scene's own time units
     * @param {THREE.Vector3} target - Vector to write the position into
     * @returns {THREE.Vector3} The position written
     */
    positionAt(time, target) {
        if (this.frozen) return target.copy(this.offset);

        const meanAnomaly = this.meanAnomalyAtEpoch + this.meanMotion * time;
        const eccentricAnomaly = solveKeplerEquation(meanAnomaly, this.eccentricity);

        return target.copy(this.periapsisAxis)
            .multiplyScalar(this.semiMajorAxis * (Math.cos(eccentricAnomaly) - this.eccentricity))
            .addScaledVector(this.inPlaneAxis, this.semiMinorAxis * Math.sin(eccentricAnomaly));
    }
}


/**
 * The path the root body traces about the centre of mass of the whole system.
 *
 * Every other line in the scene is a conic, because a body and the one it orbits both run round the
 * centre of mass between them on ellipses that close. The root body's path does not close: it
 * answers to every planet at once, and what it traces is the sum of the loops each of them gives
 * it - a loop per turn of Jupiter, widening as Saturn, Uranus and Neptune come round to the same
 * side and shrinking back to nothing when they stand against it. The Sun's own centre is 1.07 solar
 * radii from its centre of mass with Jupiter alone, but the point it really goes round wanders
 * between its centre and 2.17 radii out, so no single ellipse can stand for it.
 *
 * So this line is sampled rather than solved. Each planet, taken with its moons as one mass at
 * their common centre, is put on the ellipse it is on now and run forward and back over the drawn
 * window; the root body's offset from the centre of mass at each moment is the mass-weighted sum of
 * where they all are, and the samples are joined up. The line is stored relative to the centre of
 * mass and placed at it, so the sample belonging to the present sits exactly on the root body and
 * the body travels along the path as time runs - by the body moving under n-body physics, and by
 * the centre of mass moving under Kepler motion, which nails the root body to the origin instead.
 *
 * What it leaves out is the planets pulling on each other: each is drawn along the orbit it is on
 * at this moment, the same osculating conic every other line in the scene shows, so the drawn
 * window is a prediction rather than a record. Sixty years of it is well inside where that
 * distinction shows up at this scale.
 *
 * It stands in for the root body's orbit, which is otherwise a stub that draws nothing, so the
 * per-frame update and the visibility rules reach it the same way they reach any other orbit.
 */
class BarycentrePath {
    /**
     * @param {Object} body - The root body of the system
     * @param {number} sceneScale - Scene scale factor
     */
    constructor(body, sceneScale) {
        this.body = body;
        this.sceneScale = sceneScale;

        // Kept for the sake of everything that expects a body to have an orbit: the root body has
        // no orbital elements of its own, and nothing it is drawn about
        this.parentBody = null;
        this.semiMajorAxis = 0;
        this.eccentricity = 0;
        this.orbitalPeriod = 0;

        // Lengths are held in scene units while the gravitational parameter stays in AU and years,
        // as everywhere else in the simulation, which leaves the time unit that pair implies: one
        // unit is the year divided by the AU scale to the power of three halves, about a hundredth
        // of a year. The drawn window is quoted in years, so it is converted once here.
        this.timeUnitsPerYear = getAUScale(sceneScale) ** 1.5;

        // Contributors are pooled rather than rebuilt, since the path is re-sampled often and the
        // set of bodies orbiting the root rarely changes
        this.contributors = [];
        this.contributorCount = 0;

        // The samples of the path, in double precision and measured from the centre of mass, and
        // the segment buffer the shader reads them out of. Both are allocated for the largest
        // segment count so that changing level of detail rewrites them in place.
        const maxPoints = BARYCENTRE.MAX_SEGMENTS + 1;
        this.pathPoints = new Float64Array(maxPoints * 3);
        this.pathPointCount = 0;
        this.segmentPositions = new Float32Array((maxPoints - 1) * 6);
        this.currentSegments = BARYCENTRE.MIN_SEGMENTS;

        // How large the drawn path came out: the furthest it strays from the centre of mass, and
        // its length along the curve. The first sets how far the body may travel before the window
        // is re-centred on it, the second how many segments it deserves.
        this.amplitude = 0;
        this.pathLength = 0;

        // Where the centre of mass is now, in world space, and how far the root body stands from
        // it - both now and at the moment the path was last sampled
        this.barycentre = new THREE.Vector3();
        this.offset = new THREE.Vector3();
        this.anchorOffset = new THREE.Vector3();

        const material = new LineMaterial({
            color: body.markerColor || body.material?.color,
            linewidth: 2,
            resolution: new THREE.Vector2(window.innerWidth, window.innerHeight),
            transparent: true,
            opacity: 0.8,
            depthWrite: false,
            depthTest: true
        });

        const geometry = new LineSegmentsGeometry();
        geometry.setPositions(this.segmentPositions);
        this.positionBuffer = geometry.attributes.instanceStart.data;
        geometry.instanceCount = 0;

        this.orbitLine = new LineSegments2(geometry, material);
        this.orbitLine.renderOrder = -100;
        this.orbitLine.material.userData = { renderBehindMarkers: true };
        SceneManager.scene.add(this.orbitLine);
        SceneManager.registerLineMaterial(material);

        // Nothing is sampled here: the bodies whose orbits the path is made of have not been
        // placed yet when the root body builds this, so the first pass over it does the work
        this.isVisible = true;

        log.debug('BarycentrePath', `Drawing ${body.name}'s path about the system's centre of mass`);
    }

    /**
     * Find the centre of mass of the whole system and how far the root body stands from it, from
     * the live state of every body in it - so a mass dropped into the system, or one taken back
     * out again, moves the point the path is drawn about on the same frame.
     * @private
     */
    #updateBarycentre() {
        systemState(this.body, this.barycentre);
        this.offset.subVectors(this.body.group.position, this.barycentre);
    }

    /**
     * Put the line at the centre of mass its samples are measured from
     * @private
     */
    #placeLine() {
        _linePosition.copy(this.barycentre);

        const parent = this.orbitLine.parent;
        if (parent) parent.worldToLocal(_linePosition);

        this.orbitLine.position.copy(_linePosition);
    }

    /**
     * Gather what the root body is answering to: everything orbiting it, each taken with its own
     * satellites as a single mass at their common centre, on the orbit that centre is on now.
     * @returns {number} How many contributors were found
     * @private
     */
    #readContributors() {
        const root = this.body;
        const children = root.children || [];
        const totalMass = systemMass(root);

        if (root.velocity) {
            _rootVelocity.copy(root.velocity);
        } else {
            _rootVelocity.set(0, 0, 0);
        }

        let count = 0;
        for (let i = 0; i < children.length; i++) {
            const child = children[i].body;
            const mass = systemMass(child);
            if (!(mass > 0) || !(totalMass > 0)) continue;

            systemState(child, _position, _velocity);
            _position.sub(root.group.position);
            _velocity.sub(_rootVelocity);

            let contributor = this.contributors[count];
            if (!contributor) {
                contributor = new Contributor();
                this.contributors[count] = contributor;
            }

            // The root body's offset from the centre of mass is what this body's share of the
            // separation leaves, so it moves against the body and by this fraction of it
            contributor.weight = mass / totalMass;
            contributor.read(_position, _velocity, calculateGM(root, mass));
            count++;
        }

        this.contributorCount = count;
        return count;
    }

    /**
     * Sample the path into the point buffer, centred on the present.
     *
     * The window is split evenly either side of now so that the body sits in the middle of what is
     * drawn, with an odd number of samples putting one exactly on the present moment - which is
     * what makes the line pass through the body rather than merely near it.
     *
     * @param {number} segments - Number of segments to sample the path with
     * @private
     */
    #buildPath(segments) {
        // Even, so that the middle sample belongs to the present
        const steps = Math.max(2, 2 * Math.round(
            Math.min(Math.max(segments, BARYCENTRE.MIN_SEGMENTS), BARYCENTRE.MAX_SEGMENTS) / 2));
        const anchorIndex = steps / 2;

        const contributors = this.contributors;
        const count = this.#readContributors();
        const points = this.pathPoints;
        const step = BARYCENTRE.PATH_YEARS * this.timeUnitsPerYear / steps;

        let amplitude = 0;
        let length = 0;

        for (let i = 0; i <= steps; i++) {
            const time = (i - anchorIndex) * step;

            _offsetSum.set(0, 0, 0);
            for (let j = 0; j < count; j++) {
                const contributor = contributors[j];
                contributor.positionAt(time, _sample);
                _offsetSum.addScaledVector(_sample, -contributor.weight);
            }

            const offset = i * 3;
            if (i > 0) {
                length += Math.hypot(_offsetSum.x - points[offset - 3],
                    _offsetSum.y - points[offset - 2], _offsetSum.z - points[offset - 1]);
            }

            points[offset] = _offsetSum.x;
            points[offset + 1] = _offsetSum.y;
            points[offset + 2] = _offsetSum.z;

            const distance = _offsetSum.lengthSq();
            if (distance > amplitude) amplitude = distance;
        }

        this.pathPointCount = steps + 1;
        this.currentSegments = steps;
        this.amplitude = Math.sqrt(amplitude);
        this.pathLength = length;

        // Where the body was when this was sampled, so that how far it has since travelled along
        // the path can be measured without re-reading it
        const anchor = anchorIndex * 3;
        this.anchorOffset.set(points[anchor], points[anchor + 1], points[anchor + 2]);
    }

    /**
     * Rewrite the GPU segment buffer from the sampled path.
     *
     * The samples are already measured from the centre of mass, which the line is placed at, so
     * unlike an orbit line they need no origin subtracted from them: the whole path spans a couple
     * of the root body's radii, which float32 carries with room to spare.
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

        let minX = Infinity, minY = Infinity, minZ = Infinity;
        let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

        for (let i = 0; i < count - 1; i++) {
            const start = i * 3;
            const end = start + 3;
            const offset = i * 6;

            const x = points[start];
            const y = points[start + 1];
            const z = points[start + 2];

            positions[offset] = x;
            positions[offset + 1] = y;
            positions[offset + 2] = z;
            positions[offset + 3] = points[end];
            positions[offset + 4] = points[end + 1];
            positions[offset + 5] = points[end + 2];

            if (x < minX) minX = x;
            if (y < minY) minY = y;
            if (z < minZ) minZ = z;
            if (x > maxX) maxX = x;
            if (y > maxY) maxY = y;
            if (z > maxZ) maxZ = z;
        }

        // The path is open, so its last point is the one place the loop above does not reach
        const last = (count - 1) * 3;
        minX = Math.min(minX, points[last]);
        minY = Math.min(minY, points[last + 1]);
        minZ = Math.min(minZ, points[last + 2]);
        maxX = Math.max(maxX, points[last]);
        maxY = Math.max(maxY, points[last + 1]);
        maxZ = Math.max(maxZ, points[last + 2]);

        this.orbitLine.geometry.instanceCount = count - 1;
        this.positionBuffer.needsUpdate = true;

        const geometry = this.orbitLine.geometry;
        if (!geometry.boundingSphere) {
            geometry.boundingSphere = new THREE.Sphere();
        }
        MathUtils.setSphereFromBox(geometry.boundingSphere, minX, minY, minZ, maxX, maxY, maxZ);
    }

    /**
     * The world size of one screen pixel at the centre of mass, which turns both the segment count
     * and the re-sampling threshold into decisions about what can actually be seen
     * @param {THREE.Vector3} cameraPosition - Current camera position
     * @returns {number} Scene units per pixel
     * @private
     */
    #unitsPerPixel(cameraPosition) {
        const camera = SceneManager.camera;
        const viewportHeight = SceneManager.renderer.domElement.height || window.innerHeight;
        const distance = Math.max(cameraPosition.distanceTo(this.barycentre), 1e-9);

        return 2 * distance * Math.tan(camera.fov * PI_OVER_180 / 2) / viewportHeight;
    }

    /**
     * Update the path and where it is drawn
     * @param {THREE.Vector3} cameraPosition - Current camera position
     */
    updateLOD(cameraPosition) {
        if (!this.orbitLine) return;

        // The centre of mass moves whether or not the path itself needs re-sampling: under Kepler
        // motion it is the only thing that does move, the root body being held at the origin
        this.#updateBarycentre();
        this.#placeLine();

        if (!this.isVisible) return;

        let needsRebuild = this.pathPointCount === 0;

        if (!needsRebuild) {
            const unitsPerPixel = this.#unitsPerPixel(cameraPosition);

            // Nothing about the path can be seen at all below a pixel or two across, and
            // re-sampling it is the most expensive thing here
            if (this.amplitude / unitsPerPixel >= BARYCENTRE.MIN_PIXEL_RADIUS) {
                if (this.offset.distanceTo(this.anchorOffset)
                    > this.amplitude * BARYCENTRE.RECENTRE_FRACTION) {
                    needsRebuild = true;
                } else {
                    // One segment per few pixels of the path's own length, which for a path made
                    // of several loops is a good deal more than its width would suggest
                    const wanted = Math.round(this.pathLength / unitsPerPixel
                        / BARYCENTRE.TARGET_SEGMENT_PIXELS);
                    const segments = Math.min(Math.max(wanted, BARYCENTRE.MIN_SEGMENTS),
                        BARYCENTRE.MAX_SEGMENTS);

                    if (Math.abs(segments - this.currentSegments)
                        >= Math.max(8, this.currentSegments * BARYCENTRE.REBUILD_RATIO)) {
                        this.currentSegments = segments;
                        needsRebuild = true;
                    }
                }
            }
        }

        if (needsRebuild) {
            this.#buildPath(this.currentSegments);
            this.#writeSegments();
        }
    }

    /**
     * Where the root body sits: at the centre of mass of its system under Kepler motion, which
     * holds it still, and wherever the integrator has put it otherwise
     * @returns {THREE.Vector3} The body's position
     */
    calculatePosition() {
        return this.body.group.position.clone();
    }

    /**
     * Show the path
     */
    show() {
        this.isVisible = true;
        if (this.orbitLine) this.orbitLine.visible = true;
    }

    /**
     * Hide the path
     */
    hide() {
        this.isVisible = false;
        if (this.orbitLine) this.orbitLine.visible = false;
    }

    /**
     * Get visibility state of the path
     * @returns {boolean} True if visible, false if hidden
     */
    getVisibility() {
        return this.isVisible && !!this.orbitLine?.visible;
    }

    /**
     * Clean up the path's resources
     */
    dispose() {
        SceneManager.unregisterOrbit(this);

        if (this.orbitLine) {
            if (this.orbitLine.parent) this.orbitLine.parent.remove(this.orbitLine);
            this.orbitLine.geometry.dispose();
            SceneManager.unregisterLineMaterial(this.orbitLine.material);
            this.orbitLine.material.dispose();
            this.orbitLine = null;
        }

        this.contributors.length = 0;
        this.contributorCount = 0;
        this.body = null;
    }
}

export default BarycentrePath;
