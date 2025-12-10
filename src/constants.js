// Solar System Simulation Constants
import MathUtils from './utils/MathUtils.js';
import { TEXTURES } from './assets/index.js';

// Simulation Configuration
export const SIMULATION = {
  // Physics system selection: true = n-body physics, false = Kepler orbits
  USE_N_BODY_PHYSICS: true,

  // Toggle function to switch physics modes
  togglePhysicsMode() {
    this.USE_N_BODY_PHYSICS = !this.USE_N_BODY_PHYSICS;
    console.log(`Physics mode switched to: ${this.USE_N_BODY_PHYSICS ? 'N-Body' : 'Kepler'}`);
    return this.USE_N_BODY_PHYSICS;
  },

  // Getter for current physics mode
  getPhysicsMode() {
    return this.USE_N_BODY_PHYSICS ? 'N-Body' : 'Kepler';
  }
};

// Scene Configuration
export const SCENE = {
  SCALE: 0.1,
  DEFAULT_RADIUS_FALLBACK: 1
};

// Camera Configuration moved to CameraController

// Orbit Configuration
export const ORBIT = {
  AU_SCALE_METERS: 215.5,
  CIRCUMFERENCE_MULTIPLIER: 100,
  KEPLER_EQUATION_ITERATIONS: 10,
  // Speed control limits
  MIN_SPEED_MULTIPLIER: 1.0,
  MAX_SPEED_MULTIPLIER: 6553600.0,  // Capped maximum speed
  SPEED_FACTOR: 2.0,  // Use multiplication/division like n-body (replaces SPEED_INCREMENT)
  // Level-of-detail configuration for orbit lines
  LOD: {
    MIN_SEGMENTS: 64,        // Minimum segments when very far away
    MAX_SEGMENTS: 10000,       // Maximum segments when very close
    CLOSE_DISTANCE: .02,      // Distance considered "close" for max detail
    FAR_DISTANCE: 7000,      // Distance considered "far" for min detail
    UPDATE_FREQUENCY: 0.001    // How often to check LOD (0.1 = 10% of frames)
  }
};

// Marker Configuration
export const MARKER = {
  DEFAULT_SCREEN_SIZE: 0.2,
  DEFAULT_SCALE: 0.02,
  MIN_SIZE_MULTIPLIER: 0.1,
  MAX_SIZE_MULTIPLIER: 3.0,
  SIZE_INCREMENT: 0.1,
  FADE_DURATION: 500,
  FULL_OPACITY: 1.0,
  ZERO_OPACITY: 0.0,
  CENTERING_DIVISOR: 2,
  POSITION_OFFSET_MULTIPLIER: 0.1,
  DEFAULT_SIZE_MULTIPLIER: 1.0
};

// Animation Configuration (zoom/distance factors moved to CameraController)
export const ANIMATION = {
  DEFAULT_TRANSITION_DURATION: 2000,
  DEBUG_LOG_PROBABILITY: 0.1
  // Note: ZOOM_DISTANCE_MULTIPLIER and TARGET_DISTANCE_FACTOR moved to CameraController
};


// Bloom Effect Configuration
export const BLOOM = {
  // Resolution multiplier for bloom effect
  // Higher values = better quality but lower performance
  RESOLUTION_MULTIPLIER: 4.0,  // 4x screen resolution for high-quality bloom

  // Bloom effect parameters
  STRENGTH: .5,    // Bloom strength (reduced to prevent washout)
  RADIUS: 0.8,      // Bloom radius (slightly tighter for more focused glow)
  THRESHOLD: 1,    // Emissive threshold for bloom (only > 1.0 blooms)

  // Distance-based bloom control (scaled by star radiusScale)
  // These values are calibrated for stars with radiusScale: 1 (like the original Sun)
  DISABLE_DISTANCE: 0.25,    // Disable bloom completely when closer than this (scaled units)
  FADE_START_DISTANCE: 1.0,  // Start fading bloom at this distance (scaled units)
  FADE_END_DISTANCE: 0.2,    // Fully fade out bloom at this distance (scaled units)
  MAX_BLOOM_DISTANCE: 1000   // No bloom beyond this distance (scaled units)
};

// Star Visibility Configuration
export const STAR_VISIBILITY = {
  // Distance-based visibility controls for star mesh (glare effects and lights remain visible)
  MAX_VISIBILITY_DISTANCE: 5.0,     // Star mesh hidden beyond this distance
  MIN_VISIBILITY_DISTANCE: 0.1,      // Star mesh always visible closer than this
  FADE_TRANSITION_RANGE: 2.0,        // Distance range for smooth opacity fade

  // Visibility behavior
  HIDE_MESH_BY_DEFAULT: false,        // If true, star mesh hidden until range
  KEEP_GLARE_VISIBLE: true,          // Glare effects remain visible at all distances
  PRESERVE_LIGHTS: true              // Keep star's point lights visible for orbit illumination
};

// Star Emissive Intensity Configuration
export const STAR_EMISSIVE = {
  // Base intensity multiplier for all star effects (material, glare, rays, flares)
  BASE_MULTIPLIER: 1.0,              // Global multiplier for all temperature-based emissive calculations

  // Solar reference values
  SOLAR_TEMPERATURE: 5778,           // Reference temperature in Kelvin
  SOLAR_BASE_INTENSITY: 2.0,         // Base emissive intensity for solar temperature

  // Temperature scaling parameters
  HOT_STAR_EXPONENT: 2.5,           // Exponent for very hot stars (>15000K)
  WARM_STAR_EXPONENT: 2,          // Exponent for warm stars (>10000K)
  COOL_STAR_EXPONENT: 1,          // Exponent for cooler stars

  // Scaling limits
  MAX_EMISSIVE_INTENSITY: 12.0,     // Maximum allowed emissive intensity
  MIN_EMISSIVE_INTENSITY: 1.0       // Minimum allowed emissive intensity
};

// UI Configuration
export const UI = {
  INFO_DISPLAY_STYLE: {
    position: 'fixed',
    top: '20px',
    left: '20px',
    color: 'white',
    fontFamily: 'monospace',
    fontSize: '16px',
    background: 'rgba(0, 0, 0, 0.7)',
    padding: '10px',
    borderRadius: '5px',
    zIndex: 100
  },
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

// Geometry Configuration
export const GEOMETRY = {
  SPHERE_WIDTH_SEGMENTS: 128,  // High resolution for smooth large stars
  SPHERE_HEIGHT_SEGMENTS: 128  // High resolution for smooth large stars
};

// Targeting Configuration
export const TARGETING = {
  SUN_INDEX: 0,
  NOT_FOUND_INDEX: -1,
  INITIAL_TARGET_INDEX: 0
};

// Skybox Configuration
export const SKYBOX = {
  DEFAULT_OPACITY: 0.1,     // Default skybox opacity (0.0 = invisible, 1.0 = fully opaque)
  MIN_OPACITY: 0.1,         // Minimum allowed opacity
  MAX_OPACITY: 1.0,         // Maximum allowed opacity
  RADIUS: 1000000,             // Skybox sphere radius
  SEGMENTS: 64              // Sphere geometry segments for quality
};

// Mathematical Constants
export const MATH = {
  PI_OVER_180: Math.PI / 180,
  TWO_PI: 2 * Math.PI,
  ELLIPSE_FACTOR_A: 3,
  ELLIPSE_FACTOR_B: 3,
  HALF: 0.5,
  TWO: 2
};

// Celestial Body Data with actual nested object hierarchy
// Array structure supports multiple root bodies (binary stars, etc.)
// Orbital elements: a = semi-major axis (AU), e = eccentricity, i = inclination (deg),
// omega = longitude of ascending node (deg), w = argument of periapsis (deg), M0 = mean anomaly at epoch (deg)
export const CELESTIAL_DATA = [{
  // The Sun - root of the hierarchy
  name: 'Sun',
  // color: 0xDC2626, // Will be overridden by temperature-based color
  markerColor: 0xFFD700,  // Gold marker color for the Sun
  radiusScale: 1,
  mass: 1.0,  // 1 solar mass by definition
  rotationPeriod: 609.12,  // Rotation period in Earth hours (~25.4 Earth days)
  axialTilt: 7.25,  // Axial tilt in degrees (relative to orbital plane)
  ecliptic: true,  // If true, direct children orbit in ecliptic plane; if false, they orbit in this body's equatorial plane
  star: {
    // Star physical properties
    temperature: 5778,     // Surface temperature in Kelvin (G-type yellow star - our Sun)
    // lightIntensity: 3,  // Commented out to use temperature-based calculation
    // Star shader parameters (colors determined by temperature)
    shader: {
      glowIntensity: 1,
      noiseScale: 10.0,
      brightness: 1,
      sunspotFrequency: 0.04,
      sunspotIntensity: 2.0
      // emissiveIntensity: 1.3  // Commented out to use temperature-based calculation
    },
    // Corona outersphere parameters (replaces billboard)
    corona: {
      size: 1.1,  // Multiplier of sun radius for corona radius
      coronaIntensity: 4,
      noiseScale: 3.0,
      animationSpeed: .1,
      fresnelPower: 1.75
    },
    // Sun rays parameters
    rays: {
      rayCount: 16000,
      rayLength: .01,
      rayWidth: 0.0003,
      rayOpacity: 0.8,  // Reduced from 2 to be more subtle
      hue: 0.15,
      hueSpread: .001,
      noiseFrequency: 15,
      noiseAmplitude: 5.0,
      lowres: false
      // emissiveIntensity: 1.1  // Commented out to use temperature-based calculation
    },
    // Sun flares parameters
    flares: {
      lineCount: 1024,
      lineLength: 64,
      lowres: false,
      animationSpeed: 0.1,  // Time multiplier for animation
      opacity: 0.4,  // Reduced from 0.8 for more subtle appearance
      // emissiveIntensity: 1.2  // Commented out to use temperature-based calculation
    },
    // Sun glare billboard parameters
    // These values are calibrated for stars with radiusScale: 1 (like our Sun)
    // All distance-based parameters will be scaled proportionally for larger/smaller stars
    glare: {
      size: 90.0,  // Size multiplier relative to sun radius
      opacity: 1,  // Base opacity
      color: 0xffaa00,  // Glare color (will be overridden by temperature)
      // emissiveIntensity: 1.4,  // Commented out to use temperature-based calculation
      fadeStartDistance: 20,  // Distance where fade begins (scaled by radiusScale)
      fadeEndDistance: 10,  // Distance where glare completely disappears (scaled by radiusScale)
      // Distance-based scaling parameters (all scaled by radiusScale)
      scaleWithDistance: true,  // Enable proportional scaling based on camera distance
      minScaleDistance: 15,   // Distance at minimum scale (scaled by radiusScale)
      maxScaleDistance: 1000.0,  // Distance at maximum scale (scaled by radiusScale)
      minScale: .2,           // Minimum scale factor when very close
      maxScale: 10,           // Maximum scale factor when far
      // Radial center glow scaling
      scaleCenterWithDistance: false,  // Enable center glow scaling with distance
      centerBaseSize: 0.05,          // Base size of center glow (0.01 = 1% of texture)
      centerFadeSize: .1           // Fade-out size of center glow (0.03 = 3% of texture)
    }
  },
  parent: null,  // No parent - center of the system
  // No orbital elements since it doesn't orbit anything
  children: [
    // Mercury
    {
      name: 'Mercury',
      color: 0x8B7B6F,
      markerColor: 0x8B7B6F,  // Brown-gray for Mercury
      radiusScale: 0.00350366313,
      mass: 1.66013e-7,
      rotationPeriod: 1407.6,  // Rotation period in Earth hours
      axialTilt: 0.034,  // Axial tilt in degrees (nearly upright)
      lightIntensity: null,  // No light emission
      surfaceTexture: TEXTURES.mercury,  // Mercury surface texture
      parent: 'Sun',
      a: 0.387098, e: 0.205630, i: 7.005, omega: 48.331, w: 29.124, M0: 174.796,
      children: []
    },
    // Venus
    {
      name: 'Venus',
      color: 0xC9AEBE,
      markerColor: 0xFFC649,  // Yellow-orange for Venus
      radiusScale: 0.00869074857,
      mass: 2.44783e-6,
      rotationPeriod: -5832.5,  // Rotation period in Earth hours (retrograde)
      axialTilt: 177.4,  // Axial tilt in degrees (nearly upside down)
      lightIntensity: null,  // No light emission
      surfaceTexture: TEXTURES.venus,  // Venus surface texture
      // Venus's thick atmosphere
      atmosphere: {
        color: 0xFFE4B5,  // Pale yellow (sulfuric acid clouds)
        radiusScale: 1.05,  // Much larger for visibility
        transparency: 1.2,  // Maximum visibility
        emissiveIntensity: 1000  // Bloom effect for thick atmosphere
      },
      parent: 'Sun',
      a: 0.723332, e: 0.006772, i: 3.395, omega: 76.680, w: 54.884, M0: 50.115,
      children: []
    },
    // Earth
    {
      name: 'Earth',
      color: 0x007FFF,
      markerColor: 0x4A90E2,  // Blue for Earth
      radiusScale: 0.00915921329,
      mass: 3.00348e-6,
      rotationPeriod: 23.93,  // Rotation period in Earth hours
      axialTilt: 23.44,  // Axial tilt in degrees (causes seasons)
      ecliptic: true,  // If true, direct children orbit in ecliptic plane; if false, they orbit in this body's equatorial plane
      lightIntensity: null,  // No light emission
      surfaceTexture: TEXTURES.earth,  // High-resolution Earth surface texture
      // Earth's atmospheric cloud layer
      // clouds: {
      //   texture: TEXTURES.earthClouds,  // Cloud texture path
      //   radiusScale: 1.01,  // Slightly larger than Earth (1% bigger)
      //   opacity: 0.8,  // Cloud transparency
      //   rotationSpeed: 2  // Clouds rotate slightly faster than Earth
      // },
      // Earth's atmosphere effect
      atmosphere: {
        color: 0x87CEEB,  // Sky blue atmosphere
        radiusScale: 1.03,  // 30% larger than Earth for visibility
        transparency: 1.2,  // Maximum visibility
        emissiveIntensity: 1,  // Bloom effect for Earth's atmosphere
        fadeStart: .7,  // Start fading at 80% of atmosphere radius (closer to edge)
        fadeEnd: 1     // Complete fade at atmosphere edge
      },
      parent: 'Sun',
      a: 1.000001, e: 0.016709, i: 0.000, omega: 0.000, w: 114.208, M0: 357.529,
      children: [
        // Moon
        {
          name: 'Moon',
          color: 0xC0C0C0,
          markerColor: 0xD3D3D3,  // Light gray for Moon
          radiusScale: .274, // Scaled up for visibility and eclipse capability (realistic ratio would be 0.273)
          mass: 3.69396e-8,
          rotationPeriod: 655.7,  // Tidally locked (27.3 Earth days)
          axialTilt: 1.54,  // Axial tilt in degrees
          rotationOffset: -Math.PI / 2,  // 90 degree rotation offset (π/2 radians) to show a different face
          tidallyLocked: true,  // Moon always shows same face to Earth
          lightIntensity: null,  // No light emission
          surfaceTexture: TEXTURES.moon,  // Moon surface texture
          parent: 'Earth',
          a: 0.00257,   // Semi-major axis in AU (384,400 km)
          e: 0.0549,   // Eccentricity
          i: 5.1,    // Inclination relative to Earth's equatorial plane (23.44° Earth tilt - 5.145° to ecliptic = 18.34°)
          omega: 125.0,  // Longitude of ascending node (degrees)
          w: 318.0,      // Argument of periapsis (degrees)
          M0: 135.0,     // Mean anomaly at epoch (degrees) - start at quarter orbit
          children: []
        }
      ]
    },
    // Mars
    {
      name: 'Mars',
      color: 0xFF8C00,
      markerColor: 0xCD853F,  // Peru/orange-brown for Mars
      radiusScale: 0.00486745707,
      mass: 3.22715e-7,
      rotationPeriod: 24.62,  // Rotation period in Earth hours
      axialTilt: 25.19,  // Axial tilt in degrees (similar to Earth)
      lightIntensity: null,  // No light emission
      surfaceTexture: TEXTURES.mars,  // Mars surface texture
      // Mars's thin atmosphere
      atmosphere: {
        color: 0xD2691E,  // Rusty orange (dust in atmosphere)
        radiusScale: 1.03,  // Larger for visibility
        transparency: 2,  // More visible
        emissiveIntensity: 1,  // Subtle bloom for thin atmosphere
        fadeStart: .8,
        fadeEnd: 1
      },
      parent: 'Sun',
      a: 1.523679, e: 0.093401, i: 1.850, omega: 49.558, w: 286.502, M0: 19.373,
      children: [
        // Phobos and Deimos could be added here later
      ]
    },
    // Jupiter
    {
      name: 'Jupiter',
      color: 0xD2691E,
      markerColor: 0xD2691E,  // Saddle brown for Jupiter
      radiusScale: 0.10039681989,
      mass: 9.54265e-4,
      rotationPeriod: 9.93,  // Rotation period in Earth hours
      axialTilt: 3.13,  // Axial tilt in degrees (nearly upright)
      lightIntensity: null,  // No light emission
      surfaceTexture: TEXTURES.jupiter,  // Jupiter surface texture
      // Jupiter's thick hydrogen/helium atmosphere
      atmosphere: {
        color: 0xDAA520,  // Goldenrod (hydrogen clouds with ammonia)
        radiusScale: 1.02,  // Subtle atmosphere layer
        transparency: 1.0,  // Moderate visibility
        emissiveIntensity: 1.3  // Bloom effect for gas giant atmosphere
      },
      parent: 'Sun',
      a: 5.204267, e: 0.048498, i: 1.303, omega: 100.464, w: 273.867, M0: 20.020,
      children: [
        // Io - innermost Galilean moon
        {
          name: 'Io',
          color: 0xFFFF99,  // Yellowish (sulfur surface)
          markerColor: 0xFFFF99,  // Yellowish for Io
          radiusScale: 0.026, // Io radius relative to Jupiter (1,821.6 km / 69,911 km)
          mass: 4.704e-9,  // Mass in solar masses
          rotationPeriod: 42.46,  // Tidally locked (1.77 Earth days)
          axialTilt: 0.05,  // Nearly no tilt
          tidallyLocked: true,  // Always faces Jupiter
          lightIntensity: null,
          parent: 'Jupiter',
          a: 0.002819,  // Semi-major axis in AU (421,700 km)
          e: 0.0041,    // Low eccentricity
          i: 0.05,      // Low inclination
          omega: 43.977, w: 84.129, M0: 0.0,
          surfaceTexture: TEXTURES.io,
          children: []
        },
        // Europa - second Galilean moon
        {
          name: 'Europa',
          color: 0xB0C4DE,  // Light steel blue (icy surface)
          markerColor: 0xB0C4DE,  // Light steel blue for Europa
          radiusScale: 0.022, // Europa radius relative to Jupiter (1,560.8 km / 69,911 km)
          mass: 2.528e-9,  // Mass in solar masses
          rotationPeriod: 85.23,  // Tidally locked (3.55 Earth days)
          axialTilt: 0.1,   // Nearly no tilt
          tidallyLocked: true,  // Always faces Jupiter
          lightIntensity: null,
          surfaceTexture: TEXTURES.europa,
          parent: 'Jupiter',
          a: 0.004486,  // Semi-major axis in AU (671,034 km)
          e: 0.009,     // Low eccentricity
          i: 0.47,      // Low inclination
          omega: 219.106, w: 88.970, M0: 90.0,
          children: []
        },
        // Ganymede - largest moon in solar system
        {
          name: 'Ganymede',
          color: 0x8B7355,  // Brown-gray (mixed ice and rock)
          markerColor: 0x8B7355,  // Brown-gray for Ganymede
          radiusScale: 0.038, // Ganymede radius relative to Jupiter (2,634.1 km / 69,911 km)
          mass: 7.805e-9,  // Mass in solar masses
          rotationPeriod: 171.71,  // Tidally locked (7.15 Earth days)
          axialTilt: 0.33,  // Small tilt
          tidallyLocked: true,  // Always faces Jupiter
          lightIntensity: null,
          surfaceTexture: TEXTURES.ganymede,
          parent: 'Jupiter',
          a: 0.007155,  // Semi-major axis in AU (1,070,412 km)
          e: 0.0013,    // Very low eccentricity
          i: 0.20,      // Low inclination
          omega: 63.552, w: 192.417, M0: 180.0,
          children: []
        },
        // Callisto - outermost Galilean moon
        {
          name: 'Callisto',
          color: 0x696969,  // Dark gray (heavily cratered)
          markerColor: 0x696969,  // Dark gray for Callisto
          radiusScale: 0.034, // Callisto radius relative to Jupiter (2,410.3 km / 69,911 km)
          mass: 5.670e-9,  // Mass in solar masses
          rotationPeriod: 400.54,  // Tidally locked (16.69 Earth days)
          axialTilt: 0.51,  // Small tilt
          tidallyLocked: true,  // Always faces Jupiter
          lightIntensity: null,
          surfaceTexture: TEXTURES.callisto,
          parent: 'Jupiter',
          a: 0.01258,   // Semi-major axis in AU (1,882,709 km)
          e: 0.0074,    // Low eccentricity
          i: 0.51,      // Low inclination
          omega: 298.848, w: 52.643, M0: 270.0,
          children: []
        }
      ]
    },
    // Saturn
    {
      name: 'Saturn',
      color: 0xFFD700,
      markerColor: 0xFFD700,  // Gold for Saturn
      radiusScale: 0.08362569044,
      mass: 2.85885e-4,
      rotationPeriod: 10.66,  // Rotation period in Earth hours
      axialTilt: 26.73,  // Axial tilt in degrees (similar to Earth, causes ring visibility changes)
      lightIntensity: null,  // No light emission
      surfaceTexture: TEXTURES.saturn,  // Saturn surface texture
      // Saturn's thick hydrogen/helium atmosphere
      atmosphere: {
        color: 0xF0E68C,  // Khaki (pale gold hydrogen atmosphere)
        radiusScale: 1.02,  // Subtle atmosphere layer
        transparency: 0.5,  // Moderate visibility
        emissiveIntensity: 1.25  // Bloom effect for gas giant atmosphere
      },
      parent: 'Sun',
      a: 9.582017, e: 0.055723, i: 2.485, omega: 113.665, w: 339.392, M0: 317.020,
      // Saturn's ring system
      rings: {
        innerRadius: 1.11,  // Inner radius relative to Saturn's radius (C ring inner edge - creates visible gap from surface)
        outerRadius: 2.35,  // Outer radius relative to Saturn's radius (~136,780 km from center - A ring outer edge)
        opacity: 0.8,       // Ring transparency (increased for better visibility)
        color: 0xD4AF37,    // Golden color for the rings (fallback)
        texture: TEXTURES.saturnRing  // Ring texture path
      },
      children: [
        // Mimas - innermost major moon
        {
          name: 'Mimas',
          color: 0xC0C0C0,  // Gray (icy, heavily cratered)
          markerColor: 0xC0C0C0,  // Silver for Mimas
          radiusScale: 0.0034, // Mimas radius relative to Saturn (198.2 km / 58,232 km)
          mass: 1.972e-12, // Mass in solar masses
          rotationPeriod: 22.62, // Tidally locked (0.942 Earth days)
          axialTilt: 0.02, // Nearly aligned with Saturn's equator
          tidallyLocked: true,  // Always faces Saturn
          lightIntensity: null,
          surfaceTexture: TEXTURES.mimas,
          parent: 'Saturn',
          a: 0.001241, // Semi-major axis in AU (185,539 km)
          e: 0.0196, // Eccentricity
          i: 0.02, // Nearly equatorial orbit
          omega: 139.1, w: 342.2, M0: 0.0,
          children: []
        },
        // Enceladus - geologically active icy moon
        {
          name: 'Enceladus',
          color: 0xF0F8FF, // Alice blue (bright icy surface)
          markerColor: 0xF0F8FF, // Alice blue for Enceladus
          radiusScale: 0.0043, // Enceladus radius relative to Saturn (252.1 km / 58,232 km)
          mass: 5.655e-12, // Mass in solar masses
          rotationPeriod: 32.88, // Tidally locked (1.37 Earth days)
          axialTilt: 0.0, // No significant tilt
          tidallyLocked: true,  // Always faces Saturn
          lightIntensity: null,
          surfaceTexture: TEXTURES.enceladus,
          parent: 'Saturn',
          a: 0.001593, // Semi-major axis in AU (238,020 km)
          e: 0.0047, // Low eccentricity
          i: 0.02, // Very low inclination
          omega: 6.2, w: 211.9, M0: 90.0,
          children: []
        },
        // Tethys - mid-sized icy moon
        {
          name: 'Tethys',
          color: 0xE6E6FA, // Lavender (icy surface)
          markerColor: 0xE6E6FA, // Lavender for Tethys
          radiusScale: 0.0091, // Tethys radius relative to Saturn (531.1 km / 58,232 km)
          mass: 3.09e-11, // Mass in solar masses
          rotationPeriod: 45.31, // Tidally locked (1.89 Earth days)
          axialTilt: 0.02, // Nearly aligned with Saturn's equator
          tidallyLocked: true,  // Always faces Saturn
          lightIntensity: null,
          surfaceTexture: TEXTURES.tethys,
          parent: 'Saturn',
          a: 0.001975, // Semi-major axis in AU (294,619 km)
          e: 0.0001, // Nearly circular
          i: 0.02, // Nearly equatorial orbit
          omega: 158.3, w: 262.2, M0: 180.0,
          children: []
        },
        // Dione - mid-sized moon
        {
          name: 'Dione',
          color: 0xD3D3D3, // Light gray (icy with some darker regions)
          markerColor: 0xD3D3D3, // Light gray for Dione
          radiusScale: 0.0096, // Dione radius relative to Saturn (561.4 km / 58,232 km)
          mass: 5.48e-11, // Mass in solar masses
          rotationPeriod: 65.69, // Tidally locked (2.74 Earth days)
          axialTilt: 0.02, // Nearly no tilt
          tidallyLocked: true,  // Always faces Saturn
          lightIntensity: null,
          surfaceTexture: TEXTURES.dione,
          parent: 'Saturn',
          a: 0.002523, // Semi-major axis in AU (377,396 km)
          e: 0.0022, // Low eccentricity
          i: 0.02, // Very low inclination
          omega: 168.8, w: 91.1, M0: 270.0,
          children: []
        },
        // Titan - largest moon, thick atmosphere
        {
          name: 'Titan',
          color: 0xCD853F, // Peru (orange-brown due to thick atmosphere)
          markerColor: 0xCD853F, // Peru for Titan
          radiusScale: 0.044, // Titan radius relative to Saturn (2,574 km / 58,232 km)
          mass: 6.741e-9, // Mass in solar masses
          rotationPeriod: 382.69, // Tidally locked (15.95 Earth days)
          axialTilt: 0.02, // Nearly aligned with Saturn's equator
          tidallyLocked: true,  // Always faces Saturn
          lightIntensity: null,
          surfaceTexture: TEXTURES.titan,
          // Titan's thick methane atmosphere
          atmosphere: {
            color: 0xDEB887,  // Burlywood (orange haze)
            radiusScale: 1.06,  // Thick atmosphere - 6% larger
            transparency: 0.5,  // Moderately opaque
            stretchAmount: 0.4,  // Limited sunset effects due to thick haze
            visibilityDistance: 1200.0,  // Visible from moderate distance
            emissiveIntensity: 1.6  // Strong bloom for thick methane atmosphere
          },
          parent: 'Saturn',
          a: 0.008168, // Semi-major axis in AU (1,221,830 km)
          e: 0.0288, // Low eccentricity
          i: 0.02, // Nearly equatorial orbit
          omega: 28.1, w: 180.5, M0: 0.0,
          children: []
        },
        // Iapetus - distant moon with two-tone coloring
        {
          name: 'Iapetus',
          color: 0x8B4513, // Saddle brown (dark leading hemisphere)
          markerColor: 0x8B4513, // Saddle brown for Iapetus
          radiusScale: 0.0126, // Iapetus radius relative to Saturn (734.5 km / 58,232 km)
          mass: 9.09e-11, // Mass in solar masses
          rotationPeriod: 1903.8, // Tidally locked (79.33 Earth days)
          axialTilt: 8.13, // Significant tilt relative to Saturn's equator
          tidallyLocked: true,  // Always faces Saturn
          lightIntensity: null,
          surfaceTexture: TEXTURES.iapetus,
          parent: 'Saturn',
          a: 0.0238, // Semi-major axis in AU (3,561,300 km)
          e: 0.0286, // Low eccentricity
          i: 8.13, // Higher inclination relative to Saturn's equatorial plane
          omega: 75.8, w: 271.6, M0: 90.0,
          children: []
        }
      ]
    },
    // Uranus
    {
      name: 'Uranus',
      color: 0xADD8E6,
      markerColor: 0x4FD0E4, // Light blue for Uranus
      radiusScale: 0.03642099424,
      mass: 4.36625e-5,
      rotationPeriod: -17.24,  // Rotation period in Earth hours (retrograde)
      axialTilt: 97.77,  // Axial tilt in degrees (almost sideways!)
      lightIntensity: null,  // No light emission
      surfaceTexture: TEXTURES.uranus,  // Uranus surface texture
      // Uranus's hydrogen/helium/methane atmosphere
      atmosphere: {
        color: 0x40E0D0,  // Turquoise (methane gives blue-green color)
        radiusScale: 1.03,  // Slightly larger for visibility
        transparency: 0.7,  // Good visibility
        emissiveIntensity: 1.35  // Bloom effect for ice giant atmosphere
      },
      parent: 'Sun',
      a: 19.18917, e: 0.047168, i: 0.773, omega: 74.006, w: 96.998, M0: 142.238,
      children: [
        // Major moons could be added here: Miranda, Ariel, Umbriel, Titania, Oberon
      ]
    },
    // Neptune
    {
      name: 'Neptune',
      color: 0x1E90FF,
      markerColor: 0x1E90FF, // Dodger blue for Neptune
      radiusScale: 0.03535880191,
      mass: 5.15138e-5,
      rotationPeriod: 16.11,  // Rotation period in Earth hours
      axialTilt: 28.32,  // Axial tilt in degrees (similar to Earth and Mars)
      lightIntensity: null,  // No light emission
      surfaceTexture: TEXTURES.neptune,  // Neptune surface texture
      // Neptune's hydrogen/helium/methane atmosphere
      atmosphere: {
        color: 0x4169E1,  // Royal blue (strong methane absorption)
        radiusScale: 1.03,  // Slightly larger for visibility
        transparency: 0.8,  // High visibility
        emissiveIntensity: 1.4  // Bloom effect for ice giant atmosphere
      },
      parent: 'Sun',
      a: 30.06896, e: 0.008606, i: 1.770, omega: 131.784, w: 276.336, M0: 256.228,
      children: [
        // Major moon could be added here: Triton
      ]
    },
    // Pluto
    {
      name: 'Pluto',
      color: 0xBEBEBE,
      markerColor: 0xBEBEBE, // Light gray for Pluto
      radiusScale: 0.00170648732,
      mass: 6.58719e-9,
      rotationPeriod: -153.29,  // Rotation period in Earth hours (retrograde)
      axialTilt: 122.53,  // Axial tilt in degrees (more extreme than Uranus)
      lightIntensity: null,  // No light emission
      surfaceTexture: TEXTURES.pluto,
      // Pluto's very thin nitrogen atmosphere
      atmosphere: {
        color: 0xE6E6FA,  // Lavender (very pale nitrogen atmosphere)
        radiusScale: 1.1,  // Very thin atmosphere
        transparency: 0.3,  // Low visibility due to thinness
        emissiveIntensity: 1.1  // Subtle bloom for very thin atmosphere
      },
      parent: 'Sun',
      a: 39.48211, e: 0.248808, i: 17.140, omega: 110.299, w: 113.834, M0: 0.0,
      children: [
        // Charon - Pluto's large moon (sometimes called a "double planet" system)
        {
          name: 'Charon',
          color: 0x808080, // Dark gray (water ice and rock)
          markerColor: 0x808080, // Dark gray for Charon
          radiusScale: 0.511, // Charon radius relative to Pluto (606 km / 1,188.3 km) - unusually large!
          mass: 8.08e-10, // Mass in solar masses (about 1/8th of Pluto's mass)
          rotationPeriod: 153.29, // Tidally locked to Pluto (same as Pluto's rotation - they're mutually tidally locked)
          axialTilt: 0.08, // Nearly no tilt relative to orbital plane
          tidallyLocked: true,  // Always faces Pluto (mutually tidally locked system)
          lightIntensity: null, // No light emission
          surfaceTexture: TEXTURES.charon,
          parent: 'Pluto',
          a: 0.000131, // Semi-major axis in AU (19,591 km)
          e: 0.0002, // Nearly circular orbit
          i: 0.08, // Very low inclination
          omega: 223.0, w: 102.0, M0: 180.0, // Orbital elements
          children: []
        }
      ]
    }
  ]
}];

/**
 * Find a celestial body by name in the nested hierarchy
 * @param {string} name - Name of the celestial body to find
 * @param {Object|Array} nodes - Current node(s) to search (defaults to CELESTIAL_DATA array)
 * @returns {Object|null} The found celestial body or null
 */
export function findCelestialBody(name, nodes = CELESTIAL_DATA) {
  // If nodes is an array (root level), search through all root bodies
  if (Array.isArray(nodes)) {
    for (const rootNode of nodes) {
      const found = findCelestialBody(name, rootNode);
      if (found) return found;
    }
    return null;
  }

  // If nodes is a single object, search it and its children
  const node = nodes;
  if (node.name === name) {
    return node;
  }

  if (node.children && Array.isArray(node.children)) {
    for (const child of node.children) {
      const found = findCelestialBody(name, child);
      if (found) return found;
    }
  }

  return null;
}


/**
 * Convert temperature to pure blackbody radiation color for accurate light emission
 * Based on Wien's displacement law and Planck's law
 * @param {number} temperature - Temperature in Kelvin
 * @returns {number} Hex color value for light emission
 */
export function temperatureToBlackbodyLight(temperature) {
  // Clamp temperature to reasonable range
  const temp = MathUtils.clamp(temperature, 1000, 50000);

  // CIE 1931 2° Standard Observer color matching functions
  // Approximate blackbody radiation using scientific color temperature conversion

  let r, g, b;

  // Red component
  if (temp >= 6600) {
    r = temp / 100;
    r = 329.698727446 * Math.pow(r - 60, -0.1332047592);
  } else {
    r = 255;
  }

  // Green component
  if (temp >= 6600) {
    g = temp / 100;
    g = 288.1221695283 * Math.pow(g - 60, -0.0755148492);
  } else {
    g = temp / 100;
    g = 99.4708025861 * Math.log(g) - 161.1195681661;
  }

  // Blue component
  if (temp >= 6600) {
    b = 255;
  } else if (temp <= 1900) {
    b = 0;
  } else {
    b = temp / 100;
    b = 138.5177312231 * Math.log(b - 10) - 305.0447927307;
  }

  // Clamp to valid range and convert to integers
  r = MathUtils.clamp(Math.round(r), 0, 255);
  g = MathUtils.clamp(Math.round(g), 0, 255);
  b = MathUtils.clamp(Math.round(b), 0, 255);

  // Convert to hex
  return (r << 16) | (g << 8) | b;
}

/**
 * Convert stellar temperature to realistic color using continuous gradient
 * Based on black-body radiation and stellar classification for visual appearance
 * @param {number} temperature - Surface temperature in Kelvin
 * @returns {number} Hex color value
 */
/**
 * Calculate glare brightness based on stellar temperature
 * @param {number} temperature - Temperature in Kelvin
 * @param {number} radius - Stellar radius relative to Sun (default: 1.0)
 * @returns {number} Glare brightness multiplier
 */
export function temperatureToGlareBrightness(temperature) {
  // Use configurable values from STAR_EMISSIVE constants
  const SOLAR_TEMPERATURE = STAR_EMISSIVE.SOLAR_TEMPERATURE;
  const SOLAR_GLARE_BASE = STAR_EMISSIVE.SOLAR_BASE_INTENSITY;

  // Clamp temperature to reasonable stellar range
  const temp = MathUtils.clamp(temperature, 1000, 50000);

  // Calculate relative brightness using Stefan-Boltzmann law
  // For very hot stars, use more aggressive scaling to show dramatic differences
  const temperatureRatio = temp / SOLAR_TEMPERATURE;
  let brightnessRatio;

  if (temp > 15000) {
    // Very hot stars (O-type, B-type) - use configurable exponent, radius scaling removed
    brightnessRatio = Math.pow(temperatureRatio, STAR_EMISSIVE.HOT_STAR_EXPONENT);
  } else if (temp > 10000) {
    // Hot stars (A-type) - use configurable exponent, radius scaling removed
    brightnessRatio = Math.pow(temperatureRatio, STAR_EMISSIVE.WARM_STAR_EXPONENT);
  } else {
    // Cooler stars (F, G, K, M-type) - use configurable exponent, radius scaling removed
    brightnessRatio = Math.pow(temperatureRatio, STAR_EMISSIVE.COOL_STAR_EXPONENT);
  }

  // Calculate glare intensity
  const rawIntensity = SOLAR_GLARE_BASE * brightnessRatio;

  // Tiered scaling system for different temperature ranges
  let scaledIntensity;
  if (rawIntensity > 50) {
    // Extremely hot stars (25000K+) - allow very high intensity but with some control
    scaledIntensity = 50 + Math.log10(rawIntensity / 50) * 8;
  } else if (rawIntensity > 15) {
    // Very hot stars (15000K+) - moderate logarithmic scaling
    scaledIntensity = 15 + Math.log10(rawIntensity / 15) * 6;
  } else {
    // Cooler stars - linear scaling
    scaledIntensity = rawIntensity;
  }

  // Apply the configurable base multiplier and clamp to configured limits
  const finalIntensity = scaledIntensity * STAR_EMISSIVE.BASE_MULTIPLIER;
  return MathUtils.clamp(finalIntensity, STAR_EMISSIVE.MIN_EMISSIVE_INTENSITY, STAR_EMISSIVE.MAX_EMISSIVE_INTENSITY);
}

export function temperatureToColor(temperature) {
  // Clamp temperature to reasonable stellar range
  const temp = MathUtils.clamp(temperature, 2000, 50000);

  // Define key temperature points and their RGB colors
  const tempPoints = [
    { temp: 2000, r: 153, g: 27, b: 27 },   // Very cool red dwarf (dark red)
    { temp: 3000, r: 220, g: 38, b: 38 },   // M-type red dwarf
    { temp: 4000, r: 249, g: 115, b: 22 },  // K-type orange star
    { temp: 5000, r: 253, g: 224, b: 71 },  // G-type yellow (our Sun)
    { temp: 6000, r: 254, g: 243, b: 199 }, // F-type yellow-white
    { temp: 7500, r: 248, g: 250, b: 252 }, // A-type white
    { temp: 10000, r: 14, g: 165, b: 233 }, // B-type blue-white
    { temp: 30000, r: 30, g: 58, b: 138 },  // O-type hot blue
    { temp: 50000, r: 21, g: 36, b: 117 }   // Very hot blue
  ];

  // Find the two temperature points to interpolate between
  let lowerPoint = tempPoints[0];
  let upperPoint = tempPoints[tempPoints.length - 1];

  for (let i = 0; i < tempPoints.length - 1; i++) {
    if (temp >= tempPoints[i].temp && temp <= tempPoints[i + 1].temp) {
      lowerPoint = tempPoints[i];
      upperPoint = tempPoints[i + 1];
      break;
    }
  }

  // Calculate interpolation factor (0 to 1)
  const factor = (temp - lowerPoint.temp) / (upperPoint.temp - lowerPoint.temp);

  // Interpolate RGB values
  const r = Math.round(lowerPoint.r + (upperPoint.r - lowerPoint.r) * factor);
  const g = Math.round(lowerPoint.g + (upperPoint.g - lowerPoint.g) * factor);
  const b = Math.round(lowerPoint.b + (upperPoint.b - lowerPoint.b) * factor);

  // Convert to hex
  return (r << 16) | (g << 8) | b;
}

