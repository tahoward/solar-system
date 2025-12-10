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

// SceneManager.js
class SceneManager {
  constructor() {
    if (SceneManager.instance) {
      return SceneManager.instance;
    }

    this.scale = SCENE.SCALE;
    this.lineMaterials = new Set(); // Store LineMaterial instances for resolution updates

    const aspectRatio = window.innerWidth / window.innerHeight;

    this.object = null;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(
      CAMERA_CONFIG.FOV,
      aspectRatio,
      CAMERA_CONFIG.NEAR_PLANE_SCALE * this.scale,
      CAMERA_CONFIG.FAR_PLANE_SCALE * this.scale
    );
    // Initial camera position will be set by CameraController.initializeCamera()
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,  // Enable antialiasing for smoother edges
      powerPreference: "high-performance"
    });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); // Limit to 2x for performance

    this.interactionManager = new InteractionManager(
      this.renderer,
      this.camera,
      this.renderer.domElement
    );

    document.body.appendChild(this.renderer.domElement);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    // Set basic default limits (will be properly set by CameraController.initializeCamera())
    this.controls.minDistance = 0.1;
    this.controls.maxDistance = 10000;
    this.controls.enableDamping = true;

    // Create TWEEN group for modern API
    this.tweenGroup = new Group();

    // Initialize camera controller
    this.cameraController = new CameraController(this.camera, this.controls, this.tweenGroup);

    // Initialize hierarchy manager (shared dependency)
    this.hierarchyManager = new HierarchyManager();

    // Initialize orbit manager
    this.orbitManager = new OrbitManager(this.hierarchyManager);

    // Initialize marker manager
    this.markerManager = new MarkerManager(this.hierarchyManager);

    // Initialize visibility manager
    this.visibilityManager = new VisibilityManager(this.hierarchyManager);

    // Initialize orbit trail manager
    this.orbitTrailManager = new OrbitTrailManager(this.hierarchyManager);

    // Initialize bloom manager for star effects
    this.bloomManager = new BloomManager(this.scene, this.camera, this.renderer);

    // Initialize skybox manager
    this.skyboxManager = new SkyboxManager();

    // InputController will be initialized after hierarchy is registered
    this.inputController = null;

    window.addEventListener('resize', () => {
      this.#onWindowResize();
    }, false);

    this.#onWindowResize()
    SceneManager.instance = this;
    return this;
  }

  /**
   * Update shadow light direction to match sun position for casting shadows
   * @param {THREE.Vector3} sunPosition - The sun's position
   * @param {THREE.Vector3} targetPosition - Target position (e.g., Saturn for ring shadows)
   */
  updateShadowLight(sunPosition, targetPosition) {
    if (this.shadowLight) {
      // Calculate direction from target to sun
      const direction = new THREE.Vector3().subVectors(sunPosition, targetPosition).normalize();

      // Position the directional light to cast shadows from sun toward target
      this.shadowLight.position.copy(targetPosition).add(direction.multiplyScalar(-100));
      this.shadowLight.target.position.copy(targetPosition);
      this.shadowLight.target.updateMatrixWorld();
    }
  }

  #onWindowResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);

    // Update LineMaterial resolutions
    const resolution = new THREE.Vector2(window.innerWidth, window.innerHeight);
    this.lineMaterials.forEach(material => {
      if (material && material.resolution) {
        material.resolution.copy(resolution);
      }
    });

    // Update bloom manager resolution
    if (this.bloomManager) {
      this.bloomManager.handleResize(window.innerWidth, window.innerHeight);
    }
  }

  render() {
     // Update camera following behavior
     this.cameraController.updateFollowing();

     // Always update controls
     this.controls.update();

     // Update bloom intensity based on camera distance and render with bloom
     if (this.bloomManager) {
       this.bloomManager.updateBloomIntensity(this.camera.position);
       this.bloomManager.render();
     } else {
       // Fallback to standard rendering if bloom manager not available
       this.renderer.render(this.scene, this.camera);
     }
  }

  /**
   * Smoothly transitions camera to follow a new target
   * @param {THREE.Group} group - The group to target.
   * @param {number} duration - Animation duration in milliseconds (default: 2000)
   */
  setTargetSmooth(group, duration = ANIMATION.DEFAULT_TRANSITION_DURATION) {
    this.cameraController.setTargetSmooth(group, duration);
  }

  /**
   * Register a LineMaterial for automatic resolution updates on window resize
   * @param {LineMaterial} material - The LineMaterial to register
   */
  registerLineMaterial(material) {
    this.lineMaterials.add(material);
  }

  /**
   * Unregister a LineMaterial from automatic resolution updates
   * @param {LineMaterial} material - The LineMaterial to unregister
   */
  unregisterLineMaterial(material) {
    this.lineMaterials.delete(material);
  }

  /**
   * Get all available planets/bodies for targeting from orbits (includes Sun with virtual orbit)
   * @param {Array} orbits - Array of orbit objects containing bodies (including Sun)
   * @returns {Array} Array of targetable bodies with names
   */
  getTargetableBodies(orbits) {
    const bodies = [];
    orbits.forEach(orbit => {
      bodies.push({name: orbit.body.name, body: orbit.body});
    });
    return bodies;
  }

  /**
   * Set target by name
   * @param {string} bodyName - Name of the body to target
   * @param {Array} orbits - Array of orbit objects
   * @param {boolean} smooth - Whether to use smooth transition
   */
  setTargetByName(bodyName, orbits, smooth = true) {
    return this.cameraController.setTargetByName(bodyName, orbits, smooth);
  }

  /**
   * Update TWEEN animations (call this in your animation loop)
   */
  updateAnimations() {
    this.tweenGroup.update();
  }

  /**
   * Set global marker size multiplier
   * @param {number} multiplier - Size multiplier (1.0 = default, 2.0 = double size, etc.)
   */
  setMarkerSizeMultiplier(multiplier) {
    this.markerManager.setMarkerSizeMultiplier(multiplier);
  }

  /**
   * Get global marker size multiplier
   * @returns {number} Current marker size multiplier
   */
  getMarkerSizeMultiplier() {
    return this.markerManager.getMarkerSizeMultiplier();
  }

  /**
   * Hide all markers
   */
  hideAllMarkers() {
    this.visibilityManager.hideAllMarkers();
  }

  /**
   * Show all markers
   */
  showAllMarkers() {
    this.visibilityManager.showAllMarkers();
  }

  /**
   * Toggle visibility of all markers
   * @param {Object} currentSelectedBody - The currently selected body (optional)
   * @returns {boolean} True if markers are now visible, false if hidden
   */
  toggleAllMarkers(currentSelectedBody = null) {
    return this.visibilityManager.toggleAllMarkers(currentSelectedBody);
  }

  /**
   * Check if markers are currently visible
   * @returns {boolean} True if markers are visible, false if hidden
   */
  areMarkersVisible() {
    return this.visibilityManager.areMarkersVisible();
  }

  /**
   * Hide all orbits
   */
  hideAllOrbits() {
    this.visibilityManager.hideAllOrbits();
  }

  /**
   * Show all orbits
   */
  showAllOrbits() {
    this.visibilityManager.showAllOrbits();
  }

  /**
   * Toggle visibility of all orbits
   * @param {Object} currentSelectedBody - The currently selected body (optional)
   * @returns {boolean} True if orbits are now visible, false if hidden
   */
  toggleAllOrbits(currentSelectedBody = null) {
    return this.visibilityManager.toggleAllOrbits(currentSelectedBody);
  }

  /**
   * Check if orbits are currently visible
   * @returns {boolean} True if orbits are visible, false if hidden
   */
  areOrbitsVisible() {
    return this.visibilityManager.areOrbitsVisible();
  }

  /**
   * Check if orbit trails are currently visible/enabled
   * @returns {boolean} True if orbit trails are enabled, false if disabled
   */
  areOrbitTrailsVisible() {
    return this.visibilityManager.areOrbitTrailsVisible();
  }

  /**
   * Hide all orbit trails
   */
  hideAllOrbitTrails() {
    this.visibilityManager.hideAllOrbitTrails();
  }

  /**
   * Show all orbit trails
   */
  showAllOrbitTrails() {
    this.visibilityManager.showAllOrbitTrails();
  }

  /**
   * Toggle orbit trails enabled/disabled for all bodies
   * @param {Object} currentSelectedBody - The currently selected body (optional)
   * @returns {boolean} True if orbit trails are now enabled, false if disabled
   */
  toggleOrbitTrails(currentSelectedBody = null) {
    return this.visibilityManager.toggleOrbitTrails(currentSelectedBody);
  }

  /**
   * Check if orbit trails are currently enabled
   * @returns {boolean} True if orbit trails are enabled, false if disabled
   */
  areOrbitTrailsVisible() {
    return this.visibilityManager.areOrbitTrailsVisible();
  }

  /**
   * Clear all orbit trails
   */
  clearAllOrbitTrails() {
    this.visibilityManager.clearAllOrbitTrails();
  }

  /**
   * Register a marker for fade management
   * @param {Marker} marker - The marker to register
   */
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

  /**
   * Unregister a marker from fade management
   * @param {Marker} marker - The marker to unregister
   */
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

  /**
   * Register a star object for bloom effects
   * @param {THREE.Object3D} starObject - The star object (Body.group or Body.mesh)
   */
  registerStar(starObject) {
    if (this.bloomManager) {
      this.bloomManager.registerStar(starObject);
    }
  }

  /**
   * Unregister a star object from bloom effects
   * @param {THREE.Object3D} starObject - The star object to remove
   */
  unregisterStar(starObject) {
    if (this.bloomManager) {
      this.bloomManager.unregisterStar(starObject);
    }
  }

  /**
   * Handle marker selection - fade out selected marker and restore others
   * @param {Marker} selectedMarker - The marker that was selected
   */
  onMarkerSelected(selectedMarker) {
    this.markerManager.onMarkerSelected(selectedMarker);
  }

  /**
   * Handle body selection (for keyboard or other navigation) - finds marker and fades it
   * @param {Body} body - The body that was selected
   */
  onBodySelected(body) {
    this.markerManager.onBodySelected(body);
  }

  /**
   * Register hierarchy for hierarchical marker visibility and orbit position updates
   * @param {Object} hierarchy - The hierarchy data from SolarSystemFactory
   */
  registerHierarchy(hierarchy) {
    this.hierarchyManager.registerHierarchy(hierarchy);
    this.markerManager.registerHierarchy(hierarchy);
    this.orbitManager.setHierarchy(hierarchy);

    // Initialize orbit trails through OrbitTrailManager
    this.orbitTrailManager.initializeHierarchy(hierarchy);

    // Initialize physics for the hierarchy
    this.orbitManager.initializePhysics(this.scale);
  }

  /**
   * Toggle bloom effect on/off
   * @returns {boolean} True if bloom is now enabled, false if disabled
   */
  toggleBloom() {
    if (this.bloomManager) {
      return this.bloomManager.toggleBloom();
    }
    return false;
  }

  /**
   * Enable bloom effect
   */
  enableBloom() {
    if (this.bloomManager) {
      this.bloomManager.enableBloom();
    }
  }

  /**
   * Disable bloom effect
   */
  disableBloom() {
    if (this.bloomManager) {
      this.bloomManager.disableBloom();
    }
  }

  /**
   * Check if bloom is currently enabled
   * @returns {boolean} True if bloom is enabled
   */
  isBloomEnabled() {
    if (this.bloomManager) {
      return this.bloomManager.isBloomEnabled();
    }
    return false;
  }

  /**
   * Update bloom configuration from constants
   * Call this after changing BLOOM constants to apply changes without reloading
   */
  updateBloomConfigFromConstants() {
    if (this.bloomManager) {
      // Import the current constants
      import('../constants.js').then(constants => {
        this.bloomManager.updateBloomConfig({
          strength: constants.BLOOM.STRENGTH,
          radius: constants.BLOOM.RADIUS,
          threshold: constants.BLOOM.THRESHOLD
        });
        console.log('🌟 SceneManager: Updated bloom configuration from constants:', {
          strength: constants.BLOOM.STRENGTH,
          radius: constants.BLOOM.RADIUS,
          threshold: constants.BLOOM.THRESHOLD
        });
      });
    }
  }

  /**
   * Create and add a skybox to the scene
   * @param {string} imageUrl - URL of the skybox image
   * @returns {Promise<THREE.Mesh>} Promise that resolves to the skybox mesh
   */
  async createSkybox(imageUrl) {
    try {
      return await this.skyboxManager.createSkybox(this.scene, imageUrl);
    } catch (error) {
      console.error('❌ SceneManager: Failed to create skybox:', error);
      throw error;
    }
  }
}

// Export the singleton instance
const sceneManagerInstance = new SceneManager();

// Make it accessible from browser console for debugging
window.SceneManager = sceneManagerInstance;

export default sceneManagerInstance;

