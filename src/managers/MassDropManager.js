import * as THREE from 'three';
import SceneManager from './SceneManager.js';
import collisionManager from './CollisionManager.js';
import Body from '../model/Body.js';
import { collectBodiesFromHierarchy } from '../physics/NBodySystem.js';
import { cancelSystemDrift } from '../physics/barycentre.js';
import { MASS_DROP, SIMULATION } from '../constants.js';
import { log } from '../utils/Logger.js';

const _pointer = new THREE.Vector2();
const _raycaster = new THREE.Raycaster();
const _plane = new THREE.Plane();
const _viewDirection = new THREE.Vector3();
const _atRest = new THREE.Vector3();
const _bodies = [];

/**
 * Drops new masses into the simulation where the user clicks.
 *
 * Purely a toy for perturbing the system: a dropped mass starts at rest, falls
 * under gravity and disturbs everything it passes. It only works under n-body
 * physics, since analytic Kepler orbits cannot respond to a new body at all.
 *
 * Exported as a singleton, since there is one pointer and one simulation.
 */
class MassDropManager {
    /**
     * Creates the manager with no masses dropped yet.
     */
    constructor() {
        this.totalDropped = 0;

        log.init('MassDropManager', 'MassDropManager');
    }

    /**
     * Creates a body at rest under the given screen position.
     *
     * The mass is added as a child of the hierarchy root — the Sun — and registered
     * so the integrator, collision handling and UI all pick it up. Starting at rest
     * is what makes the result interesting: the mass falls inwards rather than
     * settling into an orbit.
     *
     * @param {number} clientX - Pointer x in client coordinates.
     * @param {number} clientY - Pointer y in client coordinates.
     * @returns {Body|null} The new body, or `null` if n-body physics is off or the
     *   hierarchy does not exist yet.
     */
    dropAt(clientX, clientY) {
        if (!SIMULATION.USE_N_BODY_PHYSICS) {
            log.debug('MassDropManager', 'Ignoring drop: Kepler orbits cannot respond to a new mass');
            return null;
        }

        const root = SceneManager.orbitManager?.hierarchy;
        if (!root?.body) {
            log.warn('MassDropManager', 'Cannot drop a mass before the hierarchy exists');
            return null;
        }

        const position = this.#spawnPoint(clientX, clientY, new THREE.Vector3());
        const name = `Mass ${++this.totalDropped}`;

        const bodyData = {
            name,
            color: MASS_DROP.COLOR,
            markerColor: MASS_DROP.MARKER_COLOR,
            radiusScale: MASS_DROP.RADIUS_SCALE,
            mass: MASS_DROP.MASS,
            rotationPeriod: MASS_DROP.ROTATION_PERIOD,
            axialTilt: 0,
            parent: root.body.name
        };

        const body = new Body(bodyData, root.body);

        body.isDroppedMass = true;
        body.droppedMass = MASS_DROP.MASS;

        _atRest.set(0, 0, 0);
        body.setInitialPhysicsConditions(position, _atRest);

        root.children.push({ body, orbit: null, children: [], data: bodyData });
        SceneManager.hierarchyManager.addBody(body, root.body.name);

        log.info('MassDropManager', `Dropped ${name} (${MASS_DROP.MASS} solar masses) at ` +
            `${position.x.toFixed(2)}, ${position.y.toFixed(2)}, ${position.z.toFixed(2)}`);

        return body;
    }

    /**
     * Undoes every mass drop, including those already absorbed.
     *
     * Dropped masses that collided were merged into whatever swallowed them, so
     * simply deleting the survivors would leave the planets permanently heavier.
     * The absorbed mass is therefore subtracted back off its host.
     *
     * Removing mass leaves the system with net momentum, which would slowly carry
     * everything off-screen, so the drift is cancelled afterwards.
     *
     * @returns {number} Number of surviving dropped masses removed; absorbed mass
     *   handed back is not counted.
     */
    clearAll() {
        const root = SceneManager.orbitManager?.hierarchy;
        if (!root?.body) return 0;

        _bodies.length = 0;
        collectBodiesFromHierarchy(root, _bodies);

        let removed = 0;
        let handedBack = 0;
        for (const body of _bodies) {
            if (body.isDroppedMass) {
                if (collisionManager.removeBody(body, root.body)) removed++;
            } else if (body.droppedMass > 0) {
                body.mass -= body.droppedMass;
                body.droppedMass = 0;
                handedBack++;
            }
        }
        _bodies.length = 0;

        if (removed === 0 && handedBack === 0) return 0;

        const drift = cancelSystemDrift(root.body);
        if (drift > 0) {
            log.info('MassDropManager', `Took ${drift.toPrecision(3)} of drift back out of the ` +
                `system after removing the dropped masses`);
        }

        log.info('MassDropManager', `Removed ${removed} dropped ${removed === 1 ? 'mass' : 'masses'} ` +
            `and handed back what ${handedBack} ${handedBack === 1 ? 'body had' : 'bodies had'} swallowed`);
        return removed;
    }

    /**
     * Projects a screen position into the scene.
     *
     * A click is a ray, not a point, so a plane is needed to pin down a depth. The
     * plane chosen faces the camera and passes through the controls' target, which
     * puts the new mass at the depth the user is currently looking at.
     *
     * @private
     * @param {number} clientX - Pointer x in client coordinates.
     * @param {number} clientY - Pointer y in client coordinates.
     * @param {THREE.Vector3} out - Vector to write into; mutated and returned.
     * @returns {THREE.Vector3} The `out` vector — the controls' target if the ray
     *   somehow misses the plane.
     */
    #spawnPoint(clientX, clientY, out) {
        const camera = SceneManager.camera;
        const rect = SceneManager.renderer.domElement.getBoundingClientRect();

        _pointer.set(
            ((clientX - rect.left) / rect.width) * 2 - 1,
            -((clientY - rect.top) / rect.height) * 2 + 1
        );
        _raycaster.setFromCamera(_pointer, camera);

        const target = SceneManager.controls.target;
        _plane.setFromNormalAndCoplanarPoint(camera.getWorldDirection(_viewDirection), target);

        return _raycaster.ray.intersectPlane(_plane, out) ?? out.copy(target);
    }
}

const massDropManager = new MassDropManager();
export default massDropManager;
