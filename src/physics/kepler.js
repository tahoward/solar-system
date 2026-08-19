import * as THREE from 'three';
import { ORBIT, MATH } from '../constants.js';
import { log } from '../utils/Logger.js';

let auScale = null;
const DEFAULT_SCENE_SCALE = 0.1;
const PI_OVER_180 = MATH.PI_OVER_180;

const _scratchPosition = new THREE.Vector3();
const _scratchVelocity = new THREE.Vector3();
const _zeroVector = new THREE.Vector3(0, 0, 0);
const _scratchTransformOptions = { applyTilt: false, axialTilt: 0, tiltMatrix: null };
const _scratchParent = { position: null, velocity: null };
const GM = 4 * Math.PI ** 2;

export function calculateGM(parentBody, companionMass = 0) {
    const centralMass = parentBody && parentBody.mass ? parentBody.mass : 1;

    return GM * (centralMass + companionMass);
}

export function calculateOrbitalMotion(semiMajorAxis, parentBody, companionMass = 0) {
    const centralBodyGM = calculateGM(parentBody, companionMass);
    const meanMotion = Math.sqrt(centralBodyGM / Math.pow(semiMajorAxis, 3));
    const orbitalPeriod = MATH.TWO_PI / meanMotion;

    return { meanMotion, orbitalPeriod };
}

export function solveKeplerEquation(meanAnomaly, eccentricity) {
    let eccentricAnomaly = meanAnomaly;

    for (let i = 0; i < ORBIT.KEPLER_EQUATION_ITERATIONS; i++) {
        const residual = eccentricAnomaly - eccentricity * Math.sin(eccentricAnomaly) - meanAnomaly;
        const derivative = 1 - eccentricity * Math.cos(eccentricAnomaly);
        const step = residual / derivative;

        eccentricAnomaly -= step;

        if (Math.abs(step) < ORBIT.KEPLER_EQUATION_TOLERANCE) break;
    }

    return eccentricAnomaly;
}

function calculateKeplerianPosition(t, orbitalElements, target) {
    const {
        semiMajorAxis,
        eccentricity,
        inclinationRadians,
        longitudeOfAscendingNodeRadians,
        argumentOfPeriapsisRadians,
        meanAnomalyAtEpochRadians,
        meanMotion
    } = orbitalElements;

    const meanAnomaly = meanAnomalyAtEpochRadians + meanMotion * t;
    const eccentricAnomaly = solveKeplerEquation(meanAnomaly, eccentricity);

    const tanNuOver2 = Math.sqrt((1 + eccentricity) / (1 - eccentricity)) * Math.tan(eccentricAnomaly / MATH.TWO);
    const trueAnomaly = MATH.TWO * Math.atan(tanNuOver2);

    const r_AU = semiMajorAxis * (1 - eccentricity * Math.cos(eccentricAnomaly));
    const r = r_AU * getAUScale();

    const xOrb = r * Math.cos(trueAnomaly);
    const yOrb = r * Math.sin(trueAnomaly);

    const cosOmega = Math.cos(longitudeOfAscendingNodeRadians);
    const sinOmega = Math.sin(longitudeOfAscendingNodeRadians);
    const cosInc = Math.cos(inclinationRadians);
    const sinInc = Math.sin(inclinationRadians);
    const cosW = Math.cos(argumentOfPeriapsisRadians);
    const sinW = Math.sin(argumentOfPeriapsisRadians);

    const x = (cosOmega * cosW - sinOmega * sinW * cosInc) * xOrb +
             (-cosOmega * sinW - sinOmega * cosW * cosInc) * yOrb;
    const y = (sinOmega * cosW + cosOmega * sinW * cosInc) * xOrb +
             (-sinOmega * sinW + cosOmega * cosW * cosInc) * yOrb;
    const z = (sinW * sinInc) * xOrb + (cosW * sinInc) * yOrb;

    return target ? target.set(x, z, -y) : new THREE.Vector3(x, z, -y);
}

export function computePerifocalBasis(orbitalElements, periapsisAxis, inPlaneAxis) {
    const {
        inclinationRadians,
        longitudeOfAscendingNodeRadians,
        argumentOfPeriapsisRadians
    } = orbitalElements;

    const cosOmega = Math.cos(longitudeOfAscendingNodeRadians);
    const sinOmega = Math.sin(longitudeOfAscendingNodeRadians);
    const cosInc = Math.cos(inclinationRadians);
    const sinInc = Math.sin(inclinationRadians);
    const cosW = Math.cos(argumentOfPeriapsisRadians);
    const sinW = Math.sin(argumentOfPeriapsisRadians);

    periapsisAxis.set(
        cosOmega * cosW - sinOmega * sinW * cosInc,
        sinW * sinInc,
        -(sinOmega * cosW + cosOmega * sinW * cosInc)
    );
    inPlaneAxis.set(
        -cosOmega * sinW - sinOmega * cosW * cosInc,
        cosW * sinInc,
        -(-sinOmega * sinW + cosOmega * cosW * cosInc)
    );
}

export function getAUScale(sceneScale) {
    if (sceneScale !== undefined) {
        auScale = ORBIT.AU_SCALE_METERS * sceneScale;
    } else if (auScale === null) {
        auScale = ORBIT.AU_SCALE_METERS * DEFAULT_SCENE_SCALE;
    }
    return auScale;
}

function calculateKeplerianVelocity(t, orbitalElements, mu = 39.478, target) {
    const {
        semiMajorAxis,
        eccentricity,
        inclinationRadians,
        longitudeOfAscendingNodeRadians,
        argumentOfPeriapsisRadians,
        meanAnomalyAtEpochRadians,
        meanMotion
    } = orbitalElements;

    const meanAnomaly = meanAnomalyAtEpochRadians + meanMotion * t;
    const eccentricAnomaly = solveKeplerEquation(meanAnomaly, eccentricity);
    const tanNuOver2 = Math.sqrt((1 + eccentricity) / (1 - eccentricity)) * Math.tan(eccentricAnomaly / MATH.TWO);
    const trueAnomaly = MATH.TWO * Math.atan(tanNuOver2);

    const auScale = getAUScale();
    const scaledA = semiMajorAxis * auScale;

    const semiLatusRectum = scaledA * (1 - eccentricity * eccentricity);
    const velocityScale = Math.sqrt(mu / semiLatusRectum);
    const vxOrb = -velocityScale * Math.sin(trueAnomaly);
    const vyOrb = velocityScale * (eccentricity + Math.cos(trueAnomaly));

    const cosOmega = Math.cos(longitudeOfAscendingNodeRadians);
    const sinOmega = Math.sin(longitudeOfAscendingNodeRadians);
    const cosInc = Math.cos(inclinationRadians);
    const sinInc = Math.sin(inclinationRadians);
    const cosW = Math.cos(argumentOfPeriapsisRadians);
    const sinW = Math.sin(argumentOfPeriapsisRadians);

    const vxAstro = (cosOmega * cosW - sinOmega * sinW * cosInc) * vxOrb +
                   (-cosOmega * sinW - sinOmega * cosW * cosInc) * vyOrb;
    const vyAstro = (sinOmega * cosW + cosOmega * sinW * cosInc) * vxOrb +
                   (-sinOmega * sinW + cosOmega * cosW * cosInc) * vyOrb;
    const vzAstro = (sinW * sinInc) * vxOrb + (cosW * sinInc) * vyOrb;

    const finalVx = vxAstro;
    const finalVy = vzAstro;
    const finalVz = -vyAstro;

    return target ? target.set(finalVx, finalVy, finalVz) : new THREE.Vector3(finalVx, finalVy, finalVz);
}

export function calculateKeplerianPositionWithTransforms(t, orbitalElements, parentBody = null, options = {}, target) {
    const finalPosition = calculateKeplerianPosition(t, orbitalElements, target);

    if (options.applyTilt && options.axialTilt !== undefined && options.axialTilt !== 0) {
        if (options.tiltMatrix) {
            finalPosition.applyMatrix4(options.tiltMatrix);
        } else {
            const tiltMatrix = new THREE.Matrix4();
            tiltMatrix.makeRotationZ(options.axialTilt * Math.PI / 180);
            finalPosition.applyMatrix4(tiltMatrix);
        }
    }

    if (parentBody && parentBody.position) {
        finalPosition.add(parentBody.position);
    }

    return finalPosition;
}

export function calculateKeplerianVelocityWithTransforms(t, orbitalElements, mu, parentBody = null, options = {}, target) {
    const finalVelocity = calculateKeplerianVelocity(t, orbitalElements, mu, target);

    if (options.applyTilt && options.axialTilt !== undefined && options.axialTilt !== 0) {
        if (options.tiltMatrix) {
            finalVelocity.applyMatrix4(options.tiltMatrix);
        } else {
            const tiltMatrix = new THREE.Matrix4();
            tiltMatrix.makeRotationZ(options.axialTilt * Math.PI / 180);
            finalVelocity.applyMatrix4(tiltMatrix);
        }
    }

    if (parentBody && parentBody.velocity) {
        finalVelocity.add(parentBody.velocity);
    }

    return finalVelocity;
}

export function updateHierarchyPositions(hierarchy, timestamp, sceneScale = DEFAULT_SCENE_SCALE) {
    auScale = ORBIT.AU_SCALE_METERS * sceneScale;

    if (hierarchy.body) {
        hierarchy.body.updatePosition(_zeroVector);
        if (hierarchy.body.velocity) hierarchy.body.velocity.set(0, 0, 0);
    }

    if (hierarchy.children) {
        updateChildrenPositions(hierarchy, hierarchy.body, timestamp);
    }
}

function updateChildrenPositions(parent, parentBody, timestamp) {
    if (!parent.children) return;

    for (let i = 0; i < parent.children.length; i++) {
        const child = parent.children[i];
        if (!child.body || !child.orbit) continue;

        try {
            const orbit = child.orbit;
            const orbitalElements = orbit.elements;

            const mu = calculateGM(parentBody, child.body.mass);

            _scratchTransformOptions.applyTilt = !!(parentBody && parentBody.tiltContainer && child.body.equatorialOrbit);
            _scratchTransformOptions.axialTilt = parentBody?.axialTilt || 0;
            _scratchTransformOptions.tiltMatrix = orbit.tiltMatrix || null;

            let parentForTransform = null;
            if (parentBody) {
                _scratchParent.position = parentBody.group.position;
                _scratchParent.velocity = parentBody.velocity || _zeroVector;
                parentForTransform = _scratchParent;
            }

            const finalPosition = calculateKeplerianPositionWithTransforms(
                timestamp, orbitalElements, parentForTransform, _scratchTransformOptions, _scratchPosition);
            const finalVelocity = calculateKeplerianVelocityWithTransforms(
                timestamp, orbitalElements, mu, parentForTransform, _scratchTransformOptions, _scratchVelocity);

            child.body.updatePosition(finalPosition);
            child.body.velocity.copy(finalVelocity);

            if (child.body.updateOrbitTrail) {
                child.body.updateOrbitTrail();
            }

            updateChildrenPositions(child, child.body, timestamp);

        } catch (error) {
            log.error('Kepler', `Error updating position for ${child.body?.name || 'unknown'}`, error);
        }
    }
}