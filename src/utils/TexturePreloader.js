import * as THREE from 'three';
import { CELESTIAL_DATA } from '../constants.js';
import { TEXTURES } from '../assets/index.js';

/**
 * Utility class to preload all textures before scene initialization
 */
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

    /**
     * Set callbacks for loading progress
     * @param {Function} onProgress - Called with (loaded, total, percentage)
     * @param {Function} onComplete - Called when all textures are loaded
     * @param {Function} onError - Called when a texture fails to load
     */
    setCallbacks(onProgress, onComplete, onError) {
        this.onProgress = onProgress;
        this.onComplete = onComplete;
        this.onError = onError;
    }

    /**
     * Extract all texture URLs from celestial data and TEXTURES object
     * @returns {Set<string>} Set of unique texture URLs to preload
     */
    extractTextureUrls() {
        const textureUrls = new Set();

        // Add skybox texture
        if (TEXTURES.nightSky) {
            textureUrls.add(TEXTURES.nightSky);
        }

        // Add ring textures
        if (TEXTURES.saturnRing) {
            textureUrls.add(TEXTURES.saturnRing);
        }

        // Recursively extract textures from celestial data
        this.extractTexturesFromBody(CELESTIAL_DATA, textureUrls);

        return textureUrls;
    }

    /**
     * Recursively extract texture URLs from celestial body data
     * @param {Object|Array} bodyData - Celestial body data (can be array or single body)
     * @param {Set<string>} textureUrls - Set to add texture URLs to
     */
    extractTexturesFromBody(bodyData, textureUrls) {
        // Handle array of root bodies
        if (Array.isArray(bodyData)) {
            bodyData.forEach(body => this.extractTexturesFromBody(body, textureUrls));
            return;
        }

        // Extract surface texture
        if (bodyData.surfaceTexture) {
            textureUrls.add(bodyData.surfaceTexture);
        }

        // Extract ring texture
        if (bodyData.rings && bodyData.rings.texture) {
            textureUrls.add(bodyData.rings.texture);
        }

        // Extract cloud texture
        if (bodyData.clouds && bodyData.clouds.texture) {
            textureUrls.add(bodyData.clouds.texture);
        }

        // Recursively process children
        if (bodyData.children && Array.isArray(bodyData.children)) {
            bodyData.children.forEach(child => this.extractTexturesFromBody(child, textureUrls));
        }
    }

    /**
     * Preload all textures and call callbacks for progress updates
     * @returns {Promise<Map<string, THREE.Texture>>} Promise that resolves with loaded textures
     */
    async preloadTextures() {
        const textureUrls = this.extractTextureUrls();
        this.totalTextures = textureUrls.size;
        this.loadedCount = 0;

        console.log(`TexturePreloader: Starting to preload ${this.totalTextures} textures...`);

        // Create promises for all texture loading
        const loadingPromises = Array.from(textureUrls).map(url =>
            this.loadSingleTexture(url)
        );

        try {
            // Wait for all textures to load
            await Promise.all(loadingPromises);

            console.log(`TexturePreloader: Successfully loaded ${this.loadedCount}/${this.totalTextures} textures`);

            if (this.onComplete) {
                this.onComplete(this.loadedTextures);
            }

            return this.loadedTextures;
        } catch (error) {
            console.error('TexturePreloader: Failed to load some textures:', error);
            if (this.onError) {
                this.onError(error);
            }
            throw error;
        }
    }

    /**
     * Load a single texture and track progress
     * @param {string} url - Texture URL to load
     * @returns {Promise<THREE.Texture>} Promise that resolves with loaded texture
     */
    loadSingleTexture(url) {
        return new Promise((resolve, reject) => {
            const texture = this.textureLoader.load(
                url,
                // onLoad callback
                (loadedTexture) => {
                    // Configure texture settings (same as MaterialFactory)
                    loadedTexture.wrapS = THREE.RepeatWrapping;
                    loadedTexture.wrapT = THREE.RepeatWrapping;
                    loadedTexture.generateMipmaps = true;
                    loadedTexture.minFilter = THREE.LinearMipmapLinearFilter;
                    loadedTexture.magFilter = THREE.LinearFilter;
                    loadedTexture.anisotropy = 16; // Will be clamped to max supported by GPU

                    this.loadedTextures.set(url, loadedTexture);
                    this.loadedCount++;

                    const percentage = (this.loadedCount / this.totalTextures) * 100;
                    console.log(`TexturePreloader: Loaded ${url} (${this.loadedCount}/${this.totalTextures} - ${percentage.toFixed(1)}%)`);

                    if (this.onProgress) {
                        this.onProgress(this.loadedCount, this.totalTextures, percentage);
                    }

                    resolve(loadedTexture);
                },
                // onProgress callback (for individual texture loading progress)
                undefined,
                // onError callback
                (error) => {
                    console.error(`TexturePreloader: Failed to load texture ${url}:`, error);
                    reject(error);
                }
            );
        });
    }

    /**
     * Get a preloaded texture by URL
     * @param {string} url - Texture URL
     * @returns {THREE.Texture|null} The preloaded texture or null if not found
     */
    getTexture(url) {
        return this.loadedTextures.get(url) || null;
    }

    /**
     * Check if all textures have been loaded
     * @returns {boolean} True if all textures are loaded
     */
    isComplete() {
        return this.loadedCount === this.totalTextures && this.totalTextures > 0;
    }

    /**
     * Get loading progress information
     * @returns {Object} Object with loaded, total, and percentage properties
     */
    getProgress() {
        const percentage = this.totalTextures > 0 ? (this.loadedCount / this.totalTextures) * 100 : 0;
        return {
            loaded: this.loadedCount,
            total: this.totalTextures,
            percentage: percentage
        };
    }

    /**
     * Reset the preloader state
     */
    reset() {
        this.loadedTextures.clear();
        this.loadedCount = 0;
        this.totalTextures = 0;
    }
}

export default TexturePreloader;