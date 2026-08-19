import * as THREE from 'three';

/**
 * Guarded writes to the uniforms shared by the custom celestial shaders.
 *
 * A body's surface, cloud and atmosphere materials each expose an overlapping
 * subset of uniforms, so these helpers check for the uniform before writing and
 * silently skip materials that do not declare it. That lets callers update a
 * whole family of materials without branching per material type.
 *
 * All members are static; the class is used purely as a namespace.
 */
class ShaderUniformHelper {
    /**
     * Sets the `uBaseColor` uniform, accepting several colour representations.
     *
     * A hex number allocates a new `THREE.Color`; a `THREE.Color` is copied into
     * the existing value to avoid an allocation.
     *
     * @param {THREE.ShaderMaterial} material - Target material; skipped if it has
     *   no `uBaseColor` uniform.
     * @param {number|THREE.Color|*} color - Hex value, colour instance, or any
     *   value to assign as-is.
     * @returns {void}
     */
    static setBaseColor(material, color) {
        if (!material || !material.uniforms || !material.uniforms.uBaseColor) return;

        if (typeof color === 'number') {
            material.uniforms.uBaseColor.value = new THREE.Color(color);
        } else if (color instanceof THREE.Color) {
            material.uniforms.uBaseColor.value.copy(color);
        } else {
            material.uniforms.uBaseColor.value = color;
        }
    }

    /**
     * Updates the uniforms controlling fade-out and lighting direction.
     *
     * Each argument is applied only when supplied and when the material declares
     * the matching uniform, so callers can update any subset.
     *
     * @param {THREE.ShaderMaterial} material - Target material.
     * @param {number} [visibility] - Fade factor written to `uVisibility`.
     * @param {number} [direction] - Facing/blend term written to `uDirection`.
     * @param {THREE.Vector3} [lightView] - Light direction in view space, copied
     *   into `uLightView`.
     * @returns {void}
     */
    static setVisibility(material, visibility, direction, lightView) {
        if (!material || !material.uniforms) return;

        if (material.uniforms.uVisibility && visibility !== undefined) {
            material.uniforms.uVisibility.value = visibility;
        }

        if (material.uniforms.uDirection && direction !== undefined) {
            material.uniforms.uDirection.value = direction;
        }

        if (material.uniforms.uLightView && lightView) {
            material.uniforms.uLightView.value.copy(lightView);
        }
    }

    /**
     * Advances the `uTime` uniform used by animated shaders.
     *
     * The value wraps at 1000 to keep it small; float precision in GLSL degrades
     * badly once an ever-increasing time value grows large, which shows up as
     * stuttering noise animation.
     *
     * @param {THREE.ShaderMaterial} material - Target material; skipped if it has
     *   no `uTime` uniform.
     * @param {number} time - Elapsed simulation time.
     * @returns {void}
     */
    static updateTime(material, time) {
        if (!material || !material.uniforms || !material.uniforms.uTime) return;

        const wrappedTime = time % 1000;
        material.uniforms.uTime.value = wrappedTime;
    }

    /**
     * Mirrors visibility and lighting uniforms from one material's set to another.
     *
     * Used to keep a body's cloud and atmosphere layers in step with its surface
     * material, which is the one actually driven each frame.
     *
     * @param {THREE.ShaderMaterial} targetMaterial - Material to write into.
     * @param {Object<string, {value: *}>} sourceUniforms - Uniform set to read
     *   `uVisibility`, `uDirection` and `uLightView` from.
     * @returns {void}
     */
    static syncVisibilityUniforms(targetMaterial, sourceUniforms) {
        if (!targetMaterial || !targetMaterial.uniforms || !sourceUniforms) return;

        if (sourceUniforms.uVisibility && targetMaterial.uniforms.uVisibility) {
            targetMaterial.uniforms.uVisibility.value = sourceUniforms.uVisibility.value;
        }

        if (sourceUniforms.uDirection && targetMaterial.uniforms.uDirection) {
            targetMaterial.uniforms.uDirection.value = sourceUniforms.uDirection.value;
        }

        if (sourceUniforms.uLightView && targetMaterial.uniforms.uLightView) {
            targetMaterial.uniforms.uLightView.value.copy(sourceUniforms.uLightView.value);
        }
    }

}

export default ShaderUniformHelper;
