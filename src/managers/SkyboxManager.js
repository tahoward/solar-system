import * as THREE from 'three';
import { SKYBOX } from '../constants.js';
import MathUtils from '../utils/MathUtils.js';
import { log } from '../utils/Logger.js';

class SkyboxManager {
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

  setPreloadedTextures(textures) {
    this.preloadedTextures = textures;
  }

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

  #disposeCubeTexture() {
    if (this.cubeRenderTarget) {
      this.cubeRenderTarget.dispose();
      this.cubeRenderTarget = null;
    }
    this.texture = null;
  }

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

  async updateTexture(imageUrl) {
    if (!this.hasSkybox()) {
      log.warn('SkyboxManager', '⚠️ No skybox exists to update');
      return;
    }

    try {
      log.info('SkyboxManager', '🌌 Updating skybox texture to:', imageUrl);
      const texture = await this.loadTexture(imageUrl);

      this.#disposeCubeTexture();
      this.texture = this.#equirectToCubeTexture(texture);

      texture.dispose();

      if (this.visible) {
        this.scene.background = this.texture;
      }

      log.info('SkyboxManager', '🌌 Skybox texture updated successfully');
    } catch (error) {
      log.error('SkyboxManager', '❌ Failed to update skybox texture:', error);
    }
  }

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

  setVisible(visible) {
    this.visible = visible;

    if (this.hasSkybox()) {
      this.scene.background = visible ? this.texture : null;
      log.info('SkyboxManager', `🌌 Skybox visibility set to: ${visible}`);
    }
  }

  getSkybox() {
    return this.texture;
  }

  hasSkybox() {
    return this.texture !== null;
  }

  setBrightness(brightness) {
    this.brightness = MathUtils.clamp(brightness, SKYBOX.MIN_BRIGHTNESS, SKYBOX.MAX_BRIGHTNESS);

    if (this.scene) {
      this.scene.backgroundIntensity = this.brightness;
      log.info('SkyboxManager', `🌌 Skybox brightness set to: ${this.brightness.toFixed(2)}`);
    }
  }

  getBrightness() {
    return this.scene ? this.scene.backgroundIntensity : this.brightness;
  }

  brighten(amount = 0.1) {
    this.setBrightness(this.getBrightness() + amount);
  }

  dim(amount = 0.1) {
    this.setBrightness(this.getBrightness() - amount);
  }
}

export default SkyboxManager;
