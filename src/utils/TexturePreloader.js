import * as THREE from 'three';
import { CELESTIAL_DATA } from '../constants.js';
import { TEXTURES } from '../assets/index.js';
import logger from './Logger.js';

/**
 * Loads every texture the scene needs up front, reporting progress.
 *
 * Building the solar system lazily would pop textures in one by one over the
 * first few seconds, so the loading screen waits on this instead. Texture URLs
 * are discovered by walking {@link CELESTIAL_DATA} rather than being listed
 * separately, so adding a body needs no change here.
 */
export class TexturePreloader {
    /**
     * Creates an empty preloader with no callbacks attached.
     */
    constructor() {
        this.textureLoader = new THREE.TextureLoader();
        this.loadedTextures = new Map();
        this.totalTextures = 0;
        this.loadedCount = 0;
        this.onProgress = null;
        this.onComplete = null;
        this.onError = null;
    }

    /**
     * Registers the lifecycle callbacks, replacing any previously set.
     *
     * @param {?function(number, number, number): void} onProgress - Called after
     *   each texture with the loaded count, total, and percentage.
     * @param {?function(Map<string, THREE.Texture>): void} onComplete - Called
     *   once all textures have loaded.
     * @param {?function(Error): void} onError - Called if any texture fails.
     * @returns {void}
     */
    setCallbacks(onProgress, onComplete, onError) {
        this.onProgress = onProgress;
        this.onComplete = onComplete;
        this.onError = onError;
    }

    /**
     * Collects the full set of texture URLs referenced by the scene.
     *
     * Covers the standalone skybox and ring textures plus everything reachable
     * from the celestial data tree.
     *
     * @returns {Set<string>} Deduplicated texture URLs.
     */
    extractTextureUrls() {
        const textureUrls = new Set();

        if (TEXTURES.nightSky) {
            textureUrls.add(TEXTURES.nightSky);
        }

        if (TEXTURES.saturnRing) {
            textureUrls.add(TEXTURES.saturnRing);
        }

        this.extractTexturesFromBody(CELESTIAL_DATA, textureUrls);

        return textureUrls;
    }

    /**
     * Recursively gathers texture URLs from a body definition and its children.
     *
     * Accepts either a single definition or an array of them, so the celestial
     * data tree can be walked without special-casing its root.
     *
     * @param {Object|Array<Object>} bodyData - Body configuration or array of them.
     * @param {Set<string>} textureUrls - Set that discovered URLs are added to; mutated.
     * @returns {void}
     */
    extractTexturesFromBody(bodyData, textureUrls) {
        if (Array.isArray(bodyData)) {
            bodyData.forEach(body => this.extractTexturesFromBody(body, textureUrls));
            return;
        }

        if (bodyData.surfaceTexture) {
            textureUrls.add(bodyData.surfaceTexture);
        }

        if (bodyData.rings && bodyData.rings.texture) {
            textureUrls.add(bodyData.rings.texture);
        }

        if (bodyData.clouds && bodyData.clouds.texture) {
            textureUrls.add(bodyData.clouds.texture);
        }

        if (bodyData.children && Array.isArray(bodyData.children)) {
            bodyData.children.forEach(child => this.extractTexturesFromBody(child, textureUrls));
        }
    }

    /**
     * Loads every discovered texture concurrently.
     *
     * @async
     * @throws {Error} The first load failure, after invoking the error callback.
     * @returns {Promise<Map<string, THREE.Texture>>} Loaded textures keyed by URL.
     */
    async preloadTextures() {
        const textureUrls = this.extractTextureUrls();
        this.totalTextures = textureUrls.size;
        this.loadedCount = 0;

        logger.info('TexturePreloader', `Starting to preload ${this.totalTextures} textures`);

        const loadingPromises = Array.from(textureUrls).map(url =>
            this.loadSingleTexture(url)
        );

        try {
            await Promise.all(loadingPromises);

            logger.info('TexturePreloader', `Successfully loaded ${this.loadedCount}/${this.totalTextures} textures`);

            if (this.onComplete) {
                this.onComplete(this.loadedTextures);
            }

            return this.loadedTextures;
        } catch (error) {
            logger.error('TexturePreloader', 'Failed to load some textures', error);
            if (this.onError) {
                this.onError(error);
            }
            throw error;
        }
    }

    /**
     * Loads one texture and applies the project's standard sampling settings.
     *
     * Textures are set to repeat wrapping with full mipmapping and high
     * anisotropy, which keeps surfaces sharp at the grazing angles produced by
     * close planet fly-bys. Successful loads are cached and progress is reported.
     *
     * @param {string} url - Texture URL to load.
     * @returns {Promise<THREE.Texture>} Resolves with the configured texture, or
     *   rejects with the load error.
     */
    loadSingleTexture(url) {
        return new Promise((resolve, reject) => {
            const texture = this.textureLoader.load(
                url,
                (loadedTexture) => {
                    loadedTexture.wrapS = THREE.RepeatWrapping;
                    loadedTexture.wrapT = THREE.RepeatWrapping;
                    loadedTexture.generateMipmaps = true;
                    loadedTexture.minFilter = THREE.LinearMipmapLinearFilter;
                    loadedTexture.magFilter = THREE.LinearFilter;
                    loadedTexture.anisotropy = 16;

                    this.loadedTextures.set(url, loadedTexture);
                    this.loadedCount++;

                    const percentage = (this.loadedCount / this.totalTextures) * 100;
                    logger.debug('TexturePreloader', `Loaded ${url} (${this.loadedCount}/${this.totalTextures} - ${percentage.toFixed(1)}%)`);

                    if (this.onProgress) {
                        this.onProgress(this.loadedCount, this.totalTextures, percentage);
                    }

                    resolve(loadedTexture);
                },
                undefined,
                (error) => {
                    logger.error('TexturePreloader', `Failed to load texture ${url}`, error);
                    reject(error);
                }
            );
        });
    }

    /**
     * Clears the cache and counters so the preloader can be reused.
     *
     * Note that the cached textures are dropped, not disposed; ownership passes
     * to whatever consumed the completion callback.
     *
     * @returns {void}
     */
    reset() {
        this.loadedTextures.clear();
        this.loadedCount = 0;
        this.totalTextures = 0;
    }
}

export default TexturePreloader;
