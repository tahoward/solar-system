import * as THREE from 'three';

class VectorUtils {
    static safeClone(vector) {
        return vector ? vector.clone() : new THREE.Vector3(0, 0, 0);
    }

    static safeCopy(target, source) {
        if (target && source) {
            target.copy(source);
        }
        return target;
    }

    static zero(vector) {
        if (vector) {
            vector.set(0, 0, 0);
        }
        return vector;
    }

    static copyAndScale(target, source, scalar) {
        if (target && source) {
            target.copy(source).multiplyScalar(scalar);
        }
        return target;
    }

    static subtract(result, a, b) {
        if (result && a && b) {
            result.copy(a).sub(b);
        }
        return result;
    }

    static divideScalar(result, source, scalar) {
        if (result && source && scalar !== 0) {
            result.copy(source).divideScalar(scalar);
        }
        return result;
    }

    static multiplyScalar(result, source, scalar) {
        if (result && source) {
            result.copy(source).multiplyScalar(scalar);
        }
        return result;
    }

    static temp(x = 0, y = 0, z = 0) {
        return new THREE.Vector3(x, y, z);
    }

    static safeNormalize(vector) {
        if (vector && vector.length() > 0) {
            vector.normalize();
        }
        return vector;
    }

    static distance(a, b) {
        if (!a || !b) return 0;
        return a.distanceTo(b);
    }

    static distanceSquared(a, b) {
        if (!a || !b) return 0;
        return a.distanceToSquared(b);
    }

}

export default VectorUtils;
