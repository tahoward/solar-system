class MathUtils {
    static clamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
    }

    static ratio(value, min, max) {
        if (max === min) return 0;
        const clampedValue = MathUtils.clamp(value, min, max);
        return (clampedValue - min) / (max - min);
    }

    static clampAndRatio(value, min, max) {
        const clamped = MathUtils.clamp(value, min, max);
        const ratio = max === min ? 0 : (clamped - min) / (max - min);
        return { clamped, ratio };
    }

    static lerp(start, end, t) {
        return start + (end - start) * MathUtils.clamp(t, 0, 1);
    }

    static inverseLerp(start, end, value) {
        if (start === end) return 0;
        return MathUtils.clamp((value - start) / (end - start), 0, 1);
    }

    static smoothstep(edge0, edge1, x) {
        const t = MathUtils.clamp((x - edge0) / (edge1 - edge0), 0, 1);
        return t * t * (3 - 2 * t);
    }

    static degToRad(degrees) {
        return degrees * Math.PI / 180;
    }

    static radToDeg(radians) {
        return radians * 180 / Math.PI;
    }

    static normalizeAngle(angle) {
        angle = angle % (2 * Math.PI);
        return angle < 0 ? angle + (2 * Math.PI) : angle;
    }

    static approximately(a, b, epsilon = 1e-6) {
        return Math.abs(a - b) < epsilon;
    }

    static safeDivide(numerator, denominator) {
        return denominator === 0 ? 0 : numerator / denominator;
    }

    static map(value, fromMin, fromMax, toMin, toMax) {
        const ratio = MathUtils.ratio(value, fromMin, fromMax);
        return MathUtils.lerp(toMin, toMax, ratio);
    }

    static setSphereFromBox(sphere, minX, minY, minZ, maxX, maxY, maxZ) {
        sphere.center.set((minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2);

        const dx = maxX - minX;
        const dy = maxY - minY;
        const dz = maxZ - minZ;
        sphere.radius = 0.5 * Math.sqrt(dx * dx + dy * dy + dz * dz);
    }
}

export default MathUtils;