import * as THREE from "three";
import { Tween, Easing } from '@tweenjs/tween.js';
import { ANIMATION, SCENE } from '../constants.js';
import { log } from '../utils/Logger.js';

/**
 * Camera setup values.
 *
 * The clip planes are given as multiples of the scene scale rather than absolute distances,
 * because the depth range needed here is enormous — from a moon's surface out past the
 * outermost orbit — and it has to track the scale rather than be restated whenever the
 * scale changes.
 *
 * @type {{FOV: number, NEAR_PLANE_SCALE: number, FAR_PLANE_SCALE: number,
 *   ANGLE_HEIGHT_FACTOR: number}}
 */
export const CAMERA_CONFIG = {
  FOV: 75,
  NEAR_PLANE_SCALE: 0.0001,
  FAR_PLANE_SCALE: 12000,
  ANGLE_HEIGHT_FACTOR: 0.5
};

/**
 * Distance thresholds, as factors to be multiplied by a body's radius or the scene scale.
 *
 * Everything here is relative rather than absolute, which is what lets the same numbers work
 * for a moon and for a star: a zoom limit of "twice the radius" means something sensible at
 * either extreme, where a fixed distance in scene units would put the camera inside one body
 * and a long way from the other.
 *
 * Only `SCENE_SCALE` and `CAMERA` are read here; `EFFECTS`, `LOD` and `SYSTEM` are not
 * currently used by anything, the corresponding live values having moved into
 * {@link constants.js}.
 *
 * @type {Object}
 */
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

/**
 * Moves the camera, and keeps it following whatever body is selected.
 *
 * Two things make this more than a wrapper around `OrbitControls`.
 *
 * The first is that the zoom limits cannot be fixed. A body's sensible viewing distance is a
 * multiple of its own radius, and the bodies here differ in radius by several orders of
 * magnitude, so the limits are recomputed from the target whenever it changes.
 *
 * The second is following a moving target. The bodies orbit, so the camera has to move with
 * the one it is watching — but the viewer's own orbiting and zooming has to survive that. So
 * following applies the target's *change* in position to both the camera and the orbit
 * centre, rather than pointing the camera at the target: the viewer's chosen angle and
 * distance are preserved exactly, and the body simply stays put in frame.
 *
 * Transitions between bodies are tweened, since cutting between two bodies gives the viewer
 * nothing to connect them by. Only one tween runs at a time; starting another stops the one
 * in flight.
 */
export class CameraController {
    /**
     * Stores the camera and controls it will drive.
     *
     * @param {THREE.PerspectiveCamera} camera - The camera.
     * @param {OrbitControls} controls - The orbit controls, whose target doubles as the
     *   camera's look-at point.
     * @param {import('@tweenjs/tween.js').Group} tweenGroup - Tween group the transitions are
     *   registered with; it is what the animation loop steps.
     */
    constructor(camera, controls, tweenGroup) {
        this.camera = camera;
        this.controls = controls;
        this.tweenGroup = tweenGroup;

        this.target = null;
        this.isAnimating = false;
        this.currentTween = null;
    }

    /**
     * Snaps the camera's focus to a body.
     *
     * The last known target position is cleared, so the first
     * {@link CameraController#updateFollowing} after this settles the orbit centre on the
     * body rather than applying a bogus delta measured from wherever the previous target was.
     *
     * @param {THREE.Group} group - The body's group.
     * @returns {void}
     */
    setTarget(group) {
        this.target = group;
        this.isAnimating = false;
        const worldPos = new THREE.Vector3();
        this.target.getWorldPosition(worldPos);
        this.controls.target.copy(worldPos);
        this.lastTargetPosition = null;
    }

    /**
     * Flies the camera to a body.
     *
     * The target's world position is re-read on every frame of the tween, not sampled once at
     * the start: the body is orbiting throughout the flight, and interpolating towards a stale
     * position would arrive somewhere the body has since left.
     *
     * The camera's direction from the target is held fixed and only its distance interpolated,
     * so the viewer keeps the viewing angle they had chosen and the transition reads as an
     * approach rather than a swing.
     *
     * The zoom limits are applied at the start rather than on arrival, so the viewer can take
     * over mid-flight without the controls briefly enforcing the old body's limits.
     *
     * @param {THREE.Group} group - The body's group.
     * @param {number} [duration] - Flight time in milliseconds.
     * @returns {void}
     */
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

    /**
     * Focuses the body with a given name.
     *
     * The comparison is case-insensitive, since the names come from user input and URL
     * parameters as much as from code.
     *
     * @param {string} bodyName - The body's name.
     * @param {Orbit[]} orbits - The orbits to search.
     * @param {boolean} [smooth=true] - Fly there rather than cutting.
     * @returns {Body|null} The body focused, or `null` if no body has that name.
     */
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

    /**
     * Works out the zoom limits for a body.
     *
     * @param {THREE.Group} group - The body's group.
     * @returns {{minDistance: number, maxDistance: number, targetDistance: number}} Closest
     *   and furthest the camera may get, and the distance a flight should end at.
     */
    calculateZoomLimits(group) {
        const bodyRadius = this._getBodyRadius(group);
        const radiusScale = this._getBodyRadiusScale(group);

        return CameraController.calculateCameraLimits(bodyRadius, radiusScale);
    }

    /**
     * Sets the controls' zoom limits for a body.
     *
     * If the camera is already beyond the new maximum, the maximum is raised to just past
     * where the camera is instead of being enforced. Otherwise selecting a distant body while
     * zoomed far out would yank the camera inwards, which reads as the app fighting the
     * viewer.
     *
     * @param {THREE.Group} group - The body's group.
     * @returns {void}
     */
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

    /**
     * Snaps the camera back to the whole-system view.
     *
     * The target is cleared, so nothing is followed and the camera stays put while the system
     * turns beneath it.
     *
     * @returns {void}
     */
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

    /**
     * Flies the camera back to the whole-system view.
     *
     * Simpler than {@link CameraController#setTargetSmooth}, since the destination is a fixed
     * point that does not move while the flight is under way.
     *
     * The limits are widened at the start, not on arrival, so the outward flight is not
     * clamped by the limits of the body being left.
     *
     * @param {number} [duration] - Flight time in milliseconds.
     * @returns {void}
     */
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

    /**
     * Carries the camera along with the body it is following.
     *
     * The body's movement since the last frame is added to both the camera and the orbit
     * centre. That is the whole point: the viewer's angle and distance are untouched, so a
     * body being followed sits still in frame while the viewer remains free to orbit it.
     * Pointing the camera at the body each frame instead would override every rotation the
     * viewer made.
     *
     * Skipped while a transition is running, since the tween is driving the camera itself.
     *
     * @returns {void}
     */
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

    /**
     * The group currently being followed.
     *
     * @returns {THREE.Group|null} The target, or `null` in the whole-system view.
     */
    getCurrentTarget() {
        return this.target;
    }

    /**
     * Stops any transition in flight.
     *
     * The whole group is emptied, not just the current tween, so a tween that somehow escaped
     * being tracked cannot keep driving the camera against a new one.
     *
     * @private
     * @returns {void}
     */
    _stopCurrentAnimation() {
        if (this.currentTween) {
            this.currentTween.stop();
        }
        this.tweenGroup.removeAll();
    }

    /**
     * Drops a finished tween from the group.
     *
     * @private
     * @returns {void}
     */
    _cleanupTween() {
        if (this.currentTween) {
            this.tweenGroup.remove(this.currentTween);
        }
        this.currentTween = null;
    }

    /**
     * Digs a body's radius out of its group.
     *
     * Reaches through the group's structure — container, then mesh — to read the sphere
     * geometry's own radius, which is the one number guaranteed to match what is actually on
     * screen whatever the level of detail has done to the tessellation. Falls back to a
     * default if the structure is not as expected, so an unusual body cannot break camera
     * framing.
     *
     * @private
     * @param {THREE.Group} group - The body's group.
     * @returns {number} The radius in scene units.
     */
    _getBodyRadius(group) {
        return group.children[0]?.children[0]?.geometry?.parameters?.radius || SCENE.DEFAULT_RADIUS_FALLBACK;
    }

    /**
     * The body's radius scale, if it has one.
     *
     * @private
     * @param {THREE.Group} group - The body's group.
     * @returns {number} The scale, or 1 if unset.
     */
    _getBodyRadiusScale(group) {
        const bodyData = group.userData?.bodyData;
        return bodyData?.radiusScale || 1.0;
    }

    /**
     * Places the camera for the opening view.
     *
     * Starts at the outer zoom limit, looking at the origin, with the star as the target — so
     * the whole system is in frame on the first frame and the viewer can zoom straight in
     * without having to find anything first.
     *
     * Does nothing without a star, since there would be nothing to frame the view around.
     *
     * @param {Body} sun - The system's star.
     * @returns {void}
     */
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

    /**
     * Stops any transition and drops the references held.
     *
     * @returns {void}
     */
    dispose() {
        this._stopCurrentAnimation();
        this.target = null;
        this.camera = null;
        this.controls = null;
        this.tweenGroup = null;
        log.dispose('CameraController', 'Disposed');
    }

    /**
     * Turns a body's radius into camera distances.
     *
     * The minimum and the flight destination are multiples of the body's own radius, so a moon
     * and a star are both framed sensibly. The maximum is not — it is the whole scene's outer
     * limit, since the viewer should always be able to pull back far enough to see the entire
     * system regardless of what is selected.
     *
     * @param {number} bodyRadius - The body's radius in scene units.
     * @param {number} [radiusScale=1] - Additional scale applied to the body.
     * @returns {{minDistance: number, maxDistance: number, targetDistance: number}} Closest
     *   and furthest the camera may get, and the distance a flight should end at.
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
     * Camera distances for the whole-system view, with no body selected.
     *
     * @returns {{minDistance: number, maxDistance: number, initialPosition: number}} Zoom
     *   limits and the opening distance from the origin.
     */
    static getSystemDefaults() {
        return {
            minDistance: DISTANCE_CONFIG.CAMERA.DEFAULT_MIN_SCALE * DISTANCE_CONFIG.SCENE_SCALE,
            maxDistance: DISTANCE_CONFIG.CAMERA.DEFAULT_MAX_SCALE * DISTANCE_CONFIG.SCENE_SCALE,
            initialPosition: DISTANCE_CONFIG.CAMERA.INITIAL_POSITION_FACTOR * DISTANCE_CONFIG.SCENE_SCALE
        };
    }

    /**
     * Decides whether a body's outer zoom limit needs relaxing.
     *
     * The extension is a little past where the camera already is, rather than exactly at it,
     * leaving some room to pull back further — a limit set precisely at the current distance
     * would feel like hitting a wall.
     *
     * @param {number} currentDistance - Camera's current distance from the orbit centre.
     * @param {number} maxDistance - The limit that would otherwise apply.
     * @returns {{shouldExtend: boolean, extendedMax: number, approachFactor: number}} Whether
     *   to relax the limit, what to relax it to, and the approach factor.
     */
    static calculateTransitionParams(currentDistance, maxDistance) {
        const extensionFactor = DISTANCE_CONFIG.CAMERA.MAX_EXTENSION_FACTOR;

        return {
            shouldExtend: currentDistance > maxDistance,
            extendedMax: Math.max(currentDistance * extensionFactor, maxDistance),
            approachFactor: DISTANCE_CONFIG.CAMERA.TARGET_APPROACH_FACTOR
        };
    }

}

export default CameraController;