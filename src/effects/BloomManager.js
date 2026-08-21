import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import BlackHoleLensPass from './BlackHoleLensPass.js';
import BodyLensPass from './BodyLensPass.js';
import ShadowMaskedBloomPass from './ShadowMaskedBloomPass.js';
import { BLOOM, SCENE, STAR_VISIBILITY } from '../constants.js';
import { log } from '../utils/Logger.js';

/**
 * Scratch vector for resolution calculations, reused to avoid per-resize allocation.
 *
 * @type {THREE.Vector2}
 */
const _bloomResolution = new THREE.Vector2();

/**
 * Owns the post-processing chain and the glow around stars.
 *
 * Bloom is what makes a star look bright rather than merely white, but it is expensive
 * and it is only worth anything when a star is actually on screen at a plausible
 * distance. So the strength is driven from the camera's distance to the nearest star:
 * zero when too far for the glow to mean anything, ramping up over an intermediate
 * band, and off again close in, where a full-screen bloom would wash out everything
 * else. All the distances are scaled by the star's radius, so a red dwarf and a
 * supergiant both bloom over a sensible range of *their* size.
 *
 * Off by default on mobile, where the cost is not affordable, unless the user turns it
 * on explicitly.
 *
 * It also owns {@link BlackHoleLensPass}, which is not bloom but shares the composer with it
 * — and has to sit inside it, before the bloom, so that light gravitational lensing has
 * concentrated blooms like any other bright light. Sharing the chain means the two effects also
 * have to share the decision to use it at all: whether the composer runs is whether *either* has
 * something to do.
 *
 * The two are coupled the other way round as well, since a black hole's shadow is the one thing
 * bloom must not reach; see {@link ShadowMaskedBloomPass}.
 */
export class BloomManager {
    /**
     * Builds the post-processing chain and picks a default for this device.
     *
     * @param {THREE.Scene} scene - Scene to render.
     * @param {THREE.Camera} camera - Camera to render from.
     * @param {THREE.WebGLRenderer} renderer - Renderer the composer wraps.
     */
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
        this.blackHoles = new Set();

        this.initializePostProcessing();
    }

    /**
     * Guesses whether this is a mobile device, to pick a bloom default.
     *
     * The user agent alone misses tablets and devices that spoof it, so a touch device
     * with a small viewport counts too. Only a default is being chosen here, and the user
     * can override it, so a wrong guess is not serious.
     *
     * @returns {boolean} `true` if this looks like a mobile device.
     */
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

    /**
     * Computes the bloom pass's working resolution.
     *
     * Deliberately a fraction of the drawing buffer: bloom is a wide blur, so running it
     * at full resolution costs several times as much for a result that is nearly
     * indistinguishable.
     *
     * @private
     * @param {THREE.Vector2} target - Vector to write into and return.
     * @returns {THREE.Vector2} `target`, holding the bloom resolution.
     */
    #getBloomResolution(target) {
        this.renderer.getDrawingBufferSize(target);
        return target.multiplyScalar(BLOOM.RESOLUTION_MULTIPLIER);
    }

    /**
     * Builds the composer: render, then lensing, then bloom, then output.
     *
     * MSAA is set on the composer's own targets. Post-processing bypasses the canvas's
     * antialiasing entirely, and without this every orbit line and planet limb would go
     * jagged the moment bloom is switched on.
     *
     * Both targets are given a depth texture, so that whichever one the scene was rendered into
     * carries the depth of that render. {@link BlackHoleLensPass} needs it to tell what is in
     * front of a black hole from what is behind it, and it takes it from the buffer it is handed;
     * which of the two that is varies with how many enabled passes swapped on the frames before,
     * so both have to be able to answer. One texture shared between them would not do: a pass
     * rendering into a target clears that target's depth, so the pass would wipe the depth it was
     * about to read. The resolve of the multisampled depth into the texture is the renderer's own
     * doing, and only happens because the texture is there to receive it.
     *
     * The lens pass goes between the render and the bloom, since what it does is move light
     * around and the bloom should see where it ended up. It starts disabled and stays that way
     * until a frame actually has a black hole in it.
     *
     * {@link BodyLensPass} goes before it, and it is the render pass's alternative rather than an
     * addition to it: on the frames it runs it draws the scene itself, in two layers, so that the
     * bodies can be bent without the sky going with them. Which of the two is doing the rendering is
     * decided per frame in {@link BloomManager#updateLensing}. It is built after the lens pass and
     * handed it for the same reason bloom is — the hole geometry is worked out once, there.
     *
     * Bloom is built after it and handed it, because {@link ShadowMaskedBloomPass} masks its glow
     * by the shadows the lens pass has already located. The order of construction is therefore not
     * incidental, and it is not the order in the chain either: the lens pass is built before both of
     * the passes that read from it, and added between them.
     *
     * The output pass does tone mapping and the colour-space conversion the renderer would
     * otherwise have done itself; it must come last.
     *
     * @returns {void}
     */
    initializePostProcessing() {
        this.composer = new EffectComposer(this.renderer);

        this.composer.renderTarget1.samples = SCENE.MSAA_SAMPLES;
        this.composer.renderTarget2.samples = SCENE.MSAA_SAMPLES;

        const bufferSize = this.renderer.getDrawingBufferSize(new THREE.Vector2());
        this.composer.renderTarget1.depthTexture =
            new THREE.DepthTexture(bufferSize.x, bufferSize.y);
        this.composer.renderTarget2.depthTexture =
            new THREE.DepthTexture(bufferSize.x, bufferSize.y);

        this.renderPass = new RenderPass(this.scene, this.camera);
        this.composer.addPass(this.renderPass);

        this.lensPass = new BlackHoleLensPass();

        this.bodyLensPass = new BodyLensPass(this.scene, this.camera, this.lensPass);
        this.composer.addPass(this.bodyLensPass);

        this.composer.addPass(this.lensPass);

        const bloomPass = new ShadowMaskedBloomPass(
            this.#getBloomResolution(new THREE.Vector2()),
            this.bloomConfig.strength,
            this.bloomConfig.radius,
            this.bloomConfig.threshold,
            this.lensPass
        );
        this.bloomPass = bloomPass;
        this.composer.addPass(bloomPass);

        const outputPass = new OutputPass();
        this.composer.addPass(outputPass);
    }

    /**
     * Records a star and everything about it that bloom has to drive.
     *
     * The object is traversed once here rather than every frame, and its meshes, lights,
     * orbit lines and effect layers are cached. Baseline intensities are captured at the
     * same time, so the per-frame code can scale from them without having to know what a
     * given star was originally set to.
     *
     * Both material conventions are checked: the star shader's `uEmissiveIntensity`
     * uniform, and a plain material's `emissiveIntensity` property.
     *
     * A star whose material cannot be found is not registered — there would be nothing to
     * drive — and is logged, since it means the body was built without a star material.
     *
     * @param {THREE.Object3D} starObject - The star's group.
     * @returns {void}
     */
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

    /**
     * Stops driving bloom from a star, so a removed one is not held alive.
     *
     * @param {THREE.Object3D} starObject - The star's group.
     * @returns {void}
     */
    unregisterStar(starObject) {
        this.starObjects.delete(starObject);
    }

    /**
     * Records a black hole so it bends light.
     *
     * The {@link Body} itself is kept rather than its group, because the pass needs the drawn
     * radius and the resolved lensing settings as well as the world position, and nothing about
     * it has to be cached: unlike a star, a hole has no material for this to drive.
     *
     * @param {Body} body - The hole's body.
     * @returns {void}
     */
    registerBlackHole(body) {
        this.blackHoles.add(body);
    }

    /**
     * Stops a black hole bending light, so a removed one is not held alive.
     *
     * @param {Body} body - The hole's body.
     * @returns {void}
     */
    unregisterBlackHole(body) {
        this.blackHoles.delete(body);
    }

    /**
     * Aims the lens pass at this frame's black holes, and switches it off if there are none.
     *
     * The pass does the culling and reports back, since it is the only thing that knows what
     * counts as too small or too far off screen to bother with. Disabling it rather than letting
     * it run with an empty lens list matters, because an enabled pass costs a full-screen copy
     * even when its shader returns its input unchanged.
     *
     * The same measurement decides whether the bodies are being bent, and that answer is a choice
     * between two ways of rendering the frame rather than an effect to switch on: where
     * {@link BodyLensPass} runs it draws the scene in two layers itself, so the ordinary render pass
     * has to go off in the same frame or the bodies would be drawn twice — once unbent, once bent
     * over the top. The pair is set here and nowhere else.
     *
     * @returns {void}
     */
    updateLensing() {
        this.lensPass.enabled = this.lensPass.update(this.blackHoles, this.camera, this.renderer);

        this.bodyLensPass.enabled = this.lensPass.bendsBodies;
        this.renderPass.enabled = !this.bodyLensPass.enabled;
    }

    /**
     * Sets this frame's bloom strength from the camera's distance to the nearest star.
     *
     * Three bands, all scaled by the star's radius so they mean the same thing for any
     * size of star. Beyond the maximum, nothing: the star is a point of light and a glow
     * around it would only be a smear. Between the maximum and the fade start, ramping
     * down with distance. Between the fade start and fade end, ramping up as the star
     * grows on screen. Closer than the fade end, nothing again — filling the view with a
     * star's glow leaves nothing else visible.
     *
     * Inside the disable distance the pass is switched off entirely rather than merely
     * set to zero, since a zero-strength bloom still costs a full blur. The pass's own
     * `enabled` flag is what does that, not the composer bypass in {@link BloomManager#render}
     * — the composer may still be running for the sake of the lens pass, and bloom must not
     * come back on when it is.
     *
     * @param {THREE.Vector3} cameraPosition - Camera's world position.
     * @returns {void}
     */
    updateBloomIntensity(cameraPosition) {
        let closestScaledDistance = Infinity;
        let bloomStrength = this.bloomConfig.strength;

        for (const [starObject, starData] of this.starObjects) {
            const actualDistance = cameraPosition.distanceTo(starObject.position);

            if (actualDistance < closestScaledDistance) {
                closestScaledDistance = actualDistance;
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

        this.bloomPass.enabled = this.enabled;

        if (this.enabled) {
            this.bloomPass.strength = bloomStrength;
        }

    }

    /**
     * Fades the star's surface mesh out at great distances.
     *
     * Far enough away the sphere is smaller than a pixel, and what should read as a point
     * of light instead flickers as the sphere drops in and out of the sample grid. Fading
     * the mesh out leaves the glare and rays, which are billboards and stay steady.
     *
     * The star's lights are held visible throughout, since hiding them would unlight the
     * whole system, as are its orbit lines and its glare — the glare is how the star is
     * found once the mesh has gone.
     *
     * Glare materials are skipped when fading, so the glow does not fade with the surface.
     *
     * Does nothing unless the mesh-hiding behaviour is enabled in the configuration.
     *
     * @param {THREE.Object3D} starObject - The star's group.
     * @param {Object} starData - The cached entry for this star.
     * @param {number} distance - Camera's distance to the star, in scene units.
     * @returns {void}
     */
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

    /**
     * Draws the frame, through the composer or straight to the canvas.
     *
     * Bypassing the composer when nothing needs it avoids paying for the extra render targets
     * and the copy through them. Lensing counts as needing it just as much as bloom does, which
     * is what keeps a black hole distorting on a device where bloom is off — and each pass
     * carries its own `enabled` flag, so running the chain for one does not turn on the other.
     *
     * @returns {void}
     */
    render() {
        if (this.enabled || this.lensPass.enabled) {
            this.composer.render();
        } else {
            this.renderer.render(this.scene, this.camera);
        }
    }

    /**
     * Resizes the composer and the bloom pass.
     *
     * The bloom pass is sized separately, since it works at a fraction of the full
     * resolution and `setSize` on the composer would put it at full size.
     *
     * @param {number} width - New width in pixels.
     * @param {number} height - New height in pixels.
     * @returns {void}
     */
    handleResize(width, height) {
        this.composer.setSize(width, height);

        const resolution = this.#getBloomResolution(_bloomResolution);
        this.bloomPass.setSize(resolution.x, resolution.y);
    }

    /**
     * Flips bloom, and takes the choice out of the device default's hands.
     *
     * Once the user has expressed a preference the mobile default stops applying, so it
     * cannot silently override them on the next frame.
     *
     * @returns {boolean} `true` if the user has now enabled bloom.
     */
    toggleBloom() {
        this.userEnabled = !this.userEnabled;
        this.manuallyControlled = true;
        return this.userEnabled;
    }

    /**
     * Turns bloom on, overriding the device default.
     *
     * Distance still governs whether it is actually applied on a given frame.
     *
     * @returns {void}
     */
    enableBloom() {
        this.userEnabled = true;
        this.manuallyControlled = true;
    }

    /**
     * Turns bloom off, overriding the device default.
     *
     * @returns {void}
     */
    disableBloom() {
        this.userEnabled = false;
        this.manuallyControlled = true;
    }

    /**
     * Reports the user's preference, not whether bloom is applied this frame.
     *
     * The UI wants the preference: showing the distance-driven state would make the
     * control appear to toggle itself as the camera moves.
     *
     * @returns {boolean} `true` if bloom is enabled.
     */
    isBloomEnabled() {
        return this.userEnabled;
    }

    /**
     * Releases the composer's render targets, and the body layer's.
     *
     * The composer frees its own two targets and nothing belonging to the passes in it, so the one
     * pass here that owns a target of its own is disposed by name.
     *
     * @returns {void}
     */
    dispose() {
        this.bodyLensPass.dispose();
        this.composer.dispose();
    }
}

export default BloomManager;