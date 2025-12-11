import * as THREE from "three";
import { Group, Tween, Easing } from '@tweenjs/tween.js';
import { ANIMATION, SCENE } from '../constants.js';
import { log } from '../utils/Logger.js';

/**
 * Camera configuration constants
 */
export const CAMERA_CONFIG = {
  FOV: 75,
  NEAR_PLANE_SCALE: 0.0001,
  FAR_PLANE_SCALE: 12000,
  ANGLE_HEIGHT_FACTOR: 0.5
};

/**
 * Distance configuration for camera calculations
 */
const DISTANCE_CONFIG = {
  // Base distance scales (applied to all calculations)
  SCENE_SCALE: SCENE.SCALE,

  // Camera distances (relative to body radius)
  CAMERA: {
    MIN_ZOOM_FACTOR: 2.0,           // Minimum zoom = bodyRadius * 2
    MAX_ZOOM_FACTOR: 100,           // Maximum zoom = bodyRadius * 100
    DEFAULT_MIN_SCALE: 0.0001,      // Default min for system-wide view
    DEFAULT_MAX_SCALE: 12000,       // Default max for system-wide view
    DIRECT_TARGET_FACTOR: 8,        // Direct targeting distance
    MAX_EXTENSION_FACTOR: 1.1,      // Extension factor for smooth transitions
    INITIAL_POSITION_FACTOR: 12000,  // Initial camera position (zoomed out to 1200 with SCENE.SCALE)
    TARGET_APPROACH_FACTOR: 0.05    // How close to zoom when targeting (5%)
  },

  // Visual effect distances (relative to body radius)
  EFFECTS: {
    // Bloom effect thresholds
    BLOOM: {
      DISABLE_FACTOR: 0.25,         // Disable bloom when closer than bodyRadius * 0.25
      FADE_START_FACTOR: 1.0,       // Start fading at bodyRadius * 1.0
      FADE_END_FACTOR: 0.2,         // Complete fade at bodyRadius * 0.2
      MAX_DISTANCE_FACTOR: 1000     // No bloom beyond bodyRadius * 1000
    },

    // Star visibility thresholds
    VISIBILITY: {
      MIN_FACTOR: 0.1,              // Always visible closer than bodyRadius * 0.1
      MAX_FACTOR: 5.0,              // Hidden beyond bodyRadius * 5.0
      FADE_RANGE_FACTOR: 2.0        // Fade transition range
    },

    // Glare effect thresholds
    GLARE: {
      FADE_START_FACTOR: 20,        // Glare starts fading at bodyRadius * 20
      FADE_END_FACTOR: 10,          // Glare disappears at bodyRadius * 10
      MIN_SCALE_FACTOR: 15,         // Minimum scale distance
      MAX_SCALE_FACTOR: 1000        // Maximum scale distance
    }
  },

  // Level-of-detail distances
  LOD: {
    CLOSE_THRESHOLD: 0.02,          // Close distance threshold
    FAR_THRESHOLD: 7000,            // Far distance threshold
    MIN_SEGMENTS: 64,               // Minimum detail segments
    MAX_SEGMENTS: 10000             // Maximum detail segments
  },

  // System-wide visibility
  SYSTEM: {
    VISIBILITY_THRESHOLD: 1200.0    // General visibility distance
  }
};

/**
 * Handles all camera movement, targeting, transitions, and zoom management
 */
export class CameraController {
    constructor(camera, controls, tweenGroup) {
        this.camera = camera;
        this.controls = controls;
        this.tweenGroup = tweenGroup;

        // Camera state
        this.target = null;
        this.isAnimating = false;
        this.currentTween = null;

        // CameraController initialized
    }

    /**
     * Sets control target to group (basic targeting, no animation)
     * @param {THREE.Group} group - The group to target
     */
    setTarget(group) {
        this.target = group;
        this.isAnimating = false;
        const worldPos = new THREE.Vector3();
        this.target.getWorldPosition(worldPos);
        this.controls.target.copy(worldPos);
        // Reset position tracking
        this.lastTargetPosition = null;
        // Basic target set
    }

    /**
     * Directly sets target without smooth transition
     * @param {THREE.Group} group - The group to target
     */
    setTargetDirect(group) {
        if (!group) {
            log.warn('CameraController', 'setTargetDirect - No group provided');
            return;
        }

        this.target = group;
        this.isAnimating = false;

        // Calculate good camera position using world coordinates
        const targetPos = new THREE.Vector3();
        group.getWorldPosition(targetPos);
        const bodyRadius = this._getBodyRadius(group);
        const radiusScale = this._getBodyRadiusScale(group);
        const { targetDistance } = CameraController.calculateCameraLimits(bodyRadius, radiusScale);
        const distance = targetDistance;

        // Position camera at a 45-degree angle above and behind the target
        const cameraPos = targetPos.clone().add(
            new THREE.Vector3(distance, distance * CAMERA_CONFIG.ANGLE_HEIGHT_FACTOR, distance)
        );

        this.camera.position.copy(cameraPos);
        this.controls.target.copy(targetPos);

        // Apply target-specific zoom limits for close-up targeting
        this.applyZoomLimits(group);
        this.controls.update();

        // Direct transition completed
    }

    /**
     * Smoothly transitions camera to follow a new target
     * @param {THREE.Group} group - The group to target
     * @param {number} duration - Animation duration in milliseconds
     */
    setTargetSmooth(group, duration = ANIMATION.DEFAULT_TRANSITION_DURATION) {
        if (!group) {
            log.warn('CameraController', 'setTargetSmooth - No group provided');
            return;
        }

        // Smoothly transitioning to target

        // Stop any existing animations to prevent conflicts
        this._stopCurrentAnimation();

        // Set animation flag to prevent render method interference
        this.isAnimating = true;

        const oldTarget = this.controls.target.clone();

        // Calculate current camera offset from old target and preserve it
        const initialOffset = new THREE.Vector3().subVectors(this.camera.position, oldTarget);
        const initialDistance = initialOffset.length();

        // Use consolidated distance system to calculate target distance
        const bodyRadius = this._getBodyRadius(group);
        const radiusScale = this._getBodyRadiusScale(group);
        const { targetDistance } = CameraController.calculateCameraLimits(bodyRadius, radiusScale);

        // Zoom transition configured

        // Apply zoom limits BEFORE animation starts to avoid snap at the end
        this.applyZoomLimits(group);

        // Store the normalized offset direction to maintain consistent camera angle
        const offsetDirection = initialOffset.clone().normalize();

        // Use TWEEN for smooth animation with moving target tracking
        const startPos = {
            targetX: oldTarget.x, targetY: oldTarget.y, targetZ: oldTarget.z,
            cameraX: this.camera.position.x, cameraY: this.camera.position.y, cameraZ: this.camera.position.z,
            progress: 0
        };

        const endPos = {
            targetX: 0, targetY: 0, targetZ: 0, // These will be calculated dynamically
            cameraX: 0, cameraY: 0, cameraZ: 0, // These will be calculated dynamically
            progress: 1
        };

        const tween = new Tween(startPos)
            .to(endPos, duration)
            .easing(Easing.Cubic.InOut)
            .onStart(() => {
                // TWEEN animation started
            })
            .onUpdate(() => {
                // Get the current world position of the moving target
                const currentTargetPos = new THREE.Vector3();
                group.getWorldPosition(currentTargetPos);

                // Interpolate between old target and current moving target
                const lerpedTarget = new THREE.Vector3().lerpVectors(oldTarget, currentTargetPos, startPos.progress);

                // Use consistent offset direction and smooth distance interpolation
                const currentDistance = THREE.MathUtils.lerp(initialDistance, targetDistance, startPos.progress);
                const cameraPos = lerpedTarget.clone().add(offsetDirection.clone().multiplyScalar(currentDistance));

                // Update camera and controls smoothly
                this.controls.target.copy(lerpedTarget);
                this.camera.position.copy(cameraPos);
            })
            .onComplete(() => {
                // Camera transition completed

                // Ensure the final target matches the body's current position
                const currentTargetPos = new THREE.Vector3();
                group.getWorldPosition(currentTargetPos);
                this.controls.target.copy(currentTargetPos);

                // Camera position should already be correct from tween - no need to recalculate

                // Now enable following - the offset should be consistent
                this.target = group;
                this.isAnimating = false;
                // Reset position tracking
                this.lastTargetPosition = null;

                // Zoom limits already applied before animation started

                // Clean up tween reference
                this._cleanupTween();
            });

        // Store reference to current tween and add to group
        this.currentTween = tween;
        this.tweenGroup.add(tween);

        // Starting TWEEN animation
        tween.start();
    }

    /**
     * Set target by name with orbit lookup (including Sun via virtual orbit)
     * @param {string} bodyName - Name of the body to target
     * @param {Array} orbits - Array of orbit objects (including Sun with virtual orbit)
     * @param {boolean} smooth - Whether to use smooth transition
     * @returns {Object|null} The target body if found
     */
    setTargetByName(bodyName, orbits, smooth = true) {
        // Find target body in orbits array (now includes Sun with virtual orbit)
        const targetBody = orbits.find(orbit =>
            orbit?.body?.name?.toLowerCase() === bodyName.toLowerCase()
        )?.body ?? null;

        if (targetBody) {
            if (smooth) {
                // Use smooth transition for all bodies including Sun
                this.setTargetSmooth(targetBody.group);
            } else {
                this.setTarget(targetBody.group);
                // Apply zoom limits for non-smooth transitions
                this.applyZoomLimits(targetBody.group);
            }
            log.camera(`Camera now following: ${bodyName}`);

            return targetBody;
        } else {
            log.warn('CameraController', `Body '${bodyName}' not found`);
            return null;
        }
    }

    /**
     * Calculate appropriate zoom limits for a celestial body
     * @param {THREE.Group} group - The celestial body group
     * @returns {Object} Object with minDistance and maxDistance properties
     */
    calculateZoomLimits(group) {
        const bodyRadius = this._getBodyRadius(group);
        const radiusScale = this._getBodyRadiusScale(group);

        // Use consolidated distance manager for consistent calculations
        return CameraController.calculateCameraLimits(bodyRadius, radiusScale);
    }

    /**
     * Apply zoom limits safely without causing sudden camera snapping
     * @param {THREE.Group} group - The celestial body group
     */
    applyZoomLimits(group) {
        const { minDistance, maxDistance } = this.calculateZoomLimits(group);
        const currentDistance = this.camera.position.distanceTo(this.controls.target);

        // Apply minimum distance immediately (users expect close zoom limits)
        this.controls.minDistance = minDistance;

        // Use consolidated transition parameters to handle max distance smoothly
        const transitionParams = CameraController.calculateTransitionParams(currentDistance, maxDistance);

        if (transitionParams.shouldExtend) {
            this.controls.maxDistance = transitionParams.extendedMax;
        } else {
            this.controls.maxDistance = maxDistance;
        }
    }


    /**
     * Reset camera to initial position and clear all targeting/following
     */
    resetCamera() {
        log.camera('Resetting camera to initial position');

        // Stop any active animations
        this._stopCurrentAnimation();

        // Clear target following
        this.target = null;
        this.isAnimating = false;
        // Clear position tracking
        this.lastTargetPosition = null;

        // Reset camera to initial position and zoom level using consolidated system
        const systemDefaults = CameraController.getSystemDefaults();

        this.camera.position.set(0, systemDefaults.initialPosition, systemDefaults.initialPosition);
        this.controls.target.set(0, 0, 0);

        // Reset zoom limits to default wide range
        this.controls.minDistance = systemDefaults.minDistance;
        this.controls.maxDistance = systemDefaults.maxDistance;

        // Force controls to update and reset internal distance tracking
        this.controls.update();

        log.camera('Camera reset completed');
    }

    /**
     * Reset camera to initial position with smooth animation
     * @param {number} duration - Animation duration in milliseconds
     */
    resetCameraSmooth(duration = ANIMATION.DEFAULT_TRANSITION_DURATION) {
        // Stop any active animations
        this._stopCurrentAnimation();

        // Set animation flag
        this.isAnimating = true;

        // Calculate initial and target positions
        const initialCameraPos = this.camera.position.clone();
        const initialTarget = this.controls.target.clone();

        // Use consolidated system for animated reset positions
        const systemDefaults = CameraController.getSystemDefaults();

        const targetCameraPos = new THREE.Vector3(0, systemDefaults.initialPosition, systemDefaults.initialPosition);
        const targetControlsTarget = new THREE.Vector3(0, 0, 0);

        // Set up zoom limits immediately for the reset position
        this.controls.minDistance = systemDefaults.minDistance;
        this.controls.maxDistance = systemDefaults.maxDistance;

        // Create tween for smooth animation
        const startPos = {
            cameraX: initialCameraPos.x, cameraY: initialCameraPos.y, cameraZ: initialCameraPos.z,
            targetX: initialTarget.x, targetY: initialTarget.y, targetZ: initialTarget.z
        };

        const endPos = {
            cameraX: targetCameraPos.x, cameraY: targetCameraPos.y, cameraZ: targetCameraPos.z,
            targetX: targetControlsTarget.x, targetY: targetControlsTarget.y, targetZ: targetControlsTarget.z
        };

        const tween = new Tween(startPos)
            .to(endPos, duration)
            .easing(Easing.Cubic.InOut)
            .onUpdate(() => {
                // Update camera and controls positions smoothly
                this.camera.position.set(startPos.cameraX, startPos.cameraY, startPos.cameraZ);
                this.controls.target.set(startPos.targetX, startPos.targetY, startPos.targetZ);
            })
            .onComplete(() => {
                // Clear target following
                this.target = null;
                this.isAnimating = false;

                // Ensure final positions are exactly correct
                this.camera.position.copy(targetCameraPos);
                this.controls.target.copy(targetControlsTarget);

                // Force controls to update and reset internal distance tracking
                this.controls.update();

                // Clean up tween reference
                this._cleanupTween();
            });

        // Store reference to current tween and add to group
        this.currentTween = tween;
        this.tweenGroup.add(tween);
        tween.start();
    }

    /**
     * Update camera following behavior during render
     */
    updateFollowing() {
        // Enable camera following when target is set and not animating
        if (this.target && !this.isAnimating) {
            // Get world position for targets that might be in parent's local space
            const currentTargetPos = new THREE.Vector3();
            this.target.getWorldPosition(currentTargetPos);

            if (this.lastTargetPosition) {
                // Calculate how much the planet moved in world space
                const deltaMovement = new THREE.Vector3().subVectors(currentTargetPos, this.lastTargetPosition);

                // Move both camera and controls target by the same amount
                this.camera.position.add(deltaMovement);
                this.controls.target.add(deltaMovement);
            } else {
                // First frame - just set the controls target
                this.controls.target.copy(currentTargetPos);
            }

            // Store current position for next frame
            this.lastTargetPosition = currentTargetPos.clone();
        }
    }

    /**
     * Check if camera is currently animating
     * @returns {boolean} True if animating
     */
    isCurrentlyAnimating() {
        return this.isAnimating;
    }

    /**
     * Get the current target
     * @returns {THREE.Group|null} Current target group
     */
    getCurrentTarget() {
        return this.target;
    }

    /**
     * Stop current animation and clean up
     * @private
     */
    _stopCurrentAnimation() {
        if (this.currentTween) {
            this.currentTween.stop();
        }
        this.tweenGroup.removeAll();
    }

    /**
     * Clean up tween reference
     * @private
     */
    _cleanupTween() {
        if (this.currentTween) {
            this.tweenGroup.remove(this.currentTween);
        }
        this.currentTween = null;
    }

    /**
     * Get body radius with fallback
     * @param {THREE.Group} group - The celestial body group
     * @returns {number} Body radius
     * @private
     */
    _getBodyRadius(group) {
        return group.children[0]?.children[0]?.geometry?.parameters?.radius || SCENE.DEFAULT_RADIUS_FALLBACK;
    }

    /**
     * Get the radius scale of a celestial body (for stars and scaled objects)
     * @param {THREE.Group} group - The celestial body group
     * @returns {number} The radius scale multiplier
     */
    _getBodyRadiusScale(group) {
        // Check if this is a star or has radius scale data
        const bodyData = group.userData?.bodyData;
        return bodyData?.radiusScale || 1.0;
    }

    /**
     * Initialize camera to system-wide position with proper zoom limits
     * @param {Object} sun - Sun object for calculating zoom limits
     */
    initializeCamera(sun) {
        if (sun && sun.group) {
            const bodyRadius = sun.group.children[0]?.children[0]?.geometry?.parameters?.radius || 1;
            const { minDistance, maxDistance } = CameraController.calculateCameraLimits(bodyRadius);

            // Start camera at max distance for good system overview
            this.camera.position.set(0, maxDistance, maxDistance);
            this.controls.target.set(0, 0, 0);

            // Apply zoom limits
            this.controls.minDistance = minDistance;
            this.controls.maxDistance = maxDistance;

            // Set initial target
            this.setTarget(sun.group);
        }
    }

    /**
     * Clean up resources
     */
    dispose() {
        this._stopCurrentAnimation();
        this.target = null;
        this.camera = null;
        this.controls = null;
        this.tweenGroup = null;
        log.dispose('CameraController', 'Disposed');
    }

    // Static distance calculation methods
    /**
     * Calculate camera zoom limits based on body radius
     * @param {number} bodyRadius - The radius of the celestial body
     * @param {number} radiusScale - Optional radius scale multiplier
     * @returns {Object} Object with minDistance, maxDistance, and targetDistance
     */
    static calculateCameraLimits(bodyRadius, radiusScale = 1) {
        const effectiveRadius = bodyRadius * radiusScale;

        return {
            minDistance: effectiveRadius * DISTANCE_CONFIG.CAMERA.MIN_ZOOM_FACTOR,
            maxDistance: DISTANCE_CONFIG.CAMERA.DEFAULT_MAX_SCALE * DISTANCE_CONFIG.SCENE_SCALE,
            targetDistance: effectiveRadius * DISTANCE_CONFIG.CAMERA.DIRECT_TARGET_FACTOR
        };
    }

    /**
     * Calculate effect distances for bloom, visibility, etc.
     * @param {number} bodyRadius - The radius of the celestial body
     * @param {number} radiusScale - Optional radius scale multiplier
     * @returns {Object} Object with all effect distance thresholds
     */
    static calculateEffectDistances(bodyRadius, radiusScale = 1) {
        const effectiveRadius = bodyRadius * radiusScale;

        return {
            bloom: {
                disable: effectiveRadius * DISTANCE_CONFIG.EFFECTS.BLOOM.DISABLE_FACTOR,
                fadeStart: effectiveRadius * DISTANCE_CONFIG.EFFECTS.BLOOM.FADE_START_FACTOR,
                fadeEnd: effectiveRadius * DISTANCE_CONFIG.EFFECTS.BLOOM.FADE_END_FACTOR,
                maxDistance: effectiveRadius * DISTANCE_CONFIG.EFFECTS.BLOOM.MAX_DISTANCE_FACTOR
            },
            visibility: {
                min: effectiveRadius * DISTANCE_CONFIG.EFFECTS.VISIBILITY.MIN_FACTOR,
                max: effectiveRadius * DISTANCE_CONFIG.EFFECTS.VISIBILITY.MAX_FACTOR,
                fadeRange: effectiveRadius * DISTANCE_CONFIG.EFFECTS.VISIBILITY.FADE_RANGE_FACTOR
            },
            glare: {
                fadeStart: effectiveRadius * DISTANCE_CONFIG.EFFECTS.GLARE.FADE_START_FACTOR,
                fadeEnd: effectiveRadius * DISTANCE_CONFIG.EFFECTS.GLARE.FADE_END_FACTOR,
                minScale: effectiveRadius * DISTANCE_CONFIG.EFFECTS.GLARE.MIN_SCALE_FACTOR,
                maxScale: effectiveRadius * DISTANCE_CONFIG.EFFECTS.GLARE.MAX_SCALE_FACTOR
            }
        };
    }

    /**
     * Calculate default system-wide camera limits
     * @returns {Object} System-wide camera limits
     */
    static getSystemDefaults() {
        return {
            minDistance: DISTANCE_CONFIG.CAMERA.DEFAULT_MIN_SCALE * DISTANCE_CONFIG.SCENE_SCALE,
            maxDistance: DISTANCE_CONFIG.CAMERA.DEFAULT_MAX_SCALE * DISTANCE_CONFIG.SCENE_SCALE,
            initialPosition: DISTANCE_CONFIG.CAMERA.INITIAL_POSITION_FACTOR * DISTANCE_CONFIG.SCENE_SCALE
        };
    }

    /**
     * Calculate smooth transition parameters
     * @param {number} currentDistance - Current camera distance
     * @param {number} maxDistance - Maximum allowed distance
     * @returns {Object} Transition parameters
     */
    static calculateTransitionParams(currentDistance, maxDistance) {
        const extensionFactor = DISTANCE_CONFIG.CAMERA.MAX_EXTENSION_FACTOR;

        return {
            shouldExtend: currentDistance > maxDistance,
            extendedMax: Math.max(currentDistance * extensionFactor, maxDistance),
            approachFactor: DISTANCE_CONFIG.CAMERA.TARGET_APPROACH_FACTOR
        };
    }

    /**
     * Calculate LOD (Level of Detail) parameters
     * @param {number} distance - Camera distance to object
     * @returns {Object} LOD parameters
     */
    static calculateLOD(distance) {
        const { CLOSE_THRESHOLD, FAR_THRESHOLD, MIN_SEGMENTS, MAX_SEGMENTS } = DISTANCE_CONFIG.LOD;

        if (distance <= CLOSE_THRESHOLD) {
            return { segments: MAX_SEGMENTS, detail: 'high' };
        } else if (distance >= FAR_THRESHOLD) {
            return { segments: MIN_SEGMENTS, detail: 'low' };
        } else {
            // Interpolate between min and max segments
            const ratio = (distance - CLOSE_THRESHOLD) / (FAR_THRESHOLD - CLOSE_THRESHOLD);
            const segments = Math.round(MAX_SEGMENTS - (ratio * (MAX_SEGMENTS - MIN_SEGMENTS)));
            return { segments, detail: 'medium' };
        }
    }

    /**
     * Normalize distance value with consistent scaling
     * @param {number} distance - Raw distance value
     * @param {number} referenceRadius - Reference body radius for scaling
     * @returns {number} Normalized distance
     */
    static normalizeDistance(distance, referenceRadius = 1) {
        return distance / (referenceRadius * DISTANCE_CONFIG.SCENE_SCALE);
    }

    /**
     * Get all distance thresholds for a given body
     * @param {number} bodyRadius - Body radius
     * @param {number} radiusScale - Optional radius scale
     * @returns {Object} Complete distance configuration for the body
     */
    static getAllDistances(bodyRadius, radiusScale = 1) {
        return {
            camera: this.calculateCameraLimits(bodyRadius, radiusScale),
            effects: this.calculateEffectDistances(bodyRadius, radiusScale),
            system: this.getSystemDefaults()
        };
    }
}

export default CameraController;