import * as THREE from 'three';
import Marker from './Marker.js';
import Orbit from './Orbit.js';
import SceneManager from '../managers/SceneManager.js';
import ConfigValidator from '../utils/ConfigValidator.js';
import logger, { log } from '../utils/Logger.js';
import { GEOMETRY } from '../constants.js';
import AtmosphereShaderMaterial from '../shaders/AtmosphereShaderMaterial.js';
import CloudShaderMaterial from '../shaders/CloudShaderMaterial.js';
import RingShaderMaterial from '../shaders/RingShaderMaterial.js';
import VectorUtils from '../utils/VectorUtils.js';
import OrbitTrail from './OrbitTrail.js';
import SunCorona from '../effects/SunCorona.js';
import SunRays from '../effects/SunRays.js';
import SunFlares from '../effects/SunFlares.js';
import SunGlare from '../effects/SunGlare.js';
import { temperatureToColor, temperatureToBlackbodyLight, temperatureToGlareBrightness } from '../constants.js';
import MaterialFactory from '../factories/MaterialFactory.js';


/**
 * @typedef {Object} BodyProperties
 * @property {string} name - The celestial body name
 * @property {number} radius - Radius in scene units
 * @property {number} mass - Mass in solar masses
 * @property {boolean} isTarget - Whether this body is currently targeted
 * @property {THREE.Mesh} mesh - The rendered mesh
 * @property {THREE.Group} group - The container group
 * @property {THREE.SphereGeometry} geometry - The sphere geometry
 * @property {THREE.Material} material - The rendering material
 * @property {THREE.PointLight|null} emittedLight - Optional emitted light
 * @property {Marker|null} marker - Optional marker for navigation
 * @property {number} rotationOffset - Fixed rotation offset in radians applied to all rotation
 */

class Body {
    // Static property to store preloaded textures
    static preloadedTextures = null;

    /**
     * Set preloaded textures for use in body creation
     * @param {Map<string, THREE.Texture>} textures - Map of preloaded textures
     */
    static setPreloadedTextures(textures) {
        this.preloadedTextures = textures;
    }

    /**
     * Creates a new celestial body from celestial body data.
     * @param {Object} bodyData - The celestial body data
     * @param {Body|null} [parentBody=null] - The parent body for radius scaling
     */
    constructor(bodyData, parentBody = null) {
        // Create light if body has light intensity specified
        const emittedLight = Body.createLightForBody(bodyData);

        // Calculate radius - for planets, scale relative to parent (Sun)
        const radius = Body.calculateBodyRadius(bodyData, parentBody);

        // Create material (pass radius for ring shadow calculations)
        const material = MaterialFactory.createBodyMaterial(bodyData, radius);

        // Extract properties from bodyData
        const name = bodyData.name;
        const marker = true; // Always add marker
        const mass = bodyData.mass;
        const rotationPeriod = bodyData.rotationPeriod;
        const axialTilt = bodyData.axialTilt;
        const rings = bodyData.rings;
        const clouds = bodyData.clouds;
        const atmosphere = bodyData.atmosphere;
        const rotationOffset = bodyData.rotationOffset || 0;
        const tidallyLocked = bodyData.tidallyLocked || false;
        // Validate configuration using centralized validator
        ConfigValidator.validateBodyConfig({ name, radius, marker });

        this.name = name;
        this.radius = radius;
        this.emittedLight = emittedLight;
        this.material = material;
        this.mass = mass;
        this.isTarget = false;
        this.thisBody = null;

        // Store ecliptic attribute from celestial data
        this.ecliptic = bodyData.ecliptic !== undefined ? bodyData.ecliptic : false;

        // Store radiusScale from bodyData for bloom and other distance-based effects
        this.radiusScale = bodyData.radiusScale || 1.0;

        // Set isStar flag based on whether this body has star data
        this.isStar = !!bodyData.star;

        // Physics properties - initialize with zero vectors
        this.position = VectorUtils.temp(0, 0, 0);
        this.velocity = VectorUtils.temp(0, 0, 0);
        this.force = VectorUtils.temp(0, 0, 0);
        this.acceleration = VectorUtils.temp(0, 0, 0);

        // Store initial conditions for reset capability
        this.initialPosition = VectorUtils.temp(0, 0, 0);
        this.initialVelocity = VectorUtils.temp(0, 0, 0);

        // Orbit trail (for physics mode)
        this.orbitTrail = null; // Will be initialized later

        // Store reference to shader material if it's a SunShaderMaterial
        this.isShaderMaterial = material && typeof material.updateTime === 'function';

        // Rotation properties (passed as parameters)
        this.rotationPeriod = rotationPeriod;
        this.axialTilt = axialTilt;
        this.rotationOffset = rotationOffset;
        this.tidallyLocked = tidallyLocked;
        this.parentBody = parentBody;
        this.rotationSpeed = this.calculateRotationSpeed(rotationPeriod);

        // Hierarchy properties for recursive creation
        this.children = [];
        this.orbit = null;
        this.bodyData = bodyData; // Store original data for reference

        // Create basic materials and geometries
        this.geometry = this.createGeometry();

        // Create mesh and group structure
        this.mesh = this.createMesh();

        // Apply initial rotation offset to the mesh
        if (this.rotationOffset !== 0) {
            this.mesh.rotation.y = this.rotationOffset;
        }

        // Create tilt container for fixed axial tilt BEFORE LOD system
        this.tiltContainer = new THREE.Group();
        if (this.axialTilt !== 0) {
            this.tiltContainer.rotation.z = this.axialTilt * Math.PI / 180;
        }

        // Add mesh to tilt container first
        this.tiltContainer.add(this.mesh);

        // Create LOD system with pinpoint light for distant viewing
        this.createLODSystem();

        // Add LOD system to tilt container so it inherits the fixed tilt
        this.tiltContainer.add(this.lod);

        // Create main group and add tilt container to it
        this.group = this.createGroup();
        this.group.add(this.tiltContainer);

        // Set marker color
        Body.setMarkerColor(this, bodyData);

        // Add marker to body
        if (marker) {
            this.marker = new Marker(this);
        }

        // Set emitted light to body position
        if (this.emittedLight) {
            this.emittedLight.position.copy(this.mesh.position)
            this.group.add(this.emittedLight);
        }

        // Create rings if specified
        this.rings = null;
        if (rings) {
            this.rings = this.createRings(rings);
            this.tiltContainer.add(this.rings); // Add to tilt container so rings rotate with axial tilt
        }

        // Create clouds if specified
        this.clouds = null;
        if (clouds) {
            this.clouds = this.createClouds(clouds);
            this.tiltContainer.add(this.clouds); // Add to tilt container so clouds rotate with axial tilt
        }

        // Create atmosphere if specified
        this.atmosphere = null;
        if (atmosphere) {
            this.atmosphere = this.createAtmosphere(atmosphere);
            this.group.add(this.atmosphere); // Add atmosphere to main group (not tilt container)
        }

        // Add advanced star effects if this is a star (before adding to scene)
        if (bodyData.star) {
            Body.addStarEffects(this, bodyData, radius);
        }

        SceneManager.scene.add(this.group);

        // Auto-register with SceneManager for star bloom effects if this is a star
        if (this.isStar) {
            SceneManager.registerStar(this.group);
            log.info('Body', `Auto-registered ${this.name} for bloom effects`);
        }

        // Create orbit for this body if it has a parent
        this.createOrbit();

        // Recursively create children bodies
        this.createChildren();

        // Initialize orbit trail (after scene setup)
        this.initializeOrbitTrail();
    }

    /**
     * Creates an orbit for this body if it has orbital parameters
     * @private
     */
    createOrbit() {
        // Only create orbit if this body has a parent and orbital parameters
        if (!this.parentBody || !this.bodyData.a) {
            // Create virtual stationary orbit for root body (Sun)
            if (!this.parentBody) {
                this.orbit = this.createVirtualOrbit();
                SceneManager.registerOrbit(this.orbit);
            }
            return;
        }

        // Create regular orbit for bodies orbiting a parent
        if (this.group) {
            this.orbit = this.createOrbitFromData();
            SceneManager.registerOrbit(this.orbit);
            log.debug('Body', `Created orbit for ${this.name}`);
        } else {
            log.warn('Body', `Skipped orbit for ${this.name} - invalid body group`);
        }
    }

    /**
     * Recursively creates all children bodies
     * @private
     */
    createChildren() {
        if (!this.bodyData.children || this.bodyData.children.length === 0) {
            log.debug('Body', `${this.name}: No children to create`);
            return;
        }

        this.bodyData.children.forEach(childData => {
            try {
                // Create child body recursively - it will handle its own children
                const childBody = new Body(childData, this);
                this.children.push({
                    body: childBody,
                    orbit: childBody.orbit,
                    children: childBody.children,
                    data: childData
                });
                log.debug('Body', `Created child ${childData.name} for ${this.name}`);
            } catch (error) {
                log.error('Body', `Failed to create child ${childData.name} for ${this.name}:`, error);
            }
        });

        log.info('Body', `${this.name}: Successfully created ${this.children.length} children`);
    }

    /**
     * Create orbit from celestial data
     * @returns {Orbit} The created orbit
     * @private
     */
    createOrbitFromData() {
        const sceneScale = SceneManager.scale;
        return new Orbit(
            this,                          // body
            this.bodyData.a,              // semiMajorAxis
            this.bodyData.e,              // eccentricity
            this.bodyData.i,              // inclination
            this.parentBody,              // parentBody for relative positioning
            this.bodyData.omega || 0,     // longitudeOfAscendingNode
            this.bodyData.w || 0,         // argumentOfPeriapsis
            this.bodyData.M0 || 0,        // meanAnomalyAtEpoch
            sceneScale                    // Scene scale factor
        );
    }

    /**
     * Create a virtual stationary orbit for the root body (Sun)
     * This allows the Sun to be treated uniformly with other bodies in the orbit system
     * @returns {Object} Virtual orbit object that keeps the body at (0,0,0)
     * @private
     */
    createVirtualOrbit() {
        return {
            body: this,
            parentBody: null,
            semiMajorAxis: 0,
            eccentricity: 0,
            orbitalPeriod: 0,
            // Virtual orbit always returns (0,0,0) position
            calculatePosition: () => new THREE.Vector3(0, 0, 0),
            // Visibility methods for compatibility with VisibilityManager
            show: () => {}, // No-op - Sun has no orbit line to show
            hide: () => {}, // No-op - Sun has no orbit line to hide
            getVisibility: () => true, // Sun is always "visible"
            // Orbit line properties for compatibility
            orbitLine: null,
            isVisible: true
        };
    }

    /**
     * Creates the sphere geometry for the celestial body.
     * @returns {THREE.SphereGeometry} The created sphere geometry with configured segments
     * @private
     */
    createGeometry() {
        return new THREE.SphereGeometry(this.radius, GEOMETRY.SPHERE_WIDTH_SEGMENTS, GEOMETRY.SPHERE_HEIGHT_SEGMENTS);
    }


    /**
     * Creates the mesh using the material and geometry.
     * @returns {THREE.Mesh} The created mesh combining geometry and material
     * @private
     */
    createMesh() {
        const mesh = new THREE.Mesh(this.geometry, this.material);
        return mesh;
    }

    /**
     * Creates the group structure for the body.
     * @returns {THREE.Group} The created group.
     */
    createGroup() {
        const bodyContainer = new THREE.Group();
        // Store reference back to the Body instance for accessing properties like radiusScale
        bodyContainer.bodyInstance = this;
        // Don't add mesh here anymore - it's handled in the tilt container hierarchy
        return bodyContainer;
    }

    /**
     * Creates LOD (Level of Detail) system with pinpoint light for distant viewing
     * @private
     */
    createLODSystem() {
        // Create LOD object
        this.lod = new THREE.LOD();

        // Create pinpoint light first (default/far view)
        this.createPinpointLight();

        // Create a separate mesh for LOD system (to avoid hierarchy conflicts)
        const lodMesh = this.mesh.clone();
        lodMesh.material = this.mesh.material; // Share the same material
        lodMesh.geometry = this.mesh.geometry; // Share the same geometry

        // Add levels in order: closest distance first, farthest last
        // High detail: full planet mesh (very close range - within 0.01 units)
        this.lod.addLevel(lodMesh, 0);

        // Low detail: pinpoint light (everything beyond 0.01 units)
        this.lod.addLevel(this.pinpointMesh, 0.01);

        // Apply initial rotation offset to LOD mesh to match main mesh
        if (this.rotationOffset !== 0) {
            lodMesh.rotation.y = this.rotationOffset;
        }

        // Store reference to LOD mesh for rotation updates
        this.lodMesh = lodMesh;

        // LOD switching distances
        this.lodNearDistance = 0.01;   // Full detail when closer than this
        this.lodFarDistance = 0.01;    // Pinpoint when farther than this

    }

    /**
     * Creates a pinpoint light representation for distant viewing
     * @private
     */
    createPinpointLight() {
        // Create a point sprite - perfect for star-like appearance
        const pointGeometry = new THREE.BufferGeometry();
        const position = new Float32Array([0, 0, 0]); // Single point at origin
        pointGeometry.setAttribute('position', new THREE.BufferAttribute(position, 3));

        // Create bright point sprite material
        const baseColor = this.material.color || new THREE.Color(0xffffff);
        const pointMaterial = new THREE.PointsMaterial({
            color: baseColor,
            size: 1.0,  // Size in pixels - exactly 1 pixel
            transparent: true,
            opacity: 1.0,
            sizeAttenuation: false,  // Size stays constant regardless of distance
            toneMapped: false,
            fog: false
        });

        this.pinpointMesh = new THREE.Points(pointGeometry, pointMaterial);
        this.pinpointMesh.name = `${this.name}_pinpoint`;

    }

    /**
     * Updates the LOD system based on camera distance
     * @param {THREE.Camera} camera - The camera to calculate distance from
     */
    updateLOD(camera) {
        if (!this.lod || !camera) return;

        // Update LOD based on camera position
        this.lod.update(camera);
    }

    /**
     * Calculate rotation speed based on rotation period
     * @param {number} rotationPeriod - Rotation period in Earth hours
     * @returns {number} Rotation speed in radians per second
     * @private
     */
    calculateRotationSpeed(rotationPeriod) {
        if (!rotationPeriod) {
            // Default rotation for unknown bodies (Earth-like)
            return (2 * Math.PI) / (23.93 * 3600); // Earth period in seconds
        }

        // Convert rotation period (hours) to rotation speed (radians per second)
        // Negative periods indicate retrograde rotation
        const direction = rotationPeriod > 0 ? 1 : -1;
        const periodHours = Math.abs(rotationPeriod);
        const periodSeconds = periodHours * 3600; // Convert hours to seconds

        // Scale down to make visible but maintain proportions
        // Using Earth as reference: Earth should complete 1 rotation in about 15 seconds at 1x speed
        const earthPeriodSeconds = 23.93 * 3600;
        const targetEarthSeconds = 15; // 15 seconds for one Earth rotation
        const scaleFactor = earthPeriodSeconds / targetEarthSeconds;

        // Calculate angular velocity: 2π radians per scaled period (in seconds)
        const scaledPeriodSeconds = periodSeconds / scaleFactor;
        const angularVelocity = (2 * Math.PI) / scaledPeriodSeconds;

        return direction * angularVelocity;
    }

    /**
     * Update body rotation (call this every frame)
     * @param {number} deltaTime - Time elapsed since last frame in seconds
     * @param {number} speedMultiplier - Current simulation speed multiplier
     */
    updateRotation(deltaTime = 1/60, speedMultiplier = 1) {
        if (this.tidallyLocked && this.parentBody) {
            // TIDAL LOCKING: Always face the parent body
            this.updateTidalLockRotation();
        } else {
            // NORMAL ROTATION: Spin based on rotation period
            // Calculate rotation increment: radians/second * seconds * speed multiplier
            const rotationIncrement = this.rotationSpeed * deltaTime * speedMultiplier;

            // Rotate main mesh (rotation offset was applied at initialization)
            if (this.mesh) {
                this.mesh.rotation.y += rotationIncrement;
            }

            // Also rotate LOD mesh to keep them synchronized
            if (this.lodMesh) {
                this.lodMesh.rotation.y += rotationIncrement;
            }
        }

        // Rotate clouds independently at their own speed (always applies)
        if (this.clouds && this.clouds.userData.rotationSpeed) {
            const cloudRotationIncrement = this.rotationSpeed * deltaTime * speedMultiplier * this.clouds.userData.rotationSpeed;
            this.clouds.rotation.y += cloudRotationIncrement;
        }
    }

    /**
     * Update rotation for this body and all its children recursively
     * This replaces the OrbitManager's iteration pattern with direct hierarchical updates
     * @param {number} deltaTime - Time elapsed since last frame in seconds
     * @param {number} speedMultiplier - Current simulation speed multiplier
     */
    updateRotationRecursive(deltaTime = 1/60, speedMultiplier = 1) {
        // Update this body's rotation
        this.updateRotation(deltaTime, speedMultiplier);

        // Recursively update rotation for all children
        if (this.children && this.children.length > 0) {
            this.children.forEach(childHierarchy => {
                const childBody = childHierarchy.body;
                if (childBody && typeof childBody.updateRotationRecursive === 'function') {
                    childBody.updateRotationRecursive(deltaTime, speedMultiplier);
                }
            });
        }
    }

    /**
     * Update rotation for tidally locked bodies to always face their parent
     * @private
     */
    updateTidalLockRotation() {
        if (!this.parentBody || !this.group || !this.parentBody.group) {
            return;
        }

        // Calculate vector from this body to its parent
        const parentDirection = new THREE.Vector3()
            .subVectors(this.parentBody.group.position, this.group.position)
            .normalize();

        // Calculate the angle needed to face the parent
        // We want the body to face the parent with its "front" (negative Z axis by default)
        const targetRotation = Math.atan2(parentDirection.x, parentDirection.z);

        // Apply the rotation to make the body face its parent, plus any rotation offset
        const finalRotation = targetRotation + this.rotationOffset;

        if (this.mesh) {
            this.mesh.rotation.y = finalRotation;
        }

        if (this.lodMesh) {
            this.lodMesh.rotation.y = finalRotation;
        }
    }

    /**
     * Update body position in 3D space
     * @param {THREE.Vector3} position - The final position for the body
     */
    updatePosition(position) {
        // Update the body's physics position vector
        this.position.copy(position);

        // Update the body's visual position
        this.group.position.copy(position);

        // Update marker position if it exists
        if (this.marker && typeof this.marker.update === 'function') {
            this.marker.update();
        }
    }


    /**
     * Create ring system for the celestial body (e.g., Saturn's rings)
     * @param {Object} ringConfig - Ring configuration
     * @param {number} ringConfig.innerRadius - Inner radius relative to body radius
     * @param {number} ringConfig.outerRadius - Outer radius relative to body radius
     * @param {number} ringConfig.opacity - Ring opacity (0-1)
     * @param {number} ringConfig.color - Ring color (hex)
     * @returns {THREE.Mesh} The ring mesh
     */
    createRings(ringConfig) {
        const { innerRadius, outerRadius, opacity } = ringConfig;

        // Create custom ring geometry with radial UV mapping
        const ringGeometry = this.createRadialRingGeometry(
            this.radius * innerRadius,
            this.radius * outerRadius,
            64 // theta segments for smooth rings
        );

        // Load ring texture if specified in config
        let ringTexture = null;
        if (ringConfig.texture) {
            // Try to get preloaded texture first
            if (Body.preloadedTextures && Body.preloadedTextures.has(ringConfig.texture)) {
                ringTexture = Body.preloadedTextures.get(ringConfig.texture);
                log.debug('Body', `Using preloaded ring texture for ${this.name}`);
            } else {
                // Fallback to loading texture (for compatibility)
                log.warn('Body', `Preloaded ring texture not found for ${ringConfig.texture}, loading directly...`);
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

        // Note: Preloaded textures already have their configuration set

        // Create ring material with or without texture
        const materialProps = {
            color: ringTexture ? 0xffffff : (ringConfig.color || 0xffffff),
            opacity: opacity,
            transparent: true,
            side: THREE.FrontSide,
            alphaTest: 0.1 // Helps with transparency sorting
        };

        // Add texture map if available
        if (ringTexture) {
            materialProps.map = ringTexture;
        }

        // Use custom ring shader material with planet shadow support
        const ringMaterial = new RingShaderMaterial({
            ringTexture: ringTexture,
            opacity: opacity,
            ringColor: ringConfig.color || 0xffffff,
            planetRadius: this.radius,
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
    createRadialRingGeometry(innerRadius, outerRadius, thetaSegments = 64) {
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
     * @param {string} cloudConfig.texture - Cloud texture path
     * @param {number} cloudConfig.radiusScale - Radius scale relative to body radius
     * @param {number} cloudConfig.opacity - Cloud opacity (0-1)
     * @param {number} cloudConfig.rotationSpeed - Cloud rotation speed multiplier
     * @param {number} cloudConfig.alphaTest - Alpha test threshold for transparency (0-1)
     * @returns {THREE.Mesh} The cloud mesh with advanced planet shader material
     */
    createClouds(cloudConfig) {
        const { texture, radiusScale, opacity, rotationSpeed, alphaTest } = cloudConfig;

        // Create cloud geometry - slightly larger sphere than the planet
        const cloudRadius = this.radius * radiusScale;
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

        log.debug('Body', `Created cloud system with planet shader for ${this.name} (radius: ${cloudRadius.toFixed(3)}, opacity: ${opacity})`);

        return cloudMesh;
    }

    /**
     * Create atmosphere system for the celestial body (e.g., Earth's atmosphere)
     * @param {Object} atmosphereConfig - Atmosphere configuration
     * @param {string} atmosphereConfig.color - Atmosphere color (hex)
     * @param {number} atmosphereConfig.radiusScale - Radius scale relative to body radius
     * @param {number} atmosphereConfig.transparency - Atmosphere transparency (0-1)
     * @param {number} atmosphereConfig.stretchAmount - Stretch amount for sunset effects
     * @param {number} atmosphereConfig.visibilityDistance - Maximum visibility distance
     * @returns {THREE.Mesh} The atmosphere mesh
     */
    createAtmosphere(atmosphereConfig) {
        const { color, radiusScale, transparency, emissiveIntensity, fadeStart, fadeEnd } = atmosphereConfig;

        // Create atmosphere geometry - larger sphere than the planet
        const atmosphereRadius = this.radius * radiusScale;
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
     * Update atmosphere lighting for this body and all its children recursively
     * This replaces the AnimationManager's iteration pattern with direct hierarchical updates
     * @param {THREE.Vector3} lightPosition - Position of the light source (usually the sun)
     * @param {THREE.Color|number} lightColor - Color of the light source
     */
    updateLighting(lightPosition, lightColor) {
        // Update this body's atmosphere lighting
        if (this.atmosphere && this.atmosphere.userData.shaderMaterial) {
            this.atmosphere.userData.shaderMaterial.updateLighting(lightPosition, this.group.position);
            // Update atmosphere light color if provided
            if (lightColor !== undefined) {
                this.atmosphere.userData.shaderMaterial.setLightColor(lightColor);
            }
        }

        // Also update cloud lighting if clouds use shader material
        this.updateCloudLighting(lightPosition, lightColor);

        // Also update planet material lighting if this body uses planet material
        this.updateRingShadowLighting(lightPosition, lightColor);

        // Update ring material lighting for planet shadows on rings
        this.updateRingLighting(lightPosition, lightColor);
    }

    /**
     * Update planet material lighting based on light source
     * @param {THREE.Vector3} lightPosition - Position of the light source (usually the sun)
     * @param {THREE.Color|number} lightColor - Color of the light source
     */
    updateRingShadowLighting(lightPosition, lightColor) {
        // Check if this body's material is a planet material
        if (this.material && typeof this.material.updateLighting === 'function') {
            // Get the ring rotation from the tilt container
            const ringRotation = this.tiltContainer ? this.tiltContainer.rotation : null;
            this.material.updateLighting(lightPosition, this.group.position, ringRotation);

            // Update light color if provided
            if (lightColor !== undefined) {
                this.material.setLightColor(lightColor);
            }
        }
    }

    /**
     * Update celestial body shadows on this body's surface
     * @param {Array<Body>} shadowBodies - Array of Body objects that can cast shadows (moons, planets, etc.)
     */
    updateMoonShadows(shadowBodies) {
        const positions = [];
        const radii = [];

        // Collect shadow body data if available
        if (shadowBodies && shadowBodies.length > 0) {
            shadowBodies.forEach(body => {
                if (body && body.group && body.group.position && body.radius) {
                    positions.push(body.group.position.clone());
                    radii.push(body.radius);
                }
            });
        }

        // Update planet material if it supports celestial body shadows
        if (this.material && typeof this.material.updateMoons === 'function') {
            if (positions.length > 0) {
                this.material.updateMoons(positions, radii);
            } else {
                this.material.clearMoons();
            }
        }

        // Update cloud material if it supports celestial body shadows
        if (this.clouds && this.clouds.userData.shaderMaterial && typeof this.clouds.userData.shaderMaterial.updateMoons === 'function') {
            if (positions.length > 0) {
                this.clouds.userData.shaderMaterial.updateMoons(positions, radii);
            } else {
                this.clouds.userData.shaderMaterial.clearMoons();
            }
        }
    }

    /**
     * Update shadows using direct parent/children relationships (recursive shadow system)
     * This replaces the complex HierarchyManager-based system with a simpler direct approach
     */
    updateDirectShadows() {
        const shadowCasters = [];

        // Collect shadow casters from children (moons cast shadows on their parent planet)
        if (this.children && this.children.length > 0) {
            this.children.forEach(childHierarchy => {
                const childBody = childHierarchy.body;
                // Only add bodies that don't emit light (exclude stars/suns)
                if (childBody && !childBody.emittedLight) {
                    shadowCasters.push(childBody);
                }
            });
        }

        // Collect shadow casters from parent (planet casts shadow on its moons)
        if (this.parentBody && !this.parentBody.emittedLight) {
            shadowCasters.push(this.parentBody);
        }


        // Apply shadows if we have shadow casters
        if (shadowCasters.length > 0) {
            this.updateMoonShadows(shadowCasters);
        } else {
            // Clear shadows if no shadow casters
            if (this.material && typeof this.material.clearMoons === 'function') {
                this.material.clearMoons();
            }
            if (this.clouds && this.clouds.userData.shaderMaterial && typeof this.clouds.userData.shaderMaterial.clearMoons === 'function') {
                this.clouds.userData.shaderMaterial.clearMoons();
            }
        }
    }

    updateRecursive(deltaTime = 1/60, speedMultiplier = 1, starPosition, starLightColor) {
        this.updateRotation(deltaTime, speedMultiplier);
        this.updateDirectShadows();
        this.updateLighting(starPosition, starLightColor);
        this.updateLOD(SceneManager.camera)

        if (typeof this.orbit.updateLOD === 'function') {
            this.orbit.updateLOD(SceneManager.camera.position)
        }

        if (this.isStar) {
            // Update star shader animation if it's using a shader material
            if (this.isShaderMaterial && this.material.updateTime) {
                const currentTime = clockManager.getSimulationTime();
                this.material.updateTime(currentTime);
            }

            // Update star corona effect using unified clock
            if (this.billboard && this.billboard.update) {
                const effectsDeltaTime = clockManager.getEffectsDeltaTime();
                const camera = SceneManager.camera;
                this.billboard.update(effectsDeltaTime, camera);
            }

            // Update star rays effect using unified clock
            if (this.sunRays && this.sunRays.update) {
                const effectsDeltaTime = clockManager.getEffectsDeltaTime();
                // Get camera and star position for rays animation
                const camera = SceneManager.camera;
                const starPosition = this.group.position;
                this.sunRays.update(effectsDeltaTime, camera, starPosition);
            }

            // Update star flares effect using unified clock
            if (this.sunFlares && this.sunFlares.update) {
                const camera = SceneManager.camera;
                // Use animation speed from star configuration (default 0.1 for slow animation)
                const animationSpeed = this.starData?.flares?.animationSpeed || 0.1;
                const currentTime = clockManager.getSimulationTime() * animationSpeed;
                // Pass star material uniforms for synchronization
                const starMaterialUniforms = this.material ? this.material.uniforms : {};
                this.sunFlares.update(currentTime, camera, starMaterialUniforms);
            }

            // Update star glare effect using unified clock
            if (this.sunGlare && this.sunGlare.update) {
                const effectsDeltaTime = clockManager.getEffectsDeltaTime();
                const camera = SceneManager.camera;
                const starPosition = this.group.position;

                // Ensure glare is added to scene if not already (includes bloom layers)
                if (!this.sunGlare.mesh.parent) {
                    this.sunGlare.addToScene(SceneManager.scene);
                }

                // Position glare and all bloom layers at star's world position
                this.sunGlare.getAllMeshes().forEach(mesh => {
                    mesh.position.copy(starPosition);
                    mesh.visible = true;
                    // Make billboard face camera after positioning
                    mesh.lookAt(camera.position);
                });

                // Always keep star visible and let glare handle its own fading overlay
                if (this.mesh) this.mesh.visible = true;

                this.sunGlare.update(effectsDeltaTime, camera, starPosition);
            }        
        }

        if (this.children && this.children.length > 0) {
            this.children.forEach(childHierarchy => {
                const childBody = childHierarchy.body;
                if (childBody && typeof childBody.updateRecursive === 'function') {
                    childBody.updateRecursive(deltaTime, speedMultiplier, starPosition, starLightColor);
                }
            });
        }
    }

    /**
     * Update ring material lighting for planet shadows on rings
     * @param {THREE.Vector3} lightPosition - Position of the light source (usually the sun)
     * @param {THREE.Color|number} lightColor - Color of the light source
     */
    updateRingLighting(lightPosition, lightColor) {
        if (this.rings) {
            // Update lighting for both top and bottom ring meshes
            this.rings.traverse((child) => {
                if (child.material && typeof child.material.updateLighting === 'function') {
                    child.material.updateLighting(lightPosition, this.group.position);

                    // Update light color if provided
                    if (lightColor !== undefined) {
                        child.material.setLightColor(lightColor);
                    }
                }
            });
        }
    }

    /**
     * Update cloud lighting based on light source
     * @param {THREE.Vector3} lightPosition - Position of the light source (usually the sun)
     * @param {THREE.Color} lightColor - Color of the light source
     */
    updateCloudLighting(lightPosition, lightColor) {
        if (this.clouds && this.clouds.userData.shaderMaterial) {
            // Get the ring rotation from the tilt container for ring shadow calculations
            const ringRotation = this.tiltContainer ? this.tiltContainer.rotation : null;
            this.clouds.userData.shaderMaterial.updateLighting(lightPosition, this.group.position, ringRotation);

            // Update cloud light color if provided
            if (lightColor !== undefined) {
                this.clouds.userData.shaderMaterial.setLightColor(lightColor);
            }
        }
    }

    /**
     * Set physics position and sync visual position
     * @param {THREE.Vector3} newPosition - New position
     */
    setPosition(newPosition) {
        this.position.copy(newPosition);
        this.updatePosition(this.position);
    }

    /**
     * Set physics velocity
     * @param {THREE.Vector3} newVelocity - New velocity
     */
    setVelocity(newVelocity) {
        this.velocity.copy(newVelocity);
    }

    /**
     * Add force to this body
     * @param {THREE.Vector3} additionalForce - Force to add
     */
    addForce(additionalForce) {
        this.force.add(additionalForce);
    }

    /**
     * Reset physics to initial conditions
     */
    resetPhysics() {
        VectorUtils.safeCopy(this.position, this.initialPosition);
        VectorUtils.safeCopy(this.velocity, this.initialVelocity);
        VectorUtils.zero(this.force);
        VectorUtils.zero(this.acceleration);
        this.updatePosition(this.position);

        log.debug('Body', `Reset ${this.name} to initial physics conditions`);
    }

    /**
     * Get kinetic energy of this body
     * @returns {number} Kinetic energy (0.5 * m * v²)
     */
    getKineticEnergy() {
        return 0.5 * this.mass * this.velocity.lengthSq();
    }

    /**
     * Get momentum of this body
     * @returns {THREE.Vector3} Momentum vector (m * v)
     */
    getMomentum() {
        return VectorUtils.multiplyScalar(VectorUtils.temp(), this.velocity, this.mass);
    }

    /**
     * Get speed (magnitude of velocity)
     * @returns {number} Speed
     */
    getSpeed() {
        return this.velocity.length();
    }

    /**
     * Get distance to another body
     * @param {Body} otherBody - The other body
     * @returns {number} Distance
     */
    getDistanceTo(otherBody) {
        return this.position.distanceTo(otherBody.position);
    }

    /**
     * Set initial physics conditions
     * @param {THREE.Vector3} initialPosition - Initial position
     * @param {THREE.Vector3} initialVelocity - Initial velocity
     */
    setInitialPhysicsConditions(initialPosition = new THREE.Vector3(), initialVelocity = new THREE.Vector3()) {
        // Store initial conditions for reset capability
        VectorUtils.safeCopy(this.initialPosition, initialPosition);
        VectorUtils.safeCopy(this.initialVelocity, initialVelocity);

        // Set current physics state to initial conditions
        VectorUtils.safeCopy(this.position, initialPosition);
        VectorUtils.safeCopy(this.velocity, initialVelocity);
        VectorUtils.zero(this.force);
        VectorUtils.zero(this.acceleration);

        // Update visual position to match
        this.updatePosition(this.position);
    }

    /**
     * Get physics state for debugging
     * @returns {Object} Current physics state
     */
    getPhysicsState() {
        return {
            name: this.name,
            mass: this.mass,
            position: {
                x: this.position.x,
                y: this.position.y,
                z: this.position.z
            },
            velocity: {
                x: this.velocity.x,
                y: this.velocity.y,
                z: this.velocity.z,
                magnitude: this.velocity.length()
            },
            force: {
                x: this.force.x,
                y: this.force.y,
                z: this.force.z,
                magnitude: this.force.length()
            },
            kineticEnergy: this.getKineticEnergy(),
            speed: this.getSpeed()
        };
    }

    /**
     * Initialize orbital trail rendering
     */
    initializeOrbitTrail() {
        if (this.name === 'Sun') {
            // Don't create orbit trail for the sun
            return;
        }

        // Only create OrbitTrail if it doesn't already exist
        if (!this.orbitTrail) {
            // Create OrbitTrail instance with body's color
            const trailColor = new THREE.Color(this.material.color);
            this.orbitTrail = new OrbitTrail(this.name, trailColor);

            // Register with SceneManager for visibility management
            SceneManager.registerOrbitTrail(this);

            log.debug('Body', `Initialized orbit trail for ${this.name}`);
        }
    }

    /**
     * Update orbital trail with current position (called every frame)
     */
    updateOrbitTrail() {
        if (this.orbitTrail) {
            this.orbitTrail.addPoint(this.position);
        }
    }

    /**
     * Toggle orbital trail visibility
     */
    toggleOrbitTrail() {
        if (this.orbitTrail) {
            const enabled = this.orbitTrail.toggle();
            log.debug('Body', `Orbit trail ${enabled ? 'enabled' : 'disabled'} for ${this.name}`);
            return enabled;
        }
        return false;
    }

    /**
     * Clear orbital trail
     */
    clearOrbitTrail() {
        if (this.orbitTrail) {
            this.orbitTrail.clear();
            log.debug('Body', `Cleared orbit trail for ${this.name}`);
        }
    }

    /**
     * Set orbit trail visibility
     * @param {boolean} visible - Whether the trail should be visible
     */
    setOrbitTrailVisible(visible) {
        if (this.orbitTrail) {
            this.orbitTrail.setVisible(visible);
        }
    }

    /**
     * Hide the orbit trail
     */
    hide() {
        if (this.orbitTrail) {
            this.orbitTrail.hide();
        }
    }

    /**
     * Show the orbit trail
     */
    show() {
        if (this.orbitTrail) {
            this.orbitTrail.show();
        }
    }

    /**
     * Set orbit trail enabled state
     * @param {boolean} enabled - Whether the trail should be enabled
     */
    setOrbitTrailEnabled(enabled) {
        if (this.orbitTrail) {
            this.orbitTrail.setEnabled(enabled);
        }
    }


    /**
     * Clean up body resources to prevent memory leaks
     */
    dispose() {
        // Unregister from star system if this is a star
        if (this.isStar) {
            SceneManager.unregisterStar(this.group);
            log.debug('Body', `Unregistered ${this.name} from bloom effects`);
        }

        // Dispose of orbit trail first
        if (this.orbitTrail && typeof this.orbitTrail.dispose === 'function') {
            log.info('Body', `Disposing orbit trail for ${this.name}`);
            this.orbitTrail.dispose();
            this.orbitTrail = null;
        }

        // Dispose of marker
        if (this.marker && typeof this.marker.dispose === 'function') {
            log.info('Body', `Disposing marker for ${this.name}`);
            this.marker.dispose();
            this.marker = null;
        } else if (this.marker) {
            log.warn('Body', `Marker for ${this.name} has no dispose method`);
        }

        // Dispose of billboard glow effect if it exists (for Sun)
        if (this.billboard && typeof this.billboard.dispose === 'function') {
            log.info('Body', `Disposing billboard glow effect for ${this.name}`);
            this.billboard.dispose();
            this.billboard = null;
        }

        // Dispose of sun rays effect if it exists (for Sun)
        if (this.sunRays && typeof this.sunRays.dispose === 'function') {
            log.info('Body', `Disposing sun rays effect for ${this.name}`);
            this.sunRays.dispose();
            this.sunRays = null;
        }

        // Dispose of rings if they exist
        if (this.rings) {
            if (this.rings.geometry) {
                this.rings.geometry.dispose();
            }
            if (this.rings.material) {
                this.rings.material.dispose();
            }
            if (this.rings.parent) {
                this.rings.parent.remove(this.rings);
            }
            this.rings = null;
        }

        // Dispose of clouds if they exist
        if (this.clouds) {
            if (this.clouds.geometry) {
                this.clouds.geometry.dispose();
            }
            if (this.clouds.material) {
                if (this.clouds.material.map) {
                    this.clouds.material.map.dispose();
                }
                this.clouds.material.dispose();
            }
            if (this.clouds.parent) {
                this.clouds.parent.remove(this.clouds);
            }
            this.clouds = null;
        }

        // Dispose of atmosphere if it exists
        if (this.atmosphere) {
            if (this.atmosphere.geometry) {
                this.atmosphere.geometry.dispose();
            }
            if (this.atmosphere.material) {
                this.atmosphere.material.dispose();
            }
            if (this.atmosphere.parent) {
                this.atmosphere.parent.remove(this.atmosphere);
            }
            this.atmosphere = null;
        }

        // Dispose of geometry
        if (this.geometry && typeof this.geometry.dispose === 'function') {
            this.geometry.dispose();
        }

        // Dispose of material and its textures
        if (this.material && typeof this.material.dispose === 'function') {
            // Dispose of textures first
            if (this.material.map && this.material.map.dispose) {
                // Clean up canvas if it exists
                if (this.material.map.userData && this.material.map.userData.canvas) {
                    const canvas = this.material.map.userData.canvas;
                    const context = canvas.getContext('2d');
                    if (context) {
                        context.clearRect(0, 0, canvas.width, canvas.height);
                    }
                }
                this.material.map.dispose();
            }
            this.material.dispose();
        }

        // Remove from scene
        if (this.group && this.group.parent) {
            this.group.parent.remove(this.group);
        }

        // Remove emitted light if it exists
        if (this.emittedLight && this.emittedLight.parent) {
            this.emittedLight.parent.remove(this.emittedLight);
        }

        // Clear references
        this.geometry = null;
        this.material = null;
        this.mesh = null;
        this.lodMesh = null;
        this.lod = null;
        this.pinpointMesh = null;
        this.group = null;
        this.emittedLight = null;
        this.thisBody = null;
    }

    /**
     * Create light for a body if it emits light
     * @param {Object} bodyData - The celestial body data
     * @returns {THREE.PointLight|null} The created light or null
     * @private
     */
    static createLightForBody(bodyData) {
        // Only process bodies that might emit light
        if (!bodyData.star && !bodyData.lightIntensity) {
            return null;
        }

        let lightIntensity;

        // For stars, use same temperature-based calculation as other star effects
        if (bodyData.star) {
            const temperature = bodyData.star.temperature || 5778; // Default to solar temperature
            const radius = bodyData.radiusScale || 1.0; // Relative to solar radius

            // Use same calculation as glare, rays, flares, and star material for consistency
            const calculatedLightIntensity = temperatureToGlareBrightness(temperature, radius);

            // Allow manual override if specified, otherwise use calculated value
            lightIntensity = bodyData.star.lightIntensity !== undefined ?
                bodyData.star.lightIntensity : calculatedLightIntensity;

        } else {
            // Non-star bodies use manual light intensity
            lightIntensity = bodyData.lightIntensity;
        }

        // Early exit if no light emission
        if (!lightIntensity || lightIntensity <= 0) {
            return null;
        }

        // Use pure blackbody radiation color for stars, white for others
        const lightColor = bodyData.star?.temperature ?
            temperatureToBlackbodyLight(bodyData.star.temperature) :
            0xffffff; // Default white light for non-stars

        const light = new THREE.PointLight(lightColor, lightIntensity);
        light.decay = 0; // Disable distance decay - light doesn't reduce over distance

        return light;
    }

    /**
     * Calculate body radius based on parent body scaling
     * @param {Object} bodyData - The celestial body data
     * @param {Body|null} parentBody - The parent body
     * @returns {number} The calculated radius
     * @private
     */
    static calculateBodyRadius(bodyData, parentBody) {
        if (parentBody) {
            // Parent radius already includes SceneManager.scale, so don't apply it again
            return parentBody.radius * bodyData.radiusScale;
        } else {
            // For Sun, use the radiusScale directly
            return bodyData.radiusScale * SceneManager.scale;
        }
    }

    /**
     * Set marker color for body
     * @param {Body} body - The body to set marker color on
     * @param {Object} bodyData - The celestial body data
     * @private
     */
    static setMarkerColor(body, bodyData) {
        if (bodyData.markerColor !== undefined) {
            body.markerColor = new THREE.Color(bodyData.markerColor);
        } else {
            log.warn('Body', `No markerColor specified for ${bodyData.name}`);
        }
    }

    /**
     * Add star-specific visual effects to a body
     * @param {Body} body - The body to add effects to
     * @param {Object} bodyData - The celestial body data
     * @param {number} radius - The body radius
     * @private
     */
    static addStarEffects(body, bodyData, radius) {

        // Add corona outersphere effect (only if corona data exists)
        if (bodyData.star.corona) {
            Body.addCoronaEffect(body, bodyData, radius);
        } else {
            log.debug('Body', 'Corona data not found - skipping corona effect');
        }

        // Add sun rays effect (only if rays data exists)
        if (bodyData.star.rays) {
            Body.addSunRaysEffect(body, bodyData, radius);
        } else {
            log.debug('Body', 'Rays data not found - skipping rays effect');
        }

        // Add sun flares effect (only if flares data exists)
        if (bodyData.star.flares) {
            Body.addSunFlaresEffect(body, bodyData, radius);
        } else {
            log.debug('Body', 'Flares data not found - skipping flares effect');
        }

        // Add sun glare effect (only if glare data exists)
        if (bodyData.star.glare) {
            Body.addSunGlareEffect(body, bodyData, radius);
        } else {
            log.debug('Body', 'Glare data not found - skipping glare effect');
        }

        // Store star data for animation manager access
        body.starData = bodyData.star;
    }

    /**
     * Add corona outersphere effect to star
     * @param {Body} body - The body to add effect to
     * @param {Object} bodyData - The celestial body data
     * @param {number} radius - The body radius
     * @private
     */
    static addCoronaEffect(body, bodyData, radius) {

        // Create the corona using nested parameters and temperature color
        const starCorona = bodyData.star.corona || bodyData.star.billboard || {};
        const coronaColor = bodyData.star.temperature ?
            temperatureToColor(bodyData.star.temperature) :
            (bodyData.color || 0xffaa00);

        const sunCorona = new SunCorona({
            sunRadius: radius,
            coronaRadius: radius * (starCorona.size || 2.5),
            coronaColor: starCorona.glowColor || starCorona.coronaColor || coronaColor,
            coronaIntensity: starCorona.glowIntensity || starCorona.coronaIntensity || 0.8,
            noiseScale: starCorona.noiseScale || 3.0,
            animationSpeed: starCorona.animationSpeed || starCorona.pulseSpeed || 0.001,
            fresnelPower: starCorona.fresnelPower || 2.0,
            lowres: false
        });

        // Add the corona to the sun's group so it moves with the sun
        // Position it at the exact center so it surrounds the sun
        sunCorona.setPosition(new THREE.Vector3(0, 0, 0));
        body.group.add(sunCorona.getMesh());

        // Store reference to corona for updates (keeping 'billboard' name for compatibility)
        body.billboard = sunCorona;

    }

    /**
     * Add sun rays effect to star
     * @param {Body} body - The body to add effect to
     * @param {Object} bodyData - The celestial body data
     * @param {number} radius - The body radius
     * @private
     */
    static addSunRaysEffect(body, bodyData, radius) {

        const starRays = bodyData.star.rays || {};

        // Calculate temperature-based color and emissive intensity for rays
        const temperatureColor = bodyData.star?.temperature ?
            temperatureToColor(bodyData.star.temperature) :
            0xffaa00; // Default orange for non-temperature stars

        // Calculate temperature-based emissive intensity
        const temperature = bodyData.star.temperature || 5778; // Default to solar temperature
        const stellarRadius = bodyData.radiusScale || 1.0; // Relative to solar radius
        const temperatureBasedBrightness = temperatureToGlareBrightness(temperature, stellarRadius);

        // Allow manual override if specified, otherwise use calculated value
        const emissiveIntensity = starRays.emissiveIntensity !== undefined ?
            starRays.emissiveIntensity : temperatureBasedBrightness;

        const sunRays = new SunRays({
            sunRadius: radius,
            rayCount: starRays.rayCount || 2048,
            rayLength: starRays.rayLength || 0.015,
            rayWidth: starRays.rayWidth || 0.001,
            rayOpacity: starRays.rayOpacity || 0.4,
            baseColor: temperatureColor,  // Use temperature-based color instead of hue
            hueSpread: starRays.hueSpread || 0.3,
            noiseFrequency: starRays.noiseFrequency || 15,
            noiseAmplitude: starRays.noiseAmplitude || 12.0,
            bendAmount: starRays.bendAmount || 0.0,
            whispyAmount: starRays.whispyAmount || 0.0,
            lowres: starRays.lowres || false,
            emissiveIntensity: emissiveIntensity
        });

        // Add rays directly to the sun's rotating mesh so they rotate with it
        body.mesh.add(sunRays.getMesh());

        // Set ray color to match star temperature
        const rayColor = bodyData.star.temperature ?
            temperatureToColor(bodyData.star.temperature) :
            (bodyData.color || 0xffaa00);
        sunRays.setBaseColor(rayColor);

        // Store reference for updates
        body.sunRays = sunRays;

    }

    /**
     * Add sun flares effect to star
     * @param {Body} body - The body to add effect to
     * @param {Object} bodyData - The celestial body data
     * @param {number} radius - The body radius
     * @private
     */
    static addSunFlaresEffect(body, bodyData, radius) {

        const starFlares = bodyData.star.flares || {};

        // Calculate temperature-based color and emissive intensity for flares
        const temperatureColor = bodyData.star?.temperature ?
            temperatureToColor(bodyData.star.temperature) :
            0xffaa00; // Default orange for non-temperature stars

        // Calculate temperature-based emissive intensity
        const temperature = bodyData.star.temperature || 5778; // Default to solar temperature
        const stellarRadius = bodyData.radiusScale || 1.0; // Relative to solar radius
        const temperatureBasedBrightness = temperatureToGlareBrightness(temperature, stellarRadius);

        // Allow manual override if specified, otherwise use calculated value
        const emissiveIntensity = starFlares.emissiveIntensity !== undefined ?
            starFlares.emissiveIntensity : temperatureBasedBrightness;

        const sunFlares = new SunFlares({
            sunRadius: radius,
            lineCount: starFlares.lineCount || 1024,
            lineLength: starFlares.lineLength || 16,
            lowres: starFlares.lowres || false,
            opacity: starFlares.opacity || 0.8,
            baseColor: temperatureColor,  // Use temperature-based color
            emissiveIntensity: emissiveIntensity
        });

        // Add flares directly to the sun's rotating mesh so they rotate with it
        body.mesh.add(sunFlares.getMesh());

        // Set flare color to match star temperature
        const flareColor = bodyData.star.temperature ?
            temperatureToColor(bodyData.star.temperature) :
            (bodyData.color || 0xffaa00);
        sunFlares.setBaseColor(flareColor);

        // Store reference for updates
        body.sunFlares = sunFlares;

    }

    /**
     * Add sun glare billboard effect to star
     * @param {Body} body - The body to add effect to
     * @param {Object} bodyData - The celestial body data
     * @param {number} radius - The body radius
     * @private
     */
    static addSunGlareEffect(body, bodyData, radius) {

        const starGlare = bodyData.star.glare || {};
        const glareColor = bodyData.star.temperature ?
            temperatureToColor(bodyData.star.temperature) :
            (starGlare.color || 0xffaa00);

        // Calculate temperature-based glare brightness
        const temperature = bodyData.star.temperature || 5778; // Default to solar temperature
        const stellarRadius = bodyData.radiusScale || 1.0; // Relative to solar radius
        const temperatureBasedBrightness = temperatureToGlareBrightness(temperature, stellarRadius);

        // Allow manual override if specified, otherwise use calculated value with massive boost
        const emissiveIntensity = starGlare.emissiveIntensity !== undefined ?
            starGlare.emissiveIntensity : temperatureBasedBrightness * 25.0; // 25x boost - much brighter

        // Also scale the base opacity based on temperature for visual brightness (not just bloom)
        const baseOpacity = starGlare.opacity || 1.0; // Increased base opacity
        const temperatureOpacityMultiplier = Math.min(8.0, temperatureBasedBrightness / 1.5); // Even higher multiplier
        const adjustedOpacity = Math.min(1.0, baseOpacity * temperatureOpacityMultiplier);

        // Calculate color brightness multiplier based on temperature with massive boost
        const colorBrightnessMult = Math.min(35.0, temperatureBasedBrightness / 0.5); // 35x max, even lower divisor

        // Scale distance-based parameters by star radius for proportional scaling
        // This makes larger stars have proportionally larger fade distances and smaller stars smaller ones
        const radiusScale = stellarRadius; // Use stellar radius as the scaling factor
        const scaledFadeStartDistance = (starGlare.fadeStartDistance || 20.0) * radiusScale;
        const scaledFadeEndDistance = (starGlare.fadeEndDistance || 10.0) * radiusScale;
        const scaledMinScaleDistance = (starGlare.minScaleDistance || 15.0) * radiusScale;
        const scaledMaxScaleDistance = (starGlare.maxScaleDistance || 700.0) * radiusScale;

        const sunGlare = new SunGlare({
            sunRadius: radius,
            size: starGlare.size || 90.0,  // Use the correct default from constants.js
            opacity: adjustedOpacity,
            color: glareColor,
            brightnessMult: colorBrightnessMult,
            emissiveIntensity: emissiveIntensity,
            fadeStartDistance: scaledFadeStartDistance,
            fadeEndDistance: scaledFadeEndDistance,
            // Distance-based scaling parameters (scaled by star radius)
            scaleWithDistance: starGlare.scaleWithDistance !== undefined ? starGlare.scaleWithDistance : true,
            minScaleDistance: scaledMinScaleDistance,
            maxScaleDistance: scaledMaxScaleDistance,
            minScale: starGlare.minScale || 0.2,
            maxScale: starGlare.maxScale || 10.0,
            // Radial center glow scaling parameters
            scaleCenterWithDistance: starGlare.scaleCenterWithDistance !== undefined ? starGlare.scaleCenterWithDistance : false,
            centerBaseSize: starGlare.centerBaseSize || 0.05,
            centerFadeSize: starGlare.centerFadeSize || 0.1,
            lowres: false
        });

        // Add the glare directly to the scene at a higher level for better render order control
        // We'll position it manually in the update loop
        // Note: This will be added to the scene later via SceneManager

        // Store reference for updates
        body.sunGlare = sunGlare;

    }
}

export default Body;
