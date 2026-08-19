import * as THREE from 'three';
import clockManager from './ClockManager.js';
import { updateHierarchyPositions } from '../physics/kepler.js';
import { updateHierarchyNBodyPhysics, initializeHierarchyPhysics } from '../physics/NBodySystem.js';
import { SIMULATION } from '../constants.js';
import { log } from '../utils/Logger.js';

/**
 * Drives the simulation's motion and keeps a registry of orbit lines.
 *
 * Two motion models are supported and chosen by `SIMULATION.USE_N_BODY_PHYSICS`:
 * true n-body integration, where bodies pull on each other and orbits evolve, or
 * analytic Kepler propagation, where each body follows a fixed ellipse. This is
 * the single place that decision is made, so the rest of the codebase can call
 * {@link OrbitManager#updateBodyPositions} without caring which is active.
 *
 * The registry of {@link Orbit} instances exists so LOD updates can be applied to
 * every orbit line each frame.
 */
export class OrbitManager {
    /**
     * Creates an empty orbit registry with no hierarchy attached.
     *
     * @param {HierarchyManager} hierarchyManager - Hierarchy manager, retained for
     *   callers that need to resolve relationships.
     */
    constructor(hierarchyManager) {
        this.hierarchyManager = hierarchyManager;
        this.orbits = new Set();
        this.hierarchy = null;

        log.init('OrbitManager', 'OrbitManager');
    }

    /**
     * Attaches the hierarchy whose bodies are to be moved.
     *
     * This must be set before physics can be initialised or positions updated.
     *
     * @param {Object} hierarchy - Root hierarchy node.
     * @returns {void}
     */
    setHierarchy(hierarchy) {
        this.hierarchy = hierarchy;
        log.info('OrbitManager', 'Hierarchy set for position updates');
    }

    /**
     * Establishes starting positions and velocities for the whole hierarchy.
     *
     * Under n-body physics this is critical: the integrator has no notion of
     * orbital elements, so each body must be given a state vector that reproduces
     * its intended orbit. Under Kepler propagation the state is decorative, since
     * positions are computed from the elements directly.
     *
     * @param {number} sceneScale - Scene scale factor.
     * @returns {void}
     */
    initializePhysics(sceneScale) {
        if (!this.hierarchy) {
            log.warn('OrbitManager', 'No hierarchy set, cannot initialize physics');
            return;
        }

        if (SIMULATION.USE_N_BODY_PHYSICS) {
            initializeHierarchyPhysics(this.hierarchy, sceneScale);
            log.info('OrbitManager', 'Initialized n-body physics for hierarchy');
        } else {
            this.initializeKeplerPhysics(this.hierarchy, sceneScale);
            log.info('OrbitManager', 'Initialized Kepler physics conditions for hierarchy');
        }
    }

    /**
     * Adds an orbit line to the registry.
     *
     * @param {Orbit|BarycentrePath} orbit - Orbit to track.
     * @returns {void}
     */
    registerOrbit(orbit) {
        if (!orbit) {
            log.warn('OrbitManager', 'Cannot register null or undefined orbit');
            return;
        }

        this.orbits.add(orbit);
    }

    /**
     * Removes an orbit line from the registry.
     *
     * @param {Orbit|BarycentrePath} orbit - Orbit to stop tracking.
     * @returns {void}
     */
    unregisterOrbit(orbit) {
        if (!orbit) {
            log.warn('OrbitManager', 'Cannot unregister null or undefined orbit');
            return;
        }

        const wasRemoved = this.orbits.delete(orbit);
        if (wasRemoved) {
            log.debug('OrbitManager', `Unregistered orbit for ${orbit.body?.name || 'unknown'} (total: ${this.orbits.size})`);
        } else {
            log.warn('OrbitManager', 'Attempted to unregister orbit that was not registered');
        }
    }

    /**
     * Empties the registry without disposing the orbits.
     *
     * @returns {void}
     */
    clearAllOrbits() {
        const count = this.orbits.size;
        this.orbits.clear();
        log.info('OrbitManager', `Cleared all orbit registrations (${count} orbits removed)`);
    }

    /**
     * Advances every body's position by one frame.
     *
     * Kepler propagation is evaluated at an absolute timestamp and so can run at any
     * clock speed; the speed limit is therefore lifted. The n-body integrator, by
     * contrast, has a finite step budget and imposes its own limit through
     * {@link ClockManager}.
     *
     * @param {number} timestamp - Simulation time, used by Kepler propagation.
     * @param {number} sceneScale - Scene scale factor.
     * @returns {void}
     */
    updateBodyPositions(timestamp, sceneScale) {
        if (!this.hierarchy) {
            log.warn('OrbitManager', 'No hierarchy set, cannot update positions');
            return;
        }

        if (SIMULATION.USE_N_BODY_PHYSICS) {
            updateHierarchyNBodyPhysics(this.hierarchy);
        } else {
            clockManager.setPhysicsSpeedLimit(Infinity);

            updateHierarchyPositions(this.hierarchy, timestamp, sceneScale);
        }
    }

    /**
     * Zeroes every body's physics state for Kepler mode.
     *
     * Positions come from the orbital elements each frame, so the state vectors
     * only need to be well defined rather than correct — leaving them uninitialised
     * would give bodies stale velocities if physics were switched on later.
     *
     * @param {Object} hierarchy - Hierarchy node to descend from.
     * @param {number} sceneScale - Scene scale factor, passed down through recursion.
     * @returns {void}
     */
    initializeKeplerPhysics(hierarchy, sceneScale) {
        if (!hierarchy) return;

        if (hierarchy.body && hierarchy.body.setInitialPhysicsConditions) {
            hierarchy.body.setInitialPhysicsConditions(
                new THREE.Vector3(0, 0, 0),
                new THREE.Vector3(0, 0, 0)
            );
        }

        if (hierarchy.children && hierarchy.children.length > 0) {
            hierarchy.children.forEach(child => {
                this.initializeKeplerPhysics(child, sceneScale);
            });
        }
    }

    /**
     * Empties the orbit registry.
     *
     * @returns {void}
     */
    dispose() {
        log.dispose('OrbitManager', 'resources');
        this.clearAllOrbits();
    }
}

export default OrbitManager;
