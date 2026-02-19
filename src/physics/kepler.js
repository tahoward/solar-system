import * as THREE from 'three';
import { ORBIT, MATH } from '../constants.js';
import { log } from '../utils/Logger.js';

// Physics constants - we'll get the scale dynamically to avoid circular imports
let auScale = null;
const PI_OVER_180 = MATH.PI_OVER_180;
// Use same astronomical units as n-body: G * M_sun in AU³ M_sun⁻¹ year⁻²
const GM = 4 * Math.PI ** 2; // Standard GM in astronomical units (AU³/year²)

/**
 * Calculates the gravitational parameter (GM) for a given central body
 * @param {Object} parentBody - The central body (null for Sun)
 * @returns {number} GM value in AU³/year²
 */
export function calculateGM(parentBody) {
    if (parentBody && parentBody.mass) {
        // For satellites (like Moon), use parent body's mass (Earth, Jupiter, etc.)
        return 4 * Math.PI ** 2 * parentBody.mass; // G * M_parent in AU³/year²
    } else {
        // For planets orbiting Sun, use standard solar GM
        return GM; // G * M_sun
    }
}

/**
 * Calculates orbital period and mean motion from semi-major axis and central body mass
 * @param {number} semiMajorAxis - Semi-major axis in AU
 * @param {Object} parentBody - The central body (null for Sun)
 * @returns {Object} Object containing meanMotion (radians/year) and orbitalPeriod (years)
 */
export function calculateOrbitalMotion(semiMajorAxis, parentBody) {
    const centralBodyGM = calculateGM(parentBody);
    const meanMotion = Math.sqrt(centralBodyGM / Math.pow(semiMajorAxis, 3)); // Mean motion in radians/year
    const orbitalPeriod = MATH.TWO_PI / meanMotion; // Period in years

    return { meanMotion, orbitalPeriod };
}

/**
 * Solves Kepler's equation using iterative method.
 * @param {number} meanAnomaly - Mean anomaly in radians
 * @param {number} eccentricity - Orbital eccentricity
 * @returns {number} Eccentric anomaly in radians
 */
export function solveKeplerEquation(meanAnomaly, eccentricity) {
    let eccentricAnomaly = meanAnomaly;

    for (let i = 0; i < ORBIT.KEPLER_EQUATION_ITERATIONS; i++) {
        eccentricAnomaly = meanAnomaly + eccentricity * Math.sin(eccentricAnomaly);
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
 * @returns {THREE.Vector3} The calculated position vector
 */
export function calculateKeplerianPosition(t, orbitalElements) {
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
    return new THREE.Vector3(x, z, -y);
}

/**
 * Gets the AU scale factor for converting astronomical units to visual scale
 * @param {number} sceneScale - Optional scene scale factor, if not provided will use default
 * @returns {number} AU scale factor
 */
export function getAUScale(sceneScale = 0.1) {
    if (auScale === null) {
        auScale = ORBIT.AU_SCALE_METERS * sceneScale;
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
 * @returns {THREE.Vector3} The calculated velocity vector
 */
export function calculateKeplerianVelocity(t, orbitalElements, mu = 39.478) {
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
    const r = scaledA * (1 - eccentricity * Math.cos(eccentricAnomaly));

    // Calculate velocity magnitude using vis-viva equation (matching n-body method)
    const velocityMagnitude = Math.sqrt(mu * (2 / r - 1 / scaledA));

    // Velocity components in orbital plane (perpendicular to radius vector)
    const vxOrb = -velocityMagnitude * Math.sin(trueAnomaly);
    const vyOrb = velocityMagnitude * Math.cos(trueAnomaly);

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
    return new THREE.Vector3(finalVx, finalVy, finalVz);
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
 * @returns {THREE.Vector3} Final position including all transformations
 */
export function calculateKeplerianPositionWithTransforms(t, orbitalElements, parentBody = null, options = {}) {
    // Get base orbital position
    const orbitPosition = calculateKeplerianPosition(t, orbitalElements);

    // Apply tilt transformation if specified
    let finalPosition = orbitPosition.clone();
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
 * @returns {THREE.Vector3} Final velocity including all transformations
 */
export function calculateKeplerianVelocityWithTransforms(t, orbitalElements, mu, parentBody = null, options = {}) {
    // Get base orbital velocity
    const orbitVelocity = calculateKeplerianVelocity(t, orbitalElements, mu);

    // Apply tilt transformation if specified
    let finalVelocity = orbitVelocity.clone();
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
export function updateHierarchyPositions(hierarchy, timestamp, sceneScale = 0.1) {
    // Always update AU scale to match the provided scene scale
    auScale = ORBIT.AU_SCALE_METERS * sceneScale;

    // Process the root body (Sun) - it stays at origin
    if (hierarchy.body) {
        hierarchy.body.updatePosition(new THREE.Vector3(0, 0, 0));
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

    parent.children.forEach(child => {
        if (!child.body || !child.orbit) return;

        try {
            // Get the orbit's orbital elements
            const orbit = child.orbit;
            const orbitalElements = {
                semiMajorAxis: orbit.semiMajorAxis,
                eccentricity: orbit.eccentricity,
                inclinationRadians: orbit.inclinationRadians,
                longitudeOfAscendingNodeRadians: orbit.longitudeOfAscendingNodeRadians,
                argumentOfPeriapsisRadians: orbit.argumentOfPeriapsisRadians,
                meanAnomalyAtEpochRadians: orbit.meanAnomalyAtEpochRadians,
                meanMotion: orbit.n
            };

            // Use centralized functions for position and velocity with transformations
            const mu = parentBody.mass * 39.478;

            // Determine transformation options based on child body's equatorialOrbit attribute
            const transformOptions = {
                applyTilt: parentBody && parentBody.tiltContainer && child.body.equatorialOrbit,
                axialTilt: parentBody?.axialTilt || 0,
                tiltMatrix: orbit.tiltMatrix || null  // Use pre-computed tilt matrix (optimization)
            };

            // Create parent body object for centralized functions
            const parentForTransform = parentBody ? {
                position: parentBody.group.position,
                velocity: parentBody.velocity || new THREE.Vector3(0, 0, 0)
            } : null;

            // Calculate position and velocity with all transformations
            const finalPosition = calculateKeplerianPositionWithTransforms(timestamp, orbitalElements, parentForTransform, transformOptions);
            const finalVelocity = calculateKeplerianVelocityWithTransforms(timestamp, orbitalElements, mu, parentForTransform, transformOptions);

            // Update the body's position and velocity
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
    });
}