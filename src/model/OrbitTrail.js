import * as THREE from 'three';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import SceneManager from '../managers/SceneManager.js';
import MathUtils from '../utils/MathUtils.js';
import { log } from '../utils/Logger.js';

export class OrbitTrail {
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
            linewidth: this.lineWidth,
            resolution: new THREE.Vector2(window.innerWidth, window.innerHeight)
        });

        this.line = new LineSegments2(this.geometry, this.material);
        this.line.visible = false;

        SceneManager.scene.add(this.line);

        SceneManager.registerLineMaterial(this.material);
    }

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

    #acquirePoint() {
        return this.pointPool.pop() || new THREE.Vector3();
    }

    #releaseOldestPoint() {
        const point = this.points.shift();
        if (point) {
            this.pointPool.push(point);
        }
    }

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

    #updateBoundingSphere(minX, minY, minZ, maxX, maxY, maxZ) {
        if (!this.geometry.boundingSphere) {
            this.geometry.boundingSphere = new THREE.Sphere();
        }

        MathUtils.setSphereFromBox(this.geometry.boundingSphere, minX, minY, minZ, maxX, maxY, maxZ);
    }

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

    setVisible(visible) {
        this.visible = visible;
        if (this.line) {
            this.line.visible = visible && this.enabled;
        }
    }

    hide() {
        this.setVisible(false);
    }

    show() {
        this.setVisible(true);
    }

    toggle() {
        this.setEnabled(!this.enabled);
        return this.enabled;
    }

    clear() {
        while (this.points.length > 0) {
            this.#releaseOldestPoint();
        }

        this.updateCounter = 0;
        this.resetToMinimalState();
        log.debug('OrbitTrail', `Cleared trail for ${this.bodyName}`);
    }

    setColor(newColor) {
        this.color = newColor.clone();
        if (this.points.length > 0) {
            this.updateGeometry();
        } else {
            this.resetToMinimalState();
        }
    }

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
