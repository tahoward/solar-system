import * as THREE from 'three';
import clockManager from '../managers/ClockManager.js';
import { NBODY, MATH } from '../constants.js';
import { calculateKeplerianPositionWithTransforms, calculateKeplerianVelocityWithTransforms } from './kepler.js';
import { log } from '../utils/Logger.js';

/**
 * N-Body gravitational simulation functions
 * Functional approach similar to kepler.js for hierarchy-based physics
 */

// Bodies to integrate, gathered once per frame into an array that is reused
const _bodies = [];
const _separation = new THREE.Vector3();
const _relativeVelocity = new THREE.Vector3();

/**
 * Update all body positions using n-body physics for a given hierarchy
 * This is the n-body equivalent to updateHierarchyPositions in kepler.js
 *
 * The time the clock asks for is covered in as many steps as accuracy demands rather than in one
 * stride, so raising the time compression costs work instead of costing stability. What the step
 * size has to respect is the fastest thing in the system: Saturn's inner moons come round in
 * under a day, and a step anywhere near that long pumps energy into their orbits until they are
 * thrown clear of the planet - which used to happen to every inner moon somewhere above a
 * thousand times real time. When even the step budget cannot cover the requested time, the clock
 * is asked to slow to a speed that can be integrated; see ClockManager#setPhysicsSpeedLimit.
 *
 * @param {Object} hierarchy - The hierarchical solar system data
 * @param {Object} options - Physics simulation options
 */
export function updateHierarchyNBodyPhysics(hierarchy, options = {}) {
    // Default physics constants
    const G = options.gravitationalConstant || 39.478; // AU³ M_sun⁻¹ year⁻²
    const dampingFactor = options.dampingFactor || 1.0;

    // Time the clock would like covered this frame
    const requestedStep = clockManager.getNBodyTimeIncrement();

    // Collect all bodies from hierarchy
    const bodies = _bodies;
    bodies.length = 0;
    collectBodiesFromHierarchy(hierarchy, bodies);

    if (bodies.length === 0) {
        log.warn('NBodySystem', 'No bodies found in hierarchy for n-body physics');
        return;
    }

    // Accelerations where the bodies are now, along with the longest step the closest pair in the
    // system will stand. Both are worked out again after every step rather than once for the whole
    // frame: what the pairs are doing at the start of a frame is no guide to what they are doing at
    // the end of it, and a mass falling in covers the distance from harmless to overlapping well
    // inside the time one frame asks for.
    let maxStep = calculateNBodyAccelerations(bodies, G);

    let covered = 0;
    let steps = 0;
    while (covered < requestedStep && steps < NBODY.MAX_STEPS_PER_FRAME && maxStep > 0) {
        const step = Math.min(requestedStep - covered, maxStep);
        maxStep = integrateStep(bodies, step, dampingFactor, G);
        covered += step;
        steps++;
    }

    // Time the step budget can cover at the size of step the last frame's worth of work needed, and
    // the speed that corresponds to - the requested step is proportional to the speed multiplier, so
    // the two scale together. Reported as a capacity rather than as what was managed, so a frame
    // that covered everything asked of it does not read as a reason to speed up.
    const affordableStep = (steps > 0 ? covered / steps : maxStep) * NBODY.MAX_STEPS_PER_FRAME;
    clockManager.setPhysicsSpeedLimit(requestedStep > 0
        ? clockManager.speedMultiplier * affordableStep / requestedStep
        : Infinity);

    applyPositions(bodies);
}

/**
 * Collect all bodies from hierarchy into a flat array
 * @param {Object} hierarchy - The hierarchical solar system data
 * @param {Array} bodies - Array to collect bodies into
 */
export function collectBodiesFromHierarchy(hierarchy, bodies) {
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
 * Whether a body carries everything the integrator needs to move it
 * @param {Object} body - Body to check
 * @returns {boolean} True if the body can be integrated
 */
function isIntegrable(body) {
    return !!(body.position && body.velocity && body.acceleration && typeof body.mass === 'number');
}

/**
 * Calculate the gravitational acceleration of every body at its current position, and report the
 * longest step the closest pair in the system will stand.
 *
 * Two things can make a step too long. A pair going round quickly needs enough steps to describe
 * the circle, or leapfrog feeds it energy until it comes apart; and a pair closing on one another
 * needs the step short enough that neither passes the other before the force between them has been
 * looked at again. The first is a matter of how far apart they are and the second of how fast they
 * are approaching, so both are measured here, where the pair is already in hand.
 *
 * @param {Array} bodies - Array of Body objects
 * @param {number} G - Gravitational constant
 * @returns {number} Longest safe step in simulation time units, or Infinity if nothing constrains it
 */
function calculateNBodyAccelerations(bodies, G) {
    for (let i = 0; i < bodies.length; i++) {
        if (bodies[i].acceleration) bodies[i].acceleration.set(0, 0, 0);
        if (bodies[i].force) bodies[i].force.set(0, 0, 0);
    }

    let maxStep = Infinity;

    for (let i = 0; i < bodies.length; i++) {
        const body1 = bodies[i];
        if (!isIntegrable(body1)) continue;

        for (let j = i + 1; j < bodies.length; j++) {
            const body2 = bodies[j];
            if (!isIntegrable(body2)) continue;

            _separation.subVectors(body2.position, body1.position);
            const distanceSquared = _separation.lengthSq();

            // Softened below the size of the bodies themselves, where treating them as points is
            // meaningless anyway: gravity then levels off instead of running away to infinity as
            // two bodies pass through one another
            const softening = Math.max(NBODY.MIN_SOFTENING,
                NBODY.SOFTENING_RADII * ((body1.radius || 0) + (body2.radius || 0)));
            const softDistanceSquared = distanceSquared + softening * softening;
            const softDistance = Math.sqrt(softDistanceSquared);

            // a = G * m / r², shared out along the line between the two bodies
            const pull = G / (softDistanceSquared * softDistance);
            body1.acceleration.addScaledVector(_separation, pull * body2.mass);
            body2.acceleration.addScaledVector(_separation, -pull * body1.mass);

            // How long these two would take to circle one another at this separation. The same
            // softening applies, so a body passing clean through another cannot demand an
            // infinitely short step.
            const totalMass = body1.mass + body2.mass;
            if (totalMass > 0) {
                const orbitTime = MATH.TWO_PI * Math.sqrt(softDistanceSquared * softDistance / (G * totalMass));
                const orbitStep = orbitTime / NBODY.MIN_STEPS_PER_ORBIT;
                if (orbitStep < maxStep) maxStep = orbitStep;
            }

            // How fast the gap between them is closing, and so how long the gap would last at that
            // rate. Only the part of the relative velocity along the line between them counts: a
            // body in a circular orbit is travelling quickly and closing on nothing. The softened
            // separation is used again, so two bodies on top of one another ask for a step short
            // enough to cross the softening rather than one of zero length.
            _relativeVelocity.subVectors(body2.velocity, body1.velocity);
            const closingRate = -_relativeVelocity.dot(_separation) / softDistance;
            if (closingRate > 0) {
                const approachStep = NBODY.MAX_APPROACH_FRACTION * softDistance / closingRate;
                if (approachStep < maxStep) maxStep = approachStep;
            }
        }

        // Kept for anything reading a body's force, which the integrator no longer needs itself
        if (body1.force) body1.force.copy(body1.acceleration).multiplyScalar(body1.mass);
    }

    return maxStep;
}

/**
 * Advance the system by one step of leapfrog integration, kicking the velocities by half a step
 * either side of the drift.
 *
 * Splitting the kick this way costs nothing - the accelerations worked out for the second half
 * kick are the ones the next step opens with, so there is still only one force evaluation per
 * step - and in exchange the error per step falls with the square of the step rather than
 * linearly, while the energy of a closed orbit stays put instead of creeping in one direction.
 *
 * @param {Array} bodies - Array of Body objects
 * @param {number} dt - Time step
 * @param {number} dampingFactor - Damping factor for numerical stability
 * @param {number} G - Gravitational constant
 * @returns {number} Longest step the system will stand where it has ended up
 */
function integrateStep(bodies, dt, dampingFactor, G) {
    const halfStep = dt * 0.5;

    for (let i = 0; i < bodies.length; i++) {
        const body = bodies[i];
        if (!isIntegrable(body)) continue;

        body.velocity.addScaledVector(body.acceleration, halfStep);

        // Apply damping to prevent numerical instabilities (only if enabled)
        if (dampingFactor !== 1.0) {
            body.velocity.multiplyScalar(dampingFactor);
        }

        body.position.addScaledVector(body.velocity, dt);
    }

    const maxStep = calculateNBodyAccelerations(bodies, G);

    for (let i = 0; i < bodies.length; i++) {
        const body = bodies[i];
        if (!isIntegrable(body)) continue;

        body.velocity.addScaledVector(body.acceleration, halfStep);
    }

    return maxStep;
}

/**
 * Show where the integration has left the bodies
 * @param {Array} bodies - Array of Body objects
 */
function applyPositions(bodies) {
    for (let i = 0; i < bodies.length; i++) {
        const body = bodies[i];
        if (!isIntegrable(body)) continue;

        body.updatePosition(body.position);

        if (body.updateOrbitTrail) {
            body.updateOrbitTrail();
        }
    }
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

    // Where each child sits relative to its parent. Gathered before anything is placed because
    // the parent itself has to move first - see the recoil below - and the children then hang off
    // wherever it ends up.
    const placements = [];

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
            return;
        }

        // Initialize physics on bodies that need it
        childBody.setInitialPhysicsConditions(
            new THREE.Vector3(0, 0, 0), // Will be set by Keplerian orbit
            new THREE.Vector3(0, 0, 0)  // Will be set by Keplerian orbit
        );

        // Nothing more to do for a body with no orbit to sit on
        if (!child.data.a || !child.orbit) {
            return;
        }

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

        // Calculate position and velocity with centralized transformations. Both masses count
        // towards the gravitational parameter, because the n-body integrator lets the parent
        // move too: launching a moon at the speed it would need to circle a fixed parent
        // leaves it too slow for the pair's real motion, which showed as Charon - an eighth of
        // Pluto's mass - starting off on an orbit of eccentricity 0.11 rather than its
        // catalogued 0.0002.
        const mu = 39.478 * (parentBody.mass + childBody.mass); // Gravitational parameter

        // Prepare transformation options based on child body's equatorialOrbit attribute
        const transformOptions = {
            applyTilt: parentBody.axialTilt !== undefined && child.body.equatorialOrbit,
            axialTilt: parentBody.axialTilt || 0,
            tiltMatrix: child.orbit?.tiltMatrix || null  // Use pre-computed tilt matrix (optimization)
        };

        // Use centralized kepler.js functions for the tilt, but keep the result relative to the
        // parent by leaving the parent out of it, hence the null
        placements.push({
            childBody,
            data: child.data,
            position: calculateKeplerianPositionWithTransforms(0, orbitalElements, null, transformOptions),
            velocity: calculateKeplerianVelocityWithTransforms(0, orbitalElements, mu, null, transformOptions)
        });
    });

    // A catalogued orbit belongs to the centre of mass of a body and its moons rather than to the
    // body itself, so the parent is stepped back off that orbit by its moons' share of the
    // separation and their share of the relative velocity. It matters most where a moon is a
    // sizeable fraction of the pair: Charon's share of the 19,600 km separation is 2,141 km, more
    // than Pluto's own radius, and leaving Pluto on the catalogued ellipse with Charon hung off it
    // sent the pair's centre of mass round the Sun on an orbit 0.06 AU wider than the real one.
    // The same correction gives the Sun the recoil that keeps the system's centre of mass still
    // instead of letting the whole solar system drift off.
    if (placements.length > 0 && isIntegrable(parentBody)) {
        let systemMass = parentBody.mass;
        for (const placement of placements) {
            systemMass += placement.childBody.mass;
        }

        if (systemMass > 0) {
            for (const placement of placements) {
                const share = placement.childBody.mass / systemMass;
                parentBody.position.addScaledVector(placement.position, -share);
                parentBody.velocity.addScaledVector(placement.velocity, -share);
            }
            parentBody.updatePosition(parentBody.position);
        }
    }

    for (const { childBody, data, position, velocity } of placements) {
        childBody.position.addVectors(position, parentBody.position);
        childBody.velocity.addVectors(velocity, parentBody.velocity);
        childBody.updatePosition(childBody.position);

        log.debug('NBodySystem', `Set Keplerian orbit for ${childBody.name} using kepler.js functions: a=${data.a.toFixed(3)}AU, e=${data.e.toFixed(3)}, i=${data.i.toFixed(1)}°`);
    }

    // Recursively handle the children's own children (for moons, etc.)
    parent.children.forEach(child => {
        initializeChildPhysics(child, child.body, sceneScale);
    });
}


export default { updateHierarchyNBodyPhysics, initializeHierarchyPhysics };