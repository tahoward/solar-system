import * as THREE from 'three';
import AccretionDisk, {
    BACKGROUND_RENDER_ORDER, SHADOW_HORIZON_RADII, shadowApparentSine, shadowApparentTangent
} from './AccretionDisk.js';
import BlackHolePhotonRing from './BlackHolePhotonRing.js';
import BlackHoleShaderMaterial from '../shaders/BlackHoleShaderMaterial.js';
import { SCENE } from '../constants.js';
import { log } from '../utils/Logger.js';

/**
 * Radius of the innermost stable circular orbit, in Schwarzschild radii.
 *
 * Inside three Schwarzschild radii there is no stable orbit at all: matter spirals in rather
 * than circling, so there is no disc to draw. Which is why an accretion disc has a sharp inner
 * edge instead of thinning out towards the hole, and why this is the default for one.
 *
 * @type {number}
 */
const ISCO_HORIZON_RADII = 3.0;

/**
 * Where the hole's own horizon sphere is drawn.
 *
 * The sphere is two and a half times smaller than the shadow and lies entirely inside it, so it
 * should contribute nothing to the picture; it is kept for the things that need the hole to be an
 * object at all — the click target, the focus, the distance at which it becomes a pinpoint. See
 * {@link BlackHoleShaderMaterial}, which writes no depth for exactly that reason, so the sphere
 * cannot cut anything out of the shadow it sits in.
 *
 * Not writing depth is not enough on its own, because it still paints. At the default order the
 * sphere would be drawn with the bodies, and where the disc is tracing the sky the disc is drawn as
 * *background*, before them — a black ball on top of the traced gas, putting a hard-edged disc of
 * nothing at one horizon radius over the middle of the silhouette and over the near side of the
 * plume crossing it. Drawn here it is under the disc in either of the disc's two modes: before the
 * background billboard, and long before the overlay one. What covers it is then the shadow's own
 * occluder, which is black as well and wider on screen, so nothing shows either way.
 *
 * @type {number}
 */
const HORIZON_RENDER_ORDER = BACKGROUND_RENDER_ORDER - 2;

/**
 * Segments around the shadow's occluder.
 *
 * The occluder is normally never seen — the disc draws the silhouette over the top of it — so
 * this only has to be fine enough that its edge is not what decides where the shadow ends if
 * ever it is: with the disc switched off it is the only shadow there is, and a coarse circle
 * would show as a polygon. Inscribed rather than circumscribed, so where the two disagree the
 * occluder is the smaller and the disc's own black covers the difference rather than the
 * occluder poking out past a silhouette it is meant to be standing behind. One mesh at this
 * resolution costs nothing worth measuring.
 *
 * @type {number}
 */
const SHADOW_SEGMENTS = 48;

/**
 * How far behind the hole's centre the occluder sits, as a fraction of the camera's distance.
 *
 * The occluder holds the depth of everything the hole paints, so where it sits along the line of sight
 * is the dividing line between "in front of the hole" and "behind it" for everything drawn in the
 * opaque pass. Two things are decided by it and they pull in opposite directions. Everything genuinely
 * in front of the hole — the hole's own moon, on the half of its orbit where it is drawn as a mesh
 * — has to beat it, and beat the disc's billboard and the photon ring with it, or the shadow and
 * the gas are painted over a body that should be hiding them. And the billboard and the ring, both
 * of which pass exactly through the hole's centre, have to beat *it*, or the gas crossing the
 * silhouette and the bright rim around it are clipped away by the very solid they are drawn on.
 *
 * A hair behind the centre satisfies both: the two camera-facing planes at the centre win, and
 * anything further forward than a hair wins over all three. What "a hair" can be is set by the depth
 * buffer, whose resolution falls off as the square of the distance, so this is a fraction of the
 * distance rather than of the shadow — a fixed slice of the world would stop being resolvable at
 * exactly the range where the shadow is still several pixels across. A percent holds up over the
 * whole useful range of this scene's near and far planes: a hundred and thirty resolvable steps of
 * separation with the hole twenty radii off, thirty with it a hundred, and down to a single step only
 * once the shadow itself is about a pixel wide, where a tie costs nothing that can be seen.
 *
 * What it costs is the other direction: the dividing line is not quite the hole's centre but a
 * percent of the way back towards it, so something *behind* the hole by less than that is not hidden
 * by the shadow. At the range the hole is worth looking at that is a fifth of a horizon radius, well
 * inside the horizon, where there is nothing to hide.
 *
 * @type {number}
 */
const SHADOW_DEPTH_MARGIN = 0.01;

/**
 * Render order for the shadow's solid.
 *
 * One past the disc's background order, and the whole design of the solid rests on it. The solid is
 * opaque, so three.js draws it in the opaque pass, before every transparent object in the frame
 * whatever their render orders are — and the orbit lines, the pinpoints and the glares are all
 * transparent, which is what puts them after it and lets its depth stand in their way. The disc's
 * billboard while it is tracing is opaque too, so ordering it before the solid is the only way to
 * keep it: see {@link BlackHoleEffects.addShadowSolid} for why "before" is what the disc needs and
 * "after" is what everything else does.
 *
 * @type {number}
 */
const SHADOW_SOLID_RENDER_ORDER = BACKGROUND_RENDER_ORDER + 1;

/**
 * Segments around and over the shadow's solid.
 *
 * The solid is never seen — it writes no colour — so this is not about how round it looks. It is
 * about how round it *is*: a sphere of segments has a polygonal outline inscribed inside the circle
 * it stands for, short of it by `1 - cos(π / n)` at the worst, and every bit of that shortfall is
 * a sliver of the silhouette the solid fails to cover. Sixty-four around and thirty-two over holds
 * that under half a percent of the radius, which at the closest zoom where the shadow is still on
 * the screen whole is well under a pixel. Erring inside the circle rather than outside is the right
 * way round for the same reason it is on the occluder: what pokes out past the silhouette would be
 * hiding sky that should be seen.
 *
 * @type {number}
 */
const SHADOW_SOLID_SEGMENTS = 64;

/**
 * Rings from pole to pole on the shadow's solid.
 *
 * Half the segments around, which is the ratio that makes the facets roughly square and so shares
 * the shortfall above evenly between the two directions instead of letting whichever is coarser
 * decide the outline on its own. The outline of a sphere runs in a different direction depending on
 * where the camera is, so both have to be good.
 *
 * @type {number}
 */
const SHADOW_SOLID_RINGS = SHADOW_SOLID_SEGMENTS / 2;

/**
 * How far behind the hole's centre its pinpoint sits, as a fraction of the camera's distance.
 *
 * Every body carries a one-pixel point at its centre for the distances where its sphere covers
 * less than a pixel, and every body but this one is rid of it for free: the point writes no depth
 * but is depth *tested*, so as soon as the body's own surface rasterises the point is behind it and
 * gone. See {@link BodyRenderer.createPinpointLight}.
 *
 * A hole has no such surface. Its sphere writes no depth either, so nothing at the centre would
 * hide the point at any distance — a white pixel in the middle of the shadow, which is the one
 * place in the scene where a stray lit pixel has nothing it could be. The occluder is the surface
 * the test wants, and it covers the centre whenever it rasterises at all, but it is deliberately a
 * step *behind* the centre, so a point left at the centre beats it by the width of that step.
 * Standing the point back further than the step gives the ordinary behaviour exactly, with no
 * threshold to pick: the point is hidden precisely when the shadow is being drawn, and shows
 * through when the shadow has become too small to rasterise, which is what it is for.
 *
 * Twice the occluder's own margin, so the two cannot land on the same depth, and still a fraction
 * of a horizon radius of real distance — inside the shadow, where being further back hides nothing.
 *
 * @type {number}
 */
const PINPOINT_DEPTH_MARGIN = 2 * SHADOW_DEPTH_MARGIN;

/**
 * Default Einstein radius for the lensing, in Schwarzschild radii.
 *
 * The physical answer would be the radius of the hole's shadow — `3√3 / 2`, or about 2.6 radii,
 * larger than the horizon because the hole bends the light of its own silhouette outwards, and
 * the radius at which light grazes into an orbit around it. But {@link BlackHoleLensPass} works
 * from the rendered frame and has no image of what is behind the hole, and at 2.6 radii the
 * deflection it is asked for near the shadow cannot be drawn from what the frame holds. Around
 * one radius is what the method supports; the shadow itself is drawn at its true size regardless.
 *
 * @type {number}
 */
const DEFAULT_EINSTEIN_RADII = 1.2;

/**
 * How far out the lensing is taken before it is faded off, in Schwarzschild radii.
 *
 * The deflection never truly reaches zero, so the cutoff is a judgement rather than a physical
 * boundary: fourteen radii is where the remaining offset is a fraction of a pixel at any
 * plausible viewing distance.
 *
 * @type {number}
 */
const DEFAULT_LENS_FALLOFF_RADII = 14.0;

/**
 * Attaches a black hole's visual effects.
 *
 * A black hole is the one body here that is not made visible by its own surface — the surface
 * emits nothing at all. What can be seen is the matter falling into it, the ring of light
 * bent around it, and the distortion of everything behind it, and those are three separate
 * effects with nothing in common but a centre. Assembling them is kept out of {@link Body} for
 * the same reason {@link StarEffects} exists.
 *
 * Every radius in the configuration is a multiple of the body's drawn radius, which is taken to
 * be the Schwarzschild radius. That convention is what keeps the parts consistent: the hole is
 * drawn a hundred million times larger than it really is, and stating the disc's edges and the
 * lensing's reach relative to it means the whole picture scales together and the relativistic
 * terms in the disc shader stay correct.
 *
 * Static only.
 */
class BlackHoleEffects {
    /**
     * Adds whichever effects this hole's data asks for.
     *
     * Each effect is added only if its own configuration block is present, following
     * {@link StarEffects.addStarEffects} — a hole can have a disc and no lensing, or lensing
     * and no disc. A missing block is logged rather than defaulted, so the data file is never
     * misleading about what is on screen.
     *
     * The body's own sphere is moved out of the way first: everything the hole looks like is drawn
     * by the effects here, and the horizon underneath them has to be drawn before them rather than
     * with the bodies. See {@link HORIZON_RENDER_ORDER}.
     *
     * Each effect that draws the hole is also put in the layer the bodies are not in, as it is
     * built, so that the lensing can bend the two against each other — and the sphere and the pinpoint
     * go with them, since both are hidden only by the occluder standing in front of them, which is a
     * promise that holds where they stand and nowhere the lensing can carry their colour to; see
     * {@link BlackHoleEffects.markUnlensed}.
     *
     * @param {Body} body - The hole's body, which the effects are attached to.
     * @param {Object} bodyData - The hole's configuration.
     * @param {Object} bodyData.blackHole - Black-hole data; each effect reads its own key.
     * @param {number} radius - The hole's drawn radius in scene units, taken as its
     *   Schwarzschild radius.
     * @returns {void}
     */
    static addBlackHoleEffects(body, bodyData, radius) {
        if (body.mesh) {
            body.mesh.renderOrder = HORIZON_RENDER_ORDER;
            BlackHoleEffects.markUnlensed(body.mesh);
        }

        BlackHoleEffects.markUnlensed(body.pinpointMesh);

        BlackHoleEffects.addShadowOccluder(body, radius);
        BlackHoleEffects.addShadowSolid(body, radius);

        if (bodyData.blackHole.disk) {
            BlackHoleEffects.addAccretionDisk(body, bodyData, radius);
        } else {
            log.debug('BlackHoleEffects', 'Disk data not found - skipping accretion disc');
        }

        if (bodyData.blackHole.photonRing) {
            BlackHoleEffects.addPhotonRing(body, bodyData, radius);
        } else {
            log.debug('BlackHoleEffects', 'Photon ring data not found - skipping photon ring');
        }

        if (bodyData.blackHole.lensing) {
            BlackHoleEffects.addLensing(body, bodyData);
        } else {
            log.debug('BlackHoleEffects', 'Lensing data not found - skipping distortion');
        }

        body.blackHoleData = bodyData.blackHole;
    }

    /**
     * Moves an object out of the layer the lensing bends, into the one the hole is drawn in.
     *
     * Three things here are drawn from the hole's own photon paths — the shadow, the gas and the
     * ring — and all three are therefore already lensed, exactly, by the tracer that drew them.
     * Bending them again is not the reason for this. The reason is the other side of the same coin:
     * {@link BodyLensPass} bends the bodies by rendering them into a target of their own and warping
     * that, and for the space a body is moved out of to show the gas and the sky that are behind it,
     * the gas and the sky have to be in the *other* target. So the division is not "what is bent" but
     * "what is bent by whom", and this layer is the tracer's half of it.
     *
     * Traversed rather than set, because layers do not inherit: a child of an object in this layer is
     * still in the one it was born in.
     *
     * The hole's horizon sphere and its pinpoint are moved too, and they are the interesting cases,
     * because the argument for leaving them among the bodies is nearly convincing. Both are invisible
     * in the ordinary way of things, and both by the same trick: neither writes depth, and both sit
     * behind the shadow's occluder, which is opaque, black, depth-writing and two and a half times the
     * horizon's radius. Whatever is drawn at the hole's centre, the occluder covers it. See
     * {@link BlackHoleShaderMaterial} and {@link BlackHoleEffects.updatePinpointDepth}.
     *
     * That is an argument about the pixels those objects are *at*, and lensing is a gather. The gather
     * reads the pixels they are at from pixels a long way away from them: as a destination approaches
     * the Einstein radius from outside, its source radius falls to nearly zero, so the whole ring of
     * destinations just outside the Einstein radius samples the hole's centre. Whatever is left there
     * is painted out to a radius the occluder covers nothing at: the sphere as a black annulus whose
     * inner edge is exactly the Einstein radius and whose width is the sphere's apparent radius
     * carried through the lens equation, and the pinpoint as a single white pixel smeared into a thin
     * dashed circle at the same radius. So the rule is not "what is bent by whom" alone. Anything of
     * the hole's that relies on being covered where it stands has to leave the layer that gets
     * gathered from, because being covered there says nothing about being covered everywhere its
     * colour can be carried to.
     *
     * Moving them costs nothing. Bodies are picked by their markers, which are the only objects a
     * {@link THREE.Raycaster} here is ever given, and the sphere's remaining jobs — the distance
     * threshold that swaps it for the pinpoint, the focus target — are decided in script and do not
     * care which layer it draws in. Both keep their depth test and their render order relative to the
     * occluder and the gas, so drawing them in the same pass as those changes nothing about what
     * covers what; see {@link HORIZON_RENDER_ORDER}.
     *
     * @param {THREE.Object3D} object - Object whose subtree is the hole's own drawing.
     * @returns {void}
     */
    static markUnlensed(object) {
        if (!object) return;

        object.traverse((child) => child.layers.set(SCENE.UNLENSED_LAYER));
    }

    /**
     * Adds the shadow's occluder: the solid the hole occupies as far as depth is concerned.
     *
     * Every other body here hides what is behind it for free, by being an opaque mesh that writes
     * depth. A black hole cannot: the silhouette is drawn by {@link AccretionDisk}, which is a
     * transparent billboard covering far more of the screen than the shadow does and which must
     * not write depth — most of it is gas the sky shows through, and the parts that are pure black
     * are only known to be black *after* the fragment shader has traced the path. So as far as the
     * depth buffer is concerned there was nothing there at all, and anything drawn after the disc
     * that tests depth passes the test and appears inside the shadow. The Sun's rays do exactly
     * that, and so does anything else with a render order above the disc's.
     *
     * This is the missing solid: opaque, black, depth-writing, at the shadow's radius. It carries the
     * ordinary rule — behind the hole is hidden, in front of it is not — to everything that respects
     * depth at all, which is everything the hole is drawn from as well as everything around it: the
     * billboard and the photon ring are both tested against this, so a body in front of the hole
     * hides them. A star's {@link SunGlare} is depth tested like anything else and so needs nothing
     * here to know a black hole exists.
     *
     * A camera-facing disc rather than a sphere, and that is the whole of how a body in front of the
     * hole hides it. A sphere holds the outline just as well — it needs no aiming, and a cone of rays
     * is what either shape occludes — but it bulges towards the camera by its own radius, so the depth
     * it writes is up to two and a half horizon radii in front of the hole's centre. That is in front
     * of the disc's billboard and the photon ring, both of which pass through the centre, so neither
     * could be depth tested against it at all: the near side of the gas, crossing the silhouette,
     * would be clipped away by the sphere it is drawn over, and with the test off the two of them
     * would paint over everything drawn before them, the hole's own moon included. A flat disc has
     * one depth over the whole silhouette, which can be put a hair *behind* the centre — see
     * {@link SHADOW_DEPTH_MARGIN} — and that one placement lets both of them be tested and still be
     * drawn: they win against the shadow they belong to, and lose to anything nearer than it.
     *
     * Which is the right shape for *this* surface and not the right shape for the silhouette's depth in
     * general, and the difference is worth being clear about, because there is a ball at this hole as
     * well. A plane behind the centre cannot hide the far half of anything passing *through* the hole,
     * the hole's own orbit line being the one thing that does; a ball can, and can be had for nothing
     * as long as it writes no colour and is drawn after the disc rather than before it. Both of the
     * clauses this one lives under — black, and early — are exactly what stops this surface from being
     * that one. See {@link BlackHoleEffects.addShadowSolid}.
     *
     * It is built at the shadow's full radius and rescaled every frame by
     * {@link BlackHoleEffects.updateShadowOccluder}, which is not optional — a plane of this radius
     * covers more of the sky than the shadow does.
     *
     * Drawn before the disc, and that ordering is load-bearing wherever the disc is tracing the sky and
     * so drawn as background itself. This disc is black as well as depth-writing, and it has to be:
     * with a disc it stands in only for the depth, but without one it *is* the shadow. Drawn after the
     * disc it would paint over the gas crossing the silhouette — the depth test lets that gas through,
     * but nothing lets it through a black surface drawn on top of it; see
     * {@link AccretionDisk#createDiskMaterial} and {@link BACKGROUND_RENDER_ORDER}.
     *
     * @param {Body} body - The hole's body; the mesh is stored on `body.shadowOccluder`.
     * @param {number} radius - The hole's drawn radius in scene units.
     * @returns {void}
     */
    static addShadowOccluder(body, radius) {
        const geometry = new THREE.CircleGeometry(
            radius * SHADOW_HORIZON_RADII, SHADOW_SEGMENTS);

        const material = new BlackHoleShaderMaterial({
            materialOptions: { depthWrite: true, side: THREE.DoubleSide }
        });

        const occluder = new THREE.Mesh(geometry, material);
        occluder.name = `${body.name}_shadow`;
        occluder.renderOrder = BACKGROUND_RENDER_ORDER - 1;

        BlackHoleEffects.markUnlensed(occluder);

        body.group.add(occluder);

        body.shadowOccluder = occluder;
    }

    /**
     * Adds the solid the hole's silhouette stands on: a ball at the shadow's radius, depth only.
     *
     * Everything the hole draws is a camera-facing plane through its centre — the disc's billboard,
     * the photon ring's quad, and the occluder a hair behind both; see
     * {@link BlackHoleEffects.addShadowOccluder}. A plane is the right shape for painting the
     * silhouette and the wrong one for standing in its way, and the difference shows on the one
     * thing in the scene that runs *through* a hole rather than past it: the hole's own orbit line.
     * A plane at the centre hides the half of that line beyond the centre and none of the half in
     * front of it, so the line would come to a stop in the middle of the shadow with its near half
     * drawn across the black.
     *
     * A ball hides both halves, because both halves are inside it. The shadow's edge is the impact
     * parameter of the last ray that gets away, so anything within that radius of the centre either
     * fell in or is on its way in, and none of it is sending light this way. Which also settles the
     * radius: it comes from {@link shadowApparentSine} and not from the tangent the flat occluder
     * takes, a sphere subtending `asin(r / d)` where a plane subtends `atan(r / d)`. The two agree
     * far away and part company at exactly the close range where the shadow is worth looking at.
     *
     * It writes depth and no colour, and both halves of that carry weight. Writing no colour is what
     * lets it be drawn *after* the disc, which is the only place a surface reaching in front of the
     * centre can go: drawn before, it would cut the billboard and the ring's quad out of the frame,
     * both being planes through a centre this ball stands in front of. Drawn after, the disc has
     * already painted and tested its own depth and never wrote any, so it loses nothing — the gas
     * crossing the silhouette survives exactly as it did. And writing depth is the whole point,
     * since depth is the only thing left that can reach the transparent objects drawn later.
     *
     * What it does not do is paint the shadow. Nothing here does: the tracer draws the silhouette
     * from the photon paths, and the occluder is the fallback for a hole configured without a disc.
     * This ball only says where the hole *is*, which is the question the frame had no answer to.
     *
     * @param {Body} body - The hole's body; the mesh is stored on `body.shadowSolid`.
     * @param {number} radius - The hole's drawn radius in scene units.
     * @returns {void}
     */
    static addShadowSolid(body, radius) {
        const geometry = new THREE.SphereGeometry(
            radius * SHADOW_HORIZON_RADII, SHADOW_SOLID_SEGMENTS, SHADOW_SOLID_RINGS);

        const material = new BlackHoleShaderMaterial({
            materialOptions: { depthWrite: true, colorWrite: false }
        });

        const solid = new THREE.Mesh(geometry, material);
        solid.name = `${body.name}_shadow_solid`;
        solid.renderOrder = SHADOW_SOLID_RENDER_ORDER;

        BlackHoleEffects.markUnlensed(solid);

        body.group.add(solid);

        body.shadowSolid = solid;
    }

    /**
     * Resizes the shadow's solid to the ball the shadow actually covers from here.
     *
     * Built at the shadow's impact parameter and rescaled to the angle the silhouette really
     * subtends, the same way and for the same reason as the occluder — except through the sine,
     * which is the difference between a ball and a plane and is argued in
     * {@link BlackHoleEffects.addShadowSolid}. No aiming and no step along the line of sight: a
     * sphere has neither a facing to get wrong nor a near side to be nudged past.
     *
     * Hidden in two cases, and the second is the interesting one. Inside the horizon there is no
     * outside to look in from, and at the photon sphere the shadow passes half the sky, where the
     * ball would swallow the camera and take the whole frame with it. And a disc drawn as an overlay
     * rather than as the background needs the ball gone: an overlay disc is transparent and drawn
     * late, after the orbit lines rather than before them, so it paints the shadow over the top of
     * them and there is nothing left for depth to fix — while a ball drawn ahead of it would clip
     * the gas out of the silhouette, which is the one thing the ordering above was arranged to keep.
     * That is the same one flag {@link AccretionDisk#bindSky} already sets the disc's own render
     * order from, read here rather than a second condition of its own, and it turns on whether the
     * scene has a sky rather than on where the camera is — so nothing about it moves while looking.
     *
     * @param {Body} body - The hole's body; does nothing if it has no solid.
     * @param {number} horizonRadii - The camera's distance in horizon radii.
     * @param {number} sine - Sine of the shadow's apparent angular radius from there.
     * @returns {void}
     */
    static updateShadowSolid(body, horizonRadii, sine) {
        const solid = body.shadowSolid;

        if (!solid) return;

        const disc = body.accretionDisk;

        if (!(horizonRadii > 1.0) || sine >= 1.0 || (disc && !disc.tracesSky)) {
            solid.visible = false;
            return;
        }

        solid.visible = true;
        solid.scale.setScalar(horizonRadii * sine / SHADOW_HORIZON_RADII);
    }

    /**
     * Resizes the shadow's occluder to the angle the shadow actually covers from here.
     *
     * The occluder has to be a disc of some radius, and there is no one radius that is right at
     * every distance. `3√3 / 2` is the shadow's *impact parameter*, which is only what its apparent
     * size tends to far away; a disc built at it and left alone is too wide on screen close in —
     * a fifth too wide at four horizon radii — and what pokes out past the silhouette is a
     * hard-edged crescent of sky that has been blocked and should not have been. The disc cannot
     * cover it, because the disc paints only where its own tracer says shadow.
     *
     * So it is built at the full radius and rescaled each frame to the angle the shadow actually
     * covers, from {@link shadowApparentSine} — the tracer's own answer, so the outline agrees with
     * the silhouette by construction and not by a tuned number. Matching the physical shadow instead
     * would leave it visibly inside the drawn one, which is the same fault the other way round: what
     * has to be matched is what is on the screen. The *tangent* is what converts that angle into a
     * radius here, not the sine: a plane a known distance away subtends `atan(r / d)` where a sphere
     * subtends `asin(r / d)`, and the two part company at exactly the close range this matters at.
     *
     * A radius set to `r·tanθ` shrinks as the camera closes in, which reads backwards until you
     * notice the silhouette it is standing in for is meanwhile *growing*. Only the outline has to
     * agree, and a plane can hold an outline no larger than half the sky: the shadow reaches that at
     * the photon sphere and more inside it, where the tangent runs away and nothing flat represents
     * it. That is left to the guard below.
     *
     * Aiming is the price of the flat shape, and the reason it is worth paying is in
     * {@link BlackHoleEffects.addShadowOccluder}. It costs a `lookAt` and the short step back that
     * puts it behind the centre; see {@link SHADOW_DEPTH_MARGIN}.
     *
     * @param {Body} body - The hole's body; does nothing if it has no occluder.
     * @param {THREE.Camera} camera - Camera the frame is being drawn from.
     * @returns {void}
     */
    static updateShadowOccluder(body, camera) {
        const occluder = body.shadowOccluder;

        if (!occluder || !body.group || !body.radius) return;

        const distance = camera.position.distanceTo(body.group.position);
        const horizonRadii = distance / body.radius;
        const sine = shadowApparentSine(horizonRadii);

        // The solid rides along on this measurement rather than taking its own: it is the same
        // shadow, sized from the same angle, and one distance for both is one fewer thing that can
        // disagree. Before the guard, because the guard is about what a *plane* cannot stand in for.
        BlackHoleEffects.updateShadowSolid(body, horizonRadii, sine);

        // Inside the photon sphere the shadow is over half the sky and no plane is a stand-in
        // for it; inside the horizon there is no outside to be seen from at all.
        if (!(horizonRadii > 1.0) || sine >= 1.0) {
            occluder.visible = false;
            return;
        }

        // The step back below is also a step further from the camera, and a plane's apparent size
        // goes as one over that distance, so the radius is stated against where it ends up rather
        // than against the centre it is nominally at. A percent, which is a pixel or two at the
        // closest useful zoom — but a percent *inside* the silhouette, and the whole claim of this
        // outline is that it is not inside it.
        occluder.visible = true;
        occluder.scale.setScalar(horizonRadii * shadowApparentTangent(horizonRadii)
            * (1.0 + SHADOW_DEPTH_MARGIN) / SHADOW_HORIZON_RADII);

        // Reset before aiming because `translateZ` accumulates, and it is `translateZ` that does the
        // stepping back: it moves along the object's own axes, which `lookAt` has just pointed at the
        // camera, so the sign is the whole of "away from it" and no direction has to be worked out.
        // The step is unaffected by the scale above, which is what makes the two independent.
        occluder.position.set(0, 0, 0);
        occluder.lookAt(camera.position);
        occluder.translateZ(-SHADOW_DEPTH_MARGIN * distance);

        BlackHoleEffects.updatePinpointDepth(body, camera, distance);
    }

    /**
     * Stands the hole's pinpoint back behind the occluder, so the occluder hides it.
     *
     * Aimed and stepped back the same way the occluder is, and for the same reason: the point hangs
     * off the tilt container rather than the group, and `lookAt` is what turns "away from the
     * camera" into a direction in whatever frame its parent is in — refreshing that frame as it
     * goes, which matters for a body that has moved since the last time it was drawn. Where the
     * point ends up facing is of no consequence; it is one vertex, drawn as a screen-aligned pixel.
     * See {@link PINPOINT_DEPTH_MARGIN} for why it is stood back at all, and
     * {@link BlackHoleEffects.markUnlensed} for why standing it back is not on its own enough once the
     * hole is bending the bodies around itself.
     *
     * @param {Body} body - The hole's body; does nothing if it has no pinpoint.
     * @param {THREE.Camera} camera - Camera the frame is being drawn from.
     * @param {number} distance - Camera's distance to the hole's centre, in scene units.
     * @returns {void}
     */
    static updatePinpointDepth(body, camera, distance) {
        const pinpoint = body.pinpointMesh;

        if (!pinpoint) return;

        pinpoint.position.set(0, 0, 0);
        pinpoint.lookAt(camera.position);
        pinpoint.translateZ(-PINPOINT_DEPTH_MARGIN * distance);
    }

    /**
     * Adds the accretion disc: the glowing gas spiralling in.
     *
     * Attached to the group rather than the tilt container, unlike a ring system, because the
     * disc is drawn on a camera-facing billboard and must inherit neither the tilt nor the spin.
     * The tilt still applies to the gas — the container is handed to the disc every frame by
     * {@link Body#update} and the shader reads the disc's plane from it, so the disc lies in the
     * body's equator exactly as a ring would while the surface it is drawn on faces the viewer.
     *
     * @param {Body} body - The hole's body; the disc is stored on `body.accretionDisk`.
     * @param {Object} bodyData - The hole's configuration.
     * @param {number} radius - The hole's drawn radius in scene units.
     * @returns {void}
     */
    static addAccretionDisk(body, bodyData, radius) {
        const disk = bodyData.blackHole.disk;

        const accretionDisk = new AccretionDisk({
            horizonRadius: radius,
            innerRadius: disk.innerRadius || ISCO_HORIZON_RADII,
            outerRadius: disk.outerRadius,
            innerColor: disk.innerColor,
            outerColor: disk.outerColor,
            intensity: disk.intensity,
            opacity: disk.opacity,
            emissionFalloff: disk.emissionFalloff,
            noiseScale: disk.noiseScale,
            swirlSpeed: disk.swirlSpeed,
            turbulence: disk.turbulence,
            beamingStrength: disk.beamingStrength
        });

        accretionDisk.addToScene(body.group);

        // Every quad, and the companions' for the same reason as the disc's: they are drawn from the same
        // traced paths, so they are already lensed, and they are what the space a body was moved out of
        // has to show through. The companions are the only bodies whose surfaces are in this half of the
        // frame rather than in the bent half; see {@link AccretionDisk#createCompanionQuad}.
        accretionDisk.getMeshes().forEach((mesh) => BlackHoleEffects.markUnlensed(mesh));

        body.accretionDisk = accretionDisk;
    }

    /**
     * Adds the photon ring: the bright circle around the hole's silhouette.
     *
     * Attached to the group, not the tilt container, since it is camera-facing and must inherit
     * neither the tilt nor the spin. It is re-aimed every frame by {@link Body#update}.
     *
     * @param {Body} body - The hole's body; the ring is stored on `body.photonRing`.
     * @param {Object} bodyData - The hole's configuration.
     * @param {number} radius - The hole's drawn radius in scene units.
     * @returns {void}
     */
    static addPhotonRing(body, bodyData, radius) {
        const photonRing = bodyData.blackHole.photonRing;

        const ring = new BlackHolePhotonRing({
            horizonRadius: radius,
            ringRadius: photonRing.ringRadius,
            thickness: photonRing.thickness,
            extent: photonRing.extent,
            color: photonRing.color,
            brightness: photonRing.brightness,
            haloStrength: photonRing.haloStrength,
            haloFalloff: photonRing.haloFalloff,
            opacity: photonRing.opacity
        });

        ring.addToScene(body.group);

        BlackHoleEffects.markUnlensed(ring.getMesh());

        body.photonRing = ring;
    }

    /**
     * Resolves the hole's lensing settings for {@link BlackHoleLensPass}.
     *
     * Nothing is built here, because the distortion is not an object in the scene — it is a
     * post-processing pass shared by every hole. All this does is put the settings somewhere
     * the pass can find them, in resolved form so the per-frame code never has to apply a
     * default. Its presence on the body is also the signal to register for lensing at all, so a
     * hole with no `lensing` block is simply never handed to the pass.
     *
     * @param {Body} body - The hole's body; the settings are stored on `body.blackHoleLens`.
     * @param {Object} bodyData - The hole's configuration.
     * @returns {void}
     */
    static addLensing(body, bodyData) {
        const lensing = bodyData.blackHole.lensing;

        body.blackHoleLens = {
            einsteinRadii: lensing.einsteinRadii || DEFAULT_EINSTEIN_RADII,
            strength: lensing.strength !== undefined ? lensing.strength : 1.0,
            falloffRadii: lensing.falloffRadii || DEFAULT_LENS_FALLOFF_RADII
        };
    }
}

export default BlackHoleEffects;
