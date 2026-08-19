import * as THREE from 'three';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import SceneManager from '../managers/SceneManager.js';
import MathUtils from '../utils/MathUtils.js';
import { BARYCENTRE, MATH } from '../constants.js';
import { calculateGM, getAUScale, solveKeplerEquation } from '../physics/kepler.js';
import { systemMass, systemState } from '../physics/barycentre.js';
import { log } from '../utils/Logger.js';

const PI_OVER_180 = MATH.PI_OVER_180;

const MIN_ECCENTRICITY_FOR_PERIAPSIS = 1e-9;

const _position = new THREE.Vector3();
const _velocity = new THREE.Vector3();
const _rootVelocity = new THREE.Vector3();
const _eccentricityVector = new THREE.Vector3();
const _orbitNormal = new THREE.Vector3();
const _sample = new THREE.Vector3();
const _offsetSum = new THREE.Vector3();
const _linePosition = new THREE.Vector3();

class Contributor {
    constructor() {
        this.weight = 0;
        this.frozen = true;
        this.offset = new THREE.Vector3();
        this.periapsisAxis = new THREE.Vector3();
        this.inPlaneAxis = new THREE.Vector3();
        this.semiMajorAxis = 0;
        this.semiMinorAxis = 0;
        this.eccentricity = 0;
        this.meanAnomalyAtEpoch = 0;
        this.meanMotion = 0;
    }

    read(position, velocity, mu) {
        this.frozen = true;
        this.offset.copy(position);

        const radius = position.length();
        if (!(radius > 0) || !(mu > 0)) return;

        const speedSquared = velocity.lengthSq();
        const inverseSemiMajorAxis = 2 / radius - speedSquared / mu;
        if (!(inverseSemiMajorAxis > 0)) return;

        _eccentricityVector.copy(position).multiplyScalar(speedSquared - mu / radius)
            .addScaledVector(velocity, -position.dot(velocity))
            .divideScalar(mu);
        const eccentricity = _eccentricityVector.length();
        if (!(eccentricity < 1)) return;

        _orbitNormal.crossVectors(position, velocity);
        if (_orbitNormal.lengthSq() === 0) return;

        if (eccentricity > MIN_ECCENTRICITY_FOR_PERIAPSIS) {
            this.periapsisAxis.copy(_eccentricityVector).divideScalar(eccentricity);
        } else {
            this.periapsisAxis.copy(position).divideScalar(radius);
        }
        this.inPlaneAxis.crossVectors(_orbitNormal.normalize(), this.periapsisAxis);

        const semiMajorAxis = 1 / inverseSemiMajorAxis;
        const semiMinorAxis = semiMajorAxis * Math.sqrt(1 - eccentricity * eccentricity);

        const eccentricAnomaly = Math.atan2(
            position.dot(this.inPlaneAxis) / semiMinorAxis,
            position.dot(this.periapsisAxis) / semiMajorAxis + eccentricity);

        this.eccentricity = eccentricity;
        this.semiMajorAxis = semiMajorAxis;
        this.semiMinorAxis = semiMinorAxis;
        this.meanAnomalyAtEpoch = eccentricAnomaly - eccentricity * Math.sin(eccentricAnomaly);
        this.meanMotion = Math.sqrt(mu * inverseSemiMajorAxis ** 3);
        this.frozen = false;
    }

    positionAt(time, target) {
        if (this.frozen) return target.copy(this.offset);

        const meanAnomaly = this.meanAnomalyAtEpoch + this.meanMotion * time;
        const eccentricAnomaly = solveKeplerEquation(meanAnomaly, this.eccentricity);

        return target.copy(this.periapsisAxis)
            .multiplyScalar(this.semiMajorAxis * (Math.cos(eccentricAnomaly) - this.eccentricity))
            .addScaledVector(this.inPlaneAxis, this.semiMinorAxis * Math.sin(eccentricAnomaly));
    }
}

class BarycentrePath {
    constructor(body, sceneScale) {
        this.body = body;
        this.sceneScale = sceneScale;

        this.parentBody = null;
        this.semiMajorAxis = 0;
        this.eccentricity = 0;
        this.orbitalPeriod = 0;

        this.timeUnitsPerYear = getAUScale(sceneScale) ** 1.5;

        this.contributors = [];

        const maxPoints = BARYCENTRE.MAX_SEGMENTS + 1;
        this.pathPoints = new Float64Array(maxPoints * 3);
        this.pathPointCount = 0;
        this.segmentPositions = new Float32Array((maxPoints - 1) * 6);
        this.currentSegments = BARYCENTRE.MIN_SEGMENTS;

        this.amplitude = 0;
        this.pathLength = 0;

        this.barycentre = new THREE.Vector3();
        this.offset = new THREE.Vector3();
        this.anchorOffset = new THREE.Vector3();

        const material = new LineMaterial({
            color: body.markerColor || body.material?.color,
            linewidth: 2,
            resolution: new THREE.Vector2(window.innerWidth, window.innerHeight),
            transparent: true,
            opacity: 0.8,
            depthWrite: false,
            depthTest: true
        });

        const geometry = new LineSegmentsGeometry();
        geometry.setPositions(this.segmentPositions);
        this.positionBuffer = geometry.attributes.instanceStart.data;
        geometry.instanceCount = 0;

        this.orbitLine = new LineSegments2(geometry, material);
        this.orbitLine.renderOrder = -100;
        this.orbitLine.material.userData = { renderBehindMarkers: true };
        SceneManager.scene.add(this.orbitLine);
        SceneManager.registerLineMaterial(material);

        this.isVisible = true;

        log.debug('BarycentrePath', `Drawing ${body.name}'s path about the system's centre of mass`);
    }

    #updateBarycentre() {
        systemState(this.body, this.barycentre);
        this.offset.subVectors(this.body.group.position, this.barycentre);
    }

    #placeLine() {
        _linePosition.copy(this.barycentre);

        const parent = this.orbitLine.parent;
        if (parent) parent.worldToLocal(_linePosition);

        this.orbitLine.position.copy(_linePosition);
    }

    #readContributors() {
        const root = this.body;
        const children = root.children || [];
        const totalMass = systemMass(root);

        if (root.velocity) {
            _rootVelocity.copy(root.velocity);
        } else {
            _rootVelocity.set(0, 0, 0);
        }

        let count = 0;
        for (let i = 0; i < children.length; i++) {
            const child = children[i].body;
            const mass = systemMass(child);
            if (!(mass > 0) || !(totalMass > 0)) continue;

            systemState(child, _position, _velocity);
            _position.sub(root.group.position);
            _velocity.sub(_rootVelocity);

            let contributor = this.contributors[count];
            if (!contributor) {
                contributor = new Contributor();
                this.contributors[count] = contributor;
            }

            contributor.weight = mass / totalMass;
            contributor.read(_position, _velocity, calculateGM(root, mass));
            count++;
        }

        return count;
    }

    #buildPath(segments) {
        const steps = Math.max(2, 2 * Math.round(
            Math.min(Math.max(segments, BARYCENTRE.MIN_SEGMENTS), BARYCENTRE.MAX_SEGMENTS) / 2));
        const anchorIndex = steps / 2;

        const contributors = this.contributors;
        const count = this.#readContributors();
        const points = this.pathPoints;
        const step = BARYCENTRE.PATH_YEARS * this.timeUnitsPerYear / steps;

        let amplitude = 0;
        let length = 0;

        for (let i = 0; i <= steps; i++) {
            const time = (i - anchorIndex) * step;

            _offsetSum.set(0, 0, 0);
            for (let j = 0; j < count; j++) {
                const contributor = contributors[j];
                contributor.positionAt(time, _sample);
                _offsetSum.addScaledVector(_sample, -contributor.weight);
            }

            const offset = i * 3;
            if (i > 0) {
                length += Math.hypot(_offsetSum.x - points[offset - 3],
                    _offsetSum.y - points[offset - 2], _offsetSum.z - points[offset - 1]);
            }

            points[offset] = _offsetSum.x;
            points[offset + 1] = _offsetSum.y;
            points[offset + 2] = _offsetSum.z;

            const distance = _offsetSum.lengthSq();
            if (distance > amplitude) amplitude = distance;
        }

        this.pathPointCount = steps + 1;
        this.currentSegments = steps;
        this.amplitude = Math.sqrt(amplitude);
        this.pathLength = length;

        const anchor = anchorIndex * 3;
        this.anchorOffset.set(points[anchor], points[anchor + 1], points[anchor + 2]);
    }

    #writeSegments() {
        const count = this.pathPointCount;
        if (count < 2) {
            this.orbitLine.geometry.instanceCount = 0;
            return;
        }

        const points = this.pathPoints;
        const positions = this.segmentPositions;

        let minX = Infinity, minY = Infinity, minZ = Infinity;
        let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

        for (let i = 0; i < count - 1; i++) {
            const start = i * 3;
            const end = start + 3;
            const offset = i * 6;

            const x = points[start];
            const y = points[start + 1];
            const z = points[start + 2];

            positions[offset] = x;
            positions[offset + 1] = y;
            positions[offset + 2] = z;
            positions[offset + 3] = points[end];
            positions[offset + 4] = points[end + 1];
            positions[offset + 5] = points[end + 2];

            if (x < minX) minX = x;
            if (y < minY) minY = y;
            if (z < minZ) minZ = z;
            if (x > maxX) maxX = x;
            if (y > maxY) maxY = y;
            if (z > maxZ) maxZ = z;
        }

        const last = (count - 1) * 3;
        minX = Math.min(minX, points[last]);
        minY = Math.min(minY, points[last + 1]);
        minZ = Math.min(minZ, points[last + 2]);
        maxX = Math.max(maxX, points[last]);
        maxY = Math.max(maxY, points[last + 1]);
        maxZ = Math.max(maxZ, points[last + 2]);

        this.orbitLine.geometry.instanceCount = count - 1;
        this.positionBuffer.needsUpdate = true;

        const geometry = this.orbitLine.geometry;
        if (!geometry.boundingSphere) {
            geometry.boundingSphere = new THREE.Sphere();
        }
        MathUtils.setSphereFromBox(geometry.boundingSphere, minX, minY, minZ, maxX, maxY, maxZ);
    }

    #unitsPerPixel(cameraPosition) {
        const camera = SceneManager.camera;
        const viewportHeight = SceneManager.renderer.domElement.height || window.innerHeight;
        const distance = Math.max(cameraPosition.distanceTo(this.barycentre), 1e-9);

        return 2 * distance * Math.tan(camera.fov * PI_OVER_180 / 2) / viewportHeight;
    }

    updateLOD(cameraPosition) {
        if (!this.orbitLine) return;

        this.#updateBarycentre();
        this.#placeLine();

        if (!this.isVisible) return;

        let needsRebuild = this.pathPointCount === 0;

        if (!needsRebuild) {
            const unitsPerPixel = this.#unitsPerPixel(cameraPosition);

            if (this.amplitude / unitsPerPixel >= BARYCENTRE.MIN_PIXEL_RADIUS) {
                if (this.offset.distanceTo(this.anchorOffset)
                    > this.amplitude * BARYCENTRE.RECENTRE_FRACTION) {
                    needsRebuild = true;
                } else {
                    const wanted = Math.round(this.pathLength / unitsPerPixel
                        / BARYCENTRE.TARGET_SEGMENT_PIXELS);
                    const segments = Math.min(Math.max(wanted, BARYCENTRE.MIN_SEGMENTS),
                        BARYCENTRE.MAX_SEGMENTS);

                    if (Math.abs(segments - this.currentSegments)
                        >= Math.max(8, this.currentSegments * BARYCENTRE.REBUILD_RATIO)) {
                        this.currentSegments = segments;
                        needsRebuild = true;
                    }
                }
            }
        }

        if (needsRebuild) {
            this.#buildPath(this.currentSegments);
            this.#writeSegments();
        }
    }

    show() {
        this.isVisible = true;
        if (this.orbitLine) this.orbitLine.visible = true;
    }

    hide() {
        this.isVisible = false;
        if (this.orbitLine) this.orbitLine.visible = false;
    }

    getVisibility() {
        return this.isVisible && !!this.orbitLine?.visible;
    }

    dispose() {
        SceneManager.unregisterOrbit(this);

        if (this.orbitLine) {
            if (this.orbitLine.parent) this.orbitLine.parent.remove(this.orbitLine);
            this.orbitLine.geometry.dispose();
            SceneManager.unregisterLineMaterial(this.orbitLine.material);
            this.orbitLine.material.dispose();
            this.orbitLine = null;
        }

        this.contributors.length = 0;
        this.body = null;
    }
}

export default BarycentrePath;
