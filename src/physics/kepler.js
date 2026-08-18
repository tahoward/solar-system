import * as THREE from 'three';
import { ORBIT, MATH } from '../constants.js';
import { log } from '../utils/Logger.js';

// Physics constants - we'll get the scale dynamically to avoid circular imports
let auScale = null;
const DEFAULT_SCENE_SCALE = 0.1;
const PI_OVER_180 = MATH.PI_OVER_180;

// Scratch values reused every frame so hierarchy updates allocate nothing
const _scratchPosition = new THREE.Vector3();
const _scratchVelocity = new THREE.Vector3();
const _zeroVector = new THREE.Vector3(0, 0, 0);
const _scratchTransformOptions = { applyTilt: false, axialTilt: 0, tiltMatrix: null };
const _scratchParent = { position: null, velocity: null };
// Use same astronomical units as n-body: G * M_sun in AU³ M_sun⁻¹ year⁻²
const GM = 4 * Math.PI ** 2; // Standard GM in astronomical units (AU³/year²)

/**
 * Calculates the gravitational parameter (GM) for a given central body
 *
 * The relative orbit of two bodies is governed by the total mass of the pair, not the central
 * body's alone, so a companion heavy enough to matter passes its mass in. Left out, Charon's
 * orbit came out 5.6% slower than it should be - the pair is only eight parts in a hundred short
 * of a double planet - while for the Moon it is worth 0.6% and for everything else nothing.
 *
 * @param {Object} parentBody - The central body (null for Sun)
 * @param {number} [companionMass] - Mass of the orbiting body, when it is not negligible
 * @returns {number} GM value in AU³/year²
 */
export function calculateGM(parentBody, companionMass = 0) {
    // For satellites (like Moon), use parent body's mass (Earth, Jupiter, etc.); for planets
    // orbiting the Sun, the standard solar GM, the Sun being one solar mass by definition
    const centralMass = parentBody && parentBody.mass ? parentBody.mass : 1;

    return GM * (centralMass + companionMass);
}

/**
 * Calculates orbital period and mean motion from semi-major axis and central body mass
 * @param {number} semiMajorAxis - Semi-major axis in AU
 * @param {Object} parentBody - The central body (null for Sun)
 * @param {number} [companionMass] - Mass of the orbiting body, when it is not negligible
 * @returns {Object} Object containing meanMotion (radians/year) and orbitalPeriod (years)
 */
export function calculateOrbitalMotion(semiMajorAxis, parentBody, companionMass = 0) {
    const centralBodyGM = calculateGM(parentBody, companionMass);
    const meanMotion = Math.sqrt(centralBodyGM / Math.pow(semiMajorAxis, 3)); // Mean motion in radians/year
    const orbitalPeriod = MATH.TWO_PI / meanMotion; // Period in years

    return { meanMotion, orbitalPeriod };
}

/**
 * Solves Kepler's equation (M = E - e*sin(E)) for the eccentric anomaly.
 *
 * Uses Newton-Raphson, which converges quadratically and so needs 2-3 iterations
 * where fixed-point iteration needs dozens - and unlike fixed-point iteration it
 * stays accurate at high eccentricity.
 *
 * @param {number} meanAnomaly - Mean anomaly in radians
 * @param {number} eccentricity - Orbital eccentricity
 * @returns {number} Eccentric anomaly in radians
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
 * Calculates the 3D position of a body at a given time using Keplerian orbital mechanics
 * @param {number} t - Time parameter in seconds
 * @param {Object} orbitalElements - Object containing orbital elements
 * @param {number} orbitalElements.semiMajorAxis - Semi-major axis in AU
 * @param {number} orbitalElements.eccentricity - Orbital eccentricity
 * @param {number} orbitalElements.inclinationRadians - Inclination in radians
 * @param {number} orbitalElements.longitudeOfAscendingNodeRadians - Longitude of ascending node in radians
 * @param {number} orbitalElements.argumentOfPeriapsisRadians - Argument of periapsis in radians
 * @param {number} orbitalElements.meanAnomalyAtEpochRadians - Mean anomaly at epoch in radians
 * @param {number} orbitalElements.meanMotion - Mean motion in radians/year
 * @param {THREE.Vector3} [target] - Optional vector to write into, avoiding an allocation
 * @returns {THREE.Vector3} The calculated position vector
 */
export function calculateKeplerianPosition(t, orbitalElements, target) {
    const {
        semiMajorAxis,
        eccentricity,
        inclinationRadians,
        longitudeOfAscendingNodeRadians,
        argumentOfPeriapsisRadians,
        meanAnomalyAtEpochRadians,
        meanMotion
    } = orbitalElements;

    // Use mean anomaly at epoch (M0) as the starting point
    const meanAnomaly = meanAnomalyAtEpochRadians + meanMotion * t;
    const eccentricAnomaly = solveKeplerEquation(meanAnomaly, eccentricity);

    // Convert to true anomaly
    const tanNuOver2 = Math.sqrt((1 + eccentricity) / (1 - eccentricity)) * Math.tan(eccentricAnomaly / MATH.TWO);
    const trueAnomaly = MATH.TWO * Math.atan(tanNuOver2);

    // Calculate radial distance in AU
    const r_AU = semiMajorAxis * (1 - eccentricity * Math.cos(eccentricAnomaly));
    const r = r_AU * getAUScale(); // Convert to visual scale

    // Position in orbital plane (before applying argument of periapsis)
    const xOrb = r * Math.cos(trueAnomaly);
    const yOrb = r * Math.sin(trueAnomaly);

    // Apply full 3D orbital transformation using all orbital elements
    const cosOmega = Math.cos(longitudeOfAscendingNodeRadians);
    const sinOmega = Math.sin(longitudeOfAscendingNodeRadians);
    const cosInc = Math.cos(inclinationRadians);
    const sinInc = Math.sin(inclinationRadians);
    const cosW = Math.cos(argumentOfPeriapsisRadians);
    const sinW = Math.sin(argumentOfPeriapsisRadians);

    // Full 3D transformation matrix for orbital elements
    const x = (cosOmega * cosW - sinOmega * sinW * cosInc) * xOrb +
             (-cosOmega * sinW - sinOmega * cosW * cosInc) * yOrb;
    const y = (sinOmega * cosW + cosOmega * sinW * cosInc) * xOrb +
             (-sinOmega * sinW + cosOmega * cosW * cosInc) * yOrb;
    const z = (sinW * sinInc) * xOrb + (cosW * sinInc) * yOrb;

    // For compatibility with existing coordinate system, we might need to adjust axes
    return target ? target.set(x, z, -y) : new THREE.Vector3(x, z, -y);
}

/**
 * Build the orbit's perifocal basis: the two unit vectors that calculateKeplerianPosition
 * implicitly projects its in-plane coordinates onto. They depend only on the orientation
 * elements, so an orbit computes them once.
 *
 * Because both vectors are unit length and mutually perpendicular, projecting a position
 * back onto them recovers that position's in-plane coordinates, which is how Orbit reads a
 * body's place on its own ellipse straight out of its position.
 *
 * @param {Object} orbitalElements - Object containing the orientation elements
 * @param {THREE.Vector3} periapsisAxis - Receives the direction of periapsis
 * @param {THREE.Vector3} inPlaneAxis - Receives the in-plane direction 90 degrees ahead of it
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

    // Columns of the same transformation used above, in the scene's (x, z, -y) axes
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
 * Gets the AU scale factor for converting astronomical units to visual scale
 * @param {number} [sceneScale] - Scene scale factor; when given it always sets the scale,
 *                                so a caller passing a scale can never silently receive
 *                                a stale value cached from an earlier call
 * @returns {number} AU scale factor
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
 * Force update the AU scale factor (for orbit line regeneration)
 * @param {number} sceneScale - Scene scale factor
 */
export function updateAUScale(sceneScale) {
    auScale = ORBIT.AU_SCALE_METERS * sceneScale;
}

/**
 * Calculates the 3D velocity of a body at a given time using Keplerian orbital mechanics
 * @param {number} t - Time parameter in seconds
 * @param {Object} orbitalElements - Object containing orbital elements (same as position calculation)
 * @param {number} mu - Gravitational parameter (G * M) in AU³/year²
 * @param {THREE.Vector3} [target] - Optional vector to write into, avoiding an allocation
 * @returns {THREE.Vector3} The calculated velocity vector
 */
export function calculateKeplerianVelocity(t, orbitalElements, mu = 39.478, target) {
    const {
        semiMajorAxis,
        eccentricity,
        inclinationRadians,
        longitudeOfAscendingNodeRadians,
        argumentOfPeriapsisRadians,
        meanAnomalyAtEpochRadians,
        meanMotion
    } = orbitalElements;

    // Use same orbital calculations as position
    const meanAnomaly = meanAnomalyAtEpochRadians + meanMotion * t;
    const eccentricAnomaly = solveKeplerEquation(meanAnomaly, eccentricity);
    const tanNuOver2 = Math.sqrt((1 + eccentricity) / (1 - eccentricity)) * Math.tan(eccentricAnomaly / MATH.TWO);
    const trueAnomaly = MATH.TWO * Math.atan(tanNuOver2);

    // Calculate radial distance - use same scaling as n-body initialization
    const auScale = getAUScale(); // Get current AU scale factor
    const scaledA = semiMajorAxis * auScale;

    // Velocity components in the orbital plane. These are only at right angles to the radius
    // vector at the apsides - everywhere else the body is also climbing away from or falling
    // towards the focus, by the flight path angle tan(gamma) = e*sin(nu) / (1 + e*cos(nu)).
    // Building the components off the semi-latus rectum gets that direction right, and
    // reproduces the vis-viva speed exactly. Handing over a velocity at right angles instead
    // put every body onto a different orbit the moment n-body physics took over from Kepler.
    const semiLatusRectum = scaledA * (1 - eccentricity * eccentricity);
    const velocityScale = Math.sqrt(mu / semiLatusRectum);
    const vxOrb = -velocityScale * Math.sin(trueAnomaly);
    const vyOrb = velocityScale * (eccentricity + Math.cos(trueAnomaly));

    // Apply same 3D orbital transformation as position
    const cosOmega = Math.cos(longitudeOfAscendingNodeRadians);
    const sinOmega = Math.sin(longitudeOfAscendingNodeRadians);
    const cosInc = Math.cos(inclinationRadians);
    const sinInc = Math.sin(inclinationRadians);
    const cosW = Math.cos(argumentOfPeriapsisRadians);
    const sinW = Math.sin(argumentOfPeriapsisRadians);

    // Transform velocity to 3D space
    const vxAstro = (cosOmega * cosW - sinOmega * sinW * cosInc) * vxOrb +
                   (-cosOmega * sinW - sinOmega * cosW * cosInc) * vyOrb;
    const vyAstro = (sinOmega * cosW + cosOmega * sinW * cosInc) * vxOrb +
                   (-sinOmega * sinW + cosOmega * cosW * cosInc) * vyOrb;
    const vzAstro = (sinW * sinInc) * vxOrb + (cosW * sinInc) * vyOrb;

    // Convert coordinate system (same as position)
    const finalVx = vxAstro;
    const finalVy = vzAstro;
    const finalVz = -vyAstro;

    // Return velocity without additional scaling (to match n-body initialization method)
    return target ? target.set(finalVx, finalVy, finalVz) : new THREE.Vector3(finalVx, finalVy, finalVz);
}

/**
 * Calculate Keplerian position with full transformations (tilt, parent position)
 * @param {number} t - Time parameter in seconds
 * @param {Object} orbitalElements - Orbital elements object
 * @param {Object|null} parentBody - Parent body object (null for root bodies)
 * @param {Object} options - Additional options for transformations
 * @param {boolean} options.applyTilt - Whether to apply parent axial tilt
 * @param {number} options.axialTilt - Parent axial tilt in degrees
 * @param {THREE.Matrix4} options.tiltMatrix - Pre-computed tilt matrix (optimization)
 * @param {THREE.Vector3} [target] - Optional vector to write into, avoiding an allocation
 * @returns {THREE.Vector3} Final position including all transformations
 */
export function calculateKeplerianPositionWithTransforms(t, orbitalElements, parentBody = null, options = {}, target) {
    // Get base orbital position, written straight into the caller's vector when given
    const finalPosition = calculateKeplerianPosition(t, orbitalElements, target);

    // Apply tilt transformation if specified
    if (options.applyTilt && options.axialTilt !== undefined && options.axialTilt !== 0) {
        // Use pre-computed tilt matrix if available (optimization)
        if (options.tiltMatrix) {
            finalPosition.applyMatrix4(options.tiltMatrix);
        } else {
            // Fallback: compute on-the-fly (legacy support)
            const tiltMatrix = new THREE.Matrix4();
            tiltMatrix.makeRotationZ(options.axialTilt * Math.PI / 180);
            finalPosition.applyMatrix4(tiltMatrix);
        }
    }

    // Add parent position if specified
    if (parentBody && parentBody.position) {
        finalPosition.add(parentBody.position);
    }

    return finalPosition;
}

/**
 * Calculate Keplerian velocity with full transformations (tilt, parent velocity)
 * @param {number} t - Time parameter in seconds
 * @param {Object} orbitalElements - Orbital elements object
 * @param {number} mu - Gravitational parameter (G * M) in AU³/year²
 * @param {Object|null} parentBody - Parent body object (null for root bodies)
 * @param {Object} options - Additional options for transformations
 * @param {boolean} options.applyTilt - Whether to apply parent axial tilt
 * @param {number} options.axialTilt - Parent axial tilt in degrees
 * @param {THREE.Matrix4} options.tiltMatrix - Pre-computed tilt matrix (optimization)
 * @param {THREE.Vector3} [target] - Optional vector to write into, avoiding an allocation
 * @returns {THREE.Vector3} Final velocity including all transformations
 */
export function calculateKeplerianVelocityWithTransforms(t, orbitalElements, mu, parentBody = null, options = {}, target) {
    // Get base orbital velocity, written straight into the caller's vector when given
    const finalVelocity = calculateKeplerianVelocity(t, orbitalElements, mu, target);

    // Apply tilt transformation if specified
    if (options.applyTilt && options.axialTilt !== undefined && options.axialTilt !== 0) {
        // Use pre-computed tilt matrix if available (optimization)
        if (options.tiltMatrix) {
            finalVelocity.applyMatrix4(options.tiltMatrix);
        } else {
            // Fallback: compute on-the-fly (legacy support)
            const tiltMatrix = new THREE.Matrix4();
            tiltMatrix.makeRotationZ(options.axialTilt * Math.PI / 180);
            finalVelocity.applyMatrix4(tiltMatrix);
        }
    }

    // Add parent velocity if specified
    if (parentBody && parentBody.velocity) {
        finalVelocity.add(parentBody.velocity);
    }

    return finalVelocity;
}

/**
 * Update all body positions in a hierarchy based on Keplerian orbital mechanics
 * @param {Object} hierarchy - The hierarchical solar system data
 * @param {number} timestamp - Current time for orbital calculations
 * @param {number} sceneScale - Scene scale factor for visual scaling
 */
export function updateHierarchyPositions(hierarchy, timestamp, sceneScale = DEFAULT_SCENE_SCALE) {
    // Always update AU scale to match the provided scene scale
    auScale = ORBIT.AU_SCALE_METERS * sceneScale;

    // Process the root body (Sun) - it stays at origin, so it is also at rest. The velocity has to
    // be said out loud rather than left alone: every child below is placed on its orbit and then
    // carried along by its parent's velocity, so a root left holding whatever the n-body integrator
    // last gave it hands that velocity to every body in the system, and the whole solar system
    // travels while each orbit still looks right. It shows after a mass has been dropped in and
    // then cleared, which leaves the Sun moving fast enough for the difference to be plain.
    // updatePosition copies the vector, so the shared zero constant is safe to pass.
    if (hierarchy.body) {
        hierarchy.body.updatePosition(_zeroVector);
        if (hierarchy.body.velocity) hierarchy.body.velocity.set(0, 0, 0);
    }

    // Recursively update children
    if (hierarchy.children) {
        updateChildrenPositions(hierarchy, hierarchy.body, timestamp);
    }
}

/**
 * Recursively update positions of child bodies in the hierarchy
 * @param {Object} parent - The parent hierarchy node
 * @param {Object} parentBody - The parent Body object
 * @param {number} timestamp - Current time for orbital calculations
 * @private
 */
function updateChildrenPositions(parent, parentBody, timestamp) {
    if (!parent.children) return;

    // This runs for every body on every frame, so all of the working state below is
    // shared and reused rather than rebuilt. It is safe across the recursion because
    // each child's results are copied into the body before recursing into its children.
    for (let i = 0; i < parent.children.length; i++) {
        const child = parent.children[i];
        if (!child.body || !child.orbit) continue;

        try {
            // Orbital elements are fixed, so the orbit caches them at construction
            const orbit = child.orbit;
            const orbitalElements = orbit.elements;

            // Use centralized functions for position and velocity with transformations. The pair's
            // total mass sets the speed along the relative orbit, matching what the n-body
            // integrator is initialized with so the two modes describe the same orbit.
            const mu = calculateGM(parentBody, child.body.mass);

            // Determine transformation options based on child body's equatorialOrbit attribute
            _scratchTransformOptions.applyTilt = !!(parentBody && parentBody.tiltContainer && child.body.equatorialOrbit);
            _scratchTransformOptions.axialTilt = parentBody?.axialTilt || 0;
            _scratchTransformOptions.tiltMatrix = orbit.tiltMatrix || null; // Pre-computed (optimization)

            // Describe the parent for the centralized functions
            let parentForTransform = null;
            if (parentBody) {
                _scratchParent.position = parentBody.group.position;
                _scratchParent.velocity = parentBody.velocity || _zeroVector;
                parentForTransform = _scratchParent;
            }

            // Calculate position and velocity with all transformations
            const finalPosition = calculateKeplerianPositionWithTransforms(
                timestamp, orbitalElements, parentForTransform, _scratchTransformOptions, _scratchPosition);
            const finalVelocity = calculateKeplerianVelocityWithTransforms(
                timestamp, orbitalElements, mu, parentForTransform, _scratchTransformOptions, _scratchVelocity);

            // Update the body's position and velocity (both copy, so scratch reuse is safe)
            child.body.updatePosition(finalPosition);
            child.body.velocity.copy(finalVelocity);

            // Update orbit trail with new position
            if (child.body.updateOrbitTrail) {
                child.body.updateOrbitTrail();
            }

            // Recursively update this child's children
            updateChildrenPositions(child, child.body, timestamp);

        } catch (error) {
            log.error('Kepler', `Error updating position for ${child.body?.name || 'unknown'}`, error);
        }
    }
}