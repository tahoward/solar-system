import * as THREE from 'three';
import { SKYBOX } from '../constants.js';
import MathUtils from '../utils/MathUtils.js';
import { log } from '../utils/Logger.js';

/**
 * SkyboxManager - Manages skybox textures and rendering for the solar system
 *
 * The night sky is a scene background rather than a giant sphere. Three.js draws a scene
 * background with a dedicated box mesh whose vertex shader forces `gl_Position.z =
 * gl_Position.w` and whose material has depthTest and depthWrite off, so the sky sits exactly
 * on the far plane, ignores camera translation entirely, and is drawn before everything else.
 * That makes its distance infinite by construction: there is no parallax to accumulate and
 * nothing for the frustum to clip.
 *
 * The old radius-1,000,000 sphere only survived because of a float32 accident. With
 * camera.far = 1200 the sphere sat ~998,800 units past the far plane and should have been
 * clipped away, but at that magnitude float32 spacing is ~0.0625 while z_clip exceeded w_clip
 * by only ~0.017, so the two quantized to the same value and the sphere landed exactly on the
 * far plane instead of past it. Any change to the scene scale or far plane could have silently
 * deleted the sky.
 *
 * Three.js only takes that spherical background path for a cube texture, so the
 * equirectangular source is converted to a cube map once at load time. A plain equirect
 * texture assigned to scene.background would instead be stretched flat across the screen.
 */
class SkyboxManager {
  constructor() {
    this.scene = null;
    this.renderer = null;
    this.cubeRenderTarget = null; // Owns the cube texture used as scene.background
    this.texture = null;          // The cube texture itself (null when no skybox exists)
    this.brightness = SKYBOX.DEFAULT_BRIGHTNESS;
    this.visible = true;
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
   * Create and apply a skybox to the scene as an infinitely distant background
   * @param {THREE.Scene} scene - The Three.js scene to apply the skybox to
   * @param {THREE.WebGLRenderer} renderer - Renderer used to convert the source to a cube map
   * @param {string} imageUrl - URL of the equirectangular skybox image
   * @returns {Promise<THREE.CubeTexture>} Promise that resolves to the skybox cube texture
   */
  async createSkybox(scene, renderer, imageUrl) {
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

      this.scene = scene;
      this.renderer = renderer;

      // Discard any previous background before replacing it
      this.#disposeCubeTexture();
      this.texture = this.#equirectToCubeTexture(texture);

      // The dimming is a colour multiply, NOT a low opacity. Alpha blending happens in
      // whatever encoding the current render target uses: with bloom on the scene is drawn
      // into the composer's linear float buffer, with bloom off it goes straight to the
      // sRGB canvas. A 0.1 alpha blend therefore produced srgb(0.1 * c) in one path and
      // 0.1 * srgb(c) in the other, leaving the night sky roughly three times darker
      // whenever bloom was switched off. backgroundIntensity is a linear-space multiply
      // applied to the sampled texel, so both paths match.
      scene.backgroundIntensity = this.brightness;
      if (this.visible) {
        scene.background = this.texture;
      }

      log.info('SkyboxManager', '🌌 Skybox created and applied as scene background');
      return this.texture;

    } catch (error) {
      log.error('SkyboxManager', '❌ Failed to create skybox:', error);
      throw error;
    }
  }

  /**
   * Convert an equirectangular texture into a cube texture suitable for scene.background
   * @param {THREE.Texture} equirectTexture - Equirectangular source texture
   * @returns {THREE.CubeTexture} The rendered cube texture
   */
  #equirectToCubeTexture(equirectTexture) {
    // Oversized cube maps are silently unusable on some GPUs, so respect the driver limit
    const faceSize = Math.min(SKYBOX.CUBE_FACE_SIZE, this.renderer.capabilities.maxCubemapSize);
    if (faceSize < SKYBOX.CUBE_FACE_SIZE) {
      log.warn('SkyboxManager', `🌌 Clamping cube face size to GPU limit: ${faceSize}px`);
    }

    // fromEquirectangularTexture copies type, colorSpace, mipmapping and filters from the
    // source, so the cube map is sampled exactly as the sphere's map was.
    this.cubeRenderTarget = new THREE.WebGLCubeRenderTarget(faceSize, {
      anisotropy: equirectTexture.anisotropy
    });
    this.cubeRenderTarget.fromEquirectangularTexture(this.renderer, equirectTexture);

    log.info('SkyboxManager', `🌌 Converted equirect source to ${faceSize}px cube faces`);
    return this.cubeRenderTarget.texture;
  }

  /**
   * Dispose of the cube render target backing the current background
   */
  #disposeCubeTexture() {
    if (this.cubeRenderTarget) {
      this.cubeRenderTarget.dispose();
      this.cubeRenderTarget = null;
    }
    this.texture = null;
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
          // Configure texture settings for skybox. flipY is left at its default: the
          // equirect-to-cube conversion assumes three's standard equirect orientation,
          // which is also what the preloaded textures use.
          texture.wrapS = THREE.RepeatWrapping;
          texture.wrapT = THREE.RepeatWrapping;
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
   * @param {string} imageUrl - New equirectangular texture URL
   */
  async updateTexture(imageUrl) {
    if (!this.hasSkybox()) {
      log.warn('SkyboxManager', '⚠️ No skybox exists to update');
      return;
    }

    try {
      log.info('SkyboxManager', '🌌 Updating skybox texture to:', imageUrl);
      const texture = await this.loadTexture(imageUrl);

      // Free the previous cube map before rendering the replacement
      this.#disposeCubeTexture();
      this.texture = this.#equirectToCubeTexture(texture);

      // The equirect source was loaded solely to build the cube map
      texture.dispose();

      if (this.visible) {
        this.scene.background = this.texture;
      }

      log.info('SkyboxManager', '🌌 Skybox texture updated successfully');
    } catch (error) {
      log.error('SkyboxManager', '❌ Failed to update skybox texture:', error);
    }
  }

  /**
   * Remove skybox from the scene
   * @param {THREE.Scene} [scene] - Unused; retained for call-site compatibility
   */
  removeSkybox(scene = this.scene) {
    if (this.hasSkybox()) {
      log.info('SkyboxManager', '🌌 Removing skybox from scene');

      if (scene) {
        scene.background = null;
      }
      this.#disposeCubeTexture();

      log.info('SkyboxManager', '🌌 Skybox removed and cleaned up');
    }
  }

  /**
   * Set skybox visibility
   * @param {boolean} visible - Whether the skybox should be visible
   */
  setVisible(visible) {
    this.visible = visible;

    if (this.hasSkybox()) {
      this.scene.background = visible ? this.texture : null;
      log.info('SkyboxManager', `🌌 Skybox visibility set to: ${visible}`);
    }
  }

  /**
   * Get the current skybox cube texture
   * @returns {THREE.CubeTexture|null} Current skybox texture or null if none exists
   */
  getSkybox() {
    return this.texture;
  }

  /**
   * Check if skybox exists
   * @returns {boolean} True if skybox exists
   */
  hasSkybox() {
    return this.texture !== null;
  }

  /**
   * Set skybox brightness by scaling the background intensity
   * @param {number} brightness - Brightness value (0.0 to 1.0)
   */
  setBrightness(brightness) {
    this.brightness = MathUtils.clamp(brightness, SKYBOX.MIN_BRIGHTNESS, SKYBOX.MAX_BRIGHTNESS);

    if (this.scene) {
      this.scene.backgroundIntensity = this.brightness;
      log.info('SkyboxManager', `🌌 Skybox brightness set to: ${this.brightness.toFixed(2)}`);
    }
  }

  /**
   * Get current skybox brightness
   * @returns {number} Current brightness value
   */
  getBrightness() {
    return this.scene ? this.scene.backgroundIntensity : this.brightness;
  }

  /**
   * Make skybox brighter
   * @param {number} amount - Amount to increase brightness (default: 0.1)
   */
  brighten(amount = 0.1) {
    this.setBrightness(this.getBrightness() + amount);
  }

  /**
   * Make skybox dimmer
   * @param {number} amount - Amount to decrease brightness (default: 0.1)
   */
  dim(amount = 0.1) {
    this.setBrightness(this.getBrightness() - amount);
  }
}

export default SkyboxManager;
