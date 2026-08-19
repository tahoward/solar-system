import * as THREE from 'three';
import SceneManager from './SceneManager.js';
import { collectBodiesFromHierarchy } from '../physics/NBodySystem.js';
import { SIMULATION } from '../constants.js';
import { log } from '../utils/Logger.js';

const _bodies = [];

const _offset = new THREE.Vector3();
const _relative = new THREE.Vector3();

/**
 * Merges bodies that run into each other and removes bodies from the hierarchy.
 *
 * Under n-body physics bodies can genuinely collide — a dropped mass may hit a
 * planet, or a perturbed moon its primary. Collisions are resolved as perfectly
 * inelastic mergers, conserving mass and momentum: the heavier body survives and
 * absorbs the other.
 *
 * This also owns body removal in general, because taking a body out of the
 * hierarchy is the awkward part: its children have to be adopted, the selection
 * and camera moved if they were following it, and its resources released.
 *
 * Exported as a singleton, since there is one hierarchy.
 */
class CollisionManager {
    /**
     * Creates the manager with no removal listeners attached.
     */
    constructor() {
        this.removalListeners = new Set();

        log.init('CollisionManager', 'CollisionManager');
    }

    /**
     * Registers a callback for when a body is removed.
     *
     * Lets the UI and camera react to a body disappearing without this manager
     * having to know about either.
     *
     * @param {function(Body|null, Body): void} listener - Called with the body that
     *   took the removed body's place, then the body removed.
     * @returns {void}
     */
    onBodyRemoved(listener) {
        if (typeof listener === 'function') this.removalListeners.add(listener);
    }

    /**
     * Merges every pair of overlapping bodies, deepest overlap first.
     *
     * Resolving one at a time and rescanning is deliberate: a merge moves the
     * survivor and changes its mass, which can create or clear other overlaps, so
     * a single pass over a precomputed list would act on stale positions. The loop
     * is bounded by the body count so a pathological case cannot hang the frame.
     *
     * @returns {number} Number of merges performed; 0 under Kepler physics, where
     *   bodies pass through each other.
     */
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

    /**
     * Finds the most deeply overlapping pair of bodies.
     *
     * The deepest overlap is taken first because it is the least ambiguous
     * collision; resolving it may also separate shallower pairs.
     *
     * The heavier body survives, except that the root body always survives — the
     * Sun cannot be swallowed by a planet without leaving the hierarchy rootless.
     *
     * @private
     * @param {Body[]} bodies - Bodies to test, pairwise.
     * @param {Body} rootBody - Hierarchy root, which is never the victim.
     * @returns {{survivor: Body, victim: Body}|null} The pair, or `null` if nothing
     *   overlaps.
     */
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

    /**
     * Combines two bodies into one, conserving mass and momentum.
     *
     * The survivor moves to the pair's centre of mass and takes on their combined
     * momentum, so the merge does not inject energy into the system. Radius is left
     * alone: growing it could immediately create new overlaps, and the visual
     * difference would be negligible anyway.
     *
     * Any dropped mass the victim was carrying is passed along, so
     * {@link MassDropManager#clearAll} can still hand it back afterwards.
     *
     * @private
     * @param {Body} survivor - Body that absorbs the other.
     * @param {Body} victim - Body that is removed.
     * @returns {void}
     */
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

    /**
     * Takes a body out of the hierarchy and releases everything it owned.
     *
     * Several things have to be kept consistent. The body's children are adopted —
     * by the replacement where possible, otherwise by the body's parent — so a
     * subtree is not lost along with its root; their parent references and orbits are
     * repointed accordingly. If the camera was following the removed body it is moved
     * to whatever replaced it, rather than being left tracking a deleted object.
     * Finally its orbit, trail and own resources are disposed, and listeners notified.
     *
     * The root body cannot be removed, since the hierarchy would have no root.
     *
     * @param {Body} body - Body to remove.
     * @param {Body|null} [replacement=null] - Body taking its place, such as the
     *   survivor of a merge; defaults to its parent.
     * @returns {boolean} `true` if the body was removed; `false` if it is not in the
     *   hierarchy or is the root.
     */
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

    /**
     * Searches a hierarchy for the node holding a body.
     *
     * The parent node is returned alongside it, since removing a node requires
     * access to the list it sits in.
     *
     * @private
     * @param {Object} node - Node to search from.
     * @param {Body} body - Body to find.
     * @param {Object|null} parent - Parent of `node`; `null` at the root.
     * @returns {{node: Object, parent: Object|null}|null} The node and its parent, or
     *   `null` if the body is not in this subtree.
     */
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
