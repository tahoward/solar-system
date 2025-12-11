import * as THREE from 'three';
import Body from '../model/Body.js';
import SunCorona from '../effects/SunCorona.js';
import SunRays from '../effects/SunRays.js';
import SunFlares from '../effects/SunFlares.js';
import SunGlare from '../effects/SunGlare.js';
import SceneManager from '../managers/SceneManager.js';
import { temperatureToColor, temperatureToBlackbodyLight, temperatureToGlareBrightness } from '../constants.js';
import MaterialFactory from './MaterialFactory.js';
import { log } from '../utils/Logger.js';

/**
 * Factory class responsible for creating Body instances
 */
export class BodyFactory {
    /**
     * Create a single body from celestial data
     * @param {Object} bodyData - The celestial body data
     * @param {Body|null} parentBody - The parent body for radius scaling
     * @returns {Body} The created body
     */
    static createBodyFromData(bodyData, parentBody = null) {
        // Create light if body has light intensity specified
        const light = this.createLightForBody(bodyData);

        // Calculate radius - for planets, scale relative to parent (Sun)
        const radius = this.calculateBodyRadius(bodyData, parentBody);

        // Create material (pass radius for ring shadow calculations)
        const material = MaterialFactory.createBodyMaterial(bodyData, radius);

        // Create the body
        const body = new Body(
            bodyData.name,
            radius,
            material,
            true, // Has marker
            light,
            bodyData.mass,
            bodyData.rotationPeriod, // Rotation period in Earth hours
            bodyData.axialTilt, // Axial tilt in degrees
            bodyData.rings, // Ring system (if any)
            bodyData.clouds, // Cloud system (if any)
            bodyData.atmosphere, // Atmosphere system (if any)
            bodyData.rotationOffset || 0, // Rotation offset in radians (default 0)
            bodyData.tidallyLocked || false, // Tidal locking (default false)
            parentBody // Parent body reference for tidal locking
        );

        // Store ecliptic attribute from celestial data
        body.ecliptic = bodyData.ecliptic !== undefined ? bodyData.ecliptic : false;

        // Store radiusScale from bodyData for bloom and other distance-based effects
        body.radiusScale = bodyData.radiusScale || 1.0;

        // Store marker color
        this.setMarkerColor(body, bodyData);

        // Add advanced star effects if this is a star
        if (bodyData.star) {
            this.addStarEffects(body, bodyData, radius);
        }

        return body;
    }

    /**
     * Create light for a body if it emits light
     * @param {Object} bodyData - The celestial body data
     * @returns {THREE.PointLight|null} The created light or null
     * @private
     */
    static createLightForBody(bodyData) {
        // Only process bodies that might emit light
        if (!bodyData.star && !bodyData.lightIntensity) {
            return null;
        }

        let lightIntensity;

        // For stars, use same temperature-based calculation as other star effects
        if (bodyData.star) {
            const temperature = bodyData.star.temperature || 5778; // Default to solar temperature
            const radius = bodyData.radiusScale || 1.0; // Relative to solar radius

            // Use same calculation as glare, rays, flares, and star material for consistency
            const calculatedLightIntensity = temperatureToGlareBrightness(temperature, radius);

            // Allow manual override if specified, otherwise use calculated value
            lightIntensity = bodyData.star.lightIntensity !== undefined ?
                bodyData.star.lightIntensity : calculatedLightIntensity;

        } else {
            // Non-star bodies use manual light intensity
            lightIntensity = bodyData.lightIntensity;
        }

        // Early exit if no light emission
        if (!lightIntensity || lightIntensity <= 0) {
            return null;
        }

        // Use pure blackbody radiation color for stars, white for others
        const lightColor = bodyData.star?.temperature ?
            temperatureToBlackbodyLight(bodyData.star.temperature) :
            0xffffff; // Default white light for non-stars

        const light = new THREE.PointLight(lightColor, lightIntensity);
        light.decay = 0; // Disable distance decay - light doesn't reduce over distance

        return light;
    }

    /**
     * Calculate body radius based on parent body scaling
     * @param {Object} bodyData - The celestial body data
     * @param {Body|null} parentBody - The parent body
     * @returns {number} The calculated radius
     * @private
     */
    static calculateBodyRadius(bodyData, parentBody) {
        if (parentBody) {
            // Parent radius already includes SceneManager.scale, so don't apply it again
            return parentBody.radius * bodyData.radiusScale;
        } else {
            // For Sun, use the radiusScale directly
            return bodyData.radiusScale * SceneManager.scale;
        }
    }

    /**
     * Set marker color for body
     * @param {Body} body - The body to set marker color on
     * @param {Object} bodyData - The celestial body data
     * @private
     */
    static setMarkerColor(body, bodyData) {
        if (bodyData.markerColor !== undefined) {
            body.markerColor = new THREE.Color(bodyData.markerColor);
        } else {
            log.warn('BodyFactory', `No markerColor specified for ${bodyData.name}`);
        }
    }

    /**
     * Add star-specific visual effects to a body
     * @param {Body} body - The body to add effects to
     * @param {Object} bodyData - The celestial body data
     * @param {number} radius - The body radius
     * @private
     */
    static addStarEffects(body, bodyData, radius) {

        // Add corona outersphere effect (only if corona data exists)
        if (bodyData.star.corona) {
            this.addCoronaEffect(body, bodyData, radius);
        } else {
            log.debug('BodyFactory', 'Corona data not found - skipping corona effect');
        }

        // Add sun rays effect (only if rays data exists)
        if (bodyData.star.rays) {
            this.addSunRaysEffect(body, bodyData, radius);
        } else {
            log.debug('BodyFactory', 'Rays data not found - skipping rays effect');
        }

        // Add sun flares effect (only if flares data exists)
        if (bodyData.star.flares) {
            this.addSunFlaresEffect(body, bodyData, radius);
        } else {
            log.debug('BodyFactory', 'Flares data not found - skipping flares effect');
        }

        // Add sun glare effect (only if glare data exists)
        if (bodyData.star.glare) {
            this.addSunGlareEffect(body, bodyData, radius);
        } else {
            log.debug('BodyFactory', 'Glare data not found - skipping glare effect');
        }

        // Store star data for animation manager access
        body.starData = bodyData.star;

        // Mark this body as a star for later registration
        body.isStar = true;
    }

    /**
     * Add corona outersphere effect to star
     * @param {Body} body - The body to add effect to
     * @param {Object} bodyData - The celestial body data
     * @param {number} radius - The body radius
     * @private
     */
    static addCoronaEffect(body, bodyData, radius) {

        // Create the corona using nested parameters and temperature color
        const starCorona = bodyData.star.corona || bodyData.star.billboard || {};
        const coronaColor = bodyData.star.temperature ?
            temperatureToColor(bodyData.star.temperature) :
            (bodyData.color || 0xffaa00);

        const sunCorona = new SunCorona({
            sunRadius: radius,
            coronaRadius: radius * (starCorona.size || 2.5),
            coronaColor: starCorona.glowColor || starCorona.coronaColor || coronaColor,
            coronaIntensity: starCorona.glowIntensity || starCorona.coronaIntensity || 0.8,
            noiseScale: starCorona.noiseScale || 3.0,
            animationSpeed: starCorona.animationSpeed || starCorona.pulseSpeed || 0.001,
            fresnelPower: starCorona.fresnelPower || 2.0,
            lowres: false
        });

        // Add the corona to the sun's group so it moves with the sun
        // Position it at the exact center so it surrounds the sun
        sunCorona.setPosition(new THREE.Vector3(0, 0, 0));
        body.group.add(sunCorona.getMesh());

        // Store reference to corona for updates (keeping 'billboard' name for compatibility)
        body.billboard = sunCorona;

    }

    /**
     * Add sun rays effect to star
     * @param {Body} body - The body to add effect to
     * @param {Object} bodyData - The celestial body data
     * @param {number} radius - The body radius
     * @private
     */
    static addSunRaysEffect(body, bodyData, radius) {

        const starRays = bodyData.star.rays || {};

        // Calculate temperature-based color and emissive intensity for rays
        const temperatureColor = bodyData.star?.temperature ?
            temperatureToColor(bodyData.star.temperature) :
            0xffaa00; // Default orange for non-temperature stars

        // Calculate temperature-based emissive intensity
        const temperature = bodyData.star.temperature || 5778; // Default to solar temperature
        const stellarRadius = bodyData.radiusScale || 1.0; // Relative to solar radius
        const temperatureBasedBrightness = temperatureToGlareBrightness(temperature, stellarRadius);

        // Allow manual override if specified, otherwise use calculated value
        const emissiveIntensity = starRays.emissiveIntensity !== undefined ?
            starRays.emissiveIntensity : temperatureBasedBrightness;

        const sunRays = new SunRays({
            sunRadius: radius,
            rayCount: starRays.rayCount || 2048,
            rayLength: starRays.rayLength || 0.015,
            rayWidth: starRays.rayWidth || 0.001,
            rayOpacity: starRays.rayOpacity || 0.4,
            baseColor: temperatureColor,  // Use temperature-based color instead of hue
            hueSpread: starRays.hueSpread || 0.3,
            noiseFrequency: starRays.noiseFrequency || 15,
            noiseAmplitude: starRays.noiseAmplitude || 12.0,
            bendAmount: starRays.bendAmount || 0.0,
            whispyAmount: starRays.whispyAmount || 0.0,
            lowres: starRays.lowres || false,
            emissiveIntensity: emissiveIntensity
        });

        // Add rays directly to the sun's rotating mesh so they rotate with it
        body.mesh.add(sunRays.getMesh());

        // Set ray color to match star temperature
        const rayColor = bodyData.star.temperature ?
            temperatureToColor(bodyData.star.temperature) :
            (bodyData.color || 0xffaa00);
        sunRays.setBaseColor(rayColor);

        // Store reference for updates
        body.sunRays = sunRays;

    }

    /**
     * Add sun flares effect to star
     * @param {Body} body - The body to add effect to
     * @param {Object} bodyData - The celestial body data
     * @param {number} radius - The body radius
     * @private
     */
    static addSunFlaresEffect(body, bodyData, radius) {

        const starFlares = bodyData.star.flares || {};

        // Calculate temperature-based color and emissive intensity for flares
        const temperatureColor = bodyData.star?.temperature ?
            temperatureToColor(bodyData.star.temperature) :
            0xffaa00; // Default orange for non-temperature stars

        // Calculate temperature-based emissive intensity
        const temperature = bodyData.star.temperature || 5778; // Default to solar temperature
        const stellarRadius = bodyData.radiusScale || 1.0; // Relative to solar radius
        const temperatureBasedBrightness = temperatureToGlareBrightness(temperature, stellarRadius);

        // Allow manual override if specified, otherwise use calculated value
        const emissiveIntensity = starFlares.emissiveIntensity !== undefined ?
            starFlares.emissiveIntensity : temperatureBasedBrightness;

        const sunFlares = new SunFlares({
            sunRadius: radius,
            lineCount: starFlares.lineCount || 1024,
            lineLength: starFlares.lineLength || 16,
            lowres: starFlares.lowres || false,
            opacity: starFlares.opacity || 0.8,
            baseColor: temperatureColor,  // Use temperature-based color
            emissiveIntensity: emissiveIntensity
        });

        // Add flares directly to the sun's rotating mesh so they rotate with it
        body.mesh.add(sunFlares.getMesh());

        // Set flare color to match star temperature
        const flareColor = bodyData.star.temperature ?
            temperatureToColor(bodyData.star.temperature) :
            (bodyData.color || 0xffaa00);
        sunFlares.setBaseColor(flareColor);

        // Store reference for updates
        body.sunFlares = sunFlares;

    }

    /**
     * Add sun glare billboard effect to star
     * @param {Body} body - The body to add effect to
     * @param {Object} bodyData - The celestial body data
     * @param {number} radius - The body radius
     * @private
     */
    static addSunGlareEffect(body, bodyData, radius) {

        const starGlare = bodyData.star.glare || {};
        const glareColor = bodyData.star.temperature ?
            temperatureToColor(bodyData.star.temperature) :
            (starGlare.color || 0xffaa00);

        // Calculate temperature-based glare brightness
        const temperature = bodyData.star.temperature || 5778; // Default to solar temperature
        const stellarRadius = bodyData.radiusScale || 1.0; // Relative to solar radius
        const temperatureBasedBrightness = temperatureToGlareBrightness(temperature, stellarRadius);

        // Allow manual override if specified, otherwise use calculated value with massive boost
        const emissiveIntensity = starGlare.emissiveIntensity !== undefined ?
            starGlare.emissiveIntensity : temperatureBasedBrightness * 25.0; // 25x boost - much brighter

        // Also scale the base opacity based on temperature for visual brightness (not just bloom)
        const baseOpacity = starGlare.opacity || 1.0; // Increased base opacity
        const temperatureOpacityMultiplier = Math.min(8.0, temperatureBasedBrightness / 1.5); // Even higher multiplier
        const adjustedOpacity = Math.min(1.0, baseOpacity * temperatureOpacityMultiplier);

        // Calculate color brightness multiplier based on temperature with massive boost
        const colorBrightnessMult = Math.min(35.0, temperatureBasedBrightness / 0.5); // 35x max, even lower divisor

        // Scale distance-based parameters by star radius for proportional scaling
        // This makes larger stars have proportionally larger fade distances and smaller stars smaller ones
        const radiusScale = stellarRadius; // Use stellar radius as the scaling factor
        const scaledFadeStartDistance = (starGlare.fadeStartDistance || 20.0) * radiusScale;
        const scaledFadeEndDistance = (starGlare.fadeEndDistance || 10.0) * radiusScale;
        const scaledMinScaleDistance = (starGlare.minScaleDistance || 15.0) * radiusScale;
        const scaledMaxScaleDistance = (starGlare.maxScaleDistance || 700.0) * radiusScale;

        const sunGlare = new SunGlare({
            sunRadius: radius,
            size: starGlare.size || 90.0,  // Use the correct default from constants.js
            opacity: adjustedOpacity,
            color: glareColor,
            brightnessMult: colorBrightnessMult,
            emissiveIntensity: emissiveIntensity,
            fadeStartDistance: scaledFadeStartDistance,
            fadeEndDistance: scaledFadeEndDistance,
            // Distance-based scaling parameters (scaled by star radius)
            scaleWithDistance: starGlare.scaleWithDistance !== undefined ? starGlare.scaleWithDistance : true,
            minScaleDistance: scaledMinScaleDistance,
            maxScaleDistance: scaledMaxScaleDistance,
            minScale: starGlare.minScale || 0.2,
            maxScale: starGlare.maxScale || 10.0,
            // Radial center glow scaling parameters
            scaleCenterWithDistance: starGlare.scaleCenterWithDistance !== undefined ? starGlare.scaleCenterWithDistance : false,
            centerBaseSize: starGlare.centerBaseSize || 0.05,
            centerFadeSize: starGlare.centerFadeSize || 0.1,
            lowres: false
        });

        // Add the glare directly to the scene at a higher level for better render order control
        // We'll position it manually in the update loop
        // Note: This will be added to the scene later via SceneManager

        // Store reference for updates
        body.sunGlare = sunGlare;

    }
}

export default BodyFactory;
