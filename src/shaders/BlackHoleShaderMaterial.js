import * as THREE from 'three';

/**
 * Vertex shader for the event horizon.
 *
 * Nothing is interpolated to the fragment stage, because nothing about the horizon varies
 * across it. Only the position is transformed.
 *
 * @type {string}
 */
const vertexShader = `
void main() {
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

/**
 * Fragment shader for the event horizon: black, everywhere, always.
 *
 * This is the one surface in the project with no shading at all, and it is correct rather
 * than lazy. Nothing leaves the horizon — no reflection, no emission, no scattered light —
 * so any lighting term, limb glow or Fresnel rim would be inventing light that physically
 * cannot be there. What makes the hole read as a hole is the contrast against the accretion
 * disc and the lensed sky around it, and both of those are drawn elsewhere.
 *
 * It is also drawn far too small, and deliberately. The silhouette a black hole actually shows
 * is not its horizon but its shadow, at `3√3 / 2` horizon radii, because the hole bends the
 * light of its own edge outwards — and that is drawn by {@link AccretionDisk}, which finds it by
 * tracing photon paths rather than by being told where it is. This sphere is two and a half times
 * smaller than that and so lies entirely inside it, contributing nothing to the picture. What it
 * is still for is everything that needs the hole to be an object: the distance thresholds that
 * swap it for a pinpoint, the click target, the focus.
 *
 * Which is why it must not write depth. Writing it would let a sphere that should be invisible
 * cut a disc out of the traced shadow around it: the horizon punched through the middle of its
 * own silhouette, showing as a black dot over the centre of the disc.
 *
 * Not writing depth keeps it from cutting; it does not keep it from painting, and a black surface
 * drawn after the gas hides the gas whatever it does with depth. That half is the render order, and
 * it is set where the rest of the hole's drawing order is: see `HORIZON_RENDER_ORDER`.
 *
 * @type {string}
 */
const fragmentShader = `
void main() {
    gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
}
`;

/**
 * Material for a black hole's event horizon.
 *
 * A {@link THREE.ShaderMaterial} rather than a black {@link THREE.MeshBasicMaterial}, for two
 * reasons. Tone mapping and colour management can lift a nominally black basic material off
 * zero, and against a bloomed accretion disc a horizon that is merely very dark reads as a grey
 * ball. And a shader material carries no `color` property, which is what
 * {@link BodyRenderer.createPinpointLight} reads to tint the point that stands in for the body
 * at a distance — so it falls back to white rather than faithfully drawing a black dot on a
 * black sky, which is exactly what is wanted for something that has to be findable.
 */
class BlackHoleShaderMaterial extends THREE.ShaderMaterial {
    /**
     * Builds the horizon material.
     *
     * @param {Object} [options={}] - Material options.
     * @param {Object} [options.materialOptions] - Overrides for the material options set
     *   here.
     */
    constructor(options = {}) {
        super({
            uniforms: {},
            vertexShader,
            fragmentShader,
            transparent: false,
            depthWrite: false,
            side: THREE.FrontSide,
            toneMapped: false,
            ...options.materialOptions
        });
    }
}

export default BlackHoleShaderMaterial;
