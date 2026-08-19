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
import BodyRenderer from '../rendering/BodyRenderer.js';
import BodyPhysics from '../physics/BodyPhysics.js';
import ResourceManager from '../utils/ResourceManager.js';
import MaterialFactory from '../factories/MaterialFactory.js';
import SunspotManager from '../effects/SunspotManager.js';
import { BARYCENTRE } from '../constants.js';

class Body {
    static preloadedTextures = null;

    static setPreloadedTextures(textures) {
        this.preloadedTextures = textures;
    }

    constructor(bodyData, parentBody = null) {
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

        SceneManager.scene.add(this.group);

        if (this.isStar) {
            SceneManager.registerStar(this.group);
            log.info('Body', `Auto-registered ${this.name} for bloom effects`);
        }

        this.createOrbit();

        this.createChildren();

        this.initializeOrbitTrail();
    }

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

    updateLOD(camera) {
        BodyRenderer.updateDetail(this, camera);
    }

    updateRotation(simulationTime = 0) {
        BodyPhysics.updateRotation(this, simulationTime);
    }

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

    updatePosition(position) {
        BodyPhysics.updatePosition(this, position);
    }

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

    updateRingShadowLighting(lightPosition, lightColor) {
        if (this.material && typeof this.material.updateLighting === 'function') {
            const ringRotation = this.tiltContainer ? this.tiltContainer.rotation : null;
            this.material.updateLighting(lightPosition, this.group.position, ringRotation);

            if (lightColor !== undefined) {
                this.material.setLightColor(lightColor);
            }
        }
    }

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
    }

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

    updateCloudLighting(lightPosition, lightColor) {
        if (this.clouds && this.clouds.userData.shaderMaterial) {
            const ringRotation = this.tiltContainer ? this.tiltContainer.rotation : null;
            this.clouds.userData.shaderMaterial.updateLighting(lightPosition, this.group.position, ringRotation);

            if (lightColor !== undefined) {
                this.clouds.userData.shaderMaterial.setLightColor(lightColor);
            }
        }
    }

    setPosition(newPosition) {
        BodyPhysics.setPosition(this, newPosition);
    }

    setVelocity(newVelocity) {
        BodyPhysics.setVelocity(this, newVelocity);
    }

    addForce(additionalForce) {
        BodyPhysics.addForce(this, additionalForce);
    }

    resetPhysics() {
        BodyPhysics.resetPhysics(this);
    }

    getKineticEnergy() {
        return BodyPhysics.getKineticEnergy(this);
    }

    getMomentum() {
        return BodyPhysics.getMomentum(this);
    }

    getSpeed() {
        return BodyPhysics.getSpeed(this);
    }

    getDistanceTo(otherBody) {
        return BodyPhysics.getDistanceTo(this, otherBody);
    }

    setInitialPhysicsConditions(initialPosition = new THREE.Vector3(), initialVelocity = new THREE.Vector3()) {
        BodyPhysics.setInitialPhysicsConditions(this, initialPosition, initialVelocity);
    }

    getPhysicsState() {
        return BodyPhysics.getPhysicsState(this);
    }

    initializeOrbitTrail() {
        if (!this.orbitTrail) {
            const trailColor = new THREE.Color(this.material?.color || this.markerColor || 0xffffff);
            this.orbitTrail = new OrbitTrail(this.name, trailColor);

            SceneManager.registerOrbitTrail(this);

            log.debug('Body', `Initialized orbit trail for ${this.name}`);
        }
    }

    updateOrbitTrail() {
        if (this.orbitTrail) {
            this.orbitTrail.addPoint(this.position);
        }
    }

    toggleOrbitTrail() {
        if (this.orbitTrail) {
            const enabled = this.orbitTrail.toggle();
            log.debug('Body', `Orbit trail ${enabled ? 'enabled' : 'disabled'} for ${this.name}`);
            return enabled;
        }
        return false;
    }

    clearOrbitTrail() {
        if (this.orbitTrail) {
            this.orbitTrail.clear();
            log.debug('Body', `Cleared orbit trail for ${this.name}`);
        }
    }

    hide() {
        if (this.orbitTrail) {
            this.orbitTrail.hide();
        }
    }

    show() {
        if (this.orbitTrail) {
            this.orbitTrail.show();
        }
    }

    setOrbitTrailEnabled(enabled) {
        if (this.orbitTrail) {
            this.orbitTrail.setEnabled(enabled);
        }
    }

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

    static setMarkerColor(body, bodyData) {
        if (bodyData.markerColor !== undefined) {
            body.markerColor = new THREE.Color(bodyData.markerColor);
        } else {
            log.warn('Body', `No markerColor specified for ${bodyData.name}`);
        }
    }





}

export default Body;
