import * as THREE from 'three';
import clockManager from './ClockManager.js';
import { updateHierarchyPositions } from '../physics/kepler.js';
import { updateHierarchyNBodyPhysics, initializeHierarchyPhysics } from '../physics/NBodySystem.js';
import { SIMULATION } from '../constants.js';
import { log } from '../utils/Logger.js';

export class OrbitManager {
    constructor(hierarchyManager) {
        this.hierarchyManager = hierarchyManager;
        this.orbits = new Set();
        this.hierarchy = null;

        log.init('OrbitManager', 'OrbitManager');
    }

    setHierarchy(hierarchy) {
        this.hierarchy = hierarchy;
        log.info('OrbitManager', 'Hierarchy set for position updates');
    }

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

    registerOrbit(orbit) {
        if (!orbit) {
            log.warn('OrbitManager', 'Cannot register null or undefined orbit');
            return;
        }

        this.orbits.add(orbit);
    }

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

    getOrbitCount() {
        return this.orbits.size;
    }

    isOrbitRegistered(orbit) {
        return this.orbits.has(orbit);
    }

    getAllOrbits() {
        return Array.from(this.orbits);
    }

    clearAllOrbits() {
        const count = this.orbits.size;
        this.orbits.clear();
        log.info('OrbitManager', `Cleared all orbit registrations (${count} orbits removed)`);
    }

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

    updateBodyRotations() {
        const simulationTime = clockManager.getSimulationTime();

        if (this.hierarchy && this.hierarchy.body) {
            this.hierarchy.body.updateRotationRecursive(simulationTime);
        }
    }

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

    dispose() {
        log.dispose('OrbitManager', 'resources');
        this.clearAllOrbits();
    }
}

export default OrbitManager;
