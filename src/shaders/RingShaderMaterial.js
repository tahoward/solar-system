import * as THREE from 'three';
import BaseCelestialShaderMaterial from './BaseCelestialShaderMaterial.js';

const vertexShader = `
varying vec2 vUv;
varying vec3 vWorldPosition;
varying vec3 vNormal;

void main() {
    vUv = uv;
    vNormal = normalize(normalMatrix * normal);

    // World position for shadow calculations
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    vWorldPosition = worldPosition.xyz;

    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const fragmentShader = `
uniform sampler2D ringTexture;
uniform float planetRadius;
uniform float opacity;
uniform vec3 ringColor;
uniform bool hasPlanetShadow;

${BaseCelestialShaderMaterial.getCommonUniforms(false)}

varying vec2 vUv;
varying vec3 vWorldPosition;
varying vec3 vNormal;

float calculatePlanetShadow(vec3 ringPosition) {
    if (!hasPlanetShadow) return 1.0;

    // Vector from planet center to ring position
    vec3 planetToRing = ringPosition - planetCenter;
    vec3 sunDirection = normalize(lightDirection);

    // Project ring position onto the sun direction (shadow axis)
    float projectionLength = dot(planetToRing, sunDirection);

    // Only consider points behind the planet (negative projection)
    if (projectionLength > 0.0) {
        return 1.0; // Ring is on sun side, no shadow
    }

    // Calculate perpendicular distance from shadow axis
    vec3 shadowAxis = projectionLength * sunDirection;
    vec3 perpendicular = planetToRing - shadowAxis;
    float perpDistance = length(perpendicular);

    // Shadow radius is equal to planet radius (circular shadow)
    if (perpDistance <= planetRadius) {
        return 0.001; // Completely black shadow
    }

    return 1.0; // No shadow
}

void main() {
    // Sample ring texture
    vec4 baseColor = texture2D(ringTexture, vUv);

    // Use uniform lighting for rings (no normal-based dimming)
    vec3 lightDir = normalize(lightDirection);
    vec3 normal = normalize(vNormal);

    // For rings, use more uniform lighting to avoid unwanted darkening
    float lightIntensity = 0.8 + 0.2 * max(dot(normal, lightDir), 0.0);

    // Calculate planet shadow on ring
    float shadowFactor = calculatePlanetShadow(vWorldPosition);

    // Apply lighting and shadows
    vec3 ambient = baseColor.rgb * lightColor * 0.1;
    vec3 diffuse = baseColor.rgb * lightColor * lightIntensity;

    vec3 litColor = ambient + diffuse;

    // Apply shadow to the entire final color, not just diffuse
    vec3 finalColor = litColor * shadowFactor;
    float finalOpacity = baseColor.a * opacity;

    gl_FragColor = vec4(finalColor, finalOpacity);
}
`;

/**
 * RingShaderMaterial - A custom shader material for rings with planet shadow casting
 * Based on BaseCelestialShaderMaterial with ring-specific features
 */
class RingShaderMaterial extends BaseCelestialShaderMaterial {
    constructor(options = {}) {
        const ringSpecificUniforms = {
            ringTexture: { value: options.ringTexture || null },
            planetRadius: { value: options.planetRadius || 1.0 },
            opacity: { value: options.opacity || 1.0 },
            ringColor: { value: new THREE.Color(options.ringColor || 0xffffff) },
            hasPlanetShadow: { value: options.hasPlanetShadow !== false }
        };

        super({
            ...options,
            supportsShadows: false, // Rings don't need the complex shadow system
            additionalUniforms: ringSpecificUniforms,
            materialOptions: {
                vertexShader: vertexShader,
                fragmentShader: fragmentShader,
                transparent: true,
                side: THREE.FrontSide, // Match original ring material
                alphaTest: 0.1
            }
        });
    }

    // Inherited methods: updateLighting(), setLightColor()

    /**
     * Set planet parameters for shadow casting
     * @param {number} radius - Planet radius
     */
    setPlanetRadius(radius) {
        this.uniforms.planetRadius.value = radius;
    }

    /**
     * Enable or disable planet shadows
     * @param {boolean} enabled - Whether planet shadows are enabled
     */
    setPlanetShadowEnabled(enabled) {
        this.uniforms.hasPlanetShadow.value = enabled;
    }
}

export default RingShaderMaterial;