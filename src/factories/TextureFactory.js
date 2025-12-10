import * as THREE from 'three';

/**
 * Factory class responsible for creating procedural textures for celestial bodies
 */
export class TextureFactory {
    /**
     * Create procedural texture for a planet
     * @param {Object} bodyData - The celestial body data
     * @returns {THREE.CanvasTexture} The created texture
     */
    static createPlanetTexture(bodyData) {
        // Create a high-resolution procedural texture to show rotation
        const canvas = document.createElement('canvas');
        canvas.width = 512;  // Higher resolution
        canvas.height = 256; // Higher resolution
        const context = canvas.getContext('2d');

        // Base color
        const baseColor = new THREE.Color(bodyData.color);
        context.fillStyle = `rgb(${Math.floor(baseColor.r * 255)}, ${Math.floor(baseColor.g * 255)}, ${Math.floor(baseColor.b * 255)})`;
        context.fillRect(0, 0, canvas.width, canvas.height);

        // Add surface features (stripes and spots) to show rotation
        this.addPlanetSurfaceFeatures(context, canvas, bodyData.name, baseColor);

        // Create texture from canvas
        const texture = new THREE.CanvasTexture(canvas);
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        texture.generateMipmaps = false; // Better for procedural textures
        texture.minFilter = THREE.LinearFilter;

        // Store canvas reference for cleanup
        texture.userData.canvas = canvas;

        return texture;
    }

    /**
     * Add surface features to planet texture for visible rotation
     * @param {CanvasRenderingContext2D} context - Canvas context
     * @param {HTMLCanvasElement} canvas - Canvas element
     * @param {string} planetName - Name of the planet
     * @param {THREE.Color} baseColor - Base color of the planet
     */
    static addPlanetSurfaceFeatures(context, canvas, planetName, baseColor) {
        const width = canvas.width;
        const height = canvas.height;

        // Create different high-contrast patterns for different planets
        switch (planetName) {
            case 'Jupiter':
                // Jupiter-like bands with high contrast
                for (let i = 0; i < 10; i++) {
                    const y = (i / 9) * height;
                    const bandHeight = height / 10;
                    const brightness = i % 2 === 0 ? 1.3 : 0.6; // High contrast alternating bands
                    context.fillStyle = `rgb(${Math.min(255, Math.floor(baseColor.r * 255 * brightness))}, ${Math.min(255, Math.floor(baseColor.g * 255 * brightness))}, ${Math.floor(baseColor.b * 255 * brightness)})`;
                    context.fillRect(0, y, width, bandHeight);
                }
                break;

            case 'Saturn':
                // Saturn-like pale bands with more contrast
                for (let i = 0; i < 8; i++) {
                    const y = (i / 7) * height;
                    const bandHeight = height / 8;
                    const brightness = i % 2 === 0 ? 1.2 : 0.7;
                    context.fillStyle = `rgb(${Math.min(255, Math.floor(baseColor.r * 255 * brightness))}, ${Math.min(255, Math.floor(baseColor.g * 255 * brightness))}, ${Math.floor(baseColor.b * 255 * brightness)})`;
                    context.fillRect(0, y, width, bandHeight);
                }
                break;

            case 'Earth':
                // Earth with very visible continents
                context.fillStyle = '#1e3a8a'; // Deep blue oceans
                context.fillRect(0, 0, width, height);
                context.fillStyle = '#16a34a'; // Bright green land
                // Larger, more visible continents
                for (let i = 0; i < 8; i++) {
                    const x = (i * width / 4) % width;
                    const y = height * 0.2 + (i % 3) * height * 0.25;
                    const w = width / 6 + Math.random() * width / 4;
                    const h = height / 4 + Math.random() * height / 6;
                    context.fillRect(x, y, w, h);
                }
                break;

            case 'Mars':
                // Mars with prominent surface features
                for (let i = 0; i < 20; i++) {
                    const x = Math.random() * width;
                    const y = Math.random() * height;
                    const radius = 10 + Math.random() * 25;
                    const brightness = 0.5 + Math.random() * 0.8;
                    context.fillStyle = `rgb(${Math.floor(139 * brightness)}, ${Math.floor(69 * brightness)}, ${Math.floor(19 * brightness)})`;
                    context.beginPath();
                    context.arc(x, y, radius, 0, 2 * Math.PI);
                    context.fill();
                }
                break;

            default:
                // High-contrast vertical stripes for other planets
                for (let i = 0; i < 16; i++) {
                    const x = (i / 15) * width;
                    const stripeWidth = width / 16;
                    const brightness = i % 2 === 0 ? 1.4 : 0.5; // Very high contrast
                    context.fillStyle = `rgb(${Math.min(255, Math.floor(baseColor.r * 255 * brightness))}, ${Math.min(255, Math.floor(baseColor.g * 255 * brightness))}, ${Math.min(255, Math.floor(baseColor.b * 255 * brightness))})`;
                    context.fillRect(x, 0, stripeWidth, height);
                }
                break;
        }
    }
}

export default TextureFactory;
