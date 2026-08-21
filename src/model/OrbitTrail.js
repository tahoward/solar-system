import * as THREE from 'three';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import SceneManager from '../managers/SceneManager.js';
import MathUtils from '../utils/MathUtils.js';
import { log } from '../utils/Logger.js';

/**
 * Fading ribbon tracing the path a body has actually travelled.
 *
 * Unlike an {@link Orbit} line, which draws the ideal ellipse, this records where
 * the body has really been — so it shows the perturbations and drift the n-body
 * integrator produces.
 *
 * Rendered with `LineSegments2` so the ribbon has real screen-space width, which
 * a plain `THREE.Line` cannot provide. Points are held in a fixed-capacity ring
 * of pooled vectors and written into preallocated typed arrays, since this
 * updates every frame for every body.
 */
export class OrbitTrail {
    /**
     * Creates a trail and adds its line to the scene.
     *
     * Trails start disabled, so nothing is recorded until
     * {@link OrbitTrail#setEnabled} is called.
     *
     * @param {string} bodyName - Name of the body, used in log messages.
     * @param {THREE.Color} color - Trail colour; copied, not retained.
     * @param {{maxLength?: number, fadeLength?: number, minOpacity?: number,
     *   autoClearDistance?: number, lineWidth?: number}} [options={}] - Capacity in
     *   points, length of the fade-in tail, opacity floor, the distance scale used
     *   for tail trimming, and line width in pixels.
     */
    constructor(bodyName, color, options = {}) {
        this.bodyName = bodyName;
        this.color = color.clone();

        this.maxLength = options.maxLength || 1200;
        this.fadeLength = options.fadeLength || 400;
        this.minOpacity = options.minOpacity || 0.05;
        this.autoClearDistance = options.autoClearDistance || 0.6;
        this.lineWidth = options.lineWidth || 2;

        this.points = [];
        this.pointPool = [];
        this.updateCounter = 0;
        this.visible = false;
        this.enabled = false;

        const maxSegments = Math.max(1, this.maxLength - 1);
        this.segmentPositions = new Float32Array(maxSegments * 6);
        this.segmentColors = new Float32Array(maxSegments * 6);
        this.pointAlphas = new Float32Array(this.maxLength);

        this.line = null;
        this.geometry = null;
        this.material = null;

        this.initializeRendering();

        log.debug('OrbitTrail', `Created orbit trail for ${this.bodyName}`);
    }

    /**
     * Builds the line geometry, material and mesh, and registers them.
     *
     * The geometry is allocated at full capacity up front and drawn partially via
     * `instanceCount`, so growing the trail never reallocates. Direct references to
     * the interleaved buffers are kept so per-frame updates can flag them dirty
     * without going back through the geometry. The material is registered with the
     * scene manager, which owns keeping its resolution uniform in step with the
     * canvas size.
     *
     * It writes no depth, matching {@link Orbit} and {@link BarycentrePath}. A trail is a
     * transparent marker rather than a surface, and a fat line is drawn as a strip of
     * screen-space quads — so writing depth would lay a two-pixel-wide slab of solid depth
     * along the whole path, at the path's own distance, and occlude anything depth tested
     * drawn after it. The accretion disc's gas is exactly that: a trail crossing between the
     * camera and a black hole would cut rounded-rectangular bites out of the disc, one per segment.
     *
     * @returns {void}
     */
    initializeRendering() {
        this.geometry = new LineSegmentsGeometry();
        this.geometry.setPositions(this.segmentPositions);
        this.geometry.setColors(this.segmentColors);

        this.positionBuffer = this.geometry.attributes.instanceStart.data;
        this.colorBuffer = this.geometry.attributes.instanceColorStart.data;

        this.geometry.instanceCount = 0;

        this.material = new LineMaterial({
            vertexColors: true,
            transparent: true,
            depthWrite: false,
            linewidth: this.lineWidth,
            resolution: new THREE.Vector2(window.innerWidth, window.innerHeight)
        });

        this.line = new LineSegments2(this.geometry, this.material);
        this.line.visible = false;
        SceneManager.markOverlay(this.line);

        SceneManager.scene.add(this.line);

        SceneManager.registerLineMaterial(this.material);
    }

    /**
     * Records a new trail point and rebuilds the line.
     *
     * No-ops while the trail is disabled. The oldest point is retired once
     * capacity is reached.
     *
     * @param {THREE.Vector3} position - Position to append; copied, not retained.
     * @returns {void}
     */
    addPoint(position) {
        if (!this.enabled) {
            return;
        }

        this.updateCounter++;

        this.points.push(this.#acquirePoint().copy(position));

        this.performSmoothCleanup(position);

        if (this.points.length > this.maxLength) {
            this.#releaseOldestPoint();
        }

        this.updateGeometry();
    }

    /**
     * Takes a vector from the pool, or allocates one if the pool is empty.
     *
     * @private
     * @returns {THREE.Vector3} A vector whose contents are undefined and must be set.
     */
    #acquirePoint() {
        return this.pointPool.pop() || new THREE.Vector3();
    }

    /**
     * Retires the oldest point, returning its vector to the pool.
     *
     * @private
     * @returns {void}
     */
    #releaseOldestPoint() {
        const point = this.points.shift();
        if (point) {
            this.pointPool.push(point);
        }
    }

    /**
     * Trims the trail as the body catches up with its own tail.
     *
     * On a closed orbit the trail would otherwise wrap round and overlap itself,
     * leaving an unreadable double line. The target length is therefore scaled by
     * how close the body is to the older part of the trail: far away it keeps its
     * full length, and as it closes in the tail is shortened towards a short stub.
     *
     * The proximity scan skips the most recent points, which are trivially close,
     * and strides through the rest rather than checking every one — the result only
     * drives a fade, so an approximate minimum is enough.
     *
     * @param {THREE.Vector3} currentPosition - The body's current position.
     * @returns {void}
     */
    performSmoothCleanup(currentPosition) {
        const minTrailBeforeCleanup = 50;
        if (this.points.length < minTrailBeforeCleanup) return;

        let minSquaredToTail = Infinity;
        const skipRecent = 30;
        const scanEnd = this.points.length - skipRecent;
        const stride = 8;

        for (let i = 0; i < scanEnd; i += stride) {
            const squaredDistance = currentPosition.distanceToSquared(this.points[i]);
            if (squaredDistance < minSquaredToTail) {
                minSquaredToTail = squaredDistance;
            }
        }

        const minDistanceToTail = Math.sqrt(minSquaredToTail);

        const fadeDistance = this.autoClearDistance * 2;
        const proximityFactor = Math.min(1, minDistanceToTail / fadeDistance);

        const minLength = 30;
        const targetLength = Math.floor(minLength + (this.maxLength - minLength) * proximityFactor);

        if (this.points.length > targetLength && this.points.length > minLength) {
            this.#releaseOldestPoint();
        }
    }

    /**
     * Rewrites the line's vertex and colour buffers from the current points.
     *
     * Opacity is baked into the vertex colours — the trail brightens from
     * `minOpacity` at the tail to full at the body's current position, and older
     * segments are dimmed further where the body is close to overlapping them, so
     * a wrapping trail fades out instead of crossing itself.
     *
     * Positions are stored relative to the newest point, with that point used as
     * the line's own origin. At solar-system distances absolute coordinates are
     * large enough that float32 precision produces visible jitter; keeping the
     * geometry local avoids it.
     *
     * The bounding sphere is computed from the vertices as they are written, since
     * `LineSegments2` cannot derive one itself from a partially filled buffer, and
     * without it the trail would be wrongly frustum-culled.
     *
     * @returns {void}
     */
    updateGeometry() {
        if (!this.line || this.points.length < 2) {
            if (this.line && this.points.length === 0) {
                this.resetToMinimalState();
            }
            return;
        }

        const numPoints = this.points.length;
        const alphas = this.pointAlphas;

        const currentPos = this.points[numPoints - 1];
        const tailChaseDistance = this.autoClearDistance * 3;

        const oldSegmentThreshold = Math.floor(numPoints * 0.33);
        const fadeStartIndex = numPoints - this.fadeLength;

        for (let i = 0; i < numPoints; i++) {
            let baseAlpha;
            if (numPoints <= this.fadeLength) {
                baseAlpha = this.minOpacity + (1.0 - this.minOpacity) * (i / (numPoints - 1));
            } else if (i < fadeStartIndex) {
                baseAlpha = this.minOpacity;
            } else {
                const fadeProgress = (i - fadeStartIndex) / (this.fadeLength - 1);
                baseAlpha = this.minOpacity + (1.0 - this.minOpacity) * fadeProgress;
            }

            let tailChaseFactor = 1.0;
            if (i < oldSegmentThreshold) {
                const distanceToCurrentPos = currentPos.distanceTo(this.points[i]);
                if (distanceToCurrentPos < tailChaseDistance) {
                    tailChaseFactor = Math.max(0.1, distanceToCurrentPos / tailChaseDistance);
                }
            }

            alphas[i] = baseAlpha * tailChaseFactor;
        }

        const origin = this.points[numPoints - 1];
        const ox = origin.x, oy = origin.y, oz = origin.z;
        this.line.position.copy(origin);

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

        if (minX > 0) minX = 0;
        if (minY > 0) minY = 0;
        if (minZ > 0) minZ = 0;
        if (maxX < 0) maxX = 0;
        if (maxY < 0) maxY = 0;
        if (maxZ < 0) maxZ = 0;

        this.geometry.instanceCount = numPoints - 1;
        this.positionBuffer.needsUpdate = true;
        this.colorBuffer.needsUpdate = true;

        this.#updateBoundingSphere(minX, minY, minZ, maxX, maxY, maxZ);
    }

    /**
     * Fits the geometry's bounding sphere around the trail's extent.
     *
     * @private
     * @param {number} minX - Minimum x of the trail, in local coordinates.
     * @param {number} minY - Minimum y of the trail.
     * @param {number} minZ - Minimum z of the trail.
     * @param {number} maxX - Maximum x of the trail.
     * @param {number} maxY - Maximum y of the trail.
     * @param {number} maxZ - Maximum z of the trail.
     * @returns {void}
     */
    #updateBoundingSphere(minX, minY, minZ, maxX, maxY, maxZ) {
        if (!this.geometry.boundingSphere) {
            this.geometry.boundingSphere = new THREE.Sphere();
        }

        MathUtils.setSphereFromBox(this.geometry.boundingSphere, minX, minY, minZ, maxX, maxY, maxZ);
    }

    /**
     * Collapses the line to draw nothing, without releasing its buffers.
     *
     * Used when the trail is emptied; the allocations are kept so it can start
     * recording again immediately.
     *
     * @returns {void}
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
     * Turns recording on or off, clearing the trail when switched off.
     *
     * The line is only drawn when enabled *and* visible — enabling governs whether
     * points accumulate, while visibility is the display toggle.
     *
     * @param {boolean} enabled - Whether the trail should record.
     * @returns {void}
     */
    setEnabled(enabled) {
        this.enabled = enabled;
        if (this.line) {
            this.line.visible = enabled && this.visible;
        }

        if (!enabled) {
            this.clear();
        }

        log.debug('OrbitTrail', `Trail ${enabled ? 'enabled' : 'disabled'} for ${this.bodyName}`);
    }

    /**
     * Shows or hides the trail without affecting whether it records.
     *
     * @param {boolean} visible - Whether the line should be drawn.
     * @returns {void}
     */
    setVisible(visible) {
        this.visible = visible;
        if (this.line) {
            this.line.visible = visible && this.enabled;
        }
    }

    /**
     * Hides the trail, keeping its points.
     *
     * @returns {void}
     */
    hide() {
        this.setVisible(false);
    }

    /**
     * Shows the trail again.
     *
     * @returns {void}
     */
    show() {
        this.setVisible(true);
    }

    /**
     * Flips the trail between recording and off.
     *
     * @returns {boolean} The new enabled state.
     */
    toggle() {
        this.setEnabled(!this.enabled);
        return this.enabled;
    }

    /**
     * Discards all recorded points, returning their vectors to the pool.
     *
     * @returns {void}
     */
    clear() {
        while (this.points.length > 0) {
            this.#releaseOldestPoint();
        }

        this.updateCounter = 0;
        this.resetToMinimalState();
        log.debug('OrbitTrail', `Cleared trail for ${this.bodyName}`);
    }

    /**
     * Releases the trail's GPU resources and removes its line from the scene.
     *
     * @returns {void}
     */
    dispose() {
        if (this.geometry) {
            this.geometry.dispose();
            this.geometry = null;
        }

        if (this.material) {
            SceneManager.unregisterLineMaterial(this.material);
            this.material.dispose();
            this.material = null;
        }

        if (this.line) {
            if (this.line.parent) {
                this.line.parent.remove(this.line);
            }
            this.line = null;
        }

        this.points = [];
        this.pointPool = [];
        this.positionBuffer = null;
        this.colorBuffer = null;

        log.debug('OrbitTrail', `Disposed orbit trail for ${this.bodyName}`);
    }
}

export default OrbitTrail;
