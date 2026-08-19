import * as THREE from 'three';

class ShaderUniformConfig {
    static createTimeUniforms() {
        return {
            uTime: { value: 0 }
        };
    }

    static createVisibilityUniforms(options = {}) {
        const { visibility = 1.0, direction = 1.0 } = options;

        return {
            uVisibility: { value: visibility },
            uDirection: { value: direction },
            uLightView: { value: new THREE.Vector3(0, 0, 1) }
        };
    }

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

    static createCommonSunEffectUniforms(options = {}) {
        const {
            lowres = false,
            opacity,
            alphaBlended = 0.65,
            ...colorOptions
        } = options;

        const finalOpacity = opacity !== undefined ? opacity : (lowres ? 3 : 0.2);

        return {
            ...this.createTimeUniforms(),
            ...this.createVisibilityUniforms(),
            ...this.createColorUniforms(colorOptions),
            ...this.createOpacityUniforms({ opacity: finalOpacity, alphaBlended })
        };
    }

    static createFlareUniforms(options = {}) {
        const {
            lowres = false,
            lineLength = 16,
            lineCount = 2047
        } = options;

        return {
            uWidth: { value: lowres ? 0.003 : 0.0015 },
            uAmp: { value: 1.0 },

            uResolution: { value: new THREE.Vector4(
                lineLength,
                lineCount,
                1 / lineLength,
                1 / lineCount
            ) },
            uLineLength: { value: lineLength },

            ...this.createNoiseUniforms({ frequency: 4, amplitude: 0.2 })
        };
    }

    static createRayUniforms(options = {}) {
        const {
            rayLength = 20,
            rayWidth = 0.15,
            rayOpacity = 0.8,
            noiseFrequency = 0.8,
            noiseAmplitude = 0.05
        } = options;

        return {
            uLength: { value: rayLength },
            uWidth: { value: rayWidth },
            uOpacity: { value: rayOpacity },

            ...this.createNoiseUniforms({
                frequency: noiseFrequency,
                amplitude: noiseAmplitude
            })
        };
    }

    static mergeUniforms(...uniformSets) {
        return Object.assign({}, ...uniformSets);
    }

    static createCompleteFlareUniforms(options = {}) {
        const commonUniforms = this.createCommonSunEffectUniforms(options);
        const flareUniforms = this.createFlareUniforms(options);

        return this.mergeUniforms(commonUniforms, flareUniforms);
    }

    static createCompleteRayUniforms(options = {}) {
        const commonUniforms = this.createCommonSunEffectUniforms(options);
        const rayUniforms = this.createRayUniforms(options);

        if (options.rayOpacity !== undefined) {
            commonUniforms.uOpacity.value = options.rayOpacity;
        }

        return this.mergeUniforms(commonUniforms, rayUniforms);
    }
}

export default ShaderUniformConfig;
