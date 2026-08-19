import * as THREE from 'three';
import VectorUtils from '../utils/VectorUtils.js';
import { getAUScale } from './kepler.js';
import { MATH, TIDAL_LOCK } from '../constants.js';
import logger, { log } from '../utils/Logger.js';

const GRAVITATIONAL_CONSTANT = 39.478;

const ROTATION_TIME_SCALE = 8766 * 15 / 23.93;

const _lockDirection = new THREE.Vector3();
const _lockQuaternion = new THREE.Quaternion();

function shortestAngleTo(from, to) {
    const difference = (to - from) % MATH.TWO_PI;

    if (difference > Math.PI) {
        return difference - MATH.TWO_PI;
    }
    if (difference < -Math.PI) {
        return difference + MATH.TWO_PI;
    }
    return difference;
}

class BodyPhysics {
    static calculateRotationSpeed(rotationPeriod) {
        if (!rotationPeriod) {
            return (2 * Math.PI) / (23.93 * 3600);
        }

        const direction = rotationPeriod > 0 ? 1 : -1;
        const periodHours = Math.abs(rotationPeriod);
        const periodSeconds = periodHours * 3600;

        const earthPeriodSeconds = 23.93 * 3600;
        const targetEarthSeconds = 15;
        const scaleFactor = earthPeriodSeconds / targetEarthSeconds;

        const scaledPeriodSeconds = periodSeconds / scaleFactor;
        const angularVelocity = (2 * Math.PI) / scaledPeriodSeconds;

        return direction * angularVelocity;
    }

    static updateRotation(body, orbitalTime = 0) {
        if (body.tidallyLocked && BodyPhysics.getTidalLockTarget(body)) {
            BodyPhysics.updateTidalLockRotation(body, orbitalTime);
        } else {
            const rotationTimeScale = ROTATION_TIME_SCALE;
            const absoluteRotation = body.rotationSpeed * orbitalTime * rotationTimeScale;

            if (body.mesh) {
                body.mesh.rotation.y = body.rotationOffset + absoluteRotation;
            }
        }

        if (body.clouds && body.clouds.userData.rotationSpeed) {
            const rotationTimeScale = ROTATION_TIME_SCALE;
            const cloudRotation = body.rotationSpeed * orbitalTime * rotationTimeScale * body.clouds.userData.rotationSpeed;
            body.clouds.rotation.y = cloudRotation;
        }
    }

    static getTidalLockTarget(body) {
        if (!body.tidalLockTarget) {
            return body.parentBody || null;
        }

        if (body._resolvedTidalLockTarget?.name !== body.tidalLockTarget) {
            const child = (body.children || [])
                .map(node => node.body || node)
                .find(candidate => candidate?.name === body.tidalLockTarget);
            body._resolvedTidalLockTarget = child
                || (body.parentBody?.name === body.tidalLockTarget ? body.parentBody : null);

            if (!body._resolvedTidalLockTarget && !body._tidalLockTargetWarned) {
                body._tidalLockTargetWarned = true;
                log.warn('BodyPhysics',
                    `${body.name} is tidally locked to ${body.tidalLockTarget}, which is not among its relations yet`);
            }
        }

        return body._resolvedTidalLockTarget || null;
    }

    static updateTidalLockRotation(body, orbitalTime) {
        const target = BodyPhysics.getTidalLockTarget(body);
        if (!target || !body.group || !target.group) {
            return;
        }

        _lockDirection.subVectors(target.group.position, body.group.position);

        if (body.tiltContainer) {
            _lockDirection.applyQuaternion(body.tiltContainer.getWorldQuaternion(_lockQuaternion).invert());
        }

        _lockDirection.normalize();

        const equilibrium = Math.atan2(_lockDirection.x, _lockDirection.z) + body.rotationOffset;

        const started = body.spinTime !== null;
        const step = started ? orbitalTime - body.spinTime : 0;
        const swept = started ? shortestAngleTo(body.spinEquilibrium, equilibrium) : 0;
        const orbitalRate = step > 0 ? swept / step : 0;

        const separation = body.group.position.distanceTo(target.group.position) / getAUScale();
        const lockRate = separation > 0 && target.mass > 0
            ? Math.sqrt(GRAVITATIONAL_CONSTANT * target.mass / (separation * separation * separation))
            : 0;

        const libration = lockRate * Math.sqrt(3 * TIDAL_LOCK.FIGURE_ASYMMETRY) * step;
        const substeps = Math.ceil(
            Math.max(Math.abs(swept), libration) / TIDAL_LOCK.MAX_SUBSTEP_RADIANS);

        if (step <= 0) {
            body.spinAngle = equilibrium;
        } else if (body.spinRate === null) {
            body.spinRate = orbitalRate;
            body.spinAngle = equilibrium;
        } else if (substeps <= TIDAL_LOCK.MAX_SUBSTEPS) {
            const substep = step / substeps;
            const stiffness = 1.5 * TIDAL_LOCK.FIGURE_ASYMMETRY * lockRate * lockRate;
            const drag = TIDAL_LOCK.DISSIPATION * lockRate;

            for (let i = 0; i < substeps; i++) {
                const misalignment = shortestAngleTo(equilibrium, body.spinAngle);
                const angularAcceleration = -stiffness * Math.sin(2 * misalignment)
                    - drag * (body.spinRate - orbitalRate);

                body.spinRate += angularAcceleration * substep;
                body.spinAngle += body.spinRate * substep;
            }
        } else if (lockRate * step > 1) {
            body.spinAngle = equilibrium;
            body.spinRate = orbitalRate;
        } else {
            body.spinAngle += body.spinRate * step;
        }

        body.spinAngle = equilibrium + shortestAngleTo(equilibrium, body.spinAngle);

        body.spinTime = orbitalTime;
        body.spinEquilibrium = equilibrium;

        if (body.mesh) {
            body.mesh.rotation.y = body.spinAngle;
        }
    }

    static updatePosition(body, position) {
        body.position.copy(position);

        body.group.position.copy(position);

        if (body.marker && typeof body.marker.update === 'function') {
            body.marker.update();
        }
    }

    static setPosition(body, newPosition) {
        body.position.copy(newPosition);
        BodyPhysics.updatePosition(body, body.position);
    }

    static setVelocity(body, newVelocity) {
        body.velocity.copy(newVelocity);
    }

    static addForce(body, additionalForce) {
        body.force.add(additionalForce);
    }

    static resetPhysics(body) {
        VectorUtils.safeCopy(body.position, body.initialPosition);
        VectorUtils.safeCopy(body.velocity, body.initialVelocity);
        VectorUtils.zero(body.force);
        VectorUtils.zero(body.acceleration);
        BodyPhysics.updatePosition(body, body.position);

        body.spinRate = null;
        body.spinTime = null;

        log.debug('BodyPhysics', `Reset ${body.name} to initial physics conditions`);
    }

    static getKineticEnergy(body) {
        return 0.5 * body.mass * body.velocity.lengthSq();
    }

    static getMomentum(body) {
        return VectorUtils.multiplyScalar(VectorUtils.temp(), body.velocity, body.mass);
    }

    static getSpeed(body) {
        return body.velocity.length();
    }

    static getDistanceTo(body, otherBody) {
        return body.position.distanceTo(otherBody.position);
    }

    static setInitialPhysicsConditions(body, initialPosition = new THREE.Vector3(), initialVelocity = new THREE.Vector3()) {
        VectorUtils.safeCopy(body.initialPosition, initialPosition);
        VectorUtils.safeCopy(body.initialVelocity, initialVelocity);

        VectorUtils.safeCopy(body.position, initialPosition);
        VectorUtils.safeCopy(body.velocity, initialVelocity);
        VectorUtils.zero(body.force);
        VectorUtils.zero(body.acceleration);

        BodyPhysics.updatePosition(body, body.position);
    }

    static getPhysicsState(body) {
        return {
            name: body.name,
            mass: body.mass,
            position: {
                x: body.position.x,
                y: body.position.y,
                z: body.position.z
            },
            velocity: {
                x: body.velocity.x,
                y: body.velocity.y,
                z: body.velocity.z,
                magnitude: body.velocity.length()
            },
            force: {
                x: body.force.x,
                y: body.force.y,
                z: body.force.z,
                magnitude: body.force.length()
            },
            kineticEnergy: BodyPhysics.getKineticEnergy(body),
            speed: BodyPhysics.getSpeed(body)
        };
    }

    static calculateBodyRadius(bodyData, parentBody, SceneManager) {
        if (parentBody) {
            return parentBody.radius * bodyData.radiusScale;
        } else {
            return bodyData.radiusScale * SceneManager.scale;
        }
    }
}

export default BodyPhysics;