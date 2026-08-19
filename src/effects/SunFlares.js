import * as THREE from 'three';
import SunEffect from './SunEffect.js';
import ShaderUniformConfig from './ShaderUniformConfig.js';
import ShaderLoader from '../shaders/ShaderLoader.js';

const vertexShaderMainCode = `
attribute vec3 aPos;
attribute vec3 aPos0;
attribute vec3 aPos1;
attribute vec4 aWireRandom;

varying float vUVY;
varying float vOpacity;
varying vec3  vColor;
varying vec3  vNormal;
varying float vPhase;

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
  vPhase = aPos.x;

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
    float alpha = smoothstep(1.0, 0.0, abs(vUVY));
    alpha *= alpha;
    alpha *= vOpacity;
    alpha *= getAlpha(vNormal);

    float brightnessFactor = 1.0;

    vec3 emissiveColor = vColor * uEmissiveIntensity;

    emissiveColor *= brightnessFactor;

    gl_FragColor = vec4(emissiveColor * alpha, alpha * uAlphaBlended);
}`;

class SunFlares extends SunEffect {
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

        this.flareTimings = new Array(this.lineCount).fill().map(() => ({
            justRelocated: false
        }));

        this.mesh = this.createFlaresMesh();

        if (options.baseColor !== undefined) {
            this.setBaseColor(options.baseColor);
        }

    }

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

        this.material = material;

        const mesh = new THREE.Mesh(geometry, material);
        mesh.frustumCulled = false;
        mesh.renderOrder = 1;

        return mesh;
    }

    relocateSingleFlare(flareIndex) {
        if (!this.mesh || !this.mesh.geometry) return;

        const geometry = this.mesh.geometry;
        const aPos0 = geometry.getAttribute('aPos0');
        const aPos1 = geometry.getAttribute('aPos1');
        const aWireRandom = geometry.getAttribute('aWireRandom');

        const f = new THREE.Vector3(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1).normalize();
        const p = new THREE.Vector3(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1).normalize();

        const g1 = new THREE.Vector3(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1).normalize().multiplyScalar(0.2);
        const g2 = new THREE.Vector3(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1).normalize().multiplyScalar(0.04);
        f.add(g1).normalize();
        p.add(g2).normalize();

        const startDepth = this.sunRadius * 0.98;

        const firstVertexIndex = (flareIndex * this.lineLength) * 2;
        const newRands = [
            Math.random(),
            Math.random(),
            aWireRandom.getZ(firstVertexIndex),
            Math.random()
        ];

        for (let E = 0; E < this.lineLength; E++) {
            for (let A = 0; A <= 1; A++) {
                const vertexIndex = (flareIndex * this.lineLength + E) * 2 + A;

                aPos0.setXYZ(vertexIndex, f.x * startDepth, f.y * startDepth, f.z * startDepth);
                aPos1.setXYZ(vertexIndex, p.x * startDepth, p.y * startDepth, p.z * startDepth);

                aWireRandom.setXYZW(vertexIndex, newRands[0], newRands[1], newRands[2], newRands[3]);
            }
        }

        aPos0.needsUpdate = true;
        aPos1.needsUpdate = true;
        aWireRandom.needsUpdate = true;
    }

    createFlaresGeometry() {
        const { lineCount, lineLength, sunRadius } = this;

        const aPos = new Float32Array(lineCount * lineLength * 2 * 3);
        const aPos0 = new Float32Array(lineCount * lineLength * 2 * 3);
        const aPos1 = new Float32Array(lineCount * lineLength * 2 * 3);
        const aWireRand = new Float32Array(lineCount * lineLength * 2 * 4);
        const indices = new Uint16Array(lineCount * (lineLength - 1) * 2 * 3);

        const held = new THREE.Vector3();
        const d = new THREE.Vector3();
        const f = new THREE.Vector3();
        const p = new THREE.Vector3();
        const g = new THREE.Vector3();

        let s = 0, l = 0, c = 0, h = 0, u = 0;

        f.set(Math.random(), Math.random(), Math.random()).normalize();
        let m = Math.random(), _p = Math.random();

        for (let y = 0; y < lineCount; y++) {
            if (Math.random() < 0.025 || y === 0) {
                d.set(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1).normalize();
                held.copy(d);
                g.set(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1).normalize().multiplyScalar(0.2);
                held.add(g).normalize();
                m = Math.random();
                _p = Math.random();
            }

            f.copy(d);
            g.set(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1).normalize().multiplyScalar(0.02);
            f.add(g).normalize();

            p.copy(held);
            g.set(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1).normalize().multiplyScalar(0.04);
            p.add(g).normalize();

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

                    aPos1[h++] = p.x * startDepth;
                    aPos1[h++] = p.y * startDepth;
                    aPos1[h++] = p.z * startDepth;
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
        geometry.setAttribute('aPos1', new THREE.BufferAttribute(aPos1, 3));
        geometry.setAttribute('aWireRandom', new THREE.BufferAttribute(aWireRand, 4));
        geometry.setIndex(new THREE.BufferAttribute(indices, 1));

        return geometry;
    }

    update(time, camera, sunMaterialUniforms = {}) {
        if (!this.material) return;

        this.updateTime(time);

        if (sunMaterialUniforms) {
            this.syncVisibilityUniforms(sunMaterialUniforms);
        }
    }

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

    setFlareOpacity(opacity) {
        this.setParameters({ opacity: opacity });
        this.flareOpacity = opacity;
    }

    setEmissiveIntensity(intensity) {
        if (this.material) {
            if (this.material.uniforms.uEmissiveIntensity) {
                this.material.uniforms.uEmissiveIntensity.value = intensity;
            }
        }
        this.emissiveIntensity = intensity;
    }

    updateSunspots(positions, flareActive, visualOpacities, radii) {
        if (!this.material) return;
        this.material.uniforms.uSunspotPositions.value = positions;
        this.material.uniforms.uSunspotOpacities.value = flareActive;
        this.material.uniforms.uSunspotVisual.value = visualOpacities;
        if (radii) this.material.uniforms.uSunspotRadii.value = radii;
    }

    getEmissiveIntensity() {
        return this.emissiveIntensity;
    }
}

export default SunFlares;