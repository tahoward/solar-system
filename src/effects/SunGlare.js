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
        this.glareOpacity = options.opacity || 0.8;
        this.glareColor = options.color || 0xffaa00;
        this.emissiveIntensity = options.emissiveIntensity || 2.0;
        this.brightnessMult = options.brightnessMult || 1.0; // Additional brightness multiplier for visual effect


        // Distance fade parameters
        this.fadeStartDistance = options.fadeStartDistance || 10.0;
        this.fadeEndDistance = options.fadeEndDistance || 0.6;

        // Distance-based scaling parameters
        this.scaleWithDistance = options.scaleWithDistance !== undefined ? options.scaleWithDistance : true;
        this.minScaleDistance = options.minScaleDistance || 0.5;
        this.maxScaleDistance = options.maxScaleDistance || 10.0;
        this.minScale = options.minScale || 0.1;
        this.maxScale = options.maxScale || 1.0;

        // Radial center glow scaling parameters
        this.scaleCenterWithDistance = options.scaleCenterWithDistance !== undefined ? options.scaleCenterWithDistance : true;
        this.centerBaseSize = options.centerBaseSize || 0.01;
        this.centerFadeSize = options.centerFadeSize || 0.03;

        // Current fade factor (0-1)
        this.currentFadeFactor = 1.0;

        // Animation parameters for twinkling effect
        this.twinkleEnabled = options.twinkle !== undefined ? options.twinkle : true;
        this.twinkleSpeed = options.twinkleSpeed || 1.5;
        this.twinkleIntensity = options.twinkleIntensity || 0.08; // Much more subtle - 8% variation
        this.lastTextureUpdate = 0;
        this.textureUpdateInterval = options.textureUpdateInterval || 150; // Slightly slower updates

        // Create the main glare billboard
        this.mesh = this.createGlareBillboard();


    }

    /**
     * Create a procedural glare texture
     * @param {number} centerScale - Scale factor for the radial center glow (default 1.0)
     * @param {number} time - Current time for twinkle animation (default 0)
     * @returns {THREE.CanvasTexture} The glare texture
     */
    createGlareTexture(centerScale = 1.0, time = 0) {
        const size = 512; // Texture resolution
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const context = canvas.getContext('2d');
        const centerX = size / 2;
        const centerY = size / 2;

        // Clear canvas to transparent
        context.clearRect(0, 0, size, size);


        // Create radial gradient from center for base glow
        const gradient = context.createRadialGradient(
            centerX, centerY, 0,           // Inner circle (center)
            centerX, centerY, size / 2     // Outer circle (edge)
        );

        // Create scalable center glow based on distance using configurable parameters
        const baseCenter = this.centerBaseSize * centerScale;  // Scale the center size
        const fadeOut = this.centerFadeSize * centerScale;     // Scale the fade-out point

        gradient.addColorStop(0, 'rgba(255, 255, 255, 1.0)');    // Bright center point
        gradient.addColorStop(Math.min(baseCenter, 0.99), 'rgba(255, 255, 255, 1.0)'); // Same opacity as spikes
        gradient.addColorStop(Math.min(fadeOut, 0.99), 'rgba(255, 255, 255, 0.0)'); // Transparent - spikes dominate
        gradient.addColorStop(1.0, 'rgba(255, 255, 255, 0.0)');  // Transparent edge

        // Fill the canvas with the base gradient using additive blending
        context.globalCompositeOperation = 'screen'; // Additive-like blending for center glow
        context.fillStyle = gradient;
        context.fillRect(0, 0, size, size);

        // Add star spikes using additive blending
        context.globalCompositeOperation = 'screen'; // Additive-like blending

        // Create 4 main spikes (cross pattern) with twinkling animation
        const baseSpikeLength = size * 0.48;
        const spikeFadeWidth = 12; // Wider for more visibility

        // Draw horizontal and vertical spikes with time-based length variations
        const spikes = [
            { angle: 0, length: baseSpikeLength, spikeId: 0 },      // Right
            { angle: Math.PI / 2, length: baseSpikeLength, spikeId: 1 },  // Down
            { angle: Math.PI, length: baseSpikeLength, spikeId: 2 },      // Left
            { angle: 3 * Math.PI / 2, length: baseSpikeLength, spikeId: 3 } // Up
        ];

        spikes.forEach(spike => {
            // Calculate twinkle length variation if enabled
            let actualLength = spike.length;
            if (this.twinkleEnabled && time > 0) {
                // Each spike has its own frequency offset to make them twinkle independently
                const spikeFrequency = this.twinkleSpeed + (spike.spikeId * 0.1);
                const twinklePhase = time * spikeFrequency + (spike.spikeId * Math.PI * 0.25);
                const twinkleVariation = Math.sin(twinklePhase) * this.twinkleIntensity;
                actualLength = spike.length * (1.0 + twinkleVariation);
            }

            // Create gradient for spike
            const dx = Math.cos(spike.angle) * actualLength;
            const dy = Math.sin(spike.angle) * actualLength;

            const spikeGradient = context.createLinearGradient(
                centerX, centerY,
                centerX + dx, centerY + dy
            );

            spikeGradient.addColorStop(0, 'rgba(255, 255, 255, 1.0)');    // Maximum brightness at center
            spikeGradient.addColorStop(0.05, 'rgba(255, 255, 255, 0.95)'); // Still very bright
            spikeGradient.addColorStop(0.3, 'rgba(255, 255, 255, 0.6)');  // More gradual fade
            spikeGradient.addColorStop(0.6, 'rgba(255, 255, 255, 0.2)');  // Dim but visible
            spikeGradient.addColorStop(1.0, 'rgba(255, 255, 255, 0.0)');  // Transparent end

            // Draw the spike
            context.fillStyle = spikeGradient;
            context.beginPath();

            // Create tapered triangular spike that comes to a sharp point
            const perpX = -Math.sin(spike.angle) * spikeFadeWidth;
            const perpY = Math.cos(spike.angle) * spikeFadeWidth;

            context.moveTo(centerX + perpX * 0.3, centerY + perpY * 0.3);  // Start wide at center
            context.lineTo(centerX + dx, centerY + dy);                    // Sharp point at end
            context.lineTo(centerX - perpX * 0.3, centerY - perpY * 0.3); // Other side at center
            context.closePath();
            context.fill();
        });

        // Add smaller diagonal spikes with twinkling animation
        const diagonalSpikeLength = baseSpikeLength * 0.6;
        const smallSpikes = [
            { angle: Math.PI / 4, length: diagonalSpikeLength, spikeId: 4 },      // Diagonal
            { angle: 3 * Math.PI / 4, length: diagonalSpikeLength, spikeId: 5 },
            { angle: 5 * Math.PI / 4, length: diagonalSpikeLength, spikeId: 6 },
            { angle: 7 * Math.PI / 4, length: diagonalSpikeLength, spikeId: 7 }
        ];

        smallSpikes.forEach(spike => {
            // Calculate twinkle length variation if enabled
            let actualLength = spike.length;
            if (this.twinkleEnabled && time > 0) {
                // Each spike has its own frequency offset to make them twinkle independently
                const spikeFrequency = this.twinkleSpeed + (spike.spikeId * 0.08);
                const twinklePhase = time * spikeFrequency + (spike.spikeId * Math.PI * 0.2);
                const twinkleVariation = Math.sin(twinklePhase) * this.twinkleIntensity;
                actualLength = spike.length * (1.0 + twinkleVariation);
            }

            const dx = Math.cos(spike.angle) * actualLength;
            const dy = Math.sin(spike.angle) * actualLength;

            const spikeGradient = context.createLinearGradient(
                centerX, centerY,
                centerX + dx, centerY + dy
            );

            spikeGradient.addColorStop(0, 'rgba(255, 255, 255, 0.8)');   // Brighter diagonal spikes
            spikeGradient.addColorStop(0.1, 'rgba(255, 255, 255, 0.6)'); // Still bright
            spikeGradient.addColorStop(0.5, 'rgba(255, 255, 255, 0.25)'); // More visible
            spikeGradient.addColorStop(1.0, 'rgba(255, 255, 255, 0.0)');  // Transparent end

            context.fillStyle = spikeGradient;
            context.beginPath();

            const perpX = -Math.sin(spike.angle) * (spikeFadeWidth * 0.5);
            const perpY = Math.cos(spike.angle) * (spikeFadeWidth * 0.5);

            // Create tapered triangular spike for diagonal spikes too
            context.moveTo(centerX + perpX * 0.3, centerY + perpY * 0.3);  // Start wide at center
            context.lineTo(centerX + dx, centerY + dy);                    // Sharp point at end
            context.lineTo(centerX - perpX * 0.3, centerY - perpY * 0.3); // Other side at center
            context.closePath();
            context.fill();
        });

        // Add intermediate spikes (16 total spikes now) - these are smaller and more subtle
        const intermediateSpikeLength = baseSpikeLength * 0.4;
        const intermediateSpikes = [
            { angle: Math.PI / 8, length: intermediateSpikeLength, spikeId: 8 },        // 22.5°
            { angle: 3 * Math.PI / 8, length: intermediateSpikeLength, spikeId: 9 },    // 67.5°
            { angle: 5 * Math.PI / 8, length: intermediateSpikeLength, spikeId: 10 },    // 112.5°
            { angle: 7 * Math.PI / 8, length: intermediateSpikeLength, spikeId: 11 },    // 157.5°
            { angle: 9 * Math.PI / 8, length: intermediateSpikeLength, spikeId: 12 },    // 202.5°
            { angle: 11 * Math.PI / 8, length: intermediateSpikeLength, spikeId: 13 },   // 247.5°
            { angle: 13 * Math.PI / 8, length: intermediateSpikeLength, spikeId: 14 },   // 292.5°
            { angle: 15 * Math.PI / 8, length: intermediateSpikeLength, spikeId: 15 }    // 337.5°
        ];

        intermediateSpikes.forEach(spike => {
            // Calculate twinkle length variation if enabled
            let actualLength = spike.length;
            if (this.twinkleEnabled && time > 0) {
                // Each spike has its own frequency offset to make them twinkle independently
                const spikeFrequency = this.twinkleSpeed + (spike.spikeId * 0.05);
                const twinklePhase = time * spikeFrequency + (spike.spikeId * Math.PI * 0.15);
                const twinkleVariation = Math.sin(twinklePhase) * this.twinkleIntensity * 0.4; // Much more subtle for smaller spikes
                actualLength = spike.length * (1.0 + twinkleVariation);
            }

            const dx = Math.cos(spike.angle) * actualLength;
            const dy = Math.sin(spike.angle) * actualLength;

            const spikeGradient = context.createLinearGradient(
                centerX, centerY,
                centerX + dx, centerY + dy
            );

            spikeGradient.addColorStop(0, 'rgba(255, 255, 255, 0.6)');   // Dimmer intermediate spikes
            spikeGradient.addColorStop(0.1, 'rgba(255, 255, 255, 0.4)'); // Moderate brightness
            spikeGradient.addColorStop(0.5, 'rgba(255, 255, 255, 0.15)'); // Subtle visibility
            spikeGradient.addColorStop(1.0, 'rgba(255, 255, 255, 0.0)');  // Transparent end

            context.fillStyle = spikeGradient;
            context.beginPath();

            const perpX = -Math.sin(spike.angle) * (spikeFadeWidth * 0.3);  // Even thinner
            const perpY = Math.cos(spike.angle) * (spikeFadeWidth * 0.3);

            // Create tapered triangular spike for intermediate spikes
            context.moveTo(centerX + perpX * 0.2, centerY + perpY * 0.2);  // Start narrower at center
            context.lineTo(centerX + dx, centerY + dy);                    // Sharp point at end
            context.lineTo(centerX - perpX * 0.2, centerY - perpY * 0.2); // Other side at center
            context.closePath();
            context.fill();
        });

        // Create texture from canvas
        const texture = new THREE.CanvasTexture(canvas);
        texture.needsUpdate = true;

        return texture;
    }

    /**
     * Create the sun glare billboard mesh
     * @returns {THREE.Mesh} The glare billboard mesh
     */
    createGlareBillboard() {
        // Create a plane geometry for the billboard
        const size = this.sunRadius * this.glareSize;
        const geometry = new THREE.PlaneGeometry(size, size);

        // Create the glare texture
        const glareTexture = this.createGlareTexture();

        // Apply brightness multiplier to color for visual brightness
        const brightenedColor = new THREE.Color(this.glareColor);
        brightenedColor.multiplyScalar(this.brightnessMult);

        // Create material with glare texture/effect
        const material = new THREE.MeshStandardMaterial({
            map: glareTexture,
            color: brightenedColor,
            transparent: true,
            opacity: this.glareOpacity,
            depthWrite: false,
            depthTest: true,
            blending: THREE.NormalBlending,
            side: THREE.DoubleSide,
            // Add emissive properties for bloom effect
            emissive: new THREE.Color(this.glareColor),
            emissiveIntensity: this.emissiveIntensity,
            toneMapped: false,
            // Disable lighting calculations since this is a billboard
            roughness: 1.0,
            metalness: 0.0
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


        // Calculate center scale based on distance for radial glow scaling
        let centerScale = 1.0;
        let shouldRegenerateTexture = false;

        if (this.scaleCenterWithDistance && this.scaleWithDistance) {
            const { ratio: distanceRatio } = MathUtils.clampAndRatio(distance, this.minScaleDistance, this.maxScaleDistance);
            centerScale = MathUtils.lerp(this.minScale, this.maxScale, distanceRatio);
            shouldRegenerateTexture = true;
        }

        // Update texture for twinkling animation if enabled
        if (this.twinkleEnabled && this.currentFadeFactor > 0.01) {
            const currentTime = Date.now();
            if (currentTime - this.lastTextureUpdate > this.textureUpdateInterval) {
                shouldRegenerateTexture = true;
                this.lastTextureUpdate = currentTime;
            }
        }

        // Regenerate texture if needed
        if (shouldRegenerateTexture && this.currentFadeFactor > 0.01) {
            const currentTime = this.time; // Use animation time for consistent twinkling
            const newTexture = this.createGlareTexture(centerScale, currentTime);
            if (this.material.map) this.material.map.dispose(); // Clean up old texture
            this.material.map = newTexture;
            this.material.needsUpdate = true;
        }

        // Update material opacity based on fade factor
        this.material.opacity = this.glareOpacity * this.currentFadeFactor;
        this.material.emissiveIntensity = this.emissiveIntensity * this.currentFadeFactor;

        // Calculate scaling based on distance if enabled
        let scaleFactor = this.currentFadeFactor;

        if (this.scaleWithDistance) {
            // Calculate distance-based scale (closer = smaller, farther = larger)
            const { ratio: distanceRatio } = MathUtils.clampAndRatio(distance, this.minScaleDistance, this.maxScaleDistance);
            const distanceScale = MathUtils.lerp(this.minScale, this.maxScale, distanceRatio);

            // Combine fade factor with distance scaling
            scaleFactor = this.currentFadeFactor * distanceScale;
        }

        this.mesh.scale.setScalar(scaleFactor);
    }

    /**
     * Update fade factor based on camera distance to sun
     * @param {number} distance - Distance from camera to sun
     */
    updateFadeDistance(distance) {
        if (distance >= this.fadeStartDistance) {
            // Full size/opacity when far away (10+ units)
            this.currentFadeFactor = 1.0;
        } else if (distance <= this.fadeEndDistance) {
            // Completely faded when very close (0.6 or less units)
            this.currentFadeFactor = 0.0;
        } else {
            // Linear fade between start and end distances
            this.currentFadeFactor = MathUtils.inverseLerp(this.fadeEndDistance, this.fadeStartDistance, distance);
        }
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
        if (this.material) {
            this.material.opacity = opacity * this.currentFadeFactor;
        }
    }

    /**
     * Set glare color
     * @param {number} color - Hex color value
     */
    setGlareColor(color) {
        this.glareColor = color;
        if (this.material) {
            this.material.color.setHex(color);
            this.material.emissive.setHex(color);
        }
    }

    /**
     * Set emissive intensity for bloom control
     * @param {number} intensity - The emissive intensity (>1.0 for bloom effect)
     */
    setEmissiveIntensity(intensity) {
        this.emissiveIntensity = intensity;
        if (this.material) {
            this.material.emissiveIntensity = intensity * this.currentFadeFactor;
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
        // Force texture regeneration on next update
        this.lastTextureUpdate = 0;
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