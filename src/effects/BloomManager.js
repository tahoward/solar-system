import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { BLOOM, STAR_VISIBILITY } from '../constants.js';
import { log } from '../utils/Logger.js';

/**
 * BloomManager handles selective bloom effects for stars in the solar system
 */
export class BloomManager {
    constructor(scene, camera, renderer) {
        this.scene = scene;
        this.camera = camera;
        this.renderer = renderer;

        // Bloom enable/disable flag - disable on mobile devices for performance
        const isMobile = this.isMobileDevice();
        this.enabled = !isMobile;  // Actual bloom state (controlled by distance and user preference)
        this.userEnabled = !isMobile;  // User's preference for bloom (what they want when not close to stars)
        this.manuallyControlled = false;  // Track if user has manually overridden bloom (either enabled or disabled)
        this.mobileDevice = isMobile;   // Store mobile status to prevent re-enabling

        log.info('BloomManager', '🌟 BloomManager initialized', {
            isMobile: isMobile,
            enabled: this.enabled,
            message: isMobile ? 'Bloom disabled for mobile performance' : 'Bloom enabled for desktop'
        });

        if (isMobile) {
            log.info('BloomManager', '🌟 Mobile device detected - bloom disabled for performance');
        }

        // Bloom configuration - use constants for centralized control
        this.bloomConfig = {
            strength: BLOOM.STRENGTH,      // Bloom strength from constants
            radius: BLOOM.RADIUS,          // Bloom radius from constants
            threshold: BLOOM.THRESHOLD     // Threshold - only emissive materials > 1.0 will bloom
        };

        // Track star objects for distance-based bloom control
        this.starObjects = new Map(); // Map of starObject -> { material, baseEmissiveIntensity }

        this.initializePostProcessing();
    }

    /**
     * Detect if the current device is a mobile device
     * @returns {boolean} True if mobile device detected
     * @private
     */
    isMobileDevice() {
        if (typeof window === 'undefined' || typeof navigator === 'undefined') {
            log.info('BloomManager', '🌟 BloomManager: No window/navigator - assuming desktop');
            return false;
        }

        const userAgent = navigator.userAgent.toLowerCase();
        const isMobile = /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(userAgent);

        // Also check for touch capability and screen size
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
     * Initialize the post-processing pipeline
     */
    initializePostProcessing() {
        // Create simple composer with selective bloom
        this.composer = new EffectComposer(this.renderer);

        // Add render pass
        const renderPass = new RenderPass(this.scene, this.camera);
        this.composer.addPass(renderPass);

        // Create bloom pass with threshold 1.0 for selective bloom and higher resolution
        const bloomPass = new UnrealBloomPass(
            new THREE.Vector2(window.innerWidth * BLOOM.RESOLUTION_MULTIPLIER, window.innerHeight * BLOOM.RESOLUTION_MULTIPLIER),  // High resolution for smoother bloom
            this.bloomConfig.strength,
            this.bloomConfig.radius,
            this.bloomConfig.threshold  // 1.0 threshold - only emissive > 1.0 blooms
        );
        this.bloomPass = bloomPass;
        this.composer.addPass(bloomPass);

        // Add output pass
        const outputPass = new OutputPass();
        this.composer.addPass(outputPass);
    }

    /**
     * Register a star object for distance-based bloom control
     * @param {THREE.Object3D} starObject - The star object (Body.group)
     */
    registerStar(starObject) {
        // Find the star's material (usually in starObject.children[0].material)
        let starMaterial = null;
        let baseEmissiveIntensity = 2.0; // Default fallback
        let starRays = null;
        let starFlares = null;

        // Look for the star material in the object hierarchy
        starObject.traverse((child) => {
            if (child.isMesh && child.material) {
                // Check for regular materials with emissiveIntensity property
                if (child.material.emissiveIntensity !== undefined) {
                    starMaterial = child.material;
                    baseEmissiveIntensity = child.material.emissiveIntensity;
                    return;
                }

                // Check for shader materials with setEmissiveIntensity method (like SunShaderMaterial)
                if (typeof child.material.setEmissiveIntensity === 'function' && child.material.uEmissiveIntensity) {
                    starMaterial = child.material;
                    baseEmissiveIntensity = child.material.uEmissiveIntensity.value;
                    return;
                }
            }
        });

        // Check for sun rays and flares on the star object (Body instance)
        if (starObject.sunRays && typeof starObject.sunRays.setEmissiveIntensity === 'function') {
            starRays = starObject.sunRays;
        }

        if (starObject.sunFlares && typeof starObject.sunFlares.setEmissiveIntensity === 'function') {
            starFlares = starObject.sunFlares;
        }

        if (starMaterial) {
            // Store base brightness value for restoration
            let baseBrightness = 1.4; // Default fallback
            if (starMaterial.uBrightness) {
                baseBrightness = starMaterial.uBrightness.value;
            }

            // Extract radiusScale from the Body instance for proportional bloom distances
            const radiusScale = starObject.bodyInstance?.radiusScale || 1.0;

            this.starObjects.set(starObject, {
                material: starMaterial,
                baseEmissiveIntensity: baseEmissiveIntensity,
                baseBrightness: baseBrightness,
                rays: starRays,
                flares: starFlares,
                baseRaysIntensity: starRays ? starRays.getEmissiveIntensity() : null,
                baseFlaresIntensity: starFlares ? starFlares.getEmissiveIntensity() : null,
                radiusScale: radiusScale  // Store for distance scaling
            });
        } else {
            log.warn('BloomManager', 'Could not find star material for bloom control in:', starObject.name || 'unnamed');
        }
    }

    /**
     * Unregister a star object from distance-based bloom control
     */
    unregisterStar(starObject) {
        this.starObjects.delete(starObject);
    }

    /**
     * Update bloom intensity and star visibility based on camera distance to stars
     * @param {THREE.Vector3} cameraPosition - Current camera position
     */
    updateBloomIntensity(cameraPosition) {
        // Find the closest star to determine overall bloom strength
        let closestScaledDistance = Infinity;  // Use scaled distance for comparison
        let closestStarName = 'unknown';
        let bloomStrength = this.bloomConfig.strength;

        // Update each registered star's visibility and emissive intensity based on camera distance
        for (const [starObject, starData] of this.starObjects) {
            const actualDistance = cameraPosition.distanceTo(starObject.position);
            // For bloom logic, we compare actual distance against scaled thresholds
            // This way larger stars (higher radiusScale) have larger disable distances

            // Track closest actual distance and associated star data for bloom logic
            const effectiveDisableDistance = BLOOM.DISABLE_DISTANCE * starData.radiusScale;

            if (actualDistance < closestScaledDistance) {
                closestScaledDistance = actualDistance;
                closestStarName = starObject.name || 'unnamed star';
                // Store the star data for the closest star so we can use its radiusScale for thresholds
                this.closestStarData = starData;
            }

            // Control star mesh visibility based on actual distance (while keeping glare visible)
            this.updateStarMeshVisibility(starObject, starData, actualDistance);

            // Keep material emissive intensity high for bloom detection
            if (typeof starData.material.setEmissiveIntensity === 'function') {
                starData.material.setEmissiveIntensity(starData.baseEmissiveIntensity);
            } else {
                starData.material.emissiveIntensity = starData.baseEmissiveIntensity;
            }
        }

        // Calculate scaled thresholds based on the closest star's radiusScale
        const radiusScale = this.closestStarData ? this.closestStarData.radiusScale : 1.0;
        const scaledMaxDistance = BLOOM.MAX_BLOOM_DISTANCE * radiusScale;
        const scaledFadeStartDistance = BLOOM.FADE_START_DISTANCE * radiusScale;
        const scaledFadeEndDistance = BLOOM.FADE_END_DISTANCE * radiusScale;
        const scaledDisableDistance = BLOOM.DISABLE_DISTANCE * radiusScale;

        // Adjust overall bloom pass strength based on closest star distance
        // Use scaled thresholds that are proportional to star size
        if (closestScaledDistance >= scaledMaxDistance) {
            // No bloom when beyond max scaled distance units from stars
            bloomStrength = 0;
        } else if (closestScaledDistance >= scaledFadeStartDistance) {
            // Bloom increases from 0 to full strength (max distance → fade start distance)
            const fadeRatio = (scaledMaxDistance - closestScaledDistance) / (scaledMaxDistance - scaledFadeStartDistance);
            bloomStrength = this.bloomConfig.strength * fadeRatio;
        } else if (closestScaledDistance >= scaledFadeEndDistance) {
            // Bloom decreases from full to 0 (fade start distance → fade end distance)
            const fadeRatio = (closestScaledDistance - scaledFadeEndDistance) / (scaledFadeStartDistance - scaledFadeEndDistance);
            bloomStrength = this.bloomConfig.strength * fadeRatio;
        } else {
            // No bloom when closer than fade end distance
            bloomStrength = 0;
        }

        // Distance-based bloom control - always disable when close to stars
        const shouldDisable = closestScaledDistance <= scaledDisableDistance;

        if (shouldDisable) {
            // ALWAYS disable bloom when close to stars, regardless of user preference
            this.enabled = false;
        } else {
            // When far from stars, use user's preference (if manually controlled) or automatic control
            if (this.manuallyControlled) {
                // User has manually controlled bloom - use their preference (allow on mobile if user wants it)
                this.enabled = this.userEnabled;
            } else {
                // No manual control - use automatic distance-based control (disabled on mobile by default for performance)
                this.enabled = !this.mobileDevice;
            }
        }

        // Always set strength if enabled
        if (this.enabled) {
            this.bloomPass.strength = bloomStrength;  // Use calculated strength
        }

    }

    /**
     * Update star mesh visibility based on distance (keeping glare effects visible)
     * @param {THREE.Object3D} starObject - The star object
     * @param {Object} starData - Star data from registration
     * @param {number} distance - Distance from camera to star
     */
    updateStarMeshVisibility(starObject, starData, distance) {
        if (!STAR_VISIBILITY.HIDE_MESH_BY_DEFAULT) {
            return; // Visibility control disabled
        }

        // Calculate opacity based on distance
        let starMeshOpacity = 1.0;

        if (distance > STAR_VISIBILITY.MAX_VISIBILITY_DISTANCE) {
            // Beyond max distance - hide star mesh completely
            starMeshOpacity = 0.0;
        } else if (distance > STAR_VISIBILITY.MAX_VISIBILITY_DISTANCE - STAR_VISIBILITY.FADE_TRANSITION_RANGE) {
            // In fade zone - smooth transition
            const fadeRatio = (STAR_VISIBILITY.MAX_VISIBILITY_DISTANCE - distance) / STAR_VISIBILITY.FADE_TRANSITION_RANGE;
            starMeshOpacity = Math.max(0, Math.min(1, fadeRatio));
        } else if (distance > STAR_VISIBILITY.MIN_VISIBILITY_DISTANCE) {
            // Within visibility range - fully visible
            starMeshOpacity = 1.0;
        } else {
            // Very close - might want to fade for close approach
            starMeshOpacity = 1.0;
        }

        // Apply visibility to star mesh but NOT glare effects, lights, or orbit lines
        starObject.traverse((child) => {
            // Preserve orbit lines (Line2 objects) but don't override user's 'L' key toggle
            if (child.isLine2 || child.type === 'Line2' || child.constructor.name === 'Line2') {
                // Only ensure visibility if the orbit line was intended to be visible
                // Don't override if user has toggled them off with 'L' key
                if (child.visible) {
                    child.visible = true; // Keep it visible (don't let star hiding affect it)
                }
                return; // Skip other processing for orbit lines
            }

            // Always preserve lights
            if (child.isLight) {
                child.visible = true;
                return;
            }

            // Only affect star mesh materials, not glare effects
            if (child.isMesh && child.material) {
                if (child.material === starData.material ||
                    (child.material.type && !child.material.type.includes('Glare'))) {

                    // Set transparency and visibility for star mesh only
                    if (starMeshOpacity < 1.0) {
                        child.material.transparent = true;
                        child.material.opacity = starMeshOpacity;
                        child.visible = starMeshOpacity > 0.01;
                    } else {
                        child.material.opacity = 1.0;
                        child.visible = true;
                    }
                }
            }
        });

        // Also ensure the emittedLight property is always visible
        if (starObject.emittedLight) {
            starObject.emittedLight.visible = true;
        }

        // Ensure glare effects remain visible if configured to do so
        if (STAR_VISIBILITY.KEEP_GLARE_VISIBLE && starObject.sunGlare) {
            starObject.sunGlare.mesh.visible = true;
            if (starObject.sunGlare.mesh.material) {
                starObject.sunGlare.mesh.material.opacity = 1.0;
            }
        }

        // Keep other effects visible (rays, flares, etc.)
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
     * Render the scene with built-in selective bloom
     */
    render() {
        if (this.enabled) {
            // Render with bloom effect using composer
            this.composer.render();
        } else {
            // Render without bloom effect using standard renderer
            this.renderer.render(this.scene, this.camera);
        }
    }


    /**
     * Handle window resize
     * @param {number} width - New window width
     * @param {number} height - New window height
     */
    handleResize(width, height) {
        // Resize composer
        this.composer.setSize(width, height);

        // Update bloom pass resolution with configurable multiplier for quality
        this.bloomPass.setSize(width * BLOOM.RESOLUTION_MULTIPLIER, height * BLOOM.RESOLUTION_MULTIPLIER);
    }

    /**
     * Update bloom configuration
     * @param {Object} config - New bloom configuration
     */
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

    /**
     * Toggle bloom effect on/off
     * @returns {boolean} True if bloom is now enabled, false if disabled
     */
    toggleBloom() {
        this.userEnabled = !this.userEnabled;
        this.manuallyControlled = true;  // User has manually overridden bloom
        return this.userEnabled;  // Return user's preference
    }

    /**
     * Enable bloom effect (allows on mobile if explicitly called)
     */
    enableBloom() {
        this.userEnabled = true;
        this.manuallyControlled = true;
    }

    /**
     * Disable bloom effect
     */
    disableBloom() {
        this.userEnabled = false;
        this.manuallyControlled = true;
    }

    /**
     * Check if bloom is currently enabled (user's preference)
     * @returns {boolean} True if bloom is enabled by user
     */
    isBloomEnabled() {
        return this.userEnabled;  // Return user's preference, not actual state
    }

    /**
     * Dispose of resources
     */
    dispose() {
        // Dispose composer
        this.composer.dispose();
    }
}

export default BloomManager;