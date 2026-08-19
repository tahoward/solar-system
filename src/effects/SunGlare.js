import * as THREE from 'three';
import SunEffect from './SunEffect.js';
import MathUtils from '../utils/MathUtils.js';

class SunGlare extends SunEffect {
    constructor(options = {}) {
        super({
            sunRadius: options.sunRadius || 1.0,
            lowres: options.lowres || false,
            effectName: '✨ SunGlare'
        });

        this.glareSize = options.size || 5.0;
        this.glareOpacity = options.opacity || 1.0;
        this.glareColor = options.color || 0xffaa00;

        this.emissiveIntensity = options.emissiveIntensity || 25.0;
        this.glowIntensity = options.glowIntensity || 1.35;
        this.haloRadius = options.haloRadius || 0.5;
        this.haloFalloff = options.haloFalloff || 3.0;
        this.haloStrength = options.haloStrength || 0.55;
        this.coreWhiteness = options.coreWhiteness !== undefined ? options.coreWhiteness : 0.8;

        this.scaleWithDistance = options.scaleWithDistance !== undefined ? options.scaleWithDistance : true;
        this.minScaleDistance = options.minScaleDistance || 0.5;
        this.maxScaleDistance = options.maxScaleDistance || 10.0;
        this.minScale = options.minScale || 0.1;
        this.maxScale = options.maxScale || 1.0;

        this.fadeStartDistance = options.fadeStartDistance || this.maxScaleDistance;
        this.fadeEndDistance = options.fadeEndDistance || this.minScaleDistance;

        this.scaleCenterWithDistance = options.scaleCenterWithDistance !== undefined ? options.scaleCenterWithDistance : true;
        this.centerBaseSize = options.centerBaseSize || 0.01;
        this.centerFadeSize = options.centerFadeSize || 0.03;

        this.currentFadeFactor = 1.0;

        this.twinkleEnabled = options.twinkle !== undefined ? options.twinkle : true;
        this.twinkleSpeed = options.twinkleSpeed || 1.5;
        this.twinkleIntensity = options.twinkleIntensity || 0.12;
        this.lastTextureUpdate = 0;
        this.textureUpdateInterval = options.textureUpdateInterval || 150;

        this.mesh = this.createGlareBillboard();


    }

    createSpikeParameters(distance) {
        let spikeLength = 0.65;
        let spikeWidth = 0.02;
        let centerRadius = 0.05;

        if (distance > this.maxScaleDistance) {
            spikeLength = 0.75;
            spikeWidth = 0.025;
            centerRadius = 0.04;
        } else if (distance > this.minScaleDistance) {
            const { ratio } = MathUtils.clampAndRatio(distance, this.minScaleDistance, this.maxScaleDistance);
            spikeLength = MathUtils.lerp(0.55, 0.7, ratio);
            spikeWidth = MathUtils.lerp(0.015, 0.025, ratio);
            centerRadius = MathUtils.lerp(0.06, 0.04, ratio);
        }

        return { spikeLength, spikeWidth, centerRadius };
    }

    createGlareBillboard() {
        const size = this.sunRadius * this.glareSize;
        const geometry = new THREE.PlaneGeometry(size, size);

        const material = new THREE.ShaderMaterial({
            transparent: true,
            depthWrite: false,
            depthTest: true,
            blending: THREE.AdditiveBlending,
            side: THREE.DoubleSide,
            uniforms: {
                uTime: { value: 0.0 },
                uEmissiveColor: { value: new THREE.Color(this.glareColor) },
                uOpacity: { value: this.glareOpacity },
                uCoreIntensity: { value: this.emissiveIntensity },
                uCoreWhiteness: { value: this.coreWhiteness },
                uGlowIntensity: { value: this.glowIntensity },
                uHaloRadius: { value: this.haloRadius },
                uHaloFalloff: { value: this.haloFalloff },
                uHaloStrength: { value: this.haloStrength },
                uSpikeLength: { value: 0.65 },
                uSpikeWidth: { value: 0.02 },
                uCenterRadius: { value: 0.05 },
                uCenterScale: { value: 1.0 },
                uTwinkleIntensity: { value: this.twinkleIntensity },
                uTwinkleSpeed: { value: this.twinkleSpeed },
                uDistanceFactor: { value: 1.0 }
            },
            vertexShader: `
                varying vec2 vUv;

                void main() {
                    vUv = uv;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                uniform float uTime;
                uniform vec3 uEmissiveColor;
                uniform float uOpacity;
                uniform float uCoreIntensity;
                uniform float uCoreWhiteness;
                uniform float uGlowIntensity;
                uniform float uHaloRadius;
                uniform float uHaloFalloff;
                uniform float uHaloStrength;
                uniform float uSpikeLength;
                uniform float uSpikeWidth;
                uniform float uCenterRadius;
                uniform float uCenterScale;
                uniform float uTwinkleIntensity;
                uniform float uTwinkleSpeed;
                uniform float uDistanceFactor;

                varying vec2 vUv;

                void main() {
                    vec2 center = vUv - 0.5;
                    float dist = length(center);

                    float haloFade = max(0.0, 1.0 - dist / uHaloRadius);
                    float halo = pow(haloFade, uHaloFalloff) * uHaloStrength;

                    float coreRadius = uCenterRadius * uCenterScale;
                    float core = smoothstep(coreRadius * 1.2, 0.0, dist);

                    float alpha = max(halo, core);

                    vec2 absCenter = abs(center);

                    float twinklePhase = uTime * uTwinkleSpeed;

                    float horizontalTwinkle = 1.0 + sin(twinklePhase) * uTwinkleIntensity +
                                             sin(twinklePhase * 1.7 + 2.1) * uTwinkleIntensity * 0.5;

                    float verticalTwinkle = 1.0 + sin(twinklePhase + 1.57079632679) * uTwinkleIntensity +
                                           sin(twinklePhase * 1.3 + 3.8) * uTwinkleIntensity * 0.6;

                    float adjustedSpikeLength = uSpikeLength * uDistanceFactor;
                    float adjustedSpikeWidth = uSpikeWidth * uCenterScale;

                    float pointinessFactor = 1.0 + (uDistanceFactor - 1.0) * 0.8;

                    if (absCenter.y <= adjustedSpikeWidth && absCenter.x <= adjustedSpikeLength) {
                        float spikeProgress = absCenter.x / adjustedSpikeLength;

                        float triangleWidth = adjustedSpikeWidth * (1.0 - spikeProgress);

                        if (absCenter.y <= triangleWidth) {
                            float lengthFade = 1.0 - spikeProgress;
                            float widthFade = 1.0 - (absCenter.y / triangleWidth);

                            lengthFade = pow(lengthFade, 2.0 * pointinessFactor);
                            widthFade = pow(widthFade, 0.3);

                            float horizontalAlpha = lengthFade * widthFade * horizontalTwinkle;
                            alpha = max(alpha, horizontalAlpha);
                        }
                    }

                    if (absCenter.x <= adjustedSpikeWidth && absCenter.y <= adjustedSpikeLength) {
                        float spikeProgress = absCenter.y / adjustedSpikeLength;

                        float triangleWidth = adjustedSpikeWidth * (1.0 - spikeProgress);

                        if (absCenter.x <= triangleWidth) {
                            float lengthFade = 1.0 - spikeProgress;
                            float widthFade = 1.0 - (absCenter.x / triangleWidth);

                            lengthFade = pow(lengthFade, 2.0 * pointinessFactor);
                            widthFade = pow(widthFade, 0.3);

                            float verticalAlpha = lengthFade * widthFade * verticalTwinkle;
                            alpha = max(alpha, verticalAlpha);
                        }
                    }

                    if (absCenter.x <= adjustedSpikeWidth && absCenter.y <= adjustedSpikeWidth) {
                        alpha = max(alpha, 0.8);
                    }

                    alpha = clamp(alpha, 0.0, 1.0);

                    vec3 haloColor = uEmissiveColor * uGlowIntensity;
                    vec3 coreColor = mix(uEmissiveColor, vec3(1.0), uCoreWhiteness) * uCoreIntensity;
                    vec3 finalColor = haloColor + coreColor * core * core;

                    gl_FragColor = vec4(finalColor, alpha * uOpacity);
                }
            `
        });

        this.material = material;

        const mesh = new THREE.Mesh(geometry, material);
        mesh.frustumCulled = false;
        mesh.renderOrder = 9999;

        mesh.position.set(0, 0, 0);

        return mesh;
    }

    update(deltaTime, camera, sunPosition = new THREE.Vector3(0, 0, 0)) {
        this.time += deltaTime;

        if (!this.mesh || !this.mesh.material) return;

        const distance = camera.position.distanceTo(sunPosition);

        this.updateFadeDistance(distance);

        this.updateBillboardOrientation(camera, sunPosition);

        let centerScale = 1.0;

        if (this.scaleCenterWithDistance && this.scaleWithDistance) {
            const { ratio: distanceRatio } = MathUtils.clampAndRatio(distance, this.minScaleDistance, this.maxScaleDistance);
            centerScale = MathUtils.lerp(this.minScale, this.maxScale, distanceRatio);
        }

        const spikeParams = this.createSpikeParameters(distance);

        let distanceFactor = 1.0;
        let emissiveBoost = 1.0;

        if (distance > this.minScaleDistance) {
            const { ratio: distanceRatio } = MathUtils.clampAndRatio(distance, this.minScaleDistance, this.maxScaleDistance * 2);
            distanceFactor = MathUtils.lerp(1.0, 1.8, distanceRatio);

            if (distance > this.maxScaleDistance) {
                const extremeDistanceRatio = Math.min((distance - this.maxScaleDistance) / this.maxScaleDistance, 2.0);
                emissiveBoost = 1.0 + extremeDistanceRatio * 1.5;
            }
        }

        if (this.material.uniforms) {
            this.material.uniforms.uTime.value = this.time;
            this.material.uniforms.uCenterScale.value = centerScale;
            this.material.uniforms.uOpacity.value = this.glareOpacity * this.currentFadeFactor;
            this.material.uniforms.uCoreIntensity.value = this.emissiveIntensity * this.currentFadeFactor * emissiveBoost;
            this.material.uniforms.uGlowIntensity.value = this.glowIntensity * this.currentFadeFactor;
            this.material.uniforms.uDistanceFactor.value = distanceFactor;
            this.material.uniforms.uTwinkleIntensity.value = this.twinkleIntensity;
            this.material.uniforms.uTwinkleSpeed.value = this.twinkleSpeed;

            this.material.uniforms.uSpikeLength.value = spikeParams.spikeLength;
            this.material.uniforms.uSpikeWidth.value = spikeParams.spikeWidth;
            this.material.uniforms.uCenterRadius.value = spikeParams.centerRadius;
        }

        let scaleFactor = 1.0;

        if (this.scaleWithDistance) {
            const { ratio: distanceRatio } = MathUtils.clampAndRatio(distance, this.minScaleDistance, this.maxScaleDistance);

            scaleFactor = MathUtils.lerp(this.minScale, this.maxScale, distanceRatio);
        }

        this.mesh.scale.setScalar(scaleFactor);
    }

    updateFadeDistance(_distance) {
        this.currentFadeFactor = 1.0;
    }

    updateBillboardOrientation(_camera, _sunPosition) {
    }

    setGlareSize(size) {
        this.glareSize = size;
        if (this.mesh && this.mesh.geometry) {
            const newSize = this.sunRadius * size;
            this.mesh.geometry.dispose();
            this.mesh.geometry = new THREE.PlaneGeometry(newSize, newSize);
        }
    }

    setGlareOpacity(opacity) {
        this.glareOpacity = opacity;
        if (this.material && this.material.uniforms) {
            this.material.uniforms.uOpacity.value = opacity * this.currentFadeFactor;
        }
    }

    setGlareColor(color) {
        this.glareColor = color;
        if (this.material && this.material.uniforms) {
            this.material.uniforms.uEmissiveColor.value.set(color);
        }
    }

    setEmissiveIntensity(intensity) {
        this.emissiveIntensity = intensity;
        if (this.material && this.material.uniforms) {
            this.material.uniforms.uCoreIntensity.value = intensity * this.currentFadeFactor;
        }
    }

    setGlowIntensity(intensity) {
        this.glowIntensity = intensity;
        if (this.material && this.material.uniforms) {
            this.material.uniforms.uGlowIntensity.value = intensity * this.currentFadeFactor;
        }
    }

    getEmissiveIntensity() {
        return this.emissiveIntensity;
    }

    setTwinkleEnabled(enabled) {
        this.twinkleEnabled = enabled;
        this.lastTextureUpdate = 0;
    }

    setTwinkleSpeed(speed) {
        this.twinkleSpeed = speed;
        this.lastTextureUpdate = 0;
    }

    setTwinkleIntensity(intensity) {
        this.twinkleIntensity = intensity;
        if (this.material && this.material.uniforms) {
            this.material.uniforms.uTwinkleIntensity.value = intensity;
        }
    }

    setSpikeParameters(params = {}) {
        if (this.material && this.material.uniforms) {
            if (params.length !== undefined) {
                this.material.uniforms.uSpikeLength.value = params.length;
            }
            if (params.width !== undefined) {
                this.material.uniforms.uSpikeWidth.value = params.width;
            }
            if (params.centerRadius !== undefined) {
                this.material.uniforms.uCenterRadius.value = params.centerRadius;
            }
        }
    }

    getSpikeParameters() {
        if (this.material && this.material.uniforms) {
            return {
                length: this.material.uniforms.uSpikeLength.value,
                width: this.material.uniforms.uSpikeWidth.value,
                centerRadius: this.material.uniforms.uCenterRadius.value,
                distanceFactor: this.material.uniforms.uDistanceFactor.value
            };
        }
        return null;
    }

    getTwinkleSettings() {
        return {
            enabled: this.twinkleEnabled,
            speed: this.twinkleSpeed,
            intensity: this.twinkleIntensity,
            updateInterval: this.textureUpdateInterval
        };
    }

    setFadeDistances(startDistance, endDistance) {
        this.fadeStartDistance = startDistance;
        this.fadeEndDistance = endDistance;
    }

    getMesh() {
        return this.mesh;
    }

    getAllMeshes() {
        return [this.mesh].filter(mesh => mesh !== null);
    }

    addToScene(parent) {
        if (this.mesh) {
            parent.add(this.mesh);
        }
    }

    removeFromScene(parent) {
        if (this.mesh) {
            parent.remove(this.mesh);
        }
    }

    dispose() {
        if (this.mesh) {
            if (this.mesh.geometry) this.mesh.geometry.dispose();
            if (this.material) {
                if (this.material.map) this.material.map.dispose();
                this.material.dispose();
            }
        }
    }
}

export default SunGlare;