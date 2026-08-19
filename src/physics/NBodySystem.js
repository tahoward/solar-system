import * as THREE from 'three';
import clockManager from '../managers/ClockManager.js';
import { NBODY, MATH } from '../constants.js';
import { calculateKeplerianPositionWithTransforms, calculateKeplerianVelocityWithTransforms } from './kepler.js';
import { log } from '../utils/Logger.js';

const _bodies = [];
const _separation = new THREE.Vector3();
const _relativeVelocity = new THREE.Vector3();

/**
 * Advances the whole system by one frame of gravitational n-body integration.
 *
 * This is the n-body physics mode's per-frame entry point, and the alternative
 * to the analytic Kepler path. Every body attracts every other, so orbits
 * perturb one another and respond to bodies added at runtime — but they also
 * accumulate integration error and cannot be scrubbed backwards.
 *
 * The frame's requested time span is covered by as many sub-steps as stability
 * allows: {@link calculateNBodyAccelerations} reports the largest safe step, and
 * the loop keeps stepping until the span is covered or
 * `NBODY.MAX_STEPS_PER_FRAME` is reached. When the budget runs out the shortfall
 * is reported back to the clock as a speed limit, which is what stops the
 * simulation from silently integrating garbage at extreme speed multipliers.
 *
 * Note that positions are carried in scene units while `G` is in AU³ yr⁻², so
 * one internal time unit is not one year: at 21.55 scene units per AU the
 * periods come out ~100× long. Convert before comparing against real ephemerides.
 *
 * @param {{body: ?Body, children: ?Array<Object>}} hierarchy - Root of the body tree.
 * @param {{gravitationalConstant?: number, dampingFactor?: number}} [options={}]
 *   Overrides for `G` (default 4π²) and an optional per-step velocity damping
 *   factor (default 1, i.e. none).
 * @returns {void}
 */
export function updateHierarchyNBodyPhysics(hierarchy, options = {}) {
    const G = options.gravitationalConstant || 39.478;
    const dampingFactor = options.dampingFactor || 1.0;

    const requestedStep = clockManager.getNBodyTimeIncrement();

    const bodies = _bodies;
    bodies.length = 0;
    collectBodiesFromHierarchy(hierarchy, bodies);

    if (bodies.length === 0) {
        log.warn('NBodySystem', 'No bodies found in hierarchy for n-body physics');
        return;
    }

    let maxStep = calculateNBodyAccelerations(bodies, G);

    let covered = 0;
    let steps = 0;
    while (covered < requestedStep && steps < NBODY.MAX_STEPS_PER_FRAME && maxStep > 0) {
        const step = Math.min(requestedStep - covered, maxStep);
        maxStep = integrateStep(bodies, step, dampingFactor, G);
        covered += step;
        steps++;
    }

    const affordableStep = (steps > 0 ? covered / steps : maxStep) * NBODY.MAX_STEPS_PER_FRAME;
    clockManager.setPhysicsSpeedLimit(requestedStep > 0
        ? clockManager.speedMultiplier * affordableStep / requestedStep
        : Infinity);

    applyPositions(bodies);
}

/**
 * Flattens the body tree into a list.
 *
 * The integrator treats gravity as global rather than parent-relative, so the
 * hierarchy is flattened before each frame's force calculation.
 *
 * @param {{body: ?Body, children: ?Array<Object>}} hierarchy - Node to walk.
 * @param {Body[]} bodies - Array that bodies are appended to; mutated.
 * @returns {void}
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
 * Tests whether a body carries the state the integrator needs.
 *
 * Markers, barycentre placeholders and partially built bodies appear in the
 * hierarchy without full physics state and are skipped rather than crashing the
 * force loop.
 *
 * @param {Body} body - Body to test.
 * @returns {boolean} `true` if it has position, velocity, acceleration and a
 *   numeric mass.
 */
function isIntegrable(body) {
    return !!(body.position && body.velocity && body.acceleration && typeof body.mass === 'number');
}

/**
 * Recomputes every body's gravitational acceleration and reports a safe step size.
 *
 * Runs over unique pairs and applies each interaction to both bodies, halving the
 * work. The separation is softened by a small multiple of the two radii, which
 * caps the force during close passes — without it a near-miss produces an
 * effectively infinite acceleration and ejects the body from the system.
 *
 * The returned step limit is the strictest of two conditions across all pairs:
 * resolving the tightest local orbit into at least `NBODY.MIN_STEPS_PER_ORBIT`
 * steps, and never closing more than `NBODY.MAX_APPROACH_FRACTION` of the
 * current separation in a single step.
 *
 * @param {Body[]} bodies - Bodies to update; their `acceleration` and optional
 *   `force` vectors are overwritten.
 * @param {number} G - Gravitational constant to use.
 * @returns {number} Largest time step considered stable, or `Infinity` if no
 *   pair constrains it.
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

            const softening = Math.max(NBODY.MIN_SOFTENING,
                NBODY.SOFTENING_RADII * ((body1.radius || 0) + (body2.radius || 0)));
            const softDistanceSquared = distanceSquared + softening * softening;
            const softDistance = Math.sqrt(softDistanceSquared);

            const pull = G / (softDistanceSquared * softDistance);
            body1.acceleration.addScaledVector(_separation, pull * body2.mass);
            body2.acceleration.addScaledVector(_separation, -pull * body1.mass);

            const totalMass = body1.mass + body2.mass;
            if (totalMass > 0) {
                const orbitTime = MATH.TWO_PI * Math.sqrt(softDistanceSquared * softDistance / (G * totalMass));
                const orbitStep = orbitTime / NBODY.MIN_STEPS_PER_ORBIT;
                if (orbitStep < maxStep) maxStep = orbitStep;
            }

            _relativeVelocity.subVectors(body2.velocity, body1.velocity);
            const closingRate = -_relativeVelocity.dot(_separation) / softDistance;
            if (closingRate > 0) {
                const approachStep = NBODY.MAX_APPROACH_FRACTION * softDistance / closingRate;
                if (approachStep < maxStep) maxStep = approachStep;
            }
        }

        if (body1.force) body1.force.copy(body1.acceleration).multiplyScalar(body1.mass);
    }

    return maxStep;
}

/**
 * Advances the system by one velocity Verlet (leapfrog) step.
 *
 * Velocities are kicked by half a step, positions drifted a full step,
 * accelerations recomputed, then velocities kicked by the remaining half. This
 * ordering is symplectic: unlike plain Euler integration it conserves orbital
 * energy over long runs, so orbits stay closed instead of spiralling.
 *
 * @param {Body[]} bodies - Bodies to advance; positions and velocities mutated.
 * @param {number} dt - Step size, in internal time units.
 * @param {number} dampingFactor - Velocity multiplier applied mid-step; 1 for none.
 * @param {number} G - Gravitational constant to use.
 * @returns {number} Safe step size for the next iteration, from the accelerations
 *   computed at the new positions.
 */
function integrateStep(bodies, dt, dampingFactor, G) {
    const halfStep = dt * 0.5;

    for (let i = 0; i < bodies.length; i++) {
        const body = bodies[i];
        if (!isIntegrable(body)) continue;

        body.velocity.addScaledVector(body.acceleration, halfStep);

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
 * Pushes integrated positions onto the scene graph and extends orbit trails.
 *
 * Kept separate from the integration loop so the sub-steps stay pure maths and
 * only the final state of the frame reaches the renderer.
 *
 * @param {Body[]} bodies - Bodies whose scene position is synced.
 * @returns {void}
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
 * Seeds the integrator's state from the bodies' orbital elements.
 *
 * The integrator needs a consistent set of positions and velocities to start
 * from, which are derived analytically from each orbit rather than hand-authored.
 * Must be called before {@link updateHierarchyNBodyPhysics}. The root body starts
 * at rest at the origin.
 *
 * @param {{body: ?Body, children: ?Array<Object>}} hierarchy - Root of the body tree.
 * @param {number} [sceneScale=0.1] - Scene scale, forwarded to the recursive pass.
 * @returns {void}
 */
export function initializeHierarchyPhysics(hierarchy, sceneScale = 0.1) {
    if (hierarchy.body) {
        hierarchy.body.setInitialPhysicsConditions(
            new THREE.Vector3(0, 0, 0),
            new THREE.Vector3(0, 0, 0)
        );
    }

    if (hierarchy.children) {
        initializeChildPhysics(hierarchy, hierarchy.body, sceneScale);
    }
}

/**
 * Recursively seeds a node's children with Keplerian state, then rebalances the parent.
 *
 * Children already holding non-trivial state are left alone, so a runtime-added
 * body is not reset. The rest have their position and velocity evaluated at
 * `t = 0` from their orbital elements.
 *
 * The parent is then displaced by the mass-weighted negative sum of its
 * children's states, which puts the system's barycentre at rest at the parent's
 * intended location. Skipping that step would give the whole system a net
 * momentum and make it drift out of frame over time.
 *
 * @param {{children: ?Array<{body: Body, data: Object, orbit: ?Orbit}>}} parent -
 *   Node whose children are initialised.
 * @param {Body} parentBody - The parent's body; its position and velocity are
 *   adjusted to cancel the children's momentum.
 * @param {number} sceneScale - Scene scale, forwarded to deeper levels.
 * @returns {void}
 */
function initializeChildPhysics(parent, parentBody, sceneScale) {
    if (!parent.children) {
        return;
    }

    const placements = [];

    parent.children.forEach(child => {
        const childBody = child.body;

        const hasPosition = childBody.position &&
            (Math.abs(childBody.position.x) > 0.001 ||
             Math.abs(childBody.position.y) > 0.001 ||
             Math.abs(childBody.position.z) > 0.001);

        const hasVelocity = childBody.velocity &&
            (Math.abs(childBody.velocity.x) > 0.001 ||
             Math.abs(childBody.velocity.y) > 0.001 ||
             Math.abs(childBody.velocity.z) > 0.001);

        if (hasPosition && hasVelocity) {
            log.debug('NBodySystem', `Skipping initialization for ${childBody.name} - already has physics state`);
            return;
        }

        childBody.setInitialPhysicsConditions(
            new THREE.Vector3(0, 0, 0),
            new THREE.Vector3(0, 0, 0)
        );

        if (!child.data.a || !child.orbit) {
            return;
        }

        const orbitalElements = {
            semiMajorAxis: child.data.a,
            eccentricity: child.data.e,
            inclinationRadians: child.data.i * Math.PI / 180,
            longitudeOfAscendingNodeRadians: child.data.omega * Math.PI / 180,
            argumentOfPeriapsisRadians: child.data.w * Math.PI / 180,
            meanAnomalyAtEpochRadians: child.data.M0 * Math.PI / 180,
            meanMotion: child.orbit.n
        };

        const mu = 39.478 * (parentBody.mass + childBody.mass);

        const transformOptions = {
            applyTilt: parentBody.axialTilt !== undefined && child.body.equatorialOrbit,
            axialTilt: parentBody.axialTilt || 0,
            tiltMatrix: child.orbit?.tiltMatrix || null
        };

        placements.push({
            childBody,
            data: child.data,
            position: calculateKeplerianPositionWithTransforms(0, orbitalElements, null, transformOptions),
            velocity: calculateKeplerianVelocityWithTransforms(0, orbitalElements, mu, null, transformOptions)
        });
    });

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

    parent.children.forEach(child => {
        initializeChildPhysics(child, child.body, sceneScale);
    });
}


export default { updateHierarchyNBodyPhysics, initializeHierarchyPhysics };