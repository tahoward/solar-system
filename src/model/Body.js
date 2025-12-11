import * as THREE from 'three';
import Marker from './Marker.js';
import SceneManager from '../managers/SceneManager.js';
import ConfigValidator from '../utils/ConfigValidator.js';
import { log } from '../utils/Logger.js';
import { GEOMETRY } from '../constants.js';
import AtmosphereShaderMaterial from '../shaders/AtmosphereShaderMaterial.js';
import CloudShaderMaterial from '../shaders/CloudShaderMaterial.js';
import RingShaderMaterial from '../shaders/RingShaderMaterial.js';
import VectorUtils from '../utils/VectorUtils.js';
import OrbitTrail from './OrbitTrail.js';


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
     * Creates a new celestial body with specified properties.
     * @param {string} name - The body name (must be non-empty)
     * @param {number} radius - The radius of the sphere geometry (must be positive)
     * @param {THREE.Material} material - The material used by the body
     * @param {boolean} [marker=true] - Whether to add a marker to the body
     * @param {THREE.PointLight|null} [emittedLight=null] - The light emitted from the body
     * @param {number} [mass=1] - Mass of the body in solar masses
     * @param {number} [rotationPeriod=24] - Rotation period in Earth hours
     * @param {number} [axialTilt=0] - Axial tilt in degrees
     * @param {number} [rotationOffset=0] - Fixed rotation offset in radians
     * @param {boolean} [tidallyLocked=false] - Whether this body is tidally locked to its parent
     * @param {Body|null} [parentBody=null] - The parent body this object orbits (for tidal locking)
     */
    constructor(
      name,
      radius,
      material,
      marker = true,
      emittedLight = null,
      mass = 1,
      rotationPeriod = 24,
      axialTilt = 0,
      rings = null,
      clouds = null,
      atmosphere = null,
      rotationOffset = 0,
      tidallyLocked = false,
      parentBody = null
    ) {
        // Validate configuration using centralized validator
        ConfigValidator.validateBodyConfig({ name, radius, marker });

        this.name = name;
        this.radius = radius;
        this.emittedLight = emittedLight;
        this.material = material;
        this.mass = mass;
        this.isTarget = false;
        this.thisBody = null;

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

        SceneManager.scene.add(this.group);

        // Initialize orbit trail (after scene setup)
        this.initializeOrbitTrail();
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

        // Debug LOD changes more frequently for testing (disabled to reduce console noise)
        // if (Math.random() < 0.05) { // 5% of frames for easier debugging
        //     const distance = camera.position.distanceTo(this.group.position);
        //     const currentLevel = this.lod.getCurrentLevel();
        //     if (currentLevel === 0) {
        //         console.log(`🔍 ${this.name} LOD: Full detail (distance: ${distance.toFixed(3)})`);
        //     } else {
        //         console.log(`✨ ${this.name} LOD: Pinpoint (distance: ${distance.toFixed(1)}) - Should be visible!`);
        //     }
        // }
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
                console.log(`Body: Using preloaded ring texture for ${this.name}`);
            } else {
                // Fallback to loading texture (for compatibility)
                console.warn(`Body: Preloaded ring texture not found for ${ringConfig.texture}, loading directly...`);
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

        // Create bottom side ring mesh (flipped)
        const bottomRingMesh = new THREE.Mesh(ringGeometry, ringMaterial.clone());
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

        console.log(`Body: Created cloud system with planet shader for ${this.name} (radius: ${cloudRadius.toFixed(3)}, opacity: ${opacity})`);

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
     * Update atmosphere lighting based on light source
     * @param {THREE.Vector3} lightPosition - Position of the light source (usually the sun)
     */
    updateAtmosphereLighting(lightPosition, lightColor) {
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
}

export default Body;
