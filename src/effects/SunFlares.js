import * as THREE from 'three';
import SunEffect from './SunEffect.js';
import ShaderUniformConfig from './ShaderUniformConfig.js';
import ShaderLoader from '../shaders/ShaderLoader.js';

/**
 * Vertex shader body for the flares.
 *
 * The most involved shader here, because a flare is not a fixed piece of geometry: it is
 * born at a sunspot, arcs up and either falls back nearby or bridges across to a neighbouring
 * spot, fades, and is replaced. All of that happens per-vertex from a static buffer, so the
 * whole population is one draw call and nothing has to be re-uploaded.
 *
 * `getPosOBJ` decides where a flare is on this frame:
 *
 * Its lifecycle count is `floor(time / lifespan)`, and that count is fed into the hashes that
 * pick the flare's endpoints. So each time a flare dies its replacement gets new endpoints,
 * without any bookkeeping — the reincarnation is a consequence of the arithmetic.
 *
 * Flares are assigned to sunspots four at a time, and how many of a spot's four are shown
 * depends on the spot's radius, so a large spot is visibly more active than a small one. A
 * flare whose slot exceeds its spot's allowance is scaled to nothing rather than branched
 * away, since a uniform code path is cheaper than divergence across a warp.
 *
 * Two of the four may instead bridge to a nearby spot, but only if that spot is both close
 * enough and currently visible. That is what produces the arcs spanning a spot group, which
 * is the most recognisable feature of real solar activity — and gating on the target's
 * visibility stops an arc from being left hanging when the spot at its far end dies.
 *
 * The arc itself is a sine bulge along the flare's length, so it leaves and meets the surface
 * flush, times a random height so no two are alike. Bridging flares are scaled by the span
 * they cross rather than by the star's radius, which keeps a long bridge from towering over
 * everything.
 *
 * Finally the arc is displaced by 4D twisted sine noise — the fourth component being time, so
 * it writhes — scaled by the local arc height, so the noise is strongest at the top and dies
 * at both feet.
 *
 * `main` handles the fade in and out at each end of a flare's life, kills flares whose spot
 * has not yet appeared, and then does the same camera-facing ribbon expansion as the rays,
 * with an extra sideways spread per vertex that splays the flare into strands rather than
 * leaving it a clean ribbon.
 *
 * @type {string}
 */
const vertexShaderMainCode = `
attribute vec3 aPos;
attribute vec3 aPos0;
attribute vec4 aWireRandom;

varying float vUVY;
varying float vOpacity;
varying vec3  vColor;
varying vec3  vNormal;

uniform float uWidth;
uniform float uAmp;
uniform float uTime;
uniform float uNoiseFrequency;
uniform float uNoiseAmplitude;
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

  int spotIndex = int(mod(floor(flareIndex / 4.0), 8.0));
  float slotInSpot = mod(flareIndex, 4.0);
  vec3 spotPos = uSunspotPositions[spotIndex];
  float spotOpacity = uSunspotOpacities[spotIndex];
  float spotRadius = uSunspotRadii[spotIndex];

  float maxFlares = clamp(floor((spotRadius - 0.005) / 0.003) + 1.0, 1.0, 4.0);
  float slotVisible = step(slotInSpot, maxFlares - 0.5);

  int bridgeTarget = int(mod(floor(fract(sin(flareIndex * 13.37 + 3.7) * 43758.5453) * 7.0), 7.0));
  if (bridgeTarget >= spotIndex) bridgeTarget++;

  float startDepth = length(aPos0);
  float clusterRadius = 0.03;

  float seed1 = fract(sin(flareIndex * 43.758 + lifecycleCount * 12.9898) * 43758.5453);
  float seed2 = fract(sin(flareIndex * 78.233 + lifecycleCount * 19.134) * 43758.5453);

  vec3 up = abs(spotPos.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
  vec3 tangent = normalize(cross(spotPos, up));
  vec3 bitangent = normalize(cross(spotPos, tangent));

  vec3 offset = tangent * (seed1 - 0.5) * clusterRadius + bitangent * (seed2 - 0.5) * clusterRadius;
  vec3 pos0 = normalize(spotPos + offset) * startDepth;

  float offsetAngle = (fract(sin(flareIndex * 23.456 + lifecycleCount * 7.891) * 43758.5453) - 0.5) * 0.04;
  float offsetDir = fract(sin(flareIndex * 34.567 + lifecycleCount * 8.912) * 43758.5453) * 6.28318;
  vec3 offset2 = tangent * cos(offsetDir) * offsetAngle + bitangent * sin(offsetDir) * offsetAngle;
  vec3 localPos1 = normalize(spotPos + offset + offset2) * startDepth;

  vec3 targetSpot = uSunspotPositions[bridgeTarget];
  vec3 upT = abs(targetSpot.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
  vec3 tanT = normalize(cross(targetSpot, upT));
  vec3 bitT = normalize(cross(targetSpot, tanT));
  float s1 = fract(sin(flareIndex * 67.891 + lifecycleCount * 5.432) * 43758.5453);
  float s2 = fract(sin(flareIndex * 91.234 + lifecycleCount * 3.210) * 43758.5453);
  vec3 offsetT = tanT * (s1 - 0.5) * clusterRadius + bitT * (s2 - 0.5) * clusterRadius;
  vec3 bridgePos1 = normalize(targetSpot + offsetT) * startDepth;

  float bridgeDist = distance(spotPos, targetSpot);
  float bridgeProximity = smoothstep(0.3, 0.15, bridgeDist);
  float targetVisible = smoothstep(0.0, 0.5, uSunspotVisual[bridgeTarget]);
  float isBridgeCandidate = step(2.0, mod(flareIndex, 4.0));
  float isBridge = bridgeProximity * targetVisible * (1.0 - isBridgeCandidate);

  vec3 pos1 = mix(localPos1, bridgePos1, isBridge);

  float size = distance(pos0, pos1);
  vec3  n    = normalize((pos0 + pos1) * 0.5);

  vec3 p = mix(pos0, pos1, phase);

  float heightSeed = sin(flareIndex * 17.432 + lifecycleCount * 3.789) * 43758.5453;
  float baseHeightVariation = 0.4 + fract(heightSeed) * 1.2;
  float segmentVariation = 0.85 + aWireRandom.w * 0.3;
  float heightVariation = baseHeightVariation * segmentVariation;

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

  float flareIndex = floor(aPos.y * 32.0);

  float flareLifespan = 1.5 + aWireRandom.x * 4.0;
  float flareOffset = aWireRandom.y * 50.0 + floor(aPos.y * 32.0) * 1.7;
  float flareTime = mod(uTime + flareOffset, flareLifespan);
  float animPhase = flareTime / flareLifespan;

  float fadeFactor = 1.0;
  if (animPhase < 0.2) {
    fadeFactor = smoothstep(0.0, 0.2, animPhase);
  } else if (animPhase > 0.8) {
    fadeFactor = smoothstep(1.0, 0.8, animPhase);
  }

  int spotIdx = int(mod(floor(aPos.y * 32.0) / 4.0, 8.0));
  float spotActive = uSunspotOpacities[spotIdx];
  if (spotActive < 0.1 && animPhase < 0.2) {
    fadeFactor = 0.0;
  }
  fadeFactor *= smoothstep(0.0, 0.3, spotActive);

  vec3 pOBJ  = getPosOBJ(aPos.x,        animPhase);
  vec3 p1OBJ = getPosOBJ(aPos.x + 0.01, animPhase);

  vec3 pOff  = mat3(modelMatrix) * pOBJ;
  vec3 p1Off = mat3(modelMatrix) * p1OBJ;

  vec3 centerView = (modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  vec3 pView = centerView + mat3(viewMatrix) * pOff;

  vec3 dirView  = normalize(mat3(viewMatrix) * (p1Off - pOff));
  vec3 sideView = normalize(cross(normalize(pView), dirView));

  float R = length(aPos0);

  float width = uWidth * aPos.z * (1.0 + animPhase) * R;

  vec3 upView = normalize(cross(sideView, dirView));

  float spreadAmount = 0.04 * sin(aPos.x * 3.14159);
  vec3 strandOffset = (
    sideView * (aWireRandom.z - 0.5) * spreadAmount * R +
    upView * (aWireRandom.w - 0.5) * spreadAmount * R
  );

  pView += sideView * width;

  float spreadFactor = sin(aPos.x * 3.14159);
  pView += strandOffset * spreadFactor;

  vNormal  = normalize(pOff);

  float lenW = length(pOff);
  vOpacity  = smoothstep(R, R * 1.03, lenW);

  vOpacity *= fadeFactor;
  vOpacity *= uOpacity;

  vec3 hueVariation = hue(aWireRandom.w * uHueSpread + uHue);
  vColor = mix(uBaseColor, hueVariation, 0.1);

  gl_Position = projectionMatrix * vec4(pView, 1.0);
}`;

/**
 * Fragment shader body for the flares.
 *
 * Fades each strand out towards its edges, squared so the falloff is sharper than linear and
 * the strand reads as a filament rather than a soft band.
 *
 * `getAlpha` hides the flares on the star's far side. They are drawn without depth writing
 * and would otherwise show through the star's disc, which reads as the flares being in front
 * of it. The visibility uniform biases the test, so all the star's effects can be faded
 * together from one place.
 *
 * @type {string}
 */
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

uniform float uAlphaBlended;

void main(void){
    float alpha = smoothstep(1.0, 0.0, abs(vUVY));
    alpha *= alpha;
    alpha *= vOpacity;
    alpha *= getAlpha(vNormal);

    vec3 emissiveColor = vColor * uEmissiveIntensity;

    gl_FragColor = vec4(emissiveColor * alpha, alpha * uAlphaBlended);
}`;

/**
 * Arcs of plasma rising from a star's sunspots.
 *
 * Longer and far fewer than the rays, and unlike them tied to something: each flare belongs
 * to one of the sunspots {@link SunspotManager} tracks, so the star's activity is visibly
 * concentrated where its spots are rather than sprinkled evenly over the surface. Some arc
 * across to a neighbouring spot.
 *
 * The whole population is one draw call, with birth, death and replacement all worked out in
 * the vertex shader from a static buffer.
 */
class SunFlares extends SunEffect {
    /**
     * Builds the flares and their geometry.
     *
     * @param {Object} [options={}] - Flare options.
     * @param {number} [options.sunRadius=1.49] - The star's radius in scene units; flares
     *   start just inside it.
     * @param {number} [options.lineCount=2047] - How many flares.
     * @param {number} [options.lineLength=16] - Segments per flare. Enough that the arc and
     *   its noise displacement read as a curve rather than a polyline.
     * @param {number} [options.opacity=0.8] - Overall opacity.
     * @param {number} [options.emissiveIntensity=2.0] - Brightness multiplier, which is what
     *   drives bloom.
     * @param {number|THREE.Color} [options.baseColor] - The star's colour.
     * @param {boolean} [options.lowres=false] - Use the reduced-resolution uniform defaults.
     */
    constructor(options = {}) {
        super({
            sunRadius: options.sunRadius || 1.49,
            lowres: options.lowres || false,
            effectName: '🔥 SunFlares'
        });

        this.lineCount = options.lineCount || 2047;
        this.lineLength = options.lineLength || 16;
        this.flareOpacity = options.opacity || 0.8;
        this.emissiveIntensity = options.emissiveIntensity || 2.0;

        this.mesh = this.createFlaresMesh();

        if (options.baseColor !== undefined) {
            this.setBaseColor(options.baseColor);
        }

    }

    /**
     * Builds the mesh and its material.
     *
     * Ordinary alpha blending rather than the rays' additive, because flares are large and
     * few: added together, overlapping arcs saturate to white and the structure inside them
     * is lost. Tone mapping is off so the emissive output can exceed 1 and bloom.
     *
     * Frustum culling is off, since the vertex shader moves the geometry outside its bounding
     * sphere.
     *
     * Eight sunspot slots, matching the shader's fixed loop bound and
     * {@link SunspotManager}'s pool; all start at zero opacity, so nothing is drawn until the
     * spots are pushed in.
     *
     * @returns {THREE.Mesh} The flares mesh.
     */
    createFlaresMesh() {
        const geometry = this.createFlaresGeometry();

        const defaultPositions = new Array(8).fill(null).map(() => new THREE.Vector3(0, 1, 0));
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
                    opacity: this.flareOpacity
                }),
                uEmissiveIntensity: { value: this.emissiveIntensity },
                uSunspotPositions: { value: defaultPositions },
                uSunspotOpacities: { value: new Float32Array(8) },
                uSunspotVisual: { value: new Float32Array(8) },
                uSunspotRadii: { value: new Float32Array(8) }
            }
        });

        this.material = material;

        const mesh = new THREE.Mesh(geometry, material);
        mesh.frustumCulled = false;
        mesh.renderOrder = 1;

        return mesh;
    }

    /**
     * Builds the flare geometry: every flare in one buffer.
     *
     * Each flare is a strip of quads, two vertices per segment. `aPos` carries position along
     * the flare, flare index and which side of the ribbon a vertex is on; `aPos0` carries its
     * base; `aWireRandom` carries four random numbers, identical across a flare's vertices so
     * it animates as a unit.
     *
     * Directions are not independent. A new direction is drawn only occasionally, and the
     * flares in between are small perturbations of it, so they come out in tight clusters —
     * which is what makes them look like they belong to a common active region rather than
     * being scattered at random.
     *
     * The base positions here are mostly vestigial: the shader recomputes each flare's
     * endpoints from its assigned sunspot, and uses `aPos0` only for its length, as the radius
     * to place things at. Their directions still matter for the clustering.
     *
     * Flares start slightly inside the surface, so their feet are hidden by the star.
     *
     * @returns {THREE.BufferGeometry} The flares geometry.
     */
    createFlaresGeometry() {
        const { lineCount, lineLength, sunRadius } = this;

        const aPos = new Float32Array(lineCount * lineLength * 2 * 3);
        const aPos0 = new Float32Array(lineCount * lineLength * 2 * 3);
        const aWireRand = new Float32Array(lineCount * lineLength * 2 * 4);
        const indices = new Uint16Array(lineCount * (lineLength - 1) * 2 * 3);

        const d = new THREE.Vector3();
        const f = new THREE.Vector3();
        const g = new THREE.Vector3();

        let s = 0, l = 0, c = 0, u = 0;

        f.set(Math.random(), Math.random(), Math.random()).normalize();
        let m = Math.random(), _p = Math.random();

        for (let y = 0; y < lineCount; y++) {
            if (Math.random() < 0.025 || y === 0) {
                d.set(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1).normalize();
                m = Math.random();
                _p = Math.random();
            }

            f.copy(d);
            g.set(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1).normalize().multiplyScalar(0.02);
            f.add(g).normalize();

            const rands = [m, _p, Math.random(), Math.random()];

            for (let E = 0; E < lineLength; E++) {
                const base = 2 * (y * lineLength + E);

                for (let A = 0; A <= 1; A++) {
                    aPos[s++] = (E + 0.5) / lineLength;
                    aPos[s++] = (y + 0.5) / lineCount;
                    aPos[s++] = 2 * A - 1;

                    for (let R = 0; R < 4; R++) {
                        aWireRand[l++] = rands[R];
                    }

                    const startDepth = sunRadius * 0.995;
                    aPos0[c++] = f.x * startDepth;
                    aPos0[c++] = f.y * startDepth;
                    aPos0[c++] = f.z * startDepth;
                }

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

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('aPos', new THREE.BufferAttribute(aPos, 3));
        geometry.setAttribute('aPos0', new THREE.BufferAttribute(aPos0, 3));
        geometry.setAttribute('aWireRandom', new THREE.BufferAttribute(aWireRand, 4));
        geometry.setIndex(new THREE.BufferAttribute(indices, 1));

        return geometry;
    }

    /**
     * Advances the animation and matches the star's fade.
     *
     * Takes an absolute time rather than a delta, unlike the other effects: flare lifecycles
     * are derived from `floor(time / lifespan)`, so the clock has to be the same one the star
     * itself is on or the flares would drift out of step with the sunspots they belong to.
     *
     * The star material's visibility uniforms are copied over, so the flares fade with the
     * surface rather than being left hanging over a faded star.
     *
     * @param {number} time - Absolute animation time, in scaled seconds.
     * @param {THREE.Camera} camera - Camera the frame is being drawn from; unused.
     * @param {Object} [sunMaterialUniforms={}] - The star material's uniforms, to take the
     *   visibility fade from.
     * @returns {void}
     */
    update(time, camera, sunMaterialUniforms = {}) {
        if (!this.material) return;

        this.updateTime(time);

        if (sunMaterialUniforms) {
            this.syncVisibilityUniforms(sunMaterialUniforms);
        }
    }

    /**
     * Sets the flares' brightness, and so how strongly they bloom.
     *
     * @param {number} intensity - Brightness multiplier.
     * @returns {void}
     */
    setEmissiveIntensity(intensity) {
        if (this.material) {
            if (this.material.uniforms.uEmissiveIntensity) {
                this.material.uniforms.uEmissiveIntensity.value = intensity;
            }
        }
        this.emissiveIntensity = intensity;
    }

    /**
     * Points the shader at {@link SunspotManager}'s current sunspots.
     *
     * Two separate opacity arrays, and the distinction matters. `flareActive` is the ramp
     * that starts a few seconds after a spot has settled and stops before it dies, and it
     * governs whether the spot's own flares are drawn — a flare should not appear at the
     * same instant as the spot it comes from. `visualOpacities` is the spot's actual
     * visibility, used only to decide whether another spot is a fit target to bridge to.
     *
     * The arrays are taken by reference, not copied, so the manager can keep mutating its own
     * buffers in place and the uniforms follow.
     *
     * @param {THREE.Vector3[]} positions - Spot centres, as unit vectors in the star's object
     *   space.
     * @param {Float32Array} flareActive - Per-spot flare activity, 0 to 1.
     * @param {Float32Array} visualOpacities - Per-spot visibility, 0 to 1.
     * @param {Float32Array} [radii] - Spot angular radii, which set how many flares each
     *   spot supports; left unchanged if omitted.
     * @returns {void}
     */
    updateSunspots(positions, flareActive, visualOpacities, radii) {
        if (!this.material) return;
        this.material.uniforms.uSunspotPositions.value = positions;
        this.material.uniforms.uSunspotOpacities.value = flareActive;
        this.material.uniforms.uSunspotVisual.value = visualOpacities;
        if (radii) this.material.uniforms.uSunspotRadii.value = radii;
    }

    /**
     * The flares' current brightness.
     *
     * Read by {@link BloomManager}, which caches it as a baseline to scale from.
     *
     * @returns {number} Brightness multiplier.
     */
    getEmissiveIntensity() {
        return this.emissiveIntensity;
    }
}

export default SunFlares;