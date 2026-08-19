import * as THREE from 'three';
import VectorUtils from '../utils/VectorUtils.js';
import { getAUScale } from './kepler.js';
import { MATH, TIDAL_LOCK } from '../constants.js';
import { log } from '../utils/Logger.js';

/**
 * Gravitational constant in AU³ yr⁻² M☉⁻¹ (4π²).
 *
 * @type {number}
 */
const GRAVITATIONAL_CONSTANT = 39.478;

/**
 * Converts orbital time into spin angle for the rotation display.
 *
 * Real rotation periods are far too slow to see, so they are compressed such
 * that one Earth day plays out in 15 seconds of wall time.
 *
 * @type {number}
 */
const ROTATION_TIME_SCALE = 8766 * 15 / 23.93;

const _lockDirection = new THREE.Vector3();
const _lockQuaternion = new THREE.Quaternion();

/**
 * Finds the smallest signed rotation from one angle to another.
 *
 * Wrapping into `(-π, π]` is what keeps the tidal-lock solver from taking the
 * long way round when an angle crosses the ±π boundary.
 *
 * @param {number} from - Starting angle, in radians.
 * @param {number} to - Target angle, in radians.
 * @returns {number} Signed difference in radians, within `(-π, π]`.
 */
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

/**
 * Physics behaviour for a single celestial body: spin, position and state.
 *
 * Implemented as static functions taking the body as their first argument, so
 * {@link Body} can delegate to them without inheriting from anything. Orbital
 * motion itself lives in `kepler.js` and `NBodySystem.js`; this module covers
 * everything about an individual body, most substantially its axial rotation.
 *
 * All members are static; the class is used purely as a namespace.
 */
class BodyPhysics {
    /**
     * Converts a rotation period into an angular velocity.
     *
     * Rotation is time-compressed so that Earth's day takes 15 seconds. A
     * negative period denotes retrograde rotation (as for Venus and Uranus) and
     * yields a negative angular velocity.
     *
     * @param {number|undefined} rotationPeriod - Sidereal rotation period in
     *   hours, negative for retrograde; falsy values fall back to Earth's.
     * @returns {number} Signed angular velocity, in radians per second.
     */
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

    /**
     * Sets a body's spin for the current frame.
     *
     * Tidally locked bodies are handed to the dedicated solver; everything else
     * gets its angle computed directly from elapsed orbital time, which keeps the
     * spin exactly reproducible for any time value rather than accumulating.
     *
     * Cloud layers are rotated separately at a multiple of the surface rate, so
     * they appear to drift over it.
     *
     * @param {Body} body - Body to orient; its mesh rotation is written.
     * @param {number} [orbitalTime=0] - Elapsed simulation time.
     * @returns {void}
     */
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

    /**
     * Resolves which body a tidally locked body keeps its face towards.
     *
     * Defaults to the parent, the usual case for a moon. A body may instead name
     * a target explicitly — Pluto and Charon are mutually locked, so the parent
     * relationship alone is not enough. Named targets are looked up among the
     * body's children and parent and then cached, since the lookup runs every
     * frame; an unresolvable name is warned about once.
     *
     * @param {Body} body - Body whose lock target is wanted.
     * @returns {Body|null} The target body, or `null` if there is none.
     */
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

    /**
     * Advances a tidally locked body's spin towards its target.
     *
     * Rather than snapping the body to face its target, this integrates a damped
     * torsional oscillator about that equilibrium: the restoring torque comes
     * from the body's figure asymmetry (`TIDAL_LOCK.FIGURE_ASYMMETRY`) and is
     * damped by `TIDAL_LOCK.DISSIPATION`. The result is physical libration — the
     * slight rocking a real locked moon shows — instead of a rigid stare.
     *
     * The integration is sub-stepped to stay stable, bounded by
     * `TIDAL_LOCK.MAX_SUBSTEPS`. Beyond that budget it degrades gracefully: if the
     * step still spans much less than a lock timescale the spin simply coasts,
     * otherwise it is snapped to equilibrium, which is the correct limit at high
     * simulation speeds. The first frame seeds the state instead of integrating.
     *
     * @param {Body} body - Body to orient; `spinAngle`, `spinRate`, `spinTime`,
     *   `spinEquilibrium` and its mesh rotation are all updated.
     * @param {number} orbitalTime - Current simulation time.
     * @returns {void}
     */
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

    /**
     * Moves a body to a position, syncing its scene group and marker.
     *
     * This is the single point where physics state reaches the scene graph.
     *
     * @param {Body} body - Body to move.
     * @param {THREE.Vector3} position - Target position, in scene units.
     * @returns {void}
     */
    static updatePosition(body, position) {
        body.position.copy(position);

        body.group.position.copy(position);

        if (body.marker && typeof body.marker.update === 'function') {
            body.marker.update();
        }
    }

    /**
     * Teleports a body to a new position.
     *
     * @param {Body} body - Body to move.
     * @param {THREE.Vector3} newPosition - Target position, in scene units.
     * @returns {void}
     */
    static setPosition(body, newPosition) {
        body.position.copy(newPosition);
        BodyPhysics.updatePosition(body, body.position);
    }

    /**
     * Replaces a body's velocity.
     *
     * @param {Body} body - Body to modify.
     * @param {THREE.Vector3} newVelocity - New velocity, in scene units per time unit.
     * @returns {void}
     */
    static setVelocity(body, newVelocity) {
        body.velocity.copy(newVelocity);
    }

    /**
     * Accumulates a force onto a body for the current step.
     *
     * @param {Body} body - Body to modify.
     * @param {THREE.Vector3} additionalForce - Force to add.
     * @returns {void}
     */
    static addForce(body, additionalForce) {
        body.force.add(additionalForce);
    }

    /**
     * Restores a body to the state it was initialised with.
     *
     * Position and velocity return to their initial values, accumulated force and
     * acceleration are cleared, and the spin solver's state is dropped so it
     * re-seeds on the next frame.
     *
     * @param {Body} body - Body to reset.
     * @returns {void}
     */
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

    /**
     * Computes a body's kinetic energy, ½mv².
     *
     * @param {Body} body - Body to measure.
     * @returns {number} Kinetic energy in the simulation's internal units.
     */
    static getKineticEnergy(body) {
        return 0.5 * body.mass * body.velocity.lengthSq();
    }

    /**
     * Computes a body's linear momentum, mv.
     *
     * @param {Body} body - Body to measure.
     * @returns {THREE.Vector3} A newly allocated momentum vector.
     */
    static getMomentum(body) {
        return VectorUtils.multiplyScalar(VectorUtils.temp(), body.velocity, body.mass);
    }

    /**
     * Returns a body's speed.
     *
     * @param {Body} body - Body to measure.
     * @returns {number} Velocity magnitude, in scene units per time unit.
     */
    static getSpeed(body) {
        return body.velocity.length();
    }

    /**
     * Measures the distance between two bodies.
     *
     * @param {Body} body - First body.
     * @param {Body} otherBody - Second body.
     * @returns {number} Separation, in scene units.
     */
    static getDistanceTo(body, otherBody) {
        return body.position.distanceTo(otherBody.position);
    }

    /**
     * Establishes a body's starting state and records it for later resets.
     *
     * The values are stored as the body's initial conditions as well as applied,
     * so {@link BodyPhysics.resetPhysics} can return to them.
     *
     * @param {Body} body - Body to initialise.
     * @param {THREE.Vector3} [initialPosition] - Starting position; the origin by default.
     * @param {THREE.Vector3} [initialVelocity] - Starting velocity; at rest by default.
     * @returns {void}
     */
    static setInitialPhysicsConditions(body, initialPosition = new THREE.Vector3(), initialVelocity = new THREE.Vector3()) {
        VectorUtils.safeCopy(body.initialPosition, initialPosition);
        VectorUtils.safeCopy(body.initialVelocity, initialVelocity);

        VectorUtils.safeCopy(body.position, initialPosition);
        VectorUtils.safeCopy(body.velocity, initialVelocity);
        VectorUtils.zero(body.force);
        VectorUtils.zero(body.acceleration);

        BodyPhysics.updatePosition(body, body.position);
    }

    /**
     * Snapshots a body's physics state as plain data, for debug inspection.
     *
     * Vectors are flattened to plain objects so the result logs and serialises
     * cleanly rather than printing as `THREE.Vector3` instances.
     *
     * @param {Body} body - Body to snapshot.
     * @returns {{name: string, mass: number,
     *   position: {x: number, y: number, z: number},
     *   velocity: {x: number, y: number, z: number, magnitude: number},
     *   force: {x: number, y: number, z: number, magnitude: number},
     *   kineticEnergy: number, speed: number}} The body's current state.
     */
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

    /**
     * Resolves a body's render radius from its configured scale factor.
     *
     * Radii are authored relative to the parent so a moon stays proportionate to
     * its planet; top-level bodies scale against the scene instead.
     *
     * @param {{radiusScale: number}} bodyData - Body configuration.
     * @param {Body|null} parentBody - Parent body, if the body orbits one.
     * @param {Object} SceneManager - Scene manager supplying the global `scale`.
     * @returns {number} Radius in scene units.
     */
    static calculateBodyRadius(bodyData, parentBody, SceneManager) {
        if (parentBody) {
            return parentBody.radius * bodyData.radiusScale;
        } else {
            return bodyData.radiusScale * SceneManager.scale;
        }
    }
}

export default BodyPhysics;