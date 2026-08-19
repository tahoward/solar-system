import mercuryTexture from '../../assets/mercury.jpg'
import venusTexture from '../../assets/venus_atmosphere.jpg'
import earthTexture from '../../assets/earth.jpg'
import earthClouds from '../../assets/earth_clouds.jpg'
import moonTexture from '../../assets/moon.jpg'
import marsTexture from '../../assets/mars.jpg'
import jupiterTexture from '../../assets/jupiter.jpg'
import ioTexture from '../../assets/io.jpg'
import europaTexture from '../../assets/europa.jpg'
import ganymedeTexture from '../../assets/ganymede.jpg'
import callistoTexture from '../../assets/callisto.jpg'
import saturnTexture from '../../assets/saturn.jpg'
import saturnRingTexture from '../../assets/saturn_ring.png'
import mimasTexture from '../../assets/mimas.jpg'
import enceladusTexture from '../../assets/enceladus.jpg'
import tethysTexture from '../../assets/tethys.jpg'
import dioneTexture from '../../assets/dione.jpg'
import titanTexture from '../../assets/titan.jpg'
import iapetusTexture from '../../assets/iapetus.jpg'
import uranusTexture from '../../assets/uranus.jpg'
import neptuneTexture from '../../assets/neptune.jpg'
import plutoTexture from '../../assets/pluto.jpg'
import charonTexture from '../../assets/charon.jpg'

import nightSkyTexture from '../../assets/night_sky.jpg'

/**
 * Every texture in the project, keyed by a short name.
 *
 * The imports above are what make this file worth having. Importing an image asks the bundler
 * to fingerprint it, copy it into the build output and hand back its final URL, so nothing has
 * to hard-code a path that would only be right in development. It also means a texture that
 * has been renamed or deleted fails the build here, rather than turning up as a missing image
 * at runtime.
 *
 * Consumers refer to textures by these keys, which keeps filenames out of the rest of the
 * codebase.
 *
 * @type {Object<string, string>}
 */
export const TEXTURES = {
  mercury: mercuryTexture,
  venus: venusTexture,
  earth: earthTexture,
  earthClouds: earthClouds,
  moon: moonTexture,
  mars: marsTexture,
  jupiter: jupiterTexture,
  io: ioTexture,
  europa: europaTexture,
  ganymede: ganymedeTexture,
  callisto: callistoTexture,
  saturn: saturnTexture,
  saturnRing: saturnRingTexture,
  mimas: mimasTexture,
  enceladus: enceladusTexture,
  tethys: tethysTexture,
  dione: dioneTexture,
  titan: titanTexture,
  iapetus: iapetusTexture,
  uranus: uranusTexture,
  neptune: neptuneTexture,
  pluto: plutoTexture,
  charon: charonTexture,
  nightSky: nightSkyTexture
}
