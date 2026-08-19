import ShaderUniformHelper from '../utils/ShaderUniformHelper.js';
import { log } from '../utils/Logger.js';

/**
 * Base class for the star effects: corona, rays, flares and glare.
 *
 * All four are a mesh with a shader material driven by the same handful of uniforms — a
 * clock, a base colour, a visibility fade — so that plumbing lives here and each subclass
 * only has to build its geometry and material and implement {@link SunEffect#update}.
 *
 * Every setter checks for a material first, since a subclass may not have built one yet
 * when a colour or visibility is pushed in during construction.
 */
class SunEffect {
    /**
     * Stores the options every effect shares.
     *
     * Subclasses build `mesh` and `material` themselves; they are left null here so the
     * shared setters are safe to call before that happens.
     *
     * @param {Object} [options={}] - Effect options.
     * @param {number} [options.sunRadius=1.0] - The star's radius in scene units, which the
     *   effect's own dimensions are relative to.
     * @param {boolean} [options.lowres=false] - Whether to run at reduced resolution, which
     *   changes the uniform defaults rather than the geometry.
     * @param {string} [options.effectName='SunEffect'] - Name used in log messages.
     */
    constructor(options = {}) {
        this.sunRadius = options.sunRadius || 1.0;
        this.lowres = options.lowres || false;
        this.time = 0;

        this.mesh = null;
        this.material = null;

        this.effectName = options.effectName || 'SunEffect';
    }

    /**
     * Sets the effect's base colour.
     *
     * @param {number|THREE.Color} color - The new base colour.
     * @returns {void}
     */
    setBaseColor(color) {
        if (!this.material) return;
        ShaderUniformHelper.setBaseColor(this.material, color);
    }

    /**
     * Sets how visible the effect is and which way it faces.
     *
     * @param {number} visibility - Overall visibility, 0 to 1.
     * @param {number} [direction] - Direction the effect grows in.
     * @param {THREE.Vector3} [lightView] - The star's direction in view space.
     * @returns {void}
     */
    setVisibility(visibility, direction, lightView) {
        if (!this.material) return;
        ShaderUniformHelper.setVisibility(this.material, visibility, direction, lightView);
    }

    /**
     * Advances the effect's animation.
     *
     * The time is also kept on the instance, so a subclass's {@link SunEffect#update} can
     * use it without having to read back out of the uniform.
     *
     * @param {number} time - Animation time, in scaled seconds.
     * @returns {void}
     */
    updateTime(time) {
        this.time = time;
        if (!this.material) return;
        ShaderUniformHelper.updateTime(this.material, time);
    }

    /**
     * Copies another effect's visibility uniforms onto this one.
     *
     * Lets several effects on the same star fade together, without each having to work the
     * fade out for itself and risk drifting out of step.
     *
     * @param {Object} sourceUniforms - Uniforms to copy the visibility values from.
     * @returns {void}
     */
    syncVisibilityUniforms(sourceUniforms) {
        if (!this.material || !sourceUniforms) return;
        ShaderUniformHelper.syncVisibilityUniforms(this.material, sourceUniforms);
    }

    /**
     * The effect's mesh.
     *
     * @returns {THREE.Object3D|null} The mesh, or `null` if the subclass has not built one.
     */
    getMesh() {
        return this.mesh;
    }

    /**
     * Parents the effect's mesh to another object.
     *
     * @param {THREE.Object3D} parent - Object to add the mesh to.
     * @returns {void}
     */
    addToScene(parent) {
        if (this.mesh) {
            parent.add(this.mesh);
            log.info('SunEffect', `${this.effectName} added to scene`);
        }
    }

    /**
     * Unparents the effect's mesh.
     *
     * @param {THREE.Object3D} parent - Object to remove the mesh from.
     * @returns {void}
     */
    removeFromScene(parent) {
        if (this.mesh) {
            parent.remove(this.mesh);
        }
    }

    /**
     * Releases the effect's geometry and material.
     *
     * These effects carry large procedural geometries — thousands of rays or flare lines —
     * so leaving them behind when a star is removed is expensive.
     *
     * @returns {void}
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
     * Advances the effect by one frame.
     *
     * Abstract: each effect needs something different here — the glare turns to face the
     * camera, the corona pulses, the rays animate — so there is no sensible shared
     * behaviour and a missing implementation should be loud rather than silent.
     *
     * @abstract
     * @param {number} time - Animation time, in scaled seconds.
     * @param {THREE.Camera} camera - Camera the frame is being drawn from.
     * @param {*} [additionalParams] - Whatever else the subclass needs.
     * @returns {void}
     * @throws {Error} Always, unless overridden.
     */
    update(time, camera, additionalParams) {
        throw new Error('update() must be implemented by subclass');
    }

}

export default SunEffect;
