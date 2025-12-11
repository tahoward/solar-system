import { log } from '../utils/Logger.js';

/**
 * OrbitTrailManager - Manages orbit trail initialization, registration, and state
 * Handles the lifecycle of orbit trails separately from orbit management
 */
export class OrbitTrailManager {
    constructor(hierarchyManager) {
        this.hierarchyManager = hierarchyManager;
        this.orbitTrails = new Map(); // bodyName -> body with orbit trail
        this.globalEnabled = true; // Default to enabled

        log.init('OrbitTrailManager', 'OrbitTrailManager');
    }

    /**
     * Initialize orbit trails for the entire hierarchy
     * @param {Object} hierarchy - The hierarchy data from SolarSystemFactory
     */
    initializeHierarchy(hierarchy) {
        if (!hierarchy) return;

        this._initializeOrbitTrails(hierarchy);

        // Enable orbit trails if they should be enabled by default
        if (this.globalEnabled) {
            this.enableAll(true);
        }

        log.info('OrbitTrailManager', `Initialized ${this.orbitTrails.size} orbit trails`);
    }

    /**
     * Recursively initialize orbit trails for hierarchy
     * @param {Object} hierarchy - Hierarchy node
     * @private
     */
    _initializeOrbitTrails(hierarchy) {
        if (!hierarchy) return;

        // Initialize orbit trail for the current body (if it's not the root)
        if (hierarchy.body && hierarchy.body.initializeOrbitTrail && typeof hierarchy.body.initializeOrbitTrail === 'function') {
            // Ensure orbit trail exists (won't recreate if already exists)
            hierarchy.body.initializeOrbitTrail();

            // Store reference if orbit trail exists (registration happens in Body.initializeOrbitTrail)
            if (hierarchy.body.orbitTrail) {
                this.orbitTrails.set(hierarchy.body.name, hierarchy.body);
            }
        }

        // Recursively initialize orbit trails for children
        if (hierarchy.children && hierarchy.children.length > 0) {
            hierarchy.children.forEach(child => {
                this._initializeOrbitTrails(child);
            });
        }
    }

    /**
     * Register an orbit trail with this manager
     * @param {Object} body - The body with orbit trail
     * @returns {Object} The body that was registered (for chaining)
     */
    registerOrbitTrail(body) {
        if (!body || !body.orbitTrail) {
            log.warn('OrbitTrailManager', 'Cannot register body without orbit trail');
            return null;
        }

        // Store in our collection
        this.orbitTrails.set(body.name, body);

        log.debug('OrbitTrailManager', `Registered orbit trail for ${body.name}`);
        return body;
    }

    /**
     * Unregister an orbit trail from this manager
     * @param {Object} body - The body with orbit trail to unregister
     */
    unregisterOrbitTrail(body) {
        if (!body) return;

        const wasRemoved = this.orbitTrails.delete(body.name);
        if (wasRemoved) {
            log.debug('OrbitTrailManager', `Unregistered orbit trail for ${body.name}`);
        }
    }

    /**
     * Enable or disable all orbit trails
     * @param {boolean} enabled - Whether orbit trails should be enabled
     */
    enableAll(enabled) {
        this.orbitTrails.forEach(body => {
            if (body.setOrbitTrailEnabled) {
                body.setOrbitTrailEnabled(enabled);
            }
        });

        log.info('OrbitTrailManager', `${enabled ? 'Enabled' : 'Disabled'} all orbit trails`);
    }

    /**
     * Clear all orbit trails
     */
    clearAll() {
        this.orbitTrails.forEach(body => {
            if (body.clearOrbitTrail) {
                body.clearOrbitTrail();
            }
        });

        log.info('OrbitTrailManager', 'Cleared all orbit trails');
    }

    /**
     * Toggle orbit trail for a specific body
     * @param {string} bodyName - Name of the body
     * @returns {boolean} New enabled state, or null if body not found
     */
    toggle(bodyName) {
        const body = this.orbitTrails.get(bodyName);
        if (body && body.toggleOrbitTrail) {
            const newState = body.toggleOrbitTrail();
            log.debug('OrbitTrailManager', `Toggled orbit trail for ${bodyName} -> ${newState ? 'enabled' : 'disabled'}`);
            return newState;
        }
        return null;
    }


    /**
     * Get orbit trail for a specific body
     * @param {string} bodyName - Name of the body
     * @returns {Object|null} Body with orbit trail, or null if not found
     */
    getOrbitTrail(bodyName) {
        return this.orbitTrails.get(bodyName) || null;
    }

    /**
     * Get all orbit trail bodies
     * @returns {Array} Array of bodies with orbit trails
     */
    getAllOrbitTrails() {
        return Array.from(this.orbitTrails.values());
    }

    /**
     * Dispose and clean up resources
     */
    dispose() {
        log.dispose('OrbitTrailManager', 'resources');
        this.orbitTrails.clear();
    }
}

export default OrbitTrailManager;