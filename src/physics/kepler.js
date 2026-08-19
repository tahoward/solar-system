import * as THREE from 'three';
import { ORBIT, MATH } from '../constants.js';
import { log } from '../utils/Logger.js';

let auScale = null;
const DEFAULT_SCENE_SCALE = 0.1;
const PI_OVER_180 = MATH.PI_OVER_180;

const _scratchPosition = new THREE.Vector3();
const _scratchVelocity = new THREE.Vector3();
const _zeroVector = new THREE.Vector3(0, 0, 0);
const _scratchTransformOptions = { applyTilt: false, axialTilt: 0, tiltMatrix: null };
const _scratchParent = { position: null, velocity: null };

/**
 * Standard gravitational parameter of a one-solar-mass body, 4π².
 *
 * This is `G` expressed in AU³ yr⁻² M☉⁻¹, so with semi-major axes in AU and
 * masses in solar masses, mean motion comes out in radians per year and the
 * `t` accepted by this module is in years.
 *
 * @type {number}
 */
const GM = 4 * Math.PI ** 2;

/**
 * Computes the gravitational parameter governing an orbit.
 *
 * The companion's own mass is included because a two-body orbit is governed by
 * the total mass of the pair, which matters for the larger moons.
 *
 * @param {Body|{mass: number}|null} parentBody - Central body; a missing or
 *   massless parent is treated as one solar mass.
 * @param {number} [companionMass=0] - Mass of the orbiting body, in solar masses.
 * @returns {number} μ in AU³ yr⁻².
 */
export function calculateGM(parentBody, companionMass = 0) {
    const centralMass = parentBody && parentBody.mass ? parentBody.mass : 1;

    return GM * (centralMass + companionMass);
}

/**
 * Derives mean motion and period from an orbit's size, via Kepler's third law.
 *
 * @param {number} semiMajorAxis - Semi-major axis, in AU.
 * @param {Body|{mass: number}|null} parentBody - Central body.
 * @param {number} [companionMass=0] - Mass of the orbiting body, in solar masses.
 * @returns {{meanMotion: number, orbitalPeriod: number}} Mean motion in radians
 *   per year and the period in years.
 */
export function calculateOrbitalMotion(semiMajorAxis, parentBody, companionMass = 0) {
    const centralBodyGM = calculateGM(parentBody, companionMass);
    const meanMotion = Math.sqrt(centralBodyGM / Math.pow(semiMajorAxis, 3));
    const orbitalPeriod = MATH.TWO_PI / meanMotion;

    return { meanMotion, orbitalPeriod };
}

/**
 * Solves Kepler's equation `M = E - e·sin(E)` for the eccentric anomaly.
 *
 * The equation has no closed-form solution, so it is inverted by Newton-Raphson
 * iteration seeded with `E = M`. That seed converges within a few iterations at
 * the modest eccentricities used here, and the loop exits early once the step
 * falls under `ORBIT.KEPLER_EQUATION_TOLERANCE`.
 *
 * @param {number} meanAnomaly - Mean anomaly `M`, in radians.
 * @param {number} eccentricity - Orbital eccentricity, expected below 1.
 * @returns {number} Eccentric anomaly `E`, in radians.
 */
export function solveKeplerEquation(meanAnomaly, eccentricity) {
    let eccentricAnomaly = meanAnomaly;

    for (let i = 0; i < ORBIT.KEPLER_EQUATION_ITERATIONS; i++) {
        const residual = eccentricAnomaly - eccentricity * Math.sin(eccentricAnomaly) - meanAnomaly;
        const derivative = 1 - eccentricity * Math.cos(eccentricAnomaly);
        const step = residual / derivative;

        eccentricAnomaly -= step;

        if (Math.abs(step) < ORBIT.KEPLER_EQUATION_TOLERANCE) break;
    }

    return eccentricAnomaly;
}

/**
 * Evaluates an orbit's position at time `t` from its orbital elements.
 *
 * Advances the mean anomaly, solves for the eccentric and true anomalies, finds
 * the radius, then rotates the in-plane position into the reference frame by the
 * ascending node, inclination and argument of periapsis. The result is converted
 * from AU to scene units and returned in the renderer's axis convention, where
 * the orbital plane's normal is +y (hence the `(x, z, -y)` swizzle).
 *
 * @param {{semiMajorAxis: number, eccentricity: number, inclinationRadians: number,
 *   longitudeOfAscendingNodeRadians: number, argumentOfPeriapsisRadians: number,
 *   meanAnomalyAtEpochRadians: number, meanMotion: number}} orbitalElements -
 *   Orbital elements; `semiMajorAxis` in AU, angles in radians.
 * @param {number} t - Time since epoch, in years.
 * @param {THREE.Vector3} [target] - Vector to write into; a new one is allocated
 *   if omitted.
 * @returns {THREE.Vector3} Position relative to the central body, in scene units.
 */
function calculateKeplerianPosition(t, orbitalElements, target) {
    const {
        semiMajorAxis,
        eccentricity,
        inclinationRadians,
        longitudeOfAscendingNodeRadians,
        argumentOfPeriapsisRadians,
        meanAnomalyAtEpochRadians,
        meanMotion
    } = orbitalElements;

    const meanAnomaly = meanAnomalyAtEpochRadians + meanMotion * t;
    const eccentricAnomaly = solveKeplerEquation(meanAnomaly, eccentricity);

    const tanNuOver2 = Math.sqrt((1 + eccentricity) / (1 - eccentricity)) * Math.tan(eccentricAnomaly / MATH.TWO);
    const trueAnomaly = MATH.TWO * Math.atan(tanNuOver2);

    const r_AU = semiMajorAxis * (1 - eccentricity * Math.cos(eccentricAnomaly));
    const r = r_AU * getAUScale();

    const xOrb = r * Math.cos(trueAnomaly);
    const yOrb = r * Math.sin(trueAnomaly);

    const cosOmega = Math.cos(longitudeOfAscendingNodeRadians);
    const sinOmega = Math.sin(longitudeOfAscendingNodeRadians);
    const cosInc = Math.cos(inclinationRadians);
    const sinInc = Math.sin(inclinationRadians);
    const cosW = Math.cos(argumentOfPeriapsisRadians);
    const sinW = Math.sin(argumentOfPeriapsisRadians);

    const x = (cosOmega * cosW - sinOmega * sinW * cosInc) * xOrb +
             (-cosOmega * sinW - sinOmega * cosW * cosInc) * yOrb;
    const y = (sinOmega * cosW + cosOmega * sinW * cosInc) * xOrb +
             (-sinOmega * sinW + cosOmega * cosW * cosInc) * yOrb;
    const z = (sinW * sinInc) * xOrb + (cosW * sinInc) * yOrb;

    return target ? target.set(x, z, -y) : new THREE.Vector3(x, z, -y);
}

/**
 * Builds the orbit plane's basis vectors, in scene axes.
 *
 * Returns the same rotation used by {@link calculateKeplerianPosition} in a
 * reusable form, so orbit lines can be generated by sweeping the two axes
 * instead of re-solving Kepler's equation per vertex.
 *
 * @param {{inclinationRadians: number, longitudeOfAscendingNodeRadians: number,
 *   argumentOfPeriapsisRadians: number}} orbitalElements - Orientation angles,
 *   in radians.
 * @param {THREE.Vector3} periapsisAxis - Receives the unit vector towards
 *   periapsis; mutated.
 * @param {THREE.Vector3} inPlaneAxis - Receives the in-plane unit vector
 *   perpendicular to it, in the direction of motion; mutated.
 * @returns {void}
 */
export function computePerifocalBasis(orbitalElements, periapsisAxis, inPlaneAxis) {
    const {
        inclinationRadians,
        longitudeOfAscendingNodeRadians,
        argumentOfPeriapsisRadians
    } = orbitalElements;

    const cosOmega = Math.cos(longitudeOfAscendingNodeRadians);
    const sinOmega = Math.sin(longitudeOfAscendingNodeRadians);
    const cosInc = Math.cos(inclinationRadians);
    const sinInc = Math.sin(inclinationRadians);
    const cosW = Math.cos(argumentOfPeriapsisRadians);
    const sinW = Math.sin(argumentOfPeriapsisRadians);

    periapsisAxis.set(
        cosOmega * cosW - sinOmega * sinW * cosInc,
        sinW * sinInc,
        -(sinOmega * cosW + cosOmega * sinW * cosInc)
    );
    inPlaneAxis.set(
        -cosOmega * sinW - sinOmega * cosW * cosInc,
        cosW * sinInc,
        -(-sinOmega * sinW + cosOmega * cosW * cosInc)
    );
}

/**
 * Gets — and optionally sets — the AU-to-scene-unit conversion factor.
 *
 * The factor is module state so the per-vertex maths above does not have to
 * thread it through every call. Passing `sceneScale` recomputes and latches it;
 * omitting it returns the current value, falling back to the default scale on
 * first use.
 *
 * @param {number} [sceneScale] - Scene scale to latch, normally `SCENE.SCALE`.
 * @returns {number} Scene units per AU.
 */
export function getAUScale(sceneScale) {
    if (sceneScale !== undefined) {
        auScale = ORBIT.AU_SCALE_METERS * sceneScale;
    } else if (auScale === null) {
        auScale = ORBIT.AU_SCALE_METERS * DEFAULT_SCENE_SCALE;
    }
    return auScale;
}

/**
 * Evaluates an orbit's velocity at time `t` from its orbital elements.
 *
 * Mirrors {@link calculateKeplerianPosition}: the in-plane velocity is obtained
 * from the vis-viva relation via the semi-latus rectum, then rotated into the
 * reference frame and swizzled into scene axes.
 *
 * Note that `mu` must be expressed in scene units, since the semi-major axis is
 * scaled before use — this feeds the n-body integrator, which carries positions
 * in scene units.
 *
 * @param {{semiMajorAxis: number, eccentricity: number, inclinationRadians: number,
 *   longitudeOfAscendingNodeRadians: number, argumentOfPeriapsisRadians: number,
 *   meanAnomalyAtEpochRadians: number, meanMotion: number}} orbitalElements -
 *   Orbital elements; `semiMajorAxis` in AU, angles in radians.
 * @param {number} t - Time since epoch, in years.
 * @param {number} [mu=39.478] - Gravitational parameter of the system.
 * @param {THREE.Vector3} [target] - Vector to write into; a new one is allocated
 *   if omitted.
 * @returns {THREE.Vector3} Velocity relative to the central body, in scene units
 *   per time unit.
 */
function calculateKeplerianVelocity(t, orbitalElements, mu = 39.478, target) {
    const {
        semiMajorAxis,
        eccentricity,
        inclinationRadians,
        longitudeOfAscendingNodeRadians,
        argumentOfPeriapsisRadians,
        meanAnomalyAtEpochRadians,
        meanMotion
    } = orbitalElements;

    const meanAnomaly = meanAnomalyAtEpochRadians + meanMotion * t;
    const eccentricAnomaly = solveKeplerEquation(meanAnomaly, eccentricity);
    const tanNuOver2 = Math.sqrt((1 + eccentricity) / (1 - eccentricity)) * Math.tan(eccentricAnomaly / MATH.TWO);
    const trueAnomaly = MATH.TWO * Math.atan(tanNuOver2);

    const auScale = getAUScale();
    const scaledA = semiMajorAxis * auScale;

    const semiLatusRectum = scaledA * (1 - eccentricity * eccentricity);
    const velocityScale = Math.sqrt(mu / semiLatusRectum);
    const vxOrb = -velocityScale * Math.sin(trueAnomaly);
    const vyOrb = velocityScale * (eccentricity + Math.cos(trueAnomaly));

    const cosOmega = Math.cos(longitudeOfAscendingNodeRadians);
    const sinOmega = Math.sin(longitudeOfAscendingNodeRadians);
    const cosInc = Math.cos(inclinationRadians);
    const sinInc = Math.sin(inclinationRadians);
    const cosW = Math.cos(argumentOfPeriapsisRadians);
    const sinW = Math.sin(argumentOfPeriapsisRadians);

    const vxAstro = (cosOmega * cosW - sinOmega * sinW * cosInc) * vxOrb +
                   (-cosOmega * sinW - sinOmega * cosW * cosInc) * vyOrb;
    const vyAstro = (sinOmega * cosW + cosOmega * sinW * cosInc) * vxOrb +
                   (-sinOmega * sinW + cosOmega * cosW * cosInc) * vyOrb;
    const vzAstro = (sinW * sinInc) * vxOrb + (cosW * sinInc) * vyOrb;

    const finalVx = vxAstro;
    const finalVy = vzAstro;
    const finalVz = -vyAstro;

    return target ? target.set(finalVx, finalVy, finalVz) : new THREE.Vector3(finalVx, finalVy, finalVz);
}

/**
 * Evaluates an orbital position, then applies axial tilt and the parent's offset.
 *
 * Moons on equatorial orbits are defined relative to their planet's equator
 * rather than the ecliptic, so their position is rotated by the planet's axial
 * tilt before being translated into the parent's frame.
 *
 * @param {number} t - Time since epoch, in years.
 * @param {Object} orbitalElements - Orbital elements, as for
 *   {@link calculateKeplerianPosition}.
 * @param {{position: THREE.Vector3}|null} [parentBody=null] - Parent whose
 *   position the result is offset by; omit for a position relative to the parent.
 * @param {{applyTilt?: boolean, axialTilt?: number, tiltMatrix?: THREE.Matrix4}} [options={}]
 *   Tilt settings. `axialTilt` is in degrees and only used when `tiltMatrix` is
 *   absent; supplying a cached `tiltMatrix` avoids rebuilding it each frame.
 * @param {THREE.Vector3} [target] - Vector to write into; a new one is allocated
 *   if omitted.
 * @returns {THREE.Vector3} Position in scene units.
 */
export function calculateKeplerianPositionWithTransforms(t, orbitalElements, parentBody = null, options = {}, target) {
    const finalPosition = calculateKeplerianPosition(t, orbitalElements, target);

    if (options.applyTilt && options.axialTilt !== undefined && options.axialTilt !== 0) {
        if (options.tiltMatrix) {
            finalPosition.applyMatrix4(options.tiltMatrix);
        } else {
            const tiltMatrix = new THREE.Matrix4();
            tiltMatrix.makeRotationZ(options.axialTilt * Math.PI / 180);
            finalPosition.applyMatrix4(tiltMatrix);
        }
    }

    if (parentBody && parentBody.position) {
        finalPosition.add(parentBody.position);
    }

    return finalPosition;
}

/**
 * Evaluates an orbital velocity, then applies axial tilt and the parent's velocity.
 *
 * The velocity counterpart of
 * {@link calculateKeplerianPositionWithTransforms}, so that a moon's velocity
 * ends up in the same frame as its position.
 *
 * @param {number} t - Time since epoch, in years.
 * @param {Object} orbitalElements - Orbital elements, as for
 *   {@link calculateKeplerianVelocity}.
 * @param {number} mu - Gravitational parameter of the system, in scene units.
 * @param {{velocity: THREE.Vector3}|null} [parentBody=null] - Parent whose
 *   velocity the result is added to.
 * @param {{applyTilt?: boolean, axialTilt?: number, tiltMatrix?: THREE.Matrix4}} [options={}]
 *   Tilt settings, as above.
 * @param {THREE.Vector3} [target] - Vector to write into; a new one is allocated
 *   if omitted.
 * @returns {THREE.Vector3} Velocity in scene units per time unit.
 */
export function calculateKeplerianVelocityWithTransforms(t, orbitalElements, mu, parentBody = null, options = {}, target) {
    const finalVelocity = calculateKeplerianVelocity(t, orbitalElements, mu, target);

    if (options.applyTilt && options.axialTilt !== undefined && options.axialTilt !== 0) {
        if (options.tiltMatrix) {
            finalVelocity.applyMatrix4(options.tiltMatrix);
        } else {
            const tiltMatrix = new THREE.Matrix4();
            tiltMatrix.makeRotationZ(options.axialTilt * Math.PI / 180);
            finalVelocity.applyMatrix4(tiltMatrix);
        }
    }

    if (parentBody && parentBody.velocity) {
        finalVelocity.add(parentBody.velocity);
    }

    return finalVelocity;
}

/**
 * Places every body in the hierarchy at its analytic position for a given time.
 *
 * This is the Kepler physics mode's per-frame entry point. Unlike the n-body
 * integrator it evaluates each orbit directly from its elements, so positions
 * never drift and time can be scrubbed freely — at the cost of ignoring mutual
 * perturbations. The root body is pinned at the origin with zero velocity.
 *
 * @param {{body: ?Body, children: ?Array<Object>}} hierarchy - Root of the body tree.
 * @param {number} timestamp - Simulation time since epoch, in years.
 * @param {number} [sceneScale=0.1] - Scene scale used to latch the AU conversion.
 * @returns {void}
 */
export function updateHierarchyPositions(hierarchy, timestamp, sceneScale = DEFAULT_SCENE_SCALE) {
    auScale = ORBIT.AU_SCALE_METERS * sceneScale;

    if (hierarchy.body) {
        hierarchy.body.updatePosition(_zeroVector);
        if (hierarchy.body.velocity) hierarchy.body.velocity.set(0, 0, 0);
    }

    if (hierarchy.children) {
        updateChildrenPositions(hierarchy, hierarchy.body, timestamp);
    }
}

/**
 * Recursively positions a node's children and their descendants.
 *
 * Each child is evaluated in its parent's frame, so a moon's position follows
 * from its planet's — which requires the parent to have been placed first.
 * Scratch objects are reused rather than allocated, since this runs for every
 * body every frame. Errors are caught per body so one bad orbit cannot stop the
 * rest of the tree from updating.
 *
 * @param {{children: ?Array<{body: Body, orbit: Orbit}>}} parent - Node whose
 *   children are updated.
 * @param {Body|null} parentBody - The parent's body, supplying the frame of
 *   reference and central mass.
 * @param {number} timestamp - Simulation time since epoch, in years.
 * @returns {void}
 */
function updateChildrenPositions(parent, parentBody, timestamp) {
    if (!parent.children) return;

    for (let i = 0; i < parent.children.length; i++) {
        const child = parent.children[i];
        if (!child.body || !child.orbit) continue;

        try {
            const orbit = child.orbit;
            const orbitalElements = orbit.elements;

            const mu = calculateGM(parentBody, child.body.mass);

            _scratchTransformOptions.applyTilt = !!(parentBody && parentBody.tiltContainer && child.body.equatorialOrbit);
            _scratchTransformOptions.axialTilt = parentBody?.axialTilt || 0;
            _scratchTransformOptions.tiltMatrix = orbit.tiltMatrix || null;

            let parentForTransform = null;
            if (parentBody) {
                _scratchParent.position = parentBody.group.position;
                _scratchParent.velocity = parentBody.velocity || _zeroVector;
                parentForTransform = _scratchParent;
            }

            const finalPosition = calculateKeplerianPositionWithTransforms(
                timestamp, orbitalElements, parentForTransform, _scratchTransformOptions, _scratchPosition);
            const finalVelocity = calculateKeplerianVelocityWithTransforms(
                timestamp, orbitalElements, mu, parentForTransform, _scratchTransformOptions, _scratchVelocity);

            child.body.updatePosition(finalPosition);
            child.body.velocity.copy(finalVelocity);

            if (child.body.updateOrbitTrail) {
                child.body.updateOrbitTrail();
            }

            updateChildrenPositions(child, child.body, timestamp);

        } catch (error) {
            log.error('Kepler', `Error updating position for ${child.body?.name || 'unknown'}`, error);
        }
    }
}