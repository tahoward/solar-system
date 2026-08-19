import MathUtils from './utils/MathUtils.js';
import { TEXTURES } from './assets/index.js';
import logger from './utils/Logger.js';

export const SIMULATION = {
  USE_N_BODY_PHYSICS: true,

  togglePhysicsMode() {
    this.USE_N_BODY_PHYSICS = !this.USE_N_BODY_PHYSICS;
    logger.info('SIMULATION', `Physics mode switched to: ${this.USE_N_BODY_PHYSICS ? 'N-Body' : 'Kepler'}`);
    return this.USE_N_BODY_PHYSICS;
  },

  getPhysicsMode() {
    return this.USE_N_BODY_PHYSICS ? 'N-Body' : 'Kepler';
  }
};

export const NBODY = {
  MIN_STEPS_PER_ORBIT: 60,

  MAX_APPROACH_FRACTION: 0.02,

  MAX_STEPS_PER_FRAME: 256,

  SOFTENING_RADII: 0.01,
  MIN_SOFTENING: 1e-9
};

export const TIDAL_LOCK = {
  FIGURE_ASYMMETRY: 0.0208,

  DISSIPATION: 0.05,

  MAX_SUBSTEP_RADIANS: 0.2,

  MAX_SUBSTEPS: 12
};

export const MASS_DROP = {
  MASS: 1.0,

  RADIUS_SCALE: 0.5,

  COLOR: 0xff5a2b,
  MARKER_COLOR: 0xff5a2b,
  ROTATION_PERIOD: 240,

  DRAG_TOLERANCE_PIXELS: 5
};

export const SCENE = {
  SCALE: 0.1,
  DEFAULT_RADIUS_FALLBACK: 1,

  MSAA_SAMPLES: 4
};

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

export const ANIMATION = {
  DEFAULT_TRANSITION_DURATION: 2000,
  DEBUG_LOG_PROBABILITY: 0.1
};

export const BLOOM = {
  RESOLUTION_MULTIPLIER: 1.0,

  STRENGTH: .5,
  RADIUS: 0.8,
  THRESHOLD: 1,

  DISABLE_DISTANCE: 0.25,
  FADE_START_DISTANCE: 1.0,
  FADE_END_DISTANCE: 0.2,
  MAX_BLOOM_DISTANCE: 2000
};

export const STAR_VISIBILITY = {
  MAX_VISIBILITY_DISTANCE: 5.0,
  MIN_VISIBILITY_DISTANCE: 0.1,
  FADE_TRANSITION_RANGE: 2.0,

  HIDE_MESH_BY_DEFAULT: false,
  KEEP_GLARE_VISIBLE: true,
  PRESERVE_LIGHTS: true
};

export const STAR_EMISSIVE = {
  BASE_MULTIPLIER: 1.0,

  SOLAR_TEMPERATURE: 5778,
  SOLAR_BASE_INTENSITY: 2.0,

  HOT_STAR_EXPONENT: 2.5,
  WARM_STAR_EXPONENT: 2,
  COOL_STAR_EXPONENT: 1,

  MAX_EMISSIVE_INTENSITY: 12.0,
  MIN_EMISSIVE_INTENSITY: 1.0
};

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

export const GEOMETRY = {
  SPHERE_DETAIL_TIERS: [8, 16, 32, 64, 128],

  SPHERE_DETAIL_MAX_ERROR_PIXELS: 0.5,

  SPHERE_DETAIL_INITIAL_SEGMENTS: 32,

  SPHERE_DETAIL_HYSTERESIS: 0.4
};

export const TARGETING = {
  SUN_INDEX: 0,
  NOT_FOUND_INDEX: -1,
  INITIAL_TARGET_INDEX: 0
};

export const SKYBOX = {
  DEFAULT_BRIGHTNESS: 0.16,
  MIN_BRIGHTNESS: 0.0,
  MAX_BRIGHTNESS: 1.0,
  CUBE_FACE_SIZE: 1536
};

export const MATH = {
  PI_OVER_180: Math.PI / 180,
  TWO_PI: 2 * Math.PI,
  HALF: 0.5,
  TWO: 2
};

export const CELESTIAL_DATA = [{
  name: 'Sun',
  markerColor: 0xFFD700,
  radiusScale: 1,
  mass: 1.0,
  rotationPeriod: 609.12,
  axialTilt: 7.25,
  star: {
    temperature: 5778,
    shader: {
      glowIntensity: 1,
      noiseScale: 10.0,
      brightness: 1,
      sunspotFrequency: 0.04,
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
      hue: 0.15,
      hueSpread: .001,
      noiseFrequency: 15,
      noiseAmplitude: 5.0,
      lowres: false,
      whispyAmount: .1,
      bendAmount: 0.2
    },
    flares: {
      lineCount: 128,
      lineLength: 64,
      lowres: false,
      animationSpeed: 0.1,
      opacity: 0.4,
    },
    glare: {
      size: 90.0,
      opacity: 1,
      color: 0xffaa00,
      glowIntensity: 1.35,
      haloRadius: 0.5,
      haloFalloff: 3.0,
      haloStrength: 0.55,
      fadeStartDistance: 20,
      fadeEndDistance: 10,
      scaleWithDistance: true,
      minScaleDistance: 5.0,
      maxScaleDistance: 2000.0,
      minScale: .02,
      maxScale: 20,
      scaleCenterWithDistance: false,
      centerBaseSize: 0.05,
      centerFadeSize: .1
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
        color: 0xD4AF37,
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
    }
  ]
}];

export function findCelestialBody(name, nodes = CELESTIAL_DATA) {
  if (Array.isArray(nodes)) {
    for (const rootNode of nodes) {
      const found = findCelestialBody(name, rootNode);
      if (found) return found;
    }
    return null;
  }

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

