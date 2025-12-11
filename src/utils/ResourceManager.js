import SceneManager from '../managers/SceneManager.js';
import logger, { log } from './Logger.js';

/**
 * ResourceManager - Handles cleanup and disposal of resources for celestial bodies
 * Extracted from Body.js to centralize resource management logic
 */
class ResourceManager {
    /**
     * Clean up body resources to prevent memory leaks
     * @param {Object} body - The body instance to dispose
     */
    static dispose(body) {
        // Unregister from star system if this is a star
        if (body.isStar) {
            SceneManager.unregisterStar(body.group);
            log.debug('ResourceManager', `Unregistered ${body.name} from bloom effects`);
        }

        // Dispose of orbit trail first
        ResourceManager.disposeOrbitTrail(body);

        // Dispose of marker
        ResourceManager.disposeMarker(body);

        // Dispose of star effects
        ResourceManager.disposeStarEffects(body);

        // Dispose of rendering elements
        ResourceManager.disposeRenderingElements(body);

        // Dispose of geometry and material
        ResourceManager.disposeGeometryAndMaterial(body);

        // Remove from scene
        ResourceManager.removeFromScene(body);

        // Clear references
        ResourceManager.clearReferences(body);
    }

    /**
     * Dispose of orbit trail
     * @param {Object} body - The body instance
     */
    static disposeOrbitTrail(body) {
        if (body.orbitTrail && typeof body.orbitTrail.dispose === 'function') {
            log.info('ResourceManager', `Disposing orbit trail for ${body.name}`);
            body.orbitTrail.dispose();
            body.orbitTrail = null;
        }
    }

    /**
     * Dispose of marker
     * @param {Object} body - The body instance
     */
    static disposeMarker(body) {
        if (body.marker && typeof body.marker.dispose === 'function') {
            log.info('ResourceManager', `Disposing marker for ${body.name}`);
            body.marker.dispose();
            body.marker = null;
        } else if (body.marker) {
            log.warn('ResourceManager', `Marker for ${body.name} has no dispose method`);
        }
    }

    /**
     * Dispose of star effects (billboard, rays, flares, glare)
     * @param {Object} body - The body instance
     */
    static disposeStarEffects(body) {
        // Dispose of billboard glow effect if it exists (for Sun)
        if (body.billboard && typeof body.billboard.dispose === 'function') {
            log.info('ResourceManager', `Disposing billboard glow effect for ${body.name}`);
            body.billboard.dispose();
            body.billboard = null;
        }

        // Dispose of sun rays effect if it exists (for Sun)
        if (body.sunRays && typeof body.sunRays.dispose === 'function') {
            log.info('ResourceManager', `Disposing sun rays effect for ${body.name}`);
            body.sunRays.dispose();
            body.sunRays = null;
        }

        // Dispose of sun flares effect if it exists
        if (body.sunFlares && typeof body.sunFlares.dispose === 'function') {
            log.info('ResourceManager', `Disposing sun flares effect for ${body.name}`);
            body.sunFlares.dispose();
            body.sunFlares = null;
        }

        // Dispose of sun glare effect if it exists
        if (body.sunGlare && typeof body.sunGlare.dispose === 'function') {
            log.info('ResourceManager', `Disposing sun glare effect for ${body.name}`);
            body.sunGlare.dispose();
            body.sunGlare = null;
        }
    }

    /**
     * Dispose of rendering elements (rings, clouds, atmosphere)
     * @param {Object} body - The body instance
     */
    static disposeRenderingElements(body) {
        // Dispose of rings if they exist
        ResourceManager.disposeRings(body);

        // Dispose of clouds if they exist
        ResourceManager.disposeClouds(body);

        // Dispose of atmosphere if it exists
        ResourceManager.disposeAtmosphere(body);
    }

    /**
     * Dispose of ring system
     * @param {Object} body - The body instance
     */
    static disposeRings(body) {
        if (body.rings) {
            if (body.rings.geometry) {
                body.rings.geometry.dispose();
            }
            if (body.rings.material) {
                body.rings.material.dispose();
            }
            if (body.rings.parent) {
                body.rings.parent.remove(body.rings);
            }
            body.rings = null;
        }
    }

    /**
     * Dispose of cloud system
     * @param {Object} body - The body instance
     */
    static disposeClouds(body) {
        if (body.clouds) {
            if (body.clouds.geometry) {
                body.clouds.geometry.dispose();
            }
            if (body.clouds.material) {
                if (body.clouds.material.map) {
                    body.clouds.material.map.dispose();
                }
                body.clouds.material.dispose();
            }
            if (body.clouds.parent) {
                body.clouds.parent.remove(body.clouds);
            }
            body.clouds = null;
        }
    }

    /**
     * Dispose of atmosphere system
     * @param {Object} body - The body instance
     */
    static disposeAtmosphere(body) {
        if (body.atmosphere) {
            if (body.atmosphere.geometry) {
                body.atmosphere.geometry.dispose();
            }
            if (body.atmosphere.material) {
                body.atmosphere.material.dispose();
            }
            if (body.atmosphere.parent) {
                body.atmosphere.parent.remove(body.atmosphere);
            }
            body.atmosphere = null;
        }
    }

    /**
     * Dispose of geometry and material
     * @param {Object} body - The body instance
     */
    static disposeGeometryAndMaterial(body) {
        // Dispose of geometry
        if (body.geometry && typeof body.geometry.dispose === 'function') {
            body.geometry.dispose();
        }

        // Dispose of material and its textures
        if (body.material && typeof body.material.dispose === 'function') {
            // Dispose of textures first
            if (body.material.map && body.material.map.dispose) {
                // Clean up canvas if it exists
                if (body.material.map.userData && body.material.map.userData.canvas) {
                    const canvas = body.material.map.userData.canvas;
                    const context = canvas.getContext('2d');
                    if (context) {
                        context.clearRect(0, 0, canvas.width, canvas.height);
                    }
                }
                body.material.map.dispose();
            }
            body.material.dispose();
        }
    }

    /**
     * Remove elements from scene
     * @param {Object} body - The body instance
     */
    static removeFromScene(body) {
        // Remove from scene
        if (body.group && body.group.parent) {
            body.group.parent.remove(body.group);
        }

        // Remove emitted light if it exists
        if (body.emittedLight && body.emittedLight.parent) {
            body.emittedLight.parent.remove(body.emittedLight);
        }
    }

    /**
     * Clear all object references
     * @param {Object} body - The body instance
     */
    static clearReferences(body) {
        body.geometry = null;
        body.material = null;
        body.mesh = null;
        body.lodMesh = null;
        body.lod = null;
        body.pinpointMesh = null;
        body.group = null;
        body.emittedLight = null;
        body.thisBody = null;
    }
}

export default ResourceManager;