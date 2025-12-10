import * as THREE from 'three';

/**
 * ShaderUniformHelper - Utility class for managing common shader uniform operations
 * Reduces code duplication across shader-based visual effects
 */
class ShaderUniformHelper {
    /**
     * Update camera-related uniforms (view projection matrix and camera position)
     * @param {THREE.ShaderMaterial} material - The shader material to update
     * @param {THREE.Camera} camera - The camera to use for calculations
     */
    static updateCameraUniforms(material, camera) {
        if (!material || !material.uniforms || !camera) return;

        // Update camera position
        if (material.uniforms.uCamPos) {
            const cameraWorldPosition = new THREE.Vector3();
            camera.getWorldPosition(cameraWorldPosition);
            material.uniforms.uCamPos.value.copy(cameraWorldPosition);
        }

        // Update view projection matrix
        if (material.uniforms.uViewProjection) {
            camera.updateMatrixWorld(true);
            camera.updateProjectionMatrix();

            const view = new THREE.Matrix4().copy(camera.matrixWorld).invert();
            const viewProjection = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, view);
            material.uniforms.uViewProjection.value.copy(viewProjection);
        }
    }

    /**
     * Set base color uniform
     * @param {THREE.ShaderMaterial} material - The shader material to update
     * @param {number|THREE.Color} color - Color as hex number or THREE.Color object
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
     * Set visibility-related uniforms
     * @param {THREE.ShaderMaterial} material - The shader material to update
     * @param {number} visibility - Visibility value
     * @param {number} direction - Direction value
     * @param {THREE.Vector3} lightView - Light direction in view space
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
     * Update time uniform
     * @param {THREE.ShaderMaterial} material - The shader material to update
     * @param {number} time - Time value in seconds
     */
    static updateTime(material, time) {
        if (!material || !material.uniforms || !material.uniforms.uTime) return;

        // Wrap time to prevent floating point precision loss in shaders
        // Use modulo to keep time within a reasonable range for GPU float32 precision
        const wrappedTime = time % 1000; // Reset every ~16.7 minutes of simulation time
        material.uniforms.uTime.value = wrappedTime;
    }

    /**
     * Sync visibility uniforms from a source material to a target material
     * Useful for keeping multiple effects in sync (e.g., sun rays and flares)
     * @param {THREE.ShaderMaterial} targetMaterial - Material to update
     * @param {Object} sourceUniforms - Source uniforms object to copy from
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
