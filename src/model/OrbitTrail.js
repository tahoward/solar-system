import * as THREE from 'three';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import SceneManager from '../managers/SceneManager.js';
import MathUtils from '../utils/MathUtils.js';
import { log } from '../utils/Logger.js';

/**
 * OrbitTrail class manages the visual trail left by a celestial body as it moves through space
 * Handles trail rendering, fading effects, and memory management
 *
 * The GPU buffers are allocated once at full capacity and rewritten in place every frame,
 * so adding a point never reallocates geometry or reuploads a resized buffer.
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

        // Trail state - points is a pool of Vector3 instances reused as the trail slides forward
        this.points = [];
        this.pointPool = [];
        this.updateCounter = 0;
        this.visible = false;
        this.enabled = false;

        // Scratch buffers sized for the maximum trail length (no per-frame allocation)
        const maxSegments = Math.max(1, this.maxLength - 1);
        this.segmentPositions = new Float32Array(maxSegments * 6); // xyz, xyz per segment
        this.segmentColors = new Float32Array(maxSegments * 6);    // rgb, rgb per segment
        this.pointAlphas = new Float32Array(this.maxLength);

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
        // Create geometry backed by the pre-allocated segment buffers.
        // LineSegmentsGeometry (rather than LineGeometry) is used so the already
        // segment-formatted Float32Arrays are adopted directly instead of being
        // converted and copied on every update.
        this.geometry = new LineSegmentsGeometry();
        this.geometry.setPositions(this.segmentPositions);
        this.geometry.setColors(this.segmentColors);

        // Cache the interleaved buffers so updates only need a needsUpdate flag
        this.positionBuffer = this.geometry.attributes.instanceStart.data;
        this.colorBuffer = this.geometry.attributes.instanceColorStart.data;

        // Nothing is drawn until points arrive
        this.geometry.instanceCount = 0;

        // Create material with vertex colors for fading effect
        this.material = new LineMaterial({
            vertexColors: true,
            transparent: true,
            linewidth: this.lineWidth,
            resolution: new THREE.Vector2(window.innerWidth, window.innerHeight)
        });

        // Create the line object
        this.line = new LineSegments2(this.geometry, this.material);
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

        // Add current position to trail (copied into a pooled vector to avoid
        // holding a reference to the body's live position vector)
        this.points.push(this.#acquirePoint().copy(position));

        // Perform smooth cleanup based on proximity to own tail
        this.performSmoothCleanup(position);

        // Limit trail length with automatic pruning (fallback safety)
        if (this.points.length > this.maxLength) {
            this.#releaseOldestPoint();
        }

        // Update the visual geometry
        this.updateGeometry();
    }

    /**
     * Take a vector from the pool, or create one if the pool is empty
     * @returns {THREE.Vector3}
     * @private
     */
    #acquirePoint() {
        return this.pointPool.pop() || new THREE.Vector3();
    }

    /**
     * Drop the oldest trail point and return its vector to the pool
     * @private
     */
    #releaseOldestPoint() {
        const point = this.points.shift();
        if (point) {
            this.pointPool.push(point);
        }
    }

    /**
     * Perform tail-chasing effect: fade trail based on proximity to own tail
     * @param {THREE.Vector3} currentPosition - Current position
     * @private
     */
    performSmoothCleanup(currentPosition) {
        const minTrailBeforeCleanup = 50;
        if (this.points.length < minTrailBeforeCleanup) return;

        // Calculate how close we are to our own tail (older trail segments).
        // The trail is dense enough that neighbouring points are near-identical, so
        // the scan is strided rather than exhaustive - this keeps the cost flat
        // instead of growing with trail length.
        let minSquaredToTail = Infinity;
        const skipRecent = 30; // Skip recent points
        const scanEnd = this.points.length - skipRecent;
        const stride = 8;

        for (let i = 0; i < scanEnd; i += stride) {
            const squaredDistance = currentPosition.distanceToSquared(this.points[i]);
            if (squaredDistance < minSquaredToTail) {
                minSquaredToTail = squaredDistance;
            }
        }

        const minDistanceToTail = Math.sqrt(minSquaredToTail);

        // Dynamic trail length based on proximity to own tail
        const fadeDistance = this.autoClearDistance * 2;
        const proximityFactor = Math.min(1, minDistanceToTail / fadeDistance);

        // Calculate target trail length (shorter when approaching tail)
        const minLength = 30;
        const targetLength = Math.floor(minLength + (this.maxLength - minLength) * proximityFactor);

        // Chase cleanup: remove exactly one point per frame when needed
        if (this.points.length > targetLength && this.points.length > minLength) {
            this.#releaseOldestPoint(); // Remove only one oldest point per frame
        }
    }

    /**
     * Rewrite the segment buffers from the current trail points and fading
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
        const alphas = this.pointAlphas;

        // Current position for tail-chasing calculation
        const currentPos = this.points[numPoints - 1];
        const tailChaseDistance = this.autoClearDistance * 3;

        // Tail-chasing only ever dims the oldest third of the trail, so distances
        // are computed for that range alone
        const oldSegmentThreshold = Math.floor(numPoints * 0.33);
        const fadeStartIndex = numPoints - this.fadeLength;

        for (let i = 0; i < numPoints; i++) {
            // Base unidirectional fade: older points (lower index) = more transparent
            let baseAlpha;
            if (numPoints <= this.fadeLength) {
                // For short trails, fade smoothly from start to end
                baseAlpha = this.minOpacity + (1.0 - this.minOpacity) * (i / (numPoints - 1));
            } else if (i < fadeStartIndex) {
                // For long trails, keep most points at minimum opacity...
                baseAlpha = this.minOpacity;
            } else {
                // ...and fade only the recent ones
                const fadeProgress = (i - fadeStartIndex) / (this.fadeLength - 1);
                baseAlpha = this.minOpacity + (1.0 - this.minOpacity) * fadeProgress;
            }

            // Tail-chasing effect: only fade very old points when planet approaches them
            let tailChaseFactor = 1.0;
            if (i < oldSegmentThreshold) {
                const distanceToCurrentPos = currentPos.distanceTo(this.points[i]);
                if (distanceToCurrentPos < tailChaseDistance) {
                    tailChaseFactor = Math.max(0.1, distanceToCurrentPos / tailChaseDistance);
                }
            }

            // Combine: base fade provides natural aging, chase fade adds dynamic clearing
            alphas[i] = baseAlpha * tailChaseFactor;
        }

        // Store the trail relative to its newest point rather than in absolute world space.
        //
        // Trail points are world positions that can be hundreds of scene units from the
        // origin, while the body they follow has a radius of a ten-thousandth of a unit.
        // A float32 attribute only carries ~7 significant digits, so absolute coordinates
        // were quantised to a visible fraction of a pixel as soon as the camera got close
        // to a distant planet, which is what produced the staircase along the line.
        // Carrying the large offset on the line's transform instead keeps the vertex data
        // small: Three.js composes the model-view matrix in double precision, so the
        // rounding only ever applies to camera-relative values.
        const origin = this.points[numPoints - 1];
        const ox = origin.x, oy = origin.y, oz = origin.z;
        this.line.position.copy(origin);

        // Fill the interleaved segment buffers in place: segment i spans point i -> i + 1
        const positions = this.segmentPositions;
        const colors = this.segmentColors;
        const { r, g, b } = this.color;

        let minX = Infinity, minY = Infinity, minZ = Infinity;
        let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

        for (let i = 0; i < numPoints - 1; i++) {
            const start = this.points[i];
            const end = this.points[i + 1];
            const offset = i * 6;

            const startX = start.x - ox, startY = start.y - oy, startZ = start.z - oz;

            positions[offset] = startX;
            positions[offset + 1] = startY;
            positions[offset + 2] = startZ;
            positions[offset + 3] = end.x - ox;
            positions[offset + 4] = end.y - oy;
            positions[offset + 5] = end.z - oz;

            const startAlpha = alphas[i];
            const endAlpha = alphas[i + 1];
            colors[offset] = r * startAlpha;
            colors[offset + 1] = g * startAlpha;
            colors[offset + 2] = b * startAlpha;
            colors[offset + 3] = r * endAlpha;
            colors[offset + 4] = g * endAlpha;
            colors[offset + 5] = b * endAlpha;

            if (startX < minX) minX = startX;
            if (startY < minY) minY = startY;
            if (startZ < minZ) minZ = startZ;
            if (startX > maxX) maxX = startX;
            if (startY > maxY) maxY = startY;
            if (startZ > maxZ) maxZ = startZ;
        }

        // Include the final point, which is only ever a segment end. It is the origin,
        // so in the line's local space it sits exactly at zero.
        if (minX > 0) minX = 0;
        if (minY > 0) minY = 0;
        if (minZ > 0) minZ = 0;
        if (maxX < 0) maxX = 0;
        if (maxY < 0) maxY = 0;
        if (maxZ < 0) maxZ = 0;

        // Draw only the populated part of the buffer and flag it for upload
        this.geometry.instanceCount = numPoints - 1;
        this.positionBuffer.needsUpdate = true;
        this.colorBuffer.needsUpdate = true;

        // Maintain the bounding sphere by hand; the inherited computeBoundingSphere()
        // would walk the whole capacity buffer, including the unused zeroed tail,
        // and would wrongly stretch the bounds back to the origin.
        this.#updateBoundingSphere(minX, minY, minZ, maxX, maxY, maxZ);
    }

    /**
     * Set the geometry bounding sphere from a point-cloud AABB so frustum culling
     * stays correct without rescanning the buffers
     * @private
     */
    #updateBoundingSphere(minX, minY, minZ, maxX, maxY, maxZ) {
        if (!this.geometry.boundingSphere) {
            this.geometry.boundingSphere = new THREE.Sphere();
        }

        MathUtils.setSphereFromBox(this.geometry.boundingSphere, minX, minY, minZ, maxX, maxY, maxZ);
    }

    /**
     * Reset geometry to an empty state
     * @private
     */
    resetToMinimalState() {
        if (this.line) {
            this.line.position.set(0, 0, 0);
        }

        if (this.geometry) {
            this.geometry.instanceCount = 0;

            if (this.geometry.boundingSphere) {
                this.geometry.boundingSphere.center.set(0, 0, 0);
                this.geometry.boundingSphere.radius = 0;
            }
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
     * Hide the orbit trail
     */
    hide() {
        this.setVisible(false);
    }

    /**
     * Show the orbit trail
     */
    show() {
        this.setVisible(true);
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
        // Return the vectors to the pool rather than dropping them for the GC
        while (this.points.length > 0) {
            this.#releaseOldestPoint();
        }

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

        // Clear trail points and buffers
        this.points = [];
        this.pointPool = [];
        this.positionBuffer = null;
        this.colorBuffer = null;

        log.debug('OrbitTrail', `Disposed orbit trail for ${this.bodyName}`);
    }
}

export default OrbitTrail;
