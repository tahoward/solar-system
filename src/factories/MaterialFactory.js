import * as THREE from 'three';
import SunShaderMaterial from '../shaders/SunShaderMaterial.js';
import PlanetShaderMaterial from '../shaders/PlanetShaderMaterial.js';
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
     * @param {number} [bodyRadius] - The actual body radius (for ring shadow calculations)
     * @returns {THREE.Material} The created material
     */
    static createBodyMaterial(bodyData, bodyRadius = null) {

        if (bodyData.star) {
            return this.createStarMaterial(bodyData);
        } else {
            return this.createPlanetMaterial(bodyData, bodyRadius);
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
     * @param {number} [bodyRadius] - The actual body radius (for ring shadow calculations)
     * @returns {THREE.Material} The created planet material
     * @private
     */
    static createPlanetMaterial(bodyData, bodyRadius = null) {
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

        // Use RingShadowShaderMaterial for all planets for consistent lighting
        // This provides better control over shadow darkness than MeshLambertMaterial
        if (bodyData.rings && bodyData.rings.texture) {
            return this.createRingShadowMaterial(bodyData, planetTexture, bodyRadius);
        } else {
            // Create PlanetShaderMaterial without rings for better lighting control
            return new PlanetShaderMaterial({
                surfaceTexture: planetTexture,
                ringAlphaTexture: null,
                ringInnerRadius: 0,
                ringOuterRadius: 0,
                lightRadius: 0.05,
                hasRings: false, // No rings, just better lighting
                lightColor: bodyData.surfaceTexture ? 0xffffff : bodyData.color
            });
        }
    }

    /**
     * Create planet material for planets with rings
     * @param {Object} bodyData - The celestial body data
     * @param {THREE.Texture} surfaceTexture - The planet's surface texture
     * @param {number} [bodyRadius] - The actual body radius (for ring shadow calculations)
     * @returns {PlanetShaderMaterial} The created planet material
     * @private
     */
    static createRingShadowMaterial(bodyData, surfaceTexture, bodyRadius = null) {
        const rings = bodyData.rings;
        let ringTexture = null;

        // Load ring alpha texture
        if (rings.texture) {
            if (this.preloadedTextures && this.preloadedTextures.has(rings.texture)) {
                ringTexture = this.preloadedTextures.get(rings.texture);
                console.log(`MaterialFactory: Using preloaded ring texture for ${bodyData.name || 'celestial body'} ring shadows`);
            } else {
                console.warn(`MaterialFactory: Preloaded ring texture not found for ${rings.texture}, loading directly...`);
                const loader = new THREE.TextureLoader();
                ringTexture = loader.load(rings.texture);
                ringTexture.wrapS = THREE.ClampToEdgeWrapping;
                ringTexture.wrapT = THREE.RepeatWrapping;
                ringTexture.generateMipmaps = true;
                ringTexture.minFilter = THREE.LinearMipmapLinearFilter;
                ringTexture.magFilter = THREE.LinearFilter;
            }
        }

        // Calculate ring radii in world units using actual body radius
        const planetRadius = bodyRadius || (bodyData.radiusScale || 1.0); // Use actual radius if available
        const innerRadius = planetRadius * rings.innerRadius;
        const outerRadius = planetRadius * rings.outerRadius;

        return new PlanetShaderMaterial({
            surfaceTexture: surfaceTexture,
            ringAlphaTexture: ringTexture,
            ringInnerRadius: innerRadius,
            ringOuterRadius: outerRadius,
            lightRadius: 0.05, // Sun's apparent radius for soft shadows
            hasRings: true
        });
    }
}

export default MaterialFactory;
