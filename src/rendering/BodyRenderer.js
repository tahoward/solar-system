import * as THREE from 'three';
import { GEOMETRY } from '../constants.js';
import SceneManager from '../managers/SceneManager.js';
import AtmosphereShaderMaterial from '../shaders/AtmosphereShaderMaterial.js';
import CloudShaderMaterial from '../shaders/CloudShaderMaterial.js';
import RingShaderMaterial from '../shaders/RingShaderMaterial.js';
import logger, { log } from '../utils/Logger.js';

// Scratch vector reused when reading the drawing buffer size while choosing detail tiers
const _bufferSize = new THREE.Vector2();

/**
 * Segments needed to keep a sphere's silhouette within SPHERE_DETAIL_MAX_ERROR_PIXELS of a true
 * circle. A sphere drawn with W segments cuts the corner by radius * (1 - cos(π / W)) at each
 * edge, which over the range of counts in play is radius * π² / (2W²) - so the count that hides
 * the facets grows with the square root of the on-screen radius. A planet 350px across needs
 * only 60 segments by this measure; 128 pays off solely when one fills the viewport.
 *
 * @param {number} screenRadius - The body's radius in pixels on screen
 * @returns {number} Segment count required, before being rounded up to a tier
 */
function segmentsForScreenRadius(screenRadius) {
    return Math.PI * Math.sqrt(screenRadius / (2 * GEOMETRY.SPHERE_DETAIL_MAX_ERROR_PIXELS));
}

/**
 * Pick the detail tier to draw at, holding onto the one already in use while it remains a
 * reasonable fit so that geometry is not rebuilt on every small camera movement.
 *
 * @param {number} needed - Segment count the body's on-screen size calls for
 * @param {number} current - Tier currently in use, or 0 if none has been chosen yet
 * @returns {number} Segment count to draw at
 */
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

/**
 * Point a sphere mesh at the geometry for a given detail tier, building that tier the first time
 * it is asked for. Tiers are cached on the mesh rather than shared, because every body has its
 * own radius - and building them on demand means a body only pays for the resolutions it has
 * actually been viewed at, instead of holding the finest one in memory from startup.
 *
 * @param {THREE.Mesh} mesh - The sphere mesh to adjust, carrying its radius in userData
 * @param {number} segments - The tier to draw at
 */
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

/**
 * BodyRenderer - Handles all rendering concerns for celestial bodies
 * Extracted from Body.js to separate rendering logic from body logic
 */
class BodyRenderer {
    /**
     * Create sphere geometry for the celestial body. This starts at a middling detail tier and
     * is replaced on the first frame by whichever tier suits how large the body actually looks
     * - see updateDetail.
     *
     * @param {number} radius - The body radius
     * @returns {THREE.SphereGeometry} The created sphere geometry
     */
    static createGeometry(radius) {
        const segments = GEOMETRY.SPHERE_DETAIL_INITIAL_SEGMENTS;
        return new THREE.SphereGeometry(radius, segments, segments);
    }

    /**
     * Set a sphere mesh up to have its detail managed, recording the radius its geometry has to be
     * rebuilt at and seeding the tier cache with the geometry it was built with.
     *
     * @param {THREE.Mesh} mesh - The sphere mesh, holding geometry from createGeometry
     * @param {number} radius - The radius its geometry is built at
     */
    static registerDetailMesh(mesh, radius) {
        const segments = GEOMETRY.SPHERE_DETAIL_INITIAL_SEGMENTS;
        mesh.userData.detailRadius = radius;
        mesh.userData.detailSegments = segments;
        mesh.userData.detailGeometries = new Map([[segments, mesh.geometry]]);
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
     * Create the pinpoint that keeps a body visible once it is too far away to cover a pixel.
     *
     * This used to be one level of a THREE.LOD whose other level was a clone of the body mesh at
     * full detail, with the switch set at 0.01 scene units. Nothing in the system is ever within
     * 0.01 units of the camera, so the clone was never shown and the LOD never saved anything -
     * meanwhile the real mesh, sitting outside the LOD, was drawn at full detail at every
     * distance. Detail is now handled by updateDetail on the mesh itself, and the pinpoint is
     * simply always drawn, which is what the LOD amounted to in practice.
     *
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
        const cloudGeometry = BodyRenderer.createGeometry(cloudRadius);

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
        BodyRenderer.registerDetailMesh(cloudMesh, cloudRadius);

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
        const atmosphereGeometry = BodyRenderer.createGeometry(atmosphereRadius);

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
        BodyRenderer.registerDetailMesh(atmosphereMesh, atmosphereRadius);

        // Store reference to shader material for updates
        atmosphereMesh.userData.shaderMaterial = atmosphereMaterial;

        return atmosphereMesh;
    }

    /**
     * Choose the detail every sphere of a body is drawn at from how large it appears on screen.
     *
     * The body, its clouds and its atmosphere all sit at practically the same distance and differ
     * in radius by a percent or two, so one requirement covers all three - each rebuilt at its own
     * radius so the shells keep their spacing.
     *
     * @param {Object} body - The body instance
     * @param {THREE.Camera} camera - The camera the body is being viewed from
     */
    static updateDetail(body, camera) {
        if (!body?.mesh || !camera) return;

        // Body groups are added straight to the scene, so their position is already world space
        const distance = body.group.position.distanceTo(camera.position);
        if (!(distance > 0)) return;

        // Pixels a unit at one unit's distance covers - the vertical field of view mapped onto
        // the drawing buffer. Read from the renderer so a HiDPI canvas is accounted for.
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

    /**
     * Release every detail tier a mesh has built. Only the tier currently in use is reachable
     * through mesh.geometry, so the cache has to be disposed of explicitly.
     *
     * @param {THREE.Mesh} mesh - The sphere mesh whose tiers should be released
     */
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