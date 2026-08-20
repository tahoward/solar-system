import * as THREE from 'three';
import SunCorona from './SunCorona.js';
import SunRays from './SunRays.js';
import SunFlares from './SunFlares.js';
import SunGlare from './SunGlare.js';
import {
    temperatureToColor,
    temperatureToBlackbodyLight,
    temperatureToGlareBrightness,
    radiusAndTemperatureToLuminosity
} from '../constants.js';
import { log } from '../utils/Logger.js';

/**
 * Attaches a star's visual effects and builds its light.
 *
 * A star is not just a lit sphere: what makes one read as a star is the corona around it,
 * the rays and flares off its surface, and the glare that stands in for it once it is too
 * far away to have a visible disc. Assembling those is kept out of {@link Body}, which
 * otherwise would have to know the construction details of four unrelated effects.
 *
 * Almost every parameter is derived from the star's temperature rather than configured, so
 * a star described only by a temperature still comes out the right colour and brightness.
 *
 * Static only.
 */
class StarEffects {
    /**
     * Adds whichever effects this star's data asks for.
     *
     * Each effect is added only if its own configuration block is present, so a star can
     * have rays without a corona, or a bare glare and nothing else. A missing block is
     * logged rather than defaulted, since silently inventing a corona would make the data
     * files misleading about what is on screen.
     *
     * @param {Body} body - The star's body, which the effects are attached to.
     * @param {Object} bodyData - The star's configuration.
     * @param {Object} bodyData.star - Star-specific data; each effect reads its own key.
     * @param {number} radius - The star's radius in scene units.
     * @returns {void}
     */
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

    /**
     * Adds the corona: the glowing shell just outside the star's surface.
     *
     * Attached to the body's group rather than its mesh, so it does not inherit the star's
     * rotation — a corona spinning with the surface would look like a solid shell.
     *
     * Also accepts the older `billboard` key, since some data files still use it.
     *
     * @param {Body} body - The star's body; the corona is stored on `body.billboard`.
     * @param {Object} bodyData - The star's configuration.
     * @param {number} radius - The star's radius in scene units.
     * @returns {void}
     */
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

    /**
     * Adds the rays: thousands of short lines standing off the surface.
     *
     * Attached to the mesh, not the group, so the rays turn with the star and appear rooted
     * in its surface.
     *
     * The default count is high because the rays are individually faint; the effect is a
     * shimmer over the whole limb rather than a set of distinguishable spikes.
     *
     * @param {Body} body - The star's body; the rays are stored on `body.sunRays`.
     * @param {Object} bodyData - The star's configuration.
     * @param {number} radius - The star's radius in scene units.
     * @returns {void}
     */
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

    /**
     * Adds the flares: long lines arcing away from the surface.
     *
     * The same idea as the rays but far longer and fewer, which is what gives the star an
     * irregular, active edge rather than a clean circle.
     *
     * @param {Body} body - The star's body; the flares are stored on `body.sunFlares`.
     * @param {Object} bodyData - The star's configuration.
     * @param {number} radius - The star's radius in scene units.
     * @returns {void}
     */
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

    /**
     * Adds the glare: the camera-facing flare that stands in for the star at a distance.
     *
     * Nothing about its size or brightness is scaled by hand here. The glare holds a fixed
     * fraction of the screen, and how bright it is follows from the star's luminosity — the
     * Stefan–Boltzmann law over its radius and temperature — which the effect turns into an
     * apparent flux against the viewing distance. So a red dwarf, the Sun and a blue giant all
     * come out at the brightness their own physics asks for, and the same configuration works
     * for all three. Stating `emissiveIntensity` in the data pins the brightness and bypasses
     * that.
     *
     * Unlike the other effects this one is not added to the scene graph here.
     * {@link Body#update} parents it to the scene root instead, since it has to be turned
     * to face the camera every frame and must not inherit the star's rotation or scale.
     *
     * @param {Body} body - The star's body; the glare is stored on `body.sunGlare`.
     * @param {Object} bodyData - The star's configuration.
     * @param {number} radius - The star's radius in scene units.
     * @returns {void}
     */
    static addSunGlareEffect(body, bodyData, radius) {
        const starGlare = bodyData.star.glare || {};
        const glareColor = bodyData.star.temperature ?
            temperatureToColor(bodyData.star.temperature) :
            (starGlare.color || 0xffaa00);

        const temperature = bodyData.star.temperature || 5778;
        const stellarRadius = bodyData.radiusScale || 1.0;

        const sunGlare = new SunGlare({
            sunRadius: radius,
            screenFraction: starGlare.screenFraction,
            luminosity: radiusAndTemperatureToLuminosity(stellarRadius, temperature),
            opacity: starGlare.opacity,
            color: glareColor,
            emissiveIntensity: starGlare.emissiveIntensity,
            glowIntensity: starGlare.glowIntensity,
            haloRadius: starGlare.haloRadius,
            haloFalloff: starGlare.haloFalloff,
            haloStrength: starGlare.haloStrength,
            lowres: false
        });

        body.sunGlare = sunGlare;
    }

    /**
     * Builds the light a star casts, if it casts one.
     *
     * `decay` is set to zero, so brightness does not fall off with distance. That is wrong
     * physically, but distances here are compressed relative to body sizes: an
     * inverse-square falloff tuned to light the innermost planet leaves the outer system
     * black, and one tuned for the outer system blows out the inner. A flat intensity keeps
     * everything visible, and the apparent falloff comes from the bodies' sizes on screen
     * instead.
     *
     * The colour is a blackbody colour for the star's temperature, which is not quite the
     * same as the colour of its surface — light reaching a planet has to look plausible on
     * that planet's own texture.
     *
     * @param {Object} bodyData - The body's configuration.
     * @param {Object} [bodyData.star] - Star data; a temperature here sets the light colour.
     * @param {number} [bodyData.lightIntensity] - Intensity for a non-star body that still
     *   emits light.
     * @returns {THREE.PointLight|null} The light, or `null` if this body emits none.
     */
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