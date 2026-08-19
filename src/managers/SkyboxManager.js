import * as THREE from 'three';
import { SKYBOX } from '../constants.js';
import MathUtils from '../utils/MathUtils.js';
import { log } from '../utils/Logger.js';

/**
 * Owns the starfield backdrop behind the solar system.
 *
 * The source artwork is a single equirectangular image, which is converted to a
 * cube map on the GPU before use — sampling an equirect map directly leaves
 * visible distortion and a pinch at the poles. Brightness is applied through the
 * scene's `backgroundIntensity` rather than by touching the texture, so it can be
 * adjusted freely at no cost.
 */
class SkyboxManager {
  /**
   * Creates the manager with no skybox loaded.
   */
  constructor() {
    this.scene = null;
    this.renderer = null;
    this.cubeRenderTarget = null;
    this.texture = null;
    this.brightness = SKYBOX.DEFAULT_BRIGHTNESS;
    this.visible = true;
    this.textureLoader = new THREE.TextureLoader();
    this.preloadedTextures = null;
  }

  /**
   * Supplies the texture cache filled during the loading screen.
   *
   * The skybox image is large, so it is fetched up front along with the body
   * textures; this lets {@link SkyboxManager#createSkybox} take it from the cache
   * instead of loading it a second time.
   *
   * @param {Map<string, THREE.Texture>} textures - Preloaded textures by URL.
   * @returns {void}
   */
  setPreloadedTextures(textures) {
    this.preloadedTextures = textures;
  }

  /**
   * Builds the cube-map skybox and applies it as the scene background.
   *
   * Falls back to loading the image directly if it is not in the preload cache,
   * which is slower but keeps the skybox working. Any previous cube texture is
   * disposed first.
   *
   * @async
   * @param {THREE.Scene} scene - Scene to apply the background to.
   * @param {THREE.WebGLRenderer} renderer - Renderer used for the cube conversion.
   * @param {string} imageUrl - URL of the equirectangular source image.
   * @throws {Error} If the texture cannot be loaded or converted.
   * @returns {Promise<THREE.CubeTexture>} The cube texture now in use.
   */
  async createSkybox(scene, renderer, imageUrl) {
    try {
      log.info('SkyboxManager', '🌌 Loading skybox texture from:', imageUrl);

      let texture;
      if (this.preloadedTextures && this.preloadedTextures.has(imageUrl)) {
        texture = this.preloadedTextures.get(imageUrl);
        log.info('SkyboxManager', '🌌 Using preloaded skybox texture');
      } else {
        log.warn('SkyboxManager', '🌌 Preloaded skybox texture not found, loading directly...');
        texture = await this.loadTexture(imageUrl);
      }

      this.scene = scene;
      this.renderer = renderer;

      this.#disposeCubeTexture();
      this.texture = this.#equirectToCubeTexture(texture);

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
   * Renders an equirectangular texture into a cube map.
   *
   * The face size is clamped to the GPU's maximum cube-map size, since exceeding it
   * would fail outright on lower-end hardware.
   *
   * @private
   * @param {THREE.Texture} equirectTexture - Equirectangular source texture.
   * @returns {THREE.CubeTexture} The resulting cube texture.
   */
  #equirectToCubeTexture(equirectTexture) {
    const faceSize = Math.min(SKYBOX.CUBE_FACE_SIZE, this.renderer.capabilities.maxCubemapSize);
    if (faceSize < SKYBOX.CUBE_FACE_SIZE) {
      log.warn('SkyboxManager', `🌌 Clamping cube face size to GPU limit: ${faceSize}px`);
    }

    this.cubeRenderTarget = new THREE.WebGLCubeRenderTarget(faceSize, {
      anisotropy: equirectTexture.anisotropy
    });
    this.cubeRenderTarget.fromEquirectangularTexture(this.renderer, equirectTexture);

    log.info('SkyboxManager', `🌌 Converted equirect source to ${faceSize}px cube faces`);
    return this.cubeRenderTarget.texture;
  }

  /**
   * Releases the cube render target and drops the texture reference.
   *
   * @private
   * @returns {void}
   */
  #disposeCubeTexture() {
    if (this.cubeRenderTarget) {
      this.cubeRenderTarget.dispose();
      this.cubeRenderTarget = null;
    }
    this.texture = null;
  }

  /**
   * Loads an equirectangular texture, reporting progress as it goes.
   *
   * Wraps `TextureLoader` in a promise so it can be awaited. Repeat wrapping is set
   * because the image wraps horizontally around the sky.
   *
   * @param {string} url - Texture URL.
   * @throws {Error} If the image cannot be loaded.
   * @returns {Promise<THREE.Texture>} The loaded texture.
   */
  loadTexture(url) {
    return new Promise((resolve, reject) => {
      this.textureLoader.load(
        url,
        (texture) => {
          texture.wrapS = THREE.RepeatWrapping;
          texture.wrapT = THREE.RepeatWrapping;
          resolve(texture);
        },
        (progress) => {
          const percent = Math.round((progress.loaded / progress.total) * 100);
          log.info('SkyboxManager', `🌌 Loading skybox: ${percent}%`);
        },
        (error) => {
          log.error('SkyboxManager', '❌ Error loading skybox texture:', error);
          reject(error);
        }
      );
    });
  }

  /**
   * Clears the background and frees the skybox's GPU memory.
   *
   * @param {THREE.Scene} [scene=this.scene] - Scene to clear the background from.
   * @returns {void}
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
   * Shows or hides the starfield.
   *
   * The texture is kept either way, so this is reversible at no cost; the
   * preference is also remembered for a skybox created later.
   *
   * @param {boolean} visible - Whether the starfield should be drawn.
   * @returns {void}
   */
  setVisible(visible) {
    this.visible = visible;

    if (this.hasSkybox()) {
      this.scene.background = visible ? this.texture : null;
      log.info('SkyboxManager', `🌌 Skybox visibility set to: ${visible}`);
    }
  }

  /**
   * Reports whether a skybox texture is currently loaded.
   *
   * @returns {boolean} `true` if a texture exists, regardless of visibility.
   */
  hasSkybox() {
    return this.texture !== null;
  }

  /**
   * Sets how brightly the starfield renders.
   *
   * Applied via the scene's background intensity, so it neither reprocesses the
   * texture nor affects the lighting on the bodies.
   *
   * @param {number} brightness - Desired brightness; clamped to the configured range.
   * @returns {void}
   */
  setBrightness(brightness) {
    this.brightness = MathUtils.clamp(brightness, SKYBOX.MIN_BRIGHTNESS, SKYBOX.MAX_BRIGHTNESS);

    if (this.scene) {
      this.scene.backgroundIntensity = this.brightness;
      log.info('SkyboxManager', `🌌 Skybox brightness set to: ${this.brightness.toFixed(2)}`);
    }
  }
}

export default SkyboxManager;
