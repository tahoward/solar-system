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

class MassDropManager {
    constructor() {
        this.totalDropped = 0;

        log.init('MassDropManager', 'MassDropManager');
    }

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
