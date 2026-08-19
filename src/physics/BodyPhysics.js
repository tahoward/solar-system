import * as THREE from 'three';
import VectorUtils from '../utils/VectorUtils.js';
import { getAUScale } from './kepler.js';
import { MATH, TIDAL_LOCK } from '../constants.js';
import logger, { log } from '../utils/Logger.js';

// 4π², which is what G comes to with distances in AU, masses in solar masses and time in years -
// the units the tidal lock works in, orbital time being a year to the unit. The n-body integrator
// carries the same number against positions in scene units, which is why its own time unit comes
// out a hundredth of a year; nothing here relies on that, since separations are converted to AU.
const GRAVITATIONAL_CONSTANT = 39.478;

// Turns a body's rotation speed - which calculateRotationSpeed gives in radians per second of a
// scaled clock where Earth comes round in 15 seconds - into radians per unit of orbital time,
// one unit of which is a year. See updateRotation for the derivation. The 5000 this replaced left
// every body turning 9.8% too slowly for the orbits going on around it, which is a whole day lost
// off Earth's year and enough to walk Pluto's near side away from Charon over a few months.
const ROTATION_TIME_SCALE = 8766 * 15 / 23.93;

// Scratch values for the tidal lock, which runs for every locked body every frame
const _lockDirection = new THREE.Vector3();
const _lockQuaternion = new THREE.Quaternion();

/**
 * The shortest way round from one angle to another, in radians between -π and π. Two angles read
 * off atan2 either side of a frame have to be compared this way: a primary that has crossed the
 * seam at ±π has moved a fraction of a degree, not most of a turn.
 * @param {number} from - Angle to measure from, in radians
 * @param {number} to - Angle to measure to, in radians
 * @returns {number} Signed difference in radians, between -π and π
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
 * BodyPhysics - Handles all physics-related calculations and operations for celestial bodies
 * Extracted from Body.js to separate physics logic from body logic
 */
class BodyPhysics {
    /**
     * Calculate rotation speed based on rotation period
     * @param {number} rotationPeriod - Rotation period in Earth hours
     * @returns {number} Rotation speed in radians per second
     */
    static calculateRotationSpeed(rotationPeriod) {
        if (!rotationPeriod) {
            // Default rotation for unknown bodies (Earth-like)
            return (2 * Math.PI) / (23.93 * 3600); // Earth period in seconds
        }

        // Convert rotation period (hours) to rotation speed (radians per second)
        // Negative periods indicate retrograde rotation
        const direction = rotationPeriod > 0 ? 1 : -1;
        const periodHours = Math.abs(rotationPeriod);
        const periodSeconds = periodHours * 3600; // Convert hours to seconds

        // Scale down to make visible but maintain proportions
        // Using Earth as reference: Earth should complete 1 rotation in about 15 seconds at 1x speed
        const earthPeriodSeconds = 23.93 * 3600;
        const targetEarthSeconds = 15; // 15 seconds for one Earth rotation
        const scaleFactor = earthPeriodSeconds / targetEarthSeconds;

        // Calculate angular velocity: 2π radians per scaled period (in seconds)
        const scaledPeriodSeconds = periodSeconds / scaleFactor;
        const angularVelocity = (2 * Math.PI) / scaledPeriodSeconds;

        return direction * angularVelocity;
    }

    /**
     * Update body rotation (call this every frame)
     * @param {Object} body - The body instance
     * @param {number} orbitalTime - Absolute orbital time (same time used for Kepler calculations)
     */
    static updateRotation(body, orbitalTime = 0) {
        if (body.tidallyLocked && BodyPhysics.getTidalLockTarget(body)) {
            // TIDAL LOCKING: spin under the torques that hold a real moon facing its primary
            BodyPhysics.updateTidalLockRotation(body, orbitalTime);
        } else {
            // NORMAL ROTATION: Calculate absolute rotation from orbital time
            // This keeps rotation synchronized with orbital motion
            //
            // One unit of orbital time is one year: the Kepler solver advances its mean anomaly
            // by n radians per unit, with n in radians per year, and the n-body integrator is
            // fed a time increment scaled to match. A body must therefore turn
            // (hours in a year / its rotation period in hours) times per unit, and
            // calculateRotationSpeed hands over 2π per (period in hours × 15 / 23.93) seconds,
            // so the scale between the two is 8766 × 15 / 23.93.
            const rotationTimeScale = ROTATION_TIME_SCALE;
            const absoluteRotation = body.rotationSpeed * orbitalTime * rotationTimeScale;

            // Apply absolute rotation (rotation offset was applied at initialization)
            if (body.mesh) {
                body.mesh.rotation.y = body.rotationOffset + absoluteRotation;
            }
        }

        // Rotate clouds independently at their own speed (always applies)
        if (body.clouds && body.clouds.userData.rotationSpeed) {
            const rotationTimeScale = ROTATION_TIME_SCALE; // Same scale factor as main rotation
            const cloudRotation = body.rotationSpeed * orbitalTime * rotationTimeScale * body.clouds.userData.rotationSpeed;
            body.clouds.rotation.y = cloudRotation;
        }
    }

    /**
     * The body a tidally locked body keeps its face turned towards. Normally that is its parent,
     * but a lock can be mutual - Pluto and Charon each keep the same face towards the other - and
     * the heavier of such a pair has the lighter one as a child rather than a parent, so it names
     * what it is locked to explicitly.
     * @param {Object} body - The body instance
     * @returns {Object|null} The body being faced, or null if there is nothing to face
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

            // Children are attached after construction, so a miss early on is only worth
            // mentioning once - it stays a miss if the name is simply wrong
            if (!body._resolvedTidalLockTarget && !body._tidalLockTargetWarned) {
                body._tidalLockTargetWarned = true;
                log.warn('BodyPhysics',
                    `${body.name} is tidally locked to ${body.tidalLockTarget}, which is not among its relations yet`);
            }
        }

        return body._resolvedTidalLockTarget || null;
    }

    /**
     * Turn a tidally locked body by the spin it carries, under the torques that hold a real moon's
     * face towards its primary.
     *
     * The body is not pointed at anything. It has a spin rate of its own, and two couples act on
     * it. Being slightly out of round, its long axis is pulled towards the primary by a couple
     * proportional to sin(2γ) in the angle γ by which the axis misses - the two ends of the axis
     * serve equally, which is why sin doubles the angle - and tides drag its spin towards the rate
     * at which the primary is going round it. Together those make a damped pendulum whose rest
     * point is the lock, so the lock is arrived at and held rather than imposed. What that buys
     * over pointing the body at its primary every frame is the libration: an eccentric orbit swings
     * the primary ahead of and behind the body's long axis, and the axis follows late and short,
     * which is the ±6.7° monthly rocking the near side of the Moon really does.
     *
     * Nothing here holds the body to its primary, which is what makes it survive the primary being
     * taken away. Both couples fall off as the cube of the separation, so a moon flung clear of its
     * planet is left with the spin it had and nothing to correct it, and goes on turning once per
     * what used to be its month about an axis fixed in space - which is what an ejected moon really
     * does. A moon whose planet is swallowed by another is in the same position, and one that merely
     * wanders far out has its lock loosened by however far it went.
     *
     * @param {Object} body - The body instance
     * @param {number} orbitalTime - Absolute orbital time, the same time the positions were reached at
     */
    static updateTidalLockRotation(body, orbitalTime) {
        const target = BodyPhysics.getTidalLockTarget(body);
        if (!target || !body.group || !target.group) {
            return;
        }

        // Calculate vector from this body to the one it faces
        _lockDirection.subVectors(target.group.position, body.group.position);

        // The rotation being solved for is applied inside the tilt container, so the direction has
        // to be brought into that container's frame first. Reading the angle off the world axes
        // instead only works for a body whose poles happen to stand upright, and quietly stops
        // working for the tilted ones: taken in world coordinates the lock turned Pluto and Charon
        // two full turns per orbit away from each other rather than holding them still.
        if (body.tiltContainer) {
            _lockDirection.applyQuaternion(body.tiltContainer.getWorldQuaternion(_lockQuaternion).invert());
        }

        _lockDirection.normalize();

        // Where the long axis is being drawn towards: the direction of the primary, taken about the
        // body's own pole, plus whichever face the body is configured to turn that way
        const equilibrium = Math.atan2(_lockDirection.x, _lockDirection.z) + body.rotationOffset;

        // How far round the primary has gone since the last frame, and so the rate it is going
        // round at, which is the rate the tidal drag pulls the spin towards. Measured rather than
        // worked out from the orbit, so it stays honest when the n-body integrator's step budget
        // leaves the bodies short of the time the clock asked for: the spin then falls behind by
        // exactly as much as the orbit did, instead of running on ahead of it.
        const started = body.spinTime !== null;
        const step = started ? orbitalTime - body.spinTime : 0;
        const swept = started ? shortestAngleTo(body.spinEquilibrium, equilibrium) : 0;
        const orbitalRate = step > 0 ? swept / step : 0;

        // How firm the lock is, expressed as the rate a circular orbit at this separation would go
        // round at. Both couples are quoted against it, and it is taken from the primary's gravity
        // rather than from the rate measured above because that is what carries the distance: a
        // separation cubed in the denominator is the difference between a moon held by its planet
        // and one that has been thrown clear of it and keeps whatever spin it left with.
        const separation = body.group.position.distanceTo(target.group.position) / getAUScale();
        const lockRate = separation > 0 && target.mass > 0
            ? Math.sqrt(GRAVITATIONAL_CONSTANT * target.mass / (separation * separation * separation))
            : 0;

        // Substeps enough to feel both the way the orbital rate varies around an eccentric orbit,
        // that variation being what drives the libration, and the libration's own swing
        const libration = lockRate * Math.sqrt(3 * TIDAL_LOCK.FIGURE_ASYMMETRY) * step;
        const substeps = Math.ceil(
            Math.max(Math.abs(swept), libration) / TIDAL_LOCK.MAX_SUBSTEP_RADIANS);

        if (step <= 0) {
            // The first frame, or one that has had the clock put back under it. Nothing to
            // integrate over, so the body is placed in its lock - where a body four billion years
            // into one already is.
            body.spinAngle = equilibrium;
        } else if (body.spinRate === null) {
            // A body already locked is turning at the rate its primary goes round it, so that is
            // the rate it opens with, facing whichever way it is configured to face. Despinning
            // from anything else is not modelled - see TIDAL_LOCK.DISSIPATION.
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

                // Taking the rate first and turning by the rate it has just become, rather than
                // the one it had, is what keeps a damped oscillator from gaining amplitude every
                // cycle at these step sizes
                body.spinRate += angularAcceleration * substep;
                body.spinAngle += body.spinRate * substep;
            }
        } else if (lockRate * step > 1) {
            // Too long a frame to resolve the swing, but firm enough a lock to have pulled the body
            // round more than a radian's worth within it, so the body is where the lock puts it
            body.spinAngle = equilibrium;
            body.spinRate = orbitalRate;
        } else {
            // Too long a frame to resolve, and nothing much holding the body either, so it coasts
            // on the spin it has. This is the ejected moon at high time compression.
            body.spinAngle += body.spinRate * step;
        }

        // Only the miss matters, so the angle is kept expressed as one. Left to accumulate it would
        // run off to the millions of radians a long session's worth of turning comes to, and lose
        // the fractions of a degree the libration is measured in.
        body.spinAngle = equilibrium + shortestAngleTo(equilibrium, body.spinAngle);

        body.spinTime = orbitalTime;
        body.spinEquilibrium = equilibrium;

        if (body.mesh) {
            body.mesh.rotation.y = body.spinAngle;
        }
    }

    /**
     * Update body position in 3D space
     * @param {Object} body - The body instance
     * @param {THREE.Vector3} position - The final position for the body
     */
    static updatePosition(body, position) {
        // Update the body's physics position vector
        body.position.copy(position);

        // Update the body's visual position
        body.group.position.copy(position);

        // Update marker position if it exists
        if (body.marker && typeof body.marker.update === 'function') {
            body.marker.update();
        }
    }

    /**
     * Set physics position and sync visual position
     * @param {Object} body - The body instance
     * @param {THREE.Vector3} newPosition - New position
     */
    static setPosition(body, newPosition) {
        body.position.copy(newPosition);
        BodyPhysics.updatePosition(body, body.position);
    }

    /**
     * Set physics velocity
     * @param {Object} body - The body instance
     * @param {THREE.Vector3} newVelocity - New velocity
     */
    static setVelocity(body, newVelocity) {
        body.velocity.copy(newVelocity);
    }

    /**
     * Add force to this body
     * @param {Object} body - The body instance
     * @param {THREE.Vector3} additionalForce - Force to add
     */
    static addForce(body, additionalForce) {
        body.force.add(additionalForce);
    }

    /**
     * Reset physics to initial conditions
     * @param {Object} body - The body instance
     */
    static resetPhysics(body) {
        VectorUtils.safeCopy(body.position, body.initialPosition);
        VectorUtils.safeCopy(body.velocity, body.initialVelocity);
        VectorUtils.zero(body.force);
        VectorUtils.zero(body.acceleration);
        BodyPhysics.updatePosition(body, body.position);

        // A locked body's spin is forgotten along with everything else, so it opens its next lock
        // synchronous rather than carrying over a rate belonging to an orbit it is no longer on
        body.spinRate = null;
        body.spinTime = null;

        log.debug('BodyPhysics', `Reset ${body.name} to initial physics conditions`);
    }

    /**
     * Get kinetic energy of this body
     * @param {Object} body - The body instance
     * @returns {number} Kinetic energy (0.5 * m * v²)
     */
    static getKineticEnergy(body) {
        return 0.5 * body.mass * body.velocity.lengthSq();
    }

    /**
     * Get momentum of this body
     * @param {Object} body - The body instance
     * @returns {THREE.Vector3} Momentum vector (m * v)
     */
    static getMomentum(body) {
        return VectorUtils.multiplyScalar(VectorUtils.temp(), body.velocity, body.mass);
    }

    /**
     * Get speed (magnitude of velocity)
     * @param {Object} body - The body instance
     * @returns {number} Speed
     */
    static getSpeed(body) {
        return body.velocity.length();
    }

    /**
     * Get distance to another body
     * @param {Object} body - The body instance
     * @param {Object} otherBody - The other body
     * @returns {number} Distance
     */
    static getDistanceTo(body, otherBody) {
        return body.position.distanceTo(otherBody.position);
    }

    /**
     * Set initial physics conditions
     * @param {Object} body - The body instance
     * @param {THREE.Vector3} initialPosition - Initial position
     * @param {THREE.Vector3} initialVelocity - Initial velocity
     */
    static setInitialPhysicsConditions(body, initialPosition = new THREE.Vector3(), initialVelocity = new THREE.Vector3()) {
        // Store initial conditions for reset capability
        VectorUtils.safeCopy(body.initialPosition, initialPosition);
        VectorUtils.safeCopy(body.initialVelocity, initialVelocity);

        // Set current physics state to initial conditions
        VectorUtils.safeCopy(body.position, initialPosition);
        VectorUtils.safeCopy(body.velocity, initialVelocity);
        VectorUtils.zero(body.force);
        VectorUtils.zero(body.acceleration);

        // Update visual position to match
        BodyPhysics.updatePosition(body, body.position);
    }

    /**
     * Get physics state for debugging
     * @param {Object} body - The body instance
     * @returns {Object} Current physics state
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
     * Calculate body radius based on parent body scaling
     * @param {Object} bodyData - The celestial body data
     * @param {Object|null} parentBody - The parent body
     * @param {Object} SceneManager - SceneManager for scale access
     * @returns {number} The calculated radius
     */
    static calculateBodyRadius(bodyData, parentBody, SceneManager) {
        if (parentBody) {
            // Parent radius already includes SceneManager.scale, so don't apply it again
            return parentBody.radius * bodyData.radiusScale;
        } else {
            // For Sun, use the radiusScale directly
            return bodyData.radiusScale * SceneManager.scale;
        }
    }
}

export default BodyPhysics;