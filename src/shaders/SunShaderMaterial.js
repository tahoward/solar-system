import * as THREE from 'three';
import ShaderLoader from './ShaderLoader.js';

const vertexShader = `
uniform float uTime;
uniform float uNoiseScale;

varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vNormalModel;
varying vec3 vNormalView;
varying vec3 vPosition;
varying vec3 vModelPosition;

// Hash function for Voronoi
vec3 hash3(vec3 p) {
    p = vec3(
        dot(p, vec3(127.1, 311.7, 74.7)),
        dot(p, vec3(269.5, 183.3, 246.1)),
        dot(p, vec3(113.5, 271.9, 124.6))
    );
    return fract(sin(p) * 43758.5453123);
}

// Voronoi distance for corn kernel displacement
float voronoiBump(vec3 p, float scale) {
    p *= scale;
    vec3 i = floor(p);
    vec3 f = fract(p);

    float minDist = 1.0;
    for (int x = -1; x <= 1; x++) {
        for (int y = -1; y <= 1; y++) {
            for (int z = -1; z <= 1; z++) {
                vec3 neighbor = vec3(float(x), float(y), float(z));
                vec3 point = hash3(i + neighbor);
                vec3 diff = neighbor + point - f;
                float dist = length(diff);
                minDist = min(minDist, dist);
            }
        }
    }
    return minDist;
}

void main() {
    vUv = uv;
    vNormalModel = normal;
    vModelPosition = position;

    // Compute Voronoi-based corn kernel displacement
    vec3 sphereNormal = normalize(position);
    float kernelScale = uNoiseScale * 20.0;
    float bump = voronoiBump(sphereNormal, kernelScale);

    // Very subtle rounded bumps
    float displacement = 1.0 - smoothstep(0.0, 0.7, bump);
    displacement = smoothstep(0.0, 1.0, displacement);
    displacement *= 0.0;

    // Displace along the normal
    vec3 displacedPos = position + sphereNormal * displacement;

    vNormal = normalize(mat3(modelMatrix) * normal);
    vNormalView = normalize(normalMatrix * normal);
    vPosition = normalize(vec3(modelViewMatrix * vec4(displacedPos, 1.0)).xyz);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(displacedPos, 1.0);
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
uniform vec3 uSunspotPositions[8];
uniform float uSunspotOpacities[8];
uniform float uSunspotRadii[8];

varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vNormalModel;
varying vec3 vNormalView;
varying vec3 vPosition;
varying vec3 vModelPosition;

// Hash for Voronoi cells (sin-free to avoid concentric banding)
vec3 hash3f(vec3 p) {
    vec3 q = vec3(
        dot(p, vec3(127.1, 311.7, 74.7)),
        dot(p, vec3(269.5, 183.3, 246.1)),
        dot(p, vec3(113.5, 271.9, 124.6))
    );
    return fract(q * fract(q * 0.3183099 + 0.1) * 17.0);
}

// Voronoi returning edge distance for corn kernel pattern
// Returns: x = distance to cell edge, y = cell random value
vec2 voronoiCorn(vec3 p, float scale, float time) {
    p *= scale;
    vec3 i = floor(p);
    vec3 f = fract(p);

    float minDist = 1.0;
    float secondDist = 1.0;
    float cellId = 0.0;

    // First pass: find nearest cell center
    for (int x = -1; x <= 1; x++) {
        for (int y = -1; y <= 1; y++) {
            for (int z = -1; z <= 1; z++) {
                vec3 neighbor = vec3(float(x), float(y), float(z));
                vec3 basePoint = hash3f(i + neighbor);
                // Each cell point orbits its base position
                vec3 point = basePoint + 0.15 * sin(time * 0.01 + basePoint * 6.2831);
                vec3 diff = neighbor + point - f;
                float dist = length(diff);
                if (dist < minDist) {
                    secondDist = minDist;
                    minDist = dist;
                    cellId = fract(sin(dot(i + neighbor, vec3(43.34, 81.74, 31.56))) * 4832.37);
                } else if (dist < secondDist) {
                    secondDist = dist;
                }
            }
        }
    }
    // Edge distance: how close this point is to boundary between two cells
    float edgeDist = (secondDist - minDist) * 0.5;
    return vec2(edgeDist, cellId);
}

void main() {
    vec3 surfacePos = vNormalModel;

    // Gentle noise warp to break concentric circle artifacts
    vec3 warpedPos = surfacePos + vec3(
        noise(surfacePos * 3.0 + vec3(0.0, 3.3, 7.7)),
        noise(surfacePos * 3.0 + vec3(4.4, 0.0, 2.2)),
        noise(surfacePos * 3.0 + vec3(8.8, 6.6, 0.0))
    ) * 0.08;

    // Cyclic time for slow animation
    float cyclicTime1 = sin(uTime * 0.0001) * 5000.0;
    float cyclicTime2 = cos(uTime * 0.0001 + 1.5708) * 5000.0;

    // Corn cob kernel pattern using Voronoi
    float kernelScale = uNoiseScale * 20.0;
    vec2 voronoi = voronoiCorn(warpedPos, kernelScale, uTime);
    float cellDist = voronoi.x;
    float cellId = voronoi.y;

    // cellDist is now edge distance: 0 = at boundary, larger = deep inside cell
    float edgeFade = smoothstep(0.0, 0.12, cellDist);

    // Sunspots: CPU-driven positions with per-spot radius and heavy warp
    vec3 nSurf = normalize(surfacePos);
    float sunspotRegion = 0.0;
    for (int i = 0; i < 8; i++) {
        float r = uSunspotRadii[i];
        // Strong directional warp seeded per-spot — low frequency for elongated blobs
        vec3 warpSeed = nSurf * 3.0 + uSunspotPositions[i] * 7.0;
        vec3 warp = vec3(
            noise(warpSeed + vec3(1.2, 3.4, 5.6)) - 0.5,
            noise(warpSeed + vec3(6.5, 2.1, 8.3)) - 0.5,
            noise(warpSeed + vec3(4.7, 9.0, 1.8)) - 0.5
        ) * r * 1.5;
        vec3 warpedSurf = normalize(nSurf + warp);
        float dist = distance(warpedSurf, uSunspotPositions[i]);
        float spot = smoothstep(r, r * 0.1, dist);
        sunspotRegion = max(sunspotRegion, spot * uSunspotOpacities[i]);
    }

    // Only cells with certain IDs become dark — creates irregular jagged boundary
    float cellInSunspot = step(0.4, cellId) * sunspotRegion;
    cellInSunspot *= uSunspotIntensity;

    // Pick cell color: orange normally, dark brown for sunspot cells
    vec3 orangeColor = vec3(1.0, 0.5, 0.0);
    vec3 darkOrange = vec3(0.6, 0.25, 0.0);
    vec3 sunspotColor = vec3(0.25, 0.12, 0.03);
    vec3 sunspotEdge = vec3(0.15, 0.07, 0.01);

    // Apply cell coloring with edges
    vec3 normalCell = mix(darkOrange, orangeColor, edgeFade);
    vec3 spotCell = mix(sunspotEdge, sunspotColor, edgeFade);

    vec3 color = mix(normalCell, spotCell, cellInSunspot);

    // Fresnel glow at edges
    float fresnel = 1.0 - abs(dot(vNormalView, vec3(0.0, 0.0, 1.0)));
    fresnel = pow(fresnel, 2.0);
    color += uGlowColor * fresnel * uGlowIntensity;

    // Brightness and bloom
    color *= uBrightness * 0.8;
    vec3 bloomBoost = color * uEmissiveIntensity;
    color = mix(color, bloomBoost, 0.7);

    gl_FragColor = vec4(color, 1.0);
}
`;

/**
 * SunShaderMaterial - A custom Three.js material for rendering a realistic animated sun
 */
class SunShaderMaterial extends THREE.ShaderMaterial {
    constructor(options = {}) {

        // Default uniform values
        const defaultPositions = new Array(8).fill(null).map(() => new THREE.Vector3(0, 1, 0));
        const uniforms = {
            uTime: { value: 0.0 },
            uGlowColor: { value: new THREE.Color(options.glowColor || 0xffaa00) },
            uGlowIntensity: { value: options.glowIntensity || 0.3 },
            uNoiseScale: { value: options.noiseScale || 5.0 },
            uBrightness: { value: options.brightness || 1.6 },
            uSunspotFrequency: { value: options.sunspotFrequency || 0.15 },
            uSunspotIntensity: { value: options.sunspotIntensity || 0.9 },
            uEmissiveIntensity: { value: options.emissiveIntensity || 1.3 },
            uSunspotPositions: { value: defaultPositions },
            uSunspotOpacities: { value: new Float32Array(8) },
            uSunspotRadii: { value: new Float32Array(8).fill(0.05) }
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
     * Update sunspot positions, opacities, and radii from SunspotManager
     */
    updateSunspots(positions, opacities, radii) {
        this.uniforms.uSunspotPositions.value = positions;
        this.uniforms.uSunspotOpacities.value = opacities;
        if (radii !== undefined) {
            this.uniforms.uSunspotRadii.value = radii;
        }
    }

    /**
     * Dispose of the material and its resources
     */
    dispose() {
        super.dispose();
    }
}

export default SunShaderMaterial;