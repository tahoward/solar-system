import * as THREE from 'three';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { CopyShader } from 'three/addons/shaders/CopyShader.js';
import { MAX_LENSES, NEAR_DEPTH_MARGIN } from './BlackHoleLensPass.js';

/**
 * How far inside the shadow's edge the mask fades from nothing to full, as a fraction of the
 * shadow's angular radius.
 *
 * A hard cut would put a visible circle in the glow. It is kept narrow rather than generous
 * because the point of the mask is that the shadow is black, and a wide fade is a wide band of
 * glow inside the silhouette — exactly what is being removed. A hundredth of the radius is about
 * the width the photon ring itself covers, so the transition happens underneath the ring, in the
 * one place on the rim where an abrupt change is already hidden.
 *
 * @type {number}
 */
const MASK_SOFTNESS = 0.01;

/**
 * Luminance of the frame underneath at which a surface in front of a hole keeps none of its glow,
 * and the luminance at which it keeps all of it.
 *
 * Being in front of the shadow is not on its own a reason to be lit. A body crossing the silhouette
 * shows the same night side it shows anywhere else, and a night side is as black as the shadow it is
 * standing on — so letting the glow through there fills the silhouette with the same soft wash the
 * mask exists to remove, just at one remove. What earns the glow is the pixel already being lit.
 *
 * The two levels come from the surfaces themselves. This is the linear frame, before tone mapping,
 * where a sunlit surface is its own albedo and the bloom threshold of one is well above anything lit
 * by reflected light. A night side is the ambient term only, five thousandths of the texture — see
 * `PlanetShaderMaterial` and `COMPANION_AMBIENT` — so the floor sits just above the brightest
 * possible night side, and full glow arrives around a few percent, which a surface reaches while
 * still well inside its own crescent. The ramp between them follows the body's own shading, so the
 * transition it introduces runs along the terminator, where the image is already going dark, rather
 * than across the shadow's rim.
 *
 * @type {number}
 */
const NEAR_GLOW_FLOOR = 0.01;

/**
 * @see NEAR_GLOW_FLOOR
 * @type {number}
 */
const NEAR_GLOW_FULL = 0.06;

/**
 * Smallest reach, in units of the shadow's angular radius, over which a hole is allowed to hold the
 * glow back off a dark surface in front of it.
 *
 * The reach itself is the hole's own falloff radius as an angle, the same range the warp fades out
 * over, and this is only a floor under it for the close view where the shadow outgrows that range.
 *
 * The reach has to be wider than the silhouette, which is the whole point of it. Judged inside the
 * silhouette alone, a body's night side comes out black over the shadow and keeps the ring's glow
 * everywhere else on it — and the boundary between those two is the shadow's rim, drawn across the
 * middle of a body that is in front of it. That is the same artefact as masking it outright, arrived
 * at from the other side. So a dark surface near a hole is dark over the whole of it, and the glow
 * comes back gradually with distance from the rim, out where the ring's contribution is small enough
 * that the return does not read as an edge.
 *
 * @type {number}
 */
const NEAR_GRIP_MIN_RADII = 2.0;

/**
 * Fragment shader: the bloom's additive blend, held back inside every shadow.
 *
 * This is `CopyShader` with one factor added. Every radius here is an angle about the hole's own
 * direction, matching {@link BlackHoleLensPass}, whose uniforms these are, and what each pixel is
 * placed by is the angle between the direction it looks along and the direction to the hole. So the
 * mask is the silhouette's own cone rather than a figure fitted to it on screen. Fitted on screen it
 * would be wrong twice: a circle at the hole's projection leaves the far side of the rim uncovered,
 * and a crescent of the ring's glow inside the shadow is precisely the artefact below; and the
 * ellipse that covers the rim exactly stops existing as the hole nears the camera plane, swelling to
 * cover the whole frame and holding the glow out of all of it. See {@link BlackHoleLensPass#update}.
 *
 * The mask applies to the shadow and not merely to the region the shadow covers on screen, which
 * takes the frame's depth: a pixel nearer than the hole's centre is something standing in front of
 * the silhouette, and what is in front of a shadow is lit like anything else. Left out, this would
 * not be a subtle loss. The one body that ever crosses this circle is the hole's own moon, the
 * brightest thing next to it is the photon ring drawn on the rim the moon is crossing, and the ring's
 * glow is wide — so the moon would carry the glow on the outside of the rim and none of it inside,
 * split along a hard circular arc that reads as the shadow showing through a body in front of it.
 * The depth comparison is {@link BlackHoleLensPass}'s, down to the margin; see
 * {@link NEAR_DEPTH_MARGIN}.
 *
 * Being in front is necessary and not sufficient: how much of the glow such a pixel keeps is set by
 * how lit it already is, because the far side of that same moon is as black as the shadow and a glow
 * on it would be the wash all over again. See {@link NEAR_GLOW_FLOOR}. That needs the frame as
 * rendered, which is the texture the lens pass read, shared the same way its depth is. And that
 * judgement extends past the silhouette, out over the hole's whole reach — see
 * {@link NEAR_GRIP_MIN_RADII} — because a rule that only applied inside the silhouette would draw
 * its own boundary along the shadow's rim, which is the artefact again.
 *
 * So around a hole the three things that can be under a pixel come out differently: the shadow and
 * whatever is behind it are black, a lit surface in front glows as it would anywhere, and a dark
 * surface in front stays dark whether it is over the silhouette or beside it.
 *
 * Only the colour is masked, not the alpha. Additive blending multiplies by the source alpha, so
 * masking both would apply the factor twice and turn the fade into a square law.
 *
 * @type {string}
 */
const fragmentShader = `
#define MAX_LENSES ${MAX_LENSES}
#define MASK_SOFTNESS ${MASK_SOFTNESS.toFixed(4)}
#define NEAR_DEPTH_MARGIN ${NEAR_DEPTH_MARGIN.toFixed(3)}
#define NEAR_GLOW_FLOOR ${NEAR_GLOW_FLOOR.toFixed(4)}
#define NEAR_GLOW_FULL ${NEAR_GLOW_FULL.toFixed(4)}
#define NEAR_GRIP_MIN_RADII ${NEAR_GRIP_MIN_RADII.toFixed(2)}

uniform sampler2D tDiffuse;
uniform sampler2D tScene;
uniform sampler2D tSceneDepth;
uniform float opacity;
uniform float uAspect;
uniform float uTanHalf;
uniform float uHasDepth;
uniform float uNear;
uniform float uFar;
uniform int uCount;
uniform vec3 uHoleDir[MAX_LENSES];
uniform float uShadowAngle[MAX_LENSES];
uniform float uReachAngle[MAX_LENSES];
uniform float uDepth[MAX_LENSES];

varying vec2 vUv;

void main() {
    float mask = 1.0;

    // The direction this pixel looks along, in the camera's own space, which is what the holes'
    // angles are measured from.
    vec3 look = normalize(vec3((vUv * 2.0 - 1.0) * uTanHalf * vec2(uAspect, 1.0), -1.0));

    // Distance along the view axis to whatever was drawn here, undoing the perspective divide the
    // buffer was written with, so an empty pixel comes back as the far plane and is behind every
    // hole — which is what the star field is.
    float encoded = texture2D(tSceneDepth, vUv).x;
    float sceneDepth = (uNear * uFar) / max(uFar - (uFar - uNear) * encoded, 1e-9);

    // How lit whatever was drawn here is, from the frame as rendered rather than from the blur.
    float sceneLuma = dot(texture2D(tScene, vUv).rgb, vec3(0.2126, 0.7152, 0.0722));
    float lit = smoothstep(NEAR_GLOW_FLOOR, NEAR_GLOW_FULL, sceneLuma);

    for (int i = 0; i < MAX_LENSES; i++) {
        if (i >= uCount) break;

        float edge = uShadowAngle[i];

        // How far round from the hole this pixel is. A hole behind the camera needs no special case:
        // every pixel of the frame is more than a right angle from it, so it masks nothing, which is
        // the answer rather than an approximation of it.
        float radius = acos(clamp(dot(look, uHoleDir[i]), -1.0, 1.0));

        // Inside the silhouette, where nothing behind can be lit and nothing glows.
        float inside = 1.0 - smoothstep(edge * (1.0 - MASK_SOFTNESS), edge, radius);

        float allow = 1.0 - inside;

        // Nearer than this hole, so what is drawn here stands in front of the silhouette, and it
        // keeps the glow its own brightness has earned rather than the shadow's blackness. The
        // hole's say in that covers the silhouette entirely and fades out to nothing by the edge of
        // its reach, so a night side crossing the rim does not change along the rim. Guarded on the
        // depth being there at all: with no depth texture bound the fetch reads zero, the near
        // plane, and every pixel would count as being in front of everything.
        if (uHasDepth > 0.5 && sceneDepth < uDepth[i] * (1.0 - NEAR_DEPTH_MARGIN)) {
            float reach = max(uReachAngle[i], edge * NEAR_GRIP_MIN_RADII);
            float grip = max(inside, 1.0 - smoothstep(edge, reach, radius));

            allow = mix(1.0, lit, grip);
        }

        mask = min(mask, allow);
    }

    vec4 bloom = texture2D(tDiffuse, vUv);

    gl_FragColor = vec4(opacity * mask * bloom.rgb, opacity * bloom.a);
}
`;

/**
 * Bloom, with the one thing in the scene that is allowed to stay black staying black.
 *
 * A black hole's shadow is the absence of light rather than a dark surface: nothing that could
 * emit is in front of it and nothing behind it escapes. But bloom is a wide blur added over the
 * finished frame, and the brightest thing anywhere near a hole is the photon ring drawn on the
 * shadow's own rim, a couple of pixels wide and well above the bloom threshold. So the glow the
 * ring is meant to have outside the silhouette is spread just as far inside it, filling the
 * shadow with a soft bright wash from its edge inwards. It is the one place a glow is wrong, and
 * the ring is the one light source guaranteed to be next to it.
 *
 * The fix is to hold the bloom back inside the silhouette rather than to dim the ring, because the
 * ring's brightness is also what gives it the glow it should have on the outside — the two cannot
 * be traded against each other. `UnrealBloomPass` builds its blur and then blends it additively
 * over the frame; all this changes is that last blend, which is also why the frame *underneath* is
 * left exactly as rendered. That matters more than it sounds: the shadow's interior is not simply
 * black, since a ray that plunges in still shows whatever gas it crossed on the way, so the near
 * half of an accretion disc is drawn across the shadow and must survive this.
 *
 * The mask reads {@link BlackHoleLensPass}'s uniforms directly rather than working the geometry out
 * again. The two passes have to agree about where the shadow's edge is — one stops warping there
 * and the other stops glowing there — and sharing the arrays makes that structural instead of a
 * thing to keep in step. It also means the culling is shared: a hole too small or too far off
 * screen for the lens pass to bother with sets no mask either, which is correct, and a frame with
 * no holes in it sets `uCount` to zero and this behaves as plain bloom.
 *
 * The frame's depth comes the same way, and that one is an ordering as well as a sharing: the lens
 * pass picks the depth texture off the buffer it is handed and leaves it in the uniform it shares
 * with this pass, and it runs first in the chain, so by the time the blend below reads it it is this
 * frame's. Being shared, it is also right when the lens pass is doing nothing else — a hole whose
 * disc traces the sky is warped by nobody and still masked here.
 *
 * One case the depth test cannot reach is the disc's own near-side gas, which is drawn over the
 * silhouette and loses its bloom there because it is part of the same traced billboard as the shadow
 * and carries the shadow's depth. That is far less noticeable than the artefact the mask fixes, since
 * what is lost is the glow around something still drawn in full, and it errs in the direction the
 * shadow wants: darker.
 */
class ShadowMaskedBloomPass extends UnrealBloomPass {
    /**
     * Builds the bloom pass and swaps its final blend for the masked one.
     *
     * The uniform objects are shared with the lens pass by reference, not copied, so nothing has
     * to be pushed across per frame — whatever the lens pass worked out for this frame is what the
     * mask uses. The frame's colour is the exception: that one is the lens pass's own input, so it
     * is read across in {@link ShadowMaskedBloomPass#render} rather than aliased, which keeps this
     * pass from writing to a uniform the other one owns.
     *
     * @param {THREE.Vector2} resolution - Working resolution for the blur.
     * @param {number} strength - Bloom strength.
     * @param {number} radius - Bloom radius.
     * @param {number} threshold - Luminance above which a pixel blooms.
     * @param {BlackHoleLensPass} lensPass - The lens pass whose shadow uniforms to mask by.
     */
    constructor(resolution, strength, radius, threshold, lensPass) {
        super(resolution, strength, radius, threshold);

        // The base class holds the blend material's uniforms in `copyUniforms` and writes the
        // blurred texture into it every frame, so the replacement has to be reachable by that
        // name as well as carrying `tDiffuse` and `opacity` under the names CopyShader used.
        this.lensPass = lensPass;

        this.copyUniforms = {
            tDiffuse: { value: null },
            opacity: { value: this.copyUniforms.opacity.value },
            tScene: { value: null },
            tSceneDepth: lensPass.uniforms.tSceneDepth,
            uHasDepth: lensPass.uniforms.uHasDepth,
            uNear: lensPass.uniforms.uNear,
            uFar: lensPass.uniforms.uFar,
            uAspect: lensPass.uniforms.uAspect,
            uTanHalf: lensPass.uniforms.uTanHalf,
            uCount: lensPass.uniforms.uCount,
            uHoleDir: lensPass.uniforms.uHoleDir,
            uShadowAngle: lensPass.uniforms.uShadowAngle,
            uReachAngle: lensPass.uniforms.uReachAngle,
            uDepth: lensPass.uniforms.uDepth
        };

        this.blendMaterial.dispose();

        this.blendMaterial = new THREE.ShaderMaterial({
            uniforms: this.copyUniforms,
            vertexShader: CopyShader.vertexShader,
            fragmentShader,
            blending: THREE.AdditiveBlending,
            depthTest: false,
            depthWrite: false,
            transparent: true
        });
    }

    /**
     * Draws the bloom, first picking up the frame the lens pass read and dropping both of its
     * textures on a frame where they are no longer current.
     *
     * The colour and depth in the shared uniforms are those of the buffer
     * {@link BlackHoleLensPass} read, and they are put there by that pass as it draws. With no hole
     * on screen that pass is switched off entirely and nothing refreshes them, and the buffer it
     * last named may be the very one this blend is about to draw into — a texture cannot be sampled
     * and drawn into at the same time. There is nothing to mask on such a frame, `uCount` being
     * zero, so both are simply let go; the lens pass names them again on the next frame it runs.
     *
     * Where a hole *is* on screen the colour is the frame before the warp rather than the one being
     * bloomed, which costs nothing: the pass leaves the shadow and its rim alone and fades in from
     * there outwards, and outside the rim the mask is already open, so the two agree everywhere the
     * mask does anything at all.
     *
     * @param {THREE.WebGLRenderer} renderer - Renderer to draw with.
     * @param {THREE.WebGLRenderTarget} writeBuffer - Target the composer would have this draw into.
     * @param {THREE.WebGLRenderTarget} readBuffer - Target holding the frame to bloom.
     * @param {number} deltaTime - Frame time, passed through.
     * @param {boolean} maskActive - Whether a mask pass is active, passed through.
     * @returns {void}
     */
    render(renderer, writeBuffer, readBuffer, deltaTime, maskActive) {
        if (this.copyUniforms.uCount.value === 0) {
            this.copyUniforms.tScene.value = null;
            this.copyUniforms.tSceneDepth.value = null;
            this.copyUniforms.uHasDepth.value = 0.0;
        } else {
            this.copyUniforms.tScene.value = this.lensPass.uniforms.tDiffuse.value;
        }

        super.render(renderer, writeBuffer, readBuffer, deltaTime, maskActive);
    }
}

export default ShadowMaskedBloomPass;
