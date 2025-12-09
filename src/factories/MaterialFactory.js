import * as THREE from 'three';
import SunShaderMaterial from '../shaders/SunShaderMaterial.js';
import { temperatureToColor, temperatureToGlareBrightness } from '../constants.js';
import TextureFactory from './TextureFactory.js';

/**
 * Factory class responsible for creating materials for celestial bodies
 */
export class MaterialFactory {
    // Static property to store preloaded textures
    static preloadedTextures = null;

    /**
     * Set preloaded textures for use in material creation
     * @param {Map<string, THREE.Texture>} textures - Map of preloaded textures
     */
    static setPreloadedTextures(textures) {
        this.preloadedTextures = textures;
    }

    /**
     * Create material for a celestial body
     * @param {Object} bodyData - The celestial body data
     * @returns {THREE.Material} The created material
     */
    static createBodyMaterial(bodyData) {

        if (bodyData.star) {
            return this.createStarMaterial(bodyData);
        } else {
            return this.createPlanetMaterial(bodyData);
        }
    }

    /**
     * Create material for a star
     * @param {Object} bodyData - The celestial body data
     * @returns {SunShaderMaterial} The created star material
     * @private
     */
    static createStarMaterial(bodyData) {

        // Create the realistic star shader material with sunspots using nested parameters
        const starShader = bodyData.star.shader || {};

        // Calculate color from temperature if available
        const starColor = bodyData.star.temperature ?
            temperatureToColor(bodyData.star.temperature) :
            (bodyData.color || 0xffaa00);

        // Calculate temperature-based emissive intensity using physics
        const temperature = bodyData.star.temperature || 5778; // Default to solar temperature
        const stellarRadius = bodyData.radiusScale || 1.0; // Relative to solar radius
        const temperatureBasedBrightness = temperatureToGlareBrightness(temperature, stellarRadius);

        // Allow manual override if specified in shader config, otherwise use calculated value
        const adjustedEmissiveIntensity = starShader.emissiveIntensity !== undefined ?
            starShader.emissiveIntensity : temperatureBasedBrightness;

        // Scale noise carefully to avoid shader precision issues on very large stars
        const baseNoiseScale = starShader.noiseScale || 5.0;
        // Use moderate scaling to prevent shader artifacts while still adding detail
        const scaledNoiseScale = baseNoiseScale * Math.min(50.0, Math.pow(stellarRadius, 0.3));

        return new SunShaderMaterial({
            glowColor: starShader.glowColor || starColor,
            glowIntensity: starShader.glowIntensity || 0.3,
            noiseScale: scaledNoiseScale,
            brightness: starShader.brightness || 1.6,
            sunspotFrequency: starShader.sunspotFrequency || 0.04,
            sunspotIntensity: starShader.sunspotIntensity || 2.0,
            emissiveIntensity: adjustedEmissiveIntensity  // Luminance-adjusted intensity for consistent bloom
        });
    }

    /**
     * Create material for a planet
     * @param {Object} bodyData - The celestial body data
     * @returns {THREE.MeshLambertMaterial} The created planet material
     * @private
     */
    static createPlanetMaterial(bodyData) {
        let planetTexture;

        // Use real textures if specified, procedural for others
        if (bodyData.surfaceTexture) {
            // Try to get preloaded texture first
            if (this.preloadedTextures && this.preloadedTextures.has(bodyData.surfaceTexture)) {
                planetTexture = this.preloadedTextures.get(bodyData.surfaceTexture);
                console.log(`MaterialFactory: Using preloaded texture for ${bodyData.name || 'celestial body'}`);
            } else {
                // Fallback to loading texture (for compatibility)
                console.warn(`MaterialFactory: Preloaded texture not found for ${bodyData.surfaceTexture}, loading directly...`);
                const loader = new THREE.TextureLoader();
                planetTexture = loader.load(bodyData.surfaceTexture);
                planetTexture.wrapS = THREE.RepeatWrapping;
                planetTexture.wrapT = THREE.RepeatWrapping;
                planetTexture.generateMipmaps = true;
                planetTexture.minFilter = THREE.LinearMipmapLinearFilter;
                planetTexture.magFilter = THREE.LinearFilter;
                planetTexture.anisotropy = 16; // Will be clamped to max supported by GPU
            }
        } else {
            planetTexture = TextureFactory.createPlanetTexture(bodyData);
        }

        return new THREE.MeshLambertMaterial({
            map: planetTexture,
            color: bodyData.surfaceTexture ? 0xffffff : bodyData.color, // Use white for textured planets to show true colors
            emissive: new THREE.Color(0x000000) // No emissive glow for realistic lighting
        });
    }
}

export default MaterialFactory;
