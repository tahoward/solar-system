import * as THREE from 'three';
import clockManager from '../managers/ClockManager.js';
import { calculateKeplerianPositionWithTransforms, calculateKeplerianVelocityWithTransforms } from './kepler.js';
import { log } from '../utils/Logger.js';

/**
 * N-Body gravitational simulation functions
 * Functional approach similar to kepler.js for hierarchy-based physics
 */

/**
 * Update all body positions using n-body physics for a given hierarchy
 * This is the n-body equivalent to updateHierarchyPositions in kepler.js
 * @param {Object} hierarchy - The hierarchical solar system data
 * @param {number} timestamp - Current timestamp (for compatibility, not used with adaptive timestep)
 * @param {number} sceneScale - Scene scale factor for visual scaling
 * @param {Object} options - Physics simulation options
 */
export function updateHierarchyNBodyPhysics(hierarchy, options = {}) {
    // Default physics constants
    const G = options.gravitationalConstant || 39.478; // AU³ M_sun⁻¹ year⁻²
    const dampingFactor = options.dampingFactor || 1.0;

    // Get physics time step using clockManager (adaptive timestep)
    const dt = clockManager.getNBodyTimeIncrement();

    // Collect all bodies from hierarchy
    const bodies = [];
    collectBodiesFromHierarchy(hierarchy, bodies);

    if (bodies.length === 0) {
        log.warn('NBodySystem', 'No bodies found in hierarchy for n-body physics');
        return;
    }

    // Calculate forces between all bodies
    calculateNBodyForces(bodies, G);

    // Update positions using Leapfrog integration
    updateNBodyPositions(bodies, dt, dampingFactor);
}

/**
 * Collect all bodies from hierarchy into a flat array
 * @param {Object} hierarchy - The hierarchical solar system data
 * @param {Array} bodies - Array to collect bodies into
 */
function collectBodiesFromHierarchy(hierarchy, bodies) {
    if (hierarchy.body) {
        bodies.push(hierarchy.body);
    }

    if (hierarchy.children) {
        hierarchy.children.forEach(child => {
            collectBodiesFromHierarchy(child, bodies);
        });
    }
}

/**
 * Calculate gravitational forces between all bodies
 * @param {Array} bodies - Array of Body objects
 * @param {number} G - Gravitational constant
 */
function calculateNBodyForces(bodies, G) {
    // Reset all forces
    bodies.forEach(body => {
        if (body.force) {
            body.force.set(0, 0, 0);
        }
    });

    // Temporary vectors for calculations
    const tempVector1 = new THREE.Vector3();
    const tempVector2 = new THREE.Vector3();

    // Calculate pairwise forces
    for (let i = 0; i < bodies.length; i++) {
        for (let j = i + 1; j < bodies.length; j++) {
            const body1 = bodies[i];
            const body2 = bodies[j];

            calculatePairwiseForce(body1, body2, G, tempVector1, tempVector2);
        }
    }
}

/**
 * Calculate gravitational force between two bodies
 * @param {Object} body1 - First body
 * @param {Object} body2 - Second body
 * @param {number} G - Gravitational constant
 * @param {THREE.Vector3} tempVector1 - Temporary vector for calculations
 * @param {THREE.Vector3} tempVector2 - Temporary vector for calculations
 */
function calculatePairwiseForce(body1, body2, G, tempVector1, tempVector2) {
    // Calculate distance vector
    tempVector1.subVectors(body2.position, body1.position);
    const distance = tempVector1.length();

    // Avoid singularities by adding a small softening parameter
    const softeningParameter = 0.001;
    const softDistance = Math.sqrt(distance * distance + softeningParameter * softeningParameter);

    // Calculate force magnitude: F = G * m1 * m2 / r²
    const forceMagnitude = G * body1.mass * body2.mass / (softDistance * softDistance);

    // Calculate unit vector
    tempVector1.normalize();

    // Calculate force vector
    tempVector2.copy(tempVector1).multiplyScalar(forceMagnitude);

    // Apply forces (Newton's third law: F12 = -F21)
    if (body1.force) body1.force.add(tempVector2);
    if (body2.force) body2.force.sub(tempVector2);
}

/**
 * Update body positions using Leapfrog integration
 * @param {Array} bodies - Array of Body objects
 * @param {number} dt - Time step
 * @param {number} dampingFactor - Damping factor for numerical stability
 */
function updateNBodyPositions(bodies, dt, dampingFactor) {
    const tempVector1 = new THREE.Vector3();
    const tempVector2 = new THREE.Vector3();

    bodies.forEach(body => {
        if (!body.velocity || !body.position || !body.force || typeof body.mass !== 'number') {
            return; // Skip bodies without required physics properties
        }

        // Calculate acceleration: a = F / m
        tempVector1.copy(body.force).divideScalar(body.mass);

        // Update velocity: v(t+dt/2) = v(t-dt/2) + a(t) * dt
        body.velocity.add(tempVector1.multiplyScalar(dt));

        // Apply damping to prevent numerical instabilities (only if enabled)
        if (dampingFactor !== 1.0) {
            body.velocity.multiplyScalar(dampingFactor);
        }

        // Update position: x(t+dt) = x(t) + v(t+dt/2) * dt
        tempVector2.copy(body.velocity).multiplyScalar(dt);
        body.position.add(tempVector2);

        // Update the visual position using Body's updatePosition method
        body.updatePosition(body.position);

        // Update orbital trail
        if (body.updateOrbitTrail) {
            body.updateOrbitTrail();
        }
    });
}

/**
 * Initialize physics on bodies from hierarchy using Keplerian orbital elements
 * @param {Object} hierarchy - The hierarchical solar system data
 * @param {number} sceneScale - Scene scale factor for visual scaling
 */
export function initializeHierarchyPhysics(hierarchy, sceneScale = 0.1) {
    // Initialize physics on the root body (Sun)
    if (hierarchy.body) {
        hierarchy.body.setInitialPhysicsConditions(
            new THREE.Vector3(0, 0, 0), // Sun at origin
            new THREE.Vector3(0, 0, 0)  // Sun stationary
        );
    }

    // Recursively initialize physics on child bodies
    if (hierarchy.children) {
        initializeChildPhysics(hierarchy, hierarchy.body, sceneScale);
    }
}

/**
 * Recursively initialize physics properties on children of a parent body
 * @param {Object} parent - The parent hierarchy node
 * @param {Object} parentBody - The parent Body object
 * @param {number} sceneScale - Scene scale factor for visual scaling
 */
function initializeChildPhysics(parent, parentBody, sceneScale) {
    if (!parent.children) {
        return;
    }

    parent.children.forEach(child => {
        // Get the child Body object
        const childBody = child.body;

        // Check if body already has meaningful physics state
        const hasPosition = childBody.position &&
            (Math.abs(childBody.position.x) > 0.001 ||
             Math.abs(childBody.position.y) > 0.001 ||
             Math.abs(childBody.position.z) > 0.001);

        const hasVelocity = childBody.velocity &&
            (Math.abs(childBody.velocity.x) > 0.001 ||
             Math.abs(childBody.velocity.y) > 0.001 ||
             Math.abs(childBody.velocity.z) > 0.001);

        // Skip initialization if body already has physics state
        if (hasPosition && hasVelocity) {
            log.debug('NBodySystem', `Skipping initialization for ${childBody.name} - already has physics state`);
        } else {
            // Initialize physics on bodies that need it
            childBody.setInitialPhysicsConditions(
                new THREE.Vector3(0, 0, 0), // Will be set by Keplerian orbit
                new THREE.Vector3(0, 0, 0)  // Will be set by Keplerian orbit
            );

            // Set Keplerian orbit if orbital data exists
            if (child.data.a && child.orbit) {
            // Prepare orbital elements for kepler.js functions
            const orbitalElements = {
                semiMajorAxis: child.data.a,
                eccentricity: child.data.e,
                inclinationRadians: child.data.i * Math.PI / 180,
                longitudeOfAscendingNodeRadians: child.data.omega * Math.PI / 180,
                argumentOfPeriapsisRadians: child.data.w * Math.PI / 180,
                meanAnomalyAtEpochRadians: child.data.M0 * Math.PI / 180,
                meanMotion: child.orbit.n // Use mean motion from orbit object
            };

            // Calculate position and velocity with centralized transformations
            const mu = 39.478 * parentBody.mass; // Gravitational parameter

            // Prepare transformation options based on child body's equatorialOrbit attribute
            const transformOptions = {
                applyTilt: parentBody.axialTilt !== undefined && child.body.equatorialOrbit,
                axialTilt: parentBody.axialTilt || 0
            };

            // Use centralized kepler.js functions that handle tilt and parent transformations
            const finalPosition = calculateKeplerianPositionWithTransforms(0, orbitalElements, parentBody, transformOptions);
            const finalVelocity = calculateKeplerianVelocityWithTransforms(0, orbitalElements, mu, parentBody, transformOptions);

            // Set the calculated position and velocity directly
            childBody.position.copy(finalPosition);
            childBody.velocity.copy(finalVelocity);

            childBody.updatePosition(childBody.position);

            log.debug('NBodySystem', `Set Keplerian orbit for ${childBody.name} using kepler.js functions: a=${child.data.a.toFixed(3)}AU, e=${child.data.e.toFixed(3)}, i=${child.data.i.toFixed(1)}°`);
            }
        }

        // Recursively handle this child's children (for moons, etc.)
        initializeChildPhysics(child, childBody, sceneScale);
    });
}


export default { updateHierarchyNBodyPhysics, initializeHierarchyPhysics };