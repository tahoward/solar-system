import * as THREE from 'three';
import { log } from '../utils/Logger.js';

class SunCorona {
    constructor(options = {}) {
        this.sunRadius = options.sunRadius || 1.0;
        this.coronaRadius = options.coronaRadius || (this.sunRadius * 2.5);
        this.coronaColor = new THREE.Color(options.coronaColor || 0xffaa00);
        this.coronaIntensity = options.coronaIntensity || 0.8;
        this.noiseScale = options.noiseScale || 3.0;
        this.animationSpeed = options.animationSpeed || 0.001;
        this.fresnelPower = options.fresnelPower || 2.0;
        this.lowres = options.lowres || false;

        this.mesh = this.createCoronaMesh();

        this.time = 0;

    }

    createCoronaMesh() {
        const geometry = new THREE.SphereGeometry(
            this.coronaRadius,
            this.lowres ? 32 : 64,
            this.lowres ? 16 : 32
        );

        const material = this.createCoronaMaterial();

        const mesh = new THREE.Mesh(geometry, material);

        mesh.renderOrder = 1;

        return mesh;
    }

    createCoronaMaterial() {
        const vertexShader = `
            varying vec3 vNormal;
            varying vec3 vViewPosition;
            varying vec3 vNoisePosition;
            varying vec2 vUv;

            void main() {
                vNormal = normalize(normalMatrix * normal);
                vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                vViewPosition = -mvPosition.xyz;

                vNoisePosition = position;
                vUv = uv;

                gl_Position = projectionMatrix * mvPosition;
            }
        `;

        const fragmentShader = `
            uniform float uTime;
            uniform vec3 uCoronaColor;
            uniform float uCoronaIntensity;
            uniform float uNoiseScale;
            uniform float uAnimationSpeed;
            uniform float uFresnelPower;
            uniform vec3 uCameraPosition;
            uniform float uSunRadius;

            varying vec3 vNormal;
            varying vec3 vViewPosition;
            varying vec3 vNoisePosition;
            varying vec2 vUv;

            float random(vec3 st) {
                return fract(sin(dot(st, vec3(12.9898, 78.233, 23.112))) * 12943.145);
            }

            float noise(vec3 pos) {
                vec3 i = floor(pos);
                vec3 f = fract(pos);
                f = f * f * (3.0 - 2.0 * f);

                return mix(
                    mix(mix(random(i), random(i + vec3(1.0, 0.0, 0.0)), f.x),
                        mix(random(i + vec3(0.0, 1.0, 0.0)), random(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
                    mix(mix(random(i + vec3(0.0, 0.0, 1.0)), random(i + vec3(1.0, 0.0, 1.0)), f.x),
                        mix(random(i + vec3(0.0, 1.0, 1.0)), random(i + vec3(1.0, 1.0, 1.0)), f.x), f.y), f.z);
            }

            float fractalNoise(vec3 pos, int octaves) {
                float value = 0.0;
                float amplitude = 0.5;
                float frequency = 1.0;

                for (int i = 0; i < 4; i++) {
                    if (i >= octaves) break;
                    value += noise(pos * frequency) * amplitude;
                    frequency *= 2.0;
                    amplitude *= 0.5;
                }

                return value;
            }

            void main() {
                vec3 viewDirection = normalize(vViewPosition);
                float fresnel = abs(dot(vNormal, viewDirection));

                float centerToEdgeFade = pow(fresnel, uFresnelPower);

                vec3 noisePos = vNoisePosition * uNoiseScale + uTime * uAnimationSpeed;

                float coronaDensity = fractalNoise(noisePos, 3);

                float streamFlow = fractalNoise(vNoisePosition * uNoiseScale * 0.5 + vec3(uTime * uAnimationSpeed * 2.0, 0.0, 0.0), 2);
                coronaDensity = mix(coronaDensity, streamFlow, 0.3);

                float finalAlpha = centerToEdgeFade * (0.4 + coronaDensity * 0.6) * uCoronaIntensity;

                finalAlpha = clamp(finalAlpha, 0.0, 0.9);

                vec3 finalColor = uCoronaColor;

                float colorVariation = fractalNoise(vNoisePosition * uNoiseScale * 2.0, 2);
                finalColor = mix(finalColor, finalColor * 1.3, colorVariation * 0.2);

                gl_FragColor = vec4(finalColor, finalAlpha);
            }
        `;

        return new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0.0 },
                uCoronaColor: { value: this.coronaColor.clone() },
                uCoronaIntensity: { value: this.coronaIntensity },
                uNoiseScale: { value: this.noiseScale },
                uAnimationSpeed: { value: this.animationSpeed },
                uFresnelPower: { value: this.fresnelPower },
                uCameraPosition: { value: new THREE.Vector3() },
                uSunRadius: { value: this.sunRadius }
            },
            vertexShader,
            fragmentShader,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            depthTest: true,
            side: THREE.BackSide
        });
    }

    update(deltaTime, camera) {
        this.time += deltaTime;

        if (this.mesh.material.uniforms) {
            this.mesh.material.uniforms.uTime.value = this.time;

            if (camera) {
                this.mesh.material.uniforms.uCameraPosition.value.copy(camera.position);
            }
        }
    }

    setPosition(position) {
        this.mesh.position.copy(position);
    }

    setCoronaColor(color) {
        if (typeof color === 'number') {
            this.coronaColor.setHex(color);
        } else {
            this.coronaColor.copy(color);
        }

        if (this.mesh.material.uniforms) {
            this.mesh.material.uniforms.uCoronaColor.value.copy(this.coronaColor);
        }
    }

    setCoronaIntensity(intensity) {
        this.coronaIntensity = intensity;

        if (this.mesh.material.uniforms) {
            this.mesh.material.uniforms.uCoronaIntensity.value = intensity;
        }
    }

    setCoronaRadius(radius) {
        this.coronaRadius = radius;

        const scale = radius / this.sunRadius;
        this.mesh.scale.setScalar(scale / 2.5);

        if (this.mesh.material.uniforms) {
            this.mesh.material.uniforms.uSunRadius.value = this.sunRadius;
        }
    }

    setNoiseParameters(scale, speed) {
        this.noiseScale = scale;
        this.animationSpeed = speed;

        if (this.mesh.material.uniforms) {
            this.mesh.material.uniforms.uNoiseScale.value = scale;
            this.mesh.material.uniforms.uAnimationSpeed.value = speed;
        }
    }

    setFresnelPower(power) {
        this.fresnelPower = power;

        if (this.mesh.material.uniforms) {
            this.mesh.material.uniforms.uFresnelPower.value = power;
        }
    }

    addToScene(parent) {
        parent.add(this.mesh);
        log.info('SunCorona', '🌟 SunCorona added to scene');
    }

    removeFromScene(parent) {
        parent.remove(this.mesh);
    }

    getMesh() {
        return this.mesh;
    }

    dispose() {
        if (this.mesh.geometry) {
            this.mesh.geometry.dispose();
        }
        if (this.mesh.material) {
            this.mesh.material.dispose();
        }

        log.info('SunCorona', '🌟 SunCorona disposed');
    }
}

export default SunCorona;