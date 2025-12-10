import * as THREE from 'three';

/**
 * ShaderUniformConfig - Centralized configuration for shader uniforms
 * Provides common uniform structures for sun effects to reduce duplication
 */
class ShaderUniformConfig {
    /**
     * Create common camera-related uniforms
     * @returns {Object} Camera uniform definitions
     */
    static createCameraUniforms() {
        return {
            uViewProjection: { value: new THREE.Matrix4() },
            uCamPos: { value: new THREE.Vector3() }
        };
    }

    /**
     * Create time-related uniforms
     * @returns {Object} Time uniform definitions
     */
    static createTimeUniforms() {
        return {
            uTime: { value: 0 }
        };
    }

    /**
     * Create visibility-related uniforms
     * @param {Object} options - Configuration options
     * @param {number} options.visibility - Initial visibility value (default: 1.0)
     * @param {number} options.direction - Initial direction value (default: 1.0)
     * @returns {Object} Visibility uniform definitions
     */
    static createVisibilityUniforms(options = {}) {
        const { visibility = 1.0, direction = 1.0 } = options;

        return {
            uVisibility: { value: visibility },
            uDirection: { value: direction },
            uLightView: { value: new THREE.Vector3(0, 0, 1) }
        };
    }

    /**
     * Create color-related uniforms
     * @param {Object} options - Configuration options
     * @param {number|THREE.Color} options.baseColor - Base color (default: 0xffaa00)
     * @param {number} options.hue - Hue value (default: 0)
     * @param {number} options.hueSpread - Hue spread value (default: 0.16)
     * @returns {Object} Color uniform definitions
     */
    static createColorUniforms(options = {}) {
        const {
            baseColor = 0xffaa00,
            hue = 0,
            hueSpread = 0.16
        } = options;

        return {
            uBaseColor: { value: new THREE.Color(baseColor) },
            uHue: { value: hue },
            uHueSpread: { value: hueSpread }
        };
    }

    /**
     * Create opacity-related uniforms
     * @param {Object} options - Configuration options
     * @param {number} options.opacity - Opacity value (default: 0.2)
     * @param {number} options.alphaBlended - Alpha blending value (default: 0.65)
     * @returns {Object} Opacity uniform definitions
     */
    static createOpacityUniforms(options = {}) {
        const {
            opacity = 0.2,
            alphaBlended = 0.65
        } = options;

        return {
            uOpacity: { value: opacity },
            uAlphaBlended: { value: alphaBlended }
        };
    }

    /**
     * Create noise-related uniforms for procedural effects
     * @param {Object} options - Configuration options
     * @param {number} options.frequency - Noise frequency (default: 4)
     * @param {number} options.amplitude - Noise amplitude (default: 0.2)
     * @returns {Object} Noise uniform definitions
     */
    static createNoiseUniforms(options = {}) {
        const {
            frequency = 4,
            amplitude = 0.2
        } = options;

        return {
            uNoiseFrequency: { value: frequency },
            uNoiseAmplitude: { value: amplitude }
        };
    }

    /**
     * Create all common sun effect uniforms
     * Combines camera, time, visibility, color, and opacity uniforms
     * @param {Object} options - Configuration options
     * @param {boolean} options.lowres - Low resolution mode affects opacity (default: false)
     * @param {number} options.baseColor - Base color (default: 0xffaa00)
     * @param {number} options.hue - Hue value (default: 0)
     * @param {number} options.hueSpread - Hue spread value (default: 0.16)
     * @param {number} options.opacity - Opacity override (optional)
     * @param {number} options.alphaBlended - Alpha blending value (default: 0.65)
     * @returns {Object} Complete common uniform definitions
     */
    static createCommonSunEffectUniforms(options = {}) {
        const {
            lowres = false,
            opacity,
            alphaBlended = 0.65,
            ...colorOptions
        } = options;

        // Calculate opacity based on lowres if not explicitly provided
        const finalOpacity = opacity !== undefined ? opacity : (lowres ? 3 : 0.2);

        return {
            ...this.createCameraUniforms(),
            ...this.createTimeUniforms(),
            ...this.createVisibilityUniforms(),
            ...this.createColorUniforms(colorOptions),
            ...this.createOpacityUniforms({ opacity: finalOpacity, alphaBlended })
        };
    }

    /**
     * Create flare-specific uniforms
     * @param {Object} options - Configuration options
     * @param {boolean} options.lowres - Low resolution mode (default: false)
     * @param {number} options.lineLength - Number of segments per flare line
     * @param {number} options.lineCount - Number of flare lines
     * @returns {Object} Flare-specific uniform definitions
     */
    static createFlareUniforms(options = {}) {
        const {
            lowres = false,
            lineLength = 16,
            lineCount = 2047
        } = options;

        return {
            // Flare-specific parameters
            uWidth: { value: lowres ? 0.01 : 0.005 },
            uAmp: { value: 0.5 },

            // Resolution parameters
            uResolution: { value: new THREE.Vector4(
                lineLength,
                lineCount,
                1 / lineLength,
                1 / lineCount
            ) },
            uLineLength: { value: lineLength },

            // Noise for organic movement
            ...this.createNoiseUniforms({ frequency: 4, amplitude: 0.2 })
        };
    }

    /**
     * Create ray-specific uniforms
     * @param {Object} options - Configuration options
     * @param {number} options.rayLength - Length of rays (default: 20)
     * @param {number} options.rayWidth - Width of rays (default: 0.15)
     * @param {number} options.rayOpacity - Opacity of rays (default: 0.8)
     * @param {number} options.noiseFrequency - Noise frequency (default: 0.8)
     * @param {number} options.noiseAmplitude - Noise amplitude (default: 0.05)
     * @returns {Object} Ray-specific uniform definitions
     */
    static createRayUniforms(options = {}) {
        const {
            rayLength = 20,
            rayWidth = 0.15,
            rayOpacity = 0.8,
            noiseFrequency = 0.8,
            noiseAmplitude = 0.05
        } = options;

        return {
            // Ray-specific parameters
            uLength: { value: rayLength },
            uWidth: { value: rayWidth },
            uOpacity: { value: rayOpacity },

            // Noise for wispy effects
            ...this.createNoiseUniforms({
                frequency: noiseFrequency,
                amplitude: noiseAmplitude
            })
        };
    }

    /**
     * Merge uniform definitions
     * Helper to combine multiple uniform objects
     * @param {...Object} uniformSets - Uniform objects to merge
     * @returns {Object} Merged uniforms
     */
    static mergeUniforms(...uniformSets) {
        return Object.assign({}, ...uniformSets);
    }

    /**
     * Create complete flare shader uniforms
     * @param {Object} options - Configuration options
     * @returns {Object} Complete flare uniform set
     */
    static createCompleteFlareUniforms(options = {}) {
        const commonUniforms = this.createCommonSunEffectUniforms(options);
        const flareUniforms = this.createFlareUniforms(options);

        return this.mergeUniforms(commonUniforms, flareUniforms);
    }

    /**
     * Create complete ray shader uniforms
     * @param {Object} options - Configuration options
     * @returns {Object} Complete ray uniform set
     */
    static createCompleteRayUniforms(options = {}) {
        const commonUniforms = this.createCommonSunEffectUniforms(options);
        const rayUniforms = this.createRayUniforms(options);

        // Override opacity from common uniforms with ray-specific opacity
        if (options.rayOpacity !== undefined) {
            commonUniforms.uOpacity.value = options.rayOpacity;
        }

        return this.mergeUniforms(commonUniforms, rayUniforms);
    }
}

export default ShaderUniformConfig;
