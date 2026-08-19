import * as THREE from 'three';

/**
 * Builds the uniform sets the star effects share.
 *
 * The rays, flares, corona and glare all need the same handful of uniforms — a clock, a
 * visibility fade, a colour ramp, an opacity — and defining them separately in each
 * effect means four places to keep in step. They are composed here from small groups
 * instead, so an effect asks for the groups it needs and adds only its own.
 *
 * Static only.
 */
class ShaderUniformConfig {
    /**
     * The animation clock uniform.
     *
     * @returns {Object} Uniform set holding `uTime`.
     */
    static createTimeUniforms() {
        return {
            uTime: { value: 0 }
        };
    }

    /**
     * Uniforms controlling whether and how an effect is shown.
     *
     * `uLightView` is the star's direction in view space, which the effects use to fade
     * out as they turn away from the camera.
     *
     * @param {Object} [options={}] - Option bag.
     * @param {number} [options.visibility=1.0] - Overall visibility, 0 to 1.
     * @param {number} [options.direction=1.0] - Direction the effect grows in.
     * @returns {Object} Uniform set holding `uVisibility`, `uDirection` and `uLightView`.
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
     * Uniforms describing an effect's colour.
     *
     * A base colour plus a hue offset and spread, rather than a single colour: the rays and
     * flares vary in hue along their length, so a star's glow shifts slightly rather than
     * being one flat tone.
     *
     * @param {Object} [options={}] - Option bag.
     * @param {number|THREE.Color} [options.baseColor=0xffaa00] - The effect's base colour.
     * @param {number} [options.hue=0] - Hue offset from the base.
     * @param {number} [options.hueSpread=0.16] - How far the hue varies across the effect.
     * @returns {Object} Uniform set holding `uBaseColor`, `uHue` and `uHueSpread`.
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
     * Uniforms describing an effect's opacity.
     *
     * Two values, because these effects are drawn additively but need a separate weight for
     * the alpha-blended portion.
     *
     * @param {Object} [options={}] - Option bag.
     * @param {number} [options.opacity=0.2] - Additive contribution.
     * @param {number} [options.alphaBlended=0.65] - Alpha-blended contribution.
     * @returns {Object} Uniform set holding `uOpacity` and `uAlphaBlended`.
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
     * Uniforms controlling the noise that perturbs an effect's shape.
     *
     * @param {Object} [options={}] - Option bag.
     * @param {number} [options.frequency=4] - Noise frequency.
     * @param {number} [options.amplitude=0.2] - How far the noise displaces things.
     * @returns {Object} Uniform set holding `uNoiseFrequency` and `uNoiseAmplitude`.
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
     * The uniforms every star effect needs: time, visibility, colour and opacity.
     *
     * The low-resolution default opacity is much higher, because at reduced resolution far
     * fewer rays or flares land on any given pixel and each has to contribute more to
     * reach the same apparent brightness.
     *
     * @param {Object} [options={}] - Option bag; unrecognised keys are passed to
     *   {@link ShaderUniformConfig.createColorUniforms}.
     * @param {boolean} [options.lowres=false] - Whether this effect runs at reduced
     *   resolution.
     * @param {number} [options.opacity] - Explicit opacity, overriding the default.
     * @param {number} [options.alphaBlended=0.65] - Alpha-blended contribution.
     * @returns {Object} The merged uniform set.
     */
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

    /**
     * Uniforms specific to the flare lines.
     *
     * The low-resolution width is doubled: a line thinner than a pixel is sampled
     * intermittently and breaks up into dashes, so at reduced resolution it has to be
     * widened to stay continuous.
     *
     * @param {Object} [options={}] - Option bag.
     * @param {boolean} [options.lowres=false] - Whether this effect runs at reduced
     *   resolution.
     * @returns {Object} Uniform set holding `uWidth`, `uAmp` and the noise uniforms.
     */
    static createFlareUniforms(options = {}) {
        const { lowres = false } = options;

        return {
            uWidth: { value: lowres ? 0.003 : 0.0015 },
            uAmp: { value: 1.0 },

            ...this.createNoiseUniforms({ frequency: 4, amplitude: 0.2 })
        };
    }

    /**
     * Uniforms specific to the rays.
     *
     * @param {Object} [options={}] - Option bag.
     * @param {number} [options.rayWidth=0.15] - Ray width.
     * @param {number} [options.rayOpacity=0.8] - Ray opacity.
     * @returns {Object} Uniform set holding `uWidth` and `uOpacity`.
     */
    static createRayUniforms(options = {}) {
        const {
            rayWidth = 0.15,
            rayOpacity = 0.8
        } = options;

        return {
            uWidth: { value: rayWidth },
            uOpacity: { value: rayOpacity }
        };
    }

    /**
     * Combines uniform sets, with later sets winning on collisions.
     *
     * @param {...Object} uniformSets - Sets to merge.
     * @returns {Object} A new merged set.
     */
    static mergeUniforms(...uniformSets) {
        return Object.assign({}, ...uniformSets);
    }

    /**
     * The full uniform set for {@link SunFlares}.
     *
     * @param {Object} [options={}] - Option bag, passed to both groups.
     * @returns {Object} The merged uniform set.
     */
    static createCompleteFlareUniforms(options = {}) {
        const commonUniforms = this.createCommonSunEffectUniforms(options);
        const flareUniforms = this.createFlareUniforms(options);

        return this.mergeUniforms(commonUniforms, flareUniforms);
    }

    /**
     * The full uniform set for {@link SunRays}.
     *
     * The rays' own opacity is copied over the common one, since both groups declare
     * `uOpacity` and the ray-specific value is the one meant to apply.
     *
     * @param {Object} [options={}] - Option bag, passed to both groups.
     * @param {number} [options.rayOpacity] - Ray opacity, which also overrides the common
     *   `uOpacity`.
     * @returns {Object} The merged uniform set.
     */
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
