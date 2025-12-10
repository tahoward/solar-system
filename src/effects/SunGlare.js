import * as THREE from 'three';
import SunEffect from './SunEffect.js';
import MathUtils from '../utils/MathUtils.js';

/**
 * SunGlare - Creates a billboard glare effect that fades with distance
 */
class SunGlare extends SunEffect {
    constructor(options = {}) {
        // Call parent constructor with common options
        super({
            sunRadius: options.sunRadius || 1.0,
            lowres: options.lowres || false,
            effectName: '✨ SunGlare'
        });

        // Glare-specific configuration
        this.glareSize = options.size || 5.0;  // Size multiplier relative to sun radius
        this.glareOpacity = options.opacity || 1.0;
        this.glareColor = options.color || 0xffaa00;
        this.emissiveIntensity = options.emissiveIntensity || 25.0;
        this.brightnessMult = options.brightnessMult || 15.0; // Additional brightness multiplier for visual effect (increased default)


        // Distance-based scaling parameters
        this.scaleWithDistance = options.scaleWithDistance !== undefined ? options.scaleWithDistance : true;
        this.minScaleDistance = options.minScaleDistance || 0.5;
        this.maxScaleDistance = options.maxScaleDistance || 10.0;
        this.minScale = options.minScale || 0.1;
        this.maxScale = options.maxScale || 1.0;

        // Distance fade parameters (now using scale distances for consistent behavior)
        this.fadeStartDistance = options.fadeStartDistance || this.maxScaleDistance;
        this.fadeEndDistance = options.fadeEndDistance || this.minScaleDistance;

        // Radial center glow scaling parameters
        this.scaleCenterWithDistance = options.scaleCenterWithDistance !== undefined ? options.scaleCenterWithDistance : true;
        this.centerBaseSize = options.centerBaseSize || 0.01;
        this.centerFadeSize = options.centerFadeSize || 0.03;

        // Current fade factor (0-1)
        this.currentFadeFactor = 1.0;

        // Animation parameters for twinkling effect
        this.twinkleEnabled = options.twinkle !== undefined ? options.twinkle : true;
        this.twinkleSpeed = options.twinkleSpeed || 1.5;
        this.twinkleIntensity = options.twinkleIntensity || 0.12; // Subtle twinkle - 12% variation
        this.lastTextureUpdate = 0;
        this.textureUpdateInterval = options.textureUpdateInterval || 150; // Slightly slower updates

        // Create the main glare billboard
        this.mesh = this.createGlareBillboard();


    }

    /**
     * Create procedural star spike parameters based on distance
     * @param {number} distance - Distance from camera to star
     * @returns {Object} Spike configuration parameters
     */
    createSpikeParameters(distance) {
        // Calculate distance-based parameters for optimal spike visibility
        let spikeLength = 0.65;
        let spikeWidth = 0.02;
        let centerRadius = 0.05;

        // Adjust parameters based on distance for better visibility
        if (distance > this.maxScaleDistance) {
            // Very far - make spikes longer and more prominent
            spikeLength = 0.75;
            spikeWidth = 0.025;
            centerRadius = 0.04;
        } else if (distance > this.minScaleDistance) {
            // Medium distance - standard parameters with slight adjustment
            const { ratio } = MathUtils.clampAndRatio(distance, this.minScaleDistance, this.maxScaleDistance);
            spikeLength = MathUtils.lerp(0.55, 0.7, ratio);
            spikeWidth = MathUtils.lerp(0.015, 0.025, ratio);
            centerRadius = MathUtils.lerp(0.06, 0.04, ratio);
        }
        // Close distance uses default values

        return { spikeLength, spikeWidth, centerRadius };
    }

    /**
     * Create the sun glare billboard mesh with shader
     * @returns {THREE.Mesh} The glare billboard mesh
     */
    createGlareBillboard() {
        // Create a plane geometry for the billboard
        const size = this.sunRadius * this.glareSize;
        const geometry = new THREE.PlaneGeometry(size, size);

        // Apply brightness multiplier to color for visual brightness
        const brightenedColor = new THREE.Color(this.glareColor);
        brightenedColor.multiplyScalar(this.brightnessMult);

        // Create shader material for procedural star spikes
        const material = new THREE.ShaderMaterial({
            transparent: true,
            depthWrite: false,
            depthTest: true,
            blending: THREE.AdditiveBlending,
            side: THREE.DoubleSide,
            uniforms: {
                uTime: { value: 0.0 },
                uColor: { value: brightenedColor },
                uEmissiveColor: { value: new THREE.Color(this.glareColor) },
                uOpacity: { value: this.glareOpacity },
                uEmissiveIntensity: { value: this.emissiveIntensity },
                uSpikeLength: { value: 0.65 }, // Length of star spikes
                uSpikeWidth: { value: 0.02 }, // Width of star spikes
                uCenterRadius: { value: 0.05 }, // Central star core radius
                uCenterScale: { value: 1.0 }, // For distance-based scaling
                uTwinkleIntensity: { value: this.twinkleIntensity },
                uTwinkleSpeed: { value: this.twinkleSpeed },
                uDistanceFactor: { value: 1.0 } // Controls spike visibility based on distance
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
                uniform vec3 uColor;
                uniform vec3 uEmissiveColor;
                uniform float uOpacity;
                uniform float uEmissiveIntensity;
                uniform float uSpikeLength;
                uniform float uSpikeWidth;
                uniform float uCenterRadius;
                uniform float uCenterScale;
                uniform float uTwinkleIntensity;
                uniform float uTwinkleSpeed;
                uniform float uDistanceFactor;

                varying vec2 vUv;

                void main() {
                    // Convert UV to centered coordinates (-0.5 to 0.5)
                    vec2 center = vUv - 0.5;
                    float dist = length(center);

                    float alpha = 0.0;

                    // Central bright core - always visible
                    float coreRadius = uCenterRadius * uCenterScale;
                    if (dist <= coreRadius) {
                        alpha = smoothstep(coreRadius * 1.2, 0.0, dist);
                    }

                    // Create 4 classic star spikes (cross pattern)
                    // Horizontal and vertical spikes for classic star appearance
                    vec2 absCenter = abs(center);

                    // Calculate spike parameters with enhanced twinkle animation
                    float twinklePhase = uTime * uTwinkleSpeed;

                    // More complex twinkle with multiple frequencies for more organic feel
                    float horizontalTwinkle = 1.0 + sin(twinklePhase) * uTwinkleIntensity +
                                             sin(twinklePhase * 1.7 + 2.1) * uTwinkleIntensity * 0.5;

                    float verticalTwinkle = 1.0 + sin(twinklePhase + 1.57079632679) * uTwinkleIntensity +
                                           sin(twinklePhase * 1.3 + 3.8) * uTwinkleIntensity * 0.6; // Different frequencies

                    float adjustedSpikeLength = uSpikeLength * uDistanceFactor;
                    float adjustedSpikeWidth = uSpikeWidth * uCenterScale;

                    // Increase pointiness when far away to maintain sharp ends
                    float pointinessFactor = 1.0 + (uDistanceFactor - 1.0) * 0.8; // More pointy when distant

                    // Horizontal spike (left-right) - create triangular shape
                    if (absCenter.y <= adjustedSpikeWidth && absCenter.x <= adjustedSpikeLength) {
                        float spikeProgress = absCenter.x / adjustedSpikeLength;

                        // Create true triangular shape: width decreases linearly with distance from center
                        float triangleWidth = adjustedSpikeWidth * (1.0 - spikeProgress);

                        // Check if we're within the triangle
                        if (absCenter.y <= triangleWidth) {
                            float lengthFade = 1.0 - spikeProgress;
                            float widthFade = 1.0 - (absCenter.y / triangleWidth);

                            // Sharp triangular falloff
                            lengthFade = pow(lengthFade, 2.0 * pointinessFactor); // Very sharp point
                            widthFade = pow(widthFade, 0.3); // Softer width edges for anti-aliasing

                            float horizontalAlpha = lengthFade * widthFade * horizontalTwinkle;
                            alpha = max(alpha, horizontalAlpha);
                        }
                    }

                    // Vertical spike (up-down) - create triangular shape
                    if (absCenter.x <= adjustedSpikeWidth && absCenter.y <= adjustedSpikeLength) {
                        float spikeProgress = absCenter.y / adjustedSpikeLength;

                        // Create true triangular shape: width decreases linearly with distance from center
                        float triangleWidth = adjustedSpikeWidth * (1.0 - spikeProgress);

                        // Check if we're within the triangle
                        if (absCenter.x <= triangleWidth) {
                            float lengthFade = 1.0 - spikeProgress;
                            float widthFade = 1.0 - (absCenter.x / triangleWidth);

                            // Sharp triangular falloff
                            lengthFade = pow(lengthFade, 2.0 * pointinessFactor); // Very sharp point
                            widthFade = pow(widthFade, 0.3); // Softer width edges for anti-aliasing

                            float verticalAlpha = lengthFade * widthFade * verticalTwinkle;
                            alpha = max(alpha, verticalAlpha);
                        }
                    }

                    // Enhance brightness at spike intersections for better visibility
                    if (absCenter.x <= adjustedSpikeWidth && absCenter.y <= adjustedSpikeWidth) {
                        alpha = max(alpha, 0.8);
                    }

                    alpha = clamp(alpha, 0.0, 1.0);

                    // Apply emissive color and intensity
                    vec3 finalColor = uEmissiveColor * uEmissiveIntensity;

                    gl_FragColor = vec4(finalColor, alpha * uOpacity);
                }
            `
        });

        // Store material reference
        this.material = material;

        // Create mesh
        const mesh = new THREE.Mesh(geometry, material);
        mesh.frustumCulled = false;
        mesh.renderOrder = 9999; // Very high render order to ensure it renders on top of everything

        // Position at origin - will be dynamically positioned during update
        mesh.position.set(0, 0, 0);

        return mesh;
    }



    /**
     * Update the glare based on camera distance and make it face the camera
     * @param {number} deltaTime - Time since last update
     * @param {THREE.Camera} camera - Camera for billboard orientation and distance calculation
     * @param {THREE.Vector3} sunPosition - World position of the sun
     */
    update(deltaTime, camera, sunPosition = new THREE.Vector3(0, 0, 0)) {
        this.time += deltaTime;

        if (!this.mesh || !this.mesh.material) return;

        // Calculate distance from camera to sun
        const distance = camera.position.distanceTo(sunPosition);

        // Calculate fade factor based on distance
        this.updateFadeDistance(distance);

        // Make billboard face the camera
        this.updateBillboardOrientation(camera, sunPosition);


        // Calculate center scale based on distance for shader scaling
        let centerScale = 1.0;

        if (this.scaleCenterWithDistance && this.scaleWithDistance) {
            const { ratio: distanceRatio } = MathUtils.clampAndRatio(distance, this.minScaleDistance, this.maxScaleDistance);
            centerScale = MathUtils.lerp(this.minScale, this.maxScale, distanceRatio);
        }

        // Calculate distance-based spike parameters
        const spikeParams = this.createSpikeParameters(distance);

        // Calculate distance-based spike visibility factor and emissive boost
        let distanceFactor = 1.0;
        let emissiveBoost = 1.0;

        if (distance > this.minScaleDistance) {
            // Increase spike prominence when further away for better visibility
            const { ratio: distanceRatio } = MathUtils.clampAndRatio(distance, this.minScaleDistance, this.maxScaleDistance * 2);
            distanceFactor = MathUtils.lerp(1.0, 1.8, distanceRatio); // Spikes become more prominent with distance

            // Boost emissive intensity at extreme distances for light bleed effect
            if (distance > this.maxScaleDistance) {
                const extremeDistanceRatio = Math.min((distance - this.maxScaleDistance) / this.maxScaleDistance, 2.0);
                emissiveBoost = 1.0 + extremeDistanceRatio * 1.5; // Up to 2.5x emissive at extreme distances
            }
        }

        // Update shader uniforms with distance-adaptive parameters
        if (this.material.uniforms) {
            this.material.uniforms.uTime.value = this.time;
            this.material.uniforms.uCenterScale.value = centerScale;
            this.material.uniforms.uOpacity.value = this.glareOpacity * this.currentFadeFactor;
            this.material.uniforms.uEmissiveIntensity.value = this.emissiveIntensity * this.currentFadeFactor * emissiveBoost;
            this.material.uniforms.uDistanceFactor.value = distanceFactor;
            this.material.uniforms.uTwinkleIntensity.value = this.twinkleIntensity;
            this.material.uniforms.uTwinkleSpeed.value = this.twinkleSpeed;

            // Update spike parameters based on distance
            this.material.uniforms.uSpikeLength.value = spikeParams.spikeLength;
            this.material.uniforms.uSpikeWidth.value = spikeParams.spikeWidth;
            this.material.uniforms.uCenterRadius.value = spikeParams.centerRadius;
        }

        // Material properties are now controlled via shader uniforms

        // Calculate scaling based on distance if enabled
        let scaleFactor = 1.0;

        if (this.scaleWithDistance) {
            // Linear scaling: direct proportional relationship
            const { ratio: distanceRatio } = MathUtils.clampAndRatio(distance, this.minScaleDistance, this.maxScaleDistance);

            // Simple linear interpolation between min and max scale
            scaleFactor = MathUtils.lerp(this.minScale, this.maxScale, distanceRatio);
        }

        // Apply scaling to the mesh
        this.mesh.scale.setScalar(scaleFactor);
    }

    /**
     * Update fade factor based on camera distance to sun
     * @param {number} _distance - Distance from camera to sun (unused - no fading)
     */
    updateFadeDistance(_distance) {
        // No fade on zoom - maintain full brightness at all distances
        this.currentFadeFactor = 1.0;
    }

    /**
     * Update billboard orientation to face the camera
     * @param {THREE.Camera} camera - Camera to face towards
     * @param {THREE.Vector3} sunPosition - World position of the sun
     */
    updateBillboardOrientation(_camera, _sunPosition) {
        // Position and orientation handled by AnimationManager
        // This method kept for compatibility but functionality moved
    }


    /**
     * Set glare size
     * @param {number} size - Size multiplier relative to sun radius
     */
    setGlareSize(size) {
        this.glareSize = size;
        if (this.mesh && this.mesh.geometry) {
            const newSize = this.sunRadius * size;
            this.mesh.geometry.dispose();
            this.mesh.geometry = new THREE.PlaneGeometry(newSize, newSize);
        }
    }

    /**
     * Set glare opacity
     * @param {number} opacity - Base opacity (0-1)
     */
    setGlareOpacity(opacity) {
        this.glareOpacity = opacity;
        if (this.material && this.material.uniforms) {
            this.material.uniforms.uOpacity.value = opacity * this.currentFadeFactor;
        }
    }

    /**
     * Set glare color
     * @param {number} color - Hex color value
     */
    setGlareColor(color) {
        this.glareColor = color;
        if (this.material && this.material.uniforms) {
            const newColor = new THREE.Color(color);
            this.material.uniforms.uEmissiveColor.value = newColor;
            this.material.uniforms.uColor.value = newColor.clone().multiplyScalar(this.brightnessMult);
        }
    }

    /**
     * Set emissive intensity for bloom control
     * @param {number} intensity - The emissive intensity (>1.0 for bloom effect)
     */
    setEmissiveIntensity(intensity) {
        this.emissiveIntensity = intensity;
        if (this.material && this.material.uniforms) {
            this.material.uniforms.uEmissiveIntensity.value = intensity * this.currentFadeFactor;
        }
    }

    /**
     * Get current effective emissive intensity
     * @returns {number} Current emissive intensity
     */
    getEmissiveIntensity() {
        return this.emissiveIntensity;
    }


    /**
     * Set twinkle effect enabled/disabled
     * @param {boolean} enabled - Whether to enable twinkle effect
     */
    setTwinkleEnabled(enabled) {
        this.twinkleEnabled = enabled;
        // Force texture regeneration on next update
        this.lastTextureUpdate = 0;
    }

    /**
     * Set twinkle speed
     * @param {number} speed - Speed multiplier for twinkle animation (higher = faster)
     */
    setTwinkleSpeed(speed) {
        this.twinkleSpeed = speed;
        // Force texture regeneration on next update
        this.lastTextureUpdate = 0;
    }

    /**
     * Set twinkle intensity
     * @param {number} intensity - Intensity of length variation (0-1, where 0.3 = 30% variation)
     */
    setTwinkleIntensity(intensity) {
        this.twinkleIntensity = intensity;
        if (this.material && this.material.uniforms) {
            this.material.uniforms.uTwinkleIntensity.value = intensity;
        }
    }

    /**
     * Set star spike parameters
     * @param {Object} params - Spike parameters
     * @param {number} params.length - Length of spikes (0-1)
     * @param {number} params.width - Width of spikes (0-1)
     * @param {number} params.centerRadius - Radius of center core (0-1)
     */
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

    /**
     * Get current spike parameters
     * @returns {Object} Current spike configuration
     */
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

    /**
     * Get current twinkle settings
     * @returns {Object} Current twinkle configuration
     */
    getTwinkleSettings() {
        return {
            enabled: this.twinkleEnabled,
            speed: this.twinkleSpeed,
            intensity: this.twinkleIntensity,
            updateInterval: this.textureUpdateInterval
        };
    }

    /**
     * Set fade distances
     * @param {number} startDistance - Distance where fade begins
     * @param {number} endDistance - Distance where glare completely disappears
     */
    setFadeDistances(startDistance, endDistance) {
        this.fadeStartDistance = startDistance;
        this.fadeEndDistance = endDistance;
    }

    // Override inherited methods to handle bloom layers

    /**
     * Get the main Three.js mesh object (overrides parent)
     * @returns {THREE.Mesh} The main glare mesh
     */
    getMesh() {
        return this.mesh;
    }

    /**
     * Get all meshes (just the main glare mesh now)
     * @returns {THREE.Mesh[]} Array of all meshes
     */
    getAllMeshes() {
        return [this.mesh].filter(mesh => mesh !== null);
    }

    /**
     * Add the effect to a Three.js scene or group (overrides parent)
     * @param {THREE.Scene|THREE.Group} parent - The parent to add to
     */
    addToScene(parent) {
        if (this.mesh) {
            parent.add(this.mesh);
        }
    }

    /**
     * Remove the effect from a Three.js scene or group (overrides parent)
     * @param {THREE.Scene|THREE.Group} parent - The parent to remove from
     */
    removeFromScene(parent) {
        if (this.mesh) {
            parent.remove(this.mesh);
        }
    }

    /**
     * Dispose of resources (overrides parent)
     */
    dispose() {
        // Dispose main mesh
        if (this.mesh) {
            if (this.mesh.geometry) this.mesh.geometry.dispose();
            if (this.material) {
                if (this.material.map) this.material.map.dispose();
                this.material.dispose();
            }
        }
    }

    // Other inherited methods from SunEffect:
    // - setBaseColor(color)
    // - setVisibility(visibility, direction, lightView)
}

export default SunGlare;