import ShaderUniformHelper from '../utils/ShaderUniformHelper.js';
import { log } from '../utils/Logger.js';

class SunEffect {
    constructor(options = {}) {
        this.sunRadius = options.sunRadius || 1.0;
        this.lowres = options.lowres || false;
        this.time = 0;

        this.mesh = null;
        this.material = null;

        this.effectName = options.effectName || 'SunEffect';
    }

    setBaseColor(color) {
        if (!this.material) return;
        ShaderUniformHelper.setBaseColor(this.material, color);
    }

    setVisibility(visibility, direction, lightView) {
        if (!this.material) return;
        ShaderUniformHelper.setVisibility(this.material, visibility, direction, lightView);
    }

    updateTime(time) {
        this.time = time;
        if (!this.material) return;
        ShaderUniformHelper.updateTime(this.material, time);
    }

    syncVisibilityUniforms(sourceUniforms) {
        if (!this.material || !sourceUniforms) return;
        ShaderUniformHelper.syncVisibilityUniforms(this.material, sourceUniforms);
    }

    getMesh() {
        return this.mesh;
    }

    addToScene(parent) {
        if (this.mesh) {
            parent.add(this.mesh);
            log.info('SunEffect', `${this.effectName} added to scene`);
        }
    }

    removeFromScene(parent) {
        if (this.mesh) {
            parent.remove(this.mesh);
        }
    }

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

    update(time, camera, additionalParams) {
        throw new Error('update() must be implemented by subclass');
    }

}

export default SunEffect;
