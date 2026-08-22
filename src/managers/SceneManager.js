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

/**
 * Owns the renderer, camera and scene, and the managers that act on them.
 *
 * Almost every method here is a one-line delegation to one of those managers. That
 * is the point: the rest of the code has a single object to reach for, and does not
 * have to know that showing an orbit is the visibility manager's job while
 * registering one is also the orbit manager's. Where an operation genuinely spans
 * two managers — registering an orbit, reparenting a body — this is the place that
 * calls both, so neither can be forgotten.
 *
 * A singleton, enforced in the constructor and exported as an instance, since there
 * is one canvas and one scene. It is also assigned to `window.SceneManager`, which
 * lets managers that this one constructs reach back to it without an import cycle.
 */
class SceneManager {
  /**
   * Builds the renderer, camera, controls and every manager, and attaches the canvas
   * to the document.
   *
   * The near and far planes are scaled by the scene scale rather than fixed, because
   * the scene spans from a moon's surface to the outer planets and a fixed depth
   * range at that ratio would z-fight badly.
   *
   * The pixel ratio is capped rather than taken as the display reports it, because beyond a point
   * the cost grows with no visible benefit; see {@link SCENE.MAX_PIXEL_RATIO} for where the line is
   * drawn and why.
   *
   * @returns {SceneManager} The existing instance if one has already been created.
   */
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
    // A camera sees only the default layer, and both a black hole's own drawing and the scene's
    // annotation are kept out of it so that the lensing can render the bodies separately from what
    // bends them and from what must not be bent with them; see {@link SCENE.UNLENSED_LAYER} and
    // {@link SCENE.OVERLAY_LAYER}. Enabled here rather than in {@link BloomManager} because this is
    // what makes a hole visible and a marker drawn at all, which cannot be allowed to depend on
    // post-processing.
    this.camera.layers.enable(SCENE.UNLENSED_LAYER);
    this.camera.layers.enable(SCENE.OVERLAY_LAYER);

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: "high-performance"
    });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, SCENE.MAX_PIXEL_RATIO));

    this.interactionManager = new InteractionManager(
      this.renderer,
      this.camera,
      this.renderer.domElement
    );
    // The markers are what anything clicks on, and they are on the annotation layer. A
    // `THREE.Raycaster` tests the default layer only, so without this a marker would be drawn and
    // could not be hit.
    this.interactionManager.raycaster.layers.enable(SCENE.OVERLAY_LAYER);

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

  /**
   * Matches the renderer, camera and line materials to the new window size.
   *
   * The line materials need the resolution explicitly: `LineMaterial` computes
   * screen-space width in the shader and has no way to learn the viewport size on its
   * own, so stale values would leave every orbit line the wrong thickness after a
   * resize.
   *
   * @private
   * @returns {void}
   */
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

  /**
   * Draws one frame, through the bloom pass when it is available.
   *
   * Bloom intensity is set from the camera position first, so the glow falls off with
   * distance from the star instead of blowing out the view when close to it.
   *
   * Lensing is aimed here too, rather than in a body's own update, because where a black hole
   * lands on screen depends on where the camera ended up this frame — and the camera is moved
   * after the bodies are.
   *
   * @returns {void}
   */
  render() {
     if (this.bloomManager) {
       this.bloomManager.updateBloomIntensity(this.camera.position);
       this.bloomManager.updateLensing();
       this.bloomManager.render();
     } else {
       this.renderer.render(this.scene, this.camera);
     }
  }

  /**
   * Moves the camera to a new target with a tweened transition.
   *
   * @param {THREE.Group} group - Group to look at and follow.
   * @param {number} [duration=ANIMATION.DEFAULT_TRANSITION_DURATION] - Transition
   *   length in milliseconds.
   * @returns {void}
   */
  setTargetSmooth(group, duration = ANIMATION.DEFAULT_TRANSITION_DURATION) {
    this.cameraController.setTargetSmooth(group, duration);
  }

  /**
   * Tracks a `LineMaterial` so its resolution is kept current on resize.
   *
   * Every orbit line and trail must register, or it will render at the wrong width
   * once the window changes size.
   *
   * @param {LineMaterial} material - Material to track.
   * @returns {void}
   */
  registerLineMaterial(material) {
    this.lineMaterials.add(material);
  }

  /**
   * Moves an object and everything under it onto the annotation layer.
   *
   * Annotation is anything drawn to say where a body is rather than to show it: orbit lines,
   * trails, markers. It is drawn along straight lines, so a black hole must not bend it — see
   * {@link SCENE.OVERLAY_LAYER} for why, and {@link BodyLensPass#render} for where the layer is
   * drawn. Everything in the subtree is set rather than just the root, because a layer mask in
   * three is per object and is not inherited.
   *
   * @param {THREE.Object3D} object - Root of the subtree to mark.
   * @returns {void}
   */
  markOverlay(object) {
    if (!object) return;
    object.traverse((child) => child.layers.set(SCENE.OVERLAY_LAYER));
  }

  /**
   * Stops tracking a line material, so a disposed one is not held alive.
   *
   * @param {LineMaterial} material - Material to drop.
   * @returns {void}
   */
  unregisterLineMaterial(material) {
    this.lineMaterials.delete(material);
  }

  /**
   * Flattens orbits into a name-and-body list for the navigation UI.
   *
   * @param {Orbit[]} orbits - Orbits to list.
   * @returns {Array<{name: string, body: Body}>} One entry per orbiting body.
   */
  getTargetableBodies(orbits) {
    const bodies = [];
    orbits.forEach(orbit => {
      bodies.push({name: orbit.body.name, body: orbit.body});
    });
    return bodies;
  }

  /**
   * Points the camera at a body found by name.
   *
   * @param {string} bodyName - Name of the body to target.
   * @param {Orbit[]} orbits - Orbits to search.
   * @param {boolean} [smooth=true] - Whether to tween rather than jump.
   * @returns {boolean} `true` if the body was found and targeted.
   */
  setTargetByName(bodyName, orbits, smooth = true) {
    return this.cameraController.setTargetByName(bodyName, orbits, smooth);
  }

  /**
   * Steps the tween group by one frame.
   *
   * @returns {void}
   */
  updateAnimations() {
    this.tweenGroup.update();
  }

  /**
   * Advances the camera for this frame.
   *
   * Order matters: tweens are stepped, then the follow offset is re-applied to the
   * moved body, and only then are the controls updated so damping acts on the final
   * position.
   *
   * The camera's matrices are then brought up to date, which is not merely tidiness.
   * `matrixWorld` and `matrixWorldInverse` are refreshed nowhere but inside the render
   * call — and only there because this camera has no parent — so anything between here
   * and the render that projects a world position through the camera gets the position
   * it had last frame. That is a lag proportional to how fast the view is turning:
   * {@link BlackHoleLensPass} aims by projection, and at a brisk drag the shadow's mask
   * lands tens of pixels from the shadow, which reads as a black hole sliding out of its
   * own photon ring. Doing it here rather than in the pass keeps one place where the
   * camera is finished for the frame, and it is the work the renderer would do anyway.
   *
   * @returns {void}
   */
  updateCamera() {
    this.updateAnimations();
    this.cameraController.updateFollowing();
    this.controls.update();

    this.camera.updateMatrixWorld();
  }

  /**
   * Sets the global marker scale.
   *
   * @param {number} multiplier - Size multiplier.
   * @returns {void}
   */
  setMarkerSizeMultiplier(multiplier) {
    this.markerManager.setMarkerSizeMultiplier(multiplier);
  }

  /**
   * Returns the global marker scale.
   *
   * @returns {number} The current multiplier.
   */
  getMarkerSizeMultiplier() {
    return this.markerManager.getMarkerSizeMultiplier();
  }

  /**
   * Hides every marker.
   *
   * @returns {void}
   */
  hideAllMarkers() {
    this.visibilityManager.hideAllMarkers();
  }

  /**
   * Shows every marker.
   *
   * @returns {void}
   */
  showAllMarkers() {
    this.visibilityManager.showAllMarkers();
  }

  /**
   * Flips the global marker switch.
   *
   * @param {Body|null} [currentSelectedBody=null] - Selected body, so per-selection
   *   visibility can be restored.
   * @returns {boolean} `true` if markers are now enabled.
   */
  toggleAllMarkers(currentSelectedBody = null) {
    return this.visibilityManager.toggleAllMarkers(currentSelectedBody);
  }

  /**
   * Reports the global marker switch.
   *
   * @returns {boolean} `true` if markers are enabled.
   */
  areMarkersVisible() {
    return this.visibilityManager.areMarkersVisible();
  }

  /**
   * Hides every orbit line.
   *
   * @returns {void}
   */
  hideAllOrbits() {
    this.visibilityManager.hideAllOrbits();
  }

  /**
   * Shows every orbit line.
   *
   * @returns {void}
   */
  showAllOrbits() {
    this.visibilityManager.showAllOrbits();
  }

  /**
   * Flips the global orbit switch.
   *
   * @param {Body|null} [currentSelectedBody=null] - Selected body, so per-selection
   *   visibility can be restored.
   * @returns {boolean} `true` if orbits are now enabled.
   */
  toggleAllOrbits(currentSelectedBody = null) {
    return this.visibilityManager.toggleAllOrbits(currentSelectedBody);
  }

  /**
   * Reports the global orbit switch.
   *
   * @returns {boolean} `true` if orbits are enabled.
   */
  areOrbitsVisible() {
    return this.visibilityManager.areOrbitsVisible();
  }

  /**
   * Reports the global trail switch.
   *
   * @returns {boolean} `true` if trails are enabled.
   */
  areOrbitTrailsVisible() {
    return this.visibilityManager.areOrbitTrailsVisible();
  }

  /**
   * Hides every trail.
   *
   * @returns {void}
   */
  hideAllOrbitTrails() {
    this.visibilityManager.hideAllOrbitTrails();
  }

  /**
   * Shows every trail.
   *
   * @returns {void}
   */
  showAllOrbitTrails() {
    this.visibilityManager.showAllOrbitTrails();
  }

  /**
   * Flips the global trail switch, stopping or resuming recording with it.
   *
   * @param {Body|null} [currentSelectedBody=null] - Selected body, so per-selection
   *   visibility can be restored.
   * @returns {boolean} `true` if trails are now enabled.
   */
  toggleOrbitTrails(currentSelectedBody = null) {
    return this.visibilityManager.toggleOrbitTrails(currentSelectedBody);
  }

  /**
   * Discards every trail's recorded history.
   *
   * @returns {void}
   */
  clearAllOrbitTrails() {
    this.visibilityManager.clearAllOrbitTrails();
  }

  /**
   * Registers a marker with both the marker and visibility managers.
   *
   * Registering with only one leaves a marker that either cannot be sized or cannot
   * be hidden, so both are done here.
   *
   * @param {Marker} marker - Marker to register.
   * @returns {void}
   */
  registerMarker(marker) {
    this.markerManager.registerMarker(marker);
    this.visibilityManager.registerMarker(marker);
  }

  /**
   * Registers an orbit for both position updates and visibility control.
   *
   * @param {Orbit} orbit - Orbit to register.
   * @returns {void}
   */
  registerOrbit(orbit) {
    this.orbitManager.registerOrbit(orbit);
    this.visibilityManager.registerOrbit(orbit);
  }

  /**
   * Registers a body's trail for both bulk control and visibility control.
   *
   * @param {Body} body - Body whose trail should be registered.
   * @returns {void}
   */
  registerOrbitTrail(body) {
    this.orbitTrailManager.registerOrbitTrail(body);
    this.visibilityManager.registerOrbitTrail(body);
  }

  /**
   * Moves a body under a new parent and refreshes what is on screen.
   *
   * Visibility has to be recomputed, since which orbits and markers are shown depends
   * on the relationships that have just changed. It is only refreshed if the
   * reparenting actually took effect, so a rejected request does not cause pointless
   * work.
   *
   * @param {Body} body - Body to move.
   * @param {Body} parentBody - Its new parent.
   * @returns {void}
   */
  reparentBody(body, parentBody) {
    if (!body?.name || !parentBody?.name) return;
    if (!this.hierarchyManager.setParent(body.name, parentBody.name)) return;

    const selectedBody = this.hierarchyManager.getSelectedBody();
    if (selectedBody) {
      this.visibilityManager.updateVisibility(selectedBody);
    }
  }

  /**
   * Removes a marker from both registries.
   *
   * @param {Marker} marker - Marker to unregister.
   * @returns {void}
   */
  unregisterMarker(marker) {
    this.markerManager.unregisterMarker(marker);
    this.visibilityManager.unregisterMarker(marker);
  }

  /**
   * Removes an orbit from both registries.
   *
   * @param {Orbit} orbit - Orbit to unregister.
   * @returns {void}
   */
  unregisterOrbit(orbit) {
    this.orbitManager.unregisterOrbit(orbit);
    this.visibilityManager.unregisterOrbit(orbit);
  }

  /**
   * Removes a body's trail from both registries.
   *
   * @param {Body} body - Body whose trail should be unregistered.
   * @returns {void}
   */
  unregisterOrbitTrail(body) {
    this.orbitTrailManager.unregisterOrbitTrail?.(body);
    this.visibilityManager.unregisterOrbitTrail(body);
  }

  /**
   * Marks an object as a star so bloom is applied to it.
   *
   * @param {THREE.Object3D} starObject - Object that should glow.
   * @returns {void}
   */
  registerStar(starObject) {
    if (this.bloomManager) {
      this.bloomManager.registerStar(starObject);
    }
  }

  /**
   * Stops applying bloom to an object.
   *
   * @param {THREE.Object3D} starObject - Object to drop.
   * @returns {void}
   */
  unregisterStar(starObject) {
    if (this.bloomManager) {
      this.bloomManager.unregisterStar(starObject);
    }
  }

  /**
   * Marks a body as a black hole so light is bent around it.
   *
   * Handled by the bloom manager because the distortion is a pass in the same composer, not
   * because it has anything to do with bloom.
   *
   * @param {Body} body - The hole's body.
   * @returns {void}
   */
  registerBlackHole(body) {
    if (this.bloomManager) {
      this.bloomManager.registerBlackHole(body);
    }
  }

  /**
   * Stops bending light around a body.
   *
   * @param {Body} body - The hole's body.
   * @returns {void}
   */
  unregisterBlackHole(body) {
    if (this.bloomManager) {
      this.bloomManager.unregisterBlackHole(body);
    }
  }

  /**
   * Handles a marker being clicked.
   *
   * @param {Marker} selectedMarker - Marker that was selected.
   * @returns {void}
   */
  onMarkerSelected(selectedMarker) {
    this.markerManager.onMarkerSelected(selectedMarker);
  }

  /**
   * Handles a body being selected, from a click or from the UI.
   *
   * @param {Body} body - Body that was selected.
   * @returns {void}
   */
  onBodySelected(body) {
    this.markerManager.onBodySelected(body);
  }

  /**
   * Hands a freshly built hierarchy to every manager that needs it.
   *
   * Physics is initialised last, once the hierarchy has been indexed and the trails
   * set up, because seeding the n-body state reads positions and masses from the
   * structure the earlier calls established.
   *
   * @param {Object} hierarchy - Root hierarchy node.
   * @returns {void}
   */
  registerHierarchy(hierarchy) {
    this.hierarchyManager.registerHierarchy(hierarchy);
    this.markerManager.registerHierarchy(hierarchy);
    this.orbitManager.setHierarchy(hierarchy);

    this.orbitTrailManager.initializeHierarchy(hierarchy);

    this.orbitManager.initializePhysics(this.scale);
  }

  /**
   * Flips the bloom effect.
   *
   * @returns {boolean} `true` if bloom is now enabled; `false` if there is no bloom
   *   manager.
   */
  toggleBloom() {
    if (this.bloomManager) {
      return this.bloomManager.toggleBloom();
    }
    return false;
  }

  /**
   * Turns bloom on.
   *
   * @returns {void}
   */
  enableBloom() {
    if (this.bloomManager) {
      this.bloomManager.enableBloom();
    }
  }

  /**
   * Turns bloom off, falling back to a plain render.
   *
   * @returns {void}
   */
  disableBloom() {
    if (this.bloomManager) {
      this.bloomManager.disableBloom();
    }
  }

  /**
   * Reports whether bloom is on.
   *
   * @returns {boolean} `true` if bloom is enabled.
   */
  isBloomEnabled() {
    if (this.bloomManager) {
      return this.bloomManager.isBloomEnabled();
    }
    return false;
  }

  /**
   * Loads a panorama and installs it as the scene background.
   *
   * The error is logged and rethrown rather than swallowed, so the loading screen can
   * report that startup failed instead of leaving a black sky with no explanation.
   *
   * @async
   * @param {string} imageUrl - URL of the equirectangular image.
   * @returns {Promise<THREE.CubeTexture>} The cube texture that was installed.
   * @throws {Error} If the image cannot be loaded or converted.
   */
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

