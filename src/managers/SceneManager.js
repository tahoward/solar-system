import * as THREE from "three";
import { InteractionManager } from 'three.interactive';
import { OrbitControls } from 'three/addons';
import { Group } from '@tweenjs/tween.js';
import CameraController, { CAMERA_CONFIG } from '../controllers/CameraController.js';
import MarkerManager from './MarkerManager.js';
import VisibilityManager from './VisibilityManager.js';
import HierarchyManager from './HierarchyManager.js';
import OrbitManager from './OrbitManager.js';
import OrbitTrailManager from './OrbitTrailManager.js';
import BloomManager from '../effects/BloomManager.js';
import SkyboxManager from './SkyboxManager.js';
import { ANIMATION, SCENE } from '../constants.js';
import { log } from '../utils/Logger.js';

class SceneManager {
  constructor() {
    if (SceneManager.instance) {
      return SceneManager.instance;
    }

    this.scale = SCENE.SCALE;
    this.lineMaterials = new Set();

    const aspectRatio = window.innerWidth / window.innerHeight;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(
      CAMERA_CONFIG.FOV,
      aspectRatio,
      CAMERA_CONFIG.NEAR_PLANE_SCALE * this.scale,
      CAMERA_CONFIG.FAR_PLANE_SCALE * this.scale
    );
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: "high-performance"
    });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    this.interactionManager = new InteractionManager(
      this.renderer,
      this.camera,
      this.renderer.domElement
    );

    document.body.appendChild(this.renderer.domElement);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.minDistance = 0.1;
    this.controls.maxDistance = 10000;
    this.controls.enableDamping = true;

    this.tweenGroup = new Group();

    this.cameraController = new CameraController(this.camera, this.controls, this.tweenGroup);

    this.hierarchyManager = new HierarchyManager();

    this.orbitManager = new OrbitManager(this.hierarchyManager);

    this.markerManager = new MarkerManager(this.hierarchyManager);

    this.visibilityManager = new VisibilityManager(this.hierarchyManager);

    this.orbitTrailManager = new OrbitTrailManager(this.hierarchyManager);

    this.bloomManager = new BloomManager(this.scene, this.camera, this.renderer);

    this.skyboxManager = new SkyboxManager();

    this.inputController = null;

    window.addEventListener('resize', () => {
      this.#onWindowResize();
    }, false);

    this.#onWindowResize()
    SceneManager.instance = this;
    return this;
  }

  #onWindowResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);

    const resolution = new THREE.Vector2(window.innerWidth, window.innerHeight);
    this.lineMaterials.forEach(material => {
      if (material && material.resolution) {
        material.resolution.copy(resolution);
      }
    });

    if (this.bloomManager) {
      this.bloomManager.handleResize(window.innerWidth, window.innerHeight);
    }
  }

  render() {
     if (this.bloomManager) {
       this.bloomManager.updateBloomIntensity(this.camera.position);
       this.bloomManager.render();
     } else {
       this.renderer.render(this.scene, this.camera);
     }
  }

  setTargetSmooth(group, duration = ANIMATION.DEFAULT_TRANSITION_DURATION) {
    this.cameraController.setTargetSmooth(group, duration);
  }

  registerLineMaterial(material) {
    this.lineMaterials.add(material);
  }

  unregisterLineMaterial(material) {
    this.lineMaterials.delete(material);
  }

  getTargetableBodies(orbits) {
    const bodies = [];
    orbits.forEach(orbit => {
      bodies.push({name: orbit.body.name, body: orbit.body});
    });
    return bodies;
  }

  setTargetByName(bodyName, orbits, smooth = true) {
    return this.cameraController.setTargetByName(bodyName, orbits, smooth);
  }

  updateAnimations() {
    this.tweenGroup.update();
  }

  updateCamera() {
    this.updateAnimations();
    this.cameraController.updateFollowing();
    this.controls.update();
  }

  setMarkerSizeMultiplier(multiplier) {
    this.markerManager.setMarkerSizeMultiplier(multiplier);
  }

  getMarkerSizeMultiplier() {
    return this.markerManager.getMarkerSizeMultiplier();
  }

  hideAllMarkers() {
    this.visibilityManager.hideAllMarkers();
  }

  showAllMarkers() {
    this.visibilityManager.showAllMarkers();
  }

  toggleAllMarkers(currentSelectedBody = null) {
    return this.visibilityManager.toggleAllMarkers(currentSelectedBody);
  }

  areMarkersVisible() {
    return this.visibilityManager.areMarkersVisible();
  }

  hideAllOrbits() {
    this.visibilityManager.hideAllOrbits();
  }

  showAllOrbits() {
    this.visibilityManager.showAllOrbits();
  }

  toggleAllOrbits(currentSelectedBody = null) {
    return this.visibilityManager.toggleAllOrbits(currentSelectedBody);
  }

  areOrbitsVisible() {
    return this.visibilityManager.areOrbitsVisible();
  }

  areOrbitTrailsVisible() {
    return this.visibilityManager.areOrbitTrailsVisible();
  }

  hideAllOrbitTrails() {
    this.visibilityManager.hideAllOrbitTrails();
  }

  showAllOrbitTrails() {
    this.visibilityManager.showAllOrbitTrails();
  }

  toggleOrbitTrails(currentSelectedBody = null) {
    return this.visibilityManager.toggleOrbitTrails(currentSelectedBody);
  }

  clearAllOrbitTrails() {
    this.visibilityManager.clearAllOrbitTrails();
  }

  registerMarker(marker) {
    this.markerManager.registerMarker(marker);
    this.visibilityManager.registerMarker(marker);
  }

  registerOrbit(orbit) {
    this.orbitManager.registerOrbit(orbit);
    this.visibilityManager.registerOrbit(orbit);
  }

  registerOrbitTrail(body) {
    this.orbitTrailManager.registerOrbitTrail(body);
    this.visibilityManager.registerOrbitTrail(body);
  }

  reparentBody(body, parentBody) {
    if (!body?.name || !parentBody?.name) return;
    if (!this.hierarchyManager.setParent(body.name, parentBody.name)) return;

    const selectedBody = this.hierarchyManager.getSelectedBody();
    if (selectedBody) {
      this.visibilityManager.updateVisibility(selectedBody);
    }
  }

  unregisterMarker(marker) {
    this.markerManager.unregisterMarker(marker);
    this.visibilityManager.unregisterMarker(marker);
  }

  unregisterOrbit(orbit) {
    this.orbitManager.unregisterOrbit(orbit);
    this.visibilityManager.unregisterOrbit(orbit);
  }

  unregisterOrbitTrail(body) {
    this.orbitTrailManager.unregisterOrbitTrail?.(body);
    this.visibilityManager.unregisterOrbitTrail(body);
  }

  registerStar(starObject) {
    if (this.bloomManager) {
      this.bloomManager.registerStar(starObject);
    }
  }

  unregisterStar(starObject) {
    if (this.bloomManager) {
      this.bloomManager.unregisterStar(starObject);
    }
  }

  onMarkerSelected(selectedMarker) {
    this.markerManager.onMarkerSelected(selectedMarker);
  }

  onBodySelected(body) {
    this.markerManager.onBodySelected(body);
  }

  registerHierarchy(hierarchy) {
    this.hierarchyManager.registerHierarchy(hierarchy);
    this.markerManager.registerHierarchy(hierarchy);
    this.orbitManager.setHierarchy(hierarchy);

    this.orbitTrailManager.initializeHierarchy(hierarchy);

    this.orbitManager.initializePhysics(this.scale);
  }

  toggleBloom() {
    if (this.bloomManager) {
      return this.bloomManager.toggleBloom();
    }
    return false;
  }

  enableBloom() {
    if (this.bloomManager) {
      this.bloomManager.enableBloom();
    }
  }

  disableBloom() {
    if (this.bloomManager) {
      this.bloomManager.disableBloom();
    }
  }

  isBloomEnabled() {
    if (this.bloomManager) {
      return this.bloomManager.isBloomEnabled();
    }
    return false;
  }

  async createSkybox(imageUrl) {
    try {
      return await this.skyboxManager.createSkybox(this.scene, this.renderer, imageUrl);
    } catch (error) {
      log.error('SceneManager', '❌ Failed to create skybox:', error);
      throw error;
    }
  }
}

const sceneManagerInstance = new SceneManager();

window.SceneManager = sceneManagerInstance;

export default sceneManagerInstance;

