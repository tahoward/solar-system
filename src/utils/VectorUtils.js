import * as THREE from 'three';

/**
 * Null-tolerant wrappers around common `THREE.Vector3` operations.
 *
 * The simulation frequently touches vectors that may not exist yet (a body
 * without a velocity, an effect before its first update). These helpers no-op
 * instead of throwing, which keeps call sites free of guard clauses.
 *
 * All members are static; the class is used purely as a namespace.
 */
class VectorUtils {
    /**
     * Copies `source` into `target` when both are present.
     *
     * @param {THREE.Vector3|null|undefined} target - Vector to write into; mutated.
     * @param {THREE.Vector3|null|undefined} source - Vector to read from.
     * @returns {THREE.Vector3|null|undefined} `target`, unchanged if either
     *   argument was missing.
     */
    static safeCopy(target, source) {
        if (target && source) {
            target.copy(source);
        }
        return target;
    }

    /**
     * Resets a vector to the origin when present.
     *
     * @param {THREE.Vector3|null|undefined} vector - Vector to reset; mutated.
     * @returns {THREE.Vector3|null|undefined} `vector`, unchanged if missing.
     */
    static zero(vector) {
        if (vector) {
            vector.set(0, 0, 0);
        }
        return vector;
    }

    /**
     * Writes `source * scalar` into `result` without allocating.
     *
     * @param {THREE.Vector3|null|undefined} result - Vector to write into; mutated.
     * @param {THREE.Vector3|null|undefined} source - Vector to scale; left untouched.
     * @param {number} scalar - Factor to scale by.
     * @returns {THREE.Vector3|null|undefined} `result`, unchanged if either
     *   vector was missing.
     */
    static multiplyScalar(result, source, scalar) {
        if (result && source) {
            result.copy(source).multiplyScalar(scalar);
        }
        return result;
    }

    /**
     * Creates a scratch vector for short-lived intermediate maths.
     *
     * @param {number} [x=0] - Initial x component.
     * @param {number} [y=0] - Initial y component.
     * @param {number} [z=0] - Initial z component.
     * @returns {THREE.Vector3} A newly allocated vector.
     */
    static temp(x = 0, y = 0, z = 0) {
        return new THREE.Vector3(x, y, z);
    }
}

export default VectorUtils;
