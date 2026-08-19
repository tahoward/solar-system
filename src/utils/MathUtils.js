/**
 * Small collection of numeric helpers shared across the simulation.
 *
 * All members are static; the class is used purely as a namespace.
 */
class MathUtils {
    /**
     * Constrains a value to an inclusive range.
     *
     * @param {number} value - Value to constrain.
     * @param {number} min - Lower bound of the range.
     * @param {number} max - Upper bound of the range.
     * @returns {number} `value` limited to `[min, max]`.
     */
    static clamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
    }

    /**
     * Clamps a value and reports where it falls within the range.
     *
     * Useful for driving a normalised 0-1 factor (opacity, blend weight)
     * from a raw measurement in a single step.
     *
     * @param {number} value - Value to constrain.
     * @param {number} min - Lower bound of the range.
     * @param {number} max - Upper bound of the range.
     * @returns {{clamped: number, ratio: number}} The clamped value and its
     *   normalised position in `[min, max]`; `ratio` is 0 for a zero-width range.
     */
    static clampAndRatio(value, min, max) {
        const clamped = MathUtils.clamp(value, min, max);
        const ratio = max === min ? 0 : (clamped - min) / (max - min);
        return { clamped, ratio };
    }

    /**
     * Linearly interpolates between two values.
     *
     * @param {number} start - Value returned when `t` is 0.
     * @param {number} end - Value returned when `t` is 1.
     * @param {number} t - Interpolation factor, clamped to `[0, 1]`.
     * @returns {number} The interpolated value.
     */
    static lerp(start, end, t) {
        return start + (end - start) * MathUtils.clamp(t, 0, 1);
    }

    /**
     * Fits a sphere around an axis-aligned bounding box, in place.
     *
     * The sphere is centred on the box and sized to its half-diagonal, so it
     * fully encloses the box.
     *
     * @param {THREE.Sphere} sphere - Sphere to write the result into; mutated.
     * @param {number} minX - Minimum x of the box.
     * @param {number} minY - Minimum y of the box.
     * @param {number} minZ - Minimum z of the box.
     * @param {number} maxX - Maximum x of the box.
     * @param {number} maxY - Maximum y of the box.
     * @param {number} maxZ - Maximum z of the box.
     * @returns {void}
     */
    static setSphereFromBox(sphere, minX, minY, minZ, maxX, maxY, maxZ) {
        sphere.center.set((minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2);

        const dx = maxX - minX;
        const dy = maxY - minY;
        const dz = maxZ - minZ;
        sphere.radius = 0.5 * Math.sqrt(dx * dx + dy * dy + dz * dz);
    }
}

export default MathUtils;
