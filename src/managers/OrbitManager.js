import * as THREE from 'three';
import clockManager from './ClockManager.js';
import { updateHierarchyPositions } from '../physics/kepler.js';
import { updateHierarchyNBodyPhysics, initializeHierarchyPhysics } from '../physics/NBodySystem.js';
import { SIMULATION } from '../constants.js';
import { log } from '../utils/Logger.js';

/**
 * Manages orbit line visibility and body position updates based on hierarchical relationships
 */
export class OrbitManager {
    constructor(hierarchyManager) {
        this.hierarchyManager = hierarchyManager;
        this.orbits = new Set();
        this.hierarchy = null; // Will store the hierarchy for position updates

        log.init('OrbitManager', 'OrbitManager');
    }

    /**
     * Set the hierarchy data for position updates
     * @param {Object} hierarchy - The hierarchical solar system data
     */
    setHierarchy(hierarchy) {
        this.hierarchy = hierarchy;
        log.info('OrbitManager', 'Hierarchy set for position updates');
    }

    /**
     * Initialize physics on all bodies in the hierarchy
     * @param {number} sceneScale - Scene scale factor for visual scaling
     */
    initializePhysics(sceneScale) {
        if (!this.hierarchy) {
            log.warn('OrbitManager', 'No hierarchy set, cannot initialize physics');
            return;
        }

        // Use appropriate physics initialization based on SIMULATION.USE_N_BODY_PHYSICS
        if (SIMULATION.USE_N_BODY_PHYSICS) {
            // Initialize n-body physics
            initializeHierarchyPhysics(this.hierarchy, sceneScale);
            log.info('OrbitManager', 'Initialized n-body physics for hierarchy');
        } else {
            // For Kepler physics, initialize physics conditions for orbit trails
            this.initializeKeplerPhysics(this.hierarchy, sceneScale);
            log.info('OrbitManager', 'Initialized Kepler physics conditions for hierarchy');
        }

        // Note: Orbit trails are now initialized automatically in Orbit constructor
    }

    /**
     * Register an orbit for visibility management
     * @param {Object} orbit - The orbit to register
     */
    registerOrbit(orbit) {
        if (!orbit) {
            log.warn('OrbitManager', 'Cannot register null or undefined orbit');
            return;
        }

        this.orbits.add(orbit);
    }

    /**
     * Unregister an orbit from visibility management
     * @param {Object} orbit - The orbit to unregister
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

    // Orbit visibility logic moved to VisibilityManager
    // OrbitManager now focuses on orbit drawing and position updates

    // Show/hide methods moved to VisibilityManager

    /**
     * Get the total number of registered orbits
     * @returns {number} Number of registered orbits
     */
    getOrbitCount() {
        return this.orbits.size;
    }

    /**
     * Check if an orbit is registered
     * @param {Object} orbit - The orbit to check
     * @returns {boolean} True if the orbit is registered
     */
    isOrbitRegistered(orbit) {
        return this.orbits.has(orbit);
    }

    /**
     * Get all registered orbits
     * @returns {Array} Array of all registered orbits
     */
    getAllOrbits() {
        return Array.from(this.orbits);
    }

    /**
     * Clear all orbit registrations
     */
    clearAllOrbits() {
        const count = this.orbits.size;
        this.orbits.clear();
        log.info('OrbitManager', `Cleared all orbit registrations (${count} orbits removed)`);
    }


    // Global visibility check moved to VisibilityManager

    /**
     * Update all body positions using either Kepler or n-body physics
     * @param {number} timestamp - Current timestamp for orbital calculations
     * @param {number} sceneScale - Scene scale factor (required)
     */
    updateBodyPositions(timestamp, sceneScale) {
        if (!this.hierarchy) {
            log.warn('OrbitManager', 'No hierarchy set, cannot update positions');
            return;
        }

        // Use appropriate physics system based on SIMULATION.USE_N_BODY_PHYSICS
        if (SIMULATION.USE_N_BODY_PHYSICS) {
            // Use functional n-body physics with current speed multiplier from ClockManager
            updateHierarchyNBodyPhysics(this.hierarchy);
        } else {
            // Use Kepler system to update all body positions in the hierarchy
            updateHierarchyPositions(this.hierarchy, timestamp, sceneScale);
        }
    }

    /**
     * Update rotations for all bodies using recursive hierarchy update
     * Uses the root body's updateRotationRecursive to efficiently update entire hierarchy
     * @private
     */
    updateBodyRotations() {
        // Use absolute simulation time for synchronized rotation with orbital motion
        const simulationTime = clockManager.getSimulationTime();

        // Use hierarchy root body for recursive rotation updates
        if (this.hierarchy && this.hierarchy.body) {
            this.hierarchy.body.updateRotationRecursive(simulationTime);
        }
    }

    /**
     * Initialize physics conditions for Kepler mode bodies
     * @param {Object} hierarchy - The hierarchical solar system data
     * @param {number} sceneScale - Scene scale factor for visual scaling
     */
    initializeKeplerPhysics(hierarchy, sceneScale) {
        if (!hierarchy) return;

        // Initialize physics conditions for the current body
        if (hierarchy.body && hierarchy.body.setInitialPhysicsConditions) {
            // Set initial physics state (position will be updated by Kepler calculations)
            hierarchy.body.setInitialPhysicsConditions(
                new THREE.Vector3(0, 0, 0), // Initial position (will be overridden)
                new THREE.Vector3(0, 0, 0)  // Initial velocity (will be overridden)
            );
        }

        // Recursively initialize physics for children
        if (hierarchy.children && hierarchy.children.length > 0) {
            hierarchy.children.forEach(child => {
                this.initializeKeplerPhysics(child, sceneScale);
            });
        }
    }


    /**
     * Dispose and clean up resources
     */
    dispose() {
        log.dispose('OrbitManager', 'resources');
        this.clearAllOrbits();
    }
}

export default OrbitManager;
