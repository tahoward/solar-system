import * as THREE from 'three';
import ShaderLoader from '../shaders/ShaderLoader.js';
import { log } from '../utils/Logger.js';

/**
 * How many integration steps a photon path is followed for.
 *
 * Each step advances the path by at most {@link ANGLE_STEP} radians, so this and that between
 * them set how far a ray may wind before it is given up on. This is a couple of full turns, which
 * is past the point of diminishing returns: a ray still bound after that has either already
 * crossed the disc several times and saturated, or is about to fall in. Rays that run out of steps
 * are treated as captured, which is the safe failure — it draws shadow where the truth is nearly
 * always shadow, rather than a hole in the picture.
 *
 * It is a ceiling, not a cost. A typical ray finishes in some fifty steps, so what this buys is
 * headroom for the few that need it, and the {@link SLAB_STEP} refinement needs a little: without
 * it a handful of rays in a frame — the ones skimming the length of the disc — run out mid-disc and
 * are drawn as shadow, which in the middle of the brightest part of the picture is a black speck.
 *
 * @type {number}
 */
const MAX_STEPS = 256;

/**
 * Integration step, in radians of orbital angle swept.
 *
 * Stepping in angle rather than in distance is what makes a fixed budget workable: the paths
 * that need the most attention are the ones bending hardest, and those are exactly the ones
 * sweeping the most angle per unit length. This is the largest step taken, used wherever the
 * path is curving; {@link RADIAL_STEP_LIMIT} shortens it where it is not.
 *
 * @type {number}
 */
const ANGLE_STEP = 0.06;

/**
 * The most a step may move in radius, as a fraction of the current radius.
 *
 * Angle alone is not enough to step by, and the reason is the rays aimed nearly straight at the
 * hole: they cross the whole disc while sweeping almost no angle at all, so a step chosen by
 * angle carries them from outside the disc to inside the horizon in one go. The disc is not
 * missed subtly — it is not sampled *once*, which draws a black dot in the middle of the shadow
 * where the brightest part of the picture should be, ringed by pixels that took one enormous
 * step and blew out.
 *
 * So each step is also held to a fraction of the radius. That fraction is under the disc's own
 * thickness, which is what guarantees no crossing is stepped over, and it costs remarkably
 * little: holding the step to a fixed *fraction* makes the radius fall geometrically, so a ray
 * diving in from any distance reaches the horizon in a couple of dozen steps. It is the winding
 * rays, which this leaves alone, that use the budget.
 *
 * @type {number}
 */
const RADIAL_STEP_LIMIT = 0.08;

/**
 * Half-thickness of the disc, as a fraction of the local radius.
 *
 * A real thin disc is a few percent of its radius thick, and stating it as a fraction rather
 * than a constant is what gives it the flare a real one has — thickness is set by the balance
 * between pressure and gravity, and gravity weakens outwards.
 *
 * Giving the disc a thickness at all is not decoration. A mathematical plane has a degenerate
 * case: a ray travelling *within* it never crosses it, so an exactly edge-on view — which is the
 * most interesting one — loses the disc's own image along the line where it should be brightest.
 * A slab has no such case, and it comes with the right behaviour for free: a grazing ray has a
 * long path through the gas and comes out brightest, which is why an edge-on disc has a bright
 * spine.
 *
 * @type {number}
 */
const DISC_FLARE = 0.05;

/**
 * The most a step may travel while inside the disc, as a fraction of the slab's half-thickness.
 *
 * {@link ANGLE_STEP} and {@link RADIAL_STEP_LIMIT} are both about not stepping *over* the disc, and
 * a ray that clears them can still cross the whole slab in a single step — most of all the ones
 * skimming along it, which are neither diving in radius nor turning quickly, and which are exactly
 * the rays that spend the longest in the gas. One sample cannot represent a whole crossing of gas
 * this filamentary, so this holds the step to a fraction of the thickness while the path is within
 * reach of the slab, and a crossing is sampled a few times over. It is measured along the path
 * rather than in radius or angle, since that is the only measure a skimming ray is large in.
 *
 * It is the most expensive number in the shader, and the step count hides that rather than showing
 * it: at a close view the steps rise by a sixteenth, from 57 to 60 per pixel, while the samples of
 * the gas — three layers of noise apiece, and the real cost of the march — go from 5.1 to 8.7. That
 * is the trade to reach for first if the disc ever needs to be cheaper: against a converged march
 * the error runs a seventeenth uncapped, a twenty-fourth at 1.0 and a thirty-third here, so each
 * doubling of the sampling is worth steadily less.
 *
 * Two things about that trade are worth recording, because both look like ways around it and are
 * not. The *form* of the cap does not matter, only the sample count it produces: a cap founded on
 * the noise's own cell size along the path instead of on the thickness — which is the better-argued
 * quantity, since the vertical profile is already exact in closed form and the noise has no vertical
 * dependence at all — traces the same error against samples curve to within a tenth of a percent.
 * And nothing can be skipped selectively. Measured over a close view, 99% of layer evaluations still
 * have a quarter of their contrast surviving the band limit, so no layer is ever nearly erased where
 * it could be dropped; and 92% of samples are taken where more than half the light is still getting
 * through, with none below a quarter, so the disc is too optically thin for early termination to
 * find anything either. The count comes down by taking better samples, not fewer of them.
 *
 * What lets the step be this long is where the sample is taken: the gas is evaluated at the middle of
 * the part of the step inside the slab rather than at the step's end, and the band limit is charged
 * the step's horizontal extent rather than its whole length — see the march in main() for both.
 * Together those are worth a third of the error at a given cost, which buys 30% fewer samples of the
 * gas at every distance for an error no worse than a step half this length gives without them.
 *
 * None of it is what keeps the disc free of concentric banding, which is worth recording because the
 * two are easily confused. Banding is an error of the first order in the step length, and the two
 * places one could arise are handled exactly rather than by shortening the step: the vertical profile
 * is averaged over the crossing in closed form in the march below, and the emission is attenuated
 * through the step's own gas rather than all of it leaving at the transmittance in front. With those
 * two right, going from no cap at all to this one leaves the ripple through the disc below the
 * converged answer's own either way.
 *
 * Because it is the trade to reach for first, it reaches the shader as a uniform rather than as a
 * compiled-in constant, and this is the value it starts at; see {@link AccretionDisk#setSlabStep}
 * for changing it live. The step limits either side of it are still compiled in, since those are
 * about not *missing* the disc and a picture that has missed it is not a cheaper picture of it.
 *
 * @type {number}
 */
const SLAB_STEP = 0.75;

/**
 * How many bodies the tracer can draw along with the gas at once.
 *
 * A ceiling on the uniform arrays and on the loops that read them, and not a cost. What a companion
 * costs is paid per ray that could reach it, and nearly no ray can: the plane test main() opens with
 * throws out every pixel whose own path plane misses the sphere, which is all of the screen but a
 * stripe through the hole and that companion's image. An empty slot is a comparison against a radius
 * of zero, and a companion no ray is aimed near is the same comparison. What the ceiling itself costs
 * is a few uniform slots apiece and a quad, and an empty quad is not submitted at all; see
 * {@link AccretionDisk#releaseCompanion}.
 *
 * It has to be compiled in rather than counted at run time, because the arrays are sized with it and
 * the loops over them are bounded by it, and GLSL requires both to be constant. Raising it is this
 * line and a shader rebuild.
 *
 * A hole with more moons than this does not fail quietly, and what happens to the ones past the
 * ceiling is worth stating because it is the whole reason the tracer takes them in the first place.
 * They keep their own meshes, and a mesh at the hole is bent by {@link BodyLensPass}, whose
 * deflection is scaled for a source infinitely far behind the hole — a fair approximation for every
 * other body in the catalogue and a poor one for a moon a few dozen horizon radii out. So such a moon
 * is left exactly on its orbit line while it is in front of the hole's centre plane, and displaced by
 * several times the right amount from the moment it crosses it: the body appears to snap off its own
 * line as it goes round the back. {@link AccretionDisk#setCompanions} logs when that is about to
 * happen rather than leaving it to be found by looking.
 *
 * @type {number}
 */
const MAX_COMPANIONS = 4;

/**
 * The most a step may travel towards a traced companion, as a fraction of its distance from it.
 *
 * A companion is a solid surface a few tenths of a radius across, twenty radii out, and the rays that
 * cross the sky take steps of a quarter of a radian — several radii of path at that distance. So it has
 * to be found rather than sampled into, and this is what finds it: hold the step to half the distance
 * remaining to the surface, and the march cannot pass through it without a step ending inside.
 *
 * Which is sphere tracing, and it costs what sphere tracing costs — about eleven steps to close on a
 * surface from twenty radii away, and as many again on the way past for a ray that grazes it. That is
 * affordable only because it is asked for so rarely: the path's plane either cuts the companion or it
 * does not, the test for which is one dot product before the march, and the planes that do cut it
 * amount to a thin stripe of the screen through the hole and the companion's image. Everything else
 * marches as though the companion were not there.
 *
 * Half rather than the whole distance because the whole would let a step land exactly on the surface
 * and stop there, and the *hit* is the crossing rather than the arrival — the step's own segment is
 * what is intersected against the sphere, so the march has to end up inside it to find anything.
 *
 * @type {number}
 */
const COMPANION_STEP = 0.5;

/**
 * Shortest step a companion may ask for, in horizon radii of path length.
 *
 * {@link COMPANION_STEP} alone approaches a surface geometrically and never reaches it, halving the
 * gap for as long as it is given steps. This is the floor that ends that: once the gap is below it the
 * next step oversteps, the segment lands inside the sphere and the crossing is solved for exactly.
 *
 * So it is not an accuracy limit on the surface — the intersection is exact once it is bracketed — but
 * on the step that brackets it, whose chord departs from the arc by some `l² / 8r`. At a hundredth of a
 * radius, twenty radii out, that is a few parts in a hundred million.
 *
 * @type {number}
 */
const COMPANION_MIN_PATH = 0.01;

/**
 * Ambient term for a traced companion's surface.
 *
 * Copied from {@link PlanetShaderMaterial}, whose value it has to be rather than resemble: the tracer
 * is drawing a body that has its own material, and the two are the same surface seen under different
 * circumstances. Anything else and the companion would change brightness the moment the tracer took it
 * over from its own mesh, which is the one thing a viewer would read as a bug rather than as physics.
 *
 * @type {number}
 */
const COMPANION_AMBIENT = 0.005;

/**
 * How far a traced companion's image may stray from the body itself, in the body's own radii.
 *
 * The size of the quad that carries the companion, and the one number in it that had to be measured
 * rather than reasoned out. An image is displaced outwards from the straight line to the body — see
 * {@link AccretionDisk#setCompanion} — and the quad has to be wide enough to hold wherever it has gone,
 * because a quad that stops short does not shift the image, it cuts it off along a straight edge.
 *
 * Marching the shader's own paths offline puts the displacement at a fiftieth of a radius thirty degrees
 * from the camera, one radius abreast of the hole from far out, and eight to twenty radii for the awkward
 * case, which is a camera down at three or eight horizon radii looking back at a body twenty out: from
 * in there the chord to the body passes within six radii of the hole and is bent hard. Twenty-four covers
 * every measured case with room over. What it does not have to cover is the far side near conjunction,
 * where the image stretches round the shadow's rim tens of radii from the body — that is the hole's own
 * quad's region and it is already drawn there; see {@link AccretionDisk#createCompanionQuad}.
 *
 * Generous rather than tight because over-sizing this costs almost nothing. The quad's extra area is
 * pixels whose ray plane misses the sphere, and those leave the fragment shader on a dot product without
 * marching anything.
 *
 * @type {number}
 */
const COMPANION_IMAGE_RADII = 24.0;

/**
 * How wide a traced companion has to be drawn, in pixels, to be worth more than its own pinpoint.
 *
 * Every body is drawn twice over: the mesh, and a one-pixel point at its centre that stands in for it
 * in the views the mesh is too small to see. The two never disagree, because the point sits behind the
 * surface — until the surface is taken away, which is exactly what tracing a companion does. So the
 * point has to be hidden along with the mesh, and hiding it for the whole orbit would lose the body
 * from every view it is smaller than a pixel in. A traced sphere that small is no substitute either: it
 * is drawn wherever a ray happens to strike it, so it comes and goes between frames instead of fading.
 *
 * Below this the pinpoint keeps the body and the tracer leaves it alone, which is the pinpoint doing
 * precisely what it exists for. Measured in CSS pixels against a point that is one *device* pixel, so
 * on a display of any pixel ratio the surface is comfortably the larger of the two before it takes
 * over, and the switch is worth a pixel of position either way.
 *
 * @type {number}
 */
const COMPANION_MIN_PIXELS = 1.5;

/**
 * How much harder it is to start tracing a companion than to stop, as a factor on the threshold above.
 *
 * {@link COMPANION_MIN_PIXELS} is a statement about where the camera is, and a camera being flown by hand
 * does not cross a threshold once and carry on. It drifts along one, sits on it, comes back over it. At a
 * single threshold the body would change between traced surface and pinpoint every few frames, and while
 * the two are placed to agree to about a pixel, a pixel switching on and off at frame rate is what a
 * viewer sees as the body flickering — and only while the camera is moving, which is when it is most
 * obvious and least excusable.
 *
 * So the threshold is harder to enter than to leave: the surface has to be worth a third again before it
 * takes over from the pinpoint, and holds it until the plain condition fails. A camera crossing the band
 * once makes the switch once, and one that hovers inside the band makes it never.
 *
 * @type {number}
 */
const COMPANION_SWITCH_MARGIN = 1.35;

/**
 * Where a length of path is treated as straight, as the sine of its angle to the radial direction.
 *
 * That sine is exactly `b / r`, and it is the one number saying how much bending a length of path
 * has left in it: near 1 the path is running around the hole and every step of it matters, and
 * small means it is heading almost straight out and the remainder is a line. Beyond this the path
 * is not integrated at all — {@link straightSweep} closes it in one expression — and that is done at
 * both ends, since a ray from far away has a straight run before the field reaches it as well as
 * after it leaves.
 *
 * A half is where that expression is worth a tenth of a pixel at every impact parameter, measured
 * against a converged integration, and the ends between them are what make the cost of a ray that
 * only crosses sky independent of how far away the camera is: ten steps, whether the hole is a
 * hundred radii off or a million. Marched from the camera instead it is some `25 ln(r / b)` steps,
 * which passes {@link MAX_STEPS} at the distances this scene actually uses.
 *
 * The value matters in both directions, which is why it is not simply set small. Where a ray is
 * *finished* has to be somewhere a step can land, and calling it escaped at a multiple of the
 * camera's distance is unreachable from far away: the last stretch of the way out to such a boundary
 * is swept in a ten-thousandth of a radian, so a step of any useful length lands not merely past it
 * but past the end of the path altogether, with the remaining sweep read off a radius the ray is
 * nowhere near. That is worth hundreds of pixels at large distances and three at close ones. So the
 * analytic ends are not an approximation traded against an exact test; they are the smaller error of
 * the two.
 *
 * @type {number}
 */
const STRAIGHT_PATH_SINE = 0.5;

/**
 * How far past the disc's outer edge a ray must be before it may be called escaped.
 *
 * {@link STRAIGHT_PATH_SINE} alone would let a ray that dives well inside the disc finish while
 * still among the gas — its path is radial enough to be straight there, but straight is not the
 * question, since what remains of it is a line drawn through the brightest part of the picture. So
 * both have to hold: heading out, running nearly radially, and clear of the gas.
 *
 * @type {number}
 */
const ESCAPE_OUTER_FACTOR = 1.5;

/**
 * Transmittance below which a ray is abandoned as blocked.
 *
 * The march accumulates from the camera outwards, so gas met early is gas in front. Once it has
 * absorbed all but a fiftieth of what is behind it, whatever else the ray would have found —
 * the far side of the disc, the shadow, another wrap of the ring — cannot be seen through it,
 * and stopping is both correct and the thing that bounds the cost of the worst rays.
 *
 * @type {number}
 */
const MIN_TRANSMITTANCE = 0.02;

/**
 * How much wider than the disc's apparent extent the billboard is drawn.
 *
 * Lensing only ever bends light inwards, so no ray that reaches the disc started further out than
 * a ray that grazes its rim — but "further out" has to be measured as an angle from the camera,
 * and the deflection means a ray aimed just outside the rim can still curve into it. The rim also
 * lands very close to the limit on its own account, and a quad cut exactly to it would clip it. A
 * quarter again is comfortably clear of both.
 *
 * It multiplies the disc's *apparent* extent rather than its radius; see
 * {@link AccretionDisk#placeBillboard}.
 *
 * @type {number}
 */
const BILLBOARD_MARGIN = 1.25;

/**
 * How much of the viewport a body's quad covers when its traced image is larger than the frame.
 *
 * Close in, the image extends past the edges of the screen and there is no quad size that contains
 * it — but there is no need for one, because anything beyond the frame is not drawn anyway. So the
 * quad falls back to covering the viewport, doubled because it is centred on the body rather than
 * on the screen and the body may be off to one side.
 *
 * Doubling is enough for a body the camera is looking at, which is the only case where the cap
 * binds: the quad is a couple of dozen body radii across, so it takes a body filling the frame to
 * reach it, and a body that fills the frame is one the camera is pointed at. The hole's own quad
 * cannot assume that and does not use this; see {@link frustumExtent}.
 *
 * @type {number}
 */
const SCREEN_COVER_FACTOR = 2.0;

/**
 * How much past the frame's corners the hole's quad is drawn.
 *
 * The cap on that quad is computed exactly rather than guessed at, so this is only a guard against
 * the last pixel of the edge landing inside the frame through rounding; see {@link frustumExtent}.
 *
 * @type {number}
 */
const VIEWPORT_MARGIN = 1.02;

/**
 * Integration step for a ray that only crosses sky, in radians of orbital angle swept.
 *
 * Four times {@link ANGLE_STEP}, because none of the reasons that one is short apply. The step
 * length there is set by the disc — by not stepping over a slab a twentieth of a radius thick, and
 * by sampling the gas often enough to resolve it — and a ray that misses the disc entirely has
 * nothing along it to resolve. What is left to get right is only where the ray finally points, and
 * with both straight ends closed in {@link straightSweep} what remains to integrate is the turn
 * itself, which the equation makes nearly a sinusoid in the swept angle. Runge–Kutta is very good
 * indeed on that: measured against a converged integration over every distance from eight radii to
 * a million and every impact parameter that can appear on screen, the worst ray in the set lands a
 * twelfth of a pixel from where it belongs, and the average a twentieth.
 *
 * @type {number}
 */
const SKY_ANGLE_STEP = 0.25;

/**
 * Deflection, in radians, below which the lensed sky is faded back into the sky already drawn.
 *
 * A black hole bends the *whole* sky, by `2 / b` radians at an impact parameter `b`, so there is no
 * distance at which the effect stops — merely one at which it stops being worth drawing. This is
 * where that is: about a third of a degree, some six pixels at this scene's field of view, and the
 * radius it corresponds to is what {@link AccretionDisk#placeBillboard} sizes the quad to, since
 * beyond it the traced sky and the sky three.js has already drawn are the same picture.
 *
 * It is stated as an angle rather than as a number of pixels on purpose. A pixel count would make
 * the quad — and so the cost of every frame the hole is on screen — depend on the window's size and
 * the field of view, and the fade is a matter of what can be seen rather than of resolution.
 *
 * The cost this sets is real but small. Inside about four hundred radii the quad covers the viewport
 * and every pixel of the frame traces a ray, which sounds ruinous and is not: those rays take the
 * cheap path — ten steps of arithmetic, no gas, no noise, one texture fetch — against the sixty
 * steps and hundreds of noise layers a pixel of the disc itself costs. It is also the distance range
 * where the disc is already covering the screen and doing exactly that.
 *
 * @type {number}
 */
const SKY_FADE_DEFLECTION = 0.005;

/**
 * Impact parameter, in horizon radii, at which the traced sky has faded out entirely.
 *
 * The inversion of {@link SKY_FADE_DEFLECTION} through the weak-field deflection `2 / b`.
 *
 * Exported because {@link BodyLensPass} bends the bodies over exactly the region this bends the sky
 * over, and has to stop where this stops. A body and the stars it stands against are two halves of
 * one picture, so a body still being deflected where the sky has been let go — or let go while the
 * sky is still moving — puts a seam between them at whatever radius the two disagree at.
 *
 * @type {number}
 */
export const SKY_FADE_IMPACT = 2.0 / SKY_FADE_DEFLECTION;

/**
 * Where the fade begins, as a fraction of {@link SKY_FADE_IMPACT}.
 *
 * What is faded is the deflection itself and not the picture's opacity: across this band the ray's
 * outgoing direction is eased back towards the straight line it would have followed, so at the outer
 * edge the quad draws the background's own sky, pixel for pixel, and there is nothing to see the
 * edge by. Fading the opacity instead would leave the band showing two copies of the same star field
 * a few pixels apart, which is a good deal more visible than the lensing being switched off is.
 *
 * Exported for the same reason {@link SKY_FADE_IMPACT} is: {@link BodyLensPass} eases the bodies out
 * across the same band, so the two halves of the picture are let go together.
 *
 * @type {number}
 */
export const SKY_FADE_START = 0.5;

/**
 * Where in the frame the quad is drawn when it is tracing the sky.
 *
 * Before the bodies, which is the opposite end of the frame from where it goes without a sky, and the
 * difference is the whole of how a traced sky composes with the rest of the scene. Holding gas and
 * shadow only, the quad belongs *over* the bodies: transparent, blended, drawn after them; see
 * {@link OVERLAY_RENDER_ORDER}. Holding the sky as well, it belongs under everything, because the sky
 * is the one thing in a frame that every other thing is in front of.
 *
 * Left as an overlay it would erase them instead, and not marginally. The traced region reaches
 * {@link SKY_FADE_IMPACT} horizon radii, so from anywhere inside a hundredth of an astronomical unit of
 * a hole this size the quad covers the whole viewport and replaces it opaquely — the Sun, the planets,
 * every orbit line and marker, and the hole's own moon, which is inside the traced region in every view
 * that has the hole in it as well, twenty radii being about as far out as a moon can be put and still
 * be seen with it.
 *
 * So when it traces, the quad composites the sky into its own colour, writes it opaque, and is drawn as
 * background. The bodies then draw over it in the ordinary way, and the disc at the shadow's radius
 * writes the depth that keeps what is behind the hole behind it — and, sitting a hair behind the hole's
 * centre where this quad is exactly at it, keeps what is in front of the hole in front of this quad as
 * well. Nothing about the quad itself can do that: it has one depth per fragment and two things to
 * place, the gas at the hole and the sky at infinity. What orbits close enough for the difference to
 * show is not depth tested against the quad at all — it is traced inside it; see
 * {@link AccretionDisk#setCompanion}.
 *
 * It also disposes of a threshold. An overlay would have to decide per pixel whether the sky it has
 * computed is worth destroying what is underneath — a comparison against the displacement in
 * pixels, with a crossfade to hide the comparison. Drawn underneath, there is nothing to destroy: the
 * quad writes the sky it computed everywhere, which at the fade's outer edge is the same sky three.js
 * would have drawn there: the same direction into the same cube map, at the same intensity, in the same
 * linear space. The background's own `flipEnvMap` is the one thing that could make it a different
 * direction, and it is `+1` here because the skybox is a render target rather than loaded faces.
 *
 * The occluder has to *precede* this rather than merely be somewhere in the opaque pass, because it is
 * black as well as depth-writing and would otherwise paint over the gas crossing the silhouette; see
 * {@link BlackHoleEffects.addShadowOccluder}.
 *
 * @type {number}
 */
export const BACKGROUND_RENDER_ORDER = -2;

/**
 * Where the quad is drawn when it has no sky to trace.
 *
 * After the opaque bodies so it composites over them, and before the photon ring, which belongs on top
 * of the silhouette the quad draws.
 *
 * @type {number}
 */
const OVERLAY_RENDER_ORDER = 1;

/**
 * How far the inner disc may wind ahead of the outer disc, in radians, before the gas is renewed.
 *
 * Keplerian shear cannot simply be left to run. The pattern's radial frequency grows in proportion
 * to how long it has been shearing, so every part of it eventually becomes finer than a pixel, and
 * {@link sampleDisc}'s band limit then quite correctly erases it: the disc winds itself smooth and
 * stops appearing to turn at all. Measured at a close view, the filaments keep about four fifths of
 * their contrast for the first couple of seconds and a tenth of it after a minute.
 *
 * So the shear is bounded instead. Two copies of the gas are kept, sheared from different starting
 * moments and crossfaded, and each is replaced by a freshly seeded one once it has wound this far —
 * the disc is continuously renewed rather than smeared out, and about three fifths of the contrast
 * survives indefinitely. What this number sets is the trade: the shear is what makes the gas stream
 * into spirals, so a larger value gives a stronger spiral and a longer interval between renewals,
 * at the cost of the pattern being finer, and so more filtered, at the end of each interval. A full
 * turn of relative winding is a good balance — a visible spiral, renewed every fifteen seconds or
 * so at the default rotation rate, keeping just over half the contrast at the worst moment.
 *
 * It is in radians rather than seconds so that it means the same thing whatever `swirlSpeed` and the
 * disc's radii are set to; the interval in seconds is derived from those.
 *
 * @type {number}
 */
const SHEAR_LIMIT = 6.283;

/**
 * How much of each renewal interval the crossfade leaves alone, at each end.
 *
 * The two copies of the gas are worth very different amounts for most of an interval: at the start
 * the incoming one still has almost a whole {@link SHEAR_LIMIT} of winding on it and is filtered
 * nearly flat, and at the end the outgoing one is in the same state. Crossfading across the entire
 * interval therefore spends a good deal of the time mixing in a copy that contributes a percent or
 * two of something already smooth.
 *
 * So the crossfade is finished early and started late, and in the margins the weight is not merely
 * small but exactly zero or exactly one — which means the copy on the other side of it need not be
 * sampled at all, and skipping it is not an approximation with a threshold to be tuned and a step to
 * be seen at. It saves three layers of noise on a quarter of the samples, and because the weight
 * depends on the time and nothing else, every pixel in the frame takes the same branch on the same
 * frame. Measured across a range of times the contrast the bounded shear exists to preserve does not
 * move: 1.230 against 1.228.
 *
 * @type {number}
 */
const CROSSFADE_MARGIN = 0.2;

/**
 * Scratch objects, reused to avoid per-frame allocation.
 *
 * @type {THREE.Vector3}
 */
const _centre = new THREE.Vector3();
const _basisX = new THREE.Vector3();
const _basisY = new THREE.Vector3();
const _basisZ = new THREE.Vector3();
const _companionX = new THREE.Vector3();
const _companionY = new THREE.Vector3();
const _companionZ = new THREE.Vector3();
const _companionOffset = new THREE.Vector3();
const _quadCentre = new THREE.Vector3();
const _viewAxis = new THREE.Vector3();
const _cameraX = new THREE.Vector3();
const _cameraY = new THREE.Vector3();
const _cameraZ = new THREE.Vector3();
const _frameNormal = new THREE.Vector3();
const _frameCorner = new THREE.Vector3();

/**
 * Stands in for a missing companion list, so that no companion is a frame with no allocation in it.
 *
 * @type {Body[]}
 */
const EMPTY_COMPANIONS = [];

/**
 * Vertex shader for the accretion disc: a plain billboard.
 *
 * What is handed on is a point on the quad, which the fragment stage turns into a viewing ray —
 * not a position on the disc. The disc's geometry exists nowhere in this shader; it is found by
 * following that ray.
 *
 * It is handed on as an offset from the hole's centre rather than as a world position, and that is
 * not a convenience. The offset is the model matrix's linear part applied to the corner, with the
 * translation left out, so it is formed at the quad's own size — hundredths of a scene unit — and
 * keeps every digit of a float32. A world position could not: the hole is a fraction of a
 * thousandth of a scene unit across and orbits hundreds of units out, so a world position near it
 * is quantised in steps a tenth of the horizon's radius wide, and the fragment stage would be
 * differencing two of them. See {@link AccretionDisk#update}, which does the other half of the
 * same subtraction on the CPU.
 *
 * `modelViewMatrix` for the position, rather than `viewMatrix * modelMatrix`. They are the same
 * matrix in exact arithmetic, but three.js composes the first on the CPU in double precision, so
 * what reaches the shader already carries the small camera-relative translation. Multiplying the
 * two here instead cancels two large translations against each other in float32, which leaves the
 * quad — and the ray directions interpolated across it — trembling by several pixels as the camera
 * moves.
 *
 * Leaving the translation out is also what makes this shader serve a quad that is *not* centred on
 * the hole, which the companion's own quad is not; see {@link AccretionDisk#createCompanionQuad}. A
 * quad's corner is then two offsets added rather than one — the corner from the quad's centre, and
 * the quad's centre from the hole's — and both are small enough to add exactly. Taking the offset
 * from the matrix's translation instead would put the hole's world position into the sum, which is
 * the one quantity in this shader that cannot be represented. `uQuadOffset` is zero on the disc's
 * own quad, where the two centres coincide.
 *
 * @type {string}
 */
const vertexShader = `
uniform vec3 uQuadOffset;

varying vec3 vDiscOffset;

void main() {
    vDiscOffset = mat3(modelMatrix) * position + uQuadOffset;

    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

/**
 * Fragment shader for the accretion disc: traces a photon path per pixel.
 *
 * The disc is not drawn as a surface, because the interesting half of it is *behind* the hole
 * and no surface put there can be seen. Light from it reaches the eye anyway — bent around the
 * hole — and the only way to draw where it arrives is to work backwards along the path it took.
 * So every pixel starts a ray at the camera, follows it through the curved space around the
 * hole, and collects whatever gas it passes through. The far side of the disc consequently
 * appears above and below the shadow, wrapped over it, which is the whole point.
 *
 * Everything is done in the disc's own frame, in units of the Schwarzschild radius: the camera
 * and the pixel's direction are rotated into it once, and from then on the disc lies in the
 * plane `y = 0` with the hole at the origin and its horizon at radius 1. That is what makes the
 * relativity below simple enough to evaluate per pixel per step.
 *
 * The path itself. A photon's path around a Schwarzschild hole is planar — the plane through the
 * camera, the hole and the direction of travel — and in that plane, written in terms of the
 * inverse radius `w = r_s / r` as a function of the angle swept, it obeys
 * `w'' = -w + 1.5 w²` exactly. No approximation, no fudge factor. The first term alone is a
 * straight line in polar coordinates; the second is gravity, and it is why light near a black
 * hole can turn through any angle at all, including all the way around. It is integrated with
 * fourth-order Runge–Kutta, which at this step size tracks the critical impact parameter — the
 * knife edge between escaping and falling in, `3√3 / 2` — to five figures. That number is the
 * shadow's radius, so getting it right is what makes the silhouette the right size without ever
 * being told what size to be.
 *
 * The gas. The disc is a slab, and each step's contribution is the length of path that step
 * spends inside it, worked out from the height above the plane at the step's two ends. Clipping
 * the step against the slab rather than sampling its midpoint matters more than it sounds: a
 * steeply crossing ray can step clean over a slab this thin, and a midpoint test loses the disc
 * altogether over most of a face-on view. For the same reason the step length is capped in
 * radius as well as in angle; see {@link RADIAL_STEP_LIMIT}, and {@link SLAB_STEP} for the cap
 * that keeps a crossing from being answered for by a single sample. What the gas thins by across
 * the slab is then averaged over the crossing in closed form rather than evaluated anywhere in
 * particular, since a step may well be the only one the crossing gets.
 *
 * Each step also works out how much of the disc its one sample of the gas is standing for — the
 * stretch of path it was taken from, or the pixel it lands in, whichever is coarser — because the
 * gas has structure finer than either and it has to be filtered rather than merely sampled. That
 * is where the disc's speckle came from, and it is not something a finer step could fix; see
 * {@link sampleDisc}.
 *
 * Emission and absorption are accumulated together, from the camera outwards, so gas in front
 * dims what is behind it. That is what makes the near side of the disc hide the far side where
 * they overlap, and what lets the disc be seen through where it is thin — and, since the march
 * stops once nothing more could show through, it is also what bounds the cost of the worst
 * pixels.
 *
 * A ray that falls in returns opaque black. That is the shadow, and with no sky to trace it is the
 * reason this is blended with premultiplied alpha rather than added: emission has to add to what is
 * behind it, while capture has to *replace* it. Additive blending cannot express the second, and a
 * black hole that cannot hide the stars behind it does not read as one. Tracing the sky, the ray
 * knows what is behind it and the question does not arise — every fragment is a finished colour.
 *
 * A ray that does not fall in and never meets the gas has still been somewhere, and the sky is what
 * is there. Those rays are the great majority of the quad and they get the same treatment cheaply:
 * both straight ends of the path closed in {@link straightSweep}, only the turn integrated, and the
 * outgoing direction used to read the skybox's cube map. That is the lensing — the Einstein ring, the
 * sky drawn round the outside of the shadow, the second image of everything behind the hole — and
 * having it here rather than as a warp of the finished frame is what makes it *true*: it is the same
 * paths, so it agrees with the silhouette and with the disc's own arcs by construction, and it can
 * show the sky from behind the hole, which no rearrangement of this frame's pixels contains.
 *
 * Having the sky also means the ray leaves here with the finished colour of its pixel rather than with
 * something to blend over what was there, and that is what lets the quad be drawn *under* the scene
 * instead of over it. Which is not a detail of ordering: the traced region is four hundred horizon radii
 * wide, so as an overlay it hides everything else on screen from any view close enough to see the hole
 * properly, the hole's own moon included. See {@link BACKGROUND_RENDER_ORDER}.
 *
 * The rest is the same physics of a hot orbiting gas the disc has always been drawn with —
 * temperature falling outwards, filaments sheared by Keplerian rotation, Doppler beaming — with
 * one difference that comes free with ray tracing: the beaming is computed from the direction
 * the photon actually left the gas travelling, rather than from the straight line to the camera.
 * Near the shadow those differ enormously, which is why the beaming stays right on the parts of
 * the disc seen around the back.
 *
 * @type {string}
 */
const fragmentShaderMainCode = `
#define MAX_STEPS ${MAX_STEPS}
#define ANGLE_STEP ${ANGLE_STEP.toFixed(4)}
#define RADIAL_STEP_LIMIT ${RADIAL_STEP_LIMIT.toFixed(4)}
#define DISC_FLARE ${DISC_FLARE.toFixed(4)}
#define STRAIGHT_PATH_SINE ${STRAIGHT_PATH_SINE.toFixed(4)}
#define ESCAPE_OUTER_FACTOR ${ESCAPE_OUTER_FACTOR.toFixed(2)}
#define MIN_TRANSMITTANCE ${MIN_TRANSMITTANCE.toFixed(4)}
#define SKY_ANGLE_STEP ${SKY_ANGLE_STEP.toFixed(4)}
#define SKY_FADE_START ${SKY_FADE_START.toFixed(4)}
#define SHEAR_LIMIT ${SHEAR_LIMIT.toFixed(4)}
#define CROSSFADE_MARGIN ${CROSSFADE_MARGIN.toFixed(4)}
#define COMPANION_STEP ${COMPANION_STEP.toFixed(4)}
#define COMPANION_MIN_PATH ${COMPANION_MIN_PATH.toFixed(4)}
#define COMPANION_AMBIENT ${COMPANION_AMBIENT.toFixed(4)}
#define MAX_COMPANIONS ${MAX_COMPANIONS}

uniform float uTime;
uniform vec3 uCameraOffset;
uniform mat3 uToDisc;
uniform float uSlabStep;
uniform float uHorizonRadius;
uniform float uInnerRadius;
uniform float uOuterRadius;
uniform vec3 uInnerColor;
uniform vec3 uOuterColor;
uniform float uIntensity;
uniform float uOpacity;
uniform float uEmissionFalloff;
uniform float uNoiseScale;
uniform float uSwirlSpeed;
uniform float uTurbulence;
uniform float uBeamingStrength;
uniform samplerCube uSky;
uniform float uSkyIntensity;
uniform float uSkyFadeImpact;
uniform vec3 uCompanionCentre[MAX_COMPANIONS];
uniform float uCompanionRadius[MAX_COMPANIONS];
uniform mat3 uCompanionToLocal[MAX_COMPANIONS];
uniform vec3 uCompanionLight[MAX_COMPANIONS];
uniform vec3 uCompanionLightColor[MAX_COMPANIONS];
uniform sampler2D uCompanionTexture[MAX_COMPANIONS];

// Which of the companions this quad is the carrier for, and so the only one it draws. Only the
// companion quads have one; see {@link AccretionDisk#createCompanionQuad}.
#ifdef COMPANION_ONLY
uniform int uQuadCompanion;
#endif

varying vec3 vDiscOffset;

/**
 * The angle a nearly straight length of path sweeps between a radius and infinity.
 *
 * The path's own first integral, w'² + w² - w³ = 1/b², rearranges into the angle as an integral over
 * the inverse radius, and dropping the w³ under the root leaves asin(b w) — the straight line, in
 * polar coordinates. Keeping that term to first order gives the correction here, which is the whole
 * difference between a line and a photon path this far out, and it is a large improvement for four
 * operations: at the sine this is used at, the plain arcsine is three pixels out where this is a
 * hundredth of one.
 *
 * The sine of the path's angle to the radial direction, b w, is what the accuracy depends on
 * rather than the radius, which is why {@link STRAIGHT_PATH_SINE} is stated as one; the expansion is
 * in how much of the remaining path is transverse. It diverges as that sine reaches 1 — the turning
 * point, where the path is momentarily circular and nothing about it is straight.
 */
float straightSweep(in float impact, in float w) {
    float sine = min(impact * w, 1.0);
    float cosine = sqrt(max(1.0 - sine * sine, 1e-8));

    return asin(sine) - (0.5 / impact) * (1.0 / cosine + cosine - 2.0);
}

/**
 * The photon path's curvature: the right-hand side of w'' = -w + 1.5 w².
 */
float pathCurvature(in float w) {
    return -w + 1.5 * w * w;
}

/**
 * Whether this ray's own path plane comes within a companion's radius of its centre.
 *
 * True where the ray could reach that companion and false where nothing it does can. A Schwarzschild
 * path stays in the plane through the camera, the direction of travel and the hole's centre, so a
 * sphere further from that plane than its own radius is unreachable however the path bends — one dot
 * product, exact, and it is the whole of the cost control for the companions; see
 * {@link AccretionDisk#createCompanionQuad}.
 *
 * An empty slot answers false without being asked separately, its radius being zero, which is why
 * nothing else in the shader tests for one.
 *
 * Handed the sphere rather than an index into the uniform arrays, for the reason given at
 * {@link companionSurface}: the caller reads the arrays at a loop index, where indexing them is
 * something GLSL ES promises to support.
 *
 * @param radius The companion's radius, in horizon radii.
 * @param centre Its centre, as an offset from the hole in the disc's frame.
 * @param planeNormal Unit normal of the ray's path plane, in the disc's frame.
 */
bool companionReachable(in float radius, in vec3 centre, in vec3 planeNormal) {
    return radius > abs(dot(centre, planeNormal));
}

/**
 * The colour of a traced companion's surface, at the point a ray struck it.
 *
 * The same surface {@link PlanetShaderMaterial} draws, computed the same way — an equirectangular
 * texture read at the point's own latitude and longitude, Lambertian against the star with a low
 * ambient floor — because it is the same body. The tracer takes it over rather than adding to it; see
 * {@link AccretionDisk#setCompanion}. So the two have to agree, and the way to make them agree is to
 * work from the body's own material every frame rather than from a copy of its settings: the texture,
 * the light's direction and the light's colour all arrive here as that material's own uniforms.
 *
 * The mapping is SphereGeometry's, which is what the body's mesh is built from: longitude measured
 * from the negative x axis towards positive z, latitude from the equator, both in the body's local
 * frame so the texture turns with the body's rotation. Wrapped with a fract rather than left to the
 * sampler, since a surface texture is under no obligation to repeat and this one does not.
 *
 * Two known artefacts, both of the same cause and both a pixel wide. The fetch is inside a branch that
 * neighbouring pixels do not all take, so its derivatives — which is to say its mip level — are
 * undefined at the silhouette; and the fract puts a discontinuity down the far meridian, where the
 * derivative is real but enormous. Interior pixels, which is all of it but those two lines, have
 * neighbours in the same branch and choose the level correctly.
 *
 * What is *not* here is any of the shadowing {@link PlanetShaderMaterial} does: no rings, and no
 * eclipses by other bodies. The bodies in a position to eclipse this surface are the hole itself and the
 * other companions, and the light reaching all of them is bent — a shadow the straight-line test could
 * not find and this shader does not follow the Sun's rays far enough to trace. Blocking the *view* of a
 * surface is a different question and is answered, since the march takes the first sphere the ray
 * crosses whichever slot it belongs to; it is being lit that ignores the neighbours.
 *
 * @param surface The companion's texture.
 * @param toLocal Rotation from the disc's frame to the body's own.
 * @param light Unit direction to the star, in the disc's frame.
 * @param lightColor The star's colour.
 * @param normal Outward unit normal at the point struck, in the disc's frame.
 */
vec3 companionShade(in sampler2D surface, in mat3 toLocal, in vec3 light, in vec3 lightColor,
        in vec3 normal) {
    vec3 local = toLocal * normal;

    vec2 uv = vec2(
        fract(atan(local.z, -local.x) * 0.15915494),
        0.5 + asin(clamp(local.y, -1.0, 1.0)) * 0.31830989);

    vec3 base = texture2D(surface, uv).rgb;
    float hemisphere = max(dot(normal, light), 0.0);

    return base * lightColor * (hemisphere + COMPANION_AMBIENT);
}

/**
 * Shades whichever companion the march found, chosen by a slot the march worked out.
 *
 * Written out once per slot against a literal index rather than indexing the uniform arrays with the
 * value, because that value is not a constant-index-expression and GLSL ES 1.00 only *optionally*
 * supports indexing a uniform array with one — mandatorily for a constant or a loop index, and for
 * samplers not even then. So the array reads all happen here against literals and everything past this
 * point is handed the values instead; see {@link companionShade} and {@link companionReachable}. What it
 * costs is a comparison per slot on the one fragment in a frame that struck a surface, and the
 * unwritable alternative is a lookup the driver is allowed to refuse to compile.
 *
 * @param index Which companion was struck; nothing is drawn for a slot outside the array.
 * @param normal Outward unit normal at the point struck, in the disc's frame.
 */
vec3 companionSurface(in int index, in vec3 normal) {
${Array.from({ length: MAX_COMPANIONS }, (unused, index) => `    if (index == ${index}) {
        return companionShade(uCompanionTexture[${index}], uCompanionToLocal[${index}],
            uCompanionLight[${index}], uCompanionLightColor[${index}], normal);
    }`).join('\n')}

    return vec3(0.0);
}

/**
 * A hash and a value noise for the gas, in place of the shared pair in ShaderLoader.
 *
 * The disc keeps its own because it is the one shader that calls noise dozens of times per pixel —
 * three layers per copy of the gas, two copies, once for every step that touches the slab, which at
 * a close view is around forty calls and so three hundred hashes. The shared hash costs a sine
 * apiece; this one is multiplies and fractional parts only, and nothing else in the scene calls
 * noise anywhere near often enough to be worth the divergence.
 *
 * It is a different arrangement of the same idea, not a cheaper approximation of it: both draw a
 * value per lattice point from the fractional part of a rapidly varying function and interpolate
 * with the same smoothstep, so the field has the same character, the same cell size and the same
 * distribution. Measured over three hundred thousand lattice points the two agree on mean and
 * variance to a part in a thousand, and this one is the better behaved of the two — the sine's
 * argument grows with the coordinate until float32 cannot resolve one lattice point from the next,
 * which is exactly where the seeds below put it, while this stays uniform there. What does change is
 * which value lands on which cell, so the filaments come out in different places; the disc looks
 * like itself, not like the same disc.
 */
float discRandom(in vec3 position) {
    vec3 p = fract(position * 0.1031);
    p += dot(p, p.yzx + 33.33);
    return fract((p.x + p.y) * p.z);
}

float discNoise(in vec3 position) {
    vec3 cell = floor(position);
    vec3 f = fract(position);
    f = f * f * (3.0 - 2.0 * f);

    return mix(
        mix(mix(discRandom(cell), discRandom(cell + vec3(1.0, 0.0, 0.0)), f.x),
            mix(discRandom(cell + vec3(0.0, 1.0, 0.0)), discRandom(cell + vec3(1.0, 1.0, 0.0)), f.x),
            f.y),
        mix(mix(discRandom(cell + vec3(0.0, 0.0, 1.0)), discRandom(cell + vec3(1.0, 0.0, 1.0)), f.x),
            mix(discRandom(cell + vec3(0.0, 1.0, 1.0)), discRandom(cell + vec3(1.0, 1.0, 1.0)), f.x),
            f.y),
        f.z);
}

/**
 * How much of a noise layer's contrast survives being sampled once over a given span.
 *
 * A sample standing for a cell or less of the layer is a sample of it and comes through whole.
 * Much beyond that it is not measuring the field any more, it is drawing from it, so the layer is
 * faded out rather than left to turn into static. The honest answer for a box filter over one
 * frequency is a sinc, which changes sign and would invert the pattern; this has the same shape
 * over the range where the layer is still visible, and falls away monotonically past it.
 *
 * @param cellSpan - The span the sample stands for, in cells of the layer being filtered.
 */
float noiseDetail(in float cellSpan) {
    return 1.0 / (1.0 + cellSpan * cellSpan);
}

/**
 * How dense one copy of the gas is at a point, given how far that copy has sheared.
 *
 * Three layers of noise sampled in a sheared angle: two of banding and one of finer filaments.
 * Each is handed the size of the region this one sample stands for and has its contrast faded as
 * that grows past its own cell, which is what keeps the shear from turning into speckle. Every
 * layer fades towards its own mean, so losing one removes its structure without changing the
 * disc's brightness.
 *
 * The seed displaces the sample bodily through the noise, far enough that a copy taken with a
 * different one is an unrelated pattern rather than a shifted view of the same one.
 *
 * @param phase - Angle in the disc, already sheared by this copy's winding.
 * @param wind - How far this copy has wound, in radians, which is what tightens it in radius.
 * @param footprint - The extent of the disc, in Schwarzschild radii, this sample stands for.
 * @param seed - Where in the noise this copy of the gas is read from.
 */
float gasDensity(in float phase, in float edge, in float wind, in float radius,
                 in float footprint, in vec3 seed) {
    // How much of the noise the footprint covers, in cells, for a layer of unit frequency. The
    // sampling angle moves with the footprint two ways - the shear carries it 1.5 * wind / radius
    // radians per unit radius, and going round the disc carries it 1 / radius - and the radial
    // profile moves it along the noise's third axis. Each layer scales all of that by its own
    // frequency below.
    float span = max(uOuterRadius - uInnerRadius, 1e-6);
    float phaseSpan = (1.5 * abs(wind) + 1.0) * footprint / radius;
    float edgeSpan = footprint / span;

    float bandSpan = uNoiseScale * (phaseSpan + 2.0 * edgeSpan);
    float filamentSpan = uNoiseScale * 0.6 * (phaseSpan + 9.0 * edgeSpan);

    vec3 bandCoord = vec3(cos(phase), sin(phase), edge * 2.0) * uNoiseScale + seed;
    float density = mix(0.5, discNoise(bandCoord), noiseDetail(bandSpan)) * 0.65
                  + mix(0.5, discNoise(bandCoord * 2.7), noiseDetail(bandSpan * 2.7)) * 0.35;

    vec3 filamentCoord = vec3(cos(phase), sin(phase), edge * 9.0) * uNoiseScale * 0.6 + seed;
    float filament = mix(1.0, discNoise(filamentCoord) * 2.0, noiseDetail(filamentSpan));
    return mix(density, density * filament, uTurbulence);
}

/**
 * What the gas at a point in the disc looks like, and how much of it there is.
 *
 * Returns the emitted colour in rgb and the density in a. The colour is the temperature gradient
 * shifted by the Doppler factor; the density comes from {@link gasDensity}, turning with the disc.
 *
 * The rotation is split in two, because the two halves behave completely differently under the
 * band limit. Orbital angular velocity goes as r^(-3/2), so the inner disc laps the outer one, and
 * it is only that *difference* in rate that tightens the pattern in radius. The part they have in
 * common - taken here as the outer edge's rate, the fastest rate that leaves the difference
 * one-signed - turns the whole pattern rigidly. Rigid rotation has no radial gradient at all, so it
 * costs the filter nothing and can be left running for as long as the page is open: it is what makes
 * the disc visibly, permanently spin, at any distance and however smooth the gas has been filtered.
 *
 * The difference is the part that has to be bounded, and it is handled by keeping two copies of the
 * gas at once. Each is sheared from its own starting moment and seeded differently, and they are
 * crossfaded, so a copy is always being retired just as it winds past {@link SHEAR_LIMIT} while its
 * replacement is arriving unwound. The gas is therefore continuously renewed instead of winding
 * itself smooth, which is where an unbounded shear ends: a featureless band that no longer reads as
 * turning at all.
 *
 * Both the copy in use and the crossfade between them are functions of time alone. That is the
 * point rather than a simplification: a crossfade timed per radius would put neighbouring radii at
 * different points in their cycle, and the weight between the two unrelated copies would then wind
 * up in radius exactly as the shear it was brought in to bound - measurably past a cycle per pixel
 * within a few minutes, which the filter cannot help with because it is not a noise layer.
 *
 * @param verticalFade - How much of the slab's vertical profile this sample sees, averaged over
 *   the part of the step inside it rather than taken at a point; the caller works it out, since
 *   only the caller knows where the step entered and left. See the march in main().
 * @param footprint - The extent of the disc, in Schwarzschild radii, this sample stands for.
 */
vec4 sampleDisc(in vec3 point, in vec3 travel, in float radius, in float verticalFade,
                in float footprint) {
    float span = max(uOuterRadius - uInnerRadius, 1e-6);
    float edge = clamp((radius - uInnerRadius) / span, 0.0, 1.0);

    // Orbital rate as r^(-3/2), written as a square root rather than a power because this runs
    // once per sample and a power is a logarithm and an exponential where this is neither.
    float outerRatio = uInnerRadius / uOuterRadius;
    float rigidRate = uSwirlSpeed * outerRatio * sqrt(outerRatio);
    float localRatio = uInnerRadius / radius;
    float shearRate = uSwirlSpeed * localRatio * sqrt(localRatio) - rigidRate;
    float angle = atan(point.z, point.x) - uTime * rigidRate;

    // Which pair of copies is live, and how far between them. The interval is however long the
    // inner edge takes to wind SHEAR_LIMIT ahead of the outer one; the smoothstep spends the time
    // on one copy or the other rather than halfway between, where two unrelated patterns partly
    // cancel and the gas is at its flattest. It is held at exactly one end or the other for the
    // margins at each end of the interval, which is what lets the far copy be dropped there; see
    // {@link CROSSFADE_MARGIN}.
    float interval = SHEAR_LIMIT / max(uSwirlSpeed - rigidRate, 1e-4);
    float cycle = uTime / interval;
    float copy = floor(cycle);
    float elapsed = cycle - copy;
    float blend = smoothstep(0.0, 1.0,
        clamp((elapsed - CROSSFADE_MARGIN) / (1.0 - 2.0 * CROSSFADE_MARGIN), 0.0, 1.0));

    // Each copy shears from the moment it was seeded: the outgoing one has a full interval of
    // winding behind it, the incoming one has yet to start. Linear in time, unlike the crossfade
    // between them - the gas has to keep turning at its own steady rate whatever the crossfade is
    // doing, and easing this too would have the disc speeding up and slowing down every interval.
    float wind0 = shearRate * interval * elapsed;
    float wind1 = shearRate * interval * (elapsed - 1.0);

    // Where in the noise each copy is read from. Successive copies are placed by the three
    // dimensional low-discrepancy sequence, which spreads them through the field without ever
    // repeating a spacing, so no two live at once anywhere near each other; a fixed stride along one
    // axis would march off to coordinates where a hash has nothing left to work with. Wrapped after
    // a few hundred copies, which is hours of running, and what recurs is a seed rather than a view.
    vec3 seed0 = fract(mod(copy, 512.0) * vec3(0.7548777, 0.5698403, 0.3245224)) * 32.0;
    vec3 seed1 = fract(mod(copy + 1.0, 512.0) * vec3(0.7548777, 0.5698403, 0.3245224)) * 32.0;

    float density;
    if (blend <= 0.0) {
        density = gasDensity(angle - wind0, edge, wind0, radius, footprint, seed0);
    } else if (blend >= 1.0) {
        density = gasDensity(angle - wind1, edge, wind1, radius, footprint, seed1);
    } else {
        density = mix(
            gasDensity(angle - wind0, edge, wind0, radius, footprint, seed0),
            gasDensity(angle - wind1, edge, wind1, radius, footprint, seed1),
            blend);
    }
    density = clamp(density, 0.0, 1.5);

    float emission = pow(uInnerRadius / radius, uEmissionFalloff);
    float innerFade = smoothstep(0.0, 0.05, edge);
    float outerFade = 1.0 - smoothstep(0.55, 1.0, edge);

    // Orbital velocity, prograde in the direction of increasing atan(z, x) so the beaming
    // agrees with the way the filaments visibly turn.
    vec3 orbitDirection = normalize(vec3(-point.z, 0.0, point.x));
    float beta = sqrt(0.5 / max(radius, 1.0));
    float approach = dot(orbitDirection, -travel);

    float doppler = 1.0 / max(1.0 - beta * approach, 0.05);
    float beaming = mix(1.0, doppler * doppler * doppler, uBeamingStrength);

    float inward = 1.0 - edge;
    vec3 color = mix(uOuterColor, uInnerColor, inward * inward);
    color = mix(color, vec3(0.80, 0.88, 1.00), clamp(approach * beta * 1.6, 0.0, 0.7));
    color = mix(color, vec3(1.00, 0.42, 0.12), clamp(-approach * beta * 1.6, 0.0, 0.7));

    float amount = uOpacity * emission * innerFade * outerFade * verticalFade * (0.35 + density);

    return vec4(color * uIntensity * beaming, max(amount, 0.0));
}

void main() {
    // Both already relative to the hole's centre, one from the CPU and one from the quad, because
    // neither can be formed here — see {@link AccretionDisk#update}.
    vec3 origin = uToDisc * uCameraOffset / uHorizonRadius;
    vec3 target = uToDisc * vDiscOffset / uHorizonRadius;
    vec3 direction = normalize(target - origin);

    // The angle one pixel covers, which is what the gas is filtered against; see
    // {@link sampleDisc}. Taken here, from the quad, because a derivative is only meaningful
    // where every pixel is still doing the same thing — by the time the march has started, no
    // two neighbours are on the same step any more.
    float pixelAngle = length(fwidth(direction));

    float cameraDistance = length(origin);
    if (cameraDistance <= 1.0001) discard;

    // The path's plane, as a basis: outwards towards the camera, and along the direction of
    // travel. A ray aimed exactly at the centre has no such plane and no crossings — it is the
    // middle of the shadow.
    vec3 outward = origin / cameraDistance;
    vec3 axis = cross(origin, direction);
    float axisLength = length(axis);
    if (axisLength < 1e-6) {
        gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
        return;
    }
    vec3 planeNormal = axis / axisLength;
    vec3 along = normalize(cross(planeNormal, outward));

    // Whether this ray could reach any companion at all, which is worth settling before anything else
    // because for all but a few of them it cannot; see {@link companionReachable}. What survives is a
    // stripe of the screen running through the hole and each companion's image, since those are the
    // planes that cut them.
    //
    // Everything the companions cost is inside this flag: the sphere tracing that finds a surface, and
    // the two limits below that stop the analytic shortcuts from jumping over one. The loop itself is
    // a dot product apiece over a fixed handful of slots, most of them usually empty; see
    // {@link MAX_COMPANIONS}.
    bool hasCompanion = false;

    // How far out the reachable surfaces reach. The shortcuts have to stay outside all of them, so it
    // is the furthest that binds — and only of the ones this ray can reach, since a companion whose
    // plane this ray misses is not something the march has to stay short of.
    float companionOuter = 0.0;

    for (int i = 0; i < MAX_COMPANIONS; i++) {
        if (!companionReachable(uCompanionRadius[i], uCompanionCentre[i], planeNormal)) continue;

        hasCompanion = true;
        companionOuter = max(companionOuter,
            length(uCompanionCentre[i]) + uCompanionRadius[i]);
    }

// On a companion's own quad this same flag is the whole cost control, and it is why those quads can
// be scaled generously: they draw nothing but a companion, so every pixel whose plane misses all of
// them has no reason to be traced at all and leaves here. What is left to march is the stripe; see
// {@link AccretionDisk#createCompanionQuad}.
#ifdef COMPANION_ONLY
    if (!hasCompanion) discard;
#endif

    // The disc's normal is (0, 1, 0) in this frame, so the height of the path above the disc is
    // just the y component of its position, and these two are all that is needed to find it.
    float heightOutward = outward.y;
    float heightAlong = along.y;

    float w = 1.0 / cameraDistance;
    float wSlope = -w * dot(direction, outward) / max(dot(direction, along), 1e-4);
    float angle = 0.0;

    // The impact parameter, from the conserved quantity rather than from the geometry. w'² + w² - w³
    // is a constant of the path equal to 1/b², so this is the b the traced path actually has — which
    // is not quite the b the ray was aimed with, r sin(theta), because that identity holds in flat
    // space and the seeding above is exact in this one. The two differ by a part in r³. Small, but
    // everything downstream is a comparison against b or a division by it, and the one place it shows
    // is the one that matters: the remaining sweep taken with the geometric value overshoots by up to
    // half a degree, which around the shadow's rim is where the sky's own image is.
    float impact = 1.0 / sqrt(max(wSlope * wSlope + w * w - w * w * w, 1e-12));

    // Rays that cannot reach the gas, settled before any of them is traced. From beyond the outer
    // edge there are two such cases, and the path's own first integral decides both without
    // integrating anything. One is a ray already heading outwards: w' < 0, and w'' = -w + 1.5w² is
    // also negative anywhere outside r = 1.5, so w only ever falls and the ray leaves. The other is
    // a ray heading in but not far enough — the turning point sits at b² = r_p³ / (r_p - 1), which
    // increases with r_p out here, so an impact parameter above the outer edge's own value means the
    // ray turns back short of the disc.
    //
    // Both are exact rather than conservative, and worth having for it: checked pixel for pixel
    // against the full march, the disc does not change at all. In practice it is the turning point
    // that does the work, since a billboard always sits between the camera and the hole and so every
    // ray through it starts out heading inwards — the outward case is kept because it is a comparison
    // and it is what makes the claim above true of any ray rather than of these ones.
    //
    // These rays are not discarded, though, because there is something behind them: the sky, bent.
    // They are the great majority of the quad — all of it, past a few hundred radii — and what they
    // cost is a tenth of what a ray through the gas does, since the whole of the machinery below is
    // skipped and only where the ray ends up is wanted. Where there is no sky to bend they are
    // discarded.
    float outerTurning = uOuterRadius * uOuterRadius * uOuterRadius / max(uOuterRadius - 1.0, 1e-4);
    bool skyOnly = cameraDistance > uOuterRadius
            && (wSlope < 0.0 || impact * impact > outerTurning);

    // Kept when it could reach a companion, whatever the sky is doing. Without that this would throw
    // away the companions outright wherever there is no sky to trace, since a ray that reaches a body
    // orbiting outside the gas is a ray that cannot reach the gas — which is the whole of what this
    // test asks.
    if (skyOnly && !hasCompanion && (uSkyFadeImpact <= 0.0 || impact > uSkyFadeImpact)) {
        discard;
    }

    // Finished when the path is heading out, running nearly radially, and clear of the gas; see
    // {@link STRAIGHT_PATH_SINE} and {@link ESCAPE_OUTER_FACTOR}.
    float escapeW = min(STRAIGHT_PATH_SINE / impact, 1.0 / (uOuterRadius * ESCAPE_OUTER_FACTOR));

    // Not clear of the companions, though, and that is a separate radius. A ray on its way out is
    // finished only in the sense that nothing more will bend it; a solid surface further out still
    // stops it. Left alone this ends the march at ten radii and loses every hit on the outbound leg —
    // a companion seen past the far side of the hole, which is half of the orbit it is traced through.
    if (hasCompanion) {
        escapeW = min(escapeW, 1.0 / companionOuter);
    }

    vec3 accumulated = vec3(0.0);
    float transmittance = 1.0;
    bool escaped = false;

    // Which companion's surface this ray ended on, and -1 for none. A companion quad draws nothing
    // else, and nothing but its own; see {@link AccretionDisk#createCompanionQuad}.
    int struckCompanion = -1;

    // The swept angle's sine and cosine, carried from one step to the next. Each step needs them at
    // both of its ends, and its start is the previous step's end, so computing them once where the
    // angle advances halves the trigonometry of the march. The march starts at a swept angle of zero.
    // A step that meets the slab pays for one more pair, at the angle it reads the gas from; that is
    // a pair against three layers of noise, and it buys a third off the error of all three.
    float cosAngle = 1.0;
    float sinAngle = 0.0;

    // Skip the straight run in. A ray that only ever crosses sky comes in from far outside the field
    // along a line, and integrating that line is both pointless and, from far enough away, not
    // possible: the steps are held down by the radius they are covering, so the count grows with the
    // logarithm of the distance and passes MAX_STEPS well within this scene. So the path is started
    // where it begins to bend instead, at the sine {@link STRAIGHT_PATH_SINE} names, with the angle it
    // swept getting there taken from the closed form and its slope from the first integral — the same
    // conserved quantity the impact parameter came from, which is what keeps the two ends of the same
    // path consistent to the last digit. Rays through the gas are left alone: they are few, they
    // matter most, and the straight run is the cheap part of them.
    //
    // Stopped short of the companions where there is one in the way, because the run being skipped is a
    // run one of them may be standing in. It is the same closed form evaluated at a nearer radius, so
    // nothing is approximated by moving the endpoint — but {@link straightSweep} diverges as the path
    // approaches its turning point, and the endpoint may only be moved while it is still safely short
    // of one. It is: this binds only for impact parameters between the outer turning point and about
    // half the nearest companion's distance, and across that whole band the sine at the new endpoint stays
    // under a half, which is the value the closed form is stated for.
    float wStraight = STRAIGHT_PATH_SINE / impact;

    if (hasCompanion) {
        wStraight = min(wStraight, 1.0 / companionOuter);
    }

    if (skyOnly && wSlope > 0.0 && w < wStraight) {
        angle = straightSweep(impact, wStraight) - straightSweep(impact, w);
        w = wStraight;
        wSlope = sqrt(max(1.0 / (impact * impact) - w * w + w * w * w, 0.0));

        cosAngle = cos(angle);
        sinAngle = sin(angle);
    }

    for (int i = 0; i < MAX_STEPS; i++) {
        float previousRadius = 1.0 / w;
        float previousHeight = previousRadius *
            (heightOutward * cosAngle + heightAlong * sinAngle);

        // Shorten the step where the path is moving in radius faster than it is turning, which
        // is what keeps a ray aimed near the hole from stepping straight over the disc. Neither
        // that nor the slab refinement below has anything to do on a ray that never reaches the
        // gas, so those take a single long step throughout; see {@link SKY_ANGLE_STEP}.
        float previousRadiusSlope = -wSlope / (w * w);
        float radialRate = abs(previousRadiusSlope);
        float h = skyOnly
            ? SKY_ANGLE_STEP
            : min(ANGLE_STEP, RADIAL_STEP_LIMIT * previousRadius / max(radialRate, 1e-6));

        // Shorten it again while the path is within reach of the slab, so a crossing is sampled
        // several times rather than once; see {@link SLAB_STEP}. Both limits above are about not
        // *missing* the disc, and neither is enough on its own to resolve it: a ray skimming
        // along the slab is neither diving in radius nor turning fast, so it crosses at its full
        // step length. Measured against a converged march, this and the exact profile below
        // between them take the error from a fifteenth to a thirty-third for a few percent more
        // steps.
        if (previousRadius >= uInnerRadius && previousRadius <= uOuterRadius
                && abs(previousHeight) < 2.0 * DISC_FLARE * previousRadius) {
            float pathRate = sqrt(radialRate * radialRate + previousRadius * previousRadius);
            h = min(h, uSlabStep * DISC_FLARE * previousRadius / max(pathRate, 1e-6));
        }

        // Shorten it a third time to close on a companion's surface, which is not something either
        // limit above would find: both are stated in the radius, and a small solid twenty radii out is
        // no distance at all in radius while being several steps long in path. So the step is held to a
        // fraction of the distance remaining to the surface and the march walks itself in; see
        // {@link COMPANION_STEP}. Costs nothing on the rays whose plane misses them, which is nearly
        // all of them, and where it does bind the limit relaxes again as the path draws away.
        //
        // The nearest surface is the one that sets the step, since a step short enough for that one is
        // short enough for all of them, and a companion the path is still far from cannot lengthen a
        // step the near one has shortened.
        vec3 previousPoint = vec3(0.0);

        if (hasCompanion) {
            previousPoint = previousRadius * (outward * cosAngle + along * sinAngle);

            float pathRate = sqrt(radialRate * radialRate + previousRadius * previousRadius);

            // Taken against the step rather than against each other, which needs no starting value to
            // beat: the limit is a rising function of the gap, so holding the step to the shortest of
            // them one at a time leaves it where the nearest surface put it.
            for (int i = 0; i < MAX_COMPANIONS; i++) {
                if (!companionReachable(uCompanionRadius[i], uCompanionCentre[i], planeNormal)) continue;

                float gap = length(previousPoint - uCompanionCentre[i]) - uCompanionRadius[i];

                h = min(h, max(COMPANION_STEP * gap, COMPANION_MIN_PATH) / max(pathRate, 1e-6));
            }
        }

        float k1w = wSlope;
        float k1a = pathCurvature(w);
        float k2w = wSlope + h * 0.5 * k1a;
        float k2a = pathCurvature(w + h * 0.5 * k1w);
        float k3w = wSlope + h * 0.5 * k2a;
        float k3a = pathCurvature(w + h * 0.5 * k2w);
        float k4w = wSlope + h * k3a;
        float k4a = pathCurvature(w + h * k3w);

        w += h * (k1w + 2.0 * k2w + 2.0 * k3w + k4w) / 6.0;
        wSlope += h * (k1a + 2.0 * k2a + 2.0 * k3a + k4a) / 6.0;
        angle += h;

        if (w > 1.0) break;

        cosAngle = cos(angle);
        sinAngle = sin(angle);

        float radius = 1.0 / w;

        // Did the step run into a companion? The step's own chord against each sphere, which cannot
        // miss it the way a point sample can, and which the limit above has already made short enough
        // for the chord to stand for the arc.
        //
        // A hit ends the ray outright, and that is the whole of what makes a solid body behave like one
        // here. Everything the march had already accumulated is gas it crossed on the way, so the
        // surface arrives dimmed and tinted by exactly the gas in front of it; everything past it —
        // the far side of the disc, the sky, another winding of the ring — is never reached, so it is
        // hidden. Neither of those is a depth test, and neither could be: the ray that finds this
        // surface is not the straight line a depth buffer measures along.
        //
        // Leaving escaped false is what the compositing below reads. It means the ray never got away
        // to the sky, so no sky is added and the fragment is opaque — which is what an opaque body is,
        // and it falls out of the two rules already there rather than needing a third.
        if (hasCompanion) {
            vec3 point = radius * (outward * cosAngle + along * sinAngle);
            vec3 leg = point - previousPoint;

            // Floored because every solve below divides by it, and a step of no length is one the chord
            // cannot describe in any case. What the floor leaves is the answer that step deserves: a
            // sphere it is outside of misses, and a sphere it is already inside is struck at its start.
            float legLength = max(dot(leg, leg), 1e-20);

            // The earliest crossing of the step, over every companion the ray could reach, since the
            // first surface met is the one that stops the ray and the others are behind it. Held as a
            // fraction of the step, past the far end of it until something is found.
            float nearest = 1.0;
            int found = -1;

            // The winner's centre, kept as the loop goes rather than looked up by the winning slot
            // afterwards, for the reason given at {@link companionSurface}: here the array is read at
            // the loop's own index, which is the form of indexing GLSL ES promises to compile.
            vec3 hitCentre = vec3(0.0);

            for (int i = 0; i < MAX_COMPANIONS; i++) {
                if (!companionReachable(uCompanionRadius[i], uCompanionCentre[i], planeNormal)) continue;

                vec3 offset = previousPoint - uCompanionCentre[i];

                float projection = dot(offset, leg);
                float outside = dot(offset, offset) - uCompanionRadius[i] * uCompanionRadius[i];
                float determinant = projection * projection - legLength * outside;

                if (determinant < 0.0) continue;

                // The nearer of the two crossings, as a fraction of the step. A step that begins inside
                // the sphere is struck where it begins, which is the floor above having overstepped.
                float hit = outside < 0.0
                    ? 0.0
                    : (-projection - sqrt(determinant)) / legLength;

                if (hit < 0.0 || hit > nearest) continue;

                nearest = hit;
                found = i;
                hitCentre = uCompanionCentre[i];
            }

            if (found >= 0) {
                // Put the crossing back on the path. It was solved against the chord, so what is
                // exact about it is the fraction rather than the position, and the fraction is
                // therefore what is kept — the point itself read from the arc at that fraction,
                // the same way the gas sample is positioned and for the same reason.
                float hitAngle = angle - h * (1.0 - nearest);
                float hitRadius = mix(previousRadius, radius, nearest);
                vec3 struck = hitRadius * (outward * cos(hitAngle) + along * sin(hitAngle));

                accumulated += transmittance * companionSurface(found,
                    normalize(struck - hitCentre));
                transmittance = 0.0;
                struckCompanion = found;

                break;
            }
        }

        if (radius >= uInnerRadius && radius <= uOuterRadius) {
            float height = radius * (heightOutward * cosAngle + heightAlong * sinAngle);
            float halfThickness = DISC_FLARE * radius;

            // How much of this step lay inside the slab, by clipping the step's height range
            // against it. Exact for a step short enough that the height varies linearly, and
            // unlike a midpoint test it cannot step over the slab entirely.
            float low = min(previousHeight, height);
            float high = max(previousHeight, height);
            float entry = max(low, -halfThickness);
            float exit = min(high, halfThickness);
            float inside = exit - entry;
            float range = high - low;
            float coverage = range > 1e-5
                ? clamp(inside / range, 0.0, 1.0)
                : step(abs(height), halfThickness);

            if (coverage > 0.0) {
                // The gas thins towards the slab's faces, and this step has to answer for the
                // whole stretch of that profile it crossed, not for one height within it. So the
                // triangular profile is averaged over the crossing in closed form: with the height
                // varying linearly, the mean of |height| between the entry and the exit is either
                // the mean of the two ends, or - where the step passed through the mid-plane -
                // shorter than that, since it spent part of the crossing on each side.
                //
                // Evaluating it at the crossing's midpoint instead is what puts concentric ripples
                // through the disc. A step that crosses the slab outright has its midpoint at the
                // mid-plane and so claims the profile's full height, twice the truth, while one
                // that clips a face gets it about right. Which of the two a given pixel gets depends
                // on where its steps happen to fall, so the error comes out as bands at whatever
                // radii the step pattern changes - the sort of thing that looks like a texture and
                // is really a quadrature error.
                float endMean = 0.5 * (abs(entry) + abs(exit));
                float crossMean = (entry * entry + exit * exit)
                                / max(2.0 * (abs(entry) + abs(exit)), 1e-6);
                float meanHeight = entry * exit >= 0.0 ? endMean : crossMean;
                float verticalFade = 1.0 - meanHeight / halfThickness;

                // Where along the step to read the gas. The middle of the part of it that was
                // inside the slab, not the end: a sample stands for that whole stretch, and the
                // middle is where it is worth the most — for anything varying linearly along the
                // step it is the stretch's mean rather than one edge of it, which is worth a third
                // of the error at no cost but this interpolation. The height it corresponds to is
                // halfway between the entry and the exit, and the fraction of the step that reaches
                // it follows from the height varying linearly, as it does everywhere here.
                //
                // The vertical profile above is deliberately *not* taken here. It is not linear in
                // the height — it is the profile of |height| — and evaluating it at this midpoint
                // rather than averaging it in closed form is precisely what bands the disc. This
                // positions the sample; that one weights it.
                float middle = 0.5 * (entry + exit);
                float fraction = range > 1e-5
                    ? (middle - previousHeight) / (height - previousHeight)
                    : 0.5;

                float sampleAngle = angle - h * (1.0 - fraction);
                float cosSample = cos(sampleAngle);
                float sinSample = sin(sampleAngle);

                float sampleRadius = mix(previousRadius, radius, fraction);
                float radiusSlope = mix(previousRadiusSlope, -wSlope / (w * w), fraction);

                vec3 radial = outward * cosSample + along * sinSample;
                vec3 transverse = along * cosSample - outward * sinSample;
                vec3 point = sampleRadius * radial;

                // Path length of the step, from the polar arc element, times the fraction of it
                // inside the slab. The direction of travel comes from the same two derivatives.
                float pathLength = sqrt(radiusSlope * radiusSlope
                                      + sampleRadius * sampleRadius) * h;
                vec3 travel = normalize(radiusSlope * radial + sampleRadius * transverse);

                // How much of the disc this one sample answers for: the stretch of gas it was
                // taken from, or the pixel it will be drawn into, whichever is the coarser. Both
                // matter — a short step does not make a sample sharper than its pixel, and a wide
                // pixel does not excuse a step longer than the gas it crosses.
                //
                // The stretch is the step's *horizontal* extent, which is why the path length is cut
                // down to it here. The gas varies with the angle round the disc and with the radius
                // and with nothing else — there is no vertical term in it at all, the whole vertical
                // structure being the profile above — so the part of a step that is a climb or a dive
                // through the slab crosses no gas to average over, and charging the band limit for it
                // would fade the pattern out in proportion to how steeply the ray came in — the disc
                // quietly losing detail wherever it is seen from anywhere but edge on.
                float lateral = length(vec2(travel.x, travel.z));
                float footprint = max(pathLength * coverage * lateral,
                                      length(point - origin) * pixelAngle);

                vec4 gas = sampleDisc(point, travel, sampleRadius, verticalFade, footprint);

                // Optical depth of the step, scaled so that a crossing straight through the
                // slab has a depth of about the density itself, and a grazing one proportionally
                // more.
                float depth = gas.a * pathLength * coverage / (2.0 * halfThickness);

                // What the step absorbs of what is behind it, and emits of its own. Taking the
                // depth itself for both — the first two terms of this exponential — leaves the disc
                // too bright by a twelfth: it lets all of the step's light out at the transmittance
                // in front of the step rather than attenuating it through the step's own gas, so a
                // step is credited for light its own near half should have absorbed. Being an error
                // in proportion to the depth it is an error in proportion to the step length, which
                // makes it the accumulation's share of what reads as a sampling problem, and one
                // exponential per sample is nothing beside the three layers of noise above it.
                //
                // It also avoids a saturation. Linear attenuation ends the ray outright at a depth
                // of one, where the true answer is a third of the light still coming through, which
                // flattens the densest patches of a grazing view.
                float absorbed = 1.0 - exp(-depth);

                accumulated += transmittance * absorbed * gas.rgb;
                transmittance *= 1.0 - absorbed;

                if (transmittance < MIN_TRANSMITTANCE) break;
            }
        }

        if (w < escapeW && wSlope < 0.0) {
            escaped = true;
            break;
        }
    }

    // Escaped rays leave the sky behind them showing through whatever gas they crossed.
    // Everything else — captured, blocked, or still wound up when the steps ran out — is opaque.
    float alpha = escaped ? 1.0 - transmittance : 1.0;

    // Which piece of sky the ray came from. This is the whole of the lensing: a screen-space warp can
    // slide the sky about but it can only ever move pixels the frame already contains, and just
    // outside the shadow's rim the sky arriving has come from *behind* the hole — a source angle of
    // -150 degrees a twentieth of a radius out from the rim, past -370 and three windings at a
    // thousandth of one. None of that is anywhere in the frame to be moved there. Following the path
    // is the only way to have it, and it comes out agreeing with the silhouette by construction,
    // because the silhouette is where these same paths stop coming back.
// A companion's quad has no sky to add and no business adding one. Everything it draws ended on a
// surface, so no ray of its escaped, so every one of these would be multiplied by zero — and the fetch
// itself is worth skipping, being a cube map sampled through a derivative on a quad whose neighbours
// are mostly discarded.
#ifndef COMPANION_ONLY
    if (uSkyFadeImpact > 0.0) {
        // Where the path points once it is done bending: the angle it has swept, plus the straight
        // remainder out to infinity in closed form. The clamp is a no-op on every ray that escaped,
        // which are the only ones this is drawn for — it is there so that the ones that did not still
        // come out of it with a direction that varies smoothly from pixel to pixel, since a
        // neighbourhood is what sets the mip level below and one wild value in it spoils the rest.
        // Unclamped, a captured ray asks the closed form for the sweep at a radius inside the turning
        // point, where it diverges.
        float sweep = angle + straightSweep(impact, min(w, STRAIGHT_PATH_SINE / impact));

        // Ease the deflection out where it stops being worth drawing, by bending the outgoing
        // direction back towards the straight one rather than by fading the picture; see
        // {@link SKY_FADE_START}. Mixing the directions rather than the angles is safe only because
        // it is done where they are nearly parallel — far enough out that the deflection is a
        // fraction of a degree — and it saves the second pair of trigonometry.
        vec3 lensed = outward * cos(sweep) + along * sin(sweep);
        float fade = 1.0 - smoothstep(uSkyFadeImpact * SKY_FADE_START, uSkyFadeImpact, impact);
        vec3 source = normalize(mix(direction, lensed, fade));

        // Sampled and composited unconditionally, weighted to nothing where it is not wanted, so that
        // every pixel of the quad reaches this line. A texture fetch inside a branch no two
        // neighbours agree on has no defined derivative, and the derivative is what picks the mip
        // level: the sky's compression here runs to thousands to one around the rim, so the level has
        // to come from the neighbourhood rather than from an assumption, and the fetch cannot be
        // hidden from the pixels that would tell it what the neighbourhood is doing.
        //
        // Matched to what three.js draws the background with, which is the point of the whole fade:
        // the cube map straight through, scaled by the scene's background intensity, and left in
        // linear light all the way to the end of main, where the same encoding three.js gives the
        // background box is applied to it from three.js's own include. Both halves of that matter.
        // Anything else here and the fade's outer edge would be a visible step in brightness rather
        // than nothing at all; anything else there and the whole quad steps against the sky around it
        // on any path that does not end in a linear render target.
        vec3 sky = textureCube(uSky, source * uToDisc).rgb * uSkyIntensity;

        // Dimmed by whatever gas the ray crossed, and taken away entirely from the rays that fell in:
        // the shadow is not a piece of sky. Composited here rather than blended in afterwards, which
        // leaves the fragment a finished, opaque colour — see {@link BACKGROUND_RENDER_ORDER} for why
        // it has to be one.
        accumulated += transmittance * sky * (escaped ? 1.0 : 0.0);
        alpha = 1.0;
    }
#endif

// Nothing but the surface, and the surface arrives opaque without being told to: a ray that ended on
// it never escaped, and the alpha above reads that as an opaque fragment. The gas it crossed on the way
// is in the colour, which is the whole point of drawing the body from a marched path rather than as a
// mesh; see {@link AccretionDisk#setCompanion}.
//
// And nothing but this quad's own body, which is what keeps a quad's depth honest: every quad traces
// every companion, so a ray that ends on a nearer one is correctly stopped there, but the depth this
// quad writes is its own body's plane and would be wrong for anybody else's. The pixel is not lost by
// being dropped here — the body it belongs to has a quad of its own covering it, and the hole's quad
// traces all of them; see {@link AccretionDisk#createCompanionQuad}.
#ifdef COMPANION_ONLY
    if (struckCompanion != uQuadCompanion) discard;
#endif

    if (alpha < 0.002) discard;

    gl_FragColor = vec4(accumulated, alpha);

// The same output encoding three.js gives its own background box, taken from three.js's own hook so
// that it is the same function rather than a copy of it. Everything above is linear light, which is
// what a render target wants -- but the target is not always a render target: when nothing else needs
// the composer, BloomManager draws straight to the canvas, and there the output colour space is sRGB.
// Both conditions for that arrive together zoomed out, since bloom switches off by distance and a
// tracing hole never warps the frame and, once its horizon falls under a pixel at some two and a half
// thousand horizon radii, is dropped from the lens pass entirely, leaving it nothing to run for.
// Without this encode the traced sky goes down as a raw linear write into a framebuffer read as sRGB
// and comes back about thirteen times too dark: a hard-edged dark disc exactly the width of the quad's
// inscribed circle, hole and gas still drawn correctly inside it and the sky continuing normally
// around it, the two meeting in a step two pixels wide.
//
// Resolving the include costs nothing where the target is already linear, linearToOutputTexel being
// the identity there, and three.js keys its compiled programs by output colour space, so each target
// gets the encode baked in and there is no branch here to go stale. That is the point of doing it this
// way instead of asking which path is running: the quad is correct wherever it is drawn, and nothing
// has to stay in agreement with it.
    #include <colorspace_fragment>
}
`;

/**
 * Radius of a black hole's shadow, in Schwarzschild radii, seen from far away.
 *
 * `3√3 / 2`. The dark disc a black hole shows is not its horizon: the hole bends the light of its
 * own edge outwards, so what is seen is the impact parameter at which light grazes into an orbit
 * around it, over two and a half times the horizon's radius. It lives here rather than with the
 * effects that use it because it is the far-field limit of {@link shadowApparentSine} below, and
 * the two are only safe to use if it is obvious which one a given situation calls for.
 *
 * Being an impact parameter it is an apparent size only under the small-angle approximation, and
 * close to a hole nothing is small. So its remaining uses are the ones that are not apparent sizes:
 * the radius a mesh standing in for the shadow is *built* at before being scaled to the angle the
 * shadow really covers, and the reference the ring's and disc's configured radii are stated
 * against.
 *
 * @type {number}
 */
export const SHADOW_HORIZON_RADII = 2.5980762;

/**
 * The sine of the shadow's apparent radius, seen from a given distance.
 *
 * The silhouette of a black hole is not drawn by anything that knows where it is — it is wherever
 * the tracer above finds that a ray no longer escapes. Everything else that has to line up with
 * it, though, does need to be told: the depth occluder that stands in for the shadow as a solid,
 * the photon ring drawn on its rim, and the lensing pass that must not warp it. This is the one
 * place that answer is worked out, so that all of them agree by construction rather than by three
 * separately tuned numbers.
 *
 * It comes from the shader's own first integral. `w'' = -w + 1.5w²` conserves
 * `1 / b² = w'² + w² - w³`, and the ray is seeded at `w = 1/r` with `w' = w·cotθ` for a screen
 * angle `θ` off the hole's centre. Substituting and setting `1 / b²` to its critical value of
 * `4/27` — the largest `w² - w³` can be, at `w = 2/3` — gives `sin²θ = 27r / (4r³ + 27)`, and the
 * shadow is everything inside that.
 *
 * Far away this tends to `asin(b_c / r)` with `b_c = 3√3 / 2`, which is where that familiar number
 * comes from and why treating it as a radius is harmless at a distance. Close in it is not a
 * radius at all: at four horizon radii the shadow is a fifth wider on screen than a sphere of
 * `b_c` would be, at three a half again, and by the photon sphere it has swallowed the sky. A
 * constant used where this belongs is what leaves a hard-edged grey crescent of blocked sky
 * outside the silhouette, or a lensing pass warping the shadow it was supposed to leave alone.
 *
 * Note that this is the silhouette *as drawn*, which is a little larger than the physical one:
 * the seeding above uses the ray's coordinate angle where the local angle would carry a further
 * factor of `√(1 - 1/r)`, so both the shader and this run a few degrees wide close in. They run
 * wide together, which is what matters here, and correcting it would move the silhouette rather
 * than align anything to it.
 *
 * @param {number} horizonRadii - Distance from the hole's centre, in Schwarzschild radii.
 * @returns {number} `sin` of the shadow's apparent angular radius; 1 at or inside the horizon,
 *   where the shadow covers everything there is to see.
 */
export function shadowApparentSine(horizonRadii) {
    if (!(horizonRadii > 1.0)) return 1.0;

    const cubed = horizonRadii * horizonRadii * horizonRadii;

    return Math.min(Math.sqrt(27.0 * horizonRadii / (4.0 * cubed + 27.0)), 1.0);
}

/**
 * The tangent of the shadow's apparent radius, seen from a given distance.
 *
 * Which of the two forms is wanted depends only on the shape being fitted to the shadow, and it is
 * an easy thing to get wrong because they agree to within a percent at any comfortable viewing
 * distance and then diverge without bound. A sphere of radius `R` at distance `d` subtends
 * `asin(R / d)`, so a sphere is sized by the sine. A flat camera-facing quad subtends
 * `atan(R / d)`, so a billboard is sized by the tangent — as is a radius measured on the screen,
 * which is `tanθ` over twice the tangent of the half field of view.
 *
 * Near the photon sphere the shadow approaches half the sky and this diverges, correctly: no plane
 * in front of the camera can cover that much of it. The cosine is floored rather than left to
 * produce infinities, and callers are expected to stop well before they get there.
 *
 * @param {number} horizonRadii - Distance from the hole's centre, in Schwarzschild radii.
 * @returns {number} `tan` of the shadow's apparent angular radius.
 */
export function shadowApparentTangent(horizonRadii) {
    const sine = shadowApparentSine(horizonRadii);

    return sine / Math.sqrt(Math.max(1.0 - sine * sine, 1e-6));
}

/**
 * How far across the billboard a given impact parameter falls.
 *
 * The billboard is a plane through the hole's centre, square to the line of sight, and it is tempting
 * to read an offset across it as the impact parameter of the ray through it. They are not the same
 * thing: the ray reaches that offset travelling at an angle, so its closest approach to the hole is
 * `p / √(1 + p²/d²)` — always *less* than the offset, by the cosine of the angle the offset subtends.
 * Inverting that gives the plane radius below, and the two uses of it are the same statement about
 * the same plane.
 *
 * It matters at both ends of what the quad has to hold. The gas is a solid of revolution, so this is
 * the tangent point of its rim, without which the quad's edge cuts the disc's arms off square. The
 * sky's fade is written in the impact parameter, so this is where the fade *ends* — and cutting the
 * quad at the offset instead ends it early, at a radius where the sky is still being replaced whole
 * and displaced by a couple of pixels, which draws the quad's own straight edge across the frame.
 * That is not a small correction in the range it bites: `1.3` at six hundred horizon radii, `1.8` at
 * five hundred, unbounded as the plane radius reaches the distance. The caller clamps to the viewport,
 * which is what keeps the unbounded case harmless.
 *
 * @param {number} impact - The impact parameter to reach, in world units.
 * @param {number} distance - Camera distance to the hole's centre, in world units.
 * @returns {number} The plane radius, in world units, or `Infinity` when the camera is inside it.
 */
function planeExtent(impact, distance) {
    const foreshortening = impact / Math.max(distance, 1e-6);
    const cosine = Math.sqrt(Math.max(1.0 - foreshortening * foreshortening, 0.0));

    return cosine > 0.0 ? impact / cosine : Infinity;
}

/**
 * How far across the billboard's plane the frame reaches.
 *
 * This is the size at which clipping the quad to the viewport is free, and getting it right matters
 * for the same reason {@link planeExtent} does: a quad cut smaller than the frame ends in a straight
 * edge somewhere inside the picture, with the traced sky on one side of it and the untraced sky on
 * the other. They are the same star field and they very nearly agree, which is why the seam reads as
 * a faint step in brightness rather than as anything obviously wrong, and why it is easy to size the
 * quad slightly wrong and not notice.
 *
 * A constant multiple of the frustum's half-height cannot be that size. It measures the frame about
 * the *view axis* while the quad is centred on the hole, so it is only right when the camera is
 * looking at the hole. Point the camera at a body twenty horizon radii out and the frame is centred
 * twenty radii off the quad's centre; the frame's far corner is then at a plane radius of that
 * offset plus the half-frame, which no fixed multiple of the half-frame bounds.
 *
 * So it is worked out from the frame itself. The plane holds the points `p` with `(p − H)·n = 0`,
 * for `n` the unit vector from the hole to the camera, and a corner ray leaves the camera along `u`,
 * meeting the plane at `t = −d/(u·n)` — a distance, and so a point on the plane, only when `u·n` is
 * negative, that is, when the corner ray travels towards the plane at all. Four corners are enough:
 * the frustum is the convex hull of its corner rays, and a projective map takes the frame's straight
 * edges to straight lines, so the visible part of the plane is the quadrilateral spanned by the four
 * corner points and a circle round the furthest of them contains all of it.
 *
 * When a corner ray runs parallel to the plane or away from it, the visible region is unbounded and
 * there is no such size: the plane is seen edge-on and reaches the horizon. The caller then has
 * nothing to clip to and falls back to what has to be drawn, whose edge is where the lensing has
 * already faded to nothing.
 *
 * @param {THREE.PerspectiveCamera} camera - Camera whose frame is being measured.
 * @param {THREE.Vector3} centre - World position the plane passes through.
 * @returns {number} The plane radius the frame reaches, in world units, or `Infinity` when the
 *   plane is seen too nearly edge-on for the frame to bound it.
 */
function frustumExtent(camera, centre) {
    _frameNormal.subVectors(camera.position, centre);

    const distance = _frameNormal.length();
    if (distance < 1e-6) {
        return Infinity;
    }
    _frameNormal.multiplyScalar(1.0 / distance);

    camera.updateWorldMatrix(true, false);
    camera.matrixWorld.extractBasis(_cameraX, _cameraY, _cameraZ);
    _cameraX.normalize();
    _cameraY.normalize();
    _cameraZ.normalize();

    // Half the frame at unit depth, which is the depth the corner directions are built at.
    const halfHeight = Math.tan(THREE.MathUtils.degToRad(camera.fov) * 0.5);
    const halfWidth = halfHeight * camera.aspect;

    let extent = 0.0;

    for (let corner = 0; corner < 4; corner++) {
        // The camera looks along its own -z, so a corner is (±w, ±h, -1) in its basis.
        _frameCorner.copy(_cameraX).multiplyScalar((corner & 1) ? halfWidth : -halfWidth)
            .addScaledVector(_cameraY, (corner & 2) ? halfHeight : -halfHeight)
            .addScaledVector(_cameraZ, -1.0)
            .normalize();

        const approach = _frameCorner.dot(_frameNormal);
        if (approach > -1e-6) {
            return Infinity;
        }

        // Along the ray to the plane, then measured from the hole rather than from the camera.
        _frameCorner.multiplyScalar(-distance / approach).addScaledVector(_frameNormal, distance);

        extent = Math.max(extent, _frameCorner.length());
    }

    return extent;
}

/**
 * The disc of shredded, glowing gas spiralling into a black hole.
 *
 * Drawn by tracing photon paths rather than by putting geometry where the gas is, for a reason
 * that is worth being clear about: at these distances the hole bends light through large angles,
 * so a good deal of the disc is seen *around the back of the hole*, arched over and under the
 * shadow. That is the single most recognisable thing about the object, and it is not something a
 * disc-shaped mesh can show — the part of it responsible is behind an opaque horizon, and no
 * amount of distorting the finished frame can recover an image that was never in it. What a mesh
 * can show is the flat streak that a disc would look like if light travelled in straight lines.
 *
 * So the mesh here is only a billboard to run a shader over, sized and aimed each frame. All of
 * the geometry lives in the fragment shader, and all of the disc's radii stay in units of the
 * hole's Schwarzschild radius, which is what keeps the picture and the physics in agreement no
 * matter how far the hole itself has been scaled up to be visible.
 *
 * Once a ray is being followed anyway, the sky is nearly free and comes with the same argument: a
 * ray that misses the gas still has to have come from somewhere, and following it to where says
 * which piece of the star field is seen at that pixel. That is the gravitational lensing, and it is
 * the same photon paths that draw the disc, so the Einstein ring, the sky wrapping the rim and the
 * silhouette they surround are one calculation and cannot disagree with each other. It is why the
 * billboard is a good deal larger than the disc; see {@link AccretionDisk#placeBillboard} and
 * {@link SKY_FADE_DEFLECTION}.
 *
 * A body orbiting inside the lensing is drawn by the same argument taken one step further: its surface
 * is marched along with the gas rather than left to its own mesh, so it is bent, doubled and eclipsed
 * by the same paths and not by a second set of rules; see {@link AccretionDisk#setCompanion}. Each such
 * body brings a billboard of its own, which is why there are several here rather than one. A quad is
 * only a supply of pixels to trace from — the ray depends on the pixel and not on the quad — and a quad
 * at the hole cannot supply the pixels a body has when the camera is beside it; see
 * {@link AccretionDisk#createCompanionQuad}. How many there can be is {@link MAX_COMPANIONS}, and the
 * ones a scene does not use cost it a hidden mesh apiece.
 *
 * Follows {@link SunCorona}'s shape — a mesh, a material and an `update` — rather than extending
 * {@link SunEffect}, which is built around a star's radius and colour temperature.
 */
class AccretionDisk {
    /**
     * Builds the disc and its billboard.
     *
     * @param {Object} [options={}] - Disc options.
     * @param {number} [options.horizonRadius=1.0] - The drawn radius of the event horizon in
     *   scene units, which every other radius here is a multiple of.
     * @param {number} [options.innerRadius=3.0] - Inner edge, in horizon radii; 3 is the
     *   innermost stable circular orbit.
     * @param {number} [options.outerRadius=9.0] - Outer edge, in horizon radii.
     * @param {number|THREE.Color} [options.innerColor=0xeaf4ff] - Colour of the hot inner
     *   edge.
     * @param {number|THREE.Color} [options.outerColor=0xff5a14] - Colour of the cooler outer
     *   edge.
     * @param {number} [options.intensity=1.8] - Overall brightness; above 1 so the disc
     *   blooms.
     * @param {number} [options.opacity=1.0] - Density multiplier for the gas, which sets both
     *   how bright it is and how much it hides what is behind it.
     * @param {number} [options.emissionFalloff=1.6] - How fast brightness drops with radius.
     *   A real disc's flux goes as the inverse cube, which over the span drawn here would leave
     *   the outer disc invisible; this is the same compression
     *   {@link temperatureToGlareBrightness} applies to the Stefan–Boltzmann law.
     * @param {number} [options.noiseScale=3.5] - Size of the filament structure; larger means
     *   finer.
     * @param {number} [options.swirlSpeed=0.6] - Angular rate of the pattern at the inner
     *   edge, in radians per second. Everything further out follows Kepler's third law from
     *   it.
     * @param {number} [options.turbulence=0.55] - How much the filaments break up the
     *   otherwise smooth bands.
     * @param {number} [options.beamingStrength=0.85] - How much of the full relativistic
     *   beaming to apply, 0 to 1. Below 1 only to tame it: the true factor clips to white over
     *   a good fraction of the disc.
     * @param {number} [options.slabStep=SLAB_STEP] - How finely the march samples the gas, and so
     *   what the disc costs; see {@link AccretionDisk#setSlabStep}, which is the better way to
     *   reach it since it can be changed while watching.
     */
    constructor(options = {}) {
        this.horizonRadius = options.horizonRadius || 1.0;
        this.innerRadius = options.innerRadius || 3.0;
        this.outerRadius = options.outerRadius || 9.0;

        this.mesh = this.createDiskMesh(options);

        // Further carriers of the same trace, one for each companion's own corner of the screen; built
        // here because they share the disc's uniforms and so cannot exist before them.
        this.companionQuads = Array.from({ length: MAX_COMPANIONS },
            (unused, index) => this.createCompanionQuad(index));

        this.time = 0;

        // Set from the scene every frame by {@link AccretionDisk#bindSky}; false until then, since
        // the disc is built before it is parented and there is nothing to look at yet.
        this.tracesSky = false;

        // Per companion, the mesh {@link AccretionDisk#setCompanion} has hidden and the pinpoint
        // hidden with it, so that only those are shown again; null in a slot with nothing traced in it.
        this.companionMeshes = new Array(MAX_COMPANIONS).fill(null);
        this.companionPinpoints = new Array(MAX_COMPANIONS).fill(null);

        // Whether the overflow warning has been given; see {@link AccretionDisk#setCompanions}.
        this.warnedOverflow = false;
    }

    /**
     * Builds the billboard and its material.
     *
     * A unit quad, since its size is set per frame by {@link AccretionDisk#update} — there is no
     * fixed size that works, because the disc is smaller than the screen from outside and larger
     * from within it.
     *
     * Built as an overlay, drawn after the opaque bodies. Where it ends up depends on whether it finds
     * a sky to trace, which is not known until it has been parented and looked at the scene, so it is
     * {@link AccretionDisk#bindSky} that moves it; see {@link BACKGROUND_RENDER_ORDER}.
     *
     * @param {Object} options - The constructor's options, for the material.
     * @returns {THREE.Mesh} The disc mesh.
     */
    createDiskMesh(options) {
        const geometry = new THREE.PlaneGeometry(1, 1);

        const mesh = new THREE.Mesh(geometry, this.createDiskMaterial(options));
        mesh.renderOrder = OVERLAY_RENDER_ORDER;
        mesh.frustumCulled = false;

        return mesh;
    }

    /**
     * Builds the disc's shader material.
     *
     * Transparent with premultiplied alpha, because without a sky to trace this one material has to do
     * two opposite things: the gas adds its light to whatever is behind it, and the shadow hides it
     * completely. The shader returns light already scaled by how much of it survives, so one blend
     * expresses both — an alpha of zero adds pure emission, an alpha of one replaces what is there with
     * black. With a sky the shader has what is behind the ray and needs no blend at all, and
     * {@link AccretionDisk#bindSky} turns this off; see {@link BACKGROUND_RENDER_ORDER}.
     *
     * Depth tested but not depth written, and both halves of that need saying. Writing is off because
     * most of the quad is gas the sky shows through, and which fragments are opaque is not known until
     * the path has been traced — so the depth of the shadow is supplied by a separate solid instead; see
     * {@link BlackHoleEffects.addShadowOccluder}. Testing is on because that solid is a flat disc placed
     * a hair behind the hole's centre and this quad passes through the centre, so the comparison against
     * it comes out in this quad's favour everywhere: the gas drawn in *front* of the shadow — the near
     * side of the disc, crossing the silhouette, one of the most recognisable things about the picture —
     * survives a test it would fail against any solid that bulged towards the camera.
     *
     * What the test buys is the case the quad is otherwise helpless at. Without a sky to trace this is
     * an overlay, drawn after the bodies, and a captured ray is opaque black: untested, a body between
     * the camera and the hole is painted over by the shadow it should be hiding, cut off along the
     * silhouette's rim, and by the near gas with it. Nothing in the shader can tell — the depth buffer
     * is where that body is recorded — and one depth for the whole quad is enough to read it, because
     * everything the quad draws is at the hole and everything in front of the hole is in front of all
     * of it.
     *
     * What is left over is the far side of the same trade: gas genuinely in front of a body does not
     * reach it. Both ways round that is nothing here, because the disc is seven horizon radii across
     * and the one body that can be inside the picture orbits at twenty — anywhere it overlaps the gas
     * on screen it is eighteen radii clear of the gas along the line of sight, so in front of the gas
     * and behind it are the only two answers the geometry has, and the depth buffer gives both. A body
     * genuinely amongst the gas would need the treatment that one body already gets: traced along with
     * the gas rather than drawn against it, see {@link AccretionDisk#setCompanion}.
     *
     * `DoubleSide` because a billboard aimed by `lookAt` can end up facing either way as the
     * camera crosses its plane.
     *
     * @param {Object} options - Disc options; see the constructor.
     * @returns {THREE.ShaderMaterial} The disc material.
     */
    createDiskMaterial(options) {
        const uniforms = {
            uTime: { value: 0.0 },
            uCameraOffset: { value: new THREE.Vector3() },

            // Zero for the disc's own quad, and left zero: each companion quad overrides this one
            // uniform with a copy of its own; see {@link AccretionDisk#createCompanionMaterial}.
            uQuadOffset: { value: new THREE.Vector3() },

            uToDisc: { value: new THREE.Matrix3() },

            // A uniform rather than a compiled-in constant so the march's cost can be traded against
            // its accuracy without a shader rebuild; see {@link SLAB_STEP} and
            // {@link AccretionDisk#setSlabStep}.
            uSlabStep: { value: options.slabStep !== undefined ? options.slabStep : SLAB_STEP },

            uHorizonRadius: { value: this.horizonRadius },
            uInnerRadius: { value: this.innerRadius },
            uOuterRadius: { value: this.outerRadius },
            uInnerColor: { value: new THREE.Color(options.innerColor || 0xeaf4ff) },
            uOuterColor: { value: new THREE.Color(options.outerColor || 0xff5a14) },
            uIntensity: { value: options.intensity !== undefined ? options.intensity : 1.8 },
            uOpacity: { value: options.opacity !== undefined ? options.opacity : 1.0 },
            uEmissionFalloff: { value: options.emissionFalloff || 1.6 },
            uNoiseScale: { value: options.noiseScale || 3.5 },
            uSwirlSpeed: { value: options.swirlSpeed !== undefined ? options.swirlSpeed : 0.6 },
            uTurbulence: { value: options.turbulence !== undefined ? options.turbulence : 0.55 },
            uBeamingStrength: {
                value: options.beamingStrength !== undefined ? options.beamingStrength : 0.85
            },
            uSky: { value: null },
            uSkyIntensity: { value: 0.0 },
            uSkyFadeImpact: { value: 0.0 },
            // One entry per slot the tracer has, empty until something is put in it; see
            // {@link MAX_COMPANIONS}. A radius of zero is what an empty slot is recognised by, in the
            // shader and here alike.
            uCompanionCentre: {
                value: Array.from({ length: MAX_COMPANIONS }, () => new THREE.Vector3())
            },
            uCompanionRadius: { value: new Array(MAX_COMPANIONS).fill(0.0) },
            uCompanionToLocal: {
                value: Array.from({ length: MAX_COMPANIONS }, () => new THREE.Matrix3())
            },
            uCompanionLight: {
                value: Array.from({ length: MAX_COMPANIONS },
                    () => new THREE.Vector3(1.0, 0.0, 0.0))
            },
            uCompanionLightColor: {
                value: Array.from({ length: MAX_COMPANIONS }, () => new THREE.Color(0xffffff))
            },
            uCompanionTexture: { value: new Array(MAX_COMPANIONS).fill(null) }
        };

        this.uniforms = uniforms;

        return new THREE.ShaderMaterial({
            uniforms,
            vertexShader,
            fragmentShader: ShaderLoader.createFragmentShader(fragmentShaderMainCode),
            transparent: true,
            premultipliedAlpha: true,
            depthWrite: false,
            depthTest: true,
            side: THREE.DoubleSide,
            toneMapped: false
        });
    }

    /**
     * Builds the quad that carries a traced companion.
     *
     * A further billboard, centred on that companion instead of on the hole, running the same shader
     * with {@link COMPANION_ONLY} defined. It exists because of one property of the tracer that took a
     * while to see: the ray a fragment follows is `normalize(target - origin)`, where `target` is the
     * quad point and `origin` the camera, so it is the ray *through that pixel* and nothing about it
     * depends on which quad supplied the fragment. Quads that overlap therefore produce identical
     * pixels — identical colour and an alpha of one, which composites idempotently — and the only thing
     * a quad decides is which pixels get a ray at all.
     *
     * Which is what makes a quad apiece the answer. The disc's quad is a plane through the hole's centre
     * facing the camera, and however large it is made, the directions it carries all lie within a right
     * angle of the line from the camera to the hole; sized to the viewport, within about forty degrees
     * of it. A camera near the companion sees the hole far off to one side, so the companion's own image
     * falls outside the fragments that quad has — not mistraced, not there. Handing the body back to its
     * mesh in those views would be a switch, and a switch on this orbit is a jump of up to eight of the
     * body's own widths; see {@link AccretionDisk#setCompanion}. Covering the pixels instead costs a
     * quad and switches nothing.
     *
     * It can be sized generously — {@link COMPANION_IMAGE_RADII} — because of the plane test the
     * fragment stage opens with. A Schwarzschild path stays in the plane through the camera, the
     * direction of travel and the hole's centre, so a pixel whose plane misses the sphere cannot reach
     * it however the path bends, and on this quad there is nothing else to draw: it leaves on a dot
     * product, before any marching. What survives is a stripe through the hole and the companion. The
     * same holds for a ray whose plane cuts the sphere but which ends somewhere else, discarded at the
     * far end of the shader on `struckCompanion`.
     *
     * Every quad traces every companion, and each draws only its own — which is `uQuadCompanion`, the
     * one uniform besides the offset that a quad owns rather than shares. Both halves of that are
     * needed. Tracing all of them is what makes one body correctly hide another: the march stops at the
     * first surface the ray meets, so a nearer companion ends the ray and the further one is simply
     * never reached, which no arrangement of depths between two quads could arrange for two bodies at
     * the same depth on opposite sides of the hole. Drawing only its own is what keeps the depth honest,
     * since the depth a quad writes is its own body's plane and would be wrong under anybody else's
     * surface. Nothing is lost to the discard: the body that *was* struck has a quad of its own covering
     * where its image can be, and the hole's quad traces all of them without any such restriction.
     *
     * Depth tested, and the test does no harm where it bites. The shadow's occluder writes depth a hair
     * behind the hole's centre, so where this quad is beyond the hole its fragments inside the
     * silhouette are rejected — and those are exactly the pixels aimed inside the shadow's rim, whose
     * rays are captured and reach no surface at all; see {@link BlackHoleEffects.addShadowOccluder}.
     *
     * Depth *writing*, which the disc's own quad cannot do and this one has to. The disc's quad has one
     * depth and two things to place, the gas at the hole and the sky at infinity, so it writes neither
     * and the occluder stands in for it. This quad has one thing on it: a solid surface, at a distance
     * known before the frame is drawn. Without the write the body would be there to look at and absent
     * from the depth buffer, so everything drawn afterwards goes straight through it — the photon ring
     * across its face, the body's own orbit line across it, and any planet the composite puts behind it.
     * The depth written is the quad's plane rather than the sphere's surface, which is a good deal closer
     * to right than it sounds: the plane is set one radius in front of the body's centre, so it is the
     * depth of the near pole, exact at the middle of the disc and up to one radius too near at the limb.
     * That is what puts the orbit line behind the body it belongs to instead of in a tie with it — the
     * line runs through the body's centre, and a plane through the centre would z-fight with it across
     * the whole silhouette. Moving the plane costs nothing anywhere else, because moving a camera-facing
     * plane along the axis to the camera and scaling it to match slides every corner along its own ray:
     * the same pixels, aiming the same directions, drawn at a nearer depth; see
     * {@link AccretionDisk#setCompanion}.
     *
     * Drawn as an overlay in both of the disc's modes rather than following it into the background,
     * which is a choice worth stating: this quad has no sky in it to be a background *of*, every
     * fragment it keeps is an opaque surface, and there is nothing of the scene's it could wrongly erase
     * because the body it draws is the one whose mesh has been hidden for it. The photon ring is at a
     * higher render order still, so it is drawn after this and against the depth this wrote — over the
     * body where the body is behind the hole, and behind it where it is in front.
     *
     * @param {number} index - Which companion slot this quad carries; see {@link MAX_COMPANIONS}.
     * @returns {THREE.Mesh} The quad, hidden until there is a companion in that slot to trace.
     */
    createCompanionQuad(index) {
        const geometry = new THREE.PlaneGeometry(1, 1);

        const mesh = new THREE.Mesh(geometry, this.createCompanionMaterial(index));
        mesh.renderOrder = OVERLAY_RENDER_ORDER;
        mesh.frustumCulled = false;
        mesh.visible = false;

        return mesh;
    }

    /**
     * Builds a companion quad's material.
     *
     * The disc's uniforms, shared rather than copied — the same uniform objects in a new outer record —
     * so that everything {@link AccretionDisk#update} writes once is seen by every material and no two
     * of them can describe different photon paths. The exceptions are the two uniforms a quad owns
     * rather than shares: `uQuadOffset`, which is where it is, and `uQuadCompanion`, which is whose it
     * is; see {@link vertexShader} and {@link AccretionDisk#createCompanionQuad}.
     *
     * All of the companion quads therefore compile to one program, the index being a uniform rather
     * than a define, which is what keeps the ceiling on their number free of anything but memory.
     *
     * Transparent with premultiplied alpha, like the disc without a sky, although every fragment that
     * survives here has an alpha of exactly one and would composite the same way unblended. It is set
     * for where it puts the draw rather than for the blend: the transparent pass runs after the opaque
     * one, so the occluder's depth is already written when this is tested against it, and back-to-front
     * ordering there puts the companion under the photon ring.
     *
     * Depth written all the same, which is not what a transparent material normally does and is right
     * here for the same reason the alpha is redundant — nothing survives to this material's blend that is
     * not an opaque surface. Every fragment that would have been the gas, the sky or empty space has
     * already been discarded; see {@link AccretionDisk#createCompanionQuad}.
     *
     * @param {number} index - Which companion slot the quad carries; see {@link MAX_COMPANIONS}.
     * @returns {THREE.ShaderMaterial} The quad's material.
     */
    createCompanionMaterial(index) {
        return new THREE.ShaderMaterial({
            uniforms: {
                ...this.uniforms,
                uQuadOffset: { value: new THREE.Vector3() },
                uQuadCompanion: { value: index }
            },
            defines: { COMPANION_ONLY: '' },
            vertexShader,
            fragmentShader: ShaderLoader.createFragmentShader(fragmentShaderMainCode),
            transparent: true,
            premultipliedAlpha: true,
            depthWrite: true,
            depthTest: true,
            side: THREE.DoubleSide,
            toneMapped: false
        });
    }

    /**
     * Advances the gas and re-aims the billboard.
     *
     * The churn is driven by the effects clock rather than simulation time, so the gas moves at
     * a steady pace instead of freezing when the simulation is paused or blurring into noise
     * when it is run at sixty thousand times real time.
     *
     * The rest is what the shader needs to know about where it is: where the camera is relative to
     * the hole, the rotation into the disc's own frame, and a quad big enough to cover whatever of
     * the disc is on screen. The frame comes from a separate object rather than from the
     * billboard's own transform because the two need different orientations — the disc is tilted
     * with the body, and the billboard has to face the camera.
     *
     * The camera's position is differenced against the hole's here, in double precision, rather
     * than handed over as two world positions for the shader to subtract. That is not tidiness. The
     * tracer works in horizon radii and a hole is drawn very small against the distances it moves
     * over: this one is six ten-thousandths of a scene unit across and orbits nine hundred units
     * out, and two positions of that size rounded to the float32 a uniform or a varying carries
     * differ only in steps of a tenth of a horizon radius. That is two percent of the shadow's
     * width — several pixels — so a difference taken after the rounding is quantised exactly where
     * the tracer is most sensitive, and jumps to a different quantum whenever the camera or the
     * hole moves far enough to round the other way. It shows up as the disc breaking into blocks
     * and sliding about on the hole, neither of which is anything to do with the gas. Differenced
     * first, the number that reaches the shader is the size of the camera's distance from the hole
     * and keeps its full precision; the quad's own corners are handled the same way in
     * {@link vertexShader}.
     *
     * @param {number} deltaTime - Time since the last frame, in scaled seconds.
     * @param {THREE.PerspectiveCamera} camera - Camera the disc is drawn for.
     * @param {THREE.Object3D} discFrame - Object whose local `xz` plane is the disc's plane and
     *   whose origin is the hole's centre, normally the body's tilt container. The origin has to be
     *   the billboard's as well, since that is what the quad's corners are offsets from.
     * @param {Body[]|null} [companions=null] - The bodies orbiting the hole closely enough to be drawn
     *   by the tracer rather than by their own meshes, throughout their orbits; see
     *   {@link AccretionDisk#setCompanions}. Order matters and must be stable from frame to frame.
     * @returns {void}
     */
    update(deltaTime, camera, discFrame, companions = null) {
        this.time += deltaTime;
        this.uniforms.uTime.value = this.time;

        if (!camera || !discFrame) {
            return;
        }

        // Where the hole is *this* frame. Orbits are advanced before this runs, but world matrices
        // are only refreshed inside the render call, so left as they stand they still describe the
        // previous frame. The hole is small enough that the gap matters: run at any speed worth
        // watching an orbit at, it moves more than its own horizon between frames, and the disc
        // would be traced around a centre the hole has already left.
        discFrame.updateWorldMatrix(true, false);

        _centre.setFromMatrixPosition(discFrame.matrixWorld);
        this.uniforms.uCameraOffset.value.subVectors(camera.position, _centre);

        discFrame.matrixWorld.extractBasis(_basisX, _basisY, _basisZ);
        _basisX.normalize();
        _basisY.normalize();
        _basisZ.normalize();

        // Rows, so the matrix takes a world direction to its components along the disc's axes.
        this.uniforms.uToDisc.value.set(
            _basisX.x, _basisX.y, _basisX.z,
            _basisY.x, _basisY.y, _basisY.z,
            _basisZ.x, _basisZ.y, _basisZ.z
        );

        this.setCompanions(companions, camera);
        this.bindSky();

        // Sizes, positions and aims the quad together, because in the views where no plane through the
        // hole covers the frame the three are one decision; see {@link AccretionDisk#placeBillboard}.
        this.placeBillboard(camera);
    }

    /**
     * Hands the tracer every body that orbits inside the lensing.
     *
     * The whole list, in one call, rather than a body at a time, because what the slots hold has to be
     * decided against the list as a whole: a slot left alone is a slot still tracing last frame's body,
     * and the mesh of a body dropped from the list stays hidden until something tells it otherwise. So
     * the slots are walked to the ceiling and each is given the body at its own index or nothing, which
     * makes a shortened list release exactly the slots it no longer fills.
     *
     * Order matters, and the caller's order is used as it stands rather than sorted into one of this
     * class's choosing. Which slot a body lands in decides which quad is aimed at it, and a body that
     * changes slot between frames is a body whose hysteresis state — kept per slot, as the hidden mesh —
     * is read from a slot that was tracing something else, which is the flicker
     * {@link COMPANION_SWITCH_MARGIN} exists to prevent. A caller handing over a parent's children in
     * array order gets that stability for free, which is why nothing more is asked of it.
     *
     * Past the ceiling the extra bodies are dropped, and loudly: silence there looks exactly like the
     * bug described at {@link MAX_COMPANIONS}, a moon snapping off its own orbit line as it passes behind
     * the hole, and that is not a thing to leave to be found by looking. Once per disc, because it is a
     * property of the scene's data rather than of the frame and every frame would say the same.
     *
     * @param {Body[]|null} companions - The bodies to trace, or null or empty to trace none. Each needs
     *   what {@link AccretionDisk#setCompanion} asks of it; ones that do not qualify are dropped
     *   individually and do not shift the others along.
     * @param {THREE.PerspectiveCamera} camera - Camera the disc is drawn for, passed through.
     * @returns {void}
     */
    setCompanions(companions, camera) {
        const list = companions || EMPTY_COMPANIONS;

        if (list.length > MAX_COMPANIONS && !this.warnedOverflow) {
            this.warnedOverflow = true;
            log.warn('AccretionDisk',
                `${list.length} bodies orbit inside the lensing and only ${MAX_COMPANIONS} can be `
                + 'traced; the rest will snap off their orbit lines behind the hole. '
                + 'Raise MAX_COMPANIONS.');
        }

        for (let index = 0; index < MAX_COMPANIONS; index++) {
            this.setCompanion(index, list[index] || null, camera);
        }
    }

    /**
     * Hands one of the tracer's slots a body to draw along with the gas.
     *
     * A body orbiting this close cannot be drawn as a mesh and be right. The quad is composited under
     * the scene and writes no depth, so its own mesh draws over the gas and over the lensing whatever
     * order they are given; and the picture it draws over is a picture of bent light, while the mesh
     * is the one thing in the frame still travelling in straight lines. There is no arrangement of
     * depth and render order that fixes the second, because the ray that finds a body behind a black
     * hole is not the straight line a depth buffer measures along. It is the wrong renderer for the
     * job, and the fix is to take the job away from it: the mesh is hidden and the surface is traced,
     * so its light bends on the same paths as the sky's and the gas in front of it dims it by the same
     * accumulation that dims everything else the ray crossed. Stretched round the shadow's rim, seen
     * twice where the geometry gives two images, and gone where the hole is in the way — none of which
     * is drawn on afterwards; it is what following the light gives.
     *
     * For the whole orbit, and not only for the part of it with the hole visibly in the way, because a
     * switch of renderer is a jump. There is no position on this orbit where a mesh and a geodesic draw
     * the body in the same pixels, and how far apart they are can be written down. For a body at an
     * angle `ψ` from the camera, measured at the hole, the image stands off the straight line to it by
     *
     *     δ = ½ (1 − cos ψ)² / sin ψ
     *
     * horizon radii, outwards, which falls out of the first-order path `1/r = sin φ / b + (1 + cos²φ) /
     * 2b²` on asking which impact parameter carries a path through the body; the same march this shader
     * runs agrees with it to a few percent everywhere from fifteen degrees to a hundred and five. It
     * does not depend on how far away the camera is, only on the angle, so there is no distance to back
     * off to that makes it go away — at a hundred radii out or at three million, the body's image is
     * off its straight-line position by the same fraction of the body's own width.
     *
     * The plane through the hole's centre is the obvious place to hand over and it is the wrong one: δ
     * there is half a horizon radius, which for this moon is getting on for two of its own radii. That
     * plane is not where the bending is least. It is where half of the bending has already happened —
     * the ray has come in from far away and turned through everything the field had to give on the way
     * in, and only the outward half is still to come. A body handed over there is picked up by the trace
     * already two of its own widths from where the mesh drew it the frame before, with the orbit line it
     * was sitting on still exactly where it was. No margin, ramp or cross-fade around the switch helps,
     * because the disagreement being hidden is not small; that is the pop, and the only way to not have
     * it is to not switch.
     *
     * Where δ *is* small is towards the camera, and steeply: it goes as `ψ³ / 8`, which is a tenth of
     * one of this moon's radii by thirty degrees off the camera's line and a fiftieth by fifteen.
     * Nowhere on the far side of the hole, and no plane through it, is remotely that quiet. So the mesh
     * is not used as an alternative at all. It is hidden for the whole orbit, the surface is traced for
     * the whole orbit, and there is no frame in which the body changes renderer.
     *
     * Nor in any view, which is the other half of the same argument. A quad through the hole's centre
     * cannot carry a ray more than a right angle from the line to the hole, so a camera close to the body
     * — which is where selecting it puts one — asks for pixels that quad does not have, for want of
     * fragments rather than for any reason to do with light. So the body is given a quad of its own,
     * centred on it, and the two overlap without disagreeing because the ray a pixel traces does not
     * depend on which quad supplied it; see {@link AccretionDisk#createCompanionQuad}. There is no view
     * in which the surface goes undrawn, and so no condition on the view to ramp across.
     *
     * One condition remains, and it is not a place on the orbit and not a switch of renderer either: the
     * surface has to be worth more than the single pixel that already stands in for the body, and below
     * that size the pinpoint keeps it and the tracer leaves it alone; see {@link COMPANION_MIN_PIXELS}.
     * The two agree to about a pixel by construction, which is all a pixel-sized body can disagree by. It
     * carries hysteresis all the same, because a camera parked on a threshold crosses it repeatedly and a
     * pixel appearing and disappearing at frame rate is visible as flicker; see
     * {@link COMPANION_SWITCH_MARGIN}.
     *
     * Only the surface, in any case. The body keeps its own orbit, its marker, its label and its orbit
     * line, and those are drawn to where the body *is* rather than to where its light arrives from —
     * straight lines, bent by {@link BodyLensPass} at most as a thin lens rather than as a geodesic. So
     * the traced surface stands off its own marker by δ: a fiftieth of its width out towards the camera,
     * two widths abreast of the hole, several widths near conjunction where it is also stretched round
     * the rim and doubled. That is the lensing being shown rather than corrected away, which is why no
     * corrective shift is applied here. Moving the position the tracer is given inwards by δ would land
     * the traced image back on the drawn orbit line, and that is a picture of the annotation being right
     * and the light being wrong.
     *
     * Everything the shader is told comes from the body's own material rather than from a second copy
     * of the same settings, so the traced surface and the mesh cannot drift apart: the same texture,
     * the same light direction, the same light colour. If the material has no surface texture there is
     * nothing to trace it with, and the companion is dropped rather than drawn black — the mesh then
     * stays visible, which is wrong in the ways described above but not invisible.
     *
     * Positions are differenced against the hole's centre here in double precision, and for the reason
     * given at {@link AccretionDisk#update}: at a horizon radius of six ten-thousandths of a scene unit,
     * a world position that has been through a float32 uniform is quantised to a tenth of a radius, and
     * the tracer is being asked to place a body a third of a radius across.
     *
     * A slot rather than a list, because everything above is per body: the quad is aimed at one body, the
     * pixel test asks after one body's apparent size, and the hysteresis that test carries is the memory
     * of what this slot was tracing last frame. The shader is the only place the companions meet, and it
     * meets them all in every ray — which is what gives them the right occlusion of each other, since the
     * nearest surface a ray crosses wins whichever slot it came from. Slots are independent here and only
     * there; see {@link AccretionDisk#setCompanions} for why the caller's ordering must be stable.
     *
     * @param {number} index - Which slot to fill; see {@link MAX_COMPANIONS}.
     * @param {Body|null} companion - The body to trace, or null to trace none. Needs a `mesh`, a
     *   `radius` in scene units and a `material` carrying the surface texture and lighting.
     * @param {THREE.PerspectiveCamera} camera - Camera the disc is drawn for, to aim and size the
     *   companion's quad and to judge it against a pixel. Its `uCameraOffset` must already be this
     *   frame's, which {@link AccretionDisk#update} sees to before calling.
     * @returns {void}
     */
    setCompanion(index, companion, camera) {
        const mesh = companion ? companion.mesh : null;
        const material = companion ? companion.material : null;
        const texture = material && material.uniforms && material.uniforms.surfaceTexture
            ? material.uniforms.surfaceTexture.value
            : null;

        if (!mesh || !companion.radius || !texture || !camera) {
            this.releaseCompanion(index);
            return;
        }

        // The same refresh the disc frame gets, for the same reason: matrices are only brought up to
        // date inside the render call, so a body's own transform still describes the previous frame.
        mesh.updateWorldMatrix(true, false);

        _companionOffset.setFromMatrixPosition(mesh.matrixWorld).sub(_centre);

        // How far the body is from the camera, which is what its apparent size is measured against and
        // what its quad is sized in. Differenced as two offsets from the hole rather than as two world
        // positions, for the reason given at {@link AccretionDisk#update} — and no other property of the
        // view is asked for. Which side of the hole the body is on, in particular, is not: the trace
        // draws it on either, and nothing here hands it back to its mesh for being behind.
        const range = _viewAxis.copy(this.uniforms.uCameraOffset.value).sub(_companionOffset).length();

        // Stiffer to enter than to leave, which is what keeps a camera flying along the threshold from
        // switching every few frames; see {@link COMPANION_SWITCH_MARGIN}. Already tracing *this* body is
        // the state, and the hidden mesh is where it is kept.
        const margin = this.companionMeshes[index] === mesh ? 1.0 : COMPANION_SWITCH_MARGIN;

        // Is the surface worth having, or is this a view the pinpoint should keep? The body's apparent
        // diameter against the angle one pixel covers, both in radians; see {@link COMPANION_MIN_PIXELS}.
        const pixelAngle = THREE.MathUtils.degToRad(camera.fov) / Math.max(window.innerHeight, 1);

        if (2.0 * companion.radius < COMPANION_MIN_PIXELS * margin * pixelAngle * range) {
            this.releaseCompanion(index);
            return;
        }

        // Wide enough to hold the image wherever the lensing has carried it — see
        // {@link COMPANION_IMAGE_RADII} — and cut to the viewport, which only binds from close enough
        // that those radii are more than a couple of screens wide. That is a camera nearly on top of the
        // body, which puts it within a few degrees of the body as measured at the hole — and `δ` goes as
        // the cube of that angle, so the displacement being covered is down to thousandths of a radius.
        // The cap binds exactly where there is nothing left for it to cut off.
        const cone = Math.tan(THREE.MathUtils.degToRad(camera.fov) * 0.5);

        const width = Math.min(COMPANION_IMAGE_RADII * companion.radius,
            range * cone * SCREEN_COVER_FACTOR * Math.max(camera.aspect, 1.0));

        // Brought forward to the body's near pole, because the depth this quad writes is the plane's and
        // the thing it has to be right about is the body's own orbit line, which runs through the body's
        // centre; see {@link AccretionDisk#createCompanionQuad}. The move is free of the tracing, and
        // exactly rather than nearly: the plane faces the camera, so sliding it along the axis to the
        // camera and scaling it in the same proportion carries every point of it along its own ray to the
        // camera. Same pixels, same directions, one radius nearer. Capped at half the range for the case
        // that has no answer, a camera closer to the body than the body is wide.
        const shift = Math.min(companion.radius, 0.5 * range);
        const scale = (range - shift) / Math.max(range, 1e-12);

        // The offset the shader is given, from the hole's centre to the plane's centre — which is the one
        // form of the position small enough to survive a float32; see {@link vertexShader}. The transform
        // below places the same point again for three.js, from the same double-precision offset, and the
        // shader does not read it.
        _quadCentre.copy(_viewAxis).multiplyScalar(shift / Math.max(range, 1e-12)).add(_companionOffset);

        const quad = this.companionQuads[index];

        quad.material.uniforms.uQuadOffset.value.copy(_quadCentre);

        quad.updateWorldMatrix(true, false);

        _quadCentre.add(_centre);
        if (quad.parent) {
            quad.parent.worldToLocal(_quadCentre);
        }
        quad.position.copy(_quadCentre);
        quad.lookAt(camera.position);

        quad.scale.set(2.0 * width * scale, 2.0 * width * scale, 1.0);
        quad.visible = true;

        const toDisc = this.uniforms.uToDisc.value;

        this.uniforms.uCompanionCentre.value[index]
            .copy(_companionOffset)
            .applyMatrix3(toDisc)
            .divideScalar(this.horizonRadius);

        this.uniforms.uCompanionRadius.value[index] = companion.radius / this.horizonRadius;

        // The body's own axes, each expressed in the disc's frame, as the rows of the matrix — which
        // makes it the rotation from the frame the tracer works in to the frame the texture is wrapped
        // in. Taken from the mesh rather than from the body's orbit so that it carries the spin and the
        // axial tilt exactly as the mesh's own vertices do, tidal locking included.
        mesh.matrixWorld.extractBasis(_companionX, _companionY, _companionZ);

        _companionX.normalize().applyMatrix3(toDisc);
        _companionY.normalize().applyMatrix3(toDisc);
        _companionZ.normalize().applyMatrix3(toDisc);

        this.uniforms.uCompanionToLocal.value[index].set(
            _companionX.x, _companionX.y, _companionX.z,
            _companionY.x, _companionY.y, _companionY.z,
            _companionZ.x, _companionZ.y, _companionZ.z
        );

        this.uniforms.uCompanionLight.value[index]
            .copy(material.lightDirection)
            .applyMatrix3(toDisc)
            .normalize();

        this.uniforms.uCompanionLightColor.value[index].copy(material.lightColor);
        this.uniforms.uCompanionTexture.value[index] = texture;

        // And its pinpoint with it, which is not a detail. The pinpoint stands in for a body too far
        // off to draw, and it is only ever invisible because it sits at the body's own centre with the
        // body's near surface in front of it — so hiding the mesh is what reveals it. Left showing it
        // would be a second image of the body drawn by the wrong rules: it writes no depth, so
        // {@link BodyLensPass} reads the far plane at it and bends it as though infinitely far behind
        // the hole, while the surface beside it is being traced along the actual geodesics — which
        // draws the moon's pinpoint outside the moon.
        mesh.visible = false;
        this.companionMeshes[index] = mesh;

        const pinpoint = companion.pinpointMesh || null;
        this.companionPinpoints[index] = pinpoint;
        if (pinpoint) pinpoint.visible = false;
    }

    /**
     * Gives a traced companion back to its own mesh and pinpoint.
     *
     * The two that were hidden are remembered rather than inferred, and only those are shown again.
     * Visibility is not this class's to set — a body's mesh may be hidden for reasons of its own — so
     * what is undone here is exactly what {@link AccretionDisk#setCompanion} did and nothing else. Runs
     * every frame there is no companion to trace, or the view will not let it be traced, so it has to be
     * cheap and idempotent, and is.
     *
     * The slot's quad is hidden as well as being told there is no companion. Either alone would do —
     * with `uCompanionRadius` at zero every fragment of that quad discards on the plane test — and doing
     * both means the geometry is not submitted at all in the ordinary case, which is every frame of the
     * scene in which nothing is orbiting inside the lensing.
     *
     * The texture is dropped along with the radius, which is worth the line it costs even though the
     * shader will not sample a sphere it cannot reach: a slot holding a texture holds the body's whole
     * surface, and a disc that outlives the body it was tracing would keep it from being freed.
     *
     * @param {number} index - Which slot to empty; see {@link MAX_COMPANIONS}.
     * @returns {void}
     */
    releaseCompanion(index) {
        this.uniforms.uCompanionRadius.value[index] = 0.0;
        this.uniforms.uCompanionTexture.value[index] = null;
        this.companionQuads[index].visible = false;

        const mesh = this.companionMeshes[index];
        if (mesh) {
            mesh.visible = true;
            this.companionMeshes[index] = null;
        }

        const pinpoint = this.companionPinpoints[index];
        if (pinpoint) {
            pinpoint.visible = true;
            this.companionPinpoints[index] = null;
        }
    }

    /**
     * Empties every slot, giving all of the traced bodies back to their own meshes.
     *
     * For the cases that are about the disc rather than about a body: being disposed of, or being handed
     * no companions at all. Slot by slot, so that each body is given back exactly what was taken from it.
     *
     * @returns {void}
     */
    releaseCompanions() {
        for (let index = 0; index < MAX_COMPANIONS; index++) {
            this.releaseCompanion(index);
        }
    }

    /**
     * Points the tracer at whatever the scene is using for a sky.
     *
     * Found by walking up from the billboard rather than being handed over, which is not laziness:
     * what the tracer has to match is exactly what three.js draws behind it, and the two things that
     * decide that — the background texture and the intensity it is scaled by — are properties of the
     * scene that the skybox is free to change at any time. {@link SkyboxManager} hides the sky by
     * clearing `background` and dims it by setting `backgroundIntensity`, and reading them here means
     * both are followed without either side knowing about the other. A copy taken once at
     * construction would be a copy to keep in step.
     *
     * Only a cube map will do. Everything else — an equirectangular texture, a flat colour, nothing
     * at all — leaves the tracer switched off, and the shader then throws out the rays that only cross
     * sky, there being nothing for them to bring back.
     *
     * Which of the two it is also decides where in the frame the quad is drawn and whether it is blended
     * at all, so this is where that is set; see {@link BACKGROUND_RENDER_ORDER}. Written only on a
     * change, because `transparent` moves the mesh between the renderer's two lists and the answer is
     * the same on almost every frame of the scene's life.
     *
     * @returns {void}
     */
    bindSky() {
        let root = this.mesh;
        while (root.parent) {
            root = root.parent;
        }

        const background = root.isScene ? root.background : null;
        const sky = background && background.isCubeTexture ? background : null;

        this.uniforms.uSky.value = sky;
        this.uniforms.uSkyIntensity.value = sky
            ? (root.backgroundIntensity !== undefined ? root.backgroundIntensity : 1.0)
            : 0.0;
        this.uniforms.uSkyFadeImpact.value = sky ? SKY_FADE_IMPACT : 0.0;

        // Read by {@link BlackHoleLensPass}, which must not warp a frame in which the sky has
        // already been bent properly.
        this.tracesSky = sky !== null;

        const order = this.tracesSky ? BACKGROUND_RENDER_ORDER : OVERLAY_RENDER_ORDER;

        if (this.mesh.renderOrder !== order) {
            this.mesh.renderOrder = order;
            this.mesh.material.transparent = !this.tracesSky;
        }
    }

    /**
     * Scales the quad to whichever is smaller: what has to be drawn, or the viewport.
     *
     * Taking the smaller of the two is what makes one size work at every distance. From outside, what
     * has to be drawn is the smaller and the quad is cut to it, so no pixel is traced that has nothing
     * behind it. Close in the viewport is smaller, and clipping the quad there costs nothing, because
     * what it clips away is off screen anyway.
     *
     * What has to be drawn is the larger of two things, and while the disc is by far the brighter, it
     * is the lensed sky that sets the size: the disc's image is a handful of horizon radii across and
     * the sky is bent measurably out to some hundreds of them, so the quad is mostly there to hold
     * the lensing. Both are stated as impact parameters and both are turned into a plane radius by
     * {@link planeExtent}, which is the whole of the difference between the two and is not a detail —
     * it is what keeps the quad's own edge from being visible, since the drawn region then ends at the
     * circle where the fade has already reached nothing rather than at a straight edge where it has
     * not. What the extra area costs is a comparison: a ray past the fade's end is discarded on the
     * impact parameter before anything is traced.
     *
     * The consequence worth stating plainly is that close to the hole this quad covers the whole
     * frame and draws over it opaquely. Anything else in the scene is then hidden, which is a real
     * loss and not a large one: a camera close enough for this is a few thousandths of a scene unit
     * from the hole, where every other body is a point tens of units away. It is also the honest
     * answer of the two available, since from there the hole bends the entire sky by many pixels, so
     * leaving those points where they are would not be showing them correctly either.
     *
     * The disc's extent is not its radius, though, and cutting the quad to the radius is what
     * leaves a hard rectangle across the disc with the arms lopped off. The quad is a plane through
     * the hole's *centre*, and the near half of the disc stands in front of that plane: the same
     * offset from the axis subtends a wider angle from closer up, so the near rim is projected
     * outside the circle its own radius would occupy on the quad. The worst case is the rim's
     * tangent point, at `cosφ = R / d`, which needs a plane radius of `R / √(1 - R²/d²)`. That is a
     * ratio of `1.02` at fifteen horizon radii, `1.4` at ten and unbounded as the camera reaches
     * the rim — so it cannot be folded into a constant and has to be worked out per frame.
     *
     * At and inside the rim there is no finite plane that holds the disc, which is why the
     * viewport limit is not merely an optimisation: it is the only thing keeping this bounded. It
     * has to be the frame's actual reach across the plane and not a multiple of the frame's size,
     * for the reason set out at {@link frustumExtent} — the quad is centred on the hole, the frame
     * is not, and the gap between them is the whole of the picture when the camera is looking at
     * something else.
     *
     * And when there is no size that works, the plane moves. The two unbounded cases are not
     * independent: the drawn region runs off the plane's edge only when the camera is inside the
     * fade's impact parameter, which is exactly when every direction is bent and the whole frame
     * has to be traced; and the frame runs off the plane's edge only when the hole is far enough
     * off the view axis to see that plane edge-on. Both at once leaves nothing to size to, and the
     * fix is to stop insisting on a plane through the hole — the tracer reads a *point* off this
     * quad and nothing else, so any surface in front of the camera serves, and the one that covers
     * the frame exactly is the one square to the view; see {@link AccretionDisk#coverFrame}.
     *
     * @param {THREE.PerspectiveCamera} camera - Camera to size and aim against.
     * @returns {void}
     */
    placeBillboard(camera) {
        camera.updateWorldMatrix(true, false);
        camera.matrixWorld.extractBasis(_cameraX, _cameraY, _cameraZ);

        // Aimed with the camera's own up rather than the world's, which is what lets a quad square to
        // the view be sized to the frame's own width and height; see {@link AccretionDisk#coverFrame}.
        // It also removes the degenerate aim, since a camera's up is never along its line of sight.
        this.mesh.up.copy(_cameraY).normalize();

        const distance = camera.position.distanceTo(_centre);

        const discExtent = planeExtent(this.outerRadius * this.horizonRadius, distance) *
            BILLBOARD_MARGIN;

        // Zero where there is no sky to bend, which leaves the quad cut to the disc alone.
        const skyExtent = planeExtent(this.uniforms.uSkyFadeImpact.value * this.horizonRadius,
            distance);

        // The traced companions ask nothing of this quad, which is worth a line since they are the one
        // thing traced here that this quad is not sized for. They orbit well outside the gas, so no plane
        // through the hole's centre is a reliable way to reach them — stretching this one to try is
        // expensive and, for a camera near one of them, impossible. Each has a quad of its own; see
        // {@link AccretionDisk#createCompanionQuad}.
        const extent = Math.max(discExtent, skyExtent);

        if (!Number.isFinite(extent)) {
            this.coverFrame(camera, distance);
            return;
        }

        // Clipping to the frame is only worth anything when the frame is the smaller of the two, and
        // an unbounded reach says it is not, so leaving `extent` to stand is the right answer there.
        const half = Math.min(extent, frustumExtent(camera, _centre) * VIEWPORT_MARGIN);

        this.uniforms.uQuadOffset.value.set(0.0, 0.0, 0.0);
        this.mesh.position.set(0.0, 0.0, 0.0);
        this.mesh.scale.set(half * 2, half * 2, 1);
        this.mesh.lookAt(camera.position);
    }

    /**
     * Puts the quad square to the view, covering the frame and nothing else.
     *
     * For the views where no plane through the hole covers the frame — the camera inside the lensed
     * region with the hole well off to one side, which is what looking at the companion from close
     * up is. The quad is then a plane square to the line of sight instead of to the line to the
     * hole, and the frame's footprint on such a plane is exactly the rectangle `depth · tan(fov/2)`
     * high and that times the aspect wide, whatever the camera is pointed at. There is no case left
     * for it to fail on, because a plane the frame is centred on cannot be seen edge-on.
     *
     * It costs nothing in accuracy, which is the point worth being clear about: the quad is a supply
     * of pixels and the corner offsets are handed to the tracer as offsets from the hole, so the ray
     * through a pixel is the same ray whichever surface delivered it; see {@link vertexShader}. It
     * does cost the whole frame in tracing, and that is not a loss either — these are the views where
     * the whole frame is lensed sky, so every one of those pixels has to be traced regardless.
     *
     * Every depth draws the same picture, for that same reason — the ray through a pixel does not
     * depend on how far along it the quad was met — so the depth is free to be chosen for what the
     * depth *buffer* makes of it, and it is kept off the near plane, where corner offsets pinched
     * down towards nothing would start to quantise the ray directions in float32.
     *
     * Which depth is not free, though, and this is the one thing about this quad that is not just a
     * matter of coverage: the shadow's occluder is the only depth the hole has, and everything the
     * tracer draws has to beat it or the gas crossing the silhouette is clipped away by the solid
     * standing in for that silhouette; see {@link BlackHoleEffects.addShadowOccluder}. A quad through
     * the hole's centre beats it by construction, and that is what a plane square to the *view* gives
     * up: at any angle off the axis it slopes away behind the hole, and the occluder — a disc square
     * to the line to the camera, as wide on screen as the shadow — then stands in front of it and
     * eats the near gas and the rim.
     *
     * So the depth is not the hole's but the occluder's nearest corner: `d·cos ψ` for the hole's own
     * depth, less `d·sin ψ` of tilt times the shadow's apparent tangent, which is the occluder's own
     * radius stated as a fraction of its distance. That comes out exactly one occluder margin in
     * front of the real thing, since the real thing is stood back by that margin, so the same hair
     * that clears it for the centred quad clears it for this one and there is no new constant.
     *
     * @param {THREE.PerspectiveCamera} camera - Camera whose frame is being covered.
     * @param {number} distance - Camera distance to the hole's centre, in world units.
     * @returns {void}
     */
    coverFrame(camera, distance) {
        camera.getWorldDirection(_frameNormal);

        // The hole in the frame's own terms: how far down the line of sight, and how far off it.
        _viewAxis.subVectors(_centre, camera.position);

        const along = _viewAxis.dot(_frameNormal);
        const across = Math.sqrt(Math.max(_viewAxis.lengthSq() - along * along, 0.0));

        // In front of the occluder's nearest corner, which is what the quad has to beat.
        const clear = along -
            across * shadowApparentTangent(distance / Math.max(this.horizonRadius, 1e-12));

        const depth = Math.max(clear, camera.near * 2.0);

        const halfHeight = depth * Math.tan(THREE.MathUtils.degToRad(camera.fov) * 0.5) *
            VIEWPORT_MARGIN;

        // The centre of the frame at that depth, held as an offset from the hole, which is the form
        // the vertex shader adds it in and the only form precise enough to hold it in.
        _quadCentre.copy(camera.position).addScaledVector(_frameNormal, depth).sub(_centre);
        this.uniforms.uQuadOffset.value.copy(_quadCentre);

        _quadCentre.add(_centre);
        if (this.mesh.parent) {
            this.mesh.parent.updateWorldMatrix(true, false);
            this.mesh.parent.worldToLocal(_quadCentre);
        }
        this.mesh.position.copy(_quadCentre);

        this.mesh.scale.set(halfHeight * camera.aspect * 2, halfHeight * 2, 1);

        // Its centre sits on the line of sight, so aiming it at the camera makes it square to that
        // line, and aiming it with the camera's up lines its width and height up with the frame's.
        this.mesh.lookAt(camera.position);
    }

    /**
     * Parents the disc to another object.
     *
     * The companions' quads go to the same parent, and have to: their corners are handed to the shader as
     * offsets from that parent's origin, which is the hole's centre; see {@link vertexShader}. Each is
     * hidden until there is something for its slot to trace, which for most scenes is all of them for
     * ever — an added-but-hidden mesh costs the renderer a visibility test.
     *
     * @param {THREE.Object3D} parent - Object to add the meshes to.
     * @returns {void}
     */
    addToScene(parent) {
        parent.add(this.mesh);
        for (const quad of this.companionQuads) {
            parent.add(quad);
        }
        log.debug('AccretionDisk', 'Accretion disc added to scene');
    }

    /**
     * The disc's mesh.
     *
     * @returns {THREE.Mesh} The mesh.
     */
    getMesh() {
        return this.mesh;
    }

    /**
     * Every mesh the disc draws with, for a caller that has to treat all of them alike.
     *
     * Which is what the layers are: every quad runs the same tracer, so every one of them is already
     * lensed and none may be lensed again; see {@link BlackHoleEffects.markUnlensed}.
     *
     * @returns {THREE.Mesh[]} The disc's quad and the companions'.
     */
    getMeshes() {
        return [this.mesh, ...this.companionQuads];
    }

    /**
     * Sets how finely the march samples the gas, trading the disc's cost against its accuracy.
     *
     * This is the disc's cost dial, and the one to reach for first, because the gas samples are what
     * the march actually spends its time on rather than the steps that carry it between them; see
     * {@link SLAB_STEP} for the measured trade and for why nothing else here is worth turning down.
     * Larger is cheaper and coarser. Against a converged march the error runs about a thirty-third at
     * the default of 0.75, a twenty-fourth at 1.0 and a seventeenth with the cap lifted entirely, so
     * there is little left to win much beyond 1.0 and the way back down gets expensive quickly.
     *
     * Takes effect on the next frame and needs no rebuild, which is the point of it being a uniform:
     * it is meant to be turned while watching the disc. Every quad sees it, since the companions'
     * materials share this one's uniform objects; see {@link AccretionDisk#createCompanionMaterial}.
     *
     * Non-finite and non-positive values are refused rather than clamped. A step of zero does not
     * make a very accurate disc, it makes a march that cannot advance while it is anywhere near the
     * gas, which is a frozen tab rather than a slow one.
     *
     * @param {number} slabStep - The new cap, as a fraction of the slab's half-thickness. Must be
     *   finite and greater than zero.
     * @returns {number} The value now in force, unchanged if the argument was refused.
     */
    setSlabStep(slabStep) {
        if (!Number.isFinite(slabStep) || slabStep <= 0) {
            log.warn('AccretionDisk', `Ignoring invalid slab step ${slabStep}; must be finite and > 0`);
            return this.uniforms.uSlabStep.value;
        }

        this.uniforms.uSlabStep.value = slabStep;
        log.debug('AccretionDisk', `Slab step set to ${slabStep}`);

        return slabStep;
    }

    /**
     * How finely the march is currently sampling the gas.
     *
     * @returns {number} The slab step in force; see {@link AccretionDisk#setSlabStep}.
     */
    getSlabStep() {
        return this.uniforms.uSlabStep.value;
    }

    /**
     * Releases every quad's geometry and material and unparents them.
     *
     * The materials share their uniforms, so the textures the uniforms hold are not this class's to free
     * from any of them — they belong to the skybox and to the companions' own materials — and disposing a
     * `ShaderMaterial` does not touch them. What is given back rather than freed is the traced bodies'
     * own meshes, which are hidden while traced and would stay hidden after the disc that hid them is
     * gone.
     *
     * @returns {void}
     */
    dispose() {
        this.releaseCompanions();

        for (const mesh of [this.mesh, ...this.companionQuads]) {
            if (mesh.geometry) {
                mesh.geometry.dispose();
            }
            if (mesh.material) {
                mesh.material.dispose();
            }
            if (mesh.parent) {
                mesh.parent.remove(mesh);
            }
        }

        log.info('AccretionDisk', 'Accretion disc disposed');
    }
}

export default AccretionDisk;
