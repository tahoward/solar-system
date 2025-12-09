import * as THREE from 'three';

/**
 * VectorUtils - Utility class for common THREE.Vector3 operations
 * Reduces code duplication and provides safe vector manipulation methods
 */
class VectorUtils {
    /**
     * Safely clone a vector, returning a new zero vector if input is null/undefined
     * @param {THREE.Vector3} vector - Vector to clone
     * @returns {THREE.Vector3} Cloned vector or new zero vector
     */
    static safeClone(vector) {
        return vector ? vector.clone() : new THREE.Vector3(0, 0, 0);
    }

    /**
     * Safely copy from source to target vector
     * @param {THREE.Vector3} target - Target vector to copy into
     * @param {THREE.Vector3} source - Source vector to copy from
     * @returns {THREE.Vector3} Target vector (for chaining)
     */
    static safeCopy(target, source) {
        if (target && source) {
            target.copy(source);
        }
        return target;
    }


    /**
     * Set a vector to zero
     * @param {THREE.Vector3} vector - Vector to zero out
     * @returns {THREE.Vector3} The zeroed vector (for chaining)
     */
    static zero(vector) {
        if (vector) {
            vector.set(0, 0, 0);
        }
        return vector;
    }

    /**
     * Copy and scale a vector in one operation
     * @param {THREE.Vector3} target - Target vector
     * @param {THREE.Vector3} source - Source vector
     * @param {number} scalar - Scale factor
     * @returns {THREE.Vector3} Target vector (for chaining)
     */
    static copyAndScale(target, source, scalar) {
        if (target && source) {
            target.copy(source).multiplyScalar(scalar);
        }
        return target;
    }


    /**
     * Perform vector subtraction: result = a - b
     * @param {THREE.Vector3} result - Result vector (can be same as a or b)
     * @param {THREE.Vector3} a - First vector
     * @param {THREE.Vector3} b - Second vector
     * @returns {THREE.Vector3} Result vector (for chaining)
     */
    static subtract(result, a, b) {
        if (result && a && b) {
            result.copy(a).sub(b);
        }
        return result;
    }


    /**
     * Divide a vector by a scalar: result = vector / scalar
     * @param {THREE.Vector3} result - Result vector (can be same as source)
     * @param {THREE.Vector3} source - Source vector
     * @param {number} scalar - Divisor
     * @returns {THREE.Vector3} Result vector (for chaining)
     */
    static divideScalar(result, source, scalar) {
        if (result && source && scalar !== 0) {
            result.copy(source).divideScalar(scalar);
        }
        return result;
    }

    /**
     * Multiply a vector by a scalar: result = vector * scalar
     * @param {THREE.Vector3} result - Result vector (can be same as source)
     * @param {THREE.Vector3} source - Source vector
     * @param {number} scalar - Multiplier
     * @returns {THREE.Vector3} Result vector (for chaining)
     */
    static multiplyScalar(result, source, scalar) {
        if (result && source) {
            result.copy(source).multiplyScalar(scalar);
        }
        return result;
    }

    /**
     * Create a temporary vector for calculations (reusable pattern)
     * Useful for avoiding repeated new Vector3() allocations
     * @param {number} x - X component (default 0)
     * @param {number} y - Y component (default 0)
     * @param {number} z - Z component (default 0)
     * @returns {THREE.Vector3} New temporary vector
     */
    static temp(x = 0, y = 0, z = 0) {
        return new THREE.Vector3(x, y, z);
    }


    /**
     * Normalize a vector safely (check for zero length)
     * @param {THREE.Vector3} vector - Vector to normalize
     * @returns {THREE.Vector3} Normalized vector (or zero vector if length was 0)
     */
    static safeNormalize(vector) {
        if (vector && vector.length() > 0) {
            vector.normalize();
        }
        return vector;
    }

    /**
     * Calculate distance between two vectors
     * @param {THREE.Vector3} a - First vector
     * @param {THREE.Vector3} b - Second vector
     * @returns {number} Distance between vectors (or 0 if either is null)
     */
    static distance(a, b) {
        if (!a || !b) return 0;
        return a.distanceTo(b);
    }

    /**
     * Calculate squared distance between two vectors (faster than distance)
     * @param {THREE.Vector3} a - First vector
     * @param {THREE.Vector3} b - Second vector
     * @returns {number} Squared distance between vectors (or 0 if either is null)
     */
    static distanceSquared(a, b) {
        if (!a || !b) return 0;
        return a.distanceToSquared(b);
    }

}

export default VectorUtils;
