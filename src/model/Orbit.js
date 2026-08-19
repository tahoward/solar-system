import * as THREE from 'three';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import SceneManager from '../managers/SceneManager.js';
import ConfigValidator from '../utils/ConfigValidator.js';
import MathUtils from '../utils/MathUtils.js';
import { ORBIT, MATH } from '../constants.js';
import {
    calculateGM,
    calculateOrbitalMotion,
    computePerifocalBasis,
    getAUScale
} from '../physics/kepler.js';
import { collectBodiesFromHierarchy } from '../physics/NBodySystem.js';
import { satelliteMass, systemMass } from '../physics/barycentre.js';
import { log } from '../utils/Logger.js';

const PI_OVER_180 = MATH.PI_OVER_180;

const FLOAT32_MANTISSA_STEPS = 1 << 23;

const MIN_ECCENTRICITY_FOR_PERIAPSIS = 1e-9;

const _bodyLocalPosition = new THREE.Vector3();
const _bodyLocalVelocity = new THREE.Vector3();
const _bodyDirection = new THREE.Vector3();
const _tiltAxis = new THREE.Vector3();
const _eccentricityVector = new THREE.Vector3();
const _orbitNormal = new THREE.Vector3();
const _relativePosition = new THREE.Vector3();
const _relativeVelocity = new THREE.Vector3();
const _drawnPeriapsisAxis = new THREE.Vector3();
const _drawnInPlaneAxis = new THREE.Vector3();
const _inverseParentRotation = new THREE.Quaternion();

const _candidates = [];

const _interior = [];

const _centralWeightedPosition = new THREE.Vector3();
const _centralWeightedVelocity = new THREE.Vector3();
const _centralLocalPosition = new THREE.Vector3();
const _sceneOrigin = new THREE.Vector3();
const _centralStandIn = { mass: 0 };

function interiorShare(distanceRatio) {
    const depth = 1 - distanceRatio;
    if (!(depth > 0)) return 0;
    if (depth >= 1) return 1;

    return depth * depth * (3 - 2 * depth);
}

let _osculatingInverseSemiMajorAxis = 0;


class Orbit {
    constructor(body, semiMajorAxis, eccentricity, inclination = 0, parentBody = null, longitudeOfAscendingNode = 0, argumentOfPeriapsis = 0, meanAnomalyAtEpoch = 0, sceneScale) {
        if (!body || typeof body !== 'object') {
            throw new Error('Orbit constructor: body must be a valid Body object');
        }
        if (typeof sceneScale !== 'number' || sceneScale <= 0) {
            throw new Error('Orbit constructor: sceneScale must be a positive number');
        }
        ConfigValidator.validateOrbitConfig({ semiMajorAxis, eccentricity, inclination });

        const orbitMaterial = new LineMaterial({
            color: body.markerColor || body.material.color,
            linewidth: 2,
            resolution: new THREE.Vector2(window.innerWidth, window.innerHeight),
            transparent: true,
            opacity: 0.8,
            depthWrite: false,
            depthTest: true
        });
        this.body = body;
        this.parentBody = parentBody;
        this.semiMajorAxis = semiMajorAxis;
        this.sceneScale = sceneScale;
        this.semiMajorAxisVisual = semiMajorAxis * getAUScale(this.sceneScale);
        this.eccentricity = eccentricity;
        this.inclinationRadians = inclination * PI_OVER_180;

        this.longitudeOfAscendingNodeRadians = longitudeOfAscendingNode * PI_OVER_180;
        this.argumentOfPeriapsisRadians = argumentOfPeriapsis * PI_OVER_180;
        this.meanAnomalyAtEpochRadians = meanAnomalyAtEpoch * PI_OVER_180;

        const orbitalMotion = calculateOrbitalMotion(semiMajorAxis, parentBody, body.mass);
        this.n = orbitalMotion.meanMotion;
        this.orbitalPeriod = orbitalMotion.orbitalPeriod;

        this.elements = {
            semiMajorAxis: this.semiMajorAxis,
            eccentricity: this.eccentricity,
            inclinationRadians: this.inclinationRadians,
            longitudeOfAscendingNodeRadians: this.longitudeOfAscendingNodeRadians,
            argumentOfPeriapsisRadians: this.argumentOfPeriapsisRadians,
            meanAnomalyAtEpochRadians: this.meanAnomalyAtEpochRadians,
            meanMotion: this.n
        };

        this.periapsisAxis = new THREE.Vector3();
        this.inPlaneAxis = new THREE.Vector3();
        computePerifocalBasis(this.elements, this.periapsisAxis, this.inPlaneAxis);

        this.drawnEccentricity = this.eccentricity;
        this.drawnSemiMajorAxis = this.semiMajorAxisVisual;
        this.drawnEccentricityVector = new THREE.Vector3();
        this.drawnOrbitNormal = new THREE.Vector3();
        this.drawnInverseSemiMajorAxis = 1 / this.semiMajorAxisVisual;

        this.tiltMatrix = null;
        if (parentBody && parentBody.axialTilt && body.equatorialOrbit && parentBody.axialTilt !== 0) {
            this.tiltMatrix = new THREE.Matrix4();
            this.tiltMatrix.makeRotationZ(parentBody.axialTilt * Math.PI / 180);
        }

        this.currentSegments = ORBIT.LOD.INITIAL_SEGMENTS;
        this.lastLODUpdate = 0;
        this.orbitCenter = new THREE.Vector3();

        const maxPoints = ORBIT.LOD.MAX_SEGMENTS + 2;
        this.pathPoints = new Float64Array(maxPoints * 3);
        this.pathPointCount = 0;

        this.isVisible = true;
        this.pathIsClosed = true;
        this.segmentPositions = new Float32Array((maxPoints - 1) * 6);
        this.pathOrigin = new THREE.Vector3();

        const geometry = new LineSegmentsGeometry();
        geometry.setPositions(this.segmentPositions);
        this.positionBuffer = geometry.attributes.instanceStart.data;
        this.orbitLine = new LineSegments2(geometry, orbitMaterial);

        this.orbitLine.renderOrder = -100;
        this.orbitLine.material.userData = { renderBehindMarkers: true };

        this.barycentreOffset = new THREE.Vector3();
        this.barycentreShare = 1;

        this.centralPosition = new THREE.Vector3();
        this.centralVelocity = new THREE.Vector3();
        this.centralMass = 0;

        this.companionLine = null;
        this.companionPositions = null;
        this.companionBuffer = null;

        this.referenceBody = null;
        this.#setReferenceBody(this.parentBody);

        this.#updateOrbitCenter();

        this.#buildPath(this.currentSegments, this.#bodyPositionInLineSpace(_bodyLocalPosition));
        this.#writeSegments();

        SceneManager.registerLineMaterial(orbitMaterial);

        if (this.body && this.body.initializeOrbitTrail && typeof this.body.initializeOrbitTrail === 'function') {
            this.body.initializeOrbitTrail();
        }

        SceneManager.registerOrbit(this);
    }

    #setReferenceBody(referenceBody) {
        this.referenceBody = referenceBody;
        this.#updateCentralBody();

        let container = SceneManager.scene;
        if (referenceBody === this.parentBody && referenceBody?.tiltContainer && this.body.equatorialOrbit) {
            container = referenceBody.tiltContainer;
        } else if (referenceBody?.group) {
            container = referenceBody.group;
        }

        if (this.orbitLine.parent !== container) {
            if (this.orbitLine.parent) {
                this.orbitLine.parent.remove(this.orbitLine);
            }
            container.add(this.orbitLine);
            log.debug('Orbit', `Drawing ${this.body.name}'s orbit about ${referenceBody?.name || 'the scene origin'}`);
        }

        if (referenceBody) {
            SceneManager.reparentBody(this.body, referenceBody);
        }

        this.#updateCompanionLine(container);
    }

    #updateCentralBody() {
        const reference = this.referenceBody;
        const centre = reference ? reference.group.position : _sceneOrigin;

        let mass = reference?.mass > 0 ? reference.mass : 1;
        _centralWeightedPosition.copy(centre).multiplyScalar(mass);
        _centralWeightedVelocity.copy(reference?.velocity || _sceneOrigin).multiplyScalar(mass);

        const orbitRadius = this.body.group.position.distanceTo(centre);

        const hierarchy = orbitRadius > 0 ? SceneManager.orbitManager?.hierarchy : null;
        if (hierarchy) {
            collectBodiesFromHierarchy(hierarchy, _interior);

            for (let i = 0; i < _interior.length; i++) {
                const candidate = _interior[i];
                if (candidate === this.body || candidate === reference || !(candidate.mass > 0)) continue;

                const distance = candidate.group.position.distanceTo(centre);
                const counted = candidate.mass * interiorShare(distance / orbitRadius);
                if (counted <= 0) continue;

                _centralWeightedPosition.addScaledVector(candidate.group.position, counted);
                if (candidate.velocity) {
                    _centralWeightedVelocity.addScaledVector(candidate.velocity, counted);
                }
                mass += counted;
            }

            _interior.length = 0;
        }

        this.centralPosition.copy(_centralWeightedPosition).divideScalar(mass);
        this.centralVelocity.copy(_centralWeightedVelocity).divideScalar(mass);
        this.centralMass = mass;

        _centralStandIn.mass = mass;
        const relativeGM = calculateGM(_centralStandIn, this.body.mass);
        this.barycentreShare = reference ? calculateGM(_centralStandIn) / relativeGM : 1;
        this.gravitationalParameter = relativeGM * this.barycentreShare ** 3;
    }

    #updateCompanionLine(container) {
        const counterpartAxis = this.semiMajorAxisVisual * (1 - this.barycentreShare);
        const satellites = satelliteMass(this.referenceBody);
        const wanted = !!this.referenceBody
            && counterpartAxis > (this.referenceBody.radius || 0)
            && systemMass(this.body) >= satellites * ORBIT.COMPANION_LOOP_MASS_SHARE;

        if (!wanted) {
            const had = !!this.companionLine;
            this.#disposeCompanionLine();
            return had;
        }

        let built = false;
        if (!this.companionLine) {
            built = true;
            const material = new LineMaterial({
                color: this.referenceBody.markerColor || this.referenceBody.material?.color,
                linewidth: 2,
                resolution: new THREE.Vector2(window.innerWidth, window.innerHeight),
                transparent: true,
                opacity: 0.8,
                depthWrite: false,
                depthTest: true
            });

            this.companionPositions = new Float32Array(this.segmentPositions.length);
            const geometry = new LineSegmentsGeometry();
            geometry.setPositions(this.companionPositions);
            this.companionBuffer = geometry.attributes.instanceStart.data;

            this.companionLine = new LineSegments2(geometry, material);
            this.companionLine.renderOrder = -100;
            this.companionLine.material.userData = { renderBehindMarkers: true };
            this.companionLine.visible = this.orbitLine.visible;
            SceneManager.registerLineMaterial(material);

            log.debug('Orbit', `Drawing ${this.referenceBody.name}'s own loop about its centre of mass with ${this.body.name}`);
        }

        if (this.companionLine.parent !== container) {
            if (this.companionLine.parent) {
                this.companionLine.parent.remove(this.companionLine);
            }
            container.add(this.companionLine);
        }

        return built;
    }

    #disposeCompanionLine() {
        if (!this.companionLine) return;

        if (this.companionLine.parent) {
            this.companionLine.parent.remove(this.companionLine);
        }
        this.companionLine.geometry.dispose();
        SceneManager.unregisterLineMaterial(this.companionLine.material);
        this.companionLine.material.dispose();

        this.companionLine = null;
        this.companionPositions = null;
        this.companionBuffer = null;
    }

    #selectReferenceBody() {
        const rootBody = this.#rootBody();
        const recaptureRatio = ORBIT.SPHERE_OF_INFLUENCE.RECAPTURE_RATIO;

        _candidates.length = 0;
        const hierarchy = SceneManager.orbitManager?.hierarchy;
        if (hierarchy) collectBodiesFromHierarchy(hierarchy, _candidates);

        let host = null;
        let hostReach = Infinity;
        const incumbent = this.referenceBody;
        if (incumbent && incumbent !== rootBody && _candidates.includes(incumbent)) {
            const reach = this.#sphereOfInfluence(incumbent);
            if (this.#apoapsisAbout(incumbent) <= reach) {
                host = incumbent;
                hostReach = reach * recaptureRatio;
            }
        }

        for (let i = 0; i < _candidates.length; i++) {
            const candidate = _candidates[i];
            if (candidate === this.body || candidate === host || candidate === rootBody) continue;

            const reach = this.#sphereOfInfluence(candidate);
            if (!(reach < hostReach)) continue;
            if (this.#apoapsisAbout(candidate) > reach * recaptureRatio) continue;

            if (SceneManager.hierarchyManager?.isDescendantOf(candidate.name, this.body.name)) continue;

            host = candidate;
            hostReach = reach;
        }

        _candidates.length = 0;

        return host || rootBody;
    }

    #rootBody() {
        let body = this.parentBody;
        while (body?.parentBody) {
            body = body.parentBody;
        }
        return body;
    }

    #sphereOfInfluence(body) {
        const outerBody = body.parentBody;
        if (!outerBody || !(body.mass > 0) || !(outerBody.mass > 0)) return Infinity;

        const separation = body.group.position.distanceTo(outerBody.group.position);
        return separation * Math.cbrt(body.mass / (3 * outerBody.mass));
    }

    #apoapsisAbout(body) {
        if (!this.body.velocity || !body.velocity) return Infinity;

        _relativePosition.subVectors(this.body.group.position, body.group.position);
        _relativeVelocity.subVectors(this.body.velocity, body.velocity);

        const mu = calculateGM(body, this.body.mass);
        const radius = _relativePosition.length();
        if (!(radius > 0) || !(mu > 0)) return Infinity;

        const speedSquared = _relativeVelocity.lengthSq();
        const inverseSemiMajorAxis = 2 / radius - speedSquared / mu;
        _eccentricityVector.copy(_relativePosition).multiplyScalar(speedSquared - mu / radius)
            .addScaledVector(_relativeVelocity, -_relativePosition.dot(_relativeVelocity))
            .divideScalar(mu);
        const eccentricity = _eccentricityVector.length();

        return eccentricity < 1 && inverseSemiMajorAxis > 0
            ? (1 + eccentricity) / inverseSemiMajorAxis
            : Infinity;
    }

    #readOsculatingConic(bodyPosition, radius) {
        const mu = this.gravitationalParameter;
        if (!(radius > 0) || !(mu > 0)) return NaN;

        const velocity = this.#bodyVelocityInLineSpace(_bodyLocalVelocity);
        const speedSquared = velocity.lengthSq();

        _eccentricityVector.copy(bodyPosition).multiplyScalar(speedSquared - mu / radius)
            .addScaledVector(velocity, -bodyPosition.dot(velocity))
            .divideScalar(mu);

        _orbitNormal.crossVectors(bodyPosition, velocity);

        const eccentricity = _eccentricityVector.length();
        if (!Number.isFinite(eccentricity) || _orbitNormal.lengthSq() === 0) return NaN;

        _orbitNormal.normalize();
        _osculatingInverseSemiMajorAxis = 2 / radius - speedSquared / mu;

        return eccentricity;
    }

    #solveDrawnConic(bodyPosition) {
        const radius = bodyPosition.length();
        const eccentricity = this.#readOsculatingConic(bodyPosition, radius);

        if (Number.isFinite(eccentricity)) {
            if (eccentricity > MIN_ECCENTRICITY_FOR_PERIAPSIS) {
                _drawnPeriapsisAxis.copy(_eccentricityVector).divideScalar(eccentricity);
            } else {
                _drawnPeriapsisAxis.copy(bodyPosition).divideScalar(radius);
            }

            _drawnInPlaneAxis.crossVectors(_orbitNormal, _drawnPeriapsisAxis);
            return eccentricity;
        }

        _drawnPeriapsisAxis.copy(this.periapsisAxis);
        _drawnInPlaneAxis.copy(this.inPlaneAxis);

        const alongPeriapsis = bodyPosition.dot(this.periapsisAxis);
        const acrossPeriapsis = bodyPosition.dot(this.inPlaneAxis);
        const inPlaneRadius = Math.hypot(alongPeriapsis, acrossPeriapsis);

        if (inPlaneRadius > 0) {
            const cosTrueAnomaly = alongPeriapsis / inPlaneRadius;
            const sinTrueAnomaly = acrossPeriapsis / inPlaneRadius;

            _tiltAxis.copy(this.periapsisAxis).multiplyScalar(sinTrueAnomaly)
                .addScaledVector(this.inPlaneAxis, -cosTrueAnomaly);
            _bodyDirection.copy(bodyPosition).divideScalar(radius);

            _drawnPeriapsisAxis.copy(_bodyDirection).multiplyScalar(cosTrueAnomaly)
                .addScaledVector(_tiltAxis, sinTrueAnomaly);
            _drawnInPlaneAxis.copy(_bodyDirection).multiplyScalar(sinTrueAnomaly)
                .addScaledVector(_tiltAxis, -cosTrueAnomaly);
        }

        return this.eccentricity;
    }

    #buildPath(segments, bodyPosition) {
        const steps = Math.max(1, Math.min(segments || this.currentSegments, ORBIT.LOD.MAX_SEGMENTS));
        const points = this.pathPoints;

        const eccentricity = this.#solveDrawnConic(bodyPosition);
        const periapsisAxis = _drawnPeriapsisAxis;
        const inPlaneAxis = _drawnInPlaneAxis;

        const radius = Math.max(bodyPosition.length(), Number.MIN_VALUE);
        const cosTrueAnomaly = bodyPosition.dot(periapsisAxis) / radius;
        const sinTrueAnomaly = bodyPosition.dot(inPlaneAxis) / radius;

        let anchorIndex = 0;
        let semiMajorAxis;

        if (eccentricity < 1) {
            const anchorAnomaly = Math.atan2(
                Math.sqrt(1 - eccentricity * eccentricity) * sinTrueAnomaly,
                eccentricity + cosTrueAnomaly);
            semiMajorAxis = radius / (1 - eccentricity * Math.cos(anchorAnomaly));

            const semiMinorAxis = semiMajorAxis * Math.sqrt(1 - eccentricity * eccentricity);
            const anomalyStep = MATH.TWO_PI / steps;

            for (let i = 0; i < steps; i++) {
                const eccentricAnomaly = anchorAnomaly + i * anomalyStep;
                this.#writePoint(i, semiMajorAxis * (Math.cos(eccentricAnomaly) - eccentricity),
                    semiMinorAxis * Math.sin(eccentricAnomaly), periapsisAxis, inPlaneAxis);
            }

            const last = steps * 3;
            points[last] = points[0];
            points[last + 1] = points[1];
            points[last + 2] = points[2];
        } else {
            const anchorAnomaly = Math.asinh(
                Math.sqrt(eccentricity * eccentricity - 1) * sinTrueAnomaly
                / (1 + eccentricity * cosTrueAnomaly));
            semiMajorAxis = radius / (eccentricity * Math.cosh(anchorAnomaly) - 1);

            const conjugateAxis = semiMajorAxis * Math.sqrt(eccentricity * eccentricity - 1);
            const farLimit = Math.acosh(Math.max(1,
                (ORBIT.OPEN_PATH_RADIUS_RATIO * radius / semiMajorAxis + 1) / eccentricity));
            const anomalyStep = 2 * farLimit / steps;

            anchorIndex = anomalyStep > 0
                ? Math.min(steps, Math.max(0, Math.round((anchorAnomaly + farLimit) / anomalyStep)))
                : 0;

            for (let i = 0; i <= steps; i++) {
                const hyperbolicAnomaly = anchorAnomaly + (i - anchorIndex) * anomalyStep;
                this.#writePoint(i,
                    semiMajorAxis * (eccentricity - Math.cosh(hyperbolicAnomaly)),
                    conjugateAxis * Math.sinh(hyperbolicAnomaly), periapsisAxis, inPlaneAxis);
            }
        }

        this.pathPointCount = steps + 1;
        this.drawnEccentricity = eccentricity;
        this.drawnSemiMajorAxis = semiMajorAxis;

        this.pathIsClosed = eccentricity < 1;
        this.#applyVisibility();

        this.drawnEccentricityVector.copy(periapsisAxis).multiplyScalar(eccentricity);
        this.drawnOrbitNormal.crossVectors(periapsisAxis, inPlaneAxis);
        this.drawnInverseSemiMajorAxis = (eccentricity < 1 ? 1 : -1) / semiMajorAxis;

        const anchor = anchorIndex * 3;
        this.pathOrigin.set(points[anchor], points[anchor + 1], points[anchor + 2]);
    }

    #writePoint(index, along, across, periapsisAxis, inPlaneAxis) {
        const points = this.pathPoints;
        const offset = index * 3;

        points[offset] = along * periapsisAxis.x + across * inPlaneAxis.x;
        points[offset + 1] = along * periapsisAxis.y + across * inPlaneAxis.y;
        points[offset + 2] = along * periapsisAxis.z + across * inPlaneAxis.z;
    }

    #writeSegments() {
        const count = this.pathPointCount;
        if (count < 2) {
            this.orbitLine.geometry.instanceCount = 0;
            if (this.companionLine) this.companionLine.geometry.instanceCount = 0;
            return;
        }

        this.#writeCompanionSegments(count);

        const points = this.pathPoints;
        const positions = this.segmentPositions;
        const ox = this.pathOrigin.x, oy = this.pathOrigin.y, oz = this.pathOrigin.z;

        let minX = Infinity, minY = Infinity, minZ = Infinity;
        let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

        for (let i = 0; i < count - 1; i++) {
            const start = i * 3;
            const end = start + 3;
            const offset = i * 6;

            const startX = points[start] - ox;
            const startY = points[start + 1] - oy;
            const startZ = points[start + 2] - oz;

            positions[offset] = startX;
            positions[offset + 1] = startY;
            positions[offset + 2] = startZ;
            positions[offset + 3] = points[end] - ox;
            positions[offset + 4] = points[end + 1] - oy;
            positions[offset + 5] = points[end + 2] - oz;

            if (startX < minX) minX = startX;
            if (startY < minY) minY = startY;
            if (startZ < minZ) minZ = startZ;
            if (startX > maxX) maxX = startX;
            if (startY > maxY) maxY = startY;
            if (startZ > maxZ) maxZ = startZ;
        }

        this.#placeLine();
        this.orbitLine.geometry.instanceCount = count - 1;
        this.positionBuffer.needsUpdate = true;

        const geometry = this.orbitLine.geometry;
        if (!geometry.boundingSphere) {
            geometry.boundingSphere = new THREE.Sphere();
        }
        MathUtils.setSphereFromBox(geometry.boundingSphere, minX, minY, minZ, maxX, maxY, maxZ);
    }

    #writeCompanionSegments(count) {
        if (!this.companionLine) return;

        const scale = -(1 - this.barycentreShare) / this.barycentreShare;
        const points = this.pathPoints;
        const positions = this.companionPositions;
        let radius = 0;

        for (let i = 0; i < count - 1; i++) {
            const start = i * 3;
            const end = start + 3;
            const offset = i * 6;

            const x = points[start] * scale;
            const y = points[start + 1] * scale;
            const z = points[start + 2] * scale;

            positions[offset] = x;
            positions[offset + 1] = y;
            positions[offset + 2] = z;
            positions[offset + 3] = points[end] * scale;
            positions[offset + 4] = points[end + 1] * scale;
            positions[offset + 5] = points[end + 2] * scale;

            const distance = x * x + y * y + z * z;
            if (distance > radius) radius = distance;
        }

        this.companionLine.geometry.instanceCount = count - 1;
        this.companionBuffer.needsUpdate = true;

        const geometry = this.companionLine.geometry;
        if (!geometry.boundingSphere) {
            geometry.boundingSphere = new THREE.Sphere();
        }
        geometry.boundingSphere.center.set(0, 0, 0);
        geometry.boundingSphere.radius = Math.sqrt(radius);
    }

    #maxAnchorDrift(cameraPosition) {
        const camera = SceneManager.camera;
        const viewportHeight = SceneManager.renderer.domElement.height || window.innerHeight;
        const distance = Math.max(cameraPosition.distanceTo(this.body.group.position), 1e-9);

        const unitsPerPixel = 2 * distance * Math.tan(camera.fov * PI_OVER_180 / 2) / viewportHeight;
        const pixelBudget = ORBIT.PRECISION.JITTER_PIXEL_BUDGET * unitsPerPixel;

        const eccentricity = this.drawnEccentricity;
        const shapeFactor = Math.max(0.05, Math.sqrt(Math.max(0, 1 - eccentricity * eccentricity)));
        const chordBudget = pixelBudget * this.currentSegments * shapeFactor / Math.PI;
        const roundingBudget = pixelBudget * FLOAT32_MANTISSA_STEPS;

        return Math.min(chordBudget, roundingBudget);
    }

    #shapeDrift(bodyPosition) {
        const radius = bodyPosition.length();
        const eccentricity = this.#readOsculatingConic(bodyPosition, radius);

        if (!Number.isFinite(eccentricity)) return 0;

        return radius * (_eccentricityVector.distanceTo(this.drawnEccentricityVector)
                + _orbitNormal.distanceTo(this.drawnOrbitNormal))
            + radius * radius
                * Math.abs(_osculatingInverseSemiMajorAxis - this.drawnInverseSemiMajorAxis);
    }

    #bodyPositionInLineSpace(target) {
        target.copy(this.body.group.position);
        _centralLocalPosition.copy(this.centralPosition);

        const parent = this.orbitLine.parent;
        if (parent) {
            parent.worldToLocal(target);
            parent.worldToLocal(_centralLocalPosition);
        }

        target.sub(_centralLocalPosition);

        this.barycentreOffset.copy(target).multiplyScalar(1 - this.barycentreShare)
            .add(_centralLocalPosition);

        return target.multiplyScalar(this.barycentreShare);
    }

    #bodyVelocityInLineSpace(target) {
        target.copy(this.body.velocity);

        if (this.referenceBody) {
            target.sub(this.centralVelocity);
        }

        const parent = this.orbitLine.parent;
        if (parent) {
            parent.getWorldQuaternion(_inverseParentRotation).invert();
            target.applyQuaternion(_inverseParentRotation);
        }

        return target.multiplyScalar(this.barycentreShare);
    }

    #placeLine() {
        this.orbitLine.position.addVectors(this.pathOrigin, this.barycentreOffset);

        if (this.companionLine) {
            this.companionLine.position.copy(this.barycentreOffset);
        }
    }

    show() {
        this.isVisible = true;
        this.#applyVisibility();
    }

    hide() {
        this.isVisible = false;
        this.#applyVisibility();
    }

    #applyVisibility() {
        const visible = this.isVisible && this.pathIsClosed;

        if (this.orbitLine) this.orbitLine.visible = visible;

        if (this.companionLine) this.companionLine.visible = visible;
    }

    getVisibility() {
        return this.isVisible && this.orbitLine?.visible;
    }

    #updateOrbitCenter() {
        if (this.referenceBody) {
            this.orbitCenter.copy(this.referenceBody.group.position);
        } else {
            this.orbitCenter.set(0, 0, 0);
        }
    }

    #calculateLODSegments(cameraPosition) {
        this.#updateOrbitCenter();

        const distance = cameraPosition.distanceTo(this.orbitCenter);

        const camera = SceneManager.camera;
        const viewportHeight = SceneManager.renderer.domElement.height || window.innerHeight;
        const pixelsPerRadian = viewportHeight / (camera.fov * MATH.PI_OVER_180);

        const angularRadius = Math.atan2(this.drawnSemiMajorAxis, Math.max(distance, 1e-6));
        const pixelRadius = angularRadius * pixelsPerRadian;
        const outlinePixels = MATH.TWO_PI * pixelRadius;

        const segments = Math.round(outlinePixels / ORBIT.LOD.TARGET_SEGMENT_PIXELS);

        return Math.max(ORBIT.LOD.MIN_SEGMENTS, Math.min(ORBIT.LOD.MAX_SEGMENTS, segments));
    }

    updateLOD(cameraPosition) {
        let needsRebuild = false;

        if (this.parentBody) {
            const referenceBody = this.#selectReferenceBody();
            if (referenceBody !== this.referenceBody) {
                this.#setReferenceBody(referenceBody);
                needsRebuild = true;
            }
        }

        this.#updateCentralBody();

        const bodyPosition = this.#bodyPositionInLineSpace(_bodyLocalPosition);

        this.lastLODUpdate++;
        if (this.lastLODUpdate % Math.round(1 / ORBIT.LOD.UPDATE_FREQUENCY) === 0) {
            const newSegments = this.#calculateLODSegments(cameraPosition);

            const segmentDifference = Math.abs(newSegments - this.currentSegments);
            const thresholdChange = Math.max(8, this.currentSegments * ORBIT.LOD.REBUILD_RATIO);

            if (segmentDifference >= thresholdChange) {
                this.currentSegments = newSegments;
                needsRebuild = true;
            }

            if (this.#updateCompanionLine(this.orbitLine.parent || SceneManager.scene)) {
                needsRebuild = true;
            }
        }

        if (!needsRebuild) {
            const maxDrift = this.#maxAnchorDrift(cameraPosition);
            if (bodyPosition.distanceTo(this.pathOrigin) > maxDrift
                || this.#shapeDrift(bodyPosition) > maxDrift) {
                needsRebuild = true;
            }
        }

        if (needsRebuild) {
            this.#buildPath(this.currentSegments, bodyPosition);
            this.#writeSegments();
        }

        this.#placeLine();
    }

    dispose() {
        SceneManager.unregisterOrbit(this);

        this.#disposeCompanionLine();

        if (this.orbitLine && this.orbitLine.parent) {
            this.orbitLine.parent.remove(this.orbitLine);
        }

        if (this.orbitLine) {
            if (this.orbitLine.geometry) {
                this.orbitLine.geometry.dispose();
            }
            if (this.orbitLine.material) {
                SceneManager.unregisterLineMaterial(this.orbitLine.material);
                this.orbitLine.material.dispose();
            }
        }

        this.orbitLine = null;
        this.body = null;
    }
}

export default Orbit;
