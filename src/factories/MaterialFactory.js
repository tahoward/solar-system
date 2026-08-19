import * as THREE from 'three';
import SunShaderMaterial from '../shaders/SunShaderMaterial.js';
import PlanetShaderMaterial from '../shaders/PlanetShaderMaterial.js';
import { temperatureToColor, temperatureToGlareBrightness } from '../constants.js';
import TextureFactory from './TextureFactory.js';
import { log } from '../utils/Logger.js';

/**
 * Builds the shader material for a body from its data.
 *
 * Which material a body needs depends on what it is — a star wants the sun shader,
 * a ringed planet wants ring-shadow support in its surface shader — and the choice
 * is made in one place here rather than at each call site.
 *
 * Textures are taken from the preloaded set where possible. Loading one on demand
 * works but the body appears untextured until it arrives, so a miss is logged as a
 * warning: it means the preloader's manifest has fallen out of step with the body
 * data.
 *
 * Static only.
 */
export class MaterialFactory {
    /**
     * Textures loaded ahead of time, keyed by URL.
     *
     * @type {Map<string, THREE.Texture>|null}
     */
    static preloadedTextures = null;

    /**
     * Supplies the preloaded texture set.
     *
     * Must be called before any material is built, or every texture will be loaded
     * on demand instead.
     *
     * @param {Map<string, THREE.Texture>} textures - Textures keyed by URL.
     * @returns {void}
     */
    static setPreloadedTextures(textures) {
        this.preloadedTextures = textures;
    }

    /**
     * Builds the right material for a body.
     *
     * @param {Object} bodyData - Body definition; a `star` property selects the star
     *   material.
     * @param {number|null} [bodyRadius=null] - Body's radius in scene units, needed to
     *   place ring shadows.
     * @returns {SunShaderMaterial|PlanetShaderMaterial} The material to use.
     */
    static createBodyMaterial(bodyData, bodyRadius = null) {

        if (bodyData.star) {
            return this.createStarMaterial(bodyData);
        } else {
            return this.createPlanetMaterial(bodyData, bodyRadius);
        }
    }

    /**
     * Builds a star's surface material from its temperature.
     *
     * Colour and brightness are derived from the effective temperature rather than
     * given directly, so a red dwarf and a blue giant look right without either being
     * tuned by hand. Explicit shader values in the data override the derived ones.
     *
     * The noise scale is grown with the stellar radius, but only as its cube root and
     * capped: a giant sized up linearly would show granulation so fine it aliases into
     * noise, while leaving it fixed makes the same star look smooth and plastic.
     *
     * @param {Object} bodyData - Body definition, with a `star` block holding
     *   `temperature` and optional `shader` overrides.
     * @returns {SunShaderMaterial} The star material.
     */
    static createStarMaterial(bodyData) {
        const starShader = bodyData.star.shader || {};

        const starColor = bodyData.star.temperature ?
            temperatureToColor(bodyData.star.temperature) :
            (bodyData.color || 0xffaa00);

        const temperature = bodyData.star.temperature || 5778;
        const stellarRadius = bodyData.radiusScale || 1.0;
        const temperatureBasedBrightness = temperatureToGlareBrightness(temperature, stellarRadius);

        const adjustedEmissiveIntensity = starShader.emissiveIntensity !== undefined ?
            starShader.emissiveIntensity : temperatureBasedBrightness;

        const baseNoiseScale = starShader.noiseScale || 5.0;
        const scaledNoiseScale = baseNoiseScale * Math.min(50.0, Math.pow(stellarRadius, 0.3));

        return new SunShaderMaterial({
            glowColor: starShader.glowColor || starColor,
            glowIntensity: starShader.glowIntensity || 0.3,
            noiseScale: scaledNoiseScale,
            brightness: starShader.brightness || 1.6,
            sunspotIntensity: starShader.sunspotIntensity || 2.0,
            emissiveIntensity: adjustedEmissiveIntensity
        });
    }

    /**
     * Builds a planet or moon's surface material.
     *
     * A body with no texture of its own falls back to a painted one from
     * {@link TextureFactory}. Textures loaded here rather than from the preloaded set
     * get mipmaps and full anisotropy, since they are viewed at a glancing angle
     * across a curved surface where both matter.
     *
     * `lightColor` is left white for textured bodies, so the texture's own colours come
     * through; untextured ones are tinted with the body's colour instead.
     *
     * @param {Object} bodyData - Body definition.
     * @param {number|null} [bodyRadius=null] - Body's radius in scene units, for ring
     *   shadow geometry.
     * @returns {PlanetShaderMaterial} The surface material.
     */
    static createPlanetMaterial(bodyData, bodyRadius = null) {
        let planetTexture;

        if (bodyData.surfaceTexture) {
            if (this.preloadedTextures && this.preloadedTextures.has(bodyData.surfaceTexture)) {
                planetTexture = this.preloadedTextures.get(bodyData.surfaceTexture);
                log.debug('MaterialFactory', `Using preloaded texture for ${bodyData.name || 'celestial body'}`);
            } else {
                log.warn('MaterialFactory', `Preloaded texture not found for ${bodyData.surfaceTexture}, loading directly...`);
                const loader = new THREE.TextureLoader();
                planetTexture = loader.load(bodyData.surfaceTexture);
                planetTexture.wrapS = THREE.RepeatWrapping;
                planetTexture.wrapT = THREE.RepeatWrapping;
                planetTexture.generateMipmaps = true;
                planetTexture.minFilter = THREE.LinearMipmapLinearFilter;
                planetTexture.magFilter = THREE.LinearFilter;
                planetTexture.anisotropy = 16;
            }
        } else {
            planetTexture = TextureFactory.createPlanetTexture(bodyData);
        }

        if (bodyData.rings && bodyData.rings.texture) {
            return this.createRingShadowMaterial(bodyData, planetTexture, bodyRadius);
        } else {
            return new PlanetShaderMaterial({
                surfaceTexture: planetTexture,
                ringAlphaTexture: null,
                ringInnerRadius: 0,
                ringOuterRadius: 0,
                lightRadius: 0.05,
                hasRings: false,
                lightColor: bodyData.surfaceTexture ? 0xffffff : bodyData.color
            });
        }
    }

    /**
     * Builds a surface material that casts its rings' shadow onto the planet.
     *
     * The ring radii in the data are multiples of the planet's radius, so they are
     * converted to scene units here — the shader tests a point on the surface against
     * these to work out whether the rings are between it and the star.
     *
     * The ring texture is clamped horizontally, not repeated: wrapping would make the
     * outer edge of the rings bleed back into the inner gap.
     *
     * @param {Object} bodyData - Body definition, with a `rings` block.
     * @param {THREE.Texture} surfaceTexture - The planet's own surface texture.
     * @param {number|null} [bodyRadius=null] - Planet radius in scene units; falls back
     *   to the data's `radiusScale`.
     * @returns {PlanetShaderMaterial} The surface material, with ring shadows enabled.
     */
    static createRingShadowMaterial(bodyData, surfaceTexture, bodyRadius = null) {
        const rings = bodyData.rings;
        let ringTexture = null;

        if (rings.texture) {
            if (this.preloadedTextures && this.preloadedTextures.has(rings.texture)) {
                ringTexture = this.preloadedTextures.get(rings.texture);
                log.debug('MaterialFactory', `Using preloaded ring texture for ${bodyData.name || 'celestial body'} ring shadows`);
            } else {
                log.warn('MaterialFactory', `Preloaded ring texture not found for ${rings.texture}, loading directly...`);
                const loader = new THREE.TextureLoader();
                ringTexture = loader.load(rings.texture);
                ringTexture.wrapS = THREE.ClampToEdgeWrapping;
                ringTexture.wrapT = THREE.RepeatWrapping;
                ringTexture.generateMipmaps = true;
                ringTexture.minFilter = THREE.LinearMipmapLinearFilter;
                ringTexture.magFilter = THREE.LinearFilter;
            }
        }

        const planetRadius = bodyRadius || (bodyData.radiusScale || 1.0);
        const innerRadius = planetRadius * rings.innerRadius;
        const outerRadius = planetRadius * rings.outerRadius;

        return new PlanetShaderMaterial({
            surfaceTexture: surfaceTexture,
            ringAlphaTexture: ringTexture,
            ringInnerRadius: innerRadius,
            ringOuterRadius: outerRadius,
            lightRadius: 0.05,
            hasRings: true
        });
    }
}

export default MaterialFactory;
