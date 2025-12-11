import * as THREE from 'three';
import SunEffect from './SunEffect.js';
import ShaderUniformConfig from './ShaderUniformConfig.js';
import ShaderLoader from '../shaders/ShaderLoader.js';
import { log } from '../utils/Logger.js';

// Sun rays vertex shader main code - adapted from stable SunFlares architecture
const sunRaysVSMain = `
attribute vec3 aPos;         // UV coordinates (x=phase along ray, y=ray index, z=side offset)
attribute vec3 aPos0;        // Start position on sun surface
attribute vec3 aPos1;        // End position extending from sun surface
attribute vec4 aWireRandom;  // Random values for animation/variation

varying float vUVY;
varying float vOpacity;
varying vec3 vColor;
varying vec3 vNormal;
varying float vPhase;        // Phase along ray for gradient effects

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
uniform float uBendAmount;
uniform float uWhispyAmount;

vec3 getRayPosition(float phase, float animPhase) {
    // Use the fixed geometry positions with subtle animation
    vec3 rayOrigin = aPos0;  // Fixed start position below sun surface
    vec3 rayEnd = aPos1;     // Fixed end position from geometry

    // Add random directional bending to make rays curve organically
    vec3 baseDir = normalize(rayEnd - rayOrigin);

    // Create random perpendicular directions for each ray
    vec3 bendAxis1 = normalize(cross(baseDir, vec3(0.577, 0.577, 0.577))); // Non-aligned vector
    vec3 bendAxis2 = normalize(cross(baseDir, bendAxis1));

    // Configurable directional bending
    float bendAmount = phase * phase * phase * uBendAmount; // Progressive bending controlled by uniform
    vec2 bendOffset = vec2(
        (aWireRandom.x - 0.5) * bendAmount,
        (aWireRandom.y - 0.5) * bendAmount
    );

    // Bend the ray direction
    vec3 bentDirection = baseDir + bendAxis1 * bendOffset.x + bendAxis2 * bendOffset.y;
    vec3 bentEnd = rayOrigin + normalize(bentDirection) * length(rayEnd - rayOrigin);

    // Apply animation phase to ray length (makes rays pulse in length)
    vec3 animatedEnd = rayOrigin + (bentEnd - rayOrigin) * animPhase;

    // Interpolate along the animated ray path
    vec3 p = mix(rayOrigin, animatedEnd, phase);

    // Add organic whispy movement in random directions
    vec3 rayDir = normalize(rayOrigin);
    vec3 tangent1 = normalize(cross(rayDir, vec3(0.0, 1.0, 0.0)));
    vec3 tangent2 = normalize(cross(rayDir, tangent1));

    // Multiple layers of whispy motion with different frequencies
    float timeShift = uTime * 0.15 + aWireRandom.z * 6.28;
    float slowTime = uTime * 0.08 + aWireRandom.w * 3.14;
    float fastTime = uTime * 0.25 + aWireRandom.x * 12.56;

    // Configurable whispy motion - progressive toward tips
    vec2 primaryDrift = vec2(
        sin(timeShift + aWireRandom.y * 6.28) * 0.004 * uWhispyAmount,
        cos(timeShift * 1.4 + aWireRandom.z * 6.28) * 0.004 * uWhispyAmount
    );

    // Secondary organic motion - medium frequency
    vec2 secondaryDrift = vec2(
        sin(slowTime * 2.1 + aWireRandom.x * 6.28) * 0.002 * uWhispyAmount,
        cos(slowTime * 1.7 + aWireRandom.w * 6.28) * 0.002 * uWhispyAmount
    );

    // Fast shimmer motion - small amplitude, high frequency
    vec2 shimmerDrift = vec2(
        sin(fastTime + aWireRandom.z * 6.28) * 0.001 * uWhispyAmount,
        cos(fastTime * 1.8 + aWireRandom.y * 6.28) * 0.001 * uWhispyAmount
    );

    // Combine all motion layers with phase-based scaling
    vec2 totalDrift = primaryDrift + secondaryDrift + shimmerDrift;

    // Apply extreme progressive motion scaling - concentrated at tips only
    float motionScale = phase * phase * phase * phase * phase; // Quintic (5th power) for extreme tip concentration
    p += (tangent1 * totalDrift.x + tangent2 * totalDrift.y) * motionScale;

    return p;
}

void main(void) {
    vUVY = aPos.z;
    vPhase = aPos.x;  // Pass phase along ray to fragment shader

    // Animated rays with subtle movement and flickering
    float rayIndex = floor(aPos.y * 300.0); // Extract ray index for per-ray variation

    // Individual ray timing for natural variation
    float rayOffset = aWireRandom.y * 10.0; // Random time offset per ray
    float flickerSpeed = 0.8 + aWireRandom.x * 0.4; // Vary flicker speed per ray (0.8 to 1.2)
    float rayTime = uTime * flickerSpeed + rayOffset;

    // Subtle length pulsing animation - gentle height variation
    float lengthPulse = 0.95 + 0.05 * sin(rayTime * 0.2); // Pulse between 95% to 100% length
    float animPhase = lengthPulse;

    // Subtle opacity flickering like plasma activity
    float opacityFlicker = 0.7 + 0.3 * sin(rayTime * 0.5) * cos(rayTime * 0.7); // Gentle flickering
    float fadeFactor = opacityFlicker;

    // Get positions along the ray
    vec3 p  = getRayPosition(aPos.x,        animPhase);
    vec3 p1 = getRayPosition(aPos.x + 0.01, animPhase);

    // Transform ray positions to world space
    vec3 p0w = (modelMatrix * vec4(p , 1.0)).xyz;
    vec3 p1w = (modelMatrix * vec4(p1, 1.0)).xyz;

    // Calculate ray direction in world space
    vec3 dirW = normalize(p1w - p0w);

    // Create perpendicular vector for ray width
    vec3 viewW = normalize(p0w - uCamPos);
    vec3 sideW = normalize(cross(viewW, dirW));

    // Ray width - thin base tapering to pointy tips
    float widthFactor = (1.0 - aPos.x); // Start at full width, taper to zero at tip
    float width = uWidth * aPos.z * widthFactor * animPhase * 1.0;

    // Apply width perpendicular to ray direction
    vec3 pWorld = p0w + sideW * width;

    // Use ray direction from sun center for proper visibility culling
    vec3 sunCenter = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
    vNormal = normalize(pWorld - sunCenter);

    // Disable edge detection temporarily - show all rays
    float edgeFactor = 1.0; // Show all rays regardless of viewing angle

    vOpacity = uOpacity * fadeFactor * edgeFactor * (0.5 + aWireRandom.w);

    // Mix base color with spectrum variations
    vec3 spectrumColor = hue(aWireRandom.w * uHueSpread + uHue);
    vColor = mix(uBaseColor, spectrumColor, 0.1); // 10% spectrum variation, 90% base color

    gl_Position = uViewProjection * vec4(pWorld, 1.0);
}`;

// Sun rays fragment shader main code - same as flares architecture
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
varying float vPhase;

uniform float uAlphaBlended;

void main(void) {
    // Start with base opacity
    float alpha = 1.0;
    alpha *= vOpacity;

    // Calculate dot product between ray normal and light view direction
    vec3 rayToCamera = normalize(uLightView);
    float nDotL = dot(vNormal, rayToCamera);

    // Partial visibility for rays in front of sun - don't hide them completely
    // Rays facing away from camera (nDotL < 0) are fully visible
    // Rays facing toward camera (nDotL > 0) are partially dimmed but still visible
    if (nDotL > 0.2) {
        // Only dim rays that are significantly facing toward camera
        float dimFactor = smoothstep(0.2, 0.8, nDotL);
        alpha *= (1.0 - dimFactor * 0.6); // Reduce alpha by up to 60% (not 100%)
    }

    // Apply emissive intensity for bloom effect
    vec3 emissiveColor = vColor * uEmissiveIntensity;

    gl_FragColor = vec4(emissiveColor * alpha, alpha * uAlphaBlended);
}`;

/**
 * SunRays - Creates animated solar rays extending from the sun
 * Rewritten to follow the stable SunFlares architecture
 */
class SunRays extends SunEffect {
    constructor(options = {}) {

        // Call parent constructor with common options
        super({
            sunRadius: options.sunRadius || 1.0,
            lowres: options.lowres || false,
            effectName: '🌞 SunRays'
        });

        // Rays-specific configuration - increase count for denser corona
        this.rayCount = Math.min(options.rayCount || 8000, 4000); // Increase to 4000 rays for denser effect
        this.rayLength = options.rayLength || 0.01;  // Much shorter rays like in constants
        this.rayWidth = options.rayWidth || 0.0003;  // Much thinner like in constants
        this.rayOpacity = options.rayOpacity || 0.8;
        this.hue = options.hue || 0.1;
        this.hueSpread = options.hueSpread || 0.3;
        this.noiseFrequency = options.noiseFrequency || 0.8;
        this.noiseAmplitude = options.noiseAmplitude || 0.05;
        this.emissiveIntensity = options.emissiveIntensity || 1.5;
        this.bendAmount = options.bendAmount !== undefined ? options.bendAmount : 0.0;
        this.whispyAmount = options.whispyAmount !== undefined ? options.whispyAmount : 0.0;


        // Individual ray timing (same as flares)
        this.rayTimings = new Array(this.rayCount).fill().map(() => ({
            justRelocated: false
        }));

        // Create the rays geometry and material using stable architecture
        this.mesh = this.createRaysMesh();

        // Set base color if provided (for temperature-based coloring)
        if (options.baseColor !== undefined) {
            this.setBaseColor(options.baseColor);
        }
    }

    /**
     * Create the rays mesh using stable flares architecture
     * @returns {THREE.Mesh} The rays mesh
     */
    createRaysMesh() {
        // Use the centralized geometry creation method (adapted from flares)
        const geometry = this.createRaysGeometry();
        const material = new THREE.ShaderMaterial({
            vertexShader: ShaderLoader.createVertexShader(sunRaysVSMain),
            fragmentShader: ShaderLoader.createFragmentShader(sunRaysFSMain),
            transparent: true,
            premultipliedAlpha: true,
            depthWrite: false,
            depthTest: true,  // Same as flares - they work fine with depth testing
            blending: THREE.AdditiveBlending, // Keep additive for ray glow effect
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
                // Override uLength to ensure correct ray length
                uLength: { value: this.rayLength },
                uEmissiveIntensity: { value: this.emissiveIntensity },
                uBendAmount: { value: this.bendAmount },
                uWhispyAmount: { value: this.whispyAmount }
            }
        });


        // Store material reference for updates
        this.material = material;


        // Create and configure mesh (same as flares)
        const mesh = new THREE.Mesh(geometry, material);
        mesh.frustumCulled = false;
        mesh.renderOrder = 3; // Render after sun but before UI


        // Position rays at origin since they'll be added to the sun's rotating container
        mesh.position.set(0, 0, 0);

        return mesh;
    }

    /**
     * Extract geometry creation logic for reuse (adapted from flares)
     */
    createRaysGeometry() {
        const lineCount = this.rayCount;
        const lineLength = this.lowres ? 4 : 8;

        // Create arrays for vertex data (same structure as flares)
        const aPos = new Float32Array(lineCount * lineLength * 2 * 3);
        const aPos0 = new Float32Array(lineCount * lineLength * 2 * 3);
        const aPos1 = new Float32Array(lineCount * lineLength * 2 * 3);
        const aWireRand = new Float32Array(lineCount * lineLength * 2 * 4);
        const indices = new Uint16Array(lineCount * (lineLength - 1) * 2 * 3);

        let s = 0, l = 0, c = 0, h = 0, u = 0;

        // Generate ray lines - use random sphere distribution
        for (let y = 0; y < lineCount; y++) {
            // Random sphere distribution for more organic appearance
            const u1 = Math.random(); // Random [0,1)
            const u2 = Math.random(); // Random [0,1)

            // Convert to spherical coordinates using uniform random distribution
            const phi = Math.acos(2 * u1 - 1); // 0 to π (uniform in cosine)
            const theta = 2 * Math.PI * u2; // 0 to 2π (uniform)

            const rayDirection = new THREE.Vector3(
                Math.sin(phi) * Math.cos(theta),
                Math.sin(phi) * Math.sin(theta),
                Math.cos(phi)
            ).normalize();


            const rands = [Math.random(), Math.random(), Math.random(), Math.random()];

            // Generate vertices for this ray line (same structure as flares)
            for (let E = 0; E < lineLength; E++) {
                const base = 2 * (y * lineLength + E);

                for (let A = 0; A <= 1; A++) {
                    // Position attributes (UV coordinates)
                    aPos[s++] = (E + 0.5) / lineLength;
                    aPos[s++] = (y + 0.5) / lineCount;
                    aPos[s++] = 2 * A - 1;

                    // Random values for animation (same as flares)
                    for (let R = 0; R < 4; R++) {
                        aWireRand[l++] = rands[R];
                    }

                    // Ray start position (below sun surface so they emerge from within)
                    const startDepth = this.sunRadius * 0.98; // Start at 85% of sun radius (15% below surface)
                    aPos0[c++] = rayDirection.x * startDepth;
                    aPos0[c++] = rayDirection.y * startDepth;
                    aPos0[c++] = rayDirection.z * startDepth;

                    // Ray end position (extending outward from surface) - use configurable ray length
                    aPos1[h++] = rayDirection.x * (this.sunRadius + this.rayLength);
                    aPos1[h++] = rayDirection.y * (this.sunRadius + this.rayLength);
                    aPos1[h++] = rayDirection.z * (this.sunRadius + this.rayLength);
                }

                // Generate indices for triangles (same as flares)
                if (E < lineLength - 1) {
                    indices[u++] = base + 0;
                    indices[u++] = base + 1;
                    indices[u++] = base + 2;
                    indices[u++] = base + 2;
                    indices[u++] = base + 1;
                    indices[u++] = base + 3;
                }
            }
        }


        // Create geometry and set attributes (same as flares)
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('aPos', new THREE.BufferAttribute(aPos, 3));
        geometry.setAttribute('aPos0', new THREE.BufferAttribute(aPos0, 3));
        geometry.setAttribute('aPos1', new THREE.BufferAttribute(aPos1, 3));
        geometry.setAttribute('aWireRandom', new THREE.BufferAttribute(aWireRand, 4));
        geometry.setIndex(new THREE.BufferAttribute(indices, 1));

        return geometry;
    }

    /**
     * Update the rays animation (same pattern as flares)
     * @param {number} deltaTime - Time since last update
     * @param {THREE.Camera} camera - Camera for view matrix
     * @param {THREE.Vector3} sunPosition - World position of the sun
     */
    update(deltaTime, camera, sunPosition = new THREE.Vector3(0, 0, 0)) {
        this.time += deltaTime;

        if (!this.material) return;

        // Update camera and time using parent methods - shader handles individual ray timing
        this.updateCameraUniforms(camera);
        this.updateTime(this.time);

        // Update light direction (from sun to camera)
        const lightView = new THREE.Vector3().subVectors(camera.position, sunPosition).normalize();
        if (this.material.uniforms.uLightView) {
            this.material.uniforms.uLightView.value.copy(lightView);
        }
    }

    /**
     * Set ray parameters (adapted from flares)
     */
    setRayWidth(width) {
        if (this.mesh && this.mesh.material && this.mesh.material.uniforms.uWidth) {
            this.mesh.material.uniforms.uWidth.value = width;
        }
        this.rayWidth = width;
    }

    setRayOpacity(opacity) {
        if (this.mesh && this.mesh.material && this.mesh.material.uniforms.uOpacity) {
            this.mesh.material.uniforms.uOpacity.value = opacity;
        }
        this.rayOpacity = opacity;
    }

    setHue(hue) {
        if (this.mesh && this.mesh.material && this.mesh.material.uniforms.uHue) {
            this.mesh.material.uniforms.uHue.value = hue;
        }
        this.hue = hue;
    }

    setRayLength(length) {
        if (this.mesh && this.mesh.material && this.mesh.material.uniforms.uLength) {
            this.mesh.material.uniforms.uLength.value = length;
        }
        this.rayLength = length;

        // To fully change ray length, we need to regenerate the geometry
        // since ray end positions are baked into the geometry
        if (this.mesh) {
            log.debug('SunRays', `Updating ray length to ${length}`);
            const newGeometry = this.createRaysGeometry();
            this.mesh.geometry.dispose(); // Clean up old geometry
            this.mesh.geometry = newGeometry;
        }
    }

    getRayLength() {
        return this.rayLength;
    }

    setRayCount(count) {
        // Clamp the count to reasonable limits for performance
        const clampedCount = Math.min(Math.max(count, 100), 10000);

        if (this.rayCount !== clampedCount) {
            log.debug('SunRays', `Updating ray count from ${this.rayCount} to ${clampedCount}`);
            this.rayCount = clampedCount;

            // Regenerate geometry with new ray count
            if (this.mesh) {
                const newGeometry = this.createRaysGeometry();
                this.mesh.geometry.dispose(); // Clean up old geometry
                this.mesh.geometry = newGeometry;
            }
        }
    }

    getRayCount() {
        return this.rayCount;
    }

    setBendAmount(amount) {
        log.debug('SunRays', `Setting bend amount to: ${amount}`);
        if (this.mesh && this.mesh.material && this.mesh.material.uniforms.uBendAmount) {
            this.mesh.material.uniforms.uBendAmount.value = amount;
            log.debug('SunRays', `Updated uBendAmount uniform to: ${amount}`);
        } else {
            log.debug('SunRays', 'uBendAmount uniform not found or mesh not ready');
        }
        this.bendAmount = amount;
    }

    getBendAmount() {
        return this.bendAmount;
    }

    setWhispyAmount(amount) {
        if (this.mesh && this.mesh.material && this.mesh.material.uniforms.uWhispyAmount) {
            this.mesh.material.uniforms.uWhispyAmount.value = amount;
        }
        this.whispyAmount = amount;
    }

    getWhispyAmount() {
        return this.whispyAmount;
    }

    /**
     * Set emissive intensity for bloom control (same as flares)
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