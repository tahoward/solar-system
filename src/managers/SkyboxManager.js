import * as THREE from 'three';
import { SKYBOX } from '../constants.js';
import MathUtils from '../utils/MathUtils.js';
import { log } from '../utils/Logger.js';

/**
 * SkyboxManager - Manages skybox textures and rendering for the solar system
 */
class SkyboxManager {
  constructor() {
    this.skybox = null;
    this.textureLoader = new THREE.TextureLoader();
    this.preloadedTextures = null;
  }

  /**
   * Set preloaded textures for use in skybox creation
   * @param {Map<string, THREE.Texture>} textures - Map of preloaded textures
   */
  setPreloadedTextures(textures) {
    this.preloadedTextures = textures;
  }

  /**
   * Create and add a skybox to the scene using a cube texture
   * @param {THREE.Scene} scene - The Three.js scene to add the skybox to
   * @param {string} imageUrl - URL of the skybox image
   * @returns {Promise<THREE.Mesh>} Promise that resolves to the skybox mesh
   */
  async createSkybox(scene, imageUrl) {
    try {
      log.info('SkyboxManager', '🌌 Loading skybox texture from:', imageUrl);

      // Try to get preloaded texture first
      let texture;
      if (this.preloadedTextures && this.preloadedTextures.has(imageUrl)) {
        texture = this.preloadedTextures.get(imageUrl);
        log.info('SkyboxManager', '🌌 Using preloaded skybox texture');
      } else {
        // Fallback to loading texture (for compatibility)
        log.warn('SkyboxManager', '🌌 Preloaded skybox texture not found, loading directly...');
        texture = await this.loadTexture(imageUrl);
      }

      // Create a large sphere geometry for the skybox
      const geometry = new THREE.SphereGeometry(SKYBOX.RADIUS, SKYBOX.SEGMENTS, SKYBOX.SEGMENTS / 2);

      // Create material with the texture - dimmed for better contrast
      // Ensure no emissive properties to exclude from bloom processing
      const material = new THREE.MeshBasicMaterial({
        map: texture,
        side: THREE.BackSide, // Render inside faces so we see it from within
        fog: false, // Don't let fog affect the skybox
        opacity: SKYBOX.DEFAULT_OPACITY, // Use configurable opacity
        transparent: true, // Enable transparency for opacity control
        toneMapped: false, // Exclude from tone mapping to avoid bloom interference
        depthWrite: false, // Don't write to depth buffer to avoid conflicts with markers
        depthTest: true // But still test depth to ensure proper ordering
      });

      // Create the skybox mesh
      this.skybox = new THREE.Mesh(geometry, material);
      this.skybox.name = 'Skybox';

      // Set specific properties to ensure exclusion from bloom processing
      this.skybox.layers.set(0); // Ensure it's on the default layer
      this.skybox.renderOrder = -1000; // Render skybox very early (behind everything)
      this.skybox.frustumCulled = false; // Don't cull the skybox
      this.skybox.matrixAutoUpdate = false; // Skybox doesn't need matrix updates (static)

      // Mark material properties to exclude from bloom
      material.userData = material.userData || {};
      material.userData.excludeFromBloom = true;

      // Add to scene
      scene.add(this.skybox);

      log.info('SkyboxManager', '🌌 Skybox created and added to scene');
      return this.skybox;

    } catch (error) {
      log.error('SkyboxManager', '❌ Failed to create skybox:', error);
      throw error;
    }
  }

  /**
   * Load texture with promise wrapper
   * @param {string} url - Texture URL
   * @returns {Promise<THREE.Texture>} Promise that resolves to the loaded texture
   */
  loadTexture(url) {
    return new Promise((resolve, reject) => {
      this.textureLoader.load(
        url,
        // onLoad
        (texture) => {
          // Configure texture settings for skybox
          texture.wrapS = THREE.RepeatWrapping;
          texture.wrapT = THREE.RepeatWrapping;
          texture.flipY = false; // Often needed for skybox textures
          resolve(texture);
        },
        // onProgress
        (progress) => {
          const percent = Math.round((progress.loaded / progress.total) * 100);
          log.info('SkyboxManager', `🌌 Loading skybox: ${percent}%`);
        },
        // onError
        (error) => {
          log.error('SkyboxManager', '❌ Error loading skybox texture:', error);
          reject(error);
        }
      );
    });
  }

  /**
   * Update skybox texture
   * @param {string} imageUrl - New texture URL
   */
  async updateTexture(imageUrl) {
    if (!this.skybox) {
      log.warn('SkyboxManager', '⚠️ No skybox exists to update');
      return;
    }

    try {
      log.info('SkyboxManager', '🌌 Updating skybox texture to:', imageUrl);
      const texture = await this.loadTexture(imageUrl);

      // Dispose of old texture to free memory
      if (this.skybox.material.map) {
        this.skybox.material.map.dispose();
      }

      // Apply new texture and maintain depth properties
      this.skybox.material.map = texture;
      this.skybox.material.depthWrite = false; // Ensure depth properties are maintained
      this.skybox.material.depthTest = true;
      this.skybox.material.needsUpdate = true;

      log.info('SkyboxManager', '🌌 Skybox texture updated successfully');
    } catch (error) {
      log.error('SkyboxManager', '❌ Failed to update skybox texture:', error);
    }
  }

  /**
   * Remove skybox from scene
   * @param {THREE.Scene} scene - The scene to remove from
   */
  removeSkybox(scene) {
    if (this.skybox) {
      log.info('SkyboxManager', '🌌 Removing skybox from scene');

      // Dispose of geometry and material to free memory
      this.skybox.geometry.dispose();
      if (this.skybox.material.map) {
        this.skybox.material.map.dispose();
      }
      this.skybox.material.dispose();

      // Remove from scene
      scene.remove(this.skybox);
      this.skybox = null;

      log.info('SkyboxManager', '🌌 Skybox removed and cleaned up');
    }
  }

  /**
   * Set skybox visibility
   * @param {boolean} visible - Whether the skybox should be visible
   */
  setVisible(visible) {
    if (this.skybox) {
      this.skybox.visible = visible;
      log.info('SkyboxManager', `🌌 Skybox visibility set to: ${visible}`);
    }
  }

  /**
   * Get current skybox mesh
   * @returns {THREE.Mesh|null} Current skybox mesh or null if none exists
   */
  getSkybox() {
    return this.skybox;
  }

  /**
   * Check if skybox exists
   * @returns {boolean} True if skybox exists
   */
  hasSkybox() {
    return this.skybox !== null;
  }

  /**
   * Set skybox opacity/brightness
   * @param {number} opacity - Opacity value (0.0 to 1.0)
   */
  setOpacity(opacity) {
    if (this.skybox && this.skybox.material) {
      const clampedOpacity = MathUtils.clamp(opacity, SKYBOX.MIN_OPACITY, SKYBOX.MAX_OPACITY);
      this.skybox.material.opacity = clampedOpacity;
      log.info('SkyboxManager', `🌌 Skybox opacity set to: ${clampedOpacity.toFixed(2)}`);
    }
  }

  /**
   * Get current skybox opacity
   * @returns {number} Current opacity value
   */
  getOpacity() {
    if (this.skybox && this.skybox.material) {
      return this.skybox.material.opacity;
    }
    return 0;
  }

  /**
   * Make skybox brighter
   * @param {number} amount - Amount to increase brightness (default: 0.1)
   */
  brighten(amount = 0.1) {
    if (this.skybox) {
      const currentOpacity = this.getOpacity();
      this.setOpacity(currentOpacity + amount);
    }
  }

  /**
   * Make skybox dimmer
   * @param {number} amount - Amount to decrease brightness (default: 0.1)
   */
  dim(amount = 0.1) {
    if (this.skybox) {
      const currentOpacity = this.getOpacity();
      this.setOpacity(currentOpacity - amount);
    }
  }
}

export default SkyboxManager;