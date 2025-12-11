import * as THREE from 'three';
import { GEOMETRY } from '../constants.js';
import AtmosphereShaderMaterial from '../shaders/AtmosphereShaderMaterial.js';
import CloudShaderMaterial from '../shaders/CloudShaderMaterial.js';
import RingShaderMaterial from '../shaders/RingShaderMaterial.js';
import logger, { log } from '../utils/Logger.js';

/**
 * BodyRenderer - Handles all rendering concerns for celestial bodies
 * Extracted from Body.js to separate rendering logic from body logic
 */
class BodyRenderer {
    /**
     * Create sphere geometry for the celestial body
     * @param {number} radius - The body radius
     * @returns {THREE.SphereGeometry} The created sphere geometry with configured segments
     */
    static createGeometry(radius) {
        return new THREE.SphereGeometry(radius, GEOMETRY.SPHERE_WIDTH_SEGMENTS, GEOMETRY.SPHERE_HEIGHT_SEGMENTS);
    }

    /**
     * Create mesh using the material and geometry
     * @param {THREE.SphereGeometry} geometry - The sphere geometry
     * @param {THREE.Material} material - The material to use
     * @returns {THREE.Mesh} The created mesh combining geometry and material
     */
    static createMesh(geometry, material) {
        return new THREE.Mesh(geometry, material);
    }

    /**
     * Create group structure for the body
     * @param {Object} bodyInstance - Reference to the body instance
     * @returns {THREE.Group} The created group
     */
    static createGroup(bodyInstance) {
        const bodyContainer = new THREE.Group();
        // Store reference back to the Body instance for accessing properties like radiusScale
        bodyContainer.bodyInstance = bodyInstance;
        return bodyContainer;
    }

    /**
     * Create LOD (Level of Detail) system with pinpoint light for distant viewing
     * @param {THREE.Mesh} mesh - The main mesh to use for LOD
     * @param {number} rotationOffset - Initial rotation offset to apply
     * @param {THREE.Material} material - Material for pinpoint light color extraction
     * @param {string} name - Name for the pinpoint mesh
     * @returns {Object} LOD system object with lod, lodMesh, and pinpointMesh
     */
    static createLODSystem(mesh, rotationOffset, material, name) {
        // Create LOD object
        const lod = new THREE.LOD();

        // Create pinpoint light first (default/far view)
        const pinpointMesh = BodyRenderer.createPinpointLight(material, name);

        // Create a separate mesh for LOD system (to avoid hierarchy conflicts)
        const lodMesh = mesh.clone();
        lodMesh.material = mesh.material; // Share the same material
        lodMesh.geometry = mesh.geometry; // Share the same geometry

        // Add levels in order: closest distance first, farthest last
        // High detail: full planet mesh (very close range - within 0.01 units)
        lod.addLevel(lodMesh, 0);

        // Low detail: pinpoint light (everything beyond 0.01 units)
        lod.addLevel(pinpointMesh, 0.01);

        // Apply initial rotation offset to LOD mesh to match main mesh
        if (rotationOffset !== 0) {
            lodMesh.rotation.y = rotationOffset;
        }

        return {
            lod: lod,
            lodMesh: lodMesh,
            pinpointMesh: pinpointMesh,
            lodNearDistance: 0.01,   // Full detail when closer than this
            lodFarDistance: 0.01     // Pinpoint when farther than this
        };
    }

    /**
     * Create a pinpoint light representation for distant viewing
     * @param {THREE.Material} material - Material to extract color from
     * @param {string} name - Name for the pinpoint mesh
     * @returns {THREE.Points} Pinpoint mesh for distant viewing
     */
    static createPinpointLight(material, name) {
        // Create a point sprite - perfect for star-like appearance
        const pointGeometry = new THREE.BufferGeometry();
        const position = new Float32Array([0, 0, 0]); // Single point at origin
        pointGeometry.setAttribute('position', new THREE.BufferAttribute(position, 3));

        // Create bright point sprite material
        const baseColor = material.color || new THREE.Color(0xffffff);
        const pointMaterial = new THREE.PointsMaterial({
            color: baseColor,
            size: 1.0,  // Size in pixels - exactly 1 pixel
            transparent: true,
            opacity: 1.0,
            sizeAttenuation: false,  // Size stays constant regardless of distance
            toneMapped: false,
            fog: false
        });

        const pinpointMesh = new THREE.Points(pointGeometry, pointMaterial);
        pinpointMesh.name = `${name}_pinpoint`;

        return pinpointMesh;
    }

    /**
     * Create ring system for the celestial body (e.g., Saturn's rings)
     * @param {Object} ringConfig - Ring configuration
     * @param {number} bodyRadius - The body radius for scaling
     * @param {Map} preloadedTextures - Map of preloaded textures
     * @param {string} bodyName - Name for logging
     * @returns {THREE.Group} The ring group containing both sides
     */
    static createRings(ringConfig, bodyRadius, preloadedTextures, bodyName) {
        const { innerRadius, outerRadius, opacity } = ringConfig;

        // Create custom ring geometry with radial UV mapping
        const ringGeometry = BodyRenderer.createRadialRingGeometry(
            bodyRadius * innerRadius,
            bodyRadius * outerRadius,
            64 // theta segments for smooth rings
        );

        // Load ring texture if specified in config
        let ringTexture = null;
        if (ringConfig.texture) {
            // Try to get preloaded texture first
            if (preloadedTextures && preloadedTextures.has(ringConfig.texture)) {
                ringTexture = preloadedTextures.get(ringConfig.texture);
                log.debug('BodyRenderer', `Using preloaded ring texture for ${bodyName}`);
            } else {
                // Fallback to loading texture (for compatibility)
                log.warn('BodyRenderer', `Preloaded ring texture not found for ${ringConfig.texture}, loading directly...`);
                const textureLoader = new THREE.TextureLoader();
                ringTexture = textureLoader.load(ringConfig.texture);

                // Configure texture for ring appearance
                ringTexture.wrapS = THREE.ClampToEdgeWrapping; // Don't repeat in U direction
                ringTexture.wrapT = THREE.RepeatWrapping; // Repeat around the ring
                ringTexture.generateMipmaps = true;
                ringTexture.minFilter = THREE.LinearMipmapLinearFilter;
                ringTexture.magFilter = THREE.LinearFilter;
            }
        }

        // Use custom ring shader material with planet shadow support
        const ringMaterial = new RingShaderMaterial({
            ringTexture: ringTexture,
            opacity: opacity,
            ringColor: ringConfig.color || 0xffffff,
            planetRadius: bodyRadius,
            hasPlanetShadow: true
        });

        // Create ring group to hold both sides
        const ringGroup = new THREE.Group();

        // Create top side ring mesh
        const topRingMesh = new THREE.Mesh(ringGeometry, ringMaterial);
        topRingMesh.rotation.x = Math.PI / 2;
        topRingMesh.receiveShadow = true; // Enable shadow receiving
        ringGroup.add(topRingMesh);

        // Create bottom side ring mesh (flipped) - use same material to avoid double shadows
        const bottomRingMesh = new THREE.Mesh(ringGeometry, ringMaterial);
        bottomRingMesh.rotation.x = -Math.PI / 2; // Flip to face the other direction
        bottomRingMesh.receiveShadow = true; // Enable shadow receiving
        ringGroup.add(bottomRingMesh);

        return ringGroup;
    }

    /**
     * Create a ring geometry with proper radial UV mapping for textures
     * @param {number} innerRadius - Inner radius of the ring
     * @param {number} outerRadius - Outer radius of the ring
     * @param {number} thetaSegments - Number of segments around the ring
     * @returns {THREE.BufferGeometry} Custom ring geometry with radial UV mapping
     */
    static createRadialRingGeometry(innerRadius, outerRadius, thetaSegments = 64) {
        const geometry = new THREE.BufferGeometry();
        const vertices = [];
        const indices = [];
        const uvs = [];

        // Create vertices and UVs for radial mapping
        for (let i = 0; i <= thetaSegments; i++) {
            const theta = (i / thetaSegments) * Math.PI * 2;
            const cosTheta = Math.cos(theta);
            const sinTheta = Math.sin(theta);

            // Inner vertex
            const innerX = innerRadius * cosTheta;
            const innerY = innerRadius * sinTheta;
            vertices.push(innerX, innerY, 0);
            uvs.push(1, i / thetaSegments); // U=1 for inner edge (flipped), V wraps around

            // Outer vertex
            const outerX = outerRadius * cosTheta;
            const outerY = outerRadius * sinTheta;
            vertices.push(outerX, outerY, 0);
            uvs.push(0, i / thetaSegments); // U=0 for outer edge (flipped), V wraps around
        }

        // Create indices for triangles
        for (let i = 0; i < thetaSegments; i++) {
            const innerCurrent = i * 2;
            const outerCurrent = i * 2 + 1;
            const innerNext = (i + 1) * 2;
            const outerNext = (i + 1) * 2 + 1;

            // First triangle
            indices.push(innerCurrent, outerCurrent, innerNext);
            // Second triangle
            indices.push(innerNext, outerCurrent, outerNext);
        }

        geometry.setIndex(indices);
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
        geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));

        // Manually set normals to point upward for proper double-sided rendering
        const normals = [];
        for (let i = 0; i < vertices.length / 3; i++) {
            normals.push(0, 0, 1); // All normals point up (positive Z)
        }
        geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));

        return geometry;
    }

    /**
     * Create cloud system for the celestial body (e.g., Earth's atmosphere)
     * @param {Object} cloudConfig - Cloud configuration
     * @param {number} bodyRadius - The body radius
     * @param {string} bodyName - Name for logging
     * @returns {THREE.Mesh} The cloud mesh with advanced planet shader material
     */
    static createClouds(cloudConfig, bodyRadius, bodyName) {
        const { texture, radiusScale, opacity, rotationSpeed, alphaTest } = cloudConfig;

        // Create cloud geometry - slightly larger sphere than the planet
        const cloudRadius = bodyRadius * radiusScale;
        const cloudGeometry = new THREE.SphereGeometry(
            cloudRadius,
            GEOMETRY.SPHERE_WIDTH_SEGMENTS,
            GEOMETRY.SPHERE_HEIGHT_SEGMENTS
        );

        // Load cloud texture
        const textureLoader = new THREE.TextureLoader();
        const cloudTexture = textureLoader.load(texture);

        // Configure texture for cloud appearance
        cloudTexture.wrapS = THREE.RepeatWrapping;
        cloudTexture.wrapT = THREE.RepeatWrapping;
        cloudTexture.generateMipmaps = true;
        cloudTexture.minFilter = THREE.LinearMipmapLinearFilter;
        cloudTexture.magFilter = THREE.LinearFilter;

        // Create cloud shader material with advanced lighting and shadow support
        const cloudMaterial = new CloudShaderMaterial({
            cloudTexture: cloudTexture,
            opacity: opacity || 0.8,
            alphaTest: alphaTest || 0.1,
            lightColor: 0xffffff
        });

        // Create cloud mesh
        const cloudMesh = new THREE.Mesh(cloudGeometry, cloudMaterial);

        // Store rotation speed for animation and shader material reference
        cloudMesh.userData.rotationSpeed = rotationSpeed || 1.0;
        cloudMesh.userData.shaderMaterial = cloudMaterial;

        log.debug('BodyRenderer', `Created cloud system with planet shader for ${bodyName} (radius: ${cloudRadius.toFixed(3)}, opacity: ${opacity})`);

        return cloudMesh;
    }

    /**
     * Create atmosphere system for the celestial body (e.g., Earth's atmosphere)
     * @param {Object} atmosphereConfig - Atmosphere configuration
     * @param {number} bodyRadius - The body radius
     * @returns {THREE.Mesh} The atmosphere mesh
     */
    static createAtmosphere(atmosphereConfig, bodyRadius) {
        const { color, radiusScale, transparency, emissiveIntensity, fadeStart, fadeEnd } = atmosphereConfig;

        // Create atmosphere geometry - larger sphere than the planet
        const atmosphereRadius = bodyRadius * radiusScale;
        const atmosphereGeometry = new THREE.SphereGeometry(
            atmosphereRadius,
            GEOMETRY.SPHERE_WIDTH_SEGMENTS,
            GEOMETRY.SPHERE_HEIGHT_SEGMENTS
        );

        // Create atmosphere shader material
        const atmosphereMaterial = new AtmosphereShaderMaterial({
            atmosphereColor: color || 0x87CEEB,
            atmosphereTransparency: transparency || 0.8,
            emissiveIntensity: emissiveIntensity || 1.5,  // For bloom effect
            fadeStart: fadeStart,  // Pass fade parameters if provided
            fadeEnd: fadeEnd
        });

        // Create atmosphere mesh
        const atmosphereMesh = new THREE.Mesh(atmosphereGeometry, atmosphereMaterial);

        // Store reference to shader material for updates
        atmosphereMesh.userData.shaderMaterial = atmosphereMaterial;

        return atmosphereMesh;
    }

    /**
     * Update LOD system based on camera distance
     * @param {THREE.LOD} lod - The LOD object to update
     * @param {THREE.Camera} camera - The camera to calculate distance from
     */
    static updateLOD(lod, camera) {
        if (!lod || !camera) return;

        // Update LOD based on camera position
        lod.update(camera);
    }
}

export default BodyRenderer;