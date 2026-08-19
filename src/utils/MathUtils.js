class MathUtils {
    static clamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
    }

    static clampAndRatio(value, min, max) {
        const clamped = MathUtils.clamp(value, min, max);
        const ratio = max === min ? 0 : (clamped - min) / (max - min);
        return { clamped, ratio };
    }

    static lerp(start, end, t) {
        return start + (end - start) * MathUtils.clamp(t, 0, 1);
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
