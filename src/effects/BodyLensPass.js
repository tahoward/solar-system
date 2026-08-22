import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { MAX_LENSES, NEAR_DEPTH_MARGIN } from './BlackHoleLensPass.js';
import { SKY_FADE_START, SKY_FADE_IMPACT } from './AccretionDisk.js';
import { SCENE } from '../constants.js';

/**
 * Scratch colour, reused to avoid per-frame allocation.
 *
 * @type {THREE.Color}
 */
const _clearColor = new THREE.Color();

/**
 * Widest the body layer's frustum is opened, as a multiple of the frame's own half-extent.
 *
 * The band exists because a gather can only fill a pixel from an image it has, and the deflection
 * asks for directions outside the frame: a hole off the side of it bends every pixel *towards* it,
 * which is out of the frame on that side. Drawn with the frame's own frustum the body layer has
 * nothing there, and what that produces is in the note above the shader. So the layer is drawn
 * wider than the frame and the frame's border stops being a boundary in it.
 *
 * Two is where it stops, and the reason is that the requirement is unbounded. The furthest source
 * any pixel asks for is one just outside the Einstein radius, whose light left from very nearly the
 * hole's own direction, so the band has to reach from the frame's edge to the hole — and the hole
 * can be anywhere. Bounded in practice by the Einstein radius itself, since inside it nothing is
 * drawn: the requirement peaks with the hole about one Einstein radius off the frame's edge, and
 * peaks at twice the frame at the couple of dozen horizon radii the hole's own moon is viewed from.
 * Closer in than about ten radii the Einstein radius is wide enough that two is not enough, and
 * there a source can still be asked for that was never drawn.
 *
 * @type {number}
 */
const MAX_GUARD = 2.0;

/**
 * Steps the guard band is quantised to.
 *
 * The band is measured per frame and the target resized to fit it, which is an allocation, so it is
 * not measured to the pixel: it is rounded up to a quarter of the frame and only let go of when a
 * whole step of slack has appeared. A hole drifting across a boundary would otherwise reallocate the
 * target on alternate frames for as long as it took to cross.
 *
 * @type {number}
 */
const GUARD_STEP = 0.25;

/**
 * Margin allowed on the measured requirement, as a fraction of how far it opens the band.
 *
 * The measurement walks the frame's border at a finite number of points and the requirement is not
 * smooth along it — it climbs steeply where the border passes near the Einstein radius — so the
 * sampled maximum can fall a little short of the true one, by under a percent at every angle checked.
 * A couple of percent covers that, and the quantisation covers far more.
 *
 * Applied to the opening rather than to the whole, which is the difference between a frame that wants
 * no band paying for none and paying for a quarter of one: scaling a requirement of exactly one puts
 * it above one, and above one rounds up to a step.
 *
 * @type {number}
 */
const GUARD_MARGIN = 1.02;

/**
 * Points taken along each edge of the frame when measuring the guard band.
 *
 * The border is where the requirement lives. A perspective frustum is a convex region of the sky,
 * so the arc from any pixel to the hole leaves it exactly once, and the pixel that overshoots
 * furthest is the one both nearest the hole and nearest the edge — which is a border pixel. A hole
 * *inside* the frame therefore needs no band at all: both ends of every arc are in the frame, so the
 * whole arc is.
 *
 * @type {number}
 */
const GUARD_SAMPLES = 64;

/**
 * Most pixels the body layer's target is given, before multisampling.
 *
 * The band costs its square in memory, and the target is multisampled half float with a depth
 * texture, so the full band on a large frame is a large allocation. This is the ceiling that keeps
 * it from being a silly one, and on a frame already past it the band is simply not opened.
 *
 * @type {number}
 */
const MAX_BODY_PIXELS = 12e6;

/**
 * The GLSL `smoothstep`, for the measurement to ease the deflection out exactly as the shader does.
 *
 * @param {number} edge0 - Where the ramp starts.
 * @param {number} edge1 - Where it finishes.
 * @param {number} x - Value to place on it.
 * @returns {number} Zero below the first edge, one above the second, smooth between.
 */
function smoothstep(edge0, edge1, x) {
    const t = Math.max(0.0, Math.min(1.0, (x - edge0) / (edge1 - edge0)));
    return t * t * (3.0 - 2.0 * t);
}

/**
 * Vertex shader for the composite: the full-screen quad.
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
 * Fragment shader for the composite: the bodies, bent, laid back over the frame they came out of.
 *
 * The deflection is the lens equation and nothing softened out of it. An image seen at angle `θ` from
 * the hole is light that left its source at `θ - ½θ_E²cot(θ/2)`, so the pixel at `θ` is filled from
 * that angle, and `θ_E` is the Einstein radius the hole genuinely has — {@link BlackHoleLensPass}
 * works it out and hands it over in `uEinsteinSq`, several horizon radii rather than the one-ish its
 * own frame warp can afford. Nothing else is imposed on top: no fade in from the shadow's rim, no cap
 * on the offset. Those exist in the frame warp because it has no image of what is behind the hole to
 * satisfy a real deflection with. Here the layer being warped holds the bodies over transparent black
 * — there is no sky beside a body to tear and no silhouette to smear, so the real mapping is simply
 * applied, and what it cannot supply comes out empty and shows the traced frame underneath.
 *
 * The cotangent is where this parts company with the thin lens, whose `θ_E² / θ` it agrees with to a
 * part in a thousand anywhere near the hole and disagrees with entirely away from it. A thin lens
 * assumes the observer is far enough from it that the light has finished bending before it arrives;
 * this observer is a couple of dozen horizon radii out, so at right angles to the hole only half the
 * bending has happened yet and directly behind it none has. That is why the deflection is worked out
 * from a *direction* rather than from a place on the screen: `θ` runs to a hundred and eighty degrees,
 * not to the frame's edge, and the pixels of a frame the hole has left behind are still bent.
 *
 * The mapping compresses hard near the shadow and stretches towards the Einstein radius, and that
 * stretch is the body being magnified. In the frame warp stretching is the enemy — a few pixels of a
 * bright disc edge pulled across a tenth of the screen is what banding is — but stretching a body
 * that has nothing beside it is the lensing. A body crossing behind the hole is drawn out along the
 * rim, and one passing dead centre is drawn from a source radius near zero, which is to say around the
 * whole of the Einstein radius at once: a ring.
 *
 * The one thing deliberately not drawn is the hole's *second* image. The equation has two solutions
 * for any source, and the second sits inside the Einstein radius on the opposite side of the hole —
 * which is a real image, and letting the offset carry the sign into it does produce it. It also
 * produces the moon twice, and that is not a bug in the arithmetic but the limit of the method: a
 * single sample per pixel cannot be two images at once, and which one a pixel gets is then decided by
 * which one the arithmetic happened to reach rather than by what is in front of what. So the inner
 * solution is dropped, and dropped honestly — inside the Einstein radius no primary image exists to
 * put there either, so nothing from the body layer is drawn at all and the traced gas, rim and shadow
 * beneath show through. What is given up is faint: second images are the demagnified ones, and this
 * annulus is largely behind the disc's own gas in any view where the hole is worth looking at.
 *
 * That leaves the deflection a plain function of the angle from the hole, and it is worth saying
 * why it is not also a function of how far off the source is, since the lens equation says it should
 * be — the deflection acts through `d_ls / d_s`, the fraction of the way from the hole to the source,
 * so a body just behind the hole should barely bend. It is taken as one, meaning every source
 * infinitely far behind the hole, because in this system that is what every source is: the hole sits
 * the better part of a thousand scene units out and is worth looking at from thousandths of one, so
 * every other body in the catalogue is at a fraction of one to within a rounding error. The exceptions
 * are the hole's own moons, a few dozen horizon radii out, and those are the bodies that never need it:
 * their meshes are hidden for the whole of their orbits and {@link AccretionDisk} traces the surfaces
 * from the geodesics themselves, `d_ls / d_s` and all. What is left of such a moon in this pass is its
 * marker, its label and its orbit line, which are annotation and drawn on the overlay layer this pass
 * does not touch. See {@link AccretionDisk#setCompanions} — including for what a moon past that
 * tracer's ceiling looks like here, which is the deflection being wrong by the better part of a
 * factor of ten and visibly so.
 *
 * Reading the fraction per pixel instead cannot be done, and it is worth recording why rather than
 * leaving it as merely unnecessary. The depth it needs is the depth of the *source*,
 * so it has to be solved for by iteration — and the iteration has no stable answer near a small body,
 * because the only pixel carrying a body's depth is the pixel the body is drawn in, which is the one
 * pixel the deflection moves off. The answers alternate between the body and the emptiness beside it.
 *
 * So the depth is used for the one thing a fetch of it settles: a body in front of the hole is not
 * the hole's to move, so a pixel whose own depth puts it in front of the hole skips that hole and is
 * left exactly where it is. In the frame warp that leaves a seam, because the sky around such a body
 * is warped while the body is not and the star field jumps across its limb. Here there is nothing
 * around it — this layer holds the bodies alone, and warping emptiness produces emptiness.
 *
 * A fetch of it, but not one fetch: this layer is multisampled and a resolved depth buffer holds one
 * arbitrary sample per pixel, so along a body's limb the depth is the body's or the sky's by chance.
 * Both of the tests take the nearest depth of a small neighbourhood instead, which is the answer that
 * leaves a body alone. See `nearestViewDepth`.
 *
 * What the depth cannot help with is the frame's own border, and that is what the guard band is for.
 * Drawn with the frame's own frustum, the body layer has nothing outside the frame, while a hole off
 * the side of it bends every pixel *towards* it — which is out of the frame on that side. So a strip
 * along that border has no source to be filled from, and not a thin one: fifty pixels with the hole a
 * hundred and forty degrees round, two hundred and forty at fifty-five degrees, four hundred and fifty
 * with the hole just off the edge. Cut at the boundary, that is a straight line across the frame with
 * every body, pinpoint and glare ending on it — clearest on a star's glare, which is wide and smooth
 * and so is visibly sliced — while the sky and the annotation run on through it, those being drawn in
 * the other two layers and never resampled.
 *
 * Nothing done to the strip is any good, because the strip is not where the problem is. Fading the
 * last of the content out over it trades the line for a band of dimming that is just as visible, and
 * is worse for being wrong in a second way: what it dims is content that *was* available. Extending
 * the border's last row along the deflection instead — which is what clamping the coordinate does, and
 * costs nothing — is right where the missing content is smooth, a glare's outer halo continuing into
 * the strip almost exactly as the true one would; and it is badly wrong where the content has an edge,
 * a planet's limb at the border coming out as a banana of smeared cloud bands reaching to the corner.
 *
 * So the content is supplied instead: the layer is drawn through a frustum wider than the frame's, by
 * `uGuard`, into a target larger by the same factor so that the density is the frame's own. `vUv` is
 * then no longer this layer's coordinate — the frame occupies the middle `1/uGuard` of it, which is
 * what `destUv` is — and a source the deflection reaches for outside the frame is content that was
 * drawn. Widening the frustum is also what gets it drawn: culling is against the same matrix, so a
 * body just off the frame's edge is no longer thrown away before it can be bent into view. See
 * {@link BodyLensPass#render} for the widening and {@link BodyLensPass~MAX_GUARD} for where it stops
 * and what is still given up past there.
 *
 * There is a matching test on the source, and it is the artefact the frame warp has to live with. The
 * pixel a warped one is filled from may itself be a body in front of the hole, which is how a body's
 * colour comes to smear a few pixels outwards into the sky it stands against. Tested here, the smear
 * is simply dropped, and dropping it costs nothing: what shows instead is the gas and the sky of the
 * layer underneath, still exactly as traced. In the frame warp the same test would punch a hole in
 * the picture.
 *
 * The colour is composited premultiplied over the frame, which is the form the bodies were rendered
 * in: drawn over transparent black, three's ordinary blending accumulates `α·c` in the colour
 * channels. Depth is written as well as tested, and from the *source* pixel, so the frame's depth
 * ends up describing the bodies where they are now drawn. That is not a nicety — everything after
 * this reads that depth. The bloom mask uses it to tell a body in front of a shadow from the shadow
 * itself, and the full-frame lens pass uses it to leave near bodies alone.
 *
 * An empty pixel of the body layer carries no colour and the far-plane depth, so it changes nothing
 * it is composited over and loses the depth test against anything at all — which is why nothing has
 * to be done about the vast majority of the screen.
 *
 * @type {string}
 */
const fragmentShader = `
#define MAX_LENSES ${MAX_LENSES}
#define NEAR_DEPTH_MARGIN ${NEAR_DEPTH_MARGIN.toFixed(3)}
#define SKY_FADE_START ${SKY_FADE_START.toFixed(4)}
#define SKY_FADE_IMPACT ${SKY_FADE_IMPACT.toFixed(1)}

uniform sampler2D tBody;
uniform sampler2D tBodyDepth;
uniform float uNear;
uniform float uFar;
uniform float uAspect;
uniform float uTanHalf;
uniform float uGuard;
uniform int uCount;
uniform vec3 uHoleDir[MAX_LENSES];
uniform float uShadowAngle[MAX_LENSES];
uniform float uEinsteinSq[MAX_LENSES];
uniform float uImpactRadii[MAX_LENSES];
uniform float uDepth[MAX_LENSES];
uniform vec2 uTexel;

varying vec2 vUv;

// Distance along the view axis, undoing the perspective divide the buffer was written with, so an
// empty pixel comes back as the far plane and is behind every hole.
float viewDepth(float encoded) {
    return (uNear * uFar) / max(uFar - (uFar - uNear) * encoded, 1e-9);
}

// The nearest depth this pixel or any of its four neighbours holds.
//
// A single fetch is not usable for the tests below, and the reason is the body layer's
// multisampling. Resolving a multisampled colour buffer averages the samples, which is the point of
// it, but resolving a depth buffer cannot average — a depth halfway between a body and the sky is a
// place nothing is — so it takes one sample of the several and which one is the driver's business.
// Along a body's limb, then, where some samples are the body and some are the sky, the depth that
// comes back is one or the other unpredictably, pixel by pixel. Both tests read it to ask whether
// something stands in front of a hole, and a limb pixel that answers with the far plane is a body
// pixel claiming to be sky.
//
// So the neighbourhood's nearest is taken instead, which is the conservative answer for both of the
// tests: nearest makes a pixel more likely to be judged in front of the hole, and in front is the
// answer that leaves a body where it is and refuses to smear it. One texel is enough, an
// antialiased edge being one pixel wide, and a limb pixel always has an interior neighbour.
float nearestViewDepth(vec2 uv) {
    float nearest = viewDepth(texture2D(tBodyDepth, uv).x);
    nearest = min(nearest, viewDepth(texture2D(tBodyDepth, uv + vec2(uTexel.x, 0.0)).x));
    nearest = min(nearest, viewDepth(texture2D(tBodyDepth, uv - vec2(uTexel.x, 0.0)).x));
    nearest = min(nearest, viewDepth(texture2D(tBodyDepth, uv + vec2(0.0, uTexel.y)).x));
    nearest = min(nearest, viewDepth(texture2D(tBodyDepth, uv - vec2(0.0, uTexel.y)).x));
    return nearest;
}

void main() {
    vec2 aspect = vec2(uAspect, 1.0);

    // The direction this pixel looks along, in the camera's own space. Everything below is done to
    // directions rather than to screen positions, which is what lets a hole off the side of the frame
    // — or behind it — go on bending what is on it.
    vec3 look = normalize(vec3((vUv * 2.0 - 1.0) * uTanHalf * aspect, -1.0));

    // The turn to apply, summed as a vector in the sky's tangent plane at this pixel. Exact for one
    // hole, and a small-angle sum for several.
    vec3 turn = vec3(0.0);

    // This pixel's own place in the body layer, which is not vUv: the layer is drawn through a frustum
    // wider than the frame by uGuard, so the frame sits in the middle of it and everything read out of
    // it is addressed through this. Only the depth wants it here — the colour is read at the source.
    vec2 destUv = (vUv - 0.5) / uGuard + 0.5;

    float destDepth = nearestViewDepth(destUv);

    // Depth of the nearest hole in front of the camera that bends this pixel, or zero if none does. A
    // hole behind the camera has nothing in front of it to find and is left out of this.
    float bentBy = 0.0;

    // Set where this pixel is inside a hole's Einstein radius, which is where only that hole's second
    // image of anything could land and this pass draws no second images.
    bool inner = false;

    for (int i = 0; i < MAX_LENSES; i++) {
        if (i >= uCount) break;

        // Zero where the hole's own disc is not tracing the sky, in which case the whole frame is
        // warped later and the bodies with it; the two are complements. Also zero where the hole has
        // stopped moving anything by as much as half a pixel.
        if (uEinsteinSq[i] <= 0.0) continue;

        // Standing in front of this hole, so this hole does not bend it. Tested before the Einstein
        // radius below, because a body in front of a hole is drawn wherever it is, including there.
        //
        // The margin is added rather than subtracted, which is to say the hole gives up a band of
        // depth just *behind* itself as well, and that is deliberate twice over. It is where this
        // pass is at its least defensible: the deflection here is scaled for a source infinitely far
        // behind the hole, and for a source two percent of the way further out than the hole itself
        // the true distance ratio is a fiftieth of that, so bending it by the full amount is fifty
        // times the right answer while not bending it at all is off by one part in fifty of a very
        // small number. Not bending is the smaller error, and it is the one that cannot flicker,
        // since a body wandering across the plane a pixel at a time would otherwise be picked up and
        // dropped between frames.
        //
        // And nothing is being given away in practice. The only bodies that ever reach this band are
        // the hole's own moons, and their meshes are hidden for the whole of their orbits while
        // {@link AccretionDisk} traces the surfaces along the actual geodesics; see
        // {@link AccretionDisk#setCompanions}. There is no mesh in this layer for the band to fail to
        // bend — unless a hole has more moons than that tracer has slots, which it warns about.
        if (destDepth < uDepth[i] * (1.0 + NEAR_DEPTH_MARGIN)) continue;

        // How far round from the hole this pixel is, and which way on the sky the hole lies from it.
        float cosTheta = dot(look, uHoleDir[i]);
        vec3 sideways = uHoleDir[i] - cosTheta * look;
        float sinTheta = length(sideways);

        // Dead on the hole's direction, or dead opposite it. Neither has a way round to turn towards,
        // and neither needs one: the first is inside the silhouette and the second is not bent at all.
        if (sinTheta < 1e-6) continue;

        // The impact parameter of the ray that arrives here, in horizon radii, which is what the
        // tracer fades the sky out over. Eased out over the same band, so that the bodies and the
        // stars behind them stop being bent together and there is no radius to see the edge by.
        float impact = uImpactRadii[i] * sinTheta;
        if (impact >= SKY_FADE_IMPACT) continue;

        float einsteinSq = uEinsteinSq[i] * (1.0 - smoothstep(
            SKY_FADE_IMPACT * SKY_FADE_START, SKY_FADE_IMPACT, impact));

        float theta = atan(sinTheta, cosTheta);

        // Inside the shadow, where the occluder is about to hide whatever is composited anyway. The
        // silhouette is a cone of directions and theta is the angle to its axis, so this is the
        // definition of being inside it rather than a projection of it — which is what makes it right
        // at any angle, including for a hole the frame has no place for at all. Before the Einstein
        // radius below, since the silhouette is inside that annulus and the frame beneath is drawn.
        if (theta <= uShadowAngle[i]) continue;

        // The lens equation, for an observer at a finite distance from the lens: the image seen at
        // theta from the hole is light that left its source at theta - bend, and the bend is the part
        // of the deflection the light had suffered by the time it got here. That part is
        // 0.5 einstein^2 cot(theta/2), which is the familiar einstein^2 / theta close in to the hole
        // and half of it out at right angles, falling away to nothing directly behind the camera.
        //
        // Written this way rather than as the thin-lens einstein^2 / theta because the observer here
        // is a couple of dozen horizon radii from the hole, not the cosmological distance that form
        // assumes, and the difference is not a refinement: a hole orbiting the camera would keep the
        // full deflection right up to the moment it passed the ninety degree line and then lose all of
        // it at once, snapping every body, pinpoint and glare in the frame across several percent of
        // its width and snapping them back on the way round. Cotangent has no such edge in it, and it
        // is also what the tracer does, which integrates the path it actually has rather than the
        // whole hyperbola.
        float bend = 0.5 * einsteinSq * (1.0 + cosTheta) / sinTheta;

        // Which is inside the Einstein radius once the bend exceeds the angle itself, and there the
        // source would come out on the far side of the hole — the second image. Nothing is drawn there
        // rather than that.
        if (bend >= theta) {
            inner = true;
            continue;
        }

        turn += (sideways / sinTheta) * bend;

        if (uDepth[i] > 0.0) bentBy = bentBy > 0.0 ? min(bentBy, uDepth[i]) : uDepth[i];
    }

    if (inner) discard;

    // The direction the light came from, which is this pixel's own direction turned towards the holes
    // by what they bent it. A rotation rather than an offset, so that it stays a direction however far
    // round the sky it goes.
    float amount = length(turn);
    vec3 source = amount > 1e-9
        ? normalize(look * cos(amount) + (turn / amount) * sin(amount))
        : look;

    // Turned round behind the camera, so the frame holds no image of what is there.
    if (source.z > -1e-6) discard;

    // Where that direction landed in the body layer, whose frustum is the frame's opened out by
    // uGuard — so a source outside the frame is inside this, which is the whole point of the band.
    vec2 sampleUv = (source.xy / (-source.z)) / (uTanHalf * uGuard * aspect) * 0.5 + 0.5;

    // Outside the band as well, which is a source that was genuinely never drawn: the band is
    // measured each frame for the deflection this frame asks for, so this is reached only where the
    // requirement was past the ceiling on it. The frame underneath has the traced sky and the gas at
    // this pixel and they are right; leave them.
    if (sampleUv.x < 0.0 || sampleUv.x > 1.0 || sampleUv.y < 0.0 || sampleUv.y > 1.0) discard;

    float encoded = texture2D(tBodyDepth, sampleUv).x;

    // What this pixel would be filled from is in front of the hole doing the bending, so it is not
    // this hole's image to move: leave the frame underneath showing rather than smear a near body
    // outwards over the sky. Read across the neighbourhood, because a body's own limb is where this
    // is decided and a limb is exactly where one fetch cannot be trusted — see nearestViewDepth.
    // Untrusted, the antialiased edge of the hole's own moon gets through as a faint crescent a
    // hundred pixels out from a moon that is itself correctly left alone: two moons, one of them
    // transparent, at every angle.
    if (bentBy > 0.0 && nearestViewDepth(sampleUv) < bentBy * (1.0 + NEAR_DEPTH_MARGIN)) discard;

    gl_FragColor = texture2D(tBody, sampleUv);
    gl_FragDepthEXT = encoded;
}
`;

/**
 * Bends the bodies around a black hole, by drawing them on a layer of their own.
 *
 * A hole whose accretion disc traces the sky bends everything the tracer draws — the gas, the
 * silhouette, the star field behind it — because it follows the photon paths for each of them. What
 * it does not draw, it cannot bend, and what it does not draw is every body in the system. Left to the
 * tracer alone, a planet passing behind a hole crosses it undistorted, a star's glare sweeps over it
 * unbroken, and a distant body's pinpoint goes straight through the middle of the shadow: the sky
 * curves and the things in it do not.
 *
 * {@link BlackHoleLensPass} cannot fix that where a disc is tracing, and for two reasons rather than
 * one. It works on a frame in which the sky has already been bent, so applying its warp there would
 * bend the sky twice to bend the bodies once. And its warp would be far too weak to show even if it
 * could be aimed at the bodies alone — a frame warp cannot show what is behind the hole, having no
 * image of it, so its deflection is detuned until the frame can satisfy it, to about a twenty-fifth of
 * the real one over a thirtieth of the real range. Bent by those numbers, the bodies would move by a
 * fraction of a pixel while the sky swept round the hole.
 *
 * Both reasons are the same reason, and it is that a finished frame is the wrong thing to be warping.
 * So the frame is not finished when it is warped: the hole's own drawing goes in one layer, the
 * scene's annotation in another, the bodies in what is left, one warp is applied to the bodies alone,
 * and the three are composited back together. See {@link SCENE.UNLENSED_LAYER} with
 * {@link BlackHoleEffects.markUnlensed}, and {@link SCENE.OVERLAY_LAYER} with
 * {@link SceneManager#markOverlay}, for the divisions — which are by object and permanent, so
 * nothing has to be sorted per frame.
 *
 * Annotation is held out because it is drawn along straight lines to where a body is, not along the
 * paths light takes to it, and because it writes no depth, so this pass cannot tell where it is and
 * bends it as though it were infinitely far away. Bent that way it comes off its own body: a marker's
 * pin and the orbit line under it are displaced together, by the full deflection, while the body they
 * belong to — which does write depth, and in front of a hole is left where it is — stays put. The
 * marker artwork has a disc at its centre the size of a small moon, so that reads as a second,
 * fainter moon sitting on the orbit line beside the real one, at every angle. Drawn unwarped it stays
 * where its body is, which is the only place a label can honestly be.
 *
 * That is what makes the warp *correct* rather than merely applied, and what lets it be the real one.
 * A screen-space warp can only fill a pixel from another pixel of the same image, so it lives or dies
 * on what is in the image next to the thing being moved. Next to a body in this layer is nothing at
 * all — no sky to be dragged with it, no sky to be left torn behind it — and the space a body is
 * bent out of shows the gas and the star field that are genuinely behind it, because those were drawn
 * into the other target and were never touched. So there is nothing left for the deflection to
 * damage, and it is applied as the lens equation gives it: full strength, out to where the tracer
 * stops bending the sky, and negative inside the Einstein radius, which is the hole's second image of
 * whatever is behind it. The shader above is where all of that is.
 *
 * The cost is a second full render of the scene per frame and a second target — a little larger than
 * the frame, for the reason the shader's note gives — so the pass runs only on the frames that need
 * it: {@link BloomManager} switches it on when a hole is actually tracing on screen, and switches the
 * ordinary render pass off in the same breath, since this one draws both halves itself.
 *
 * Three things are knowingly given up, the first two of them consequences of transparency being
 * resolved within a layer rather than across the two.
 *
 * How much of the frame underneath a pixel covers is whatever alpha the body layer accumulated, and
 * three's ordinary blending understates that: a semi-transparent surface drawn over an opaque one
 * leaves the pair short of opaque, so the gas and the sky show faintly through a planet's clouds
 * where they should not. Bodies themselves are exact, an opaque surface being alpha one, and so are
 * the atmospheres — {@link AtmosphereShaderMaterial} already blends its alpha separately and
 * correctly, which is what makes it work here for free. It is the materials that do not, clouds and
 * rings, that fall short, and never by more than a quarter. A sprite that blends additively — a
 * star's glare above all — is the same thing from the other side: it accumulates alpha as it
 * accumulates colour, so composited back it dims what it crosses slightly instead of only adding to
 * it. Both errors are small and neither can over-occlude, which is the direction to be wrong in.
 *
 * What is drawn without writing depth and is *not* annotation — a star's glare, a body's pinpoint —
 * has no depth of its own in this layer, so it is composited at the far plane: bent at full strength,
 * and losing the depth test wherever the shadow's occluder covers the screen. Both of those are what
 * is wanted in the pinpoint's case, since a pinpoint stands in for a body too small to draw and
 * so should swing around a hole and be swallowed by it. But a pinpoint's body is not usually
 * infinitely far behind the hole, so the amount it swings by is an overstatement, and it is drawn
 * next to a mesh that is bent correctly or not at all. Where both are visible at once they separate.
 *
 * Which normally they are not, a pinpoint sitting at its body's own centre and so behind its near
 * surface. The exceptions are the bodies whose meshes are deliberately hidden — the hole's moons, traced
 * rather than drawn for the whole of their orbits — where hiding a mesh uncovers its pinpoint, bent as
 * though at infinity a long way from the surface being traced along the real geodesics. So
 * {@link AccretionDisk#setCompanion} hides the pinpoint along with the mesh, which is the honest
 * reading of what it is doing: it has taken over drawing that body, stand-in and all.
 *
 * The remedy would be the body's own depth rather than the pixel's, which is not something a gather
 * can have: the depth wanted is the *source's*, so it would have to be iterated, and beside a body
 * the only pixel carrying that depth is the one the deflection moves off. So the pinpoints are left
 * bent as though at infinity, which is right for the distant bodies they exist for.
 */
class BodyLensPass extends Pass {
    /**
     * Builds the pass and the target the bodies are drawn into.
     *
     * The target matches the composer's own — half float, so the linear values the bloom threshold
     * and the tone mapping are stated against survive it, and multisampled, so the limbs and the
     * orbit lines are no more jagged for having been drawn somewhere else. Its depth texture is
     * what both of the shader's depth tests read, and what the composite writes back into the
     * frame. It is created at one pixel square because {@link EffectComposer#addPass} sizes every
     * pass as it is added — and it is larger than the frame whenever the guard band is open, at the
     * frame's own pixel density; see {@link BodyLensPass#setSize}.
     *
     * The geometry uniforms are the lens pass's own objects, not copies, so a hole's place on screen
     * is measured once per frame for both passes; see {@link BlackHoleLensPass#update}. The band's
     * width is this pass's own, since it is this pass's frustum that is opened by it.
     *
     * Starts disabled, and stays that way until a frame has a tracing hole in it.
     *
     * @param {THREE.Scene} scene - Scene to render, both halves of it.
     * @param {THREE.PerspectiveCamera} camera - Camera to render from. Its layer mask is changed
     *   for the two renders and put back afterwards.
     * @param {BlackHoleLensPass} lensPass - The lens pass whose hole geometry to bend by.
     */
    constructor(scene, camera, lensPass) {
        super();

        this.scene = scene;
        this.camera = camera;
        this.lensPass = lensPass;

        this.needsSwap = false;
        this.enabled = false;

        // The frame's size, kept because the target's is the frame's times the band and the band
        // changes without the frame's doing, and the band itself, which starts shut.
        this.frameWidth = 1;
        this.frameHeight = 1;
        this.guard = 1.0;

        this.bodyTarget = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
        this.bodyTarget.samples = SCENE.MSAA_SAMPLES;
        this.bodyTarget.depthTexture = new THREE.DepthTexture(1, 1);
        this.bodyTarget.texture.name = 'BodyLensPass.bodies';

        this.uniforms = {
            tBody: { value: this.bodyTarget.texture },
            tBodyDepth: { value: this.bodyTarget.depthTexture },
            uNear: lensPass.uniforms.uNear,
            uFar: lensPass.uniforms.uFar,
            uAspect: lensPass.uniforms.uAspect,
            uTanHalf: lensPass.uniforms.uTanHalf,
            uGuard: { value: 1.0 },
            uCount: lensPass.uniforms.uCount,
            uHoleDir: lensPass.uniforms.uHoleDir,
            uShadowAngle: lensPass.uniforms.uShadowAngle,
            uEinsteinSq: lensPass.uniforms.uEinsteinSq,
            uImpactRadii: lensPass.uniforms.uImpactRadii,
            uDepth: lensPass.uniforms.uDepth,
            uTexel: { value: new THREE.Vector2(1, 1) }
        };

        // Source-over with a premultiplied source, which is what the body layer holds, and depth
        // both tested and written so that the shadow's occluder hides what is behind it and the
        // frame's depth ends up describing the bodies. The test has to admit equality: everything
        // with no depth of its own arrives at the far plane, and against an empty frame — also the
        // far plane — a strict test would drop the lot.
        this.material = new THREE.ShaderMaterial({
            uniforms: this.uniforms,
            vertexShader,
            fragmentShader,
            transparent: true,
            blending: THREE.CustomBlending,
            blendEquation: THREE.AddEquation,
            blendSrc: THREE.OneFactor,
            blendDst: THREE.OneMinusSrcAlphaFactor,
            depthTest: true,
            depthWrite: true,
            depthFunc: THREE.LessEqualDepth,
            toneMapped: false
        });

        this.fsQuad = new FullScreenQuad(this.material);
    }

    /**
     * Draws the frame in three parts and puts them back together with one of them bent.
     *
     * The bodies go first, into their own target, cleared to transparent black — with the scene's
     * background dropped, since a sky drawn there would make the layer opaque and there would be
     * nothing to composite over. Then the hole's own drawing and the sky, into the buffer the rest
     * of the chain works on, cleared and rendered exactly as {@link RenderPass} would have. Then the
     * composite, over the top of that same buffer. Then the annotation, unbent, over the top of
     * that: last, so that it is drawn against the depth the composite has just written and is
     * occluded by the bodies and the shadow exactly as it would be in an ordinary render.
     *
     * Which layers each render sees is a mask rather than a layer, so the split is stated once and
     * in one direction: the hole's layer and the annotation layer are the ones subtracted, and
     * anything anyone adds on any other layer later is drawn — and bent — with the bodies.
     *
     * `autoClear` is switched off for the duration and every clear done explicitly, as every pass in
     * the composer does, since `render` would otherwise wipe the buffer the composite is being laid
     * over. The renderer's clear colour is put back before the second render rather than after the
     * pass, because that render is meant to be the ordinary one and the ordinary one uses it.
     *
     * Switching `autoClear` off is not enough to protect the frame, though, and this is the trap here:
     * a scene background is not drawn by the clear but by a full-screen mesh at the head of every
     * render, and it ignores both `autoClear` and the depth buffer. So the background has to be
     * dropped for the first and third renders and not merely left unused — with it set, the third
     * would repaint the sky over the whole finished frame, and everything in the frame would vanish
     * behind stars.
     *
     * The first render is also the widened one, and the camera is put back before the other two, which
     * are the ordinary frame and must be the frame. Widening is done with `zoom` rather than `fov`
     * because zoom divides both of the frustum's half-extents by the one number, so the band is the
     * same fraction of the frame on both axes and the aspect the composite reprojects against is still
     * the frame's. Everything sized in world units — a glare's quad, a pinpoint's sprite, a line's
     * width — was worked out earlier in the frame from the camera's real fov and is left alone by
     * this, and comes out the same number of pixels in a target whose density is the frame's. What the
     * widening does change, deliberately, is culling: the wider frustum is the one the scene is culled
     * against, so a body just off the frame's edge survives to be bent into it.
     *
     * @param {THREE.WebGLRenderer} renderer - Renderer to draw with.
     * @param {THREE.WebGLRenderTarget} writeBuffer - Unused; this pass does not swap.
     * @param {THREE.WebGLRenderTarget} readBuffer - Target the frame is assembled in.
     * @returns {void}
     */
    render(renderer, writeBuffer, readBuffer) {
        const target = this.renderToScreen ? null : readBuffer;

        const oldAutoClear = renderer.autoClear;
        const oldLayerMask = this.camera.layers.mask;
        const oldBackground = this.scene.background;
        const oldClearAlpha = renderer.getClearAlpha();

        renderer.getClearColor(_clearColor);
        renderer.autoClear = false;

        const holeLayer = 1 << SCENE.UNLENSED_LAYER;
        const overlayLayer = 1 << SCENE.OVERLAY_LAYER;

        this.camera.layers.mask = oldLayerMask & ~(holeLayer | overlayLayer);
        this.scene.background = null;

        const oldZoom = this.camera.zoom;
        this.#openGuard();
        this.camera.zoom = oldZoom / this.guard;
        this.camera.updateProjectionMatrix();

        renderer.setClearColor(0x000000, 0.0);
        renderer.setRenderTarget(this.bodyTarget);
        renderer.clear();
        renderer.render(this.scene, this.camera);

        this.camera.zoom = oldZoom;
        this.camera.updateProjectionMatrix();

        this.camera.layers.mask = oldLayerMask & holeLayer;
        this.scene.background = oldBackground;

        renderer.setClearColor(_clearColor, oldClearAlpha);
        renderer.setRenderTarget(target);
        renderer.clear(renderer.autoClearColor, renderer.autoClearDepth, renderer.autoClearStencil);
        renderer.render(this.scene, this.camera);

        renderer.setRenderTarget(target);
        this.fsQuad.render(renderer);

        this.camera.layers.mask = oldLayerMask & overlayLayer;
        this.scene.background = null;
        renderer.render(this.scene, this.camera);

        this.camera.layers.mask = oldLayerMask;
        this.scene.background = oldBackground;
        renderer.autoClear = oldAutoClear;
    }

    /**
     * Takes the frame's size, and sizes the body layer's target from it and the guard band.
     *
     * The target is the frame times the band on both axes, which keeps the band at the frame's own
     * pixel density: the band's whole purpose is to hold content the composite will magnify along a
     * border, and content stretched from a target of the frame's *size* would be softer for it,
     * visibly so at the wide end where the band is holding half of what is drawn.
     *
     * The depth texture's own dimensions are left to the renderer, which corrects them against the
     * target's on the next bind — the same thing the composer's targets rely on.
     *
     * @param {number} width - New width in pixels.
     * @param {number} height - New height in pixels.
     * @returns {void}
     */
    setSize(width, height) {
        this.frameWidth = Math.max(width, 1);
        this.frameHeight = Math.max(height, 1);

        const bodyWidth = Math.ceil(this.frameWidth * this.guard);
        const bodyHeight = Math.ceil(this.frameHeight * this.guard);

        this.bodyTarget.setSize(bodyWidth, bodyHeight);
        this.uniforms.uTexel.value.set(1 / bodyWidth, 1 / bodyHeight);
        this.uniforms.uGuard.value = this.guard;
    }

    /**
     * Opens the guard band to what this frame's holes ask for, resizing the target if it has moved.
     *
     * Grows at once and gives back slowly: a band a step wider than necessary costs some memory and
     * nothing else, while a band a pixel too narrow is the straight edge across the frame that the
     * whole thing exists to prevent. So the requirement is rounded up to a quarter of the frame, and
     * given back only once it has dropped two steps below what is open — which leaves a step of slack
     * either side of every boundary, and it is the slack that matters rather than the step: without it
     * a hole drifting across a boundary would reallocate the target on alternate frames for as long as
     * it took to cross.
     *
     * The ceiling is two frames wide or whatever {@link BodyLensPass~MAX_BODY_PIXELS} allows,
     * whichever is smaller, and it can bind: the requirement is unbounded close in to a hole. Past it
     * the composite has nothing at some pixels and drops them, which is the artefact the band exists
     * to prevent — but on a border that has been pushed off the frame rather than the frame's own, and
     * it takes a hole a few horizon radii away to reach it.
     *
     * @returns {void}
     */
    #openGuard() {
        const ceiling = Math.max(1.0, Math.min(MAX_GUARD,
            Math.sqrt(MAX_BODY_PIXELS / (this.frameWidth * this.frameHeight))));
        const needed = Math.min(1.0 + (this.#requiredGuard() - 1.0) * GUARD_MARGIN, ceiling);

        if (needed <= this.guard && needed > this.guard - 2.0 * GUARD_STEP) return;

        this.guard = Math.min(ceiling, Math.ceil(needed / GUARD_STEP) * GUARD_STEP);
        this.setSize(this.frameWidth, this.frameHeight);
    }

    /**
     * How much wider than the frame the body layer has to be drawn for this frame's holes.
     *
     * This is the shader's own mapping, walked along the frame's border: the furthest outside the
     * frame that any pixel's source lands, in units of the frame's half-extent, which is the factor
     * that brings that source inside the layer. One is the answer whenever no hole moves anything off
     * the frame, and it is the answer for a hole *inside* the frame however violent the lensing is —
     * see {@link BodyLensPass~GUARD_SAMPLES} for why the border settles it.
     *
     * The two tests the shader makes that this does not are both depth tests, and both only ever stop
     * a pixel being bent. Left out, the measurement can only come out wide, which is the harmless
     * direction: a band nothing turns out to need costs a target that is bigger than it had to be.
     *
     * @returns {number} At least one, at most whatever the caller's ceiling allows.
     */
    #requiredGuard() {
        const count = this.uniforms.uCount.value;
        if (count <= 0) return 1.0;

        const tanHalfY = this.uniforms.uTanHalf.value;
        const tanHalfX = tanHalfY * this.uniforms.uAspect.value;

        let guard = 1.0;

        for (let i = 0; i < count; i++) {
            if (this.uniforms.uEinsteinSq.value[i] <= 0.0) continue;

            for (let s = 0; s < GUARD_SAMPLES; s++) {
                const t = s / (GUARD_SAMPLES - 1);

                guard = Math.max(guard,
                    this.#sourceExtent(t, 0.0, i, tanHalfX, tanHalfY),
                    this.#sourceExtent(t, 1.0, i, tanHalfX, tanHalfY),
                    this.#sourceExtent(0.0, t, i, tanHalfX, tanHalfY),
                    this.#sourceExtent(1.0, t, i, tanHalfX, tanHalfY));
            }
        }

        return guard;
    }

    /**
     * Where one pixel is filled from, as a multiple of the frame's half-extent.
     *
     * The arithmetic is the shader's, line for line, and has to stay that way: this is the number the
     * target is sized by, so a mapping here that is milder than the one the shader applies is a strip
     * of the shader's output with nothing in it. Zero for a pixel the shader draws nothing at.
     *
     * @param {number} px - Horizontal place in the frame, zero to one.
     * @param {number} py - Vertical place in the frame, zero to one.
     * @param {number} i - Lens slot to bend by.
     * @param {number} tanHalfX - Tangent of the frame's horizontal half-angle.
     * @param {number} tanHalfY - Tangent of the frame's vertical half-angle.
     * @returns {number} One where the source is the frame's own corner, more outside it, zero where
     *   this pixel asks for nothing.
     */
    #sourceExtent(px, py, i, tanHalfX, tanHalfY) {
        const hole = this.uniforms.uHoleDir.value[i];

        // The direction this pixel looks along, as the shader normalises it.
        const length = Math.hypot((px * 2.0 - 1.0) * tanHalfX, (py * 2.0 - 1.0) * tanHalfY, 1.0);
        const lookX = (px * 2.0 - 1.0) * tanHalfX / length;
        const lookY = (py * 2.0 - 1.0) * tanHalfY / length;
        const lookZ = -1.0 / length;

        const cosTheta = lookX * hole.x + lookY * hole.y + lookZ * hole.z;
        const sidewaysX = hole.x - cosTheta * lookX;
        const sidewaysY = hole.y - cosTheta * lookY;
        const sidewaysZ = hole.z - cosTheta * lookZ;
        const sinTheta = Math.hypot(sidewaysX, sidewaysY, sidewaysZ);
        if (sinTheta < 1e-6) return 0.0;

        const impact = this.uniforms.uImpactRadii.value[i] * sinTheta;
        if (impact >= SKY_FADE_IMPACT) return 0.0;

        const einsteinSq = this.uniforms.uEinsteinSq.value[i] * (1.0 - smoothstep(
            SKY_FADE_IMPACT * SKY_FADE_START, SKY_FADE_IMPACT, impact));

        const theta = Math.atan2(sinTheta, cosTheta);
        if (theta <= this.uniforms.uShadowAngle.value[i]) return 0.0;

        const bend = 0.5 * einsteinSq * (1.0 + cosTheta) / sinTheta;
        if (bend >= theta) return 0.0;

        // The rotation, and the perspective divide the composite reprojects it with.
        const turned = Math.sin(bend) / sinTheta;
        const carry = Math.cos(bend);
        const sourceX = lookX * carry + sidewaysX * turned;
        const sourceY = lookY * carry + sidewaysY * turned;
        const sourceZ = lookZ * carry + sidewaysZ * turned;
        if (sourceZ > -1e-6) return 0.0;

        return Math.max(Math.abs(sourceX / sourceZ) / tanHalfX,
                        Math.abs(sourceY / sourceZ) / tanHalfY);
    }

    /**
     * Releases the target, its depth texture and the composite's material.
     *
     * Called by {@link BloomManager#dispose}, since {@link EffectComposer#dispose} frees its own
     * targets and nothing belonging to the passes in it.
     *
     * @returns {void}
     */
    dispose() {
        this.bodyTarget.depthTexture.dispose();
        this.bodyTarget.dispose();
        this.material.dispose();
        this.fsQuad.dispose();
    }
}

export default BodyLensPass;
