import * as THREE from "three";
import { Group, Tween, Easing } from '@tweenjs/tween.js';
import { ANIMATION, SCENE } from '../constants.js';
import { log } from '../utils/Logger.js';

export const CAMERA_CONFIG = {
  FOV: 75,
  NEAR_PLANE_SCALE: 0.0001,
  FAR_PLANE_SCALE: 12000,
  ANGLE_HEIGHT_FACTOR: 0.5
};

const DISTANCE_CONFIG = {
  SCENE_SCALE: SCENE.SCALE,

  CAMERA: {
    MIN_ZOOM_FACTOR: 2.0,
    MAX_ZOOM_FACTOR: 100,
    DEFAULT_MIN_SCALE: 0.0001,
    DEFAULT_MAX_SCALE: 12000,
    DIRECT_TARGET_FACTOR: 8,
    MAX_EXTENSION_FACTOR: 1.1,
    INITIAL_POSITION_FACTOR: 12000,
    TARGET_APPROACH_FACTOR: 0.05
  },

  EFFECTS: {
    BLOOM: {
      DISABLE_FACTOR: 0.25,
      FADE_START_FACTOR: 1.0,
      FADE_END_FACTOR: 0.2,
      MAX_DISTANCE_FACTOR: 1000
    },

    VISIBILITY: {
      MIN_FACTOR: 0.1,
      MAX_FACTOR: 5.0,
      FADE_RANGE_FACTOR: 2.0
    },

    GLARE: {
      FADE_START_FACTOR: 20,
      FADE_END_FACTOR: 10,
      MIN_SCALE_FACTOR: 15,
      MAX_SCALE_FACTOR: 1000
    }
  },

  LOD: {
    CLOSE_THRESHOLD: 0.02,
    FAR_THRESHOLD: 7000,
    MIN_SEGMENTS: 64,
    MAX_SEGMENTS: 10000
  },

  SYSTEM: {
    VISIBILITY_THRESHOLD: 1200.0
  }
};

export class CameraController {
    constructor(camera, controls, tweenGroup) {
        this.camera = camera;
        this.controls = controls;
        this.tweenGroup = tweenGroup;

        this.target = null;
        this.isAnimating = false;
        this.currentTween = null;
    }

    setTarget(group) {
        this.target = group;
        this.isAnimating = false;
        const worldPos = new THREE.Vector3();
        this.target.getWorldPosition(worldPos);
        this.controls.target.copy(worldPos);
        this.lastTargetPosition = null;
    }

    setTargetDirect(group) {
        if (!group) {
            log.warn('CameraController', 'setTargetDirect - No group provided');
            return;
        }

        this.target = group;
        this.isAnimating = false;

        const targetPos = new THREE.Vector3();
        group.getWorldPosition(targetPos);
        const bodyRadius = this._getBodyRadius(group);
        const radiusScale = this._getBodyRadiusScale(group);
        const { targetDistance } = CameraController.calculateCameraLimits(bodyRadius, radiusScale);
        const distance = targetDistance;

        const cameraPos = targetPos.clone().add(
            new THREE.Vector3(distance, distance * CAMERA_CONFIG.ANGLE_HEIGHT_FACTOR, distance)
        );

        this.camera.position.copy(cameraPos);
        this.controls.target.copy(targetPos);

        this.applyZoomLimits(group);
        this.controls.update();
    }

    setTargetSmooth(group, duration = ANIMATION.DEFAULT_TRANSITION_DURATION) {
        if (!group) {
            log.warn('CameraController', 'setTargetSmooth - No group provided');
            return;
        }

        this._stopCurrentAnimation();

        this.isAnimating = true;

        const oldTarget = this.controls.target.clone();

        const initialOffset = new THREE.Vector3().subVectors(this.camera.position, oldTarget);
        const initialDistance = initialOffset.length();

        const bodyRadius = this._getBodyRadius(group);
        const radiusScale = this._getBodyRadiusScale(group);
        const { targetDistance } = CameraController.calculateCameraLimits(bodyRadius, radiusScale);

        this.applyZoomLimits(group);

        const offsetDirection = initialOffset.clone().normalize();

        const startPos = {
            targetX: oldTarget.x, targetY: oldTarget.y, targetZ: oldTarget.z,
            cameraX: this.camera.position.x, cameraY: this.camera.position.y, cameraZ: this.camera.position.z,
            progress: 0
        };

        const endPos = {
            targetX: 0, targetY: 0, targetZ: 0,
            cameraX: 0, cameraY: 0, cameraZ: 0,
            progress: 1
        };

        const tween = new Tween(startPos)
            .to(endPos, duration)
            .easing(Easing.Cubic.InOut)
            .onStart(() => {
            })
            .onUpdate(() => {
                const currentTargetPos = new THREE.Vector3();
                group.getWorldPosition(currentTargetPos);

                const lerpedTarget = new THREE.Vector3().lerpVectors(oldTarget, currentTargetPos, startPos.progress);

                const currentDistance = THREE.MathUtils.lerp(initialDistance, targetDistance, startPos.progress);
                const cameraPos = lerpedTarget.clone().add(offsetDirection.clone().multiplyScalar(currentDistance));

                this.controls.target.copy(lerpedTarget);
                this.camera.position.copy(cameraPos);
            })
            .onComplete(() => {
                const currentTargetPos = new THREE.Vector3();
                group.getWorldPosition(currentTargetPos);
                this.controls.target.copy(currentTargetPos);

                this.target = group;
                this.isAnimating = false;
                this.lastTargetPosition = null;

                this._cleanupTween();
            });

        this.currentTween = tween;
        this.tweenGroup.add(tween);

        tween.start();
    }

    setTargetByName(bodyName, orbits, smooth = true) {
        const targetBody = orbits.find(orbit =>
            orbit?.body?.name?.toLowerCase() === bodyName.toLowerCase()
        )?.body ?? null;

        if (targetBody) {
            if (smooth) {
                this.setTargetSmooth(targetBody.group);
            } else {
                this.setTarget(targetBody.group);
                this.applyZoomLimits(targetBody.group);
            }
            log.camera(`Camera now following: ${bodyName}`);

            return targetBody;
        } else {
            log.warn('CameraController', `Body '${bodyName}' not found`);
            return null;
        }
    }

    calculateZoomLimits(group) {
        const bodyRadius = this._getBodyRadius(group);
        const radiusScale = this._getBodyRadiusScale(group);

        return CameraController.calculateCameraLimits(bodyRadius, radiusScale);
    }

    applyZoomLimits(group) {
        const { minDistance, maxDistance } = this.calculateZoomLimits(group);
        const currentDistance = this.camera.position.distanceTo(this.controls.target);

        this.controls.minDistance = minDistance;

        const transitionParams = CameraController.calculateTransitionParams(currentDistance, maxDistance);

        if (transitionParams.shouldExtend) {
            this.controls.maxDistance = transitionParams.extendedMax;
        } else {
            this.controls.maxDistance = maxDistance;
        }
    }

    resetCamera() {
        log.camera('Resetting camera to initial position');

        this._stopCurrentAnimation();

        this.target = null;
        this.isAnimating = false;
        this.lastTargetPosition = null;

        const systemDefaults = CameraController.getSystemDefaults();

        this.camera.position.set(0, systemDefaults.initialPosition, systemDefaults.initialPosition);
        this.controls.target.set(0, 0, 0);

        this.controls.minDistance = systemDefaults.minDistance;
        this.controls.maxDistance = systemDefaults.maxDistance;

        this.controls.update();

        log.camera('Camera reset completed');
    }

    resetCameraSmooth(duration = ANIMATION.DEFAULT_TRANSITION_DURATION) {
        this._stopCurrentAnimation();

        this.isAnimating = true;

        const initialCameraPos = this.camera.position.clone();
        const initialTarget = this.controls.target.clone();

        const systemDefaults = CameraController.getSystemDefaults();

        const targetCameraPos = new THREE.Vector3(0, systemDefaults.initialPosition, systemDefaults.initialPosition);
        const targetControlsTarget = new THREE.Vector3(0, 0, 0);

        this.controls.minDistance = systemDefaults.minDistance;
        this.controls.maxDistance = systemDefaults.maxDistance;

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
                this.camera.position.set(startPos.cameraX, startPos.cameraY, startPos.cameraZ);
                this.controls.target.set(startPos.targetX, startPos.targetY, startPos.targetZ);
            })
            .onComplete(() => {
                this.target = null;
                this.isAnimating = false;

                this.camera.position.copy(targetCameraPos);
                this.controls.target.copy(targetControlsTarget);

                this.controls.update();

                this._cleanupTween();
            });

        this.currentTween = tween;
        this.tweenGroup.add(tween);
        tween.start();
    }

    updateFollowing() {
        if (this.target && !this.isAnimating) {
            const currentTargetPos = new THREE.Vector3();
            this.target.getWorldPosition(currentTargetPos);

            if (this.lastTargetPosition) {
                const deltaMovement = new THREE.Vector3().subVectors(currentTargetPos, this.lastTargetPosition);

                this.camera.position.add(deltaMovement);
                this.controls.target.add(deltaMovement);
            } else {
                this.controls.target.copy(currentTargetPos);
            }

            this.lastTargetPosition = currentTargetPos.clone();
        }
    }

    isCurrentlyAnimating() {
        return this.isAnimating;
    }

    getCurrentTarget() {
        return this.target;
    }

    _stopCurrentAnimation() {
        if (this.currentTween) {
            this.currentTween.stop();
        }
        this.tweenGroup.removeAll();
    }

    _cleanupTween() {
        if (this.currentTween) {
            this.tweenGroup.remove(this.currentTween);
        }
        this.currentTween = null;
    }

    _getBodyRadius(group) {
        return group.children[0]?.children[0]?.geometry?.parameters?.radius || SCENE.DEFAULT_RADIUS_FALLBACK;
    }

    _getBodyRadiusScale(group) {
        const bodyData = group.userData?.bodyData;
        return bodyData?.radiusScale || 1.0;
    }

    initializeCamera(sun) {
        if (sun && sun.group) {
            const bodyRadius = sun.group.children[0]?.children[0]?.geometry?.parameters?.radius || 1;
            const { minDistance, maxDistance } = CameraController.calculateCameraLimits(bodyRadius);

            this.camera.position.set(0, maxDistance, maxDistance);
            this.controls.target.set(0, 0, 0);

            this.controls.minDistance = minDistance;
            this.controls.maxDistance = maxDistance;

            this.setTarget(sun.group);
        }
    }

    dispose() {
        this._stopCurrentAnimation();
        this.target = null;
        this.camera = null;
        this.controls = null;
        this.tweenGroup = null;
        log.dispose('CameraController', 'Disposed');
    }

    static calculateCameraLimits(bodyRadius, radiusScale = 1) {
        const effectiveRadius = bodyRadius * radiusScale;

        return {
            minDistance: effectiveRadius * DISTANCE_CONFIG.CAMERA.MIN_ZOOM_FACTOR,
            maxDistance: DISTANCE_CONFIG.CAMERA.DEFAULT_MAX_SCALE * DISTANCE_CONFIG.SCENE_SCALE,
            targetDistance: effectiveRadius * DISTANCE_CONFIG.CAMERA.DIRECT_TARGET_FACTOR
        };
    }

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

    static getSystemDefaults() {
        return {
            minDistance: DISTANCE_CONFIG.CAMERA.DEFAULT_MIN_SCALE * DISTANCE_CONFIG.SCENE_SCALE,
            maxDistance: DISTANCE_CONFIG.CAMERA.DEFAULT_MAX_SCALE * DISTANCE_CONFIG.SCENE_SCALE,
            initialPosition: DISTANCE_CONFIG.CAMERA.INITIAL_POSITION_FACTOR * DISTANCE_CONFIG.SCENE_SCALE
        };
    }

    static calculateTransitionParams(currentDistance, maxDistance) {
        const extensionFactor = DISTANCE_CONFIG.CAMERA.MAX_EXTENSION_FACTOR;

        return {
            shouldExtend: currentDistance > maxDistance,
            extendedMax: Math.max(currentDistance * extensionFactor, maxDistance),
            approachFactor: DISTANCE_CONFIG.CAMERA.TARGET_APPROACH_FACTOR
        };
    }

    static calculateLOD(distance) {
        const { CLOSE_THRESHOLD, FAR_THRESHOLD, MIN_SEGMENTS, MAX_SEGMENTS } = DISTANCE_CONFIG.LOD;

        if (distance <= CLOSE_THRESHOLD) {
            return { segments: MAX_SEGMENTS, detail: 'high' };
        } else if (distance >= FAR_THRESHOLD) {
            return { segments: MIN_SEGMENTS, detail: 'low' };
        } else {
            const ratio = (distance - CLOSE_THRESHOLD) / (FAR_THRESHOLD - CLOSE_THRESHOLD);
            const segments = Math.round(MAX_SEGMENTS - (ratio * (MAX_SEGMENTS - MIN_SEGMENTS)));
            return { segments, detail: 'medium' };
        }
    }

    static normalizeDistance(distance, referenceRadius = 1) {
        return distance / (referenceRadius * DISTANCE_CONFIG.SCENE_SCALE);
    }

    static getAllDistances(bodyRadius, radiusScale = 1) {
        return {
            camera: this.calculateCameraLimits(bodyRadius, radiusScale),
            effects: this.calculateEffectDistances(bodyRadius, radiusScale),
            system: this.getSystemDefaults()
        };
    }
}

export default CameraController;