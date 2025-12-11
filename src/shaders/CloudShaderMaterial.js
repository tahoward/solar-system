import * as THREE from 'three';
import ShaderLoader from './ShaderLoader.js';
import BaseCelestialShaderMaterial from './BaseCelestialShaderMaterial.js';

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
uniform sampler2D cloudTexture;
uniform float cloudOpacity;
uniform float alphaTest;

varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vWorldPosition;
varying vec3 vViewPosition;
varying vec3 vWorldNormal;

${BaseCelestialShaderMaterial.getCommonUniforms(true)}
${BaseCelestialShaderMaterial.getShadowCalculationShader()}

void main() {
    // Sample cloud texture
    vec4 cloudColor = texture2D(cloudTexture, vUv);

    // Apply alpha test to skip transparent pixels
    if (cloudColor.a < alphaTest) {
        discard;
    }

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

    // Calculate lighting with balanced day/night transition for clouds
    // Create good contrast while maintaining realistic atmospheric scattering
    float dayNightFactor = max(hemisphereLight * 0.8 + 0.2, 0.015); // Slightly softer transition with better night visibility
    vec3 ambient = cloudColor.rgb * lightColor * (0.025 * dayNightFactor); // Balanced ambient that scales with lighting
    vec3 diffuse = cloudColor.rgb * lightColor * hemisphereLight;

    vec3 litColor = ambient + diffuse;

    // Apply shadows
    float shadowIntensity = max(0.8, hemisphereLight); // Clamp to minimum 0.8 for higher shadow contrast
    float ringShadowFactor = 1.0 - (0.8 * ringShadow * shadowIntensity); // Softer ring shadows for clouds
    float bodyShadowFactor = 1.0 - (0.9 * bodyShadow); // Slightly softer body shadows for clouds

    // Combine shadows multiplicatively for realistic overlapping
    vec3 finalColor = litColor * ringShadowFactor * bodyShadowFactor;

    // Apply cloud opacity
    float finalOpacity = cloudColor.a * cloudOpacity;

    gl_FragColor = vec4(finalColor, finalOpacity);
}
`;

/**
 * CloudShaderMaterial - A comprehensive Three.js material for rendering planet clouds
 * Supports ring shadows, celestial body shadows (moons/planets), and realistic lighting
 * Based on BaseCelestialShaderMaterial but optimized for cloud rendering with transparency
 */
class CloudShaderMaterial extends BaseCelestialShaderMaterial {
    constructor(options = {}) {
        const cloudSpecificUniforms = {
            cloudTexture: { value: options.cloudTexture || null },
            cloudOpacity: { value: options.opacity || 0.8 },
            alphaTest: { value: options.alphaTest || 0.1 }
        };

        super({
            ...options,
            additionalUniforms: cloudSpecificUniforms,
            materialOptions: {
                vertexShader: vertexShader,
                fragmentShader: ShaderLoader.createFragmentShader(fragmentShaderMainCode),
                side: THREE.FrontSide,
                transparent: true,
                depthWrite: false, // Prevent z-fighting with planet surface
                blending: THREE.NormalBlending
            }
        });
    }

    // Inherited methods: updateLighting(), setLightColor(), setRingParameters(),
    // setRingShadowsEnabled(), updateMoons(), clearMoons()

    /**
     * Set cloud texture
     * @param {THREE.Texture} texture - Cloud texture
     */
    setCloudTexture(texture) {
        this.uniforms.cloudTexture.value = texture;
    }

    /**
     * Set cloud opacity
     * @param {number} opacity - Cloud opacity (0-1)
     */
    setOpacity(opacity) {
        this.uniforms.cloudOpacity.value = opacity;
    }

    /**
     * Set alpha test threshold
     * @param {number} threshold - Alpha test threshold (0-1)
     */
    setAlphaTest(threshold) {
        this.uniforms.alphaTest.value = threshold;
    }

}

export default CloudShaderMaterial;