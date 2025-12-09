// Planet textures - ES module imports ensure they're bundled by Vite
import mercuryTexture from '../../assets/mercury.jpg'
import venusTexture from '../../assets/venus_atmosphere.jpg'
import earthTexture from '../../assets/earth.jpg'
import earthClouds from '../../assets/earth_clouds.jpg'
import moonTexture from '../../assets/moon.jpg'
import marsTexture from '../../assets/mars.jpg'
import jupiterTexture from '../../assets/jupiter.jpg'
import saturnTexture from '../../assets/saturn.jpg'
import saturnRingTexture from '../../assets/saturn_ring.png'
import uranusTexture from '../../assets/uranus.jpg'
import neptuneTexture from '../../assets/neptune.jpg'
import plutoTexture from '../../assets/pluto.jpg'
import charonTexture from '../../assets/charon.jpg'

// Environment textures
import nightSkyTexture from '../../assets/night_sky.jpg'

// UI assets
import markerSVG from '../../assets/marker.svg'

// Export all assets for easy importing
export const TEXTURES = {
  mercury: mercuryTexture,
  venus: venusTexture,
  earth: earthTexture,
  earthClouds: earthClouds,
  moon: moonTexture,
  mars: marsTexture,
  jupiter: jupiterTexture,
  saturn: saturnTexture,
  saturnRing: saturnRingTexture,
  uranus: uranusTexture,
  neptune: neptuneTexture,
  pluto: plutoTexture,
  charon: charonTexture,
  nightSky: nightSkyTexture,
  marker: markerSVG
}

// Individual exports for direct imports
export {
  mercuryTexture,
  venusTexture,
  earthTexture,
  earthClouds,
  moonTexture,
  marsTexture,
  jupiterTexture,
  saturnTexture,
  saturnRingTexture,
  uranusTexture,
  neptuneTexture,
  plutoTexture,
  charonTexture,
  nightSkyTexture,
  markerSVG
}