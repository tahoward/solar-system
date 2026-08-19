import * as THREE from 'three';
import SceneManager from './SceneManager.js';
import { collectBodiesFromHierarchy } from '../physics/NBodySystem.js';
import { SIMULATION } from '../constants.js';
import { log } from '../utils/Logger.js';

// Bodies to test, gathered afresh for every pass rather than held between them: a merge takes one
// of them out of the scene, and the array must not be left holding it
const _bodies = [];

// Scratch for the merge arithmetic
const _offset = new THREE.Vector3();
const _relative = new THREE.Vector3();

/**
 * Merges bodies that run into one another.
 *
 * Anything in the system can collide with anything else - a dropped mass with the Sun, a moon thrown
 * off its planet with the next planet in, two planets whose orbits have been wrecked by a passing
 * star - and whatever the pair, the answer is the same: one body carrying the mass and the momentum
 * of both.
 *
 * Beyond looking right, this is what keeps the simulation usable. Gravity between two overlapping
 * bodies is fierce enough to demand steps millions of times shorter than a solar system needs, so a
 * pair left to sink through one another holds everything else at a standstill for as long as the
 * pass takes - and a pair that is bound never finishes passing.
 */
class CollisionManager {
    constructor() {
        // Called with (survivor, victim) whenever a body leaves the scene, for the things that keep
        // lists of bodies of their own and cannot be walked to from the hierarchy
        this.removalListeners = new Set();

        log.init('CollisionManager', 'CollisionManager');
    }

    /**
     * Ask to be told when a body is taken out of the simulation
     * @param {Function} listener - Called with (survivor, victim); survivor may be null
     */
    onBodyRemoved(listener) {
        if (typeof listener === 'function') this.removalListeners.add(listener);
    }

    /**
     * Merge every pair of bodies that is touching.
     *
     * Only the integrator can bring two bodies together - Kepler mode solves each orbit from the
     * catalogue, where nothing ever collides - so this does nothing in Kepler mode.
     *
     * The deepest overlap is settled first and then the whole system is looked at again, because a
     * merge moves the survivor and changes what it is touching: a body caught between two others
     * joins whichever it has run further into, and may well be touching the other afterwards.
     *
     * @returns {number} How many merges happened
     */
    resolveCollisions() {
        if (!SIMULATION.USE_N_BODY_PHYSICS) return 0;

        const root = SceneManager.orbitManager?.hierarchy;
        if (!root?.body) return 0;

        let merges = 0;

        // Every pass takes a body out of the system, so there can be no more of them than there are
        // bodies - which is what stops this, rather than trusting the overlap test to run out
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
     * The touching pair that has run furthest into one another, if any.
     *
     * Overlap is measured against the two radii, so bodies merge as their surfaces meet rather than
     * at their centres. The survivor is the heavier of the two, which is the one whose name and
     * appearance the merged body would honestly carry - except where the root body is involved,
     * which survives whatever it hits, since it is what holds the system and everything else is
     * placed and drawn relative to it.
     *
     * @param {Array} bodies - Every body in the system
     * @param {Object} rootBody - The body at the top of the hierarchy
     * @returns {{survivor: Object, victim: Object}|null} The pair to merge
     * @private
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
                // The collected order runs from the root outwards, so first is the one nearer the
                // top of the hierarchy and an evenly matched pair merges into its parent
                const rootIsSecond = second === rootBody;
                const keepFirst = rootIsSecond ? false : first === rootBody || first.mass >= second.mass;
                survivor = keepFirst ? first : second;
                victim = keepFirst ? second : first;
            }
        }

        return survivor ? { survivor, victim } : null;
    }

    /**
     * Roll one body into another.
     *
     * Perfectly inelastic, which is to say the pair carries on as their centre of mass was already
     * going: the survivor is moved to that point and given the momentum of both, so nothing about
     * the system's motion as a whole changes at the moment of the merge. The radius is left alone -
     * a Sun that has swallowed a body half its size grows by four percent, which is not worth
     * rebuilding a sphere for - but the mass is not, and every orbit around it will answer for it.
     *
     * @param {Object} survivor - The body that carries on
     * @param {Object} victim - The body that is absorbed into it
     * @private
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

        // Mass dropped into the system is followed through the merges so that switching to Kepler
        // orbits can hand back everything the catalogue does not describe - see
        // MassDropManager#clearAll
        if (victim.droppedMass > 0) {
            survivor.droppedMass = (survivor.droppedMass || 0) + victim.droppedMass;
        }

        log.info('CollisionManager', `${survivor.name} swallowed ${victim.name} and is now ` +
            `${total.toPrecision(3)} solar masses`);

        this.removeBody(victim, survivor);
    }

    /**
     * Take a body out of the simulation and free what it holds.
     *
     * Anything that was going round it is handed on rather than removed with it, both in the
     * hierarchy and in the bodies' own idea of what they orbit: a moon whose planet has been
     * swallowed is still a body in the system, now going round whatever swallowed it - which is
     * sitting where its planet was - on whatever path the collision left it on.
     *
     * @param {Object} body - The body to remove
     * @param {Object|null} replacement - What to follow and select instead, if this body was being
     *   watched; defaults to whatever the body was going round
     * @returns {boolean} True if the body was removed
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

        // Nothing may be left following a body that is about to be disposed
        if (follow && SceneManager.hierarchyManager.getSelectedBody() === body) {
            SceneManager.onBodySelected(follow);
            SceneManager.setTargetSmooth(follow.group);
        }

        // Whatever swallowed the body has taken its place, so it takes on what was going round it.
        // A survivor from inside the body's own family - which needs a moon heavier than its planet -
        // is no use as a foster parent, since its node goes out of the tree with the body's, so in
        // that case they go up to the body's parent instead.
        let adopter = found.parent;
        if (follow && follow !== parentBody && !this.#findNode(found.node, follow, null)) {
            adopter = this.#findNode(root, follow, null)?.node || found.parent;
        }
        const adopterBody = adopter.body;

        // The orphans are adopted before the body goes, since disposing a body disposes everything
        // still hanging off it
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

        // A node's children array is the body's own, so emptying it does for both; the second
        // clear is there in case one is ever built with an array of its own
        found.node.children.length = 0;
        if (body.children && body.children !== found.node.children) body.children.length = 0;

        const index = found.parent.children.indexOf(found.node);
        if (index !== -1) found.parent.children.splice(index, 1);
        SceneManager.hierarchyManager.removeBody(body.name);

        // The name-keyed hierarchy hands orphans to the grandparent of its own accord, so any that
        // have gone to a foster parent elsewhere are moved on afterwards, which also brings orbit
        // lines and markers into line with the new selection
        if (adopterBody && adopterBody !== parentBody) {
            for (const childBody of adopted) SceneManager.reparentBody(childBody, adopterBody);
        }

        // The orbit is registered with the scene rather than reached through the body, so it would
        // otherwise go on being drawn and solved from a body that has been disposed. A body with no
        // catalogue orbit carries a stand-in with nothing to dispose of.
        if (typeof body.orbit?.dispose === 'function') body.orbit.dispose();

        // Disposal takes the marker out of the scene's registries but not the orbit trail, which was
        // registered against the body rather than the trail itself
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
     * Find a body's hierarchy node and the node it hangs off, anywhere in the tree
     * @param {Object} node - Node to search from
     * @param {Object} body - Body to look for
     * @param {Object|null} parent - The node being searched from within
     * @returns {{node: Object, parent: Object|null}|null} The node and its parent
     * @private
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
