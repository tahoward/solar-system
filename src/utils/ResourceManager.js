import SceneManager from '../managers/SceneManager.js';
import BodyRenderer from '../rendering/BodyRenderer.js';
import { log } from './Logger.js';

/**
 * Tears down every GPU and scene-graph resource owned by a celestial body.
 *
 * WebGL resources are not garbage collected, so each geometry, material and
 * texture has to be disposed explicitly or the driver leaks memory as bodies are
 * added and removed. The teardown runs in a fixed order: owned sub-objects first,
 * then the body's own geometry and material, then scene-graph removal, and
 * finally reference clearing so nothing keeps the disposed objects alive.
 *
 * All members are static; the class is used purely as a namespace.
 */
class ResourceManager {
    /**
     * Fully disposes a body and detaches it from the scene.
     *
     * After this returns the body's rendering fields are all `null` and it must
     * not be reused.
     *
     * @param {Body} body - Body to tear down; mutated.
     * @returns {void}
     */
    static dispose(body) {
        if (body.isStar) {
            SceneManager.unregisterStar(body.group);
            log.debug('ResourceManager', `Unregistered ${body.name} from bloom effects`);
        }

        if (body.isBlackHole) {
            SceneManager.unregisterBlackHole(body);
            log.debug('ResourceManager', `Unregistered ${body.name} from gravitational lensing`);
        }

        ResourceManager.disposeOrbitTrail(body);

        ResourceManager.disposeMarker(body);

        ResourceManager.disposeStarEffects(body);

        ResourceManager.disposeBlackHoleEffects(body);

        ResourceManager.disposeRenderingElements(body);

        ResourceManager.disposeGeometryAndMaterial(body);

        ResourceManager.removeFromScene(body);

        ResourceManager.clearReferences(body);
    }

    /**
     * Disposes the body's orbit trail, if it has one.
     *
     * @param {Body} body - Body whose `orbitTrail` is released and nulled.
     * @returns {void}
     */
    static disposeOrbitTrail(body) {
        if (body.orbitTrail && typeof body.orbitTrail.dispose === 'function') {
            log.info('ResourceManager', `Disposing orbit trail for ${body.name}`);
            body.orbitTrail.dispose();
            body.orbitTrail = null;
        }
    }

    /**
     * Disposes the body's screen-space marker, if it has one.
     *
     * A marker without a `dispose` method is left in place and reported, since
     * that indicates a construction bug rather than something safe to drop.
     *
     * @param {Body} body - Body whose `marker` is released and nulled.
     * @returns {void}
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
     * Disposes the star-only visual effects: billboard glow, rays, flares and glare.
     *
     * Safe to call for non-stars, which simply have none of these.
     *
     * @param {Body} body - Body whose effect objects are released and nulled.
     * @returns {void}
     */
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

    /**
     * Disposes the black-hole-only visual effects: shadow occluder and solid, accretion disc,
     * photon ring.
     *
     * Safe to call for anything that is not a black hole, which simply has none of these. The
     * lensing needs nothing released — it owns no geometry, only a slot in a shared pass, and
     * the unregistration in {@link ResourceManager.dispose} is all there is to undo.
     *
     * The occluder and the solid are bare meshes rather than effect objects with their own
     * `dispose`, so they are unparented and released here.
     *
     * @param {Body} body - Body whose effect objects are released and nulled.
     * @returns {void}
     */
    static disposeBlackHoleEffects(body) {
        if (body.shadowOccluder) {
            log.info('ResourceManager', `Disposing shadow occluder for ${body.name}`);

            if (body.shadowOccluder.geometry) body.shadowOccluder.geometry.dispose();
            if (body.shadowOccluder.material) body.shadowOccluder.material.dispose();
            if (body.shadowOccluder.parent) {
                body.shadowOccluder.parent.remove(body.shadowOccluder);
            }

            body.shadowOccluder = null;
        }

        if (body.shadowSolid) {
            log.info('ResourceManager', `Disposing shadow solid for ${body.name}`);

            if (body.shadowSolid.geometry) body.shadowSolid.geometry.dispose();
            if (body.shadowSolid.material) body.shadowSolid.material.dispose();
            if (body.shadowSolid.parent) {
                body.shadowSolid.parent.remove(body.shadowSolid);
            }

            body.shadowSolid = null;
        }

        if (body.accretionDisk && typeof body.accretionDisk.dispose === 'function') {
            log.info('ResourceManager', `Disposing accretion disc for ${body.name}`);
            body.accretionDisk.dispose();
            body.accretionDisk = null;
        }

        if (body.photonRing && typeof body.photonRing.dispose === 'function') {
            log.info('ResourceManager', `Disposing photon ring for ${body.name}`);
            body.photonRing.dispose();
            body.photonRing = null;
        }

        body.blackHoleLens = null;
    }

    /**
     * Disposes the optional surface detail layers: rings, clouds and atmosphere.
     *
     * @param {Body} body - Body whose detail layers are released.
     * @returns {void}
     */
    static disposeRenderingElements(body) {
        ResourceManager.disposeRings(body);

        ResourceManager.disposeClouds(body);

        ResourceManager.disposeAtmosphere(body);
    }

    /**
     * Disposes the ring mesh's geometry and material and unparents it.
     *
     * @param {Body} body - Body whose `rings` mesh is released and nulled.
     * @returns {void}
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
     * Disposes the cloud layer, including its per-LOD geometries and texture map.
     *
     * @param {Body} body - Body whose `clouds` mesh is released and nulled.
     * @returns {void}
     */
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

    /**
     * Disposes the atmosphere shell, including its per-LOD geometries.
     *
     * @param {Body} body - Body whose `atmosphere` mesh is released and nulled.
     * @returns {void}
     */
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

    /**
     * Disposes the body's own geometry, material and surface texture.
     *
     * Canvas-backed textures (procedurally generated surfaces) have their
     * drawing context cleared first, which releases the backing bitmap that
     * disposing the texture alone would leave behind.
     *
     * @param {Body} body - Body whose primary geometry and material are released.
     * @returns {void}
     */
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

    /**
     * Detaches the body's group and any emitted light from their parents.
     *
     * @param {Body} body - Body to unparent.
     * @returns {void}
     */
    static removeFromScene(body) {
        if (body.group && body.group.parent) {
            body.group.parent.remove(body.group);
        }

        if (body.emittedLight && body.emittedLight.parent) {
            body.emittedLight.parent.remove(body.emittedLight);
        }
    }

    /**
     * Nulls the body's rendering references so disposed objects can be collected.
     *
     * @param {Body} body - Body to clear; mutated.
     * @returns {void}
     */
    static clearReferences(body) {
        body.geometry = null;
        body.material = null;
        body.mesh = null;
        body.pinpointMesh = null;
        body.group = null;
        body.emittedLight = null;
    }
}

export default ResourceManager;
