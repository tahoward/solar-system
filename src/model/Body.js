import * as THREE from 'three';
import Marker from './Marker.js';
import Orbit from './Orbit.js';
import SceneManager from '../managers/SceneManager.js';
import ConfigValidator from '../utils/ConfigValidator.js';
import logger, { log } from '../utils/Logger.js';
import VectorUtils from '../utils/VectorUtils.js';
import OrbitTrail from './OrbitTrail.js';
import StarEffects from '../effects/StarEffects.js';
import BodyRenderer from '../rendering/BodyRenderer.js';
import BodyPhysics from '../physics/BodyPhysics.js';
import ResourceManager from '../utils/ResourceManager.js';
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
        const emittedLight = StarEffects.createLightForBody(bodyData);

        // Calculate radius - for planets, scale relative to parent (Sun)
        const radius = BodyPhysics.calculateBodyRadius(bodyData, parentBody, SceneManager);

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
        this.rotationSpeed = BodyPhysics.calculateRotationSpeed(rotationPeriod);

        // Hierarchy properties for recursive creation
        this.children = [];
        this.orbit = null;
        this.bodyData = bodyData; // Store original data for reference

        // Create basic materials and geometries
        this.geometry = BodyRenderer.createGeometry(this.radius);

        // Create mesh and group structure
        this.mesh = BodyRenderer.createMesh(this.geometry, this.material);

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
        const lodSystem = BodyRenderer.createLODSystem(this.mesh, this.rotationOffset, this.material, this.name);
        this.lod = lodSystem.lod;
        this.lodMesh = lodSystem.lodMesh;
        this.pinpointMesh = lodSystem.pinpointMesh;
        this.lodNearDistance = lodSystem.lodNearDistance;
        this.lodFarDistance = lodSystem.lodFarDistance;

        // Add LOD system to tilt container so it inherits the fixed tilt
        this.tiltContainer.add(this.lod);

        // Create main group and add tilt container to it
        this.group = BodyRenderer.createGroup(this);
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
            this.rings = BodyRenderer.createRings(rings, this.radius, Body.preloadedTextures, this.name);
            this.tiltContainer.add(this.rings); // Add to tilt container so rings rotate with axial tilt
        }

        // Create clouds if specified
        this.clouds = null;
        if (clouds) {
            this.clouds = BodyRenderer.createClouds(clouds, this.radius, this.name);
            this.tiltContainer.add(this.clouds); // Add to tilt container so clouds rotate with axial tilt
        }

        // Create atmosphere if specified
        this.atmosphere = null;
        if (atmosphere) {
            this.atmosphere = BodyRenderer.createAtmosphere(atmosphere, this.radius);
            this.group.add(this.atmosphere); // Add atmosphere to main group (not tilt container)
        }

        // Add advanced star effects if this is a star (before adding to scene)
        if (bodyData.star) {
            StarEffects.addStarEffects(this, bodyData, radius);
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
     * Updates the LOD system based on camera distance
     * @param {THREE.Camera} camera - The camera to calculate distance from
     */
    updateLOD(camera) {
        BodyRenderer.updateLOD(this.lod, camera);
    }


    /**
     * Update body rotation (call this every frame)
     * @param {number} deltaTime - Time elapsed since last frame in seconds
     * @param {number} speedMultiplier - Current simulation speed multiplier
     */
    updateRotation(deltaTime = 1/60, speedMultiplier = 1) {
        BodyPhysics.updateRotation(this, deltaTime, speedMultiplier);
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
     * Update body position in 3D space
     * @param {THREE.Vector3} position - The final position for the body
     */
    updatePosition(position) {
        BodyPhysics.updatePosition(this, position);
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

    update(deltaTime = 1/60, speedMultiplier = 1, starPosition, starLightColor) {
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
                if (childBody && typeof childBody.update === 'function') {
                    childBody.update(deltaTime, speedMultiplier, starPosition, starLightColor);
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
        BodyPhysics.setPosition(this, newPosition);
    }

    /**
     * Set physics velocity
     * @param {THREE.Vector3} newVelocity - New velocity
     */
    setVelocity(newVelocity) {
        BodyPhysics.setVelocity(this, newVelocity);
    }

    /**
     * Add force to this body
     * @param {THREE.Vector3} additionalForce - Force to add
     */
    addForce(additionalForce) {
        BodyPhysics.addForce(this, additionalForce);
    }

    /**
     * Reset physics to initial conditions
     */
    resetPhysics() {
        BodyPhysics.resetPhysics(this);
    }

    /**
     * Get kinetic energy of this body
     * @returns {number} Kinetic energy (0.5 * m * v²)
     */
    getKineticEnergy() {
        return BodyPhysics.getKineticEnergy(this);
    }

    /**
     * Get momentum of this body
     * @returns {THREE.Vector3} Momentum vector (m * v)
     */
    getMomentum() {
        return BodyPhysics.getMomentum(this);
    }

    /**
     * Get speed (magnitude of velocity)
     * @returns {number} Speed
     */
    getSpeed() {
        return BodyPhysics.getSpeed(this);
    }

    /**
     * Get distance to another body
     * @param {Body} otherBody - The other body
     * @returns {number} Distance
     */
    getDistanceTo(otherBody) {
        return BodyPhysics.getDistanceTo(this, otherBody);
    }

    /**
     * Set initial physics conditions
     * @param {THREE.Vector3} initialPosition - Initial position
     * @param {THREE.Vector3} initialVelocity - Initial velocity
     */
    setInitialPhysicsConditions(initialPosition = new THREE.Vector3(), initialVelocity = new THREE.Vector3()) {
        BodyPhysics.setInitialPhysicsConditions(this, initialPosition, initialVelocity);
    }

    /**
     * Get physics state for debugging
     * @returns {Object} Current physics state
     */
    getPhysicsState() {
        return BodyPhysics.getPhysicsState(this);
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
        ResourceManager.dispose(this);

        if (this.children && this.children.length > 0) {
            this.children.forEach(childHierarchy => {
                const childBody = childHierarchy.body;
                if (childBody && typeof childBody.dispose === 'function') {
                    ResourceManager.dispose(childBody);
                }
            });
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





}

export default Body;
