import * as THREE from 'three';
import SceneManager from './SceneManager.js';
import { collectBodiesFromHierarchy } from '../physics/NBodySystem.js';
import { SIMULATION } from '../constants.js';
import { log } from '../utils/Logger.js';

const _bodies = [];

const _offset = new THREE.Vector3();
const _relative = new THREE.Vector3();

class CollisionManager {
    constructor() {
        this.removalListeners = new Set();

        log.init('CollisionManager', 'CollisionManager');
    }

    onBodyRemoved(listener) {
        if (typeof listener === 'function') this.removalListeners.add(listener);
    }

    resolveCollisions() {
        if (!SIMULATION.USE_N_BODY_PHYSICS) return 0;

        const root = SceneManager.orbitManager?.hierarchy;
        if (!root?.body) return 0;

        let merges = 0;

        for (let pass = 0; ; pass++) {
            _bodies.length = 0;
            collectBodiesFromHierarchy(root, _bodies);
            if (pass >= _bodies.length) break;

            const pair = this.#deepestOverlap(_bodies, root.body);
            if (!pair) break;

            this.#merge(pair.survivor, pair.victim);
            merges++;
        }

        _bodies.length = 0;
        return merges;
    }

    #deepestOverlap(bodies, rootBody) {
        let survivor = null;
        let victim = null;
        let deepest = 0;

        for (let i = 0; i < bodies.length; i++) {
            const first = bodies[i];
            if (!first.position || !(first.mass > 0)) continue;

            for (let j = i + 1; j < bodies.length; j++) {
                const second = bodies[j];
                if (!second.position || !(second.mass > 0)) continue;

                const touching = (first.radius || 0) + (second.radius || 0);
                const overlap = touching - first.position.distanceTo(second.position);
                if (!(overlap > 0) || overlap < deepest) continue;

                deepest = overlap;
                const rootIsSecond = second === rootBody;
                const keepFirst = rootIsSecond ? false : first === rootBody || first.mass >= second.mass;
                survivor = keepFirst ? first : second;
                victim = keepFirst ? second : first;
            }
        }

        return survivor ? { survivor, victim } : null;
    }

    #merge(survivor, victim) {
        const total = survivor.mass + victim.mass;

        const share = victim.mass / total;
        _offset.subVectors(victim.position, survivor.position);
        _relative.subVectors(victim.velocity, survivor.velocity);
        survivor.position.addScaledVector(_offset, share);
        survivor.velocity.addScaledVector(_relative, share);
        survivor.mass = total;
        survivor.updatePosition(survivor.position);

        if (victim.droppedMass > 0) {
            survivor.droppedMass = (survivor.droppedMass || 0) + victim.droppedMass;
        }

        log.info('CollisionManager', `${survivor.name} swallowed ${victim.name} and is now ` +
            `${total.toPrecision(3)} solar masses`);

        this.removeBody(victim, survivor);
    }

    removeBody(body, replacement = null) {
        const root = SceneManager.orbitManager?.hierarchy;
        const found = root ? this.#findNode(root, body, null) : null;
        if (!found) {
            log.warn('CollisionManager', `Cannot remove ${body?.name || 'a body'}: not in the hierarchy`);
            return false;
        }

        if (!found.parent) {
            log.error('CollisionManager', `Refusing to remove root body ${body.name}`);
            return false;
        }

        const parentBody = found.parent.body;
        const follow = replacement || parentBody;

        if (follow && SceneManager.hierarchyManager.getSelectedBody() === body) {
            SceneManager.onBodySelected(follow);
            SceneManager.setTargetSmooth(follow.group);
        }

        let adopter = found.parent;
        if (follow && follow !== parentBody && !this.#findNode(found.node, follow, null)) {
            adopter = this.#findNode(root, follow, null)?.node || found.parent;
        }
        const adopterBody = adopter.body;

        const adopted = [];
        for (const child of found.node.children) {
            const childBody = child.body;
            if (childBody) {
                childBody.parentBody = adopterBody;
                if (childBody.orbit) childBody.orbit.parentBody = adopterBody;
                adopted.push(childBody);
            }
            adopter.children.push(child);
        }

        found.node.children.length = 0;
        if (body.children && body.children !== found.node.children) body.children.length = 0;

        const index = found.parent.children.indexOf(found.node);
        if (index !== -1) found.parent.children.splice(index, 1);
        SceneManager.hierarchyManager.removeBody(body.name);

        if (adopterBody && adopterBody !== parentBody) {
            for (const childBody of adopted) SceneManager.reparentBody(childBody, adopterBody);
        }

        if (typeof body.orbit?.dispose === 'function') body.orbit.dispose();

        SceneManager.unregisterOrbitTrail(body);
        body.dispose();

        this.removalListeners.forEach(listener => {
            try {
                listener(follow, body);
            } catch (error) {
                log.error('CollisionManager', 'A body removal listener threw', error);
            }
        });

        return true;
    }

    #findNode(node, body, parent) {
        if (node.body === body) return { node, parent };

        const children = node.children;
        if (children) {
            for (let i = 0; i < children.length; i++) {
                const found = this.#findNode(children[i], body, node);
                if (found) return found;
            }
        }

        return null;
    }
}

const collisionManager = new CollisionManager();
export default collisionManager;
