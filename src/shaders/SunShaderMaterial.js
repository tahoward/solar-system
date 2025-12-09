import * as THREE from 'three';
import ShaderLoader from './ShaderLoader.js';

const vertexShader = `
varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vNormalModel;
varying vec3 vNormalView;
varying vec3 vPosition;

void main() {
    vUv = uv;
    vNormal = normalize(mat3(modelMatrix) * normal);
    vNormalModel = normal;
    vNormalView = normalize(normalMatrix * normal);
    vPosition = normalize(vec3(modelViewMatrix * vec4(position, 1.0)).xyz);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const fragmentShaderMainCode = `
uniform float uTime;
uniform vec3 uGlowColor;
uniform float uGlowIntensity;
uniform float uNoiseScale;
uniform float uBrightness;
uniform float uSunspotFrequency;
uniform float uSunspotIntensity;
uniform float uEmissiveIntensity;

varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vNormalModel;
varying vec3 vNormalView;
varying vec3 vPosition;

// Convert UV coordinates to 3D sphere surface coordinates
vec3 uvToSphere(vec2 uv) {
    float lon = uv.x * 2.0 * 3.14159265; // longitude 0 to 2π
    float lat = (uv.y - 0.5) * 3.14159265; // latitude -π/2 to π/2

    float x = cos(lat) * cos(lon);
    float y = sin(lat);
    float z = cos(lat) * sin(lon);

    return vec3(x, y, z);
}

void main() {
    // FULL SUN SHADER WITH WORKING SUNSPOTS
    // Use model-space normal (which rotates with the mesh) instead of view-space position
    // This ensures the surface pattern rotates with the sun
    vec3 surfacePos = vNormalModel;

    // Add very slow time-based evolution to the surface patterns
    // This creates very slow changes in the sun's surface over time, separate from rotation
    vec3 st = surfacePos + uTime * 0.0005;

    // Create domain warping using multiple noise octaves - much slower animation
    vec3 q = vec3(0.0);
    q.x = fBm(st + uTime * 0.0008, uNoiseScale);
    q.y = fBm(st + vec3(1.2, 3.2, 1.52) + uTime * 0.0005, uNoiseScale);
    q.z = fBm(st + vec3(0.02, 0.12, 0.152) + uTime * 0.001, uNoiseScale);

    // Create the main noise pattern - very slow evolution
    float n = fBm(st + q + vec3(1.82, 1.32, 1.09) + uTime * 0.0003, uNoiseScale);

    // Create additional noise pattern for darker color variations across all star types
    float darkerNoise = fBm(st * 1.4 + q * 0.7 + vec3(3.2, 2.1, 4.6) + uTime * 0.0002, uNoiseScale * 0.9);

    // Create noise pattern for temperature variations (different scale and evolution)
    float tempNoise = fBm(st * 0.8 + q * 0.5 + vec3(1.1, 4.3, 2.8) + uTime * 0.0001, uNoiseScale * 1.2);

    // Create color gradients for realistic sun appearance using glow color
    vec3 baseColor = uGlowColor.rgb;         // Use temperature-based color
    vec3 hotColor = vec3(1.0, 1.0, 1.0);    // White hot
    vec3 coronaColor = uGlowColor.rgb;       // Same as base color, not brighter

    // Create temperature-shifted color variations for surface depth
    // Cooler regions (shift dramatically towards red/orange)
    vec3 coolerColor = baseColor;
    coolerColor.r = min(coolerColor.r * 1.8, 1.0);  // Strong red enhancement
    coolerColor.g = coolerColor.g * 0.5;             // Significant green reduction
    coolerColor.b = coolerColor.b * 0.3;             // Strong blue reduction

    // Warmer regions (shift dramatically towards white/blue)
    vec3 warmerColor = baseColor;
    warmerColor.r = min(coolerColor.r * 1.4, 1.0);  // Moderate red increase
    warmerColor.g = min(baseColor.g * 1.6, 1.0);    // Strong green enhancement
    warmerColor.b = min(baseColor.b * 2.2, 1.0);    // Very strong blue enhancement

    // Create darker variation of the star color (works for any temperature/color)
    vec3 darkerColor = coolerColor * 0.4;           // Much darker regions
    darkerColor = pow(darkerColor, vec3(1.2));      // Increase saturation more dramatically
    darkerColor = max(darkerColor, vec3(0.05));     // Allow darker regions

    // Mix colors based on noise with enhanced contrast for surface detail
    vec3 color = mix(baseColor, hotColor, n * n * 1.2); // Increase surface contrast
    color = mix(color, coronaColor, q.x * 0.3); // Increase domain warping visibility

    // Add temperature-shifted color variations using different noise patterns
    // Use temperature noise for cooler regions (creates temperature pockets) - much stronger effect
    color = mix(color, coolerColor, tempNoise * 0.8 * (1.0 - n * 0.3));

    // Use domain warping for warmer regions (follows surface flow) - stronger effect
    color = mix(color, warmerColor, q.z * 0.7 * n);

    // Add dramatic temperature variations using the dedicated temperature noise
    color = mix(color, mix(coolerColor, warmerColor, tempNoise), abs(tempNoise - 0.5) * 0.6);

    // Add additional contrast using different noise combinations
    float contrastNoise = fBm(st * 2.5 + vec3(5.1, 2.3, 7.8), uNoiseScale * 0.6);
    color = mix(color, coolerColor * 0.8, contrastNoise * 0.4 * (1.0 - tempNoise));

    // Add darker color patches using the additional noise (works for any star color) - much stronger
    color = mix(color, darkerColor, darkerNoise * 0.9 * (1.0 - n * 0.5));

    // Add some variation for solar flares using temperature color
    float flare = fBm(st * 2.0 + uTime * 0.002, uNoiseScale * 0.5);
    color += uGlowColor.rgb * flare * 0.3;

    // ADD SUNSPOTS generated using noise patterns like the surface
    vec3 sunspotCoords = surfacePos; // Fixed to surface positions

    // Create sunspot noise coordinate system similar to surface
    float timeEvolution = uTime * 0.003; // Slower evolution for sunspots
    vec3 sunspotSt = sunspotCoords + timeEvolution * vec3(0.001, 0.002, 0.0015);

    // Create domain warping for sunspot generation (similar to surface)
    vec3 sunspotQ = vec3(0.0);
    sunspotQ.x = fBm(sunspotSt + timeEvolution * 0.1, uNoiseScale * 0.8);
    sunspotQ.y = fBm(sunspotSt + vec3(2.1, 4.2, 2.7) + timeEvolution * 0.12, uNoiseScale * 0.8);
    sunspotQ.z = fBm(sunspotSt + vec3(0.8, 1.4, 0.9) + timeEvolution * 0.08, uNoiseScale * 0.8);

    // Generate sunspot noise pattern using domain warping
    float sunspotNoise = fBm(sunspotSt + sunspotQ * 0.4 + vec3(3.2, 2.8, 1.9) + timeEvolution * 0.05, uNoiseScale);

    // Create sunspot threshold and intensity - balanced for sparse visibility
    float sunspotThreshold = 0.4 - uSunspotFrequency * 0.25; // Balanced threshold for sparse but visible sunspots
    float sunspotRaw = sunspotNoise - sunspotThreshold;

    // Create smooth sunspot blending with better visibility
    float combined = 0.0;
    if (sunspotRaw > 0.0) {
        // Create organic sunspot shape with smooth falloff and higher intensity
        float sunspotShape = smoothstep(0.0, 0.4, sunspotRaw) * (1.0 - smoothstep(0.6, 1.0, sunspotRaw));
        combined = sunspotShape * 2.0; // Increase intensity for visibility
    }

    // Convert to -1 to 1 range like noise
    float pseudoNoise = combined;

    // Apply sunspot formula with smooth blending
    float t1 = pseudoNoise * 1.5 - 0.8;
    float ss = max(0.0, t1);

    // Create smooth falloff for natural blending
    float sunspotBlend = smoothstep(0.0, 0.3, ss) * (1.0 - smoothstep(0.7, 1.0, ss));

    // Blend sunspots with existing surface noise instead of just subtracting
    float surfaceVariation = n * 0.3; // Use some of the existing surface noise
    float blendedIntensity = sunspotBlend * uSunspotIntensity * (0.8 + surfaceVariation);

    // Apply sunspots as a more visible darkening for better surface texture
    color *= (1.0 - blendedIntensity * 0.8); // Stronger sunspot contrast

    // Create fresnel effect for glow
    float fresnel = 1.0 - abs(dot(vNormalView, vec3(0.0, 0.0, 1.0)));
    fresnel = pow(fresnel, 2.0);

    // Add glow effect
    vec3 glowEffect = uGlowColor * fresnel * uGlowIntensity;
    color += glowEffect;

    // Apply brightness with surface detail preservation
    color *= uBrightness * 0.8; // Balanced brightness for surface texture

    // Add emissive bloom boost more subtly to prevent washout
    // Use a mix approach to preserve base colors while enabling bloom
    vec3 baseColorPreserved = color;
    vec3 bloomBoost = color * uEmissiveIntensity;

    // Blend base color with bloom boost to prevent total washout
    color = mix(baseColorPreserved, bloomBoost, 0.7);

    gl_FragColor = vec4(color, 1.0);
}
`;

/**
 * SunShaderMaterial - A custom Three.js material for rendering a realistic animated sun
 */
class SunShaderMaterial extends THREE.ShaderMaterial {
    constructor(options = {}) {

        // Default uniform values
        const uniforms = {
            uTime: { value: 0.0 },
            uGlowColor: { value: new THREE.Color(options.glowColor || 0xffaa00) },
            uGlowIntensity: { value: options.glowIntensity || 0.3 },
            uNoiseScale: { value: options.noiseScale || 5.0 },
            uBrightness: { value: options.brightness || 1.6 },
            uSunspotFrequency: { value: options.sunspotFrequency || 0.15 },
            uSunspotIntensity: { value: options.sunspotIntensity || 0.9 },
            uEmissiveIntensity: { value: options.emissiveIntensity || 1.3 }  // For runtime bloom control (reduced from 2.0)
        };

        super({
            uniforms,
            vertexShader,
            fragmentShader: ShaderLoader.createFragmentShader(fragmentShaderMainCode),
            transparent: false,
            side: THREE.FrontSide,
            toneMapped: false,  // Required for emissive > 1.0 to work with bloom
            ...options.materialOptions
        });

        // Store references for easy access
        this.uTime = uniforms.uTime;
        this.uGlowColor = uniforms.uGlowColor;
        this.uGlowIntensity = uniforms.uGlowIntensity;
        this.uNoiseScale = uniforms.uNoiseScale;
        this.uBrightness = uniforms.uBrightness;
        this.uSunspotFrequency = uniforms.uSunspotFrequency;
        this.uSunspotIntensity = uniforms.uSunspotIntensity;
        this.uEmissiveIntensity = uniforms.uEmissiveIntensity;
    }

    /**
     * Update the time uniform for animation
     * @param {number} time - Current time value
     */
    updateTime(time) {
        this.uTime.value = time;
    }

    /**
     * Set glow color
     * @param {number|THREE.Color} color - The glow color
     */
    setGlowColor(color) {
        if (typeof color === 'number') {
            this.uGlowColor.value.setHex(color);
        } else {
            this.uGlowColor.value.copy(color);
        }
    }

    /**
     * Set glow intensity
     * @param {number} intensity - The glow intensity (0-1)
     */
    setGlowIntensity(intensity) {
        this.uGlowIntensity.value = intensity;
    }

    /**
     * Set noise scale
     * @param {number} scale - The noise scale factor
     */
    setNoiseScale(scale) {
        this.uNoiseScale.value = scale;
    }

    /**
     * Set brightness
     * @param {number} brightness - The brightness multiplier
     */
    setBrightness(brightness) {
        this.uBrightness.value = brightness;
    }

    /**
     * Set sunspot frequency
     * @param {number} frequency - The sunspot frequency (higher = more frequent sunspots)
     */
    setSunspotFrequency(frequency) {
        this.uSunspotFrequency.value = frequency;
    }

    /**
     * Set sunspot intensity
     * @param {number} intensity - The sunspot intensity (0-1, where 1 = maximum darkness)
     */
    setSunspotIntensity(intensity) {
        this.uSunspotIntensity.value = intensity;
    }

    /**
     * Set emissive intensity for bloom control
     * @param {number} intensity - The emissive intensity (>1.0 for bloom effect)
     */
    setEmissiveIntensity(intensity) {
        this.uEmissiveIntensity.value = intensity;
        // Force update the emissive properties for Three.js bloom system
        this.emissiveIntensity = intensity;

        // Also ensure emissive color is bright enough for bloom detection
        // Use the glow color at full brightness for bloom
        if (this.emissive && this.uGlowColor) {
            this.emissive.copy(this.uGlowColor.value);
        }

        // Force the material to update by marking it as needing update
        this.needsUpdate = true;

    }


    /**
     * Dispose of the material and its resources
     */
    dispose() {
        super.dispose();
    }
}

export default SunShaderMaterial;