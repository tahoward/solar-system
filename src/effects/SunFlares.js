import * as THREE from 'three';
import SunEffect from './SunEffect.js';
import ShaderUniformConfig from './ShaderUniformConfig.js';
import ShaderLoader from '../shaders/ShaderLoader.js';

// Vertex shader source - utilities will be prepended automatically
const vertexShaderMainCode = `
attribute vec3 aPos;         // UV coordinates (x=phase along line, y=line index, z=side offset)
attribute vec3 aPos0;        // Start position on sun surface
attribute vec3 aPos1;        // End position on sun surface
attribute vec4 aWireRandom;  // Random values for animation/variation

varying float vUVY;
varying float vOpacity;
varying vec3  vColor;
varying vec3  vNormal;       // World normal for lighting
varying float vPhase;        // Phase along flare for gradient effects

uniform float uWidth;
uniform float uAmp;
uniform float uTime;
uniform float uNoiseFrequency;
uniform float uNoiseAmplitude;
uniform vec3  uCamPos;       // Camera world position
uniform mat4  uViewProjection;
uniform float uOpacity;
uniform float uHueSpread;
uniform float uHue;
uniform vec3 uBaseColor;
uniform vec3 uSunspotPositions[8];
uniform float uSunspotOpacities[8];
uniform float uSunspotVisual[8];
uniform float uSunspotRadii[8];

vec3 getPosOBJ(float phase, float animPhase){
  float flareIndex = floor(aPos.y * 32.0);
  float totalLifetime = uTime + aWireRandom.y * 50.0 + flareIndex * 1.7;
  float flareLifespan = 1.5 + aWireRandom.x * 4.0;
  float lifecycleCount = floor(totalLifetime / flareLifespan);

  // Each spot gets up to 4 flare slots; which slot this flare occupies within its spot
  int spotIndex = int(mod(floor(flareIndex / 4.0), 8.0));
  float slotInSpot = mod(flareIndex, 4.0);
  vec3 spotPos = uSunspotPositions[spotIndex];
  float spotOpacity = uSunspotOpacities[spotIndex];
  float spotRadius = uSunspotRadii[spotIndex];

  // Number of active flares scales with spot radius (0.0075 = 1 flare, 0.015 = 4 flares)
  float maxFlares = clamp(floor((spotRadius - 0.005) / 0.003) + 1.0, 1.0, 4.0);
  // Hide this flare if its slot exceeds the count for this spot
  float slotVisible = step(slotInSpot, maxFlares - 0.5);


  // Deterministic bridge target — fixed per flare, never changes mid-animation
  int bridgeTarget = int(mod(floor(fract(sin(flareIndex * 13.37 + 3.7) * 43758.5453) * 7.0), 7.0));
  if (bridgeTarget >= spotIndex) bridgeTarget++;

  // Generate position within the sunspot boundary
  float startDepth = length(aPos0);
  float clusterRadius = 0.03;

  float seed1 = fract(sin(flareIndex * 43.758 + lifecycleCount * 12.9898) * 43758.5453);
  float seed2 = fract(sin(flareIndex * 78.233 + lifecycleCount * 19.134) * 43758.5453);

  // Create an offset from spot center using a tangent frame
  vec3 up = abs(spotPos.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
  vec3 tangent = normalize(cross(spotPos, up));
  vec3 bitangent = normalize(cross(spotPos, tangent));

  vec3 offset = tangent * (seed1 - 0.5) * clusterRadius + bitangent * (seed2 - 0.5) * clusterRadius;
  vec3 pos0 = normalize(spotPos + offset) * startDepth;

  // Always compute local endpoint
  float offsetAngle = (fract(sin(flareIndex * 23.456 + lifecycleCount * 7.891) * 43758.5453) - 0.5) * 0.04;
  float offsetDir = fract(sin(flareIndex * 34.567 + lifecycleCount * 8.912) * 43758.5453) * 6.28318;
  vec3 offset2 = tangent * cos(offsetDir) * offsetAngle + bitangent * sin(offsetDir) * offsetAngle;
  vec3 localPos1 = normalize(spotPos + offset + offset2) * startDepth;

  // Always compute bridge endpoint
  vec3 targetSpot = uSunspotPositions[bridgeTarget];
  vec3 upT = abs(targetSpot.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
  vec3 tanT = normalize(cross(targetSpot, upT));
  vec3 bitT = normalize(cross(targetSpot, tanT));
  float s1 = fract(sin(flareIndex * 67.891 + lifecycleCount * 5.432) * 43758.5453);
  float s2 = fract(sin(flareIndex * 91.234 + lifecycleCount * 3.210) * 43758.5453);
  vec3 offsetT = tanT * (s1 - 0.5) * clusterRadius + bitT * (s2 - 0.5) * clusterRadius;
  vec3 bridgePos1 = normalize(targetSpot + offsetT) * startDepth;

  // Smooth blend factor: 1.0 = full bridge, 0.0 = local
  float bridgeDist = distance(spotPos, targetSpot);
  float bridgeProximity = smoothstep(0.3, 0.15, bridgeDist);
  float targetVisible = smoothstep(0.0, 0.5, uSunspotVisual[bridgeTarget]);
  float isBridgeCandidate = step(2.0, mod(flareIndex, 4.0)); // half the flares can bridge
  float isBridge = bridgeProximity * targetVisible * (1.0 - isBridgeCandidate);

  vec3 pos1 = mix(localPos1, bridgePos1, isBridge);

  float size = distance(pos0, pos1);
  vec3  n    = normalize((pos0 + pos1) * 0.5);

  vec3 p = mix(pos0, pos1, phase);

  float heightSeed = sin(flareIndex * 17.432 + lifecycleCount * 3.789) * 43758.5453;
  float baseHeightVariation = 0.4 + fract(heightSeed) * 1.2;
  float segmentVariation = 0.85 + aWireRandom.w * 0.3;
  float heightVariation = baseHeightVariation * segmentVariation;

  // Use sun radius as height reference; bridge flares scale with span
  float heightScale = isBridge > 0.5 ? distance(pos0, pos1) * 0.5 : startDepth * 0.05;
  float amp = sin(phase * 3.14159265) * heightScale * uAmp * heightVariation;
  amp *= animPhase * slotVisible;

  p += n * amp;

  p += twistedSineNoise(vec4(p * uNoiseFrequency, uTime), 0.707).xyz
       * (amp * uNoiseAmplitude);

  return p;
}

void main(void){
  vUVY = aPos.z;
  vPhase = aPos.x;  // Pass phase along flare to fragment shader

  // Individual flare timing - each complete flare has its own lifecycle
  // aPos.y is normalized: (lineIndex + 0.5) / lineCount, so we extract the original line index
  // All segments of the same line (same flare) should animate together
  float flareIndex = floor(aPos.y * 32.0); // Convert normalized Y back to line index (0-31)

  float flareLifespan = 1.5 + aWireRandom.x * 4.0; // 1.5-5.5 second lifespan per flare
  float flareOffset = aWireRandom.y * 50.0 + floor(aPos.y * 32.0) * 1.7;
  float flareTime = mod(uTime + flareOffset, flareLifespan);
  float animPhase = flareTime / flareLifespan;

  // Add fade in/out for individual flares
  float fadeFactor = 1.0;
  if (animPhase < 0.2) {
    fadeFactor = smoothstep(0.0, 0.2, animPhase); // Fade in
  } else if (animPhase > 0.8) {
    fadeFactor = smoothstep(1.0, 0.8, animPhase); // Fade out
  }

  // Get spot flareActive for this flare's source spot
  int spotIdx = int(mod(floor(aPos.y * 32.0) / 4.0, 8.0));
  float spotActive = uSunspotOpacities[spotIdx];
  // Don't start new flares when spot is inactive — suppress at fade-in only
  if (spotActive < 0.1 && animPhase < 0.2) {
    fadeFactor = 0.0;
  }
  // Smooth overall fade with spot activity
  fadeFactor *= smoothstep(0.0, 0.3, spotActive);

  // Get positions along the flare arc
  vec3 pOBJ  = getPosOBJ(aPos.x,        animPhase);
  vec3 p1OBJ = getPosOBJ(aPos.x + 0.01, animPhase);

  // Transform to world space
  vec3 pW  = (modelMatrix * vec4(pOBJ , 1.0)).xyz;
  vec3 p1W = (modelMatrix * vec4(p1OBJ, 1.0)).xyz;

  vec3 dirW  = normalize(p1W - pW);
  vec3 vW    = normalize(pW - uCamPos);
  vec3 sideW = normalize(cross(vW, dirW));

  // Sun radius reference
  float R = length(aPos0);

  float width = uWidth * aPos.z * (1.0 + animPhase) * R;

  // Add 3D spread to individual strands within the flare for volume
  // Create perpendicular vectors for 3D spread
  vec3 up = normalize(cross(sideW, dirW)); // Up direction relative to flare

  // Use random values to create 3D strand offset - but only in the outward direction
  // This keeps strands anchored to star surface while allowing spread
  // Parabolic spread: zero at both ends (star contact points), maximum at apex (middle)
  float spreadAmount = 0.04 * sin(aPos.x * 3.14159); // Very subtle sine wave: 0 at ends, minimal spread at middle
  vec3 strandOffset = (
    sideW * (aWireRandom.z - 0.5) * spreadAmount * R +     // Side spread
    up * (aWireRandom.w - 0.5) * spreadAmount * R          // Up/down spread
  );

  // Apply base width
  pW += sideW * width;

  // Apply 3D strand spread with sine curve: zero at both ends, maximum at apex
  // At both ends (aPos.x = 0 or 1): no spread, stays connected to star
  // At middle (aPos.x = 0.5): maximum spread at arc apex
  float spreadFactor = sin(aPos.x * 3.14159); // Same sine pattern as spreadAmount
  pW += strandOffset * spreadFactor;

  // World normal for lighting calculations
  vNormal  = normalize(pW);

  // Opacity calculation with distance falloff
  float lenW = length(pW);
  vOpacity  = smoothstep(R, R * 1.03, lenW);

  // Apply individual flare fade timing
  vOpacity *= fadeFactor; // Use the per-flare fade factor
  vOpacity *= uOpacity;

  // Mix base color with hue variations (less hue variation to preserve temperature color)
  vec3 hueVariation = hue(aWireRandom.w * uHueSpread + uHue);
  vColor = mix(uBaseColor, hueVariation, 0.1); // 10% hue variation, 90% base color

  gl_Position = uViewProjection * vec4(pW, 1.0);
}`;

const fragmentShaderMainCode = `
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

void main(void){
    // Create smooth falloff along the flare
    float alpha = smoothstep(1.0, 0.0, abs(vUVY));
    alpha *= alpha;
    alpha *= vOpacity;
    alpha *= getAlpha(vNormal);  // Lighting-based visibility

    // Remove dark roots - keep flares at consistent brightness
    float brightnessFactor = 1.0; // No darkening at start/end

    // Apply emissive intensity for bloom effect
    vec3 emissiveColor = vColor * uEmissiveIntensity;

    // Apply the brightness gradient
    emissiveColor *= brightnessFactor;

    gl_FragColor = vec4(emissiveColor * alpha, alpha * uAlphaBlended);
}`;

/**
 * SunFlares - Creates dynamic solar flare effects around the sun
 * These are arcing "magma ribbons" that appear around the sun's rim
 */
class SunFlares extends SunEffect {
    constructor(options = {}) {
        // Call parent constructor with common options
        super({
            sunRadius: options.sunRadius || 1.49,
            lowres: options.lowres || false,
            effectName: '🔥 SunFlares'
        });

        // Flares-specific configuration
        this.lineCount = options.lineCount || 2047;
        this.lineLength = options.lineLength || 16;
        this.flareOpacity = options.opacity || 0.8;
        this.emissiveIntensity = options.emissiveIntensity || 2.0;

        // Individual flare timing
        this.flareTimings = new Array(this.lineCount).fill().map(() => ({
            justRelocated: false // Flag to prevent immediate re-relocation
        }));

        // Create the flares geometry and material
        this.mesh = this.createFlaresMesh();

        // Set base color if provided (for temperature-based coloring)
        if (options.baseColor !== undefined) {
            this.setBaseColor(options.baseColor);
        }

    }

    /**
     * Create the complex geometry for solar flares
     * @returns {THREE.Mesh} The flares mesh
     */
    createFlaresMesh() {
        // Use the centralized geometry creation method
        const geometry = this.createFlaresGeometry();

        const defaultPositions = new Array(8).fill(null).map(() => new THREE.Vector3(0, 1, 0));
        // Create material with shader using centralized uniform configuration
        const material = new THREE.ShaderMaterial({
            vertexShader: ShaderLoader.createVertexShader(vertexShaderMainCode),
            fragmentShader: ShaderLoader.createFragmentShader(fragmentShaderMainCode),
            transparent: true,
            premultipliedAlpha: true,
            depthWrite: false,
            depthTest: true,
            blending: THREE.NormalBlending,
            side: THREE.DoubleSide,
            toneMapped: false,
            uniforms: {
                ...ShaderUniformConfig.createCompleteFlareUniforms({
                    lowres: this.lowres,
                    lineLength: this.lineLength,
                    lineCount: this.lineCount,
                    opacity: this.flareOpacity
                }),
                uEmissiveIntensity: { value: this.emissiveIntensity },
                uSunspotPositions: { value: defaultPositions },
                uSunspotOpacities: { value: new Float32Array(8) },
                uSunspotVisual: { value: new Float32Array(8) },
                uSunspotRadii: { value: new Float32Array(8) }
            }
        });

        // Store material reference for updates
        this.material = material;

        const mesh = new THREE.Mesh(geometry, material);
        mesh.frustumCulled = false;
        mesh.renderOrder = 1;

        return mesh;
    }

    /**
     * Relocate a single flare to a new random position
     * @param {number} flareIndex - Index of the flare to relocate (0 to lineCount-1)
     */
    relocateSingleFlare(flareIndex) {
        if (!this.mesh || !this.mesh.geometry) return;

        const geometry = this.mesh.geometry;
        const aPos0 = geometry.getAttribute('aPos0');
        const aPos1 = geometry.getAttribute('aPos1');
        const aWireRandom = geometry.getAttribute('aWireRandom');

        // Generate new random positions for this specific flare
        const f = new THREE.Vector3(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1).normalize();
        const p = new THREE.Vector3(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1).normalize();

        // Apply the same perturbations as in original generation
        const g1 = new THREE.Vector3(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1).normalize().multiplyScalar(0.2);
        const g2 = new THREE.Vector3(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1).normalize().multiplyScalar(0.04);
        f.add(g1).normalize();
        p.add(g2).normalize();

        const startDepth = this.sunRadius * 0.98;

        // Generate new timing parameters for relocated flare to ensure clean restart
        const firstVertexIndex = (flareIndex * this.lineLength) * 2;
        const newRands = [
            Math.random(), // New lifespan random (5-10 seconds)
            Math.random(), // New offset random (restart timing)
            aWireRandom.getZ(firstVertexIndex), // Keep existing third random
            Math.random() // New height variation
        ];

        // Update all vertices for this specific flare line
        for (let E = 0; E < this.lineLength; E++) {
            for (let A = 0; A <= 1; A++) {
                const vertexIndex = (flareIndex * this.lineLength + E) * 2 + A;

                // Update endpoint positions only
                aPos0.setXYZ(vertexIndex, f.x * startDepth, f.y * startDepth, f.z * startDepth);
                aPos1.setXYZ(vertexIndex, p.x * startDepth, p.y * startDepth, p.z * startDepth);

                // Update all random values for clean restart and new variation
                aWireRandom.setXYZW(vertexIndex, newRands[0], newRands[1], newRands[2], newRands[3]);
            }
        }

        // Mark attributes as needing GPU update
        aPos0.needsUpdate = true;
        aPos1.needsUpdate = true;
        aWireRandom.needsUpdate = true;
    }

    /**
     * Extract geometry creation logic for reuse
     */
    createFlaresGeometry() {
        const { lineCount, lineLength, sunRadius } = this;

        // Create arrays for vertex data
        const aPos = new Float32Array(lineCount * lineLength * 2 * 3);
        const aPos0 = new Float32Array(lineCount * lineLength * 2 * 3);
        const aPos1 = new Float32Array(lineCount * lineLength * 2 * 3);
        const aWireRand = new Float32Array(lineCount * lineLength * 2 * 4);
        const indices = new Uint16Array(lineCount * (lineLength - 1) * 2 * 3);

        // Temporary vectors for calculations
        const held = new THREE.Vector3();
        const d = new THREE.Vector3();
        const f = new THREE.Vector3();
        const p = new THREE.Vector3();
        const g = new THREE.Vector3();

        let s = 0, l = 0, c = 0, h = 0, u = 0;

        // Initialize direction
        f.set(Math.random(), Math.random(), Math.random()).normalize();
        let m = Math.random(), _p = Math.random();

        // Generate flare lines (same logic as createFlaresMesh)
        for (let y = 0; y < lineCount; y++) {
            // Occasionally generate new random directions
            if (Math.random() < 0.025 || y === 0) {
                d.set(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1).normalize();
                held.copy(d);
                g.set(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1).normalize().multiplyScalar(0.2);
                held.add(g).normalize();
                m = Math.random();
                _p = Math.random();
            }

            // Update directions with slight perturbations
            f.copy(d);
            g.set(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1).normalize().multiplyScalar(0.02);
            f.add(g).normalize();

            p.copy(held);
            g.set(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1).normalize().multiplyScalar(0.04);
            p.add(g).normalize();

            const rands = [m, _p, Math.random(), Math.random()];

            // Generate vertices for this line
            for (let E = 0; E < lineLength; E++) {
                const base = 2 * (y * lineLength + E);

                for (let A = 0; A <= 1; A++) {
                    // Position attributes (UV coordinates)
                    aPos[s++] = (E + 0.5) / lineLength;
                    aPos[s++] = (y + 0.5) / lineCount;
                    aPos[s++] = 2 * A - 1;

                    // Random values for animation
                    for (let R = 0; R < 4; R++) {
                        aWireRand[l++] = rands[R];
                    }

                    // Start position (closer to sun surface for better visibility of dark ends)
                    const startDepth = sunRadius * 0.995; // Start only 0.5% below surface
                    aPos0[c++] = f.x * startDepth;
                    aPos0[c++] = f.y * startDepth;
                    aPos0[c++] = f.z * startDepth;

                    // End position (slightly below sun surface)
                    aPos1[h++] = p.x * startDepth;
                    aPos1[h++] = p.y * startDepth;
                    aPos1[h++] = p.z * startDepth;
                }

                // Generate indices for triangles
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

        // Create geometry and set attributes
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('aPos', new THREE.BufferAttribute(aPos, 3));
        geometry.setAttribute('aPos0', new THREE.BufferAttribute(aPos0, 3));
        geometry.setAttribute('aPos1', new THREE.BufferAttribute(aPos1, 3));
        geometry.setAttribute('aWireRandom', new THREE.BufferAttribute(aWireRand, 4));
        geometry.setIndex(new THREE.BufferAttribute(indices, 1));

        return geometry;
    }

    /**
     * Update the flares animation
     * @param {number} time - Current time in seconds
     * @param {THREE.Camera} camera - Camera for view-dependent calculations
     * @param {Object} sunMaterialUniforms - Uniforms from the sun material for synchronization
     */
    update(time, camera, sunMaterialUniforms = {}) {
        if (!this.material) return;

        // Update camera and time using parent methods - shader handles individual flare timing
        this.updateCameraUniforms(camera);
        this.updateTime(time);

        // Real-time relocation is disabled - flares follow their natural cycles

        // Synchronize visibility uniforms with sun material if available
        if (sunMaterialUniforms) {
            this.syncVisibilityUniforms(sunMaterialUniforms);
        }
    }


    /**
     * Set flare parameters
     * @param {Object} params - Parameter object
     */
    setParameters(params = {}) {
        if (!this.material) return;

        const uniforms = this.material.uniforms;

        if (params.width !== undefined) uniforms.uWidth.value = params.width;
        if (params.amplitude !== undefined) uniforms.uAmp.value = params.amplitude;
        if (params.opacity !== undefined) uniforms.uOpacity.value = params.opacity;
        if (params.hue !== undefined) uniforms.uHue.value = params.hue;
        if (params.hueSpread !== undefined) uniforms.uHueSpread.value = params.hueSpread;
        if (params.noiseFrequency !== undefined) uniforms.uNoiseFrequency.value = params.noiseFrequency;
        if (params.noiseAmplitude !== undefined) uniforms.uNoiseAmplitude.value = params.noiseAmplitude;
    }

    /**
     * Set flare opacity
     * @param {number} opacity - The opacity value (0-1 for transparency, >1 for brightness)
     */
    setFlareOpacity(opacity) {
        this.setParameters({ opacity: opacity });
        this.flareOpacity = opacity;
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
     * Update sunspot positions and opacities from SunspotManager
     */
    updateSunspots(positions, flareActive, visualOpacities, radii) {
        if (!this.material) return;
        this.material.uniforms.uSunspotPositions.value = positions;
        this.material.uniforms.uSunspotOpacities.value = flareActive;
        this.material.uniforms.uSunspotVisual.value = visualOpacities;
        if (radii) this.material.uniforms.uSunspotRadii.value = radii;
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

export default SunFlares;