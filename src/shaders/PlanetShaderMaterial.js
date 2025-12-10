import * as THREE from 'three';
import ShaderLoader from './ShaderLoader.js';

const vertexShader = `
varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vWorldPosition;
varying vec3 vViewPosition;
varying vec3 vWorldNormal;

void main() {
    vUv = uv;

    // Calculate normal in world space for proper lighting
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    vNormal = normalize(normalMatrix * normal);

    // World position for lighting calculations
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    vWorldPosition = worldPosition.xyz;

    // View position
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    vViewPosition = -mvPosition.xyz;

    gl_Position = projectionMatrix * mvPosition;
}
`;

const fragmentShaderMainCode = `
uniform sampler2D surfaceTexture;
uniform sampler2D ringAlphaTexture;
uniform vec3 lightDirection;
uniform vec3 lightColor;
uniform vec3 ringNormal;
uniform vec3 planetCenter;
uniform float ringInnerRadius;
uniform float ringOuterRadius;
uniform float lightRadius;
uniform bool hasRings;
uniform vec3 bodyPositions[8];
uniform float bodyRadii[8];
uniform int numBodies;

varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vWorldPosition;
varying vec3 vViewPosition;
varying vec3 vWorldNormal;

// Constants for ring shadow sampling (match original)
#define DIV 7
#if DIV == 0
  #define INV_DIV 1.0 // prevent nan
#else
  #define INV_DIV (1.0/float(DIV))
#endif

float eclipseByRings(vec3 surfacePosition, vec3 sunRadiusPerp) {
    if (!hasRings) return 0.0;

    vec3 sunRay = normalize(lightDirection);

    // Find intersection with ring plane
    float s = -dot(ringNormal, surfacePosition - planetCenter) / dot(ringNormal, sunRay);

    if (s > 0.0) {
        // Calculate intersection point
        vec3 intersectionPoint = surfacePosition + sunRay * s;
        vec3 ringVec = intersectionPoint - planetCenter;

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

float eclipseByBodies(vec3 surfacePosition) {
    if (numBodies == 0) return 0.0;

    vec3 sunRay = normalize(lightDirection);
    float totalShadow = 0.0;

    for (int i = 0; i < 8; i++) {
        if (i >= numBodies) break;

        vec3 bodyCenter = bodyPositions[i];
        float bodyRadius = bodyRadii[i];

        // Calculate vector from surface point to body center
        vec3 surfaceToBody = bodyCenter - surfacePosition;

        // Project body center onto the sun ray from surface point
        float projectionLength = dot(surfaceToBody, sunRay);

        // Only consider bodies that are between the surface and the sun
        if (projectionLength > 0.0) {
            // Find closest point on sun ray to body center
            vec3 closestPointOnRay = surfacePosition + sunRay * projectionLength;

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

void main() {
    // Sample base surface texture
    vec4 baseColor = texture2D(surfaceTexture, vUv);

    // Calculate basic lighting using world space normal and light direction
    vec3 surfaceNormal = normalize(vWorldNormal);
    vec3 normalizedLightDir = normalize(lightDirection);
    float lightDot = dot(surfaceNormal, normalizedLightDir);
    float hemisphereLight = max(lightDot, 0.0);

    // Calculate ring shadow if rings are present
    float ringShadow = 0.0;
    if (hasRings && hemisphereLight > 0.0) {
        // Calculate perpendicular to light direction using original method
        vec3 sunRadiusPerp = ringNormal - dot(normalizedLightDir, ringNormal) / dot(normalizedLightDir, normalizedLightDir) * normalizedLightDir;
        sunRadiusPerp = normalize(sunRadiusPerp) * lightRadius;

        ringShadow = eclipseByRings(vWorldPosition, sunRadiusPerp);
    }

    // Calculate body shadows (from moons, planets, etc.)
    float bodyShadow = eclipseByBodies(vWorldPosition);

    // Calculate full lighting first, then apply shadows to entire result
    vec3 ambient = baseColor.rgb * lightColor * 0.005; // Very low ambient for high contrast planet shadows
    vec3 diffuse = baseColor.rgb * lightColor * hemisphereLight;

    vec3 litColor = ambient + diffuse;

    // Apply both ring and body shadows
    float shadowIntensity = max(0.8, hemisphereLight); // Clamp to minimum 0.8 for higher shadow contrast
    float ringShadowFactor = 1.0 - (0.999 * ringShadow * shadowIntensity);
    float bodyShadowFactor = 1.0 - (0.999 * bodyShadow); // Maximum darkness body shadows (99.9% light blocked)

    // Combine shadows multiplicatively for realistic overlapping
    vec3 finalColor = litColor * ringShadowFactor * bodyShadowFactor;

    gl_FragColor = vec4(finalColor, baseColor.a);
}
`;

/**
 * PlanetShaderMaterial - A comprehensive Three.js material for rendering planets
 * Supports ring shadows, celestial body shadows (moons/planets), and realistic lighting
 * Based on the realistic Saturn shader technique from sangillee.com
 */
class PlanetShaderMaterial extends THREE.ShaderMaterial {
    constructor(options = {}) {
        const uniforms = {
            surfaceTexture: { value: options.surfaceTexture || null },
            ringAlphaTexture: { value: options.ringAlphaTexture || null },
            lightDirection: { value: new THREE.Vector3(1.0, 0.0, 0.0) },
            lightColor: { value: new THREE.Color(options.lightColor || 0xffffff) },
            ringNormal: { value: new THREE.Vector3(0.0, 1.0, 0.0) },
            planetCenter: { value: new THREE.Vector3(0.0, 0.0, 0.0) },
            ringInnerRadius: { value: options.ringInnerRadius || 1.0 },
            ringOuterRadius: { value: options.ringOuterRadius || 2.0 },
            lightRadius: { value: options.lightRadius || 0.1 },
            hasRings: { value: options.hasRings || false },
            bodyPositions: { value: Array(8).fill(null).map(() => new THREE.Vector3()) },
            bodyRadii: { value: new Float32Array(8) },
            numBodies: { value: 0 }
        };

        super({
            uniforms: uniforms,
            vertexShader: vertexShader,
            fragmentShader: ShaderLoader.createFragmentShader(fragmentShaderMainCode),
            side: THREE.FrontSide,
            transparent: false
        });

        // Store references for updates
        this.lightDirection = uniforms.lightDirection.value;
        this.lightColor = uniforms.lightColor.value;
        this.ringNormal = uniforms.ringNormal.value;
        this.planetCenter = uniforms.planetCenter.value;
    }

    /**
     * Update lighting parameters
     * @param {THREE.Vector3} lightPosition - Position of the light source (sun)
     * @param {THREE.Vector3} planetPosition - Position of the planet center
     * @param {THREE.Vector3} ringRotation - Ring rotation (for ring normal calculation)
     */
    updateLighting(lightPosition, planetPosition, ringRotation = null) {
        // Calculate light direction from planet to sun
        const direction = new THREE.Vector3().subVectors(lightPosition, planetPosition).normalize();
        this.uniforms.lightDirection.value.copy(direction);

        // Update planet center
        this.uniforms.planetCenter.value.copy(planetPosition);

        // Update ring normal if ring rotation is provided
        if (ringRotation) {
            // Default ring normal is (0, 1, 0), transform by ring rotation
            const normal = new THREE.Vector3(0, 1, 0);
            normal.applyEuler(ringRotation);
            this.uniforms.ringNormal.value.copy(normal);
        }
    }

    /**
     * Set light color
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
     * Set ring parameters
     * @param {number} innerRadius - Inner ring radius
     * @param {number} outerRadius - Outer ring radius
     * @param {THREE.Texture} alphaTexture - Ring alpha texture
     */
    setRingParameters(innerRadius, outerRadius, alphaTexture) {
        this.uniforms.ringInnerRadius.value = innerRadius;
        this.uniforms.ringOuterRadius.value = outerRadius;
        this.uniforms.ringAlphaTexture.value = alphaTexture;
        this.uniforms.hasRings.value = true;
    }

    /**
     * Set surface texture
     * @param {THREE.Texture} texture - Surface texture
     */
    setSurfaceTexture(texture) {
        this.uniforms.surfaceTexture.value = texture;
    }

    /**
     * Enable or disable ring shadows
     * @param {boolean} enabled - Whether ring shadows are enabled
     */
    setRingShadowsEnabled(enabled) {
        this.uniforms.hasRings.value = enabled;
    }

    /**
     * Update celestial body positions and radii for shadow calculations
     * @param {Array<THREE.Vector3>} positions - Array of body world positions
     * @param {Array<number>} radii - Array of body radii in world units
     */
    updateMoons(positions, radii) {
        const maxBodies = 8;
        const numBodies = Math.min(positions.length, maxBodies);

        this.uniforms.numBodies.value = numBodies;

        // Clear all body data first
        for (let i = 0; i < maxBodies; i++) {
            this.uniforms.bodyPositions.value[i].set(0, 0, 0);
            this.uniforms.bodyRadii.value[i] = 0;
        }

        // Set actual body data
        for (let i = 0; i < numBodies; i++) {
            this.uniforms.bodyPositions.value[i].copy(positions[i]);
            this.uniforms.bodyRadii.value[i] = radii[i];
        }
    }

    /**
     * Clear all body shadows
     */
    clearMoons() {
        this.uniforms.numBodies.value = 0;
    }
}

export default PlanetShaderMaterial;