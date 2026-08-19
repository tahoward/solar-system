import * as THREE from 'three';
import clockManager from '../managers/ClockManager.js';
import { NBODY, MATH } from '../constants.js';
import { calculateKeplerianPositionWithTransforms, calculateKeplerianVelocityWithTransforms } from './kepler.js';
import { log } from '../utils/Logger.js';

const _bodies = [];
const _separation = new THREE.Vector3();
const _relativeVelocity = new THREE.Vector3();

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

function isIntegrable(body) {
    return !!(body.position && body.velocity && body.acceleration && typeof body.mass === 'number');
}

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