import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { BLOOM, SCENE, STAR_VISIBILITY } from '../constants.js';
import { log } from '../utils/Logger.js';

const _bloomResolution = new THREE.Vector2();

export class BloomManager {
    constructor(scene, camera, renderer) {
        this.scene = scene;
        this.camera = camera;
        this.renderer = renderer;

        const isMobile = this.isMobileDevice();
        this.enabled = !isMobile;
        this.userEnabled = !isMobile;
        this.manuallyControlled = false;
        this.mobileDevice = isMobile;

        log.info('BloomManager', '🌟 BloomManager initialized', {
            isMobile: isMobile,
            enabled: this.enabled,
            message: isMobile ? 'Bloom disabled for mobile performance' : 'Bloom enabled for desktop'
        });

        if (isMobile) {
            log.info('BloomManager', '🌟 Mobile device detected - bloom disabled for performance');
        }

        this.bloomConfig = {
            strength: BLOOM.STRENGTH,
            radius: BLOOM.RADIUS,
            threshold: BLOOM.THRESHOLD
        };

        this.starObjects = new Map();

        this.initializePostProcessing();
    }

    isMobileDevice() {
        if (typeof window === 'undefined' || typeof navigator === 'undefined') {
            log.info('BloomManager', '🌟 BloomManager: No window/navigator - assuming desktop');
            return false;
        }

        const userAgent = navigator.userAgent.toLowerCase();
        const isMobile = /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(userAgent);

        const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
        const isSmallScreen = window.innerWidth <= 768 || window.innerHeight <= 768;

        const result = isMobile || (isTouchDevice && isSmallScreen);

        log.debug('BloomManager', '🌟 BloomManager Mobile Detection', {
            userAgent: userAgent,
            isMobile: isMobile,
            isTouchDevice: isTouchDevice,
            isSmallScreen: isSmallScreen,
            screenSize: `${window.innerWidth}x${window.innerHeight}`,
            finalResult: result
        });

        return result;
    }

    #getBloomResolution(target) {
        this.renderer.getDrawingBufferSize(target);
        return target.multiplyScalar(BLOOM.RESOLUTION_MULTIPLIER);
    }

    initializePostProcessing() {
        this.composer = new EffectComposer(this.renderer);

        this.composer.renderTarget1.samples = SCENE.MSAA_SAMPLES;
        this.composer.renderTarget2.samples = SCENE.MSAA_SAMPLES;

        const renderPass = new RenderPass(this.scene, this.camera);
        this.composer.addPass(renderPass);

        const bloomPass = new UnrealBloomPass(
            this.#getBloomResolution(new THREE.Vector2()),
            this.bloomConfig.strength,
            this.bloomConfig.radius,
            this.bloomConfig.threshold
        );
        this.bloomPass = bloomPass;
        this.composer.addPass(bloomPass);

        const outputPass = new OutputPass();
        this.composer.addPass(outputPass);
    }

    registerStar(starObject) {
        let starMaterial = null;
        let baseEmissiveIntensity = 2.0;
        let starRays = null;
        let starFlares = null;
        const meshes = [];
        const lights = [];
        const orbitLines = [];

        starObject.traverse((child) => {
            if (child.isMesh && child.material) {
                meshes.push(child);

                if (child.material.emissiveIntensity !== undefined) {
                    starMaterial = child.material;
                    baseEmissiveIntensity = child.material.emissiveIntensity;
                }

                if (typeof child.material.setEmissiveIntensity === 'function' && child.material.uEmissiveIntensity) {
                    starMaterial = child.material;
                    baseEmissiveIntensity = child.material.uEmissiveIntensity.value;
                }
            }

            if (child.isLight) {
                lights.push(child);
            }

            if (child.isLineSegments2) {
                orbitLines.push(child);
            }
        });

        if (starObject.sunRays && typeof starObject.sunRays.setEmissiveIntensity === 'function') {
            starRays = starObject.sunRays;
        }

        if (starObject.sunFlares && typeof starObject.sunFlares.setEmissiveIntensity === 'function') {
            starFlares = starObject.sunFlares;
        }

        if (starMaterial) {
            let baseBrightness = 1.4;
            if (starMaterial.uBrightness) {
                baseBrightness = starMaterial.uBrightness.value;
            }

            const radiusScale = starObject.bodyInstance?.radiusScale || 1.0;

            this.starObjects.set(starObject, {
                material: starMaterial,
                baseEmissiveIntensity: baseEmissiveIntensity,
                baseBrightness: baseBrightness,
                rays: starRays,
                flares: starFlares,
                baseRaysIntensity: starRays ? starRays.getEmissiveIntensity() : null,
                baseFlaresIntensity: starFlares ? starFlares.getEmissiveIntensity() : null,
                radiusScale: radiusScale,
                meshes: meshes,
                lights: lights,
                orbitLines: orbitLines
            });
        } else {
            log.warn('BloomManager', 'Could not find star material for bloom control in:', starObject.name || 'unnamed');
        }
    }

    unregisterStar(starObject) {
        this.starObjects.delete(starObject);
    }

    updateBloomIntensity(cameraPosition) {
        let closestScaledDistance = Infinity;
        let closestStarName = 'unknown';
        let bloomStrength = this.bloomConfig.strength;

        for (const [starObject, starData] of this.starObjects) {
            const actualDistance = cameraPosition.distanceTo(starObject.position);

            const effectiveDisableDistance = BLOOM.DISABLE_DISTANCE * starData.radiusScale;

            if (actualDistance < closestScaledDistance) {
                closestScaledDistance = actualDistance;
                closestStarName = starObject.name || 'unnamed star';
                this.closestStarData = starData;
            }

            this.updateStarMeshVisibility(starObject, starData, actualDistance);

            if (typeof starData.material.setEmissiveIntensity === 'function') {
                starData.material.setEmissiveIntensity(starData.baseEmissiveIntensity);
            } else {
                starData.material.emissiveIntensity = starData.baseEmissiveIntensity;
            }
        }

        const radiusScale = this.closestStarData ? this.closestStarData.radiusScale : 1.0;
        const scaledMaxDistance = BLOOM.MAX_BLOOM_DISTANCE * radiusScale;
        const scaledFadeStartDistance = BLOOM.FADE_START_DISTANCE * radiusScale;
        const scaledFadeEndDistance = BLOOM.FADE_END_DISTANCE * radiusScale;
        const scaledDisableDistance = BLOOM.DISABLE_DISTANCE * radiusScale;

        if (closestScaledDistance >= scaledMaxDistance) {
            bloomStrength = 0;
        } else if (closestScaledDistance >= scaledFadeStartDistance) {
            const fadeRatio = (scaledMaxDistance - closestScaledDistance) / (scaledMaxDistance - scaledFadeStartDistance);
            bloomStrength = this.bloomConfig.strength * fadeRatio;
        } else if (closestScaledDistance >= scaledFadeEndDistance) {
            const fadeRatio = (closestScaledDistance - scaledFadeEndDistance) / (scaledFadeStartDistance - scaledFadeEndDistance);
            bloomStrength = this.bloomConfig.strength * fadeRatio;
        } else {
            bloomStrength = 0;
        }

        const shouldDisable = closestScaledDistance <= scaledDisableDistance;

        if (shouldDisable) {
            this.enabled = false;
        } else {
            if (this.manuallyControlled) {
                this.enabled = this.userEnabled;
            } else {
                this.enabled = !this.mobileDevice;
            }
        }

        if (this.enabled) {
            this.bloomPass.strength = bloomStrength;
        }

    }

    updateStarMeshVisibility(starObject, starData, distance) {
        if (!STAR_VISIBILITY.HIDE_MESH_BY_DEFAULT) {
            return;
        }

        let starMeshOpacity = 1.0;

        if (distance > STAR_VISIBILITY.MAX_VISIBILITY_DISTANCE) {
            starMeshOpacity = 0.0;
        } else if (distance > STAR_VISIBILITY.MAX_VISIBILITY_DISTANCE - STAR_VISIBILITY.FADE_TRANSITION_RANGE) {
            const fadeRatio = (STAR_VISIBILITY.MAX_VISIBILITY_DISTANCE - distance) / STAR_VISIBILITY.FADE_TRANSITION_RANGE;
            starMeshOpacity = Math.max(0, Math.min(1, fadeRatio));
        } else if (distance > STAR_VISIBILITY.MIN_VISIBILITY_DISTANCE) {
            starMeshOpacity = 1.0;
        } else {
            starMeshOpacity = 1.0;
        }

        if (starData.orbitLines) {
            for (const line of starData.orbitLines) {
                if (line.visible) {
                    line.visible = true;
                }
            }
        }

        if (starData.lights) {
            for (const light of starData.lights) {
                light.visible = true;
            }
        }

        if (starData.meshes) {
            for (const mesh of starData.meshes) {
                if (mesh.material === starData.material ||
                    (mesh.material.type && !mesh.material.type.includes('Glare'))) {
                    if (starMeshOpacity < 1.0) {
                        mesh.material.transparent = true;
                        mesh.material.opacity = starMeshOpacity;
                        mesh.visible = starMeshOpacity > 0.01;
                    } else {
                        mesh.material.opacity = 1.0;
                        mesh.visible = true;
                    }
                }
            }
        }

        if (starObject.emittedLight) {
            starObject.emittedLight.visible = true;
        }

        if (STAR_VISIBILITY.KEEP_GLARE_VISIBLE && starObject.sunGlare) {
            starObject.sunGlare.mesh.visible = true;
            if (starObject.sunGlare.mesh.material) {
                starObject.sunGlare.mesh.material.opacity = 1.0;
            }
        }

        if (STAR_VISIBILITY.KEEP_GLARE_VISIBLE) {
            if (starObject.sunRays && starObject.sunRays.mesh) {
                starObject.sunRays.mesh.visible = true;
            }
            if (starObject.sunFlares && starObject.sunFlares.mesh) {
                starObject.sunFlares.mesh.visible = true;
            }
        }
    }

    render() {
        if (this.enabled) {
            this.composer.render();
        } else {
            this.renderer.render(this.scene, this.camera);
        }
    }

    handleResize(width, height) {
        this.composer.setSize(width, height);

        const resolution = this.#getBloomResolution(_bloomResolution);
        this.bloomPass.setSize(resolution.x, resolution.y);
    }

    updateBloomConfig(config) {
        if (config.strength !== undefined) {
            this.bloomConfig.strength = config.strength;
            this.bloomPass.strength = config.strength;
        }
        if (config.radius !== undefined) {
            this.bloomConfig.radius = config.radius;
            this.bloomPass.radius = config.radius;
        }
        if (config.threshold !== undefined) {
            this.bloomConfig.threshold = config.threshold;
            this.bloomPass.threshold = config.threshold;
        }

    }

    toggleBloom() {
        this.userEnabled = !this.userEnabled;
        this.manuallyControlled = true;
        return this.userEnabled;
    }

    enableBloom() {
        this.userEnabled = true;
        this.manuallyControlled = true;
    }

    disableBloom() {
        this.userEnabled = false;
        this.manuallyControlled = true;
    }

    isBloomEnabled() {
        return this.userEnabled;
    }

    dispose() {
        this.composer.dispose();
    }
}

export default BloomManager;