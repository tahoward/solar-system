import * as THREE from 'three';
import SunEffect from './SunEffect.js';
import ShaderUniformConfig from './ShaderUniformConfig.js';
import ShaderLoader from '../shaders/ShaderLoader.js';

const sunRaysVSMain = `
attribute vec3 aPos;
attribute vec3 aPos0;
attribute vec3 aPos1;
attribute vec4 aWireRandom;

varying float vOpacity;
varying vec3 vColor;
varying vec3 vNormal;

uniform float uHueSpread;
uniform float uHue;
uniform vec3 uBaseColor;
uniform float uWidth;
uniform float uTime;
uniform float uOpacity;
uniform float uBendAmount;
uniform float uWhispyAmount;

vec3 getRayPosition(float phase, float animPhase) {
    vec3 rayOrigin = aPos0;
    vec3 rayEnd = aPos1;

    vec3 baseDir = normalize(rayEnd - rayOrigin);

    vec3 bendAxis1 = normalize(cross(baseDir, vec3(0.577, 0.577, 0.577)));
    vec3 bendAxis2 = normalize(cross(baseDir, bendAxis1));

    float bendAmount = phase * phase * phase * uBendAmount;
    vec2 bendOffset = vec2(
        (aWireRandom.x - 0.5) * bendAmount,
        (aWireRandom.y - 0.5) * bendAmount
    );

    vec3 bentDirection = baseDir + bendAxis1 * bendOffset.x + bendAxis2 * bendOffset.y;
    vec3 bentEnd = rayOrigin + normalize(bentDirection) * length(rayEnd - rayOrigin);

    vec3 animatedEnd = rayOrigin + (bentEnd - rayOrigin) * animPhase;

    vec3 p = mix(rayOrigin, animatedEnd, phase);

    vec3 rayDir = normalize(rayOrigin);
    vec3 tangent1 = normalize(cross(rayDir, vec3(0.0, 1.0, 0.0)));
    vec3 tangent2 = normalize(cross(rayDir, tangent1));

    float timeShift = uTime * 0.15 + aWireRandom.z * 6.28;
    float slowTime = uTime * 0.08 + aWireRandom.w * 3.14;
    float fastTime = uTime * 0.25 + aWireRandom.x * 12.56;

    vec2 primaryDrift = vec2(
        sin(timeShift + aWireRandom.y * 6.28) * 0.004 * uWhispyAmount,
        cos(timeShift * 1.4 + aWireRandom.z * 6.28) * 0.004 * uWhispyAmount
    );

    vec2 secondaryDrift = vec2(
        sin(slowTime * 2.1 + aWireRandom.x * 6.28) * 0.002 * uWhispyAmount,
        cos(slowTime * 1.7 + aWireRandom.w * 6.28) * 0.002 * uWhispyAmount
    );

    vec2 shimmerDrift = vec2(
        sin(fastTime + aWireRandom.z * 6.28) * 0.001 * uWhispyAmount,
        cos(fastTime * 1.8 + aWireRandom.y * 6.28) * 0.001 * uWhispyAmount
    );

    vec2 totalDrift = primaryDrift + secondaryDrift + shimmerDrift;

    float motionScale = phase * phase * phase * phase * phase;
    p += (tangent1 * totalDrift.x + tangent2 * totalDrift.y) * motionScale;

    return p;
}

void main(void) {
    float rayIndex = floor(aPos.y * 300.0);

    float rayOffset = aWireRandom.y * 10.0;
    float flickerSpeed = 0.8 + aWireRandom.x * 0.4;
    float rayTime = uTime * flickerSpeed + rayOffset;

    float lengthPulse = 0.95 + 0.05 * sin(rayTime * 0.2);
    float animPhase = lengthPulse;

    float opacityFlicker = 0.7 + 0.3 * sin(rayTime * 0.5) * cos(rayTime * 0.7);
    float fadeFactor = opacityFlicker;

    vec3 p  = getRayPosition(aPos.x,        animPhase);
    vec3 p1 = getRayPosition(aPos.x + 0.01, animPhase);

    vec3 offset  = mat3(modelMatrix) * p;
    vec3 offset1 = mat3(modelMatrix) * p1;
    vec3 centerView = (modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
    vec3 p0View = centerView + mat3(viewMatrix) * offset;

    vec3 dirView = normalize(mat3(viewMatrix) * (offset1 - offset));
    vec3 sideView = normalize(cross(normalize(p0View), dirView));

    float widthFactor = (1.0 - aPos.x);
    float width = uWidth * aPos.z * widthFactor * animPhase * 1.0;

    vNormal = normalize(offset);

    vOpacity = uOpacity * fadeFactor * (0.5 + aWireRandom.w);

    vec3 spectrumColor = hue(aWireRandom.w * uHueSpread + uHue);
    vColor = mix(uBaseColor, spectrumColor, 0.1);

    gl_Position = projectionMatrix * vec4(p0View + sideView * width, 1.0);
}`;

const sunRaysFSMain = `
uniform vec3  uLightView;
uniform float uEmissiveIntensity;

varying float vOpacity;
varying vec3  vColor;
varying vec3  vNormal;

uniform float uAlphaBlended;

void main(void) {
    float alpha = 1.0;
    alpha *= vOpacity;

    vec3 rayToCamera = normalize(uLightView);
    float nDotL = dot(vNormal, rayToCamera);

    if (nDotL > 0.2) {
        float dimFactor = smoothstep(0.2, 0.8, nDotL);
        alpha *= (1.0 - dimFactor * 0.6);
    }

    vec3 emissiveColor = vColor * uEmissiveIntensity;

    gl_FragColor = vec4(emissiveColor * alpha, alpha * uAlphaBlended);
}`;

class SunRays extends SunEffect {
    constructor(options = {}) {
        super({
            sunRadius: options.sunRadius || 1.0,
            lowres: options.lowres || false,
            effectName: '🌞 SunRays'
        });

        this.rayCount = Math.min(options.rayCount || 8000, 4000);
        this.rayLength = options.rayLength || 0.01;
        this.rayWidth = options.rayWidth || 0.0003;
        this.rayOpacity = options.rayOpacity || 0.8;
        this.hue = options.hue || 0.1;
        this.hueSpread = options.hueSpread || 0.3;
        this.emissiveIntensity = options.emissiveIntensity || 1.5;
        this.bendAmount = options.bendAmount !== undefined ? options.bendAmount : 0.0;
        this.whispyAmount = options.whispyAmount !== undefined ? options.whispyAmount : 0.0;

        this.mesh = this.createRaysMesh();

        if (options.baseColor !== undefined) {
            this.setBaseColor(options.baseColor);
        }
    }

    createRaysMesh() {
        const geometry = this.createRaysGeometry();
        const material = new THREE.ShaderMaterial({
            vertexShader: ShaderLoader.createVertexShader(sunRaysVSMain),
            fragmentShader: ShaderLoader.createFragmentShader(sunRaysFSMain),
            transparent: true,
            premultipliedAlpha: true,
            depthWrite: false,
            depthTest: true,
            blending: THREE.AdditiveBlending,
            side: THREE.DoubleSide,
            toneMapped: false,
            uniforms: {
                ...ShaderUniformConfig.createCompleteRayUniforms({
                    lowres: this.lowres,
                    rayWidth: this.rayWidth,
                    rayOpacity: this.rayOpacity,
                    hue: this.hue,
                    hueSpread: this.hueSpread,
                    alphaBlended: 0.3
                }),
                uEmissiveIntensity: { value: this.emissiveIntensity },
                uBendAmount: { value: this.bendAmount },
                uWhispyAmount: { value: this.whispyAmount }
            }
        });

        this.material = material;

        const mesh = new THREE.Mesh(geometry, material);
        mesh.frustumCulled = false;
        mesh.renderOrder = 3;

        mesh.position.set(0, 0, 0);

        return mesh;
    }

    createRaysGeometry() {
        const lineCount = this.rayCount;
        const lineLength = this.lowres ? 4 : 8;

        const aPos = new Float32Array(lineCount * lineLength * 2 * 3);
        const aPos0 = new Float32Array(lineCount * lineLength * 2 * 3);
        const aPos1 = new Float32Array(lineCount * lineLength * 2 * 3);
        const aWireRand = new Float32Array(lineCount * lineLength * 2 * 4);
        const indices = new Uint16Array(lineCount * (lineLength - 1) * 2 * 3);

        let s = 0, l = 0, c = 0, h = 0, u = 0;

        for (let y = 0; y < lineCount; y++) {
            const u1 = Math.random();
            const u2 = Math.random();

            const phi = Math.acos(2 * u1 - 1);
            const theta = 2 * Math.PI * u2;

            const rayDirection = new THREE.Vector3(
                Math.sin(phi) * Math.cos(theta),
                Math.sin(phi) * Math.sin(theta),
                Math.cos(phi)
            ).normalize();


            const rands = [Math.random(), Math.random(), Math.random(), Math.random()];

            for (let E = 0; E < lineLength; E++) {
                const base = 2 * (y * lineLength + E);

                for (let A = 0; A <= 1; A++) {
                    aPos[s++] = (E + 0.5) / lineLength;
                    aPos[s++] = (y + 0.5) / lineCount;
                    aPos[s++] = 2 * A - 1;

                    for (let R = 0; R < 4; R++) {
                        aWireRand[l++] = rands[R];
                    }

                    const startDepth = this.sunRadius * 0.98;
                    aPos0[c++] = rayDirection.x * startDepth;
                    aPos0[c++] = rayDirection.y * startDepth;
                    aPos0[c++] = rayDirection.z * startDepth;

                    aPos1[h++] = rayDirection.x * (this.sunRadius + this.rayLength);
                    aPos1[h++] = rayDirection.y * (this.sunRadius + this.rayLength);
                    aPos1[h++] = rayDirection.z * (this.sunRadius + this.rayLength);
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

    update(deltaTime, camera, sunPosition = new THREE.Vector3(0, 0, 0)) {
        this.time += deltaTime;

        if (!this.material) return;

        this.updateTime(this.time);

        const lightView = new THREE.Vector3().subVectors(camera.position, sunPosition).normalize();
        if (this.material.uniforms.uLightView) {
            this.material.uniforms.uLightView.value.copy(lightView);
        }
    }

    setEmissiveIntensity(intensity) {
        if (this.material) {
            if (this.material.uniforms.uEmissiveIntensity) {
                this.material.uniforms.uEmissiveIntensity.value = intensity;
            }
        }
        this.emissiveIntensity = intensity;
    }

    getEmissiveIntensity() {
        return this.emissiveIntensity;
    }
}

export default SunRays;