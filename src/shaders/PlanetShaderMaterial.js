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
uniform sampler2D surfaceTexture;

varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vWorldPosition;
varying vec3 vViewPosition;
varying vec3 vWorldNormal;

${BaseCelestialShaderMaterial.getCommonUniforms(true)}
${BaseCelestialShaderMaterial.getShadowCalculationShader()}

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
 * Based on BaseCelestialShaderMaterial with planet-specific optimizations
 */
class PlanetShaderMaterial extends BaseCelestialShaderMaterial {
    constructor(options = {}) {
        const planetSpecificUniforms = {
            surfaceTexture: { value: options.surfaceTexture || null }
        };

        super({
            ...options,
            additionalUniforms: planetSpecificUniforms,
            materialOptions: {
                vertexShader: vertexShader,
                fragmentShader: ShaderLoader.createFragmentShader(fragmentShaderMainCode),
                side: THREE.FrontSide,
                transparent: false
            }
        });
    }

    // Inherited methods: updateLighting(), setLightColor(), setRingParameters(),
    // setRingShadowsEnabled(), updateMoons(), clearMoons()

    /**
     * Set surface texture
     * @param {THREE.Texture} texture - Surface texture
     */
    setSurfaceTexture(texture) {
        this.uniforms.surfaceTexture.value = texture;
    }

}

export default PlanetShaderMaterial;