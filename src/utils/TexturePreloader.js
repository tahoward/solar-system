import * as THREE from 'three';
import { CELESTIAL_DATA } from '../constants.js';
import { TEXTURES } from '../assets/index.js';
import logger from './Logger.js';

export class TexturePreloader {
    constructor() {
        this.textureLoader = new THREE.TextureLoader();
        this.loadedTextures = new Map();
        this.totalTextures = 0;
        this.loadedCount = 0;
        this.onProgress = null;
        this.onComplete = null;
        this.onError = null;
    }

    setCallbacks(onProgress, onComplete, onError) {
        this.onProgress = onProgress;
        this.onComplete = onComplete;
        this.onError = onError;
    }

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

    reset() {
        this.loadedTextures.clear();
        this.loadedCount = 0;
        this.totalTextures = 0;
    }
}

export default TexturePreloader;