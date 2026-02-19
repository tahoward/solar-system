import * as THREE from 'three';
import VectorUtils from '../utils/VectorUtils.js';
import logger, { log } from '../utils/Logger.js';

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
        if (body.tidallyLocked && body.parentBody) {
            // TIDAL LOCKING: Always face the parent body
            BodyPhysics.updateTidalLockRotation(body);
        } else {
            // NORMAL ROTATION: Calculate absolute rotation from orbital time
            // This keeps rotation synchronized with orbital motion
            //
            // The orbital time and rotation need to use the same time base.
            // rotationSpeed is in radians/second and has been calibrated for visual scaling
            // orbitalTime comes from Kepler calculations and uses the same time scale as orbital motion
            //
            // To synchronize: we need to convert orbital time (which advances slowly) to rotation time
            // The Kepler time uses a factor of 0.00002, while the original rotation used 0.1
            // So we need to scale by (0.1 / 0.00002) = 5000 to maintain the same rotation speed
            const rotationTimeScale = 5000; // Scale factor to match rotation speed with orbital time
            const absoluteRotation = body.rotationSpeed * orbitalTime * rotationTimeScale;

            // Apply absolute rotation (rotation offset was applied at initialization)
            if (body.mesh) {
                body.mesh.rotation.y = body.rotationOffset + absoluteRotation;
            }

            // Also rotate LOD mesh to keep them synchronized
            if (body.lodMesh) {
                body.lodMesh.rotation.y = body.rotationOffset + absoluteRotation;
            }
        }

        // Rotate clouds independently at their own speed (always applies)
        if (body.clouds && body.clouds.userData.rotationSpeed) {
            const rotationTimeScale = 5000; // Same scale factor as main rotation
            const cloudRotation = body.rotationSpeed * orbitalTime * rotationTimeScale * body.clouds.userData.rotationSpeed;
            body.clouds.rotation.y = cloudRotation;
        }
    }

    /**
     * Update rotation for tidally locked bodies to always face their parent
     * @param {Object} body - The body instance
     */
    static updateTidalLockRotation(body) {
        if (!body.parentBody || !body.group || !body.parentBody.group) {
            return;
        }

        // Calculate vector from this body to its parent
        const parentDirection = new THREE.Vector3()
            .subVectors(body.parentBody.group.position, body.group.position)
            .normalize();

        // Calculate the angle needed to face the parent
        // We want the body to face the parent with its "front" (negative Z axis by default)
        const targetRotation = Math.atan2(parentDirection.x, parentDirection.z);

        // Apply the rotation to make the body face its parent, plus any rotation offset
        const finalRotation = targetRotation + body.rotationOffset;

        if (body.mesh) {
            body.mesh.rotation.y = finalRotation;
        }

        if (body.lodMesh) {
            body.lodMesh.rotation.y = finalRotation;
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