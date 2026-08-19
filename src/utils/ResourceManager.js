import SceneManager from '../managers/SceneManager.js';
import BodyRenderer from '../rendering/BodyRenderer.js';
import logger, { log } from './Logger.js';

class ResourceManager {
    static dispose(body) {
        if (body.isStar) {
            SceneManager.unregisterStar(body.group);
            log.debug('ResourceManager', `Unregistered ${body.name} from bloom effects`);
        }

        ResourceManager.disposeOrbitTrail(body);

        ResourceManager.disposeMarker(body);

        ResourceManager.disposeStarEffects(body);

        ResourceManager.disposeRenderingElements(body);

        ResourceManager.disposeGeometryAndMaterial(body);

        ResourceManager.removeFromScene(body);

        ResourceManager.clearReferences(body);
    }

    static disposeOrbitTrail(body) {
        if (body.orbitTrail && typeof body.orbitTrail.dispose === 'function') {
            log.info('ResourceManager', `Disposing orbit trail for ${body.name}`);
            body.orbitTrail.dispose();
            body.orbitTrail = null;
        }
    }

    static disposeMarker(body) {
        if (body.marker && typeof body.marker.dispose === 'function') {
            log.info('ResourceManager', `Disposing marker for ${body.name}`);
            body.marker.dispose();
            body.marker = null;
        } else if (body.marker) {
            log.warn('ResourceManager', `Marker for ${body.name} has no dispose method`);
        }
    }

    static disposeStarEffects(body) {
        if (body.billboard && typeof body.billboard.dispose === 'function') {
            log.info('ResourceManager', `Disposing billboard glow effect for ${body.name}`);
            body.billboard.dispose();
            body.billboard = null;
        }

        if (body.sunRays && typeof body.sunRays.dispose === 'function') {
            log.info('ResourceManager', `Disposing sun rays effect for ${body.name}`);
            body.sunRays.dispose();
            body.sunRays = null;
        }

        if (body.sunFlares && typeof body.sunFlares.dispose === 'function') {
            log.info('ResourceManager', `Disposing sun flares effect for ${body.name}`);
            body.sunFlares.dispose();
            body.sunFlares = null;
        }

        if (body.sunGlare && typeof body.sunGlare.dispose === 'function') {
            log.info('ResourceManager', `Disposing sun glare effect for ${body.name}`);
            body.sunGlare.dispose();
            body.sunGlare = null;
        }
    }

    static disposeRenderingElements(body) {
        ResourceManager.disposeRings(body);

        ResourceManager.disposeClouds(body);

        ResourceManager.disposeAtmosphere(body);
    }

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

    static disposeClouds(body) {
        if (body.clouds) {
            BodyRenderer.disposeDetailGeometries(body.clouds);
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

    static disposeAtmosphere(body) {
        if (body.atmosphere) {
            BodyRenderer.disposeDetailGeometries(body.atmosphere);
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

    static disposeGeometryAndMaterial(body) {
        BodyRenderer.disposeDetailGeometries(body.mesh);

        if (body.geometry && typeof body.geometry.dispose === 'function') {
            body.geometry.dispose();
        }

        if (body.material && typeof body.material.dispose === 'function') {
            if (body.material.map && body.material.map.dispose) {
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

    static removeFromScene(body) {
        if (body.group && body.group.parent) {
            body.group.parent.remove(body.group);
        }

        if (body.emittedLight && body.emittedLight.parent) {
            body.emittedLight.parent.remove(body.emittedLight);
        }
    }

    static clearReferences(body) {
        body.geometry = null;
        body.material = null;
        body.mesh = null;
        body.pinpointMesh = null;
        body.group = null;
        body.emittedLight = null;
        body.thisBody = null;
    }
}

export default ResourceManager;