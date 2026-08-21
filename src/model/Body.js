import * as THREE from 'three';
import Marker from './Marker.js';
import Orbit from './Orbit.js';
import BarycentrePath from './BarycentrePath.js';
import SceneManager from '../managers/SceneManager.js';
import ConfigValidator from '../utils/ConfigValidator.js';
import { log } from '../utils/Logger.js';
import VectorUtils from '../utils/VectorUtils.js';
import OrbitTrail from './OrbitTrail.js';
import StarEffects from '../effects/StarEffects.js';
import BlackHoleEffects from '../effects/BlackHoleEffects.js';
import BodyRenderer from '../rendering/BodyRenderer.js';
import BodyPhysics from '../physics/BodyPhysics.js';
import ResourceManager from '../utils/ResourceManager.js';
import MaterialFactory from '../factories/MaterialFactory.js';
import SunspotManager from '../effects/SunspotManager.js';
import { BARYCENTRE, massToStellarRadius, massToStellarTemperature } from '../constants.js';

/**
 * A celestial body: its scene objects, physics state and children.
 *
 * This is the central model class. Construction is recursive — building the Sun
 * builds the planets, which build their moons — so the whole system comes from a
 * single `new Body(CELESTIAL_DATA)`. The heavy lifting is delegated out:
 * {@link BodyRenderer} builds geometry, {@link BodyPhysics} handles motion and
 * spin, {@link StarEffects} adds the star-only visuals, {@link BlackHoleEffects}
 * the black-hole-only ones and {@link ResourceManager} tears it all down.
 *
 * The scene graph is layered as `group` → `tiltContainer` → `mesh`. The group
 * carries orbital position, while the tilt container applies axial tilt, so the
 * body can be moved without disturbing the orientation of its spin axis, rings
 * and clouds.
 */
class Body {
    /**
     * Textures loaded up front by {@link TexturePreloader}, shared by all bodies.
     *
     * @type {?Map<string, THREE.Texture>}
     */
    static preloadedTextures = null;

    /**
     * Supplies the preloaded texture cache used by subsequently created bodies.
     *
     * Must be called before construction for textures to be picked up, otherwise
     * bodies fall back to loading their own.
     *
     * @param {Map<string, THREE.Texture>} textures - Textures keyed by URL.
     * @returns {void}
     */
    static setPreloadedTextures(textures) {
        this.preloadedTextures = textures;
    }

    /**
     * Fills in a star's radius and temperature from its mass.
     *
     * Both follow from the mass for a main-sequence star, so a star can be given as
     * a mass alone rather than as three numbers a reader has to trust are mutually
     * consistent. Whatever the data does state wins: a giant, a white dwarf or a
     * deliberately unphysical star has left the main sequence, and stating either
     * value opts that one value out of the relations.
     *
     * The derived radius is in solar radii, which is the scale `radiusScale` is
     * already in for the system's root body.
     *
     * Non-stars are returned untouched — a planet's size has nothing to do with its
     * mass. So is a star that states both, which is why the Sun is unaffected by
     * this despite the relations reproducing its values exactly.
     *
     * @private
     * @param {Object} bodyData - Body definition, possibly carrying a `star` block.
     * @returns {Object} `bodyData` unchanged when there is nothing to derive,
     *   otherwise a shallow copy with the missing values filled in — the catalogue
     *   literal is left as written.
     */
    static #deriveMainSequenceProperties(bodyData) {
        if (!bodyData.star || typeof bodyData.mass !== 'number') {
            return bodyData;
        }

        const needsRadius = bodyData.radiusScale === undefined || bodyData.radiusScale === null;
        const needsTemperature = bodyData.star.temperature === undefined || bodyData.star.temperature === null;

        if (!needsRadius && !needsTemperature) {
            return bodyData;
        }

        const derived = { ...bodyData };

        if (needsRadius) {
            derived.radiusScale = massToStellarRadius(bodyData.mass);
        }

        if (needsTemperature) {
            derived.star = { ...bodyData.star, temperature: massToStellarTemperature(bodyData.mass) };
        }

        log.info('Body', `${bodyData.name}: derived main-sequence properties from ` +
            `${bodyData.mass} solar masses — ${derived.radiusScale.toFixed(3)} solar radii, ` +
            `${Math.round(derived.star.temperature)} K`);

        return derived;
    }

    /**
     * Builds a body, its scene objects, its orbit and all of its children.
     *
     * Optional features are driven by the presence of fields in `bodyData`: rings,
     * clouds, an atmosphere and star effects are each added only when configured.
     * The body adds itself to the scene, and registers itself for bloom, orbit
     * rendering and trail updates.
     *
     * A star that leaves out its radius or temperature has them derived from its
     * mass first, so everything downstream sees a complete definition either way.
     *
     * @param {Object} bodyData - Body definition from {@link CELESTIAL_DATA};
     *   supplies name, mass, radius scale, rotation, tilt and optional
     *   `rings`/`clouds`/`atmosphere`/`star` sub-configurations.
     * @param {Body|null} [parentBody=null] - Body being orbited; `null` for the
     *   system's root.
     * @throws {Error} If the configuration fails {@link ConfigValidator} checks.
     */
    constructor(bodyData, parentBody = null) {
        bodyData = Body.#deriveMainSequenceProperties(bodyData);

        const emittedLight = StarEffects.createLightForBody(bodyData);

        const radius = BodyPhysics.calculateBodyRadius(bodyData, parentBody, SceneManager);

        const material = MaterialFactory.createBodyMaterial(bodyData, radius);

        const name = bodyData.name;
        const marker = true;
        const mass = bodyData.mass;
        const rotationPeriod = bodyData.rotationPeriod;
        const axialTilt = bodyData.axialTilt;
        const rings = bodyData.rings;
        const clouds = bodyData.clouds;
        const atmosphere = bodyData.atmosphere;
        const rotationOffset = bodyData.rotationOffset || 0;
        const tidallyLocked = bodyData.tidallyLocked || false;
        ConfigValidator.validateBodyConfig({ name, radius, marker });

        this.name = name;
        this.radius = radius;
        this.emittedLight = emittedLight;
        this.material = material;
        this.mass = mass;

        this.equatorialOrbit = bodyData.equatorialOrbit !== undefined ? bodyData.equatorialOrbit : false;

        this.radiusScale = bodyData.radiusScale || 1.0;

        this.isStar = !!bodyData.star;
        this.isBlackHole = !!bodyData.blackHole;

        this.position = VectorUtils.temp(0, 0, 0);
        this.velocity = VectorUtils.temp(0, 0, 0);
        this.force = VectorUtils.temp(0, 0, 0);
        this.acceleration = VectorUtils.temp(0, 0, 0);

        this.initialPosition = VectorUtils.temp(0, 0, 0);
        this.initialVelocity = VectorUtils.temp(0, 0, 0);

        this.orbitTrail = null;

        this.isShaderMaterial = material && typeof material.updateTime === 'function';

        this.rotationPeriod = rotationPeriod;
        this.axialTilt = axialTilt;
        this.rotationOffset = rotationOffset;
        this.tidallyLocked = tidallyLocked;
        this.tidalLockTarget = bodyData.tidalLockTarget || null;
        this.parentBody = parentBody;
        this.rotationSpeed = BodyPhysics.calculateRotationSpeed(rotationPeriod);

        this.spinAngle = this.rotationOffset;
        this.spinRate = null;
        this.spinTime = null;
        this.spinEquilibrium = 0;

        this.children = [];
        this.orbit = null;
        this.bodyData = bodyData;

        this.geometry = BodyRenderer.createGeometry(this.radius);

        this.mesh = BodyRenderer.createMesh(this.geometry, this.material);
        BodyRenderer.registerDetailMesh(this.mesh, this.radius);

        if (this.rotationOffset !== 0) {
            this.mesh.rotation.y = this.rotationOffset;
        }

        this.eclipticAxialTilt = (this.axialTilt || 0) +
            (this.equatorialOrbit && parentBody?.axialTilt ? parentBody.axialTilt : 0);

        this.tiltContainer = new THREE.Group();
        if (this.eclipticAxialTilt !== 0) {
            this.tiltContainer.rotation.z = this.eclipticAxialTilt * Math.PI / 180;
        }

        this.tiltContainer.add(this.mesh);

        this.pinpointMesh = BodyRenderer.createPinpointLight(this.material, this.name);

        this.tiltContainer.add(this.pinpointMesh);

        this.group = BodyRenderer.createGroup(this);
        this.group.add(this.tiltContainer);

        Body.setMarkerColor(this, bodyData);

        if (marker) {
            this.marker = new Marker(this);
        }

        if (this.emittedLight) {
            this.emittedLight.position.copy(this.mesh.position)
            this.group.add(this.emittedLight);
        }

        this.rings = null;
        if (rings) {
            this.rings = BodyRenderer.createRings(rings, this.radius, Body.preloadedTextures, this.name);
            this.tiltContainer.add(this.rings);
        }

        this.clouds = null;
        if (clouds) {
            this.clouds = BodyRenderer.createClouds(clouds, this.radius, this.name);
            this.tiltContainer.add(this.clouds);
        }

        this.atmosphere = null;
        if (atmosphere) {
            this.atmosphere = BodyRenderer.createAtmosphere(atmosphere, this.radius);
            this.group.add(this.atmosphere);
        }

        if (bodyData.star) {
            StarEffects.addStarEffects(this, bodyData, radius);
        }

        if (bodyData.blackHole) {
            BlackHoleEffects.addBlackHoleEffects(this, bodyData, radius);
        }

        SceneManager.scene.add(this.group);

        if (this.isStar) {
            SceneManager.registerStar(this.group);
            log.info('Body', `Auto-registered ${this.name} for bloom effects`);
        }

        if (this.isBlackHole) {
            SceneManager.registerBlackHole(this);
            log.info('Body', `Auto-registered ${this.name} for gravitational lensing`);
        }

        this.createOrbit();

        this.createChildren();

        this.initializeOrbitTrail();
    }

    /**
     * Creates the body's orbit and registers it for rendering.
     *
     * A body with a parent and a semi-major axis gets a real {@link Orbit}. The
     * root body has nothing to orbit, so it gets either a {@link BarycentrePath}
     * tracing the system's centre of mass (when `BARYCENTRE.SHOW` is on) or an
     * inert stand-in from {@link Body#createVirtualOrbit}.
     *
     * @returns {void}
     */
    createOrbit() {
        if (!this.parentBody || !this.bodyData.a) {
            const drawsBarycentrePath = !this.parentBody && BARYCENTRE.SHOW;
            this.orbit = drawsBarycentrePath
                ? new BarycentrePath(this, SceneManager.scale)
                : this.createVirtualOrbit();

            if (drawsBarycentrePath) {
                SceneManager.registerOrbit(this.orbit);
            }
            return;
        }

        if (this.group) {
            this.orbit = this.createOrbitFromData();
            SceneManager.registerOrbit(this.orbit);
            log.debug('Body', `Created orbit for ${this.name}`);
        } else {
            log.warn('Body', `Skipped orbit for ${this.name} - invalid body group`);
        }
    }

    /**
     * Recursively constructs the body's satellites.
     *
     * Each child is pushed as a hierarchy node — `{body, orbit, children, data}` —
     * which is the shape the physics modules traverse. A child that fails to build
     * is logged and skipped rather than aborting its siblings.
     *
     * @returns {void}
     */
    createChildren() {
        if (!this.bodyData.children || this.bodyData.children.length === 0) {
            log.debug('Body', `${this.name}: No children to create`);
            return;
        }

        this.bodyData.children.forEach(childData => {
            try {
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
     * Builds an {@link Orbit} from the body's configured orbital elements.
     *
     * @returns {Orbit} Orbit around {@link Body#parentBody}.
     */
    createOrbitFromData() {
        const sceneScale = SceneManager.scale;
        return new Orbit(
            this,
            this.bodyData.a,
            this.bodyData.e,
            this.bodyData.i,
            this.parentBody,
            this.bodyData.omega || 0,
            this.bodyData.w || 0,
            this.bodyData.M0 || 0,
            sceneScale
        );
    }

    /**
     * Builds an inert stand-in for a body that does not orbit anything.
     *
     * Satisfies the orbit interface with no-ops and a fixed position at the
     * origin, so callers can treat every body's `orbit` uniformly instead of
     * null-checking it on the per-frame path.
     *
     * @returns {Object} An object matching the parts of {@link Orbit} that
     *   callers use.
     */
    createVirtualOrbit() {
        return {
            body: this,
            parentBody: null,
            semiMajorAxis: 0,
            eccentricity: 0,
            orbitalPeriod: 0,
            calculatePosition: () => new THREE.Vector3(0, 0, 0),
            show: () => {},
            hide: () => {},
            getVisibility: () => true,
            orbitLine: null,
            isVisible: true
        };
    }

    /**
     * Selects the body's geometry detail level for the camera's distance.
     *
     * @param {THREE.Camera} camera - Camera to measure against.
     * @returns {void}
     */
    updateLOD(camera) {
        BodyRenderer.updateDetail(this, camera);
    }

    /**
     * Updates the body's axial spin for the current time.
     *
     * @param {number} [simulationTime=0] - Current simulation time.
     * @returns {void}
     */
    updateRotation(simulationTime = 0) {
        BodyPhysics.updateRotation(this, simulationTime);
    }

    /**
     * Updates the spin of this body and every descendant.
     *
     * Used when only rotation needs advancing — while the simulation is paused,
     * for instance — without running a full {@link Body#update}.
     *
     * @param {number} [simulationTime=0] - Current simulation time.
     * @returns {void}
     */
    updateRotationRecursive(simulationTime = 0) {
        this.updateRotation(simulationTime);

        if (this.children && this.children.length > 0) {
            this.children.forEach(childHierarchy => {
                const childBody = childHierarchy.body;
                if (childBody && typeof childBody.updateRotationRecursive === 'function') {
                    childBody.updateRotationRecursive(simulationTime);
                }
            });
        }
    }

    /**
     * Moves the body and syncs its scene group and marker.
     *
     * @param {THREE.Vector3} position - Target position, in scene units.
     * @returns {void}
     */
    updatePosition(position) {
        BodyPhysics.updatePosition(this, position);
    }

    /**
     * Pushes the star's position and colour into every lit shader on the body.
     *
     * The custom shaders compute their own lighting, so the light has to be fed to
     * the surface, cloud, atmosphere and ring materials individually.
     *
     * @param {THREE.Vector3} lightPosition - World position of the light source.
     * @param {THREE.Color} [lightColor] - Light colour; left unchanged if omitted.
     * @returns {void}
     */
    updateLighting(lightPosition, lightColor) {
        if (this.atmosphere && this.atmosphere.userData.shaderMaterial) {
            this.atmosphere.userData.shaderMaterial.updateLighting(lightPosition, this.group.position);
            if (lightColor !== undefined) {
                this.atmosphere.userData.shaderMaterial.setLightColor(lightColor);
            }
        }

        this.updateCloudLighting(lightPosition, lightColor);

        this.updateRingShadowLighting(lightPosition, lightColor);

        this.updateRingLighting(lightPosition, lightColor);
    }

    /**
     * Updates the surface material's lighting, including ring shadow orientation.
     *
     * The tilt container's rotation is passed along so the surface shader can
     * project the ring shadow onto the planet at the correct angle.
     *
     * @param {THREE.Vector3} lightPosition - World position of the light source.
     * @param {THREE.Color} [lightColor] - Light colour; left unchanged if omitted.
     * @returns {void}
     */
    updateRingShadowLighting(lightPosition, lightColor) {
        if (this.material && typeof this.material.updateLighting === 'function') {
            const ringRotation = this.tiltContainer ? this.tiltContainer.rotation : null;
            this.material.updateLighting(lightPosition, this.group.position, ringRotation);

            if (lightColor !== undefined) {
                this.material.setLightColor(lightColor);
            }
        }
    }

    /**
     * Feeds a set of shadow-casting bodies to the surface and cloud shaders.
     *
     * Real shadow maps are impractical at solar-system scale, so eclipses are
     * approximated analytically in the shader from each caster's position and
     * radius. Bodies lacking a position or radius are filtered out, and an empty
     * set clears the shaders' shadow state.
     *
     * @param {Array<Body>} shadowBodies - Candidate shadow casters.
     * @returns {void}
     */
    updateMoonShadows(shadowBodies) {
        const positions = [];
        const radii = [];

        if (shadowBodies && shadowBodies.length > 0) {
            shadowBodies.forEach(body => {
                if (body && body.group && body.group.position && body.radius) {
                    positions.push(body.group.position.clone());
                    radii.push(body.radius);
                }
            });
        }

        if (this.material && typeof this.material.updateMoons === 'function') {
            if (positions.length > 0) {
                this.material.updateMoons(positions, radii, this.group.position);
            } else {
                this.material.clearMoons();
            }
        }

        if (this.clouds && this.clouds.userData.shaderMaterial && typeof this.clouds.userData.shaderMaterial.updateMoons === 'function') {
            if (positions.length > 0) {
                this.clouds.userData.shaderMaterial.updateMoons(positions, radii, this.group.position);
            } else {
                this.clouds.userData.shaderMaterial.clearMoons();
            }
        }
    }

    /**
     * Works out which nearby bodies can shadow this one, and applies them.
     *
     * Only immediate relations are considered — the body's moons and its parent —
     * since anything further away cannot produce a visible eclipse. Light sources
     * are excluded, as a star does not cast a shadow.
     *
     * @returns {void}
     */
    updateDirectShadows() {
        const shadowCasters = [];

        if (this.children && this.children.length > 0) {
            this.children.forEach(childHierarchy => {
                const childBody = childHierarchy.body;
                if (childBody && !childBody.emittedLight) {
                    shadowCasters.push(childBody);
                }
            });
        }

        if (this.parentBody && !this.parentBody.emittedLight) {
            shadowCasters.push(this.parentBody);
        }

        if (shadowCasters.length > 0) {
            this.updateMoonShadows(shadowCasters);
        } else {
            if (this.material && typeof this.material.clearMoons === 'function') {
                this.material.clearMoons();
            }
            if (this.clouds && this.clouds.userData.shaderMaterial && typeof this.clouds.userData.shaderMaterial.clearMoons === 'function') {
                this.clouds.userData.shaderMaterial.clearMoons();
            }
        }
    }

    /**
     * Runs the body's full per-frame update, then recurses into its children.
     *
     * Covers spin, shadowing, lighting and geometry detail for every body. Stars
     * additionally drive their visual effects here: the sunspot simulation feeds
     * the surface shader and the flare effect, and the corona, rays, flares and
     * glare are each advanced and re-aimed at the camera. Effect timing uses the
     * clock's effects delta rather than simulation time, so the visuals keep a
     * steady pace regardless of the simulation speed multiplier.
     *
     * A black hole's shadow occluder needs resizing rather than re-aiming, since how much of the
     * sky the shadow covers depends on how far out the camera is and a sphere standing in for it
     * has to be shrunk to match; see {@link BlackHoleEffects.updateShadowOccluder}. Its photon ring
     * only needs re-aiming, but its accretion disc needs the camera
     * and the tilt container as well as the clock, because the disc is traced rather than modelled
     * — the billboard it is drawn on has to face the viewer while the gas stays in the body's
     * equatorial plane, so the shader is told about both frames separately. The lensing of
     * everything *behind* the hole is not touched here at all: it is a post-processing pass,
     * driven once per frame from {@link SceneManager#render} after the camera has settled.
     *
     * The hole's own effects are advanced after its moons rather than before, which for a hole with
     * a disc is required and not tidy: the disc is handed the first of them to draw itself, since a
     * body orbiting this close cannot be drawn as a mesh and be right, and hiding the mesh is part
     * of how {@link AccretionDisk#setCompanion} takes it over. Run first, that would happen before
     * the moon's own {@link Body#updateLOD} had run and be undone by it, and the position traced
     * would be a frame stale besides. Every other body is unaffected either way.
     *
     * Note that this method reads `clockManager` as a bare global, which resolves
     * only because `solarSystem.js` assigns `window.clockManager` during startup.
     *
     * @param {number} [simulationTime=0] - Current simulation time.
     * @param {THREE.Vector3} starPosition - World position of the illuminating star.
     * @param {THREE.Color} [starLightColor] - Colour of the star's light.
     * @returns {void}
     */
    update(simulationTime = 0, starPosition, starLightColor) {
        this.updateRotation(simulationTime);
        this.updateDirectShadows();
        this.updateLighting(starPosition, starLightColor);
        this.updateLOD(SceneManager.camera)

        if (typeof this.orbit.updateLOD === 'function') {
            this.orbit.updateLOD(SceneManager.camera.position)
        }

        if (this.isStar) {
            if (!this.sunspotManager) {
                this.sunspotManager = new SunspotManager();
            }

            const effectsDelta = clockManager.getEffectsDeltaTime();
            this.sunspotManager.update(effectsDelta);
            const spotPositions = this.sunspotManager.positions;
            const spotOpacities = this.sunspotManager.opacities;
            const spotRadii = this.sunspotManager.radii;

            if (this.isShaderMaterial && this.material.updateTime) {
                const currentTime = clockManager.getSimulationTime();
                this.material.updateTime(currentTime);
                if (this.material.updateSunspots) {
                    this.material.updateSunspots(spotPositions, spotOpacities, spotRadii);
                }
            }

            if (this.sunFlares && this.sunFlares.updateSunspots) {
                this.sunFlares.updateSunspots(spotPositions, this.sunspotManager.flareActive, spotOpacities, spotRadii);
            }

            if (this.billboard && this.billboard.update) {
                const effectsDeltaTime = clockManager.getEffectsDeltaTime();
                const camera = SceneManager.camera;
                this.billboard.update(effectsDeltaTime, camera);
            }

            if (this.sunRays && this.sunRays.update) {
                const effectsDeltaTime = clockManager.getEffectsDeltaTime();
                const camera = SceneManager.camera;
                const starPosition = this.group.position;
                this.sunRays.update(effectsDeltaTime, camera, starPosition);
            }

            if (this.sunFlares && this.sunFlares.update) {
                const camera = SceneManager.camera;
                const animationSpeed = this.starData?.flares?.animationSpeed || 0.1;
                const currentTime = clockManager.getSimulationTime() * animationSpeed;
                const starMaterialUniforms = this.material ? this.material.uniforms : {};
                this.sunFlares.update(currentTime, camera, starMaterialUniforms);
            }

            if (this.sunGlare && this.sunGlare.update) {
                const effectsDeltaTime = clockManager.getEffectsDeltaTime();
                const camera = SceneManager.camera;
                const starPosition = this.group.position;

                if (!this.sunGlare.mesh.parent) {
                    this.sunGlare.addToScene(SceneManager.scene);
                }

                this.sunGlare.getAllMeshes().forEach(mesh => {
                    mesh.position.copy(starPosition);
                    mesh.visible = true;
                    mesh.lookAt(camera.position);
                });

                if (this.mesh) this.mesh.visible = true;

                this.sunGlare.update(effectsDeltaTime, camera, starPosition);
            }
        }

        if (this.children && this.children.length > 0) {
            this.children.forEach(childHierarchy => {
                const childBody = childHierarchy.body;
                if (childBody && typeof childBody.update === 'function') {
                    childBody.update(simulationTime, starPosition, starLightColor);
                }
            });
        }

        if (this.isBlackHole) {
            BlackHoleEffects.updateShadowOccluder(this, SceneManager.camera);

            if (this.accretionDisk) {
                this.accretionDisk.update(
                    clockManager.getEffectsDeltaTime(), SceneManager.camera, this.tiltContainer,
                    this.children?.[0]?.body ?? null);
            }

            if (this.photonRing) {
                this.photonRing.update(SceneManager.camera);
            }
        }
    }

    /**
     * Updates lighting on every material in the ring system.
     *
     * Rings are a subtree rather than a single mesh, so this traverses to reach
     * each lit material.
     *
     * @param {THREE.Vector3} lightPosition - World position of the light source.
     * @param {THREE.Color} [lightColor] - Light colour; left unchanged if omitted.
     * @returns {void}
     */
    updateRingLighting(lightPosition, lightColor) {
        if (this.rings) {
            this.rings.traverse((child) => {
                if (child.material && typeof child.material.updateLighting === 'function') {
                    child.material.updateLighting(lightPosition, this.group.position);

                    if (lightColor !== undefined) {
                        child.material.setLightColor(lightColor);
                    }
                }
            });
        }
    }

    /**
     * Updates the cloud layer's lighting, including ring shadow orientation.
     *
     * @param {THREE.Vector3} lightPosition - World position of the light source.
     * @param {THREE.Color} [lightColor] - Light colour; left unchanged if omitted.
     * @returns {void}
     */
    updateCloudLighting(lightPosition, lightColor) {
        if (this.clouds && this.clouds.userData.shaderMaterial) {
            const ringRotation = this.tiltContainer ? this.tiltContainer.rotation : null;
            this.clouds.userData.shaderMaterial.updateLighting(lightPosition, this.group.position, ringRotation);

            if (lightColor !== undefined) {
                this.clouds.userData.shaderMaterial.setLightColor(lightColor);
            }
        }
    }

    /**
     * Teleports the body to a new position.
     *
     * @param {THREE.Vector3} newPosition - Target position, in scene units.
     * @returns {void}
     */
    setPosition(newPosition) {
        BodyPhysics.setPosition(this, newPosition);
    }

    /**
     * Replaces the body's velocity.
     *
     * @param {THREE.Vector3} newVelocity - New velocity, in scene units per time unit.
     * @returns {void}
     */
    setVelocity(newVelocity) {
        BodyPhysics.setVelocity(this, newVelocity);
    }

    /**
     * Accumulates a force on the body for the current step.
     *
     * @param {THREE.Vector3} additionalForce - Force to add.
     * @returns {void}
     */
    addForce(additionalForce) {
        BodyPhysics.addForce(this, additionalForce);
    }

    /**
     * Restores the body to its initial physics state and clears its spin state.
     *
     * @returns {void}
     */
    resetPhysics() {
        BodyPhysics.resetPhysics(this);
    }

    /**
     * Returns the body's kinetic energy.
     *
     * @returns {number} Kinetic energy in internal units.
     */
    getKineticEnergy() {
        return BodyPhysics.getKineticEnergy(this);
    }

    /**
     * Returns the body's linear momentum.
     *
     * @returns {THREE.Vector3} A newly allocated momentum vector.
     */
    getMomentum() {
        return BodyPhysics.getMomentum(this);
    }

    /**
     * Returns the body's speed.
     *
     * @returns {number} Velocity magnitude, in scene units per time unit.
     */
    getSpeed() {
        return BodyPhysics.getSpeed(this);
    }

    /**
     * Measures the distance to another body.
     *
     * @param {Body} otherBody - Body to measure against.
     * @returns {number} Separation, in scene units.
     */
    getDistanceTo(otherBody) {
        return BodyPhysics.getDistanceTo(this, otherBody);
    }

    /**
     * Sets the body's starting state and records it for later resets.
     *
     * @param {THREE.Vector3} [initialPosition] - Starting position; the origin by default.
     * @param {THREE.Vector3} [initialVelocity] - Starting velocity; at rest by default.
     * @returns {void}
     */
    setInitialPhysicsConditions(initialPosition = new THREE.Vector3(), initialVelocity = new THREE.Vector3()) {
        BodyPhysics.setInitialPhysicsConditions(this, initialPosition, initialVelocity);
    }

    /**
     * Snapshots the body's physics state as plain data, for debug inspection.
     *
     * @returns {Object} Current mass, position, velocity, force, kinetic energy
     *   and speed.
     */
    getPhysicsState() {
        return BodyPhysics.getPhysicsState(this);
    }

    /**
     * Creates the body's orbit trail and registers it for updates.
     *
     * The trail is tinted from the body's material colour, falling back to its
     * marker colour, so each trail is identifiable. No-ops if one already exists.
     *
     * @returns {void}
     */
    initializeOrbitTrail() {
        if (!this.orbitTrail) {
            const trailColor = new THREE.Color(this.material?.color || this.markerColor || 0xffffff);
            this.orbitTrail = new OrbitTrail(this.name, trailColor);

            SceneManager.registerOrbitTrail(this);

            log.debug('Body', `Initialized orbit trail for ${this.name}`);
        }
    }

    /**
     * Appends the body's current position to its orbit trail.
     *
     * Called by whichever physics mode is active, once the body has been moved.
     *
     * @returns {void}
     */
    updateOrbitTrail() {
        if (this.orbitTrail) {
            this.orbitTrail.addPoint(this.position);
        }
    }

    /**
     * Toggles the orbit trail on or off.
     *
     * @returns {boolean} The trail's new enabled state, or `false` if it has no trail.
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
     * Discards the accumulated trail points.
     *
     * Used after a discontinuity such as a physics mode switch, which would
     * otherwise leave a straight line across the old and new paths.
     *
     * @returns {void}
     */
    clearOrbitTrail() {
        if (this.orbitTrail) {
            this.orbitTrail.clear();
            log.debug('Body', `Cleared orbit trail for ${this.name}`);
        }
    }

    /**
     * Hides the body's orbit trail, keeping its accumulated points.
     *
     * @returns {void}
     */
    hide() {
        if (this.orbitTrail) {
            this.orbitTrail.hide();
        }
    }

    /**
     * Shows the body's orbit trail again.
     *
     * @returns {void}
     */
    show() {
        if (this.orbitTrail) {
            this.orbitTrail.show();
        }
    }

    /**
     * Enables or disables orbit trail accumulation.
     *
     * @param {boolean} enabled - Whether the trail should record and render.
     * @returns {void}
     */
    setOrbitTrailEnabled(enabled) {
        if (this.orbitTrail) {
            this.orbitTrail.setEnabled(enabled);
        }
    }

    /**
     * Releases the body's resources and those of its children.
     *
     * Note that this recurses one level explicitly rather than calling each
     * child's `dispose`, so grandchildren are reached only through their own
     * parent's disposal.
     *
     * @returns {void}
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
     * Applies the configured marker colour to a body.
     *
     * Warns when the colour is missing, since the marker and orbit trail both
     * derive their tint from it.
     *
     * @param {Body} body - Body to set `markerColor` on.
     * @param {{name: string, markerColor?: number|string}} bodyData - Body configuration.
     * @returns {void}
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
