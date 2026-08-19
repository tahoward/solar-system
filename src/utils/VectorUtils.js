import * as THREE from 'three';

class VectorUtils {
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

    static multiplyScalar(result, source, scalar) {
        if (result && source) {
            result.copy(source).multiplyScalar(scalar);
        }
        return result;
    }

    static temp(x = 0, y = 0, z = 0) {
        return new THREE.Vector3(x, y, z);
    }
}

export default VectorUtils;
