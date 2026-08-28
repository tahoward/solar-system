import MathUtils from './utils/MathUtils.js';
import { TEXTURES } from './assets/index.js';
import logger from './utils/Logger.js';

/**
 * Every tunable value in the project, plus the system it draws.
 *
 * Grouped by subject and exported as frozen-by-convention objects rather than as loose names,
 * so a value can be traced to its subject and related settings sit together. Most of these
 * numbers were arrived at by looking at the result rather than derived, and the comments record
 * what each one does to the picture where that is not evident from the name.
 */

/**
 * Which integrator is running.
 *
 * The only mutable group here, and the only one with methods: the physics mode is a runtime
 * switch, not a setting, so it lives with the flag it toggles rather than in a manager that
 * everything would then have to import.
 *
 * @type {{USE_N_BODY_PHYSICS: boolean, togglePhysicsMode: function(): boolean,
 *   getPhysicsMode: function(): string}}
 */
export const SIMULATION = {
  USE_N_BODY_PHYSICS: true,

  /**
   * Flips between n-body integration and Kepler orbits.
   *
   * @returns {boolean} True if n-body physics is now active.
   */
  togglePhysicsMode() {
    this.USE_N_BODY_PHYSICS = !this.USE_N_BODY_PHYSICS;
    logger.info('SIMULATION', `Physics mode switched to: ${this.USE_N_BODY_PHYSICS ? 'N-Body' : 'Kepler'}`);
    return this.USE_N_BODY_PHYSICS;
  },

  /**
   * The current mode's name, for display.
   *
   * @returns {string} `'N-Body'` or `'Kepler'`.
   */
  getPhysicsMode() {
    return this.USE_N_BODY_PHYSICS ? 'N-Body' : 'Kepler';
  }
};

/**
 * Timestep and stability limits for the n-body integrator.
 *
 * The two step limits pull against each other, deliberately. The first sets accuracy: the
 * fastest orbit in the system gets at least this many steps, and a moon integrated in a handful
 * of steps per orbit spirals visibly. The second caps how much work one frame may do, which is
 * what stops a high speed multiplier from freezing the browser — reaching it is what makes
 * {@link ClockManager} report the speed as physics-limited.
 *
 * The approach fraction shortens the step when two bodies close on each other, since the
 * accelerations there are what a fixed step gets most wrong.
 *
 * Softening puts a floor under the separation used in the force law, so a near-miss cannot
 * divide by something approaching zero and fling a body out of the system. Expressed in body
 * radii, with an absolute minimum for the case where both radii are tiny.
 *
 * @type {Object<string, number>}
 */
export const NBODY = {
  MIN_STEPS_PER_ORBIT: 60,

  MAX_APPROACH_FRACTION: 0.02,

  MAX_STEPS_PER_FRAME: 256,

  SOFTENING_RADII: 0.01,
  MIN_SOFTENING: 1e-9
};

/**
 * Parameters for the tidal locking model.
 *
 * The asymmetry is how far from spherical a locked body's mass distribution is taken to be —
 * without it there would be no torque to lock at all, since a perfect sphere has no preferred
 * orientation. Dissipation damps the resulting libration, so a body settles instead of rocking
 * forever.
 *
 * The substep limits are for the rotation integration: a body spun far enough in one step
 * overshoots and the torque then pulls it back, which shows as jitter. Capping the angle per
 * substep prevents that, and capping the substep count keeps a fast-spinning body from costing
 * an unbounded amount of work.
 *
 * @type {Object<string, number>}
 */
export const TIDAL_LOCK = {
  FIGURE_ASYMMETRY: 0.0208,

  DISSIPATION: 0.05,

  MAX_SUBSTEP_RADIANS: 0.2,

  MAX_SUBSTEPS: 12
};

/**
 * The body created by shift-clicking in n-body mode.
 *
 * The mass is the same as the Sun's, which is the point: something comparable to the primary is
 * what actually disturbs the system, and a realistically small mass would be invisible in its
 * effect. Orange so it is obviously not one of the real bodies.
 *
 * The drag tolerance is how far the pointer may travel between press and release and still count
 * as a click — see {@link InputController#handlePointerUp}.
 *
 * @type {Object<string, number>}
 */
export const MASS_DROP = {
  MASS: 1.0,

  RADIUS_SCALE: 0.5,

  COLOR: 0xff5a2b,
  MARKER_COLOR: 0xff5a2b,
  ROTATION_PERIOD: 240,

  DRAG_TOLERANCE_PIXELS: 5
};

/**
 * Scene-wide rendering settings.
 *
 * The scale converts the model's units into the ones the renderer works in, chosen so the whole
 * system fits in a range float32 can resolve. Multisampling is on at four samples, which is
 * what keeps the thin orbit lines and body limbs from crawling as the camera moves.
 *
 * `MAX_PIXEL_RATIO` is where a dense display's own ratio is cut off, and it is the scene's coarsest
 * dial: every fragment drawn is paid for at this density, and by more than one pass — the composer's
 * two targets, the body layer's, and the disc's per-pixel march. Squared, too, so the step from 1.5
 * to 2 is nearly twice the work. What buys the cut is that the reason to draw at a display's full
 * density is edges, and multisampling above is already dealing with those; what is left is the
 * interior of a smooth gradient, where there is nothing at that density to resolve. Raise it if a
 * machine has the fragments to spare.
 *
 * The two layers are the divisions the scene draws itself along, so that `BodyLensPass` can render
 * the parts separately and move one against the others. The hole's own drawing goes in
 * `UNLENSED_LAYER`, because it is what does the bending and so cannot be bent. Annotation — orbit
 * lines, trails, markers — goes in `OVERLAY_LAYER`, because it is drawn along straight lines to
 * where a body actually is rather than along the paths light actually takes, and a pin bent off its
 * own body reads as a second body rather than as a lensed one. Everything the hole bends is left in
 * the default layer, so a body added at runtime needs no bookkeeping to be lensed — it is lensed by
 * being where everything is. The camera has to be told to see both layers, since a camera watches
 * only the default one; that is done where the camera is built, so a hole is visible and a marker
 * is drawn even on a frame nothing is post-processing.
 *
 * @type {Object<string, number>}
 */
export const SCENE = {
  SCALE: 0.1,
  DEFAULT_RADIUS_FALLBACK: 1,

  MSAA_SAMPLES: 4,
  MAX_PIXEL_RATIO: 1.5,

  UNLENSED_LAYER: 1,
  OVERLAY_LAYER: 2
};

/**
 * Orbit computation, drawing and time control.
 *
 * `AU_SCALE_METERS` is the conversion from astronomical units to scene units, and is why the
 * bodies are far closer together relative to their sizes than they really are — at true scale
 * the planets would be invisible specks.
 *
 * Kepler's equation is transcendental and has to be solved numerically; the iteration count and
 * tolerance bound that. Eight iterations is comfortably enough at these eccentricities.
 *
 * The speed multipliers are in percent-like units — 1.0 is real time and the maximum is about
 * 65 000× — which is why {@link InputController} converts by 100 when talking to
 * {@link ClockManager}. The factor is how much each keypress changes it.
 *
 * `LOD` governs how finely orbit paths are tessellated, aiming for a segment every few pixels
 * and only rebuilding when the required count has moved by a quarter, so a slow zoom does not
 * rebuild the geometry every frame. The jitter budget bounds how much a path may visibly wobble
 * from floating-point error before it is recentred.
 *
 * The sphere-of-influence ratio is deliberately below 1: a body must come meaningfully back
 * inside its parent's influence to be recaptured, rather than flipping between parents each time
 * it grazes the boundary.
 *
 * @type {Object<string, *>}
 */
export const ORBIT = {
  AU_SCALE_METERS: 215.5,
  KEPLER_EQUATION_ITERATIONS: 8,
  KEPLER_EQUATION_TOLERANCE: 1e-10,
  MIN_SPEED_MULTIPLIER: 1.0,
  MAX_SPEED_MULTIPLIER: 6553600.0,
  SPEED_FACTOR: 2.0,
  LOD: {
    INITIAL_SEGMENTS: 128,
    MIN_SEGMENTS: 64,
    MAX_SEGMENTS: 2048,
    TARGET_SEGMENT_PIXELS: 4,
    UPDATE_FREQUENCY: 0.05,
    REBUILD_RATIO: 0.25
  },
  PRECISION: {
    JITTER_PIXEL_BUDGET: 0.15
  },
  SPHERE_OF_INFLUENCE: {
    RECAPTURE_RATIO: 0.8
  },
  OPEN_PATH_RADIUS_RATIO: 6,

  COMPANION_LOOP_MASS_SHARE: 0.99
};

/**
 * The barycentre marker and its traced path.
 *
 * Off by default — it is a diagnostic, not part of the picture. When shown, the path covers sixty
 * years, long enough for the Sun's wander under Jupiter to be a recognisable loop rather than an
 * arc.
 *
 * The segment and rebuild settings mirror {@link ORBIT}'s `LOD`. The minimum pixel radius keeps
 * a barycentre very close to the primary's centre from collapsing into a single point, which is
 * exactly the case one wants to see.
 *
 * @type {Object<string, *>}
 */
export const BARYCENTRE = {
  SHOW: false,

  PATH_YEARS: 60,

  MIN_SEGMENTS: 128,
  MAX_SEGMENTS: 2048,
  TARGET_SEGMENT_PIXELS: 4,
  REBUILD_RATIO: 0.25,

  RECENTRE_FRACTION: 0.1,
  MIN_PIXEL_RADIUS: 1.5
};

/**
 * The screen-space dots that stand in for distant bodies.
 *
 * They are sized in screen space rather than world space because their whole purpose is to be
 * visible when the body itself is sub-pixel; a marker that shrank with distance would disappear
 * exactly when it was needed.
 *
 * The multiplier bounds and increment are what the `+` and `-` keys move between.
 *
 * @type {Object<string, number>}
 */
export const MARKER = {
  DEFAULT_SCREEN_SIZE: 0.2,
  DEFAULT_SCALE: 0.02,
  MIN_SIZE_MULTIPLIER: 0.1,
  MAX_SIZE_MULTIPLIER: 3.0,
  SIZE_INCREMENT: 0.1,
  FULL_OPACITY: 1.0,
  ZERO_OPACITY: 0.0,
  CENTERING_DIVISOR: 2,
  POSITION_OFFSET_MULTIPLIER: 0.1,
  DEFAULT_SIZE_MULTIPLIER: 1.0
};

/**
 * Camera flight timing.
 *
 * Two seconds, which is slow enough that the viewer can follow where they are being taken —
 * across distances this large a quick cut leaves no sense of the journey.
 *
 * @type {{DEFAULT_TRANSITION_DURATION: number}}
 */
export const ANIMATION = {
  DEFAULT_TRANSITION_DURATION: 2000
};

/**
 * The bloom pass and the rules for backing it off.
 *
 * A threshold of 1 means only genuinely over-bright pixels bloom, which in practice is the stars
 * and their effects — everything lit by reflected light stays clean.
 *
 * The distance settings exist because bloom is measured in screen space: standing close to a
 * star, its disc fills the frame and the bloom washes the whole image out. So it is faded down as
 * the camera approaches and switched off entirely very close in. The fade start being larger than
 * the fade end is not a mistake — these are distances, and the effect fades as they decrease.
 *
 * `RESOLUTION_MULTIPLIER` is the fraction of the drawing buffer the blur pyramid is built at, and a
 * half rather than the whole of it. What the pass produces is a wide, smooth glow, and it is added
 * to the frame rather than being the frame: there is nothing in it at the resolution being given up,
 * so building it at full size costs four times the fragments to arrive at very nearly the same
 * image. See {@link BloomManager#getBloomResolution}.
 *
 * @type {Object<string, number>}
 */
export const BLOOM = {
  RESOLUTION_MULTIPLIER: 0.5,

  STRENGTH: .5,
  RADIUS: 0.8,
  THRESHOLD: 1,

  DISABLE_DISTANCE: 0.25,
  FADE_START_DISTANCE: 1.0,
  FADE_END_DISTANCE: 0.2,
  MAX_BLOOM_DISTANCE: 2000
};

/**
 * When a star's surface is drawn and when only its glare is.
 *
 * From far away a star is smaller than a pixel, and drawing a sphere for it produces a flickering
 * speck; the glare billboard reads correctly instead. `KEEP_GLARE_VISIBLE` is what makes the
 * handover work — the glare stays on at all distances, so there is never a gap where the star is
 * not represented by anything.
 *
 * @type {Object<string, number|boolean>}
 */
export const STAR_VISIBILITY = {
  MAX_VISIBILITY_DISTANCE: 5.0,
  MIN_VISIBILITY_DISTANCE: 0.1,
  FADE_TRANSITION_RANGE: 2.0,

  HIDE_MESH_BY_DEFAULT: false,
  KEEP_GLARE_VISIBLE: true
};

/**
 * Curve fitting for turning a star's temperature into a brightness.
 *
 * Module-private, since it exists only to feed {@link temperatureToGlareBrightness}.
 *
 * The Sun is the reference point: its temperature and intensity anchor the curve, so a star at
 * 5778 K comes out looking right by construction and everything else is relative to it.
 *
 * Three exponents rather than one because the relationship is not a single power law over the
 * whole range — real luminosity climbs very steeply with temperature, and a hot star given the
 * cool-star exponent would be far too dim while a single steep exponent would blow the cool ones
 * out. The bounds are the final safety net.
 *
 * @type {Object<string, number>}
 * @private
 */
const STAR_EMISSIVE = {
  BASE_MULTIPLIER: 1.0,

  SOLAR_TEMPERATURE: 5778,
  SOLAR_BASE_INTENSITY: 2.0,

  HOT_STAR_EXPONENT: 2.5,
  WARM_STAR_EXPONENT: 2,
  COOL_STAR_EXPONENT: 1,

  MAX_EMISSIVE_INTENSITY: 12.0,
  MIN_EMISSIVE_INTENSITY: 1.0
};

/**
 * The empirical main-sequence relations, in solar units.
 *
 * Module-private, since they exist only to feed {@link massToStellarRadius} and
 * {@link massToStellarTemperature}.
 *
 * A main-sequence star's radius and surface temperature both follow from its mass, so these are
 * what let a star be described by mass alone. All three relations are anchored on the Sun and
 * return exactly 1 at one solar mass, so the Sun comes out at its measured radius and 5778 K by
 * construction.
 *
 * The radius relation is a power law with a break at the Sun, the two exponents fitted to the
 * zero-age main sequence either side of it; together they hold to within about ten per cent from
 * the red dwarfs to the O stars. The luminosity relation needs four segments because it spans ten
 * orders of magnitude — the coefficients are chosen so the segments meet at the breakpoints
 * rather than stepping, and the top one goes linear where radiation pressure caps the output of
 * the most massive stars.
 *
 * The mass bounds are the hydrogen-burning limit at the bottom and roughly the largest observed
 * star at the top. Outside them a body is not a main-sequence star at all, so rather than
 * extrapolating into nonsense the mass is clamped.
 *
 * @type {{SOLAR_TEMPERATURE: number, RADIUS_EXPONENT_BELOW_SOLAR: number,
 *   RADIUS_EXPONENT_ABOVE_SOLAR: number,
 *   LUMINOSITY_SEGMENTS: Array<{maxMass: number, coefficient: number, exponent: number}>,
 *   MIN_MASS: number, MAX_MASS: number}}
 * @private
 */
const MAIN_SEQUENCE = {
  SOLAR_TEMPERATURE: 5778,

  RADIUS_EXPONENT_BELOW_SOLAR: 0.8,
  RADIUS_EXPONENT_ABOVE_SOLAR: 0.7,

  LUMINOSITY_SEGMENTS: [
    { maxMass: 0.43, coefficient: 0.23, exponent: 2.3 },
    { maxMass: 2, coefficient: 1.0, exponent: 4.0 },
    { maxMass: 55, coefficient: 1.4, exponent: 3.5 },
    { maxMass: Infinity, coefficient: 32000, exponent: 1.0 }
  ],

  MIN_MASS: 0.08,
  MAX_MASS: 150
};

/**
 * Inline styles for the debug overlays.
 *
 * Style objects rather than CSS classes so the overlays can be built and styled entirely from
 * JavaScript, with no stylesheet to keep in step. Green monospace on translucent black, which is
 * legible over anything the scene puts behind it.
 *
 * Pointer events are off on both, so an overlay cannot swallow a camera drag that passes over it,
 * and text selection is off so a drag does not highlight the text instead.
 *
 * @type {{CONTROLS_OVERLAY_STYLE: Object<string, string|number>,
 *   STATS_OVERLAY_STYLE: Object<string, string|number>}}
 */
export const UI = {
  CONTROLS_OVERLAY_STYLE: {
    position: 'fixed',
    bottom: '10px',
    left: '10px',
    background: 'rgba(0, 0, 0, 0.8)',
    color: '#00ff00',
    fontFamily: '"Courier New", monospace',
    fontSize: '12px',
    padding: '10px',
    borderRadius: '5px',
    zIndex: 10000,
    minWidth: '200px',
    pointerEvents: 'none',
    userSelect: 'none'
  },
  STATS_OVERLAY_STYLE: {
    position: 'fixed',
    top: '10px',
    left: '10px',
    background: 'rgba(0, 0, 0, 0.85)',
    color: '#00ff00',
    fontFamily: '"Courier New", monospace',
    fontSize: '11px',
    padding: '8px',
    borderRadius: '5px',
    zIndex: 10000,
    minWidth: '220px',
    maxWidth: '250px',
    pointerEvents: 'none',
    userSelect: 'none'
  }
};

/**
 * Sphere tessellation tiers for the level-of-detail system.
 *
 * A fixed set of tiers rather than a segment count computed per frame, because the geometry for
 * each tier is built once and cached; an arbitrary count would mean rebuilding buffers whenever
 * the camera moved. Doubling each step keeps the set small while covering everything from a
 * distant speck to a moon filling the frame.
 *
 * The error budget is the sagitta tolerance {@link segmentsForScreenRadius} solves against —
 * half a pixel of deviation from a true circle, which is below what the eye picks up as
 * faceting. The hysteresis is what stops a body hovering on a tier boundary from switching
 * geometry every frame.
 *
 * @type {{SPHERE_DETAIL_TIERS: number[], SPHERE_DETAIL_MAX_ERROR_PIXELS: number,
 *   SPHERE_DETAIL_INITIAL_SEGMENTS: number, SPHERE_DETAIL_HYSTERESIS: number}}
 */
export const GEOMETRY = {
  SPHERE_DETAIL_TIERS: [8, 16, 32, 64, 128],

  SPHERE_DETAIL_MAX_ERROR_PIXELS: 0.5,

  SPHERE_DETAIL_INITIAL_SEGMENTS: 32,

  SPHERE_DETAIL_HYSTERESIS: 0.4
};

/**
 * Indices into the targetable-bodies list.
 *
 * The root body is first, which is why focusing it and starting up both use index 0. The
 * not-found value is `Array.prototype.findIndex`'s sentinel, named so the comparison in
 * {@link InputController#handlePlanetSelection} reads as intent rather than as a bare `-1`.
 *
 * @type {{SUN_INDEX: number, NOT_FOUND_INDEX: number, INITIAL_TARGET_INDEX: number}}
 */
export const TARGETING = {
  SUN_INDEX: 0,
  NOT_FOUND_INDEX: -1,
  INITIAL_TARGET_INDEX: 0
};

/**
 * The star field behind everything.
 *
 * Dimmed heavily by default: at full brightness the background competes with the bodies, which
 * are the subject. The cube face size is the resolution each of the six faces is rendered to when
 * the equirectangular source image is converted.
 *
 * @type {Object<string, number>}
 */
export const SKYBOX = {
  DEFAULT_BRIGHTNESS: 0.16,
  MIN_BRIGHTNESS: 0.0,
  MAX_BRIGHTNESS: 1.0,
  CUBE_FACE_SIZE: 1536
};

/**
 * Precomputed constants used in the hot paths.
 *
 * Named so the conversions read clearly and so nothing has to recompute them per body per frame.
 *
 * @type {{PI_OVER_180: number, TWO_PI: number, TWO: number}}
 */
export const MATH = {
  PI_OVER_180: Math.PI / 180,
  TWO_PI: 2 * Math.PI,
  TWO: 2
};

/**
 * The system itself: every body, nested by what it orbits.
 *
 * This is the input {@link SolarSystemFactory} builds the scene from, and it is the only place a
 * body is described. Nesting rather than a flat list with parent references, because the nesting
 * *is* the orbital hierarchy — a moon's elements are relative to its planet, and the tree makes
 * that structural instead of something a reader has to reconstruct. `parent` is still carried on
 * each entry, for the places that need to look upwards.
 *
 * Orbits are given as classical elements — semi-major axis `a` in AU, eccentricity `e`,
 * inclination `i`, longitude of ascending node `omega`, argument of periapsis `w` and mean
 * anomaly at epoch `M0`, the angles in degrees. In Kepler mode these are evaluated directly; in
 * n-body mode they are converted once into a starting position and velocity and then not
 * consulted again.
 *
 * Radii are given as `radiusScale`, relative to the Sun for planets but relative to the *parent*
 * for moons — which is why the Moon's 0.274 and Charon's 0.511 look so large next to Mercury's
 * 0.0035. "Relative to the Sun" means one solar radius, not the star's own radius, so a heavier
 * star grows without dragging the planets with it — see {@link BodyPhysics.calculateBodyRadius}.
 * Masses are in solar masses throughout. A negative `rotationPeriod` means retrograde
 * rotation, as for Venus and Uranus.
 *
 * On a star both `radiusScale` and the `star` block's `temperature` may be left out, in which
 * case they are derived from the mass by the main-sequence relations — see
 * {@link massToStellarRadius} and {@link massToStellarTemperature}. Stating either one skips
 * deriving that one, which is how a star off the main sequence is described. The Sun states both,
 * at the values the relations would produce anyway.
 *
 * The temperature also colours the photosphere, which is why the Sun pins `shader.surfaceColor`:
 * 5778 K maps to a near-white cream in {@link temperatureToColor}, and the familiar orange is
 * worth keeping. Remove it and the Sun takes the colour of whatever temperature it ends up with.
 *
 * Everything past those is optional and additive: `surfaceTexture`, `atmosphere`, `clouds`,
 * `rings`, on a star a `star` block carrying the temperature and the settings for each of its
 * effects, and on a black hole a `blackHole` block doing the same for its disc, photon ring and
 * lensing — a body carrying either block gets a different material and a different set of effects
 * entirely. `tidallyLocked` turns on the locking model, with `tidalLockTarget` where the body
 * locks to something other than its parent — Pluto to Charon, since they lock to each other.
 * `equatorialOrbit` states that the orbit follows the parent's equator rather than the reference
 * plane, which is how the major moon systems actually sit. `lightIntensity` is `null` on every
 * non-star, since only stars emit.
 *
 * Elements are J2000 values from JPL where they exist. Sizes and distances are not to a common
 * scale, and are not meant to be — see {@link ORBIT}'s `AU_SCALE_METERS`.
 *
 * @type {Array<Object>}
 */
export const CELESTIAL_DATA = [{
  name: 'Sun',
  markerColor: 0xFFD700,
  //radiusScale: 1,
  mass: 1,
  rotationPeriod: 609.12,
  axialTilt: 7.25,
  star: {
    shader: {
      glowIntensity: 1,
      noiseScale: 10.0,
      brightness: 1,
      sunspotIntensity: 2.0
    },
    corona: {
      size: 1.1,
      coronaIntensity: 4,
      noiseScale: 3.0,
      animationSpeed: .1,
      fresnelPower: 1.75
    },
    rays: {
      rayCount: 2048,
      rayLength: .005,
      rayWidth: 0.0002,
      rayOpacity: 0.8,
      hueSpread: .001,
      lowres: false,
      whispyAmount: .1,
      bendAmount: 0.2
    },
    flares: {
      lineCount: 256,
      lineLength: 64,
      lowres: false,
      animationSpeed: 0.1,
      opacity: 0.4,
      flowSpeed: 3.0,
      flowTravel: 1.5,
      noiseFrequency: 3.0,
      noiseAmplitude: 0.3,
      swayAmplitude: 0.25
    },
    glare: {
      screenFraction: 0.05,
      opacity: 1,
      color: 0xffaa00,
      glowIntensity: 1.35,
      haloRadius: 0.5,
      haloFalloff: 3.0,
      haloStrength: 0.55
    }
  },
  parent: null,
  children: [
    {
      name: 'Mercury',
      color: 0x8B7B6F,
      markerColor: 0x8B7B6F,
      radiusScale: 0.00350366313,
      mass: 1.66013e-7,
      rotationPeriod: 1407.6,
      axialTilt: 0.034,
      lightIntensity: null,
      surfaceTexture: TEXTURES.mercury,
      parent: 'Sun',
      a: 0.387098, e: 0.205630, i: 7.005, omega: 48.331, w: 29.124, M0: 174.796,
      children: []
    },
    {
      name: 'Venus',
      color: 0xC9AEBE,
      markerColor: 0xFFC649,
      radiusScale: 0.00869074857,
      mass: 2.44783e-6,
      rotationPeriod: -5832.5,
      axialTilt: 177.4,
      lightIntensity: null,
      surfaceTexture: TEXTURES.venus,
      atmosphere: {
        color: 0xFFE4B5,
        radiusScale: 1.042,
        verticalOpticalDepth: 0.5
      },
      parent: 'Sun',
      a: 0.723332, e: 0.006772, i: 3.395, omega: 76.680, w: 54.884, M0: 50.115,
      children: []
    },
    {
      name: 'Earth',
      color: 0x007FFF,
      markerColor: 0x4A90E2,
      radiusScale: 0.00915921329,
      mass: 3.00348e-6,
      rotationPeriod: 23.93,
      axialTilt: 23.44,
      lightIntensity: null,
      surfaceTexture: TEXTURES.earth,
      clouds: {
        texture: TEXTURES.earthClouds,
        radiusScale: 1.01,
        opacity: 0.8,
        rotationSpeed: 2
      },
      atmosphere: {
        color: 0x87CEEB,
        radiusScale: 1.03,
        verticalOpticalDepth: 0.3
      },
      parent: 'Sun',
      a: 1.000001, e: 0.016709, i: 0.000, omega: 0.000, w: 114.208, M0: 357.529,
      children: [
        {
          name: 'Moon',
          color: 0xC0C0C0,
          markerColor: 0xD3D3D3,
          radiusScale: .274,
          mass: 3.69396e-8,
          rotationPeriod: 655.7,
          axialTilt: 1.54,
          rotationOffset: -Math.PI / 2,
          tidallyLocked: true,
          lightIntensity: null,
          surfaceTexture: TEXTURES.moon,
          parent: 'Earth',
          a: 0.00257,
          e: 0.0549,
          i: 5.1,
          omega: 125.0,
          w: 318.0,
          M0: 135.0,
          children: []
        }
      ]
    },
    {
      name: 'Mars',
      color: 0xFF8C00,
      markerColor: 0xCD853F,
      radiusScale: 0.00486745707,
      mass: 3.22715e-7,
      rotationPeriod: 24.62,
      axialTilt: 25.19,
      lightIntensity: null,
      surfaceTexture: TEXTURES.mars,
      atmosphere: {
        color: 0xD2691E,
        radiusScale: 1.047,
        verticalOpticalDepth: 0.45,
        mieStrength: 0.25
      },
      parent: 'Sun',
      a: 1.523679, e: 0.093401, i: 1.850, omega: 49.558, w: 286.502, M0: 19.373,
      children: [
      ]
    },
    {
      name: 'Jupiter',
      color: 0xD2691E,
      markerColor: 0xD2691E,
      radiusScale: 0.10039681989,
      mass: 9.54265e-4,
      rotationPeriod: 9.93,
      axialTilt: 3.13,
      lightIntensity: null,
      surfaceTexture: TEXTURES.jupiter,
      atmosphere: {
        color: 0xDAA520,
        radiusScale: 1.016,
        verticalOpticalDepth: 0.4
      },
      parent: 'Sun',
      a: 5.204267, e: 0.048498, i: 1.303, omega: 100.464, w: 273.867, M0: 20.020,
      children: [
        {
          name: 'Io',
          color: 0xFFFF99,
          markerColor: 0xFFFF99,
          radiusScale: 0.026,
          mass: 4.704e-9,
          rotationPeriod: 42.46,
          axialTilt: 0.05,
          tidallyLocked: true,
          equatorialOrbit: true,
          lightIntensity: null,
          parent: 'Jupiter',
          a: 0.002819,
          e: 0.0041,
          i: 0.05,
          omega: 43.977, w: 84.129, M0: 0.0,
          surfaceTexture: TEXTURES.io,
          children: []
        },
        {
          name: 'Europa',
          color: 0xB0C4DE,
          markerColor: 0xB0C4DE,
          radiusScale: 0.022,
          mass: 2.528e-9,
          rotationPeriod: 85.23,
          axialTilt: 0.1,
          tidallyLocked: true,
          equatorialOrbit: true,
          lightIntensity: null,
          surfaceTexture: TEXTURES.europa,
          parent: 'Jupiter',
          a: 0.004486,
          e: 0.009,
          i: 0.47,
          omega: 219.106, w: 88.970, M0: 90.0,
          children: []
        },
        {
          name: 'Ganymede',
          color: 0x8B7355,
          markerColor: 0x8B7355,
          radiusScale: 0.038,
          mass: 7.805e-9,
          rotationPeriod: 171.71,
          axialTilt: 0.33,
          tidallyLocked: true,
          equatorialOrbit: true,
          lightIntensity: null,
          surfaceTexture: TEXTURES.ganymede,
          parent: 'Jupiter',
          a: 0.007155,
          e: 0.0013,
          i: 0.20,
          omega: 63.552, w: 192.417, M0: 180.0,
          children: []
        },
        {
          name: 'Callisto',
          color: 0x696969,
          markerColor: 0x696969,
          radiusScale: 0.034,
          mass: 5.670e-9,
          rotationPeriod: 400.54,
          axialTilt: 0.51,
          tidallyLocked: true,
          equatorialOrbit: true,
          lightIntensity: null,
          surfaceTexture: TEXTURES.callisto,
          parent: 'Jupiter',
          a: 0.01258,
          e: 0.0074,
          i: 0.51,
          omega: 298.848, w: 52.643, M0: 270.0,
          children: []
        }
      ]
    },
    {
      name: 'Saturn',
      color: 0xFFD700,
      markerColor: 0xFFD700,
      radiusScale: 0.08362569044,
      mass: 2.85885e-4,
      rotationPeriod: 10.66,
      axialTilt: 26.73,
      lightIntensity: null,
      surfaceTexture: TEXTURES.saturn,
      atmosphere: {
        color: 0xF0E68C,
        radiusScale: 1.026,
        verticalOpticalDepth: 0.5
      },
      parent: 'Sun',
      a: 9.582017, e: 0.055723, i: 2.485, omega: 113.665, w: 339.392, M0: 317.020,
      rings: {
        innerRadius: 1.11,
        outerRadius: 2.35,
        opacity: 0.8,
        texture: TEXTURES.saturnRing
      },
      children: [
        {
          name: 'Mimas',
          color: 0xC0C0C0,
          markerColor: 0xC0C0C0,
          radiusScale: 0.0034,
          mass: 1.972e-12,
          rotationPeriod: 22.62,
          axialTilt: 0.02,
          tidallyLocked: true,
          equatorialOrbit: true,
          lightIntensity: null,
          surfaceTexture: TEXTURES.mimas,
          parent: 'Saturn',
          a: 0.001241,
          e: 0.0196,
          i: 0.02,
          omega: 139.1, w: 342.2, M0: 0.0,
          children: []
        },
        {
          name: 'Enceladus',
          color: 0xF0F8FF,
          markerColor: 0xF0F8FF,
          radiusScale: 0.0043,
          mass: 5.655e-12,
          rotationPeriod: 32.88,
          axialTilt: 0.0,
          tidallyLocked: true,
          equatorialOrbit: true,
          lightIntensity: null,
          surfaceTexture: TEXTURES.enceladus,
          parent: 'Saturn',
          a: 0.001593,
          e: 0.0047,
          i: 0.02,
          omega: 6.2, w: 211.9, M0: 90.0,
          children: []
        },
        {
          name: 'Tethys',
          color: 0xE6E6FA,
          markerColor: 0xE6E6FA,
          radiusScale: 0.0091,
          mass: 3.09e-11,
          rotationPeriod: 45.31,
          axialTilt: 0.02,
          tidallyLocked: true,
          equatorialOrbit: true,
          lightIntensity: null,
          surfaceTexture: TEXTURES.tethys,
          parent: 'Saturn',
          a: 0.001975,
          e: 0.0001,
          i: 0.02,
          omega: 158.3, w: 262.2, M0: 180.0,
          children: []
        },
        {
          name: 'Dione',
          color: 0xD3D3D3,
          markerColor: 0xD3D3D3,
          radiusScale: 0.0096,
          mass: 5.48e-11,
          rotationPeriod: 65.69,
          axialTilt: 0.02,
          tidallyLocked: true,
          equatorialOrbit: true,
          lightIntensity: null,
          surfaceTexture: TEXTURES.dione,
          parent: 'Saturn',
          a: 0.002523,
          e: 0.0022,
          i: 0.02,
          omega: 168.8, w: 91.1, M0: 270.0,
          children: []
        },
        {
          name: 'Titan',
          color: 0xCD853F,
          markerColor: 0xCD853F,
          radiusScale: 0.044,
          mass: 6.741e-9,
          rotationPeriod: 382.69,
          axialTilt: 0.02,
          tidallyLocked: true,
          equatorialOrbit: true,
          lightIntensity: null,
          surfaceTexture: TEXTURES.titan,
          atmosphere: {
            color: 0xDEB887,
            radiusScale: 1.104,
            verticalOpticalDepth: 4,
            scaleHeight: 0.35,
            mieStrength: 0.3
          },
          parent: 'Saturn',
          a: 0.008168,
          e: 0.0288,
          i: 0.02,
          omega: 28.1, w: 180.5, M0: 0.0,
          children: []
        },
        {
          name: 'Iapetus',
          color: 0x8B4513,
          markerColor: 0x8B4513,
          radiusScale: 0.0126,
          mass: 9.09e-11,
          rotationPeriod: 1903.8,
          axialTilt: 8.13,
          tidallyLocked: true,
          lightIntensity: null,
          surfaceTexture: TEXTURES.iapetus,
          parent: 'Saturn',
          a: 0.0238,
          e: 0.0286,
          i: 8.13,
          omega: 75.8, w: 271.6, M0: 90.0,
          children: []
        }
      ]
    },
    {
      name: 'Uranus',
      color: 0xADD8E6,
      markerColor: 0x4FD0E4,
      radiusScale: 0.03642099424,
      mass: 4.36625e-5,
      rotationPeriod: -17.24,
      axialTilt: 97.77,
      lightIntensity: null,
      surfaceTexture: TEXTURES.uranus,
      atmosphere: {
        color: 0x40E0D0,
        radiusScale: 1.027,
        verticalOpticalDepth: 2
      },
      parent: 'Sun',
      a: 19.18917, e: 0.047168, i: 0.773, omega: 74.006, w: 96.998, M0: 142.238,
      children: [
      ]
    },
    {
      name: 'Neptune',
      color: 0x1E90FF,
      markerColor: 0x1E90FF,
      radiusScale: 0.03535880191,
      mass: 5.15138e-5,
      rotationPeriod: 16.11,
      axialTilt: 28.32,
      lightIntensity: null,
      surfaceTexture: TEXTURES.neptune,
      atmosphere: {
        color: 0x4169E1,
        radiusScale: 1.023,
        verticalOpticalDepth: 2
      },
      parent: 'Sun',
      a: 30.06896, e: 0.008606, i: 1.770, omega: 131.784, w: 276.336, M0: 256.228,
      children: [
      ]
    },
    {
      name: 'Pluto',
      color: 0xBEBEBE,
      markerColor: 0xBEBEBE,
      radiusScale: 0.00170648732,
      mass: 6.58719e-9,
      rotationPeriod: -153.29,
      axialTilt: 122.53,
      tidallyLocked: true,
      tidalLockTarget: 'Charon',
      lightIntensity: null,
      surfaceTexture: TEXTURES.pluto,
      atmosphere: {
        color: 0xE6E6FA,
        radiusScale: 1.169,
        verticalOpticalDepth: 0.05,
        scaleHeight: 0.4
      },
      parent: 'Sun',
      a: 39.48211, e: 0.248808, i: 17.140, omega: 110.299, w: 113.834, M0: 0.0,
      children: [
        {
          name: 'Charon',
          color: 0x808080,
          markerColor: 0x808080,
          radiusScale: 0.511,
          mass: 8.08e-10,
          rotationPeriod: 153.29,
          axialTilt: 0.08,
          tidallyLocked: true,
          equatorialOrbit: true,
          lightIntensity: null,
          surfaceTexture: TEXTURES.charon,
          parent: 'Pluto',
          a: 0.000131,
          e: 0.0002,
          i: 0.08,
          omega: 223.0, w: 102.0, M0: 180.0,
          children: []
        }
      ]
    },
    /*
     * A primordial black hole on a wide, tilted orbit past Pluto.
     *
     * Not a real object, and the only body here that is invented outright. Its mass is
     * chosen rather than measured: five Earth masses, which is the range the primordial
     * black hole proposed for "Planet Nine" would sit in, and light enough — a sixtieth of
     * Jupiter — that dropping it into the system perturbs nothing. A stellar-mass hole
     * would be a hundred thousand times heavier than everything else here combined and
     * would tear the system apart within a few frames of n-body integration.
     *
     * Which makes it far too small to draw. Five Earth masses gives a Schwarzschild radius
     * of about four centimetres, so `radiusScale` exaggerates it by a factor of a hundred
     * million to put it in the size range of the planets. Everything inside the `blackHole`
     * block is stated as a multiple of that drawn radius, in the same way a ring system is,
     * and each multiple is a real one where it can be: the accretion disc's inner edge is the
     * innermost stable circular orbit at three Schwarzschild radii, and its inner and outer
     * colours are a real temperature gradient. So the *proportions* are right even though the
     * overall size is not — which is the same bargain every other body here makes.
     *
     * The outer edge is the one number here with no physics behind it. A real disc has no outer edge
     * to speak of — it thins out to whatever is feeding it, hundreds of radii or more — so what this
     * is is where drawing it stops being worth the rays, and 12 is chosen for the picture rather than
     * derived. Brightness does the arguing: emission falls as `(r_in / r)^emissionFalloff`, so the
     * rim is already down to a tenth of the inner edge and the gas there is a dim skirt whatever
     * radius it is cut at. What the number does cost is fill: the tracer can only skip a ray once its
     * impact parameter puts the turning point outside the gas, at `√(R³ / (R - 1))`, which is 7.6
     * radii at an outer edge of 7 and 12.5 at 12 — nearly three times the screen area taking the full
     * march. Lower it first if the hole is slow.
     *
     * Neither the gas pattern nor the colours are tied to this, which is what makes it safe to move:
     * see {@link GAS_RADIAL_SCALE} and {@link COLOR_OUTER_RATIO} for why they are anchored to the
     * inner edge instead, and what widening the disc used to do before they were.
     *
     * What widening *does* change is how solid the gas reads, which is why `opacity` is above 1. It
     * is not a fraction but a multiplier on optical depth, and the depth a ray accumulates is what
     * decides both how much of the sky behind the disc survives and how bright the gas comes out —
     * the march takes `1 - exp(-depth)` for both. Anchoring the noise to an absolute scale puts more
     * radial structure across a wider disc, so the arms break into more filaments and more sky comes
     * through between them; doubling the depth is what holds them together. Past about 3 the gas
     * saturates into a flat sheet and the filaments stop reading at all, so this is the range.
     *
     * The photon ring sits at 2.62 radii because that is just outside the shadow's true edge at
     * `3√3 / 2` — the hole bends the light of its own silhouette outwards, so the dark disc seen
     * is over two and a half times the horizon rather than the size of it. {@link AccretionDisk}
     * traces photon paths and puts the shadow's edge there on its own, without being told to; the
     * ring is drawn on the boundary it arrives at.
     *
     * The `lensing` block bends nothing for *this* hole, and is kept for a hole configured without
     * a disc. Where a disc is traced the tracer is given the sky as well, so the lensing comes from
     * the photon paths themselves and the Einstein radius lands where physics puts it at every
     * distance — which is the one thing a screen-space warp cannot do, since that radius scales as
     * `√(2 r / r_s)`: five and a half horizon radii at a hundred out, fifty-five at ten thousand. No
     * constant multiple of the hole's size is right at more than one distance, and the 1.2 here is
     * such a constant; it is also, at anything past a few tens of radii, inside the shadow. See
     * {@link AccretionDisk} for the traced lensing and {@link BlackHoleLensPass} for what these
     * numbers mean where they do apply.
     *
     * The axial tilt decides how the disc can be seen. It is the *most* the disc can be tipped
     * out of the ecliptic, not how it is tipped now — which way it faces depends on where the
     * camera has come round to. At 78° nearly the whole range is available: from edge-on, where
     * the disc is a bright line through the hole, to within a few degrees of face-on, where the
     * ring reads as a ring. The relativistic beaming needs somewhere in between, since it is
     * driven by the part of the orbital motion that points at the camera and a face-on disc has
     * none.
     */
    {
      name: 'Black Hole',
      markerColor: 0x9B6BFF,
      radiusScale: 0.006,
      mass: 1.50174e-5,
      rotationPeriod: 0.05,
      axialTilt: 78,
      lightIntensity: null,
      parent: 'Sun',
      a: 42.0, e: 0.12, i: 12.0, omega: 205.0, w: 88.0, M0: 320.0,
      blackHole: {
        disk: {
          innerRadius: 3.0,
          outerRadius: 12.0,
          innerColor: 0xEAF4FF,
          outerColor: 0xFF5A14,
          intensity: 1.4,
          opacity: 5.0,
          emissionFalloff: 1.6,
          noiseScale: 3.5,
          swirlSpeed: 0.6,
          turbulence: 0.55,
          beamingStrength: 0.85
        },
        photonRing: {
          ringRadius: 2.5980762,
          thickness: 0.014,
          brightness: 2.2,
          haloStrength: 0.06,
          haloFalloff: 6.0,
          extent: 7.0,
          color: 0xFFEFD6,
          opacity: 1.0
        },
        lensing: {
          einsteinRadii: 1.2,
          strength: 1.0,
          falloffRadii: 14.0
        }
      },
      children: [
        {
          name: 'Acheron',
          color: 0x6E6A70,
          markerColor: 0xA79FB5,
          radiusScale: 0.2844,
          mass: 6.58719e-9,
          rotationPeriod: 29.72,
          axialTilt: 0.4,
          tidallyLocked: true,
          equatorialOrbit: true,
          lightIntensity: null,
          surfaceTexture: TEXTURES.callisto,
          parent: 'Black Hole',
          a: 0.000557,
          e: 0.04,
          i: 1.5,
          omega: 140.0, w: 60.0, M0: 25.0,
          children: []
        },
        {
          name: 'Bable',
          color: 0x6E6A70,
          markerColor: 0xA79FB5,
          radiusScale: 0.2844,
          mass: 6.58719e-9,
          rotationPeriod: 71.52,
          axialTilt: 0.4,
          tidallyLocked: true,
          equatorialOrbit: true,
          lightIntensity: null,
          surfaceTexture: TEXTURES.titan,
          parent: 'Black Hole',
          a: 0.001,
          e: 0.04,
          i: 1.5,
          omega: 140.0, w: 60.0, M0: 25.0,
          children: []
        }
      ]
    }
  ]
}];

/**
 * The radius a main-sequence star of a given mass has.
 *
 * The mass–radius relation from {@link MAIN_SEQUENCE}, which is close to linear on a log–log plot
 * and so is a power law with the exponent switched at one solar mass.
 *
 * Only meaningful for a star still on the main sequence. A giant or a white dwarf has left it and
 * is nowhere near this radius for its mass, so those have to state their size in the data.
 *
 * @param {number} mass - Mass in solar masses; clamped to {@link MAIN_SEQUENCE}'s bounds.
 * @returns {number} Radius in solar radii — 1 for a solar-mass star.
 */
export function massToStellarRadius(mass) {
  const stellarMass = MathUtils.clamp(mass, MAIN_SEQUENCE.MIN_MASS, MAIN_SEQUENCE.MAX_MASS);

  const exponent = stellarMass < 1 ?
    MAIN_SEQUENCE.RADIUS_EXPONENT_BELOW_SOLAR :
    MAIN_SEQUENCE.RADIUS_EXPONENT_ABOVE_SOLAR;

  return Math.pow(stellarMass, exponent);
}

/**
 * The luminosity a main-sequence star of a given mass radiates.
 *
 * The segmented mass–luminosity relation from {@link MAIN_SEQUENCE}. Module-private, since it
 * exists only as the intermediate step in {@link massToStellarTemperature} — nothing renders
 * luminosity directly.
 *
 * @param {number} mass - Mass in solar masses; clamped to {@link MAIN_SEQUENCE}'s bounds.
 * @returns {number} Luminosity in solar luminosities — 1 for a solar-mass star.
 * @private
 */
function massToStellarLuminosity(mass) {
  const stellarMass = MathUtils.clamp(mass, MAIN_SEQUENCE.MIN_MASS, MAIN_SEQUENCE.MAX_MASS);

  const segment = MAIN_SEQUENCE.LUMINOSITY_SEGMENTS.find(candidate => stellarMass < candidate.maxMass);

  return segment.coefficient * Math.pow(stellarMass, segment.exponent);
}

/**
 * The surface temperature a main-sequence star of a given mass has.
 *
 * Not a fitted relation of its own: a star radiates its luminosity from its surface area, so
 * given the mass–luminosity and mass–radius relations the Stefan–Boltzmann law fixes the
 * temperature. In solar units that is the fourth root of the luminosity over the square root of
 * the radius, which is what this computes. Doing it that way rather than fitting mass to
 * temperature directly keeps the three consistent with each other — a star's colour, size and
 * brightness can never disagree.
 *
 * Runs from around 2500 K at the hydrogen-burning limit to around 50000 K at the top, which is
 * the real range and covers very nearly the whole span {@link temperatureToColor} draws.
 *
 * @param {number} mass - Mass in solar masses; clamped to {@link MAIN_SEQUENCE}'s bounds.
 * @returns {number} Effective surface temperature in kelvin — 5778 for a solar-mass star.
 */
export function massToStellarTemperature(mass) {
  const luminosity = massToStellarLuminosity(mass);
  const radius = massToStellarRadius(mass);

  return MAIN_SEQUENCE.SOLAR_TEMPERATURE * Math.pow(luminosity, 0.25) / Math.sqrt(radius);
}

/**
 * The luminosity of a star of a given size and surface temperature.
 *
 * The Stefan–Boltzmann law in solar units: a star radiates over its surface area, which goes as
 * the square of the radius, at a rate per unit area that goes as the fourth power of the
 * temperature. Taken from the radius and temperature rather than from the mass, so it holds for a
 * giant or a white dwarf that has stated its own size and colour and is nowhere near the
 * main-sequence relations.
 *
 * This is what the glare needs to work out how much light is actually arriving from a star, since
 * that is the luminosity over the square of the distance.
 *
 * @param {number} radiusScale - Radius in solar radii.
 * @param {number} temperature - Effective surface temperature in kelvin.
 * @returns {number} Luminosity in solar luminosities — 1 for a star of solar size at 5778 K.
 */
export function radiusAndTemperatureToLuminosity(radiusScale, temperature) {
  const temperatureRatio = temperature / MAIN_SEQUENCE.SOLAR_TEMPERATURE;

  return radiusScale * radiusScale * Math.pow(temperatureRatio, 4);
}

/**
 * The colour of light a star at a given temperature emits.
 *
 * Tanner Helland's blackbody approximation, which fits the Planck curve with a handful of power
 * and log terms rather than integrating it — accurate enough to be indistinguishable by eye and
 * cheap enough to call freely.
 *
 * The 6600 K breakpoints are where the fit changes form. Below it red is saturated and blue is
 * still climbing; above it blue is saturated and red is falling. Below about 1900 K there is no
 * blue at all, so that branch returns zero rather than taking the logarithm of a negative number.
 *
 * Used for the light a star casts, not for how the star itself looks —
 * {@link temperatureToColor} does that.
 *
 * @param {number} temperature - Surface temperature in kelvin; clamped to 1000–50000.
 * @returns {number} Packed 24-bit RGB, as Three.js colours are given.
 */
export function temperatureToBlackbodyLight(temperature) {
  const temp = MathUtils.clamp(temperature, 1000, 50000);

  let r, g, b;

  if (temp >= 6600) {
    r = temp / 100;
    r = 329.698727446 * Math.pow(r - 60, -0.1332047592);
  } else {
    r = 255;
  }

  if (temp >= 6600) {
    g = temp / 100;
    g = 288.1221695283 * Math.pow(g - 60, -0.0755148492);
  } else {
    g = temp / 100;
    g = 99.4708025861 * Math.log(g) - 161.1195681661;
  }

  if (temp >= 6600) {
    b = 255;
  } else if (temp <= 1900) {
    b = 0;
  } else {
    b = temp / 100;
    b = 138.5177312231 * Math.log(b - 10) - 305.0447927307;
  }

  r = MathUtils.clamp(Math.round(r), 0, 255);
  g = MathUtils.clamp(Math.round(g), 0, 255);
  b = MathUtils.clamp(Math.round(b), 0, 255);

  return (r << 16) | (g << 8) | b;
}

/**
 * How brightly a star at a given temperature should glare.
 *
 * Physically the emitted power goes as the fourth power of temperature, which over the range of
 * real stars spans several orders of magnitude — far more than a display can show. So this is a
 * deliberately compressed version of that: a power law relative to the Sun, with the exponent
 * chosen by temperature band, and then two logarithmic knees above 15 and 50 that flatten the top
 * end. A hot star ends up clearly brighter than a cool one without the cool one being reduced to
 * nothing.
 *
 * The result is finally clamped, so no data value can produce a glare that swamps the frame or
 * one that vanishes.
 *
 * @param {number} temperature - Surface temperature in kelvin; clamped to 1000–50000.
 * @returns {number} Emissive intensity, within {@link STAR_EMISSIVE}'s bounds.
 */
export function temperatureToGlareBrightness(temperature) {
  const SOLAR_TEMPERATURE = STAR_EMISSIVE.SOLAR_TEMPERATURE;
  const SOLAR_GLARE_BASE = STAR_EMISSIVE.SOLAR_BASE_INTENSITY;

  const temp = MathUtils.clamp(temperature, 1000, 50000);

  const temperatureRatio = temp / SOLAR_TEMPERATURE;
  let brightnessRatio;

  if (temp > 15000) {
    brightnessRatio = Math.pow(temperatureRatio, STAR_EMISSIVE.HOT_STAR_EXPONENT);
  } else if (temp > 10000) {
    brightnessRatio = Math.pow(temperatureRatio, STAR_EMISSIVE.WARM_STAR_EXPONENT);
  } else {
    brightnessRatio = Math.pow(temperatureRatio, STAR_EMISSIVE.COOL_STAR_EXPONENT);
  }

  const rawIntensity = SOLAR_GLARE_BASE * brightnessRatio;

  let scaledIntensity;
  if (rawIntensity > 50) {
    scaledIntensity = 50 + Math.log10(rawIntensity / 50) * 8;
  } else if (rawIntensity > 15) {
    scaledIntensity = 15 + Math.log10(rawIntensity / 15) * 6;
  } else {
    scaledIntensity = rawIntensity;
  }

  const finalIntensity = scaledIntensity * STAR_EMISSIVE.BASE_MULTIPLIER;
  return MathUtils.clamp(finalIntensity, STAR_EMISSIVE.MIN_EMISSIVE_INTENSITY, STAR_EMISSIVE.MAX_EMISSIVE_INTENSITY);
}

/**
 * The colour to draw a star's own surface.
 *
 * A hand-picked gradient rather than the blackbody fit, and intentionally not physical: real
 * stars run from orange through white to faint blue-white, a range too narrow to tell apart on
 * screen. These points exaggerate it into something readable — deep red at the cool end through
 * yellow and white to a strong blue at the hot end — so a star's temperature can be seen at a
 * glance.
 *
 * Interpolated linearly between the bracketing points. The loop falls back to the first and last
 * points, which covers the clamped endpoints where no bracket is found.
 *
 * @param {number} temperature - Surface temperature in kelvin; clamped to 2000–50000.
 * @returns {number} Packed 24-bit RGB.
 */
export function temperatureToColor(temperature) {
  const temp = MathUtils.clamp(temperature, 2000, 50000);

  const tempPoints = [
    { temp: 2000, r: 153, g: 27, b: 27 },
    { temp: 3000, r: 220, g: 38, b: 38 },
    { temp: 4000, r: 249, g: 115, b: 22 },
    { temp: 5000, r: 253, g: 224, b: 71 },
    { temp: 6000, r: 254, g: 243, b: 199 },
    { temp: 7500, r: 248, g: 250, b: 252 },
    { temp: 10000, r: 14, g: 165, b: 233 },
    { temp: 30000, r: 30, g: 58, b: 138 },
    { temp: 50000, r: 21, g: 36, b: 117 }
  ];

  let lowerPoint = tempPoints[0];
  let upperPoint = tempPoints[tempPoints.length - 1];

  for (let i = 0; i < tempPoints.length - 1; i++) {
    if (temp >= tempPoints[i].temp && temp <= tempPoints[i + 1].temp) {
      lowerPoint = tempPoints[i];
      upperPoint = tempPoints[i + 1];
      break;
    }
  }

  const factor = (temp - lowerPoint.temp) / (upperPoint.temp - lowerPoint.temp);

  const r = Math.round(lowerPoint.r + (upperPoint.r - lowerPoint.r) * factor);
  const g = Math.round(lowerPoint.g + (upperPoint.g - lowerPoint.g) * factor);
  const b = Math.round(lowerPoint.b + (upperPoint.b - lowerPoint.b) * factor);

  return (r << 16) | (g << 8) | b;
}

