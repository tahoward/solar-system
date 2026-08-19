import * as THREE from 'three';
import { GEOMETRY } from '../constants.js';
import SceneManager from '../managers/SceneManager.js';
import AtmosphereShaderMaterial from '../shaders/AtmosphereShaderMaterial.js';
import CloudShaderMaterial from '../shaders/CloudShaderMaterial.js';
import RingShaderMaterial from '../shaders/RingShaderMaterial.js';
import { log } from '../utils/Logger.js';

const _bufferSize = new THREE.Vector2();

function segmentsForScreenRadius(screenRadius) {
    return Math.PI * Math.sqrt(screenRadius / (2 * GEOMETRY.SPHERE_DETAIL_MAX_ERROR_PIXELS));
}

function selectDetailTier(needed, current) {
    const tiers = GEOMETRY.SPHERE_DETAIL_TIERS;

    if (current && needed <= current && needed > current * GEOMETRY.SPHERE_DETAIL_HYSTERESIS) {
        return current;
    }

    for (const tier of tiers) {
        if (tier >= needed) return tier;
    }

    return tiers[tiers.length - 1];
}

function applyDetailTier(mesh, segments) {
    if (!mesh || mesh.userData.detailSegments === segments) return;

    let cache = mesh.userData.detailGeometries;
    if (!cache) {
        cache = mesh.userData.detailGeometries = new Map();
    }

    let geometry = cache.get(segments);
    if (!geometry) {
        geometry = new THREE.SphereGeometry(mesh.userData.detailRadius, segments, segments);
        cache.set(segments, geometry);
    }

    mesh.geometry = geometry;
    mesh.userData.detailSegments = segments;
}

class BodyRenderer {
    static createGeometry(radius) {
        const segments = GEOMETRY.SPHERE_DETAIL_INITIAL_SEGMENTS;
        return new THREE.SphereGeometry(radius, segments, segments);
    }

    static registerDetailMesh(mesh, radius) {
        const segments = GEOMETRY.SPHERE_DETAIL_INITIAL_SEGMENTS;
        mesh.userData.detailRadius = radius;
        mesh.userData.detailSegments = segments;
        mesh.userData.detailGeometries = new Map([[segments, mesh.geometry]]);
    }

    static createMesh(geometry, material) {
        return new THREE.Mesh(geometry, material);
    }

    static createGroup(bodyInstance) {
        const bodyContainer = new THREE.Group();
        bodyContainer.bodyInstance = bodyInstance;
        return bodyContainer;
    }

    static createPinpointLight(material, name) {
        const pointGeometry = new THREE.BufferGeometry();
        const position = new Float32Array([0, 0, 0]);
        pointGeometry.setAttribute('position', new THREE.BufferAttribute(position, 3));

        const baseColor = material.color || new THREE.Color(0xffffff);
        const pointMaterial = new THREE.PointsMaterial({
            color: baseColor,
            size: 1.0,
            transparent: true,
            opacity: 1.0,
            sizeAttenuation: false,
            toneMapped: false,
            fog: false
        });

        const pinpointMesh = new THREE.Points(pointGeometry, pointMaterial);
        pinpointMesh.name = `${name}_pinpoint`;

        return pinpointMesh;
    }

    static createRings(ringConfig, bodyRadius, preloadedTextures, bodyName) {
        const { innerRadius, outerRadius, opacity } = ringConfig;

        const ringGeometry = BodyRenderer.createRadialRingGeometry(
            bodyRadius * innerRadius,
            bodyRadius * outerRadius,
            64
        );

        let ringTexture = null;
        if (ringConfig.texture) {
            if (preloadedTextures && preloadedTextures.has(ringConfig.texture)) {
                ringTexture = preloadedTextures.get(ringConfig.texture);
                log.debug('BodyRenderer', `Using preloaded ring texture for ${bodyName}`);
            } else {
                log.warn('BodyRenderer', `Preloaded ring texture not found for ${ringConfig.texture}, loading directly...`);
                const textureLoader = new THREE.TextureLoader();
                ringTexture = textureLoader.load(ringConfig.texture);

                ringTexture.wrapS = THREE.ClampToEdgeWrapping;
                ringTexture.wrapT = THREE.RepeatWrapping;
                ringTexture.generateMipmaps = true;
                ringTexture.minFilter = THREE.LinearMipmapLinearFilter;
                ringTexture.magFilter = THREE.LinearFilter;
            }
        }

        const ringMaterial = new RingShaderMaterial({
            ringTexture: ringTexture,
            opacity: opacity,
            planetRadius: bodyRadius,
            hasPlanetShadow: true
        });

        const ringGroup = new THREE.Group();

        const topRingMesh = new THREE.Mesh(ringGeometry, ringMaterial);
        topRingMesh.rotation.x = Math.PI / 2;
        topRingMesh.receiveShadow = true;
        ringGroup.add(topRingMesh);

        const bottomRingMesh = new THREE.Mesh(ringGeometry, ringMaterial);
        bottomRingMesh.rotation.x = -Math.PI / 2;
        bottomRingMesh.receiveShadow = true;
        ringGroup.add(bottomRingMesh);

        return ringGroup;
    }

    static createRadialRingGeometry(innerRadius, outerRadius, thetaSegments = 64) {
        const geometry = new THREE.BufferGeometry();
        const vertices = [];
        const indices = [];
        const uvs = [];

        for (let i = 0; i <= thetaSegments; i++) {
            const theta = (i / thetaSegments) * Math.PI * 2;
            const cosTheta = Math.cos(theta);
            const sinTheta = Math.sin(theta);

            const innerX = innerRadius * cosTheta;
            const innerY = innerRadius * sinTheta;
            vertices.push(innerX, innerY, 0);
            uvs.push(1, i / thetaSegments);

            const outerX = outerRadius * cosTheta;
            const outerY = outerRadius * sinTheta;
            vertices.push(outerX, outerY, 0);
            uvs.push(0, i / thetaSegments);
        }

        for (let i = 0; i < thetaSegments; i++) {
            const innerCurrent = i * 2;
            const outerCurrent = i * 2 + 1;
            const innerNext = (i + 1) * 2;
            const outerNext = (i + 1) * 2 + 1;

            indices.push(innerCurrent, outerCurrent, innerNext);
            indices.push(innerNext, outerCurrent, outerNext);
        }

        geometry.setIndex(indices);
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
        geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));

        const normals = [];
        for (let i = 0; i < vertices.length / 3; i++) {
            normals.push(0, 0, 1);
        }
        geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));

        return geometry;
    }

    static createClouds(cloudConfig, bodyRadius, bodyName) {
        const { texture, radiusScale, opacity, rotationSpeed, alphaTest } = cloudConfig;

        const cloudRadius = bodyRadius * radiusScale;
        const cloudGeometry = BodyRenderer.createGeometry(cloudRadius);

        const textureLoader = new THREE.TextureLoader();
        const cloudTexture = textureLoader.load(texture);

        cloudTexture.wrapS = THREE.RepeatWrapping;
        cloudTexture.wrapT = THREE.RepeatWrapping;
        cloudTexture.generateMipmaps = true;
        cloudTexture.minFilter = THREE.LinearMipmapLinearFilter;
        cloudTexture.magFilter = THREE.LinearFilter;

        const cloudMaterial = new CloudShaderMaterial({
            cloudTexture: cloudTexture,
            opacity: opacity || 0.8,
            alphaTest: alphaTest || 0.1,
            lightColor: 0xffffff
        });

        const cloudMesh = new THREE.Mesh(cloudGeometry, cloudMaterial);
        BodyRenderer.registerDetailMesh(cloudMesh, cloudRadius);

        cloudMesh.userData.rotationSpeed = rotationSpeed || 1.0;
        cloudMesh.userData.shaderMaterial = cloudMaterial;

        log.debug('BodyRenderer', `Created cloud system with planet shader for ${bodyName} (radius: ${cloudRadius.toFixed(3)}, opacity: ${opacity})`);

        return cloudMesh;
    }

    static createAtmosphere(atmosphereConfig, bodyRadius) {
        const {
            color, radiusScale,
            verticalOpticalDepth, scaleHeight, scatteringPower, mieStrength, mieDirection
        } = atmosphereConfig;

        const atmosphereRadius = bodyRadius * radiusScale;
        const atmosphereGeometry = BodyRenderer.createGeometry(atmosphereRadius);

        const atmosphereMaterial = new AtmosphereShaderMaterial({
            atmosphereColor: color || 0x87CEEB,

            planetRadiusRatio: 1 / radiusScale,

            verticalOpticalDepth,
            scaleHeight,
            scatteringPower,
            mieStrength,
            mieDirection
        });

        const atmosphereMesh = new THREE.Mesh(atmosphereGeometry, atmosphereMaterial);
        BodyRenderer.registerDetailMesh(atmosphereMesh, atmosphereRadius);

        atmosphereMesh.userData.shaderMaterial = atmosphereMaterial;

        return atmosphereMesh;
    }

    static updateDetail(body, camera) {
        if (!body?.mesh || !camera) return;

        const distance = body.group.position.distanceTo(camera.position);
        if (!(distance > 0)) return;

        const viewportHeight = SceneManager.renderer.getDrawingBufferSize(_bufferSize).y;
        const pixelsPerUnit = viewportHeight / (2 * Math.tan(camera.fov * Math.PI / 360));

        const screenRadius = (body.radius / distance) * pixelsPerUnit;
        const needed = segmentsForScreenRadius(screenRadius);

        applyDetailTier(body.mesh, selectDetailTier(needed, body.mesh.userData.detailSegments));
        if (body.clouds) {
            applyDetailTier(body.clouds, selectDetailTier(needed, body.clouds.userData.detailSegments));
        }
        if (body.atmosphere) {
            applyDetailTier(body.atmosphere, selectDetailTier(needed, body.atmosphere.userData.detailSegments));
        }
    }

    static disposeDetailGeometries(mesh) {
        const cache = mesh?.userData?.detailGeometries;
        if (!cache) return;

        cache.forEach(geometry => geometry.dispose());
        cache.clear();
        mesh.userData.detailGeometries = null;
        mesh.userData.detailSegments = 0;
    }
}

export default BodyRenderer;