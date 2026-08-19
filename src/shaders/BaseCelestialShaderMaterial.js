import * as THREE from 'three';
import { log } from '../utils/Logger.js';

/**
 * BaseCelestialShaderMaterial - Base class for all celestial shader materials
 * Contains common uniforms, methods, and functionality shared across planet, cloud, ring shaders
 */
class BaseCelestialShaderMaterial extends THREE.ShaderMaterial {
    constructor(options = {}) {
        // Create common uniforms that are shared across most celestial shaders
        const commonUniforms = {
            lightDirection: { value: new THREE.Vector3(1.0, 0.0, 0.0) },
            lightColor: { value: new THREE.Color(options.lightColor || 0xffffff) }
        };

        // Add shadow-related uniforms if this material supports shadows
        if (options.supportsShadows !== false) {
            Object.assign(commonUniforms, {
                ringNormal: { value: new THREE.Vector3(0.0, 1.0, 0.0) },
                ringInnerRadius: { value: options.ringInnerRadius || 1.0 },
                ringOuterRadius: { value: options.ringOuterRadius || 2.0 },
                lightRadius: { value: options.lightRadius || 0.1 },
                hasRings: { value: options.hasRings || false },
                ringAlphaTexture: { value: options.ringAlphaTexture || null },
                bodyOffsets: { value: Array(8).fill(null).map(() => new THREE.Vector3()) },
                bodyRadii: { value: new Float32Array(8) },
                numBodies: { value: 0 }
            });
        }

        // Merge with material-specific uniforms
        const uniforms = {
            ...commonUniforms,
            ...(options.additionalUniforms || {})
        };

        super({
            uniforms,
            ...options.materialOptions
        });

        // Store references for easy access
        this.lightDirection = uniforms.lightDirection.value;
        this.lightColor = uniforms.lightColor.value;

        if (options.supportsShadows !== false) {
            this.ringNormal = uniforms.ringNormal.value;
        }

        this._supportsShadows = options.supportsShadows !== false;
    }

    /**
     * Update lighting parameters (common implementation)
     * @param {THREE.Vector3} lightPosition - Position of the light source (sun)
     * @param {THREE.Vector3} planetPosition - Position of the planet center
     * @param {THREE.Vector3} ringRotation - Ring rotation (for ring normal calculation)
     */
    updateLighting(lightPosition, planetPosition, ringRotation = null) {
        // Calculate light direction from planet to sun
        const direction = new THREE.Vector3().subVectors(lightPosition, planetPosition).normalize();
        this.uniforms.lightDirection.value.copy(direction);

        // Update ring normal if ring rotation is provided and shadows are supported
        if (ringRotation && this._supportsShadows) {
            // Default ring normal is (0, 1, 0), transform by ring rotation
            const normal = new THREE.Vector3(0, 1, 0);
            normal.applyEuler(ringRotation);
            this.uniforms.ringNormal.value.copy(normal);
        }
    }

    /**
     * Set light color (common implementation)
     * @param {THREE.Color|number} color - Light color
     */
    setLightColor(color) {
        if (typeof color === 'number') {
            this.uniforms.lightColor.value.setHex(color);
        } else {
            this.uniforms.lightColor.value.copy(color);
        }
    }

    /**
     * Set ring parameters (common implementation for shadow-supporting materials)
     * @param {number} innerRadius - Inner ring radius
     * @param {number} outerRadius - Outer ring radius
     * @param {THREE.Texture} alphaTexture - Ring alpha texture
     */
    setRingParameters(innerRadius, outerRadius, alphaTexture) {
        if (!this._supportsShadows) {
            log.warn('BaseCelestialShaderMaterial', 'Attempting to set ring parameters on material that does not support shadows');
            return;
        }

        this.uniforms.ringInnerRadius.value = innerRadius;
        this.uniforms.ringOuterRadius.value = outerRadius;
        this.uniforms.ringAlphaTexture.value = alphaTexture;
        this.uniforms.hasRings.value = true;
    }

    /**
     * Enable or disable ring shadows (common implementation)
     * @param {boolean} enabled - Whether ring shadows are enabled
     */
    setRingShadowsEnabled(enabled) {
        if (!this._supportsShadows) {
            log.warn('BaseCelestialShaderMaterial', 'Attempting to set ring shadows on material that does not support shadows');
            return;
        }

        this.uniforms.hasRings.value = enabled;
    }

    /**
     * Update celestial body positions and radii for shadow calculations (common implementation)
     * Positions are uploaded relative to the planet center: the subtraction happens
     * here in double precision, because doing it in the shader's float32 would
     * cancel away at skybox-scale distances and break the shadows apart.
     * @param {Array<THREE.Vector3>} positions - Array of body world positions
     * @param {Array<number>} radii - Array of body radii in world units
     * @param {THREE.Vector3} planetPosition - World position of the shaded body's center
     */
    updateMoons(positions, radii, planetPosition) {
        if (!this._supportsShadows) {
            log.warn('BaseCelestialShaderMaterial', 'Attempting to update moons on material that does not support shadows');
            return;
        }

        const maxBodies = 8;
        const numBodies = Math.min(positions.length, maxBodies);

        this.uniforms.numBodies.value = numBodies;

        // Clear all body data first
        for (let i = 0; i < maxBodies; i++) {
            this.uniforms.bodyOffsets.value[i].set(0, 0, 0);
            this.uniforms.bodyRadii.value[i] = 0;
        }

        // Set actual body data
        for (let i = 0; i < numBodies; i++) {
            this.uniforms.bodyOffsets.value[i].subVectors(positions[i], planetPosition);
            this.uniforms.bodyRadii.value[i] = radii[i];
        }
    }

    /**
     * Clear all body shadows (common implementation)
     */
    clearMoons() {
        if (!this._supportsShadows) {
            return;
        }

        this.uniforms.numBodies.value = 0;
    }

    /**
     * Get common shadow calculation shader code
     * @returns {string} GLSL shader code for shadow calculations
     */
    static getShadowCalculationShader() {
        return `
// Constants for ring shadow sampling
#define DIV 7
#if DIV == 0
  #define INV_DIV 1.0 // prevent nan
#else
  #define INV_DIV (1.0/float(DIV))
#endif

// Shadow math takes surfaceOffset: the shaded point relative to the planet
// center, along world axes. It must be planet-relative, never derived from
// absolute world positions: at skybox-scale distances float32 coordinates
// quantize far coarser than a body radius, so differencing two absolute
// positions collapses to a coarse lattice (or to zero) and the shadows break up
// into blocks. Vertex shaders build it as mat3(modelMatrix) * position, which is
// exact because every body mesh sits at its group origin.
float eclipseByRings(vec3 surfaceOffset, vec3 sunRadiusPerp) {
    if (!hasRings) return 0.0;

    vec3 sunRay = normalize(lightDirection);

    // Find intersection with ring plane
    float s = -dot(ringNormal, surfaceOffset) / dot(ringNormal, sunRay);

    if (s > 0.0) {
        // Calculate intersection point, relative to the planet center
        vec3 ringVec = surfaceOffset + sunRay * s;

        // Calculate distance from planet center in ring plane
        float ringDistance = length(ringVec - dot(ringVec, ringNormal) * ringNormal);

        // Check if intersection is within ring bounds
        if (ringDistance >= ringInnerRadius && ringDistance <= ringOuterRadius) {
            // Calculate ring texture coordinate (0 = inner edge, 1 = outer edge)
            float alphaRatio = (ringDistance - ringInnerRadius) / (ringOuterRadius - ringInnerRadius);

            // Sample ring alpha texture multiple times for blur effect
            float shadowSum = 0.0;
            float blurRadius = 0.02; // Blur radius in texture space

            // 9-tap blur sampling
            for (int i = 0; i < 9; i++) {
                vec2 sampleCoord = vec2(alphaRatio, 0.5);

                if (i > 0) {
                    float angle = float(i - 1) * 0.785398; // 45 degree increments
                    vec2 offset = vec2(cos(angle), sin(angle)) * blurRadius;
                    sampleCoord += offset;
                }

                float ringAlpha = texture2D(ringAlphaTexture, sampleCoord).r;
                shadowSum += pow(ringAlpha, 0.3);
            }

            return shadowSum / 9.0;
        }
    }

    return 0.0;
}

float eclipseByBodies(vec3 surfaceOffset) {
    if (numBodies == 0) return 0.0;

    vec3 sunRay = normalize(lightDirection);
    float totalShadow = 0.0;

    for (int i = 0; i < 8; i++) {
        if (i >= numBodies) break;

        // Also planet-relative, so the whole calculation stays near the origin
        vec3 bodyCenter = bodyOffsets[i];
        float bodyRadius = bodyRadii[i];

        // Calculate vector from surface point to body center
        vec3 surfaceToBody = bodyCenter - surfaceOffset;

        // Project body center onto the sun ray from surface point
        float projectionLength = dot(surfaceToBody, sunRay);

        // Only consider bodies that are between the surface and the sun
        if (projectionLength > 0.0) {
            // Find closest point on sun ray to body center
            vec3 closestPointOnRay = surfaceOffset + sunRay * projectionLength;

            // Calculate distance from body center to sun ray
            float distanceToRay = length(bodyCenter - closestPointOnRay);

            // Calculate shadow based on body's angular size and distance
            float shadowRadius = bodyRadius * (1.0 + lightRadius); // Add sun's angular size for soft shadows

            if (distanceToRay < shadowRadius) {
                // Calculate shadow intensity based on how much of the body blocks the sun
                float shadowIntensity = 1.0 - smoothstep(bodyRadius * 0.8, shadowRadius, distanceToRay);

                // Attenuate shadow based on distance (closer bodies cast stronger shadows)
                float distanceAttenuation = 1.0 / (1.0 + projectionLength * 0.01);

                totalShadow += shadowIntensity * distanceAttenuation;
            }
        }
    }

    return min(totalShadow, 1.0); // Clamp to maximum shadow intensity
}
`;
    }

    /**
     * Get common uniforms declaration for shaders
     * @param {boolean} includeShadows - Whether to include shadow-related uniforms
     * @returns {string} GLSL uniform declarations
     */
    static getCommonUniforms(includeShadows = true) {
        // No absolute world-space position is exposed here on purpose - see the
        // note above eclipseByRings(). Shaders work in planet-relative offsets.
        const baseUniforms = `
uniform vec3 lightDirection;
uniform vec3 lightColor;
`;

        const shadowUniforms = `
uniform sampler2D ringAlphaTexture;
uniform vec3 ringNormal;
uniform float ringInnerRadius;
uniform float ringOuterRadius;
uniform float lightRadius;
uniform bool hasRings;
uniform vec3 bodyOffsets[8];
uniform float bodyRadii[8];
uniform int numBodies;
`;

        return includeShadows ? baseUniforms + shadowUniforms : baseUniforms;
    }
}

export default BaseCelestialShaderMaterial;