import * as THREE from 'three';

/**
 * Paints stand-in surface textures on a canvas.
 *
 * Used for bodies that have no image supplied — the smaller moons, and any body
 * added at runtime. A flat sphere in a single colour reads as a featureless ball
 * with no sense of rotation, so a crude pattern is drawn instead: it gives the
 * surface something to turn, at no download cost.
 *
 * Static only; there is no state worth keeping.
 */
export class TextureFactory {
    /**
     * Draws a placeholder surface texture for a body.
     *
     * Mipmaps are skipped deliberately — these textures are only used on bodies small
     * enough on screen that the extra memory would buy nothing.
     *
     * The canvas is kept on `userData` so it can be released along with the texture.
     *
     * @param {Object} bodyData - Body definition; its `color` sets the base tone and
     *   its `name` picks the pattern.
     * @returns {THREE.CanvasTexture} A repeat-wrapped texture ready to apply.
     */
    static createPlanetTexture(bodyData) {
        const canvas = document.createElement('canvas');
        canvas.width = 512;
        canvas.height = 256;
        const context = canvas.getContext('2d');

        const baseColor = new THREE.Color(bodyData.color);
        context.fillStyle = `rgb(${Math.floor(baseColor.r * 255)}, ${Math.floor(baseColor.g * 255)}, ${Math.floor(baseColor.b * 255)})`;
        context.fillRect(0, 0, canvas.width, canvas.height);

        this.addPlanetSurfaceFeatures(context, canvas, bodyData.name, baseColor);

        const texture = new THREE.CanvasTexture(canvas);
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        texture.generateMipmaps = false;
        texture.minFilter = THREE.LinearFilter;

        texture.userData.canvas = canvas;

        return texture;
    }

    /**
     * Draws a recognisable pattern over the base colour.
     *
     * Keyed by name rather than by any property of the body, since the aim is only to
     * be recognisable: horizontal bands for the gas giants, blue and green blocks for
     * Earth, scattered craters for Mars. Anything else gets vertical stripes, which are
     * enough to make rotation visible.
     *
     * @param {CanvasRenderingContext2D} context - Canvas context to draw into.
     * @param {HTMLCanvasElement} canvas - Canvas being drawn on, for its dimensions.
     * @param {string} planetName - Name of the body, selecting the pattern.
     * @param {THREE.Color} baseColor - Colour the pattern is shaded from.
     * @returns {void}
     */
    static addPlanetSurfaceFeatures(context, canvas, planetName, baseColor) {
        const width = canvas.width;
        const height = canvas.height;

        switch (planetName) {
            case 'Jupiter':
                for (let i = 0; i < 10; i++) {
                    const y = (i / 9) * height;
                    const bandHeight = height / 10;
                    const brightness = i % 2 === 0 ? 1.3 : 0.6;
                    context.fillStyle = `rgb(${Math.min(255, Math.floor(baseColor.r * 255 * brightness))}, ${Math.min(255, Math.floor(baseColor.g * 255 * brightness))}, ${Math.floor(baseColor.b * 255 * brightness)})`;
                    context.fillRect(0, y, width, bandHeight);
                }
                break;

            case 'Saturn':
                for (let i = 0; i < 8; i++) {
                    const y = (i / 7) * height;
                    const bandHeight = height / 8;
                    const brightness = i % 2 === 0 ? 1.2 : 0.7;
                    context.fillStyle = `rgb(${Math.min(255, Math.floor(baseColor.r * 255 * brightness))}, ${Math.min(255, Math.floor(baseColor.g * 255 * brightness))}, ${Math.floor(baseColor.b * 255 * brightness)})`;
                    context.fillRect(0, y, width, bandHeight);
                }
                break;

            case 'Earth':
                context.fillStyle = '#1e3a8a';
                context.fillRect(0, 0, width, height);
                context.fillStyle = '#16a34a';
                for (let i = 0; i < 8; i++) {
                    const x = (i * width / 4) % width;
                    const y = height * 0.2 + (i % 3) * height * 0.25;
                    const w = width / 6 + Math.random() * width / 4;
                    const h = height / 4 + Math.random() * height / 6;
                    context.fillRect(x, y, w, h);
                }
                break;

            case 'Mars':
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
                for (let i = 0; i < 16; i++) {
                    const x = (i / 15) * width;
                    const stripeWidth = width / 16;
                    const brightness = i % 2 === 0 ? 1.4 : 0.5;
                    context.fillStyle = `rgb(${Math.min(255, Math.floor(baseColor.r * 255 * brightness))}, ${Math.min(255, Math.floor(baseColor.g * 255 * brightness))}, ${Math.min(255, Math.floor(baseColor.b * 255 * brightness))})`;
                    context.fillRect(x, 0, stripeWidth, height);
                }
                break;
        }
    }
}

export default TextureFactory;
