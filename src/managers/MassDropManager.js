import * as THREE from 'three';
import SceneManager from './SceneManager.js';
import Body from '../model/Body.js';
import { collectBodiesFromHierarchy } from '../physics/NBodySystem.js';
import { MASS_DROP, SIMULATION } from '../constants.js';
import { log } from '../utils/Logger.js';

// Scratch objects reused by the pointer-to-world conversion
const _pointer = new THREE.Vector2();
const _raycaster = new THREE.Raycaster();
const _plane = new THREE.Plane();
const _viewDirection = new THREE.Vector3();
const _atRest = new THREE.Vector3();

// Scratch for the momentum bookkeeping
const _bodies = [];
const _momentum = new THREE.Vector3();
const _correction = new THREE.Vector3();

/**
 * Drops stellar masses into the running simulation and takes them back out again.
 *
 * These bodies exist only for the n-body integrator: they have no catalogue orbit, so Kepler mode
 * has nothing to solve for them and they are cleared when the simulation switches back to it.
 */
class MassDropManager {
    constructor() {
        this.dropped = [];
        this.totalDropped = 0;  // Never reset, so cleared names are never reused

        // Barycentre velocity of the untouched solar system, recorded before the first drop
        this.baselineDrift = new THREE.Vector3();
        this.baselineRecorded = false;

        log.init('MassDropManager', 'MassDropManager');
    }

    /**
     * Drop a mass at the point under the cursor
     * @param {number} clientX - Pointer x in client coordinates
     * @param {number} clientY - Pointer y in client coordinates
     * @returns {Object|null} The body that was created, or null if nothing was dropped
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

        // How fast the system as a whole is travelling before anything is added to it, kept so that
        // removing the masses later can put it back. Taken afresh for each batch, because Kepler
        // mode rewrites the planets' velocities while it is in charge.
        if (this.dropped.length === 0) {
            this.#barycentreVelocity(root, this.baselineDrift);
            this.baselineRecorded = true;
        }

        const position = this.#spawnPoint(clientX, clientY, new THREE.Vector3());
        const name = `Mass ${++this.totalDropped}`;

        // No a/e/i/omega/w: without a semi-major axis Body draws no orbit line, which is what we
        // want, since the path of a mass released from rest is a line into the Sun rather than the
        // ellipse an orbit line would imply. Its trail records where it actually goes.
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

        // Released from rest in the scene's frame - it is a drop, not a launch
        _atRest.set(0, 0, 0);
        body.setInitialPhysicsConditions(position, _atRest);

        // The root's children array is shared with the hierarchy node, so this one push is what
        // puts the body in front of both the integrator and the per-frame body update. The node's
        // orbit is left null so that Kepler position updates and orbit extraction pass it over.
        root.children.push({ body, orbit: null, children: [], data: bodyData });
        SceneManager.hierarchyManager.addBody(body, root.body.name);
        this.dropped.push(body);

        log.info('MassDropManager', `Dropped ${name} (${MASS_DROP.MASS} solar masses) at ` +
            `${position.x.toFixed(2)}, ${position.y.toFixed(2)}, ${position.z.toFixed(2)}`);

        return body;
    }

    /**
     * Remove every dropped mass and free its resources
     * @returns {number} How many masses were removed
     */
    clearAll() {
        if (this.dropped.length === 0) return 0;

        const root = SceneManager.orbitManager?.hierarchy;
        const removed = this.dropped.length;

        // Nothing may be left following a body that is about to be disposed
        const selected = SceneManager.hierarchyManager.getSelectedBody();
        if (selected && this.dropped.includes(selected) && root?.body) {
            SceneManager.onBodySelected(root.body);
        }

        this.dropped.forEach(body => {
            if (root?.children) {
                const index = root.children.findIndex(node => node.body === body);
                if (index !== -1) root.children.splice(index, 1);
            }
            SceneManager.hierarchyManager.removeBody(body.name);

            // Disposal takes the marker out of the scene's registries but not the orbit trail,
            // which was registered against the body rather than the trail itself
            SceneManager.unregisterOrbitTrail(body);
            body.dispose();
        });

        this.dropped.length = 0;
        if (root) this.#restoreDrift(root);

        log.info('MassDropManager', `Removed ${removed} dropped ${removed === 1 ? 'mass' : 'masses'}`);
        return removed;
    }

    /**
     * Take the solar system's motion back to what it was before anything was dropped into it.
     *
     * A mass falling towards the Sun pulls the Sun the other way, and momentum being conserved,
     * whatever the mass gained the rest of the system lost. Delete the mass and that lost momentum
     * has nowhere to go: the Sun sails off across the sky with nothing left to pull it back. So the
     * excess is taken back out, spread over every remaining body in proportion to nothing at all -
     * the same velocity comes off each, which is a change of reference frame and leaves every
     * orbit exactly as it was.
     *
     * Positions need no such treatment: this only runs on the way into Kepler mode, which puts the
     * root back at the origin and every other body where its catalogue orbit says it should be.
     * @private
     */
    #restoreDrift(root) {
        if (!this.baselineRecorded) return;

        this.#barycentreVelocity(root, _correction).sub(this.baselineDrift);
        if (_correction.lengthSq() === 0) return;

        _bodies.length = 0;
        collectBodiesFromHierarchy(root, _bodies);
        _bodies.forEach(body => {
            if (body.velocity) body.velocity.sub(_correction);
        });
        _bodies.length = 0;

        log.info('MassDropManager', `Took ${_correction.length().toPrecision(3)} of drift back out ` +
            `of the system after removing the dropped masses`);
    }

    /**
     * Mass-weighted mean velocity of every body in a hierarchy
     * @private
     */
    #barycentreVelocity(root, out) {
        _bodies.length = 0;
        collectBodiesFromHierarchy(root, _bodies);

        _momentum.set(0, 0, 0);
        let totalMass = 0;
        _bodies.forEach(body => {
            if (!body.velocity || typeof body.mass !== 'number') return;
            _momentum.addScaledVector(body.velocity, body.mass);
            totalMass += body.mass;
        });
        _bodies.length = 0;

        return totalMass > 0 ? out.copy(_momentum).divideScalar(totalMass) : out.set(0, 0, 0);
    }

    /**
     * Work out where in the scene a click landed.
     *
     * A click only fixes two of the three coordinates, so the third has to be chosen: the mass is
     * put on the plane through whatever the camera is orbiting, square to the view. Looking down
     * on the system from outside, which is how it is usually viewed, that plane is the ecliptic;
     * closer in it keeps the mass at the depth of whatever is being watched, where it can be seen
     * and where it will do something.
     * @private
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

        // The ray comes from the camera and the plane faces it, so a miss is not possible; the
        // fallback is only there so a degenerate camera cannot produce a body at NaN
        return _raycaster.ray.intersectPlane(_plane, out) ?? out.copy(target);
    }
}

const massDropManager = new MassDropManager();
export default massDropManager;
