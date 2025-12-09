import * as THREE from 'three';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import SceneManager from '../managers/SceneManager.js';
import VectorUtils from '../utils/VectorUtils.js';
import { log } from '../utils/Logger.js';

/**
 * OrbitTrail class manages the visual trail left by a celestial body as it moves through space
 * Handles trail rendering, fading effects, and memory management
 */
export class OrbitTrail {
    /**
     * Create an orbit trail for a celestial body
     * @param {string} bodyName - Name of the body this trail belongs to
     * @param {THREE.Color} color - Color of the trail
     * @param {Object} options - Trail configuration options
     * @param {number} options.maxLength - Maximum number of trail points (default: 1200)
     * @param {number} options.fadeLength - Number of points to fade from transparent to opaque (default: 400)
     * @param {number} options.minOpacity - Minimum opacity for faded trail points (default: 0.05)
     * @param {number} options.autoClearDistance - Distance threshold for automatic trail clearing (default: 0.6)
     * @param {number} options.lineWidth - Width of the trail line (default: 2)
     */
    constructor(bodyName, color, options = {}) {
        this.bodyName = bodyName;
        this.color = color.clone();

        // Trail configuration
        this.maxLength = options.maxLength || 1200;
        this.fadeLength = options.fadeLength || 400;
        this.minOpacity = options.minOpacity || 0.05;
        this.autoClearDistance = options.autoClearDistance || 0.6;
        this.lineWidth = options.lineWidth || 2;

        // Trail state
        this.points = [];
        this.updateCounter = 0;
        this.visible = false;
        this.enabled = false;

        // Three.js objects
        this.line = null;
        this.geometry = null;
        this.material = null;

        // Initialize the trail rendering
        this.initializeRendering();

        log.debug('OrbitTrail', `Created orbit trail for ${this.bodyName}`);
    }

    /**
     * Initialize the Three.js rendering objects
     * @private
     */
    initializeRendering() {
        // Create geometry
        this.geometry = new LineGeometry();

        // Initialize with minimal valid arrays (need at least 6 values for 2 points)
        const minimalPositions = [0, 0, 0, 0, 0, 0];
        const minimalColors = [
            this.color.r, this.color.g, this.color.b,
            this.color.r, this.color.g, this.color.b
        ];
        this.geometry.setPositions(minimalPositions);
        this.geometry.setColors(minimalColors);

        // Create material with vertex colors for fading effect
        this.material = new LineMaterial({
            vertexColors: true,
            transparent: true,
            linewidth: this.lineWidth,
            resolution: new THREE.Vector2(window.innerWidth, window.innerHeight)
        });

        // Create the line object
        this.line = new Line2(this.geometry, this.material);
        this.line.visible = false; // Start hidden

        // Add to scene
        SceneManager.scene.add(this.line);

        // Register material for resolution updates
        SceneManager.registerLineMaterial(this.material);
    }

    /**
     * Add a new position point to the trail
     * @param {THREE.Vector3} position - The position to add to the trail
     */
    addPoint(position) {
        if (!this.enabled) {
            return;
        }

        this.updateCounter++;

        // Add current position to trail (clone to avoid reference issues)
        this.points.push(VectorUtils.safeClone(position));

        // Debug position every 30 points to avoid spam
        if (this.points.length % 30 === 0) {
            const pos = position;
            console.log(`OrbitTrail: ${this.bodyName} - Point ${this.points.length}: (${pos.x.toFixed(3)}, ${pos.y.toFixed(3)}, ${pos.z.toFixed(3)})`);

            // Also log the range of all accumulated points to see the trail extent
            const minX = Math.min(...this.points.map(p => p.x));
            const maxX = Math.max(...this.points.map(p => p.x));
            const minY = Math.min(...this.points.map(p => p.y));
            const maxY = Math.max(...this.points.map(p => p.y));
            const minZ = Math.min(...this.points.map(p => p.z));
            const maxZ = Math.max(...this.points.map(p => p.z));
            console.log(`OrbitTrail: ${this.bodyName} - Range: X(${minX.toFixed(3)} to ${maxX.toFixed(3)}), Y(${minY.toFixed(3)} to ${maxY.toFixed(3)}), Z(${minZ.toFixed(3)} to ${maxZ.toFixed(3)})`);
        }


        // Perform smooth cleanup based on proximity to own tail
        this.performSmoothCleanup(position);

        // Limit trail length with automatic pruning (fallback safety)
        if (this.points.length > this.maxLength) {
            this.points.shift(); // Remove oldest point
        }

        // Update the visual geometry
        this.updateGeometry();
    }

    /**
     * Perform tail-chasing effect: fade trail based on proximity to own tail
     * @param {THREE.Vector3} currentPosition - Current position
     * @private
     */
    performSmoothCleanup(currentPosition) {
        const minTrailBeforeCleanup = 50;
        if (this.points.length < minTrailBeforeCleanup) return;

        // Calculate how close we are to our own tail (older trail segments)
        let minDistanceToTail = Infinity;
        const skipRecent = 30; // Skip recent points

        for (let i = 0; i < this.points.length - skipRecent; i++) {
            const distance = currentPosition.distanceTo(this.points[i]);
            minDistanceToTail = Math.min(minDistanceToTail, distance);
        }

        // Dynamic trail length based on proximity to own tail
        const fadeDistance = this.autoClearDistance * 2;
        const proximityFactor = Math.min(1, minDistanceToTail / fadeDistance);

        // Calculate target trail length (shorter when approaching tail)
        const minLength = 30;
        const targetLength = Math.floor(minLength + (this.maxLength - minLength) * proximityFactor);

        // Chase cleanup: remove exactly one point per frame when needed
        if (this.points.length > targetLength && this.points.length > minLength) {
            this.points.shift(); // Remove only one oldest point per frame
        }
    }

    /**
     * Update the Three.js line geometry with current trail points and fading
     * @private
     */
    updateGeometry() {
        if (!this.line || this.points.length < 2) {
            // If we don't have enough points, reset to minimal state
            if (this.line && this.points.length === 0) {
                this.resetToMinimalState();
            }
            return;
        }

        const numPoints = this.points.length;
        const positions = [];
        const colors = [];

        // Current position for tail-chasing calculation
        const currentPos = this.points[numPoints - 1];

        for (let i = 0; i < numPoints; i++) {
            const point = this.points[i];

            // Trail positions are in world space
            positions.push(point.x, point.y, point.z);

            // Calculate distance from current position for tail-chasing effect
            const distanceToCurrentPos = currentPos.distanceTo(point);
            const tailChaseDistance = this.autoClearDistance * 3;

            // Base unidirectional fade: older points (lower index) = more transparent
            let baseAlpha;
            if (numPoints <= this.fadeLength) {
                // For short trails, fade smoothly from start to end
                baseAlpha = this.minOpacity + (1.0 - this.minOpacity) * (i / (numPoints - 1));
            } else {
                // For long trails, keep most points at minimum opacity, fade only the recent ones
                const fadeStartIndex = numPoints - this.fadeLength;
                if (i < fadeStartIndex) {
                    baseAlpha = this.minOpacity;
                } else {
                    const fadeProgress = (i - fadeStartIndex) / (this.fadeLength - 1);
                    baseAlpha = this.minOpacity + (1.0 - this.minOpacity) * fadeProgress;
                }
            }

            // Tail-chasing effect: only fade very old points when planet approaches them
            let tailChaseFactor = 1.0;
            const oldSegmentThreshold = Math.floor(numPoints * 0.33); // Only apply to oldest 1/3 of trail
            if (distanceToCurrentPos < tailChaseDistance && i < oldSegmentThreshold) {
                tailChaseFactor = Math.max(0.1, distanceToCurrentPos / tailChaseDistance);
            }

            // Combine: base fade provides natural aging, chase fade adds dynamic clearing
            const finalAlpha = baseAlpha * tailChaseFactor;

            colors.push(
                this.color.r * finalAlpha,
                this.color.g * finalAlpha,
                this.color.b * finalAlpha
            );
        }

        // Dispose of old geometry before creating new one
        if (this.geometry) {
            this.geometry.dispose();
        }

        // Recreate the geometry
        this.geometry = new LineGeometry();
        this.geometry.setPositions(positions);
        this.geometry.setColors(colors);

        // Update the line object
        this.line.geometry = this.geometry;
    }

    /**
     * Reset geometry to minimal state
     * @private
     */
    resetToMinimalState() {
        const minimalPositions = [0, 0, 0, 0, 0, 0];
        const minimalColors = [
            this.color.r, this.color.g, this.color.b,
            this.color.r, this.color.g, this.color.b
        ];

        if (this.geometry) {
            this.geometry.dispose();
        }

        this.geometry = new LineGeometry();
        this.geometry.setPositions(minimalPositions);
        this.geometry.setColors(minimalColors);

        if (this.line) {
            this.line.geometry = this.geometry;
        }
    }

    /**
     * Enable or disable trail collection and rendering
     * @param {boolean} enabled - Whether the trail should be enabled
     */
    setEnabled(enabled) {
        this.enabled = enabled;
        if (this.line) {
            this.line.visible = enabled && this.visible;
        }

        // Clear the trail when disabling
        if (!enabled) {
            this.clear();
        }

        log.debug('OrbitTrail', `Trail ${enabled ? 'enabled' : 'disabled'} for ${this.bodyName}`);
    }

    /**
     * Set trail visibility (independent of enabled state)
     * @param {boolean} visible - Whether the trail should be visible
     */
    setVisible(visible) {
        this.visible = visible;
        if (this.line) {
            this.line.visible = visible && this.enabled;
        }
    }

    /**
     * Toggle trail enabled state
     * @returns {boolean} New enabled state
     */
    toggle() {
        this.setEnabled(!this.enabled);
        return this.enabled;
    }

    /**
     * Clear all trail points
     */
    clear() {
        this.points = [];
        this.updateCounter = 0;
        this.resetToMinimalState();
        log.debug('OrbitTrail', `Cleared trail for ${this.bodyName}`);
    }

    /**
     * Update trail color
     * @param {THREE.Color} newColor - New color for the trail
     */
    setColor(newColor) {
        this.color = newColor.clone();
        // Regenerate geometry with new color if we have points
        if (this.points.length > 0) {
            this.updateGeometry();
        } else {
            this.resetToMinimalState();
        }
    }

    /**
     * Get current trail statistics
     * @returns {Object} Trail statistics
     */
    getStats() {
        return {
            bodyName: this.bodyName,
            pointCount: this.points.length,
            maxLength: this.maxLength,
            enabled: this.enabled,
            visible: this.visible,
            updateCounter: this.updateCounter
        };
    }

    /**
     * Clean up resources
     */
    dispose() {
        // Dispose of geometry
        if (this.geometry) {
            this.geometry.dispose();
            this.geometry = null;
        }

        // Dispose of material and unregister it
        if (this.material) {
            SceneManager.unregisterLineMaterial(this.material);
            this.material.dispose();
            this.material = null;
        }

        // Remove line from scene
        if (this.line) {
            if (this.line.parent) {
                this.line.parent.remove(this.line);
            }
            this.line = null;
        }

        // Clear trail points
        this.points = [];

        log.debug('OrbitTrail', `Disposed orbit trail for ${this.bodyName}`);
    }
}

export default OrbitTrail;