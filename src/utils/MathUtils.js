/**
 * MathUtils - Utility class for common mathematical operations
 * Consolidates repeated math patterns found throughout the codebase
 */
class MathUtils {
    /**
     * Clamps a value between min and max bounds
     * @param {number} value - Value to clamp
     * @param {number} min - Minimum bound
     * @param {number} max - Maximum bound
     * @returns {number} Clamped value
     */
    static clamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
    }

    /**
     * Calculates a ratio between 0-1 based on value position between min and max
     * @param {number} value - Current value
     * @param {number} min - Minimum bound
     * @param {number} max - Maximum bound
     * @returns {number} Ratio between 0-1
     */
    static ratio(value, min, max) {
        if (max === min) return 0;
        const clampedValue = MathUtils.clamp(value, min, max);
        return (clampedValue - min) / (max - min);
    }

    /**
     * Clamps a value and returns both the clamped value and its ratio
     * Common pattern: clamp distance then calculate ratio for fade/scale effects
     * @param {number} value - Value to clamp
     * @param {number} min - Minimum bound
     * @param {number} max - Maximum bound
     * @returns {Object} {clamped: number, ratio: number}
     */
    static clampAndRatio(value, min, max) {
        const clamped = MathUtils.clamp(value, min, max);
        const ratio = max === min ? 0 : (clamped - min) / (max - min);
        return { clamped, ratio };
    }

    /**
     * Linear interpolation between two values
     * @param {number} start - Start value
     * @param {number} end - End value
     * @param {number} t - Interpolation factor (0-1)
     * @returns {number} Interpolated value
     */
    static lerp(start, end, t) {
        return start + (end - start) * MathUtils.clamp(t, 0, 1);
    }

    /**
     * Inverse linear interpolation - finds t for a given value between start and end
     * @param {number} start - Start value
     * @param {number} end - End value
     * @param {number} value - Current value
     * @returns {number} t value (0-1)
     */
    static inverseLerp(start, end, value) {
        if (start === end) return 0;
        return MathUtils.clamp((value - start) / (end - start), 0, 1);
    }

    /**
     * Smoothstep function for smooth interpolation
     * @param {number} edge0 - Lower edge
     * @param {number} edge1 - Upper edge
     * @param {number} x - Input value
     * @returns {number} Smooth interpolation result (0-1)
     */
    static smoothstep(edge0, edge1, x) {
        const t = MathUtils.clamp((x - edge0) / (edge1 - edge0), 0, 1);
        return t * t * (3 - 2 * t);
    }

    /**
     * Converts degrees to radians
     * @param {number} degrees - Angle in degrees
     * @returns {number} Angle in radians
     */
    static degToRad(degrees) {
        return degrees * Math.PI / 180;
    }

    /**
     * Converts radians to degrees
     * @param {number} radians - Angle in radians
     * @returns {number} Angle in degrees
     */
    static radToDeg(radians) {
        return radians * 180 / Math.PI;
    }

    /**
     * Normalizes an angle to be within 0 to 2π range
     * @param {number} angle - Angle in radians
     * @returns {number} Normalized angle (0 to 2π)
     */
    static normalizeAngle(angle) {
        angle = angle % (2 * Math.PI);
        return angle < 0 ? angle + (2 * Math.PI) : angle;
    }

    /**
     * Checks if a number is approximately equal to another (within epsilon)
     * @param {number} a - First number
     * @param {number} b - Second number
     * @param {number} epsilon - Tolerance (default: 1e-6)
     * @returns {boolean} True if approximately equal
     */
    static approximately(a, b, epsilon = 1e-6) {
        return Math.abs(a - b) < epsilon;
    }

    /**
     * Safe division that returns 0 if divisor is 0
     * @param {number} numerator - Numerator
     * @param {number} denominator - Denominator
     * @returns {number} Division result or 0 if denominator is 0
     */
    static safeDivide(numerator, denominator) {
        return denominator === 0 ? 0 : numerator / denominator;
    }

    /**
     * Maps a value from one range to another
     * @param {number} value - Input value
     * @param {number} fromMin - Input range minimum
     * @param {number} fromMax - Input range maximum
     * @param {number} toMin - Output range minimum
     * @param {number} toMax - Output range maximum
     * @returns {number} Mapped value
     */
    static map(value, fromMin, fromMax, toMin, toMax) {
        const ratio = MathUtils.ratio(value, fromMin, fromMax);
        return MathUtils.lerp(toMin, toMax, ratio);
    }
}

export default MathUtils;