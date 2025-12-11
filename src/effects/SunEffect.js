import * as THREE from 'three';
import ShaderUniformHelper from '../utils/ShaderUniformHelper.js';
import { log } from '../utils/Logger.js';

/**
 * SunEffect - Base class for sun-related visual effects (flares, rays, etc.)
 * Provides common functionality for shader-based effects around the sun
 */
class SunEffect {
    constructor(options = {}) {
        // Common properties
        this.sunRadius = options.sunRadius || 1.0;
        this.lowres = options.lowres || false;
        this.time = 0;

        // Will be set by subclasses
        this.mesh = null;
        this.material = null;

        // Effect name for logging (set by subclasses)
        this.effectName = options.effectName || 'SunEffect';
    }

    /**
     * Set the base color for the effect
     * @param {number|THREE.Color} color - Color as hex or THREE.Color
     */
    setBaseColor(color) {
        if (!this.material) return;
        ShaderUniformHelper.setBaseColor(this.material, color);
    }

    /**
     * Set visibility parameters
     * @param {number} visibility - Visibility value
     * @param {number} direction - Direction value (optional)
     * @param {THREE.Vector3} lightView - Light direction in view space (optional)
     */
    setVisibility(visibility, direction, lightView) {
        if (!this.material) return;
        ShaderUniformHelper.setVisibility(this.material, visibility, direction, lightView);
    }

    /**
     * Update camera-related uniforms
     * @param {THREE.Camera} camera - Camera for view calculations
     */
    updateCameraUniforms(camera) {
        if (!this.material) return;
        ShaderUniformHelper.updateCameraUniforms(this.material, camera);
    }

    /**
     * Update time uniform
     * @param {number} time - Current time in seconds
     */
    updateTime(time) {
        this.time = time;
        if (!this.material) return;
        ShaderUniformHelper.updateTime(this.material, time);
    }

    /**
     * Synchronize visibility uniforms from another material
     * @param {Object} sourceUniforms - Source uniforms to sync from
     */
    syncVisibilityUniforms(sourceUniforms) {
        if (!this.material || !sourceUniforms) return;
        ShaderUniformHelper.syncVisibilityUniforms(this.material, sourceUniforms);
    }

    /**
     * Get the Three.js mesh object
     * @returns {THREE.Mesh} The effect mesh
     */
    getMesh() {
        return this.mesh;
    }

    /**
     * Add the effect to a Three.js scene or group
     * @param {THREE.Scene|THREE.Group} parent - The parent to add to
     */
    addToScene(parent) {
        if (this.mesh) {
            parent.add(this.mesh);
            log.info('SunEffect', `${this.effectName} added to scene`);
        }
    }

    /**
     * Remove the effect from a Three.js scene or group
     * @param {THREE.Scene|THREE.Group} parent - The parent to remove from
     */
    removeFromScene(parent) {
        if (this.mesh) {
            parent.remove(this.mesh);
        }
    }

    /**
     * Dispose of resources
     * Should be overridden by subclasses to dispose of specific resources
     */
    dispose() {
        if (this.mesh) {
            if (this.mesh.geometry) {
                this.mesh.geometry.dispose();
            }
            if (this.mesh.material) {
                this.mesh.material.dispose();
            }
        }
        log.info('SunEffect', `${this.effectName} disposed`);
    }

    /**
     * Update method - must be implemented by subclasses
     * @param {number} time - Current time in seconds
     * @param {THREE.Camera} camera - Camera for view calculations
     * @param {Object} additionalParams - Additional parameters specific to the effect
     */
    update(time, camera, additionalParams) {
        throw new Error('update() must be implemented by subclass');
    }

    /**
     * Create common shader uniforms structure for sun effects
     * @param {Object} customUniforms - Additional custom uniforms
     * @returns {Object} Complete uniforms object
     */
    createCommonUniforms(customUniforms = {}) {
        const commonUniforms = {
            // Camera and transforms
            uViewProjection: { value: new THREE.Matrix4() },
            uCamPos: { value: new THREE.Vector3() },

            // Time
            uTime: { value: 0 },

            // Visibility
            uVisibility: { value: 1.0 },
            uDirection: { value: 1.0 },
            uLightView: { value: new THREE.Vector3(0, 0, 1) },

            // Color
            uBaseColor: { value: new THREE.Color(0xffaa00) },
            uHue: { value: 0 },
            uHueSpread: { value: 0.16 },

            // Opacity
            uOpacity: { value: this.lowres ? 3 : 0.2 },
            uAlphaBlended: { value: 0.65 }
        };

        // Merge with custom uniforms
        return { ...commonUniforms, ...customUniforms };
    }

    /**
     * Create common material settings for sun effects
     * @returns {Object} Material configuration object
     */
    getCommonMaterialSettings() {
        return {
            transparent: true,
            premultipliedAlpha: true,
            depthWrite: false,
            depthTest: true,
            side: THREE.DoubleSide
        };
    }
}

export default SunEffect;
