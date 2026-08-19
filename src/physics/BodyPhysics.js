import * as THREE from 'three';
import VectorUtils from '../utils/VectorUtils.js';
import logger, { log } from '../utils/Logger.js';

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
            // TIDAL LOCKING: Always face the body it is locked to
            BodyPhysics.updateTidalLockRotation(body);
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
     * Update rotation for tidally locked bodies to always face the body they are locked to
     * @param {Object} body - The body instance
     */
    static updateTidalLockRotation(body) {
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

        // Calculate the angle needed to face the target
        // We want the body to face it with its "front" (negative Z axis by default)
        const targetRotation = Math.atan2(_lockDirection.x, _lockDirection.z);

        // Apply the rotation to make the body face its parent, plus any rotation offset
        const finalRotation = targetRotation + body.rotationOffset;

        if (body.mesh) {
            body.mesh.rotation.y = finalRotation;
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