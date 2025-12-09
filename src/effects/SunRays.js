import * as THREE from 'three';
import SunEffect from './SunEffect.js';
import ShaderUniformConfig from './ShaderUniformConfig.js';
import ShaderLoader from '../shaders/ShaderLoader.js';

// Sun rays vertex shader main code - utilities will be prepended
const sunRaysVSMain = `
attribute vec3 aPos;
attribute vec3 aPos0;
attribute vec4 aWireRandom;

varying float vUVY;
varying float vOpacity;
varying vec3 vColor;
varying vec3 vNormal;

uniform float uHueSpread;
uniform float uHue;
uniform vec3 uBaseColor;
uniform float uLength;
uniform float uWidth;
uniform float uTime;
uniform float uNoiseFrequency;
uniform float uNoiseAmplitude;
uniform vec3  uCamPos;
uniform mat4  uViewProjection;
uniform float uOpacity;

vec3 getPos(float phase, float animPhase)
{
    float size = aWireRandom.z + 0.2;
    float d = phase * uLength * size;
    // Make rays extend radially from sun center
    vec3 rayDirection = normalize(aPos0);
    vec3 p = aPos0 + rayDirection * d;

    // Add more organic, wispy flow with multiple noise layers
    float wispiness = d * d; // Increase noise effect with distance

    // Add per-ray random offsets to make each ray truly independent
    float rayRandomOffset = aWireRandom.x * 100.0; // Large random offset per ray
    float rayTimeOffset = aWireRandom.y * 10.0;    // Random time phase per ray
    float rayFreqScale = 0.5 + aWireRandom.z * 1.5; // Random frequency scale per ray

    vec4 noiseCoord = vec4(p * uNoiseFrequency * rayFreqScale, (uTime + rayTimeOffset) * 0.3);
    noiseCoord += vec4(rayRandomOffset, rayRandomOffset * 1.3, rayRandomOffset * 0.7, 0.0);

    // Get raw noise values with per-ray variations
    vec3 rawNoise1 = twistedSineNoise(noiseCoord, 0.707).xyz;
    vec3 rawNoise2 = twistedSineNoise(noiseCoord * (2.0 + aWireRandom.w), 0.6).xyz;
    vec3 rawNoise3 = twistedSineNoise(noiseCoord * (0.3 + aWireRandom.x * 0.5), 0.8).xyz;

    // Create local coordinate system for each ray with per-ray randomization
    vec3 rayDir = normalize(aPos0); // Radial direction from center

    // Add random rotation to the tangent orientation for each ray
    float rayRotation = aWireRandom.w * 6.28318; // Random rotation 0-2π per ray
    vec3 baseUp = vec3(0.0, 1.0, 0.0);
    if (abs(dot(rayDir, baseUp)) > 0.9) {
        baseUp = vec3(1.0, 0.0, 0.0); // Fallback for poles
    }

    vec3 tangent1 = normalize(cross(rayDir, baseUp));
    vec3 tangent2 = normalize(cross(rayDir, tangent1));

    // Apply random rotation to tangents for each ray independence
    float cosRot = cos(rayRotation);
    float sinRot = sin(rayRotation);
    vec3 rotatedTangent1 = tangent1 * cosRot + tangent2 * sinRot;
    vec3 rotatedTangent2 = -tangent1 * sinRot + tangent2 * cosRot;

    // Transform noise to local coordinate system of each ray with per-ray scaling
    float noiseScale1 = 0.5 + aWireRandom.x * 1.5; // Random scale per ray
    float noiseScale2 = 0.3 + aWireRandom.y * 1.0; // Different scale per ray
    float noiseScale3 = 0.8 + aWireRandom.z * 1.2; // Unique scale per ray

    vec3 localNoise1 = (rawNoise1.x * rotatedTangent1 + rawNoise1.y * rotatedTangent2 + rawNoise1.z * rayDir * 0.2) * noiseScale1;
    vec3 localNoise2 = (rawNoise2.x * rotatedTangent1 + rawNoise2.y * rotatedTangent2 + rawNoise2.z * rayDir * 0.2) * noiseScale2;
    vec3 localNoise3 = (rawNoise3.x * rotatedTangent1 + rawNoise3.y * rotatedTangent2 + rawNoise3.z * rayDir * 0.2) * noiseScale3;

    // Apply local noise with per-ray amplitude variations
    float amplitudeVariation1 = 1.5 + aWireRandom.w * 1.0; // Per-ray amplitude scaling
    float amplitudeVariation2 = 0.3 + aWireRandom.x * 0.4; // Different per ray
    float amplitudeVariation3 = 1.0 + aWireRandom.y * 1.0; // Unique per ray

    vec3 noise1 = localNoise1 * wispiness * uNoiseAmplitude * amplitudeVariation1;
    vec3 noise2 = localNoise2 * wispiness * uNoiseAmplitude * amplitudeVariation2;
    vec3 noise3 = localNoise3 * wispiness * uNoiseAmplitude * amplitudeVariation3;

    p += noise1 + noise2 + noise3;
    return p;
}

vec3 spectrum(in float d)
{
    return smoothstep(0.25, 0., abs(d + vec3(-0.375, -0.5, -0.625)));
}

void main(void) {
    vUVY = aPos.z;

    float animPhase = fract(uTime * 0.3 * (aWireRandom.y * 0.5) + aWireRandom.x);

    vec3 p  = getPos(aPos.x,        animPhase);
    vec3 p1 = getPos(aPos.x + 0.01, animPhase);

    // Transform ray positions to world space
    vec3 p0w = (modelMatrix * vec4(p , 1.0)).xyz;
    vec3 p1w = (modelMatrix * vec4(p1, 1.0)).xyz;

    // Calculate ray direction in world space (should be radial from center)
    vec3 dirW = normalize(p1w - p0w);

    // Create perpendicular vector for ray width using surface normal as reference
    vec3 surfaceNormal = normalize(p0w); // Direction from sun center to ray base
    vec3 tangent1 = normalize(cross(surfaceNormal, vec3(0.0, 1.0, 0.0)));
    if (length(tangent1) < 0.1) {
        tangent1 = normalize(cross(surfaceNormal, vec3(1.0, 0.0, 0.0)));
    }

    // Make rays much thicker at base (aPos.x = 0) and thinner at tips (aPos.x = 1)
    // Use cubic falloff for very dramatic tapering
    float widthFactor = (1.0 - aPos.x);
    widthFactor = widthFactor * widthFactor * widthFactor; // Cube for very dramatic tapering
    float width = uWidth * aPos.z * widthFactor * 8.0; // Multiply by 8 for much thicker base

    // Apply width perpendicular to both ray direction and surface normal
    vec3 sideW = normalize(cross(dirW, surfaceNormal));
    vec3 pWorld = p0w + sideW * width;

    vNormal  = normalize(pWorld);

    // Add edge detection to only show rays around circumference
    vec3 rayOriginWorld = normalize(pWorld);
    vec3 viewDirection = normalize(uCamPos);
    float edgeFactor = 1.0 - abs(dot(rayOriginWorld, viewDirection));

    // Sharp falloff to create corona effect - only rays at silhouette edge are visible
    edgeFactor = smoothstep(0.2, 0.5, edgeFactor);

    vOpacity = uOpacity * (0.5 + aWireRandom.w) * edgeFactor;
    // Mix base color with spectrum variations (less variation to preserve temperature color)
    vec3 spectrumColor = spectrum(aWireRandom.w * uHueSpread + uHue);
    vColor = mix(uBaseColor, spectrumColor, 0.1); // 10% spectrum variation, 90% base color

    gl_Position = uViewProjection * vec4(pWorld, 1.0);
}`;

// Sun rays fragment shader main code - utilities will be prepended
const sunRaysFSMain = `
uniform float uVisibility;
uniform float uDirection;
uniform vec3  uLightView;
uniform float uEmissiveIntensity;

float getAlpha(vec3 n){
  float nDotL = dot(n, uLightView) * uDirection;
  return smoothstep(1.0, 1.5, nDotL + uVisibility * 2.5);
}

varying float vUVY;
varying float vOpacity;
varying vec3  vColor;
varying vec3  vNormal;

uniform float uAlphaBlended;

void main(void) {
    float alpha = 1.0 - smoothstep(0.0, 1.0, abs(vUVY));
    alpha *= alpha;
    alpha *= vOpacity;
    alpha *= getAlpha(vNormal);

    // Apply emissive intensity for bloom effect
    vec3 emissiveColor = vColor * uEmissiveIntensity;

    gl_FragColor = vec4(emissiveColor * alpha, alpha);
}`;

/**
 * SunRays - Creates animated solar rays extending from the sun
 */
class SunRays extends SunEffect {
    constructor(options = {}) {
        // Call parent constructor with common options
        super({
            sunRadius: options.sunRadius || 1.0,
            lowres: options.lowres || false,
            effectName: '🌞 SunRays'
        });

        // Rays-specific configuration
        this.rayCount = options.rayCount || 80;
        this.rayLength = options.rayLength || 20;

        // Ray parameters
        this.rayWidth = options.rayWidth || 0.15;
        this.rayOpacity = options.rayOpacity || 0.8;
        this.hue = options.hue || 0.1;
        this.hueSpread = options.hueSpread || 0.3;
        this.noiseFrequency = options.noiseFrequency || 0.8;
        this.noiseAmplitude = options.noiseAmplitude || 0.05;
        this.emissiveIntensity = options.emissiveIntensity || 1.5;

        // Create the rays geometry and material
        this.mesh = this.createRays();

        // Set base color if provided (for temperature-based coloring)
        if (options.baseColor !== undefined) {
            this.setBaseColor(options.baseColor);
        }

    }

    /**
     * Create the sun rays mesh with geometry and shader material
     * @returns {THREE.Mesh} The rays mesh
     */
    createRays() {
        // Use the configured ray count instead of hardcoded values
        const lineCount = this.rayCount;
        const lineLength = this.lowres ? 4 : 8;
        const vertCount = lineCount * lineLength * 2;
        const triCount = lineCount * (lineLength - 1) * 2;

        // Create geometry attributes
        const aPos = new Float32Array(vertCount * 3);
        const aPos0 = new Float32Array(vertCount * 3);
        const aWireRand = new Float32Array(vertCount * 4);
        const indices = new Uint32Array(triCount * 3);

        // Generate ray geometry
        this.generateRayGeometry(aPos, aPos0, aWireRand, indices, lineCount, lineLength);

        // Create buffer geometry
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('aPos', new THREE.BufferAttribute(aPos, 3));
        geometry.setAttribute('aPos0', new THREE.BufferAttribute(aPos0, 3));
        geometry.setAttribute('aWireRandom', new THREE.BufferAttribute(aWireRand, 4));
        geometry.setIndex(new THREE.BufferAttribute(indices, 1));

        // Create shader material using centralized uniform configuration
        const material = new THREE.ShaderMaterial({
            vertexShader: ShaderLoader.createVertexShader(sunRaysVSMain),
            fragmentShader: ShaderLoader.createFragmentShader(sunRaysFSMain),
            transparent: true,
            premultipliedAlpha: true,
            depthWrite: false,
            depthTest: true,
            blending: THREE.AdditiveBlending,
            side: THREE.DoubleSide,
            toneMapped: false,  // Required for emissive > 1.0 to work with bloom
            uniforms: {
                ...ShaderUniformConfig.createCompleteRayUniforms({
                    lowres: this.lowres,
                    rayLength: this.rayLength,
                    rayWidth: this.rayWidth,
                    rayOpacity: this.rayOpacity,
                    hue: this.hue,
                    hueSpread: this.hueSpread,
                    noiseFrequency: this.noiseFrequency,
                    noiseAmplitude: this.noiseAmplitude,
                    alphaBlended: 0.3
                }),
                uEmissiveIntensity: { value: this.emissiveIntensity }
            }
        });

        // Store material reference for parent class methods
        this.material = material;

        // Create and configure mesh
        const mesh = new THREE.Mesh(geometry, material);
        mesh.frustumCulled = false;
        mesh.renderOrder = 3; // Render after sun but before UI

        // Position rays at origin since they'll be added to the sun's rotating container
        mesh.position.set(0, 0, 0);

        return mesh;
    }

    /**
     * Generate the procedural geometry for sun rays
     */
    generateRayGeometry(aPos, aPos0, aWireRand, indices, lineCount, lineLength) {
        const base = new THREE.Vector3();

        let ip = 0, i0 = 0, ir = 0, ii = 0;

        for (let v = 0; v < lineCount; v++) {
            // Use Fibonacci spiral for even distribution to avoid bald spots
            const goldenRatio = (1 + Math.sqrt(5)) / 2;
            const theta = 2 * Math.PI * v / goldenRatio;
            const y = 1 - (v / (lineCount - 1)) * 2;  // y from 1 to -1
            const radius = Math.sqrt(1 - y * y);

            base.set(
                Math.cos(theta) * radius,
                y,
                Math.sin(theta) * radius
            ).normalize();

            const rands = [Math.random(), Math.random(), Math.random(), Math.random()];

            for (let m = 0; m < lineLength; m++) {
                const vertBase = 2 * (v * lineLength + m);

                for (let y = 0; y <= 1; y++) {
                    // Position along ray (0-1) and across ray (-1 to 1)
                    aPos[ip++] = (m + 0.5) / lineLength;
                    aPos[ip++] = (v + 0.5) / lineCount;
                    aPos[ip++] = 2 * y - 1;

                    // Random values for variation
                    for (let t = 0; t < 4; t++) {
                        aWireRand[ir++] = rands[t];
                    }

                    // Ray origin point slightly below sun surface
                    const surfaceOffset = 0.95; // Start at 95% of sun radius (5% below surface)
                    aPos0[i0++] = base.x * this.sunRadius * surfaceOffset;
                    aPos0[i0++] = base.y * this.sunRadius * surfaceOffset;
                    aPos0[i0++] = base.z * this.sunRadius * surfaceOffset;
                }

                // Create triangle indices for ray segments
                if (m < lineLength - 1) {
                    const a = vertBase + 0;
                    const b = vertBase + 1;
                    const c = vertBase + 2;
                    const d = vertBase + 3;

                    indices[ii++] = a;
                    indices[ii++] = b;
                    indices[ii++] = c;
                    indices[ii++] = c;
                    indices[ii++] = b;
                    indices[ii++] = d;
                }
            }
        }
    }

    /**
     * Update the rays animation
     * @param {number} deltaTime - Time since last update
     * @param {THREE.Camera} camera - Camera for view matrix
     * @param {THREE.Vector3} sunPosition - World position of the sun
     */
    update(deltaTime, camera, sunPosition = new THREE.Vector3(0, 0, 0)) {
        this.time += deltaTime;

        if (!this.mesh || !this.mesh.material) return;

        // Update camera and time using parent methods
        this.updateCameraUniforms(camera);
        this.updateTime(this.time);

        // Update light direction (from sun to camera)
        const lightView = new THREE.Vector3().subVectors(camera.position, sunPosition).normalize();
        if (this.material.uniforms.uLightView) {
            this.material.uniforms.uLightView.value.copy(lightView);
        }
    }

    /**
     * Set ray parameters
     */
    setRayWidth(width) {
        if (this.mesh && this.mesh.material) {
            this.mesh.material.uniforms.uWidth.value = width;
        }
        this.rayWidth = width;
    }

    setRayOpacity(opacity) {
        if (this.mesh && this.mesh.material) {
            this.mesh.material.uniforms.uOpacity.value = opacity;
        }
        this.rayOpacity = opacity;
    }

    setHue(hue) {
        if (this.mesh && this.mesh.material) {
            this.mesh.material.uniforms.uHue.value = hue;
        }
        this.hue = hue;
    }

    /**
     * Set emissive intensity for bloom control
     * @param {number} intensity - The emissive intensity (>1.0 for bloom effect)
     */
    setEmissiveIntensity(intensity) {
        if (this.material) {
            // For ShaderMaterial, only update the shader uniform
            if (this.material.uniforms.uEmissiveIntensity) {
                this.material.uniforms.uEmissiveIntensity.value = intensity;
            }
        }
        this.emissiveIntensity = intensity;
    }

    /**
     * Get current emissive intensity
     * @returns {number} Current emissive intensity
     */
    getEmissiveIntensity() {
        return this.emissiveIntensity;
    }

    // Inherited from SunEffect:
    // - setBaseColor(color)
    // - setVisibility(visibility, direction, lightView)
    // - getMesh()
    // - addToScene(parent)
    // - removeFromScene(parent)
    // - dispose()
}

export default SunRays;