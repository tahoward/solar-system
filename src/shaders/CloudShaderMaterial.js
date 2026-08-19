import * as THREE from 'three';
import ShaderLoader from './ShaderLoader.js';
import BaseCelestialShaderMaterial from './BaseCelestialShaderMaterial.js';

const vertexShader = `
varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vSurfaceOffset;
varying vec3 vViewPosition;
varying vec3 vWorldNormal;

void main() {
    vUv = uv;

    // Calculate normal in world space for proper lighting
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    vNormal = normalize(normalMatrix * normal);

    // Position relative to the planet center, along world axes, for shadow
    // calculations. Kept planet-relative so it stays precise however far the
    // body drifts from the origin.
    vSurfaceOffset = mat3(modelMatrix) * position;

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
varying vec3 vSurfaceOffset;
varying vec3 vViewPosition;
varying vec3 vWorldNormal;

${BaseCelestialShaderMaterial.getCommonUniforms(true)}
${BaseCelestialShaderMaterial.getShadowCalculationShader()}

// Light the layer still receives where the sun does not reach it directly - scattered down out of the
// air around it. Small, but it keeps the terminator from being a hard edge and leaves night cloud
// faintly there rather than absent.
const float CLOUD_AMBIENT = 0.02;

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

        ringShadow = eclipseByRings(vSurfaceOffset, sunRadiusPerp);
    }

    // Calculate body shadows (from moons, planets, etc.)
    float bodyShadow = eclipseByBodies(vSurfaceOffset);

    // Apply shadows
    float shadowIntensity = max(0.8, hemisphereLight); // Clamp to minimum 0.8 for higher shadow contrast
    float ringShadowFactor = 1.0 - (0.8 * ringShadow * shadowIntensity); // Softer ring shadows for clouds
    float bodyShadowFactor = 1.0 - (0.9 * bodyShadow); // Slightly softer body shadows for clouds

    // Sunlight reaching the layer here, shadows combined multiplicatively so overlapping ones stack.
    float illumination = min(hemisphereLight + CLOUD_AMBIENT, 1.0) * ringShadowFactor * bodyShadowFactor;

    // How much of the pixel the layer fills.
    float coverage = cloudColor.a * cloudOpacity;

    // Cloud stands in for what is behind it in proportion to how much light it has to return, rather
    // than to how thick it is. Blending a layer in by its thickness alone is right only while it is
    // lit: with the sun off it the shell keeps hiding what it covers while having nothing to show in
    // its place, so it reads as a dark shape - and around the limb, where it is seen against the sky
    // instead of against the body, as a dark ring standing 1% off the night side. Where there is no
    // light there is no cloud, which costs nothing on the lit side, where this is the same blend as
    // ever, and confines the difference to the terminator and beyond it.
    gl_FragColor = vec4(cloudColor.rgb * lightColor, coverage * illumination);
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