import * as THREE from 'three';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import MathUtils from '../utils/MathUtils.js';
import { shadowApparentSine } from './AccretionDisk.js';

/**
 * How many black holes can bend light at once.
 *
 * A fixed bound because GLSL uniform arrays have to be sized at compile time, and the loop
 * over them needs a constant limit. Four is far more than the catalogue is ever likely to
 * hold, and the cost of an unused slot is one comparison per pixel.
 *
 * Exported because {@link ShadowMaskedBloomPass} reads this pass's uniform arrays directly and
 * has to declare them at the same length.
 *
 * @type {number}
 */
export const MAX_LENSES = 4;

/**
 * A hard ceiling on the pull, as a fraction of the distance to the shadow's edge.
 *
 * Purely a guard: it keeps a sample from ever landing inside the shadow, where the only thing
 * rendered is the black horizon, since the scene holds no image of what is behind it. With the
 * rim fade below in place it never actually binds — and that is the point. A cap that binds
 * *is* the mapping, and this one flattens towards `source = (1 - f)·r`, stretching a thin
 * annulus of the frame across a wide one, which shows up as concentric stair-stepped bands
 * rather than as lensing.
 *
 * @type {number}
 */
const MAX_PULL_FRACTION = 0.9;

/**
 * Where the deflection reaches full strength, in shadow radii.
 *
 * The deflection has to be faded to nothing at the shadow's edge, because it grows without
 * bound there and the frame has nothing to feed it. Faded over too short a span, though, the
 * pull grows with radius faster than the radius itself does, and the mapping inverts — a thin
 * band of the image comes out mirrored. Three shadow radii is far enough that it never does,
 * given an Einstein radius of about one; the two have to be chosen together.
 *
 * @type {number}
 */
const RIM_FADE_RADII = 3.0;

/**
 * The deflection this pass warps the frame by, as GLSL.
 *
 * It is deliberately not the deflection light actually suffers, and {@link BodyLensPass} does not
 * share it. Every departure from the physics here — the Einstein radius set to a bit over one horizon
 * radius when the true one is several, the fade in from the shadow's rim, the range stopping at a
 * dozen radii when a hole bends the sky over hundreds, the cap — is there because what this pass has
 * to work with is a *finished frame*, and a frame holds no image of what is behind the hole. Ask it
 * for the real deflection and it answers with the shadow's own edge smeared across the screen. So
 * this is a gentle suggestion of lensing that a frame can actually satisfy, and the price of it is
 * that it is far too weak to move anything visibly except a finely textured sky.
 *
 * Rendered apart from the sky, the bodies are under none of those constraints — there is nothing
 * beside them to tear — so they get the deflection itself instead; see {@link BodyLensPass}. The two
 * are never applied to the same hole, which is what makes the disagreement harmless: the strengths
 * below are complements and exactly one of them is ever non-zero.
 *
 * Radii are in units of the screen's height and the offset comes in aspect-corrected, so the
 * caller multiplies going in and divides coming out; see the fragment shader below.
 *
 * @type {string}
 */
const lensPullFunction = `
#define MAX_PULL_FRACTION ${MAX_PULL_FRACTION.toFixed(2)}
#define RIM_FADE_RADII ${RIM_FADE_RADII.toFixed(2)}

float lensPull(vec2 offset, float horizon, float einstein, float cutoff, float strength) {
    float radius = length(offset);

    float pull = einstein * einstein / radius;
    pull *= smoothstep(horizon, horizon * RIM_FADE_RADII, radius);
    pull *= strength * (1.0 - smoothstep(cutoff * 0.55, cutoff, radius));

    return min(pull, (radius - horizon) * MAX_PULL_FRACTION);
}
`;

/**
 * The apparent radius, in pixels, below which a hole stops bending light at all.
 *
 * A sub-pixel hole has nothing to distort, and warping a region a pixel across only makes the
 * background crawl as the camera moves. The second value is where the effect reaches full
 * strength, so it fades in over a few pixels rather than appearing all at once.
 *
 * @type {number}
 */
const MIN_PIXEL_RADIUS = 0.75;
const FULL_STRENGTH_PIXEL_RADIUS = 4.0;

/**
 * How far a hole has to move something on screen, in pixels, before the bodies are drawn bent.
 *
 * This is a different question from the one above, and it has to be asked separately, because
 * {@link BodyLensPass} is not switched on and off — switching it on changes how the whole frame is
 * rendered, the bodies coming out on a layer of their own. So the test is not whether the hole is
 * worth looking at but whether its deflection is worth that, and the honest measure of a deflection
 * is how far it moves a pixel.
 *
 * Half a pixel is where a shift stops being visible, and it is reached a long way out: a hole this
 * system's size stops moving anything at a few hundred of its own radii, which is far enough that
 * the bodies are already where they belong when it happens.
 *
 * @type {number}
 */
const MIN_BODY_SHIFT_PIXELS = 0.5;

/**
 * How much nearer than the hole a pixel has to be before it is left unwarped, as a fraction of
 * the hole's own depth.
 *
 * The pass reads the frame's depth to tell what is in front of the hole from what is behind it,
 * and the dividing line wants to be the hole's centre plane. It is set a little in front of it
 * instead, for the same reason the shadow's occluder sits a little behind it: the comparison is
 * against a quantised depth buffer, and a margin costs less than a tie does. What it costs is
 * that a body *between* the camera and the hole by less than this fraction is warped after all —
 * at the range the hole is worth looking at, a fraction of a horizon radius in front of the
 * centre, which is inside the shadow and so behind the silhouette anyway.
 *
 * Exported because {@link ShadowMaskedBloomPass} makes the same comparison against the same
 * depths, and the two have to draw the line in the same place: one stops warping in front of a
 * hole and the other stops masking there.
 *
 * @type {number}
 */
export const NEAR_DEPTH_MARGIN = 0.02;

/**
 * Scratch vectors, reused to avoid per-frame allocation.
 *
 * @type {THREE.Vector3}
 */
const _worldPosition = new THREE.Vector3();
const _viewPosition = new THREE.Vector3();
const _projected = new THREE.Vector3();
const _drawingBufferSize = new THREE.Vector2();

/**
 * Vertex shader for the pass: the composer's full-screen quad.
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
 * Fragment shader for the pass: samples the rendered frame from somewhere else.
 *
 * All radii are in units of the screen's height, which is why every offset is multiplied by
 * the aspect ratio on the way in and divided by it on the way out — in raw UV space a circle
 * around the hole would come out as an ellipse.
 *
 * The deflection is the point-mass lens: an image seen at angle `r` from the hole is really
 * light that left the source at `r - θ_E² / r`, where `θ_E` is the Einstein radius. So the pixel
 * at `r` is filled from that smaller radius, which wraps the background around the hole. Note
 * what that mapping does radially: the source radius changes by `1 + θ_E² / r²` per unit of
 * image radius, always more than one, so the image is *compressed* radially — a wide band of
 * the sky squeezed into a narrower ring around the shadow, which is the strong-lensing look.
 * Anything that makes that factor drop below one instead stretches the image, and stretching a
 * few pixels of a bright disc edge across a tenth of the screen is what banding is.
 *
 * Two departures near the shadow. Inside it the pixel is left exactly as it was, since that is
 * the shadow itself and there is nothing to bend — bending it would move the silhouette, which
 * is the one thing about a black hole that must not move. And just outside it the deflection is
 * faded in from zero, since the formula diverges at the edge and there is no image of what is
 * behind the hole to satisfy it with; see {@link RIM_FADE_RADII}. The photon ring is drawn over
 * that same rim, which is what covers the transition.
 *
 * Far out the deflection is faded to nothing over the last part of its range. Without that
 * fade the residual offset would stop abruptly at the cutoff and draw a visible circle around
 * the hole.
 *
 * What is in front of the hole is left exactly where it is, and that needs the frame's depth
 * rather than the frame alone. A hole bends the light of what is *behind* it and nothing else, so
 * a body between the camera and the hole has no business being displaced — and displacing it is
 * not a subtle error: the hole's own moon, crossing the shadow, would have its terminator dragged
 * round the rim, which reads as the shadow eating into a body that should be hiding it. So each pixel's
 * own depth is compared against the depth of each hole's centre, and a pixel nearer than that
 * skips the lens; see {@link NEAR_DEPTH_MARGIN}. An empty pixel reads as the far plane and is
 * warped, which is what the star field is.
 *
 * What that cannot fix is the other direction. The pixel a warped one is *filled from* may itself
 * be a near body, so a body's own colour still bleeds a few pixels outwards into the sky it stands
 * against on the hole's side. Testing the source as well would trade that for an unwarped patch of
 * sky hugging the body's limb, with the star field jumping across the seam, which is worse.
 *
 * The remaining known limitation is that the pass cannot tell what has already been lensed. The
 * accretion disc traces its own photon paths and is already lensed correctly, and is warped a
 * second time here — mild, because the fade from the shadow's edge has the deflection still small
 * across the part of the frame the disc occupies, and because the mapping is a compression either
 * way. What the pass is genuinely for is the star field and the distant bodies behind the hole,
 * which nothing else bends at all.
 *
 * @type {string}
 */
const fragmentShader = `
#define MAX_LENSES ${MAX_LENSES}
#define NEAR_DEPTH_MARGIN ${NEAR_DEPTH_MARGIN.toFixed(3)}

${lensPullFunction}

uniform sampler2D tDiffuse;
uniform sampler2D tSceneDepth;
uniform float uHasDepth;
uniform float uNear;
uniform float uFar;
uniform float uAspect;
uniform int uCount;
uniform vec2 uCenter[MAX_LENSES];
uniform float uHorizon[MAX_LENSES];
uniform float uEinstein[MAX_LENSES];
uniform float uCutoff[MAX_LENSES];
uniform float uStrength[MAX_LENSES];
uniform float uDepth[MAX_LENSES];

varying vec2 vUv;

void main() {
    vec2 aspect = vec2(uAspect, 1.0);
    vec2 sampleUv = vUv;

    // How far along the view axis whatever was drawn at this pixel is, which is the measure the
    // holes' own depths are given in. The buffer value is undone with the perspective divide it
    // was made with, so an empty pixel — depth one — comes back as the far plane, and everything
    // in the scene as its true distance regardless of where the near plane happens to be.
    float encoded = texture2D(tSceneDepth, vUv).x;
    float sceneDepth = (uNear * uFar) / max(uFar - (uFar - uNear) * encoded, 1e-9);

    for (int i = 0; i < MAX_LENSES; i++) {
        if (i >= uCount) break;

        vec2 offset = (vUv - uCenter[i]) * aspect;
        float radius = length(offset);
        float horizon = uHorizon[i];

        // Inside the silhouette, which this pass leaves exactly as the tracer drew it, and outside
        // this hole's reach. Both are circles about the hole's projection, which is the shadow's true
        // shape only on the view axis — an approximation this pass can afford and the two angular
        // consumers cannot; see {@link BlackHoleLensPass#update}. Everything this warp does is stated
        // in screen radii about that same centre, so a rim that is off by a few percent of itself
        // moves where the fade begins and nothing else.
        if (radius <= horizon) continue;
        if (radius > uCutoff[i]) continue;

        // Standing in front of this hole, so this hole does not bend it. Guarded on the depth
        // being there at all, because with no depth texture bound the fetch above reads zero,
        // which is the near plane, which would silently switch the whole effect off.
        if (uHasDepth > 0.5 && sceneDepth < uDepth[i] * (1.0 - NEAR_DEPTH_MARGIN)) continue;

        float pull = lensPull(offset, horizon, uEinstein[i], uCutoff[i], uStrength[i]);

        sampleUv -= (offset / radius) * pull / aspect;
    }

    gl_FragColor = texture2D(tDiffuse, clamp(sampleUv, 0.0, 1.0));
}
`;

/**
 * The gravitational lensing pass: bends the rendered frame around every black hole in it.
 *
 * Lensing is not something a body can do to itself. What a black hole distorts is everything
 * *behind* it — the star field, the planets — neither of which it has any access to while it is
 * being drawn. The finished frame does have all of it, which is why this is a post-processing
 * pass and lives in the composer rather than in a material.
 *
 * It is not, however, what bends the accretion disc, and it is not what bends the sky either: both of
 * those come from the disc's own tracer. Neither can be done here, and for the same reason:
 * a pass that only rearranges the pixels of a finished frame can show nothing the frame does not
 * already contain, and what lensing does around a black hole is precisely to bring into view what is
 * behind it. The disc's far half is one such thing. The sky just outside the shadow's rim is another,
 * and a more striking one — it has come from *behind* the hole, a hundred and fifty degrees round and
 * more, so no arrangement of this frame's pixels holds it. {@link AccretionDisk} follows the photon
 * paths and has it exactly.
 *
 * What remains for this pass is a hole with no disc to trace with, which nothing in the system
 * currently configures but the disc is optional and so this is not dead. Where a disc is tracing, the
 * hole is still registered here and simply not warped; see {@link BlackHoleLensPass#update}.
 *
 * That leaves the bodies, which the tracer does not draw and so cannot bend, and they are bent by
 * {@link BodyLensPass} instead — a pass that gets them on a layer of their own and so can move them
 * without dragging the sky along. Where a hole is on screen and how big it looks is worked out here
 * for both of them, because it is here that it is already being measured, and the uniforms holding it
 * are shared by reference. What is *not* shared is the deflection: freed of having to warp a finished
 * frame, that pass uses the true one, and it is stronger than this pass's by more than an order of
 * magnitude and reaches some thirty times as far; see {@link lensPullFunction}. Nor is it in the same
 * terms: the bodies are bent as directions rather than as pixels, so beside the screen-space slots
 * there is a second set holding the hole's direction and four angles measured about it, which this
 * pass's own shader reads none of. The bloom mask reads those rather than the screen ones as well.
 *
 * The pass sits between the render and the bloom, so light that lensing has concentrated
 * blooms like any other bright light rather than being bloomed first and smeared afterwards.
 *
 * Every hole's screen position and apparent size is computed on the CPU here, once per frame,
 * and handed to the shader as a small set of uniform arrays. It is also where a hole that is
 * off screen, behind the camera or too small to matter is dropped, so the common case — no
 * black hole anywhere near the view — costs nothing but the arithmetic for a handful of
 * bodies, and the pass reports that it can be switched off entirely.
 */
class BlackHoleLensPass extends ShaderPass {
    /**
     * Builds the pass with every lens slot empty.
     *
     * Starts disabled: with no holes registered there is nothing to bend, and an enabled pass
     * would cost a full-screen copy for a shader that returns its input unchanged.
     */
    constructor() {
        super({
            uniforms: {
                tDiffuse: { value: null },
                tSceneDepth: { value: null },
                uHasDepth: { value: 0.0 },
                uNear: { value: 0.1 },
                uFar: { value: 1000.0 },
                uAspect: { value: 1.0 },
                uTanHalf: { value: 0.5 },
                uCount: { value: 0 },
                uCenter: {
                    value: Array.from({ length: MAX_LENSES }, () => new THREE.Vector2())
                },
                uHorizon: { value: new Float32Array(MAX_LENSES) },
                uEinstein: { value: new Float32Array(MAX_LENSES) },
                uCutoff: { value: new Float32Array(MAX_LENSES) },
                uStrength: { value: new Float32Array(MAX_LENSES) },

                // The angular slots, which are directions and angles about the hole rather than
                // places and sizes on the screen; see {@link BlackHoleLensPass#update}. Held here
                // because this is where the measuring happens, and read by {@link BodyLensPass} and
                // {@link ShadowMaskedBloomPass}; this pass's own shader reads none of them.
                uHoleDir: {
                    value: Array.from({ length: MAX_LENSES }, () => new THREE.Vector3(0, 0, -1))
                },
                uShadowAngle: { value: new Float32Array(MAX_LENSES) },
                uReachAngle: { value: new Float32Array(MAX_LENSES) },
                uEinsteinSq: { value: new Float32Array(MAX_LENSES) },
                uImpactRadii: { value: new Float32Array(MAX_LENSES) },

                uDepth: { value: new Float32Array(MAX_LENSES) }
            },
            vertexShader,
            fragmentShader
        });

        this.enabled = false;
        this.bendsBodies = false;
    }

    /**
     * Fills the lens slots from this frame's camera, and says whether any survived.
     *
     * Two sets of measurements come out of here, in two different units, and which a slot belongs to
     * is the whole of its meaning. The frame's are sizes and places on the screen, in units of its
     * height, because that is what a pass warping a finished frame can address; the hole's depth along
     * the view axis is used for them rather than its distance, that being what the perspective divide
     * actually divides by. The bodies' are angles about the hole's own direction, because
     * {@link BodyLensPass} is not addressing the frame — it has the bodies on a layer of their own and
     * turns their directions. See {@link BodyLensPass} for what that difference buys, which is a hole
     * that goes on bending the bodies after it has left the frame, and stops doing so by degrees
     * instead of all at once.
     *
     * The shadow is the exception, and twice over. Its radius is the one size here that is not a
     * multiple of the hole's apparent radius, and it cannot be: `3√3 / 2` horizon radii is where the
     * silhouette lands far away only, and close in the shadow outgrows any fixed multiple. That
     * matters more here than anywhere, because the shadow's radius is what the pass leaves alone and
     * fades from — set it half the shadow's true size, as a constant multiple does at a couple of
     * horizon radii, and the pass spends its whole range warping the silhouette it was meant to
     * protect. Which looks like a grey band of resampled shadow outside the rim with the stars gone
     * from it, the disc's bright edge stretched into blocks across it, and anything else drawn there
     * — a star's glare, say — resampled away with it. So it comes from
     * {@link shadowApparentSine}, the same answer the disc's tracer draws with.
     *
     * And it is not a circle, which is why it is published twice over: once as a screen radius for the
     * frame warp, and once as the half-angle `uShadowAngle` for everything that can ask the question
     * properly. The silhouette is a cone of directions about the hole and the frame is a plane, so the
     * cut of the one by the other is a stretched, off-centre ellipse — and off the axis the difference
     * is not small. A circle at the hole's projection falls short of the true silhouette at both radial
     * ends, worst on the far side: forty degrees off-axis it misses a sixth of the silhouette's radial
     * extent out there, seven percent of the frame's height, and in that crescent inside the rim the
     * shadow is not recognised as the shadow. What shows up there is whatever was being held out of it,
     * which is {@link ShadowMaskedBloomPass} letting the photon ring's glow through — a grey wash
     * hugging the ring, the very artefact that mask exists to remove, reappearing at an angle.
     *
     * Publishing the exact figure — the ellipse itself, as a centre and a radial stretch — is not the
     * answer, and it is worth recording why. The ellipse only exists while the hole is nearer the axis
     * than `90° - θ`; past that the cone's cut is a hyperbola and the shared denominator
     * `cos²θ - sin²ψ` passes through zero. So the arithmetic blows up exactly where the silhouette has
     * left the frame long since, the shape swelling until it covers every pixel of the frame between
     * eighty-three and ninety degrees off-axis and letting go of them all at ninety. Both readers take
     * that region as one they must not touch, so the bodies would lose their deflection outright for
     * the last few degrees of the hole's approach to the camera plane and pick it up again on the other
     * side — a snap either side of the crossing, where the angle hands over smoothly.
     *
     * The angle has none of that in it. A pixel is inside the silhouette when its own direction is
     * within `θ` of the hole's, which is the definition rather than a projection of it, and it stays
     * meaningful at every angle including behind the camera — where it correctly answers no for every
     * pixel, no switch and no special case. It costs a dot product where the ellipse cost a squashed
     * distance. The frame warp keeps the circle because it is screen-space throughout and a rim that is
     * a few percent out only moves where its fade starts.
     *
     * That same depth is handed to the shader, which is what lets it leave alone anything drawn
     * in front of the hole; the near and far planes go with it, since undoing the depth buffer's
     * perspective divide needs both and the camera is free to change them between frames.
     *
     * A hole is skipped when it is too small to distort anything, and otherwise when it has nothing
     * left to do to this frame from either end: its influence circle does not reach the frame *and*
     * its deflection no longer moves a body by half a pixel. Both of those fade rather than cut — the
     * first over a few pixels of apparent radius, the second over the whole approach to the frame's
     * far side — so nothing snaps into or out of distortion.
     *
     * Being behind the camera is not among the reasons. A hole two dozen horizon radii away is still
     * bending the light that reaches the camera from in front of it, by half of what it bends at right
     * angles and less thereafter, so dropping it the moment it crossed the ninety degree line would
     * throw away a deflection worth several percent of the frame — the bodies, the pinpoints and the
     * star's glare all snapping to their true positions as a hole orbiting the camera passed behind it,
     * and snapping back as it came round. The screen-space slots do go empty there, because there is no
     * screen position to have; the angular ones do not, and they are the ones the bodies read.
     *
     * @param {Set<Body>} blackHoles - Registered black holes; each needs a `group`, a `radius`
     *   and the resolved `blackHoleLens` settings.
     * @param {THREE.PerspectiveCamera} camera - Camera the frame was rendered with. Its
     *   `matrixWorldInverse` has to be current, since both the depth and the screen position below
     *   come from it and this runs before the render that would otherwise refresh it;
     *   {@link SceneManager#updateCamera} is where that happens.
     * @param {THREE.WebGLRenderer} renderer - Renderer, for the drawing buffer's size.
     * @returns {boolean} `true` if at least one hole is bending light this frame, which is
     *   whether the pass is worth running. Whether any of them is bending the *bodies* is a
     *   separate question with a separate answer, left on `bendsBodies` for {@link BloomManager}
     *   to switch {@link BodyLensPass} by: the two are complements, so a frame can want one, the
     *   other, or both.
     */
    update(blackHoles, camera, renderer) {
        if (!blackHoles || blackHoles.size === 0) {
            this.uniforms.uCount.value = 0;
            this.bendsBodies = false;
            return false;
        }

        renderer.getDrawingBufferSize(_drawingBufferSize);
        const screenHeight = Math.max(_drawingBufferSize.y, 1);
        const aspect = _drawingBufferSize.x / screenHeight;
        const tanHalfFov = Math.tan(THREE.MathUtils.degToRad(camera.fov) * 0.5);

        // What one pixel of the frame's height covers, and how far the frame's corner is from the
        // middle of it. Both are angles, and both are for asking what a hole off the side of the
        // frame still does to the bodies on it.
        const pixelAngle = 2.0 * tanHalfFov / screenHeight;
        const halfDiagonal = Math.atan(Math.hypot(tanHalfFov * aspect, tanHalfFov));

        let count = 0;
        let bodyCount = 0;

        for (const body of blackHoles) {
            if (count >= MAX_LENSES) break;
            if (!body.group || !body.blackHoleLens) continue;

            body.group.getWorldPosition(_worldPosition);
            _viewPosition.copy(_worldPosition).applyMatrix4(camera.matrixWorldInverse);

            const distance = _viewPosition.length();
            if (!(distance > body.radius)) continue;

            // The apparent radius as an angle rather than as a size on screen, which is the same
            // number on the view axis and the only one of the two that means anything off it — a hole
            // to the side of the camera has no size on a screen it is not on.
            const angularRadius = body.radius / distance;
            const pixelRadius = angularRadius / pixelAngle;
            if (pixelRadius < MIN_PIXEL_RADIUS) continue;

            const lens = body.blackHoleLens;

            const { ratio: fadeIn } = MathUtils.clampAndRatio(
                pixelRadius, MIN_PIXEL_RADIUS, FULL_STRENGTH_PIXEL_RADIUS);

            // The Einstein radius, squared, in radians², for a source infinitely far behind the hole.
            // A ray passing at impact parameter `b` horizon radii is deflected by `2 / b` radians,
            // which through the thin-lens equation puts it at `θ_E² = 2 r_s f / d` — twice the
            // apparent radius, the distances and the horizon's own size cancelling. The `f` is taken
            // as one, every source in this system being effectively at infinity behind a hole this
            // small and this far out; {@link BodyLensPass} says why, and why the one body that is not
            // is not this pass's problem.
            //
            // Worth seeing how far this is from the frame warp's `einsteinRadii` of about one. The
            // real value falls off as the *square root* of the apparent radius, so the smaller the
            // hole looks the further ahead of any fixed multiple of its horizon it gets: at three or
            // four percent of the screen's height it is six horizon radii, which is twenty-five
            // times the deflection. That factor, and the range one, is the whole difference between
            // bodies that visibly swing around a hole and bodies that sit there.
            const einsteinSq = 2.0 * angularRadius;

            // The silhouette's half-angle, and how far out from the hole its influence is felt at all.
            // Both are angles about the hole's own direction and neither goes near the frame, so both
            // are as true of a hole behind the camera as of one in the middle of the screen.
            //
            // The reach is the frame warp's falloff radius expressed as the angle it subtends, which is
            // the apparent radius times the multiple, the screen radius and the depth cancelling. Only
            // the bloom mask wants it, to know how far a hole may hold its glow back off a dark surface
            // standing in front of it.
            const shadowAngle = Math.asin(shadowApparentSine(distance / body.radius));
            const reachAngle = angularRadius * lens.falloffRadii;

            // A hole whose disc traces the sky has already bent it, from the photon paths
            // themselves, so warping the frame here would bend the same light a second time — and
            // the second bend would be the wrong one, since what this pass has to work with is a
            // frame in which the sky is already where it belongs. The hole stays registered all the
            // same, and that is not a formality: the bloom mask reads these same slots to keep the
            // glow out of the silhouette, and {@link BodyLensPass} is switched by whether any of them
            // bends the bodies. What it is not load-bearing for is colour — the disc's shader carries
            // three.js's output encoding itself, so nothing about which passes run decides what colour
            // the sky is.
            //
            // What a traced hole gives up is therefore the warp of the *frame*, which is not the
            // same as giving up the warp. The tracer bends the sky and the gas and nothing else,
            // because those are the only things it draws; the bodies are drawn by the renderer and
            // would otherwise stand straight through a hole that bends everything around them. So the
            // two strengths below are exact complements, and which of them is set decides which
            // pass does the bending: this one over the whole frame, or {@link BodyLensPass} over
            // the bodies alone, which is the only one of the two that can be right about a frame
            // whose sky is already lensed — and, having no sky beside the bodies to tear, the only
            // one of the two that can afford the deflection light actually suffers.
            const traced = Boolean(body.accretionDisk && body.accretionDisk.tracesSky);

            // The largest deflection the bodies suffer anywhere in this frame, which is the one at
            // whichever frame direction lies closest to the hole — no closer than the hole's own angle
            // off the axis, less the corner's. Zero when the hole is inside the frame, where the
            // deflection has no bound at all and the answer is obviously yes.
            const offAxis = Math.acos(THREE.MathUtils.clamp(-_viewPosition.z / distance, -1.0, 1.0));
            const closest = Math.max(offAxis - halfDiagonal, 0.0);

            const bodyShift = closest > 0.0
                ? 0.5 * einsteinSq * lens.strength * fadeIn / Math.tan(closest * 0.5)
                : Infinity;

            const bendsBody = traced && bodyShift >= MIN_BODY_SHIFT_PIXELS * pixelAngle;

            // Everything from here to the end of the block is the hole as a *place on the screen*,
            // which it only has while it is in front of the camera — and which only the frame warp
            // asks for. Behind the camera there is no projection to take, so those slots go out empty
            // and a zero range leaves the warp with no pixel to touch. Nothing that matters hangs on
            // it: the warp is off for a tracing hole anyway, and the angular slots below, which are
            // what the bodies and the mask read, are measured the same way on both sides of the plane.
            const depth = -_viewPosition.z;
            const inFront = depth > camera.near;

            let centreX = 0.5;
            let centreY = 0.5;
            let horizon = 0.0;
            let cutoff = 0.0;
            let einstein = 0.0;
            let onScreen = false;

            if (inFront) {
                const screenRadius = body.radius / (2 * depth * tanHalfFov);

                cutoff = screenRadius * lens.falloffRadii;
                einstein = screenRadius * lens.einsteinRadii;

                // The shadow as the frame warp needs it: a screen radius about the hole's projection,
                // which is the silhouette's half-angle put through the same perspective divide. Exact
                // on the view axis and the tangential half-width to within a part in a thousand off it,
                // the projection stretching the shadow by very nearly the same cosine that shrank the
                // angle; it is the radial half-width a circle cannot have. See the note above.
                horizon = Math.tan(shadowAngle) / (2 * tanHalfFov);

                _projected.copy(_worldPosition).project(camera);
                centreX = _projected.x * 0.5 + 0.5;
                centreY = _projected.y * 0.5 + 0.5;

                // How far out the frame is warped, against how far off the frame the hole is. Not the
                // bodies' range, nor the mask's: those are angles, and they were settled above.
                const outsideX = Math.max(0, Math.abs(centreX - 0.5) - 0.5) * aspect;
                const outsideY = Math.max(0, Math.abs(centreY - 0.5) - 0.5);

                onScreen = Math.hypot(outsideX, outsideY) <= Math.max(cutoff, horizon);
            }

            // Nothing left for this hole to do to this frame, from either end of it.
            if (!onScreen && !bendsBody) continue;

            this.uniforms.uCenter.value[count].set(centreX, centreY);
            this.uniforms.uHorizon.value[count] = horizon;
            this.uniforms.uEinstein.value[count] = einstein;
            this.uniforms.uCutoff.value[count] = cutoff;
            this.uniforms.uStrength.value[count] = traced || !inFront ? 0.0 : lens.strength * fadeIn;

            // Where the hole is, as a direction, and the angles measured about it: how far round the
            // silhouette reaches, how far its influence does, and the two numbers that turn an angle
            // from it into a deflection and an impact parameter. Unit length, so the shader can dot
            // with it.
            this.uniforms.uHoleDir.value[count].copy(_viewPosition).multiplyScalar(1.0 / distance);
            this.uniforms.uShadowAngle.value[count] = shadowAngle;
            this.uniforms.uReachAngle.value[count] = reachAngle;
            this.uniforms.uEinsteinSq.value[count] = bendsBody
                ? einsteinSq * lens.strength * fadeIn
                : 0.0;
            this.uniforms.uImpactRadii.value[count] = distance / body.radius;

            // Negative for a hole behind the camera, where nothing can be in front of it — which is
            // the right answer for the readers that ask, since a pixel in front of a hole is one whose
            // light never went near it and that is every pixel of a frame the hole is behind.
            this.uniforms.uDepth.value[count] = depth;

            if (bendsBody) bodyCount++;

            count++;
        }

        this.uniforms.uNear.value = camera.near;
        this.uniforms.uFar.value = camera.far;
        this.uniforms.uAspect.value = aspect;
        this.uniforms.uTanHalf.value = tanHalfFov;
        this.uniforms.uCount.value = count;

        this.bendsBodies = bodyCount > 0;

        return count > 0;
    }

    /**
     * Draws the pass, taking this frame's depth from the buffer it is reading the colour from.
     *
     * The depth has to be the depth of the frame in `readBuffer`, and that is why it is picked up
     * here rather than being handed over once at construction. {@link BloomManager} puts a depth
     * texture on both of the composer's targets, because which of the two the scene was rendered
     * into is not fixed: the render pass draws into the read buffer and does not swap, so which
     * buffer that is depends on how many *enabled* passes swapped on the frames before — and the
     * lens and bloom passes both switch themselves on and off. Reading it off the buffer being
     * handed in is the one way to be right either way. A buffer with no depth texture is not an
     * error; the pass falls back to warping everything.
     *
     * @param {THREE.WebGLRenderer} renderer - Renderer to draw with.
     * @param {THREE.WebGLRenderTarget} writeBuffer - Target to draw into.
     * @param {THREE.WebGLRenderTarget} readBuffer - Target holding the frame to warp.
     * @param {number} deltaTime - Frame time, unused here.
     * @param {boolean} maskActive - Whether a mask pass is active, unused here.
     * @returns {void}
     */
    render(renderer, writeBuffer, readBuffer, deltaTime, maskActive) {
        const depthTexture = readBuffer ? readBuffer.depthTexture : null;

        this.uniforms.tSceneDepth.value = depthTexture || null;
        this.uniforms.uHasDepth.value = depthTexture ? 1.0 : 0.0;

        super.render(renderer, writeBuffer, readBuffer, deltaTime, maskActive);
    }
}

export default BlackHoleLensPass;
