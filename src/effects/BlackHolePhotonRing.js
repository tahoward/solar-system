import * as THREE from 'three';
import { SHADOW_HORIZON_RADII, shadowApparentSine, shadowApparentTangent } from './AccretionDisk.js';
import { log } from '../utils/Logger.js';

/**
 * Scratch vector, reused to avoid per-frame allocation.
 *
 * @type {THREE.Vector3}
 */
const _worldPosition = new THREE.Vector3();

/**
 * How far in front of the shadow's solid the quad is stepped, as a fraction of the camera's distance.
 *
 * Added to the solid's own apparent sine, which is what actually gets the quad clear of it: the solid
 * is a ball of radius `d·sinθ` centred on the hole, so its nearest point is `d·(1 - sinθ)` away and a
 * plane through the centre is behind it everywhere the ring draws. Stepping by the sine alone lands on
 * that near point exactly, which is a tie, so this is what turns the tie into a gap.
 *
 * A fraction of the distance rather than of the shadow, for the same reason
 * {@link SHADOW_DEPTH_MARGIN} is: the depth buffer's resolution falls off as the square of the
 * distance, and a gap stated as a fraction of the *shadow* would shrink faster than the buffer's
 * steps and stop being a gap somewhere in the middle of the useful range — the ring would begin to
 * z-fight against the ball in speckles a few hundred horizon radii out, which is well inside where
 * the ring is still several pixels wide. A percent of the distance holds tens of resolvable steps
 * over the whole of that range and costs nothing, because the step is free: see
 * {@link BlackHolePhotonRing#update} for why moving the quad along the line of sight and rescaling
 * it changes no pixel it draws.
 *
 * @type {number}
 */
const SHADOW_CLEARANCE = 0.01;

/**
 * Ceiling on that step, as a fraction of the camera's distance.
 *
 * The step is nearly all sine, and the sine runs to one at the photon sphere, so without a ceiling the
 * quad would be walked all the way onto the camera's own position — and through it, and inside out.
 * Nothing is being protected from at that range: the solid hides itself once the sine reaches one, and
 * a quarter of the way in is already far closer than anything can get in this scene. Half is a ceiling
 * that only the impossible cases ever reach, which is what a ceiling should be.
 *
 * @type {number}
 */
const MAX_SHADOW_CLEARANCE = 0.5;

/**
 * Vertex shader for the photon ring: a plain textured quad.
 *
 * @type {string}
 */
const vertexShader = `
varying vec2 vUv;

void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

/**
 * Fragment shader for the photon ring: a thin bright circle with a glow outside it.
 *
 * The distance from the quad's centre is converted straight back into horizon radii, so the
 * ring can be positioned in the same units everything else about the hole is stated in.
 *
 * Two terms. The ring itself is a Gaussian in that radius, which gives a soft-edged circle
 * whose width is stated rather than left to the tessellation. The halo outside it is an
 * inverse power of radius, faded in across the ring's own width so it starts at the ring
 * rather than filling the disc inside it — that inside is the hole, and it has to stay black.
 *
 * The two widths are deliberately tied: the halo's fade-in spans the ring's thickness, so
 * thinning the ring also sharpens the halo's inner edge onto the silhouette instead of leaving
 * a soft bright band inside it.
 *
 * The halo has to be kept a rim glow and nothing more, and an inverse power is an unforgiving
 * shape for that: it is additive, it is drawn over the shadow as well as over the sky, and its
 * reach is set by the exponent rather than by the quad. At an exponent of two and a half it is
 * still a fifth of its peak two ring radii out, which fills the frame with an even grey haze,
 * hides the star field and reads as a second, much larger object around the hole rather than as
 * a glow on this one. Six is the shape that goes dark within about half a radius. The visible
 * glow is then the bloom's, which is what should be producing it: the ring is drawn above one so
 * that it blooms, and the bloom spreads with the ring's brightness instead of independently of it.
 *
 * The quad's own edge is faded out too. Little reaches it at that exponent, but the halo would
 * otherwise be cut off in a square, which is instantly recognisable as a billboard.
 *
 * @type {string}
 */
const fragmentShader = `
uniform vec3 uColor;
uniform float uExtent;
uniform float uRingRadius;
uniform float uThickness;
uniform float uBrightness;
uniform float uHaloStrength;
uniform float uHaloFalloff;
uniform float uOpacity;

varying vec2 vUv;

void main() {
    float radius = length(vUv - 0.5) * 2.0 * uExtent;
    float thickness = max(uThickness, 1e-4);

    float offset = (radius - uRingRadius) / thickness;
    float ring = exp(-offset * offset);

    float halo = pow(uRingRadius / max(radius, 1e-4), uHaloFalloff) * uHaloStrength;
    halo *= smoothstep(uRingRadius - thickness, uRingRadius + thickness, radius);

    float intensity = (ring + halo) * uBrightness;
    intensity *= 1.0 - smoothstep(uExtent * 0.6, uExtent, radius);

    if (intensity <= 0.002) discard;

    gl_FragColor = vec4(uColor * intensity, clamp(intensity * uOpacity, 0.0, 1.0));
}
`;

/**
 * The ring of light around a black hole's silhouette.
 *
 * Light passing close enough to the hole orbits it one or more times before escaping, which
 * piles the whole sky up into a thin bright circle just outside the shadow. That is a purely
 * optical effect with no matter behind it, so there is nothing to model — a camera-facing quad
 * is the right shape for it, since the ring looks the same from every direction.
 *
 * Its radius is the shadow's, at `3√3 / 2` horizon radii rather than at the horizon: the hole
 * bends the light of its own silhouette outwards, so the dark disc actually seen is over two and
 * a half times the size of the horizon sphere drawn inside it. {@link AccretionDisk} traces
 * photon paths and arrives at that same edge on its own, which is the boundary this is drawn on —
 * and since only one of the two is free to be placed, this is the one that follows, resized each
 * frame onto the silhouette by {@link BlackHolePhotonRing#update}.
 *
 * It also has a job beyond looking right. {@link BlackHoleLensPass} has to stop warping at that
 * same edge, because it has no image of what is behind it to bend around, and the ring covers the
 * boundary — where the eye reads a bright rim rather than the seam underneath it.
 *
 * Depth tested, and it takes a moment to see why that is safe. The quad passes through the hole's
 * centre and so does the disc's billboard, which puts two camera-facing planes on the same depth
 * over the whole of their overlap — but neither of them *writes* depth, so the tie is never
 * recorded and never compared. What does write depth at the hole is two surfaces neither of these
 * planes has to argue with. The shadow's occluder is flat and placed deliberately a hair further
 * from the camera than the centre, so both of them clear it; see
 * {@link BlackHoleEffects.addShadowOccluder}. The shadow's solid is a ball and reaches in front of
 * the centre, so this quad does not clear it and is instead stepped out in front of it, which costs
 * the ring nothing at all — see {@link BlackHolePhotonRing#update}.
 *
 * So what the test is left comparing against is real geometry, and being additive is no defence
 * there: untested, a body between the camera and the hole takes a bright circle across its face, and
 * nothing else in the frame can correct that. It writes no depth of its own, which keeps it out of
 * every other object's way.
 */
class BlackHolePhotonRing {
    /**
     * Builds the ring and its mesh.
     *
     * @param {Object} [options={}] - Ring options.
     * @param {number} [options.horizonRadius=1.0] - The drawn radius of the event horizon in
     *   scene units, which the other radii here are multiples of.
     * @param {number} [options.ringRadius=2.5980762] - Radius of the bright circle, in horizon
     *   radii. The shadow's edge at `3√3 / 2`, so the ring straddles it rather than ringing it:
     *   {@link BlackHolePhotonRing#update} states the quad's scale against that same figure, which
     *   turns any offset from it into a fixed fraction of the silhouette's screen radius and so
     *   into a visible gap of bare sky at every zoom level. Half of the ring's width falling
     *   inside the silhouette is not a defect — the ring is what the edge looks like.
     * @param {number} [options.thickness=0.014] - Half-width of the bright circle, in horizon
     *   radii, where the Gaussian has fallen to `1/e`. Small: the real ring is the sky piled up
     *   at a single radius, so any visible width is the softening rather than the feature.
     * @param {number} [options.extent=7.0] - Half-width of the quad, in horizon radii; has to
     *   be wide enough to hold the halo outside the ring.
     * @param {number|THREE.Color} [options.color=0xffefd6] - Colour of the ring.
     * @param {number} [options.brightness=2.2] - Peak brightness; above 1 so the ring blooms.
     * @param {number} [options.haloStrength=0.06] - Brightness of the glow outside the ring, at
     *   the ring itself. Low: it is added over the shadow as well as over the sky, so it is what
     *   decides how black the hole looks.
     * @param {number} [options.haloFalloff=6.0] - How fast that glow falls off with radius. High
     *   enough that the glow is gone within half a ring radius rather than hazing the frame.
     * @param {number} [options.opacity=1.0] - Overall emission multiplier.
     */
    constructor(options = {}) {
        this.horizonRadius = options.horizonRadius || 1.0;
        this.extent = options.extent || 7.0;

        this.mesh = this.createRingMesh(options);
    }

    /**
     * Builds the quad and its material.
     *
     * The quad is a unit square scaled to the ring's full extent, so the shader's own radius
     * calculation is in units of the quad rather than of the scene and needs no scale uniform.
     * That scale is kept, because {@link BlackHolePhotonRing#update} multiplies it rather than
     * replacing it.
     *
     * @param {Object} options - The constructor's options, for the material.
     * @returns {THREE.Mesh} The ring mesh.
     */
    createRingMesh(options) {
        const geometry = new THREE.PlaneGeometry(1, 1);

        this.baseScale = this.extent * 2 * this.horizonRadius;

        const mesh = new THREE.Mesh(geometry, this.createRingMaterial(options));
        mesh.scale.setScalar(this.baseScale);
        mesh.renderOrder = 10;

        return mesh;
    }

    /**
     * Builds the ring's shader material.
     *
     * @param {Object} options - Ring options; see the constructor.
     * @returns {THREE.ShaderMaterial} The ring material.
     */
    createRingMaterial(options) {
        return new THREE.ShaderMaterial({
            uniforms: {
                uColor: { value: new THREE.Color(options.color || 0xffefd6) },
                uExtent: { value: this.extent },
                uRingRadius: { value: options.ringRadius || SHADOW_HORIZON_RADII },
                uThickness: { value: options.thickness || 0.014 },
                uBrightness: { value: options.brightness !== undefined ? options.brightness : 2.2 },
                uHaloStrength: {
                    value: options.haloStrength !== undefined ? options.haloStrength : 0.06
                },
                uHaloFalloff: { value: options.haloFalloff || 6.0 },
                uOpacity: { value: options.opacity !== undefined ? options.opacity : 1.0 }
            },
            vertexShader,
            fragmentShader,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            depthTest: true,
            side: THREE.DoubleSide,
            toneMapped: false
        });
    }

    /**
     * Turns the quad to face the camera and resizes it onto the shadow's rim.
     *
     * The ring would ideally hold a fixed size in the world, being a real feature of the hole at a
     * real radius rather than a stand-in for one. It cannot, because a flat quad's apparent radius
     * falls as `1 / d` and the shadow's does not — the shadow outgrows any fixed multiple of the
     * horizon as the camera closes in. Left at a fixed size the ring ends up drawn *inside* the
     * silhouette, a bright circle with a wide skirt of shadow beyond it, which reads as a second
     * dark object around the hole.
     *
     * So the quad is rescaled every frame by the ratio of the shadow's true apparent size to the
     * far-field one it was built against — the tangent, because this is a plane and not a sphere;
     * see {@link shadowApparentTangent}. The ratio tends to one at a distance, which leaves the
     * configured radii meaning exactly what they say: the ring keeps whatever fraction outside the
     * silhouette it was given, at every distance, instead of only at infinity. Growing the quad
     * costs no fill, since what leaves the frame is clipped.
     *
     * It is also stepped along the line of sight, out in front of the ball that carries the shadow's
     * depth; see {@link BlackHoleEffects.addShadowSolid} and {@link SHADOW_CLEARANCE}. That ball
     * reaches in front of the hole's centre and this quad passes through it, so without the step the
     * depth test would cut the ring away over the whole silhouette and leave the shadow with no rim.
     *
     * The step is free, and that is the reason it is the answer rather than shrinking the ball or
     * turning the test off. Sliding a camera-facing plane towards the camera and scaling it by the
     * same fraction slides every one of its points along its own ray from the camera: `p - eye`
     * becomes `(1 - c)·(p - eye)`, so every pixel it covers still aims in the direction it did, still
     * carries the same place in the quad's own radius, and is merely recorded at a nearer depth. The
     * ring lands exactly where it did with the ball absent, which is what lets the ball be sized for
     * the silhouette and nothing else.
     *
     * @param {THREE.Camera} camera - Camera to face.
     * @returns {void}
     */
    update(camera) {
        if (!camera) return;

        // Before both the aim and the measurement, because the step below leaves the quad off centre
        // and the frame after would otherwise aim from where it ended up and measure its distance from
        // there — a step compounding into the next one, and a hole that drifts towards the camera for
        // as long as it is looked at.
        this.mesh.position.set(0, 0, 0);
        this.mesh.lookAt(camera.position);

        this.mesh.getWorldPosition(_worldPosition);

        const distance = _worldPosition.distanceTo(camera.position);
        const horizonRadii = distance / this.horizonRadius;
        const apparent = horizonRadii * shadowApparentTangent(horizonRadii) / SHADOW_HORIZON_RADII;

        const clearance = Math.min(
            shadowApparentSine(horizonRadii) + SHADOW_CLEARANCE, MAX_SHADOW_CLEARANCE);

        // Both halves of the same move, and they have to agree exactly: what is stepped off the
        // distance is scaled off the size, so the quad ends up on a nearer slice of the same cone.
        this.mesh.translateZ(clearance * distance);
        this.mesh.scale.setScalar(this.baseScale * apparent * (1.0 - clearance));
    }

    /**
     * Parents the ring to another object.
     *
     * @param {THREE.Object3D} parent - Object to add the mesh to.
     * @returns {void}
     */
    addToScene(parent) {
        parent.add(this.mesh);
        log.debug('BlackHolePhotonRing', 'Photon ring added to scene');
    }

    /**
     * The ring's mesh.
     *
     * @returns {THREE.Mesh} The mesh.
     */
    getMesh() {
        return this.mesh;
    }

    /**
     * Releases the ring's geometry and material and unparents it.
     *
     * @returns {void}
     */
    dispose() {
        if (this.mesh.geometry) {
            this.mesh.geometry.dispose();
        }
        if (this.mesh.material) {
            this.mesh.material.dispose();
        }
        if (this.mesh.parent) {
            this.mesh.parent.remove(this.mesh);
        }

        log.info('BlackHolePhotonRing', 'Photon ring disposed');
    }
}

export default BlackHolePhotonRing;
