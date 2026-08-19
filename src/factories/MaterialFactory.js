import * as THREE from 'three';
import SunShaderMaterial from '../shaders/SunShaderMaterial.js';
import PlanetShaderMaterial from '../shaders/PlanetShaderMaterial.js';
import { temperatureToColor, temperatureToGlareBrightness } from '../constants.js';
import TextureFactory from './TextureFactory.js';
import { log } from '../utils/Logger.js';

export class MaterialFactory {
    static preloadedTextures = null;

    static setPreloadedTextures(textures) {
        this.preloadedTextures = textures;
    }

    static createBodyMaterial(bodyData, bodyRadius = null) {

        if (bodyData.star) {
            return this.createStarMaterial(bodyData);
        } else {
            return this.createPlanetMaterial(bodyData, bodyRadius);
        }
    }

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
            sunspotFrequency: starShader.sunspotFrequency || 0.04,
            sunspotIntensity: starShader.sunspotIntensity || 2.0,
            emissiveIntensity: adjustedEmissiveIntensity
        });
    }

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
