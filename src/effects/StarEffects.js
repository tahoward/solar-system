import * as THREE from 'three';
import SunCorona from './SunCorona.js';
import SunRays from './SunRays.js';
import SunFlares from './SunFlares.js';
import SunGlare from './SunGlare.js';
import { temperatureToColor, temperatureToBlackbodyLight, temperatureToGlareBrightness } from '../constants.js';
import logger, { log } from '../utils/Logger.js';

class StarEffects {
    static addStarEffects(body, bodyData, radius) {
        if (bodyData.star.corona) {
            StarEffects.addCoronaEffect(body, bodyData, radius);
        } else {
            log.debug('StarEffects', 'Corona data not found - skipping corona effect');
        }

        if (bodyData.star.rays) {
            StarEffects.addSunRaysEffect(body, bodyData, radius);
        } else {
            log.debug('StarEffects', 'Rays data not found - skipping rays effect');
        }

        if (bodyData.star.flares) {
            StarEffects.addSunFlaresEffect(body, bodyData, radius);
        } else {
            log.debug('StarEffects', 'Flares data not found - skipping flares effect');
        }

        if (bodyData.star.glare) {
            StarEffects.addSunGlareEffect(body, bodyData, radius);
        } else {
            log.debug('StarEffects', 'Glare data not found - skipping glare effect');
        }

        body.starData = bodyData.star;
    }

    static addCoronaEffect(body, bodyData, radius) {
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

        sunCorona.setPosition(new THREE.Vector3(0, 0, 0));
        body.group.add(sunCorona.getMesh());

        body.billboard = sunCorona;
    }

    static addSunRaysEffect(body, bodyData, radius) {
        const starRays = bodyData.star.rays || {};

        const temperatureColor = bodyData.star?.temperature ?
            temperatureToColor(bodyData.star.temperature) :
            0xffaa00;

        const temperature = bodyData.star.temperature || 5778;
        const stellarRadius = bodyData.radiusScale || 1.0;
        const temperatureBasedBrightness = temperatureToGlareBrightness(temperature, stellarRadius);

        const emissiveIntensity = starRays.emissiveIntensity !== undefined ?
            starRays.emissiveIntensity : temperatureBasedBrightness;

        const sunRays = new SunRays({
            sunRadius: radius,
            rayCount: starRays.rayCount || 2048,
            rayLength: starRays.rayLength || 0.015,
            rayWidth: starRays.rayWidth || 0.001,
            rayOpacity: starRays.rayOpacity || 0.4,
            baseColor: temperatureColor,
            hueSpread: starRays.hueSpread || 0.3,
            noiseFrequency: starRays.noiseFrequency || 15,
            noiseAmplitude: starRays.noiseAmplitude || 12.0,
            bendAmount: starRays.bendAmount || 0.0,
            whispyAmount: starRays.whispyAmount || 0.0,
            lowres: starRays.lowres || false,
            emissiveIntensity: emissiveIntensity
        });

        body.mesh.add(sunRays.getMesh());

        const rayColor = bodyData.star.temperature ?
            temperatureToColor(bodyData.star.temperature) :
            (bodyData.color || 0xffaa00);
        sunRays.setBaseColor(rayColor);

        body.sunRays = sunRays;
    }

    static addSunFlaresEffect(body, bodyData, radius) {
        const starFlares = bodyData.star.flares || {};

        const temperatureColor = bodyData.star?.temperature ?
            temperatureToColor(bodyData.star.temperature) :
            0xffaa00;

        const temperature = bodyData.star.temperature || 5778;
        const stellarRadius = bodyData.radiusScale || 1.0;
        const temperatureBasedBrightness = temperatureToGlareBrightness(temperature, stellarRadius);

        const emissiveIntensity = starFlares.emissiveIntensity !== undefined ?
            starFlares.emissiveIntensity : temperatureBasedBrightness;

        const sunFlares = new SunFlares({
            sunRadius: radius,
            lineCount: starFlares.lineCount || 1024,
            lineLength: starFlares.lineLength || 16,
            lowres: starFlares.lowres || false,
            opacity: starFlares.opacity || 0.8,
            baseColor: temperatureColor,
            emissiveIntensity: emissiveIntensity
        });

        body.mesh.add(sunFlares.getMesh());

        const flareColor = bodyData.star.temperature ?
            temperatureToColor(bodyData.star.temperature) :
            (bodyData.color || 0xffaa00);
        sunFlares.setBaseColor(flareColor);

        body.sunFlares = sunFlares;
    }

    static addSunGlareEffect(body, bodyData, radius) {
        const starGlare = bodyData.star.glare || {};
        const glareColor = bodyData.star.temperature ?
            temperatureToColor(bodyData.star.temperature) :
            (starGlare.color || 0xffaa00);

        const temperature = bodyData.star.temperature || 5778;
        const stellarRadius = bodyData.radiusScale || 1.0;
        const temperatureBasedBrightness = temperatureToGlareBrightness(temperature, stellarRadius);

        const emissiveIntensity = starGlare.emissiveIntensity !== undefined ?
            starGlare.emissiveIntensity : temperatureBasedBrightness * 25.0;

        const baseOpacity = starGlare.opacity || 1.0;
        const temperatureOpacityMultiplier = Math.min(8.0, temperatureBasedBrightness / 1.5);
        const adjustedOpacity = Math.min(1.0, baseOpacity * temperatureOpacityMultiplier);

        const radiusScale = stellarRadius;
        const scaledFadeStartDistance = (starGlare.fadeStartDistance || 20.0) * radiusScale;
        const scaledFadeEndDistance = (starGlare.fadeEndDistance || 10.0) * radiusScale;
        const scaledMinScaleDistance = (starGlare.minScaleDistance || 15.0) * radiusScale;
        const scaledMaxScaleDistance = (starGlare.maxScaleDistance || 700.0) * radiusScale;

        const sunGlare = new SunGlare({
            sunRadius: radius,
            size: starGlare.size || 90.0,
            opacity: adjustedOpacity,
            color: glareColor,
            emissiveIntensity: emissiveIntensity,
            glowIntensity: starGlare.glowIntensity,
            haloRadius: starGlare.haloRadius,
            haloFalloff: starGlare.haloFalloff,
            haloStrength: starGlare.haloStrength,
            fadeStartDistance: scaledFadeStartDistance,
            fadeEndDistance: scaledFadeEndDistance,
            scaleWithDistance: starGlare.scaleWithDistance !== undefined ? starGlare.scaleWithDistance : true,
            minScaleDistance: scaledMinScaleDistance,
            maxScaleDistance: scaledMaxScaleDistance,
            minScale: starGlare.minScale || 0.2,
            maxScale: starGlare.maxScale || 10.0,
            scaleCenterWithDistance: starGlare.scaleCenterWithDistance !== undefined ? starGlare.scaleCenterWithDistance : false,
            centerBaseSize: starGlare.centerBaseSize || 0.05,
            centerFadeSize: starGlare.centerFadeSize || 0.1,
            lowres: false
        });

        body.sunGlare = sunGlare;
    }

    static createLightForBody(bodyData) {
        if (!bodyData.star && !bodyData.lightIntensity) {
            return null;
        }

        let lightIntensity;

        if (bodyData.star) {
            const temperature = bodyData.star.temperature || 5778;
            const radius = bodyData.radiusScale || 1.0;

            const calculatedLightIntensity = temperatureToGlareBrightness(temperature, radius);

            lightIntensity = bodyData.star.lightIntensity !== undefined ?
                bodyData.star.lightIntensity : calculatedLightIntensity;

        } else {
            lightIntensity = bodyData.lightIntensity;
        }

        if (!lightIntensity || lightIntensity <= 0) {
            return null;
        }

        const lightColor = bodyData.star?.temperature ?
            temperatureToBlackbodyLight(bodyData.star.temperature) :
            0xffffff;

        const light = new THREE.PointLight(lightColor, lightIntensity);
        light.decay = 0;

        return light;
    }
}

export default StarEffects;