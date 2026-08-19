import * as THREE from 'three';

class ShaderUniformHelper {
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

    static updateTime(material, time) {
        if (!material || !material.uniforms || !material.uniforms.uTime) return;

        const wrappedTime = time % 1000;
        material.uniforms.uTime.value = wrappedTime;
    }

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
