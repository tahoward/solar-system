import { log } from '../utils/Logger.js';

/**
 * Registry and bulk control for every body's {@link OrbitTrail}.
 *
 * Trails are owned by their bodies; this keeps a name-keyed index of the bodies
 * that have one so the UI can enable, clear or toggle them without walking the
 * hierarchy each time.
 */
export class OrbitTrailManager {
    /**
     * Creates an empty trail registry.
     *
     * @param {HierarchyManager} hierarchyManager - Hierarchy manager, retained for
     *   callers that need to resolve relationships.
     */
    constructor(hierarchyManager) {
        this.hierarchyManager = hierarchyManager;
        this.orbitTrails = new Map();
        this.globalEnabled = true;

        log.init('OrbitTrailManager', 'OrbitTrailManager');
    }

    /**
     * Creates and registers trails for every body in a hierarchy.
     *
     * Trails are enabled straight away if the global setting is on, so the display
     * state survives a hierarchy being rebuilt.
     *
     * @param {Object} hierarchy - Root hierarchy node.
     * @returns {void}
     */
    initializeHierarchy(hierarchy) {
        if (!hierarchy) return;

        this._initializeOrbitTrails(hierarchy);

        if (this.globalEnabled) {
            this.enableAll(true);
        }

        log.info('OrbitTrailManager', `Initialized ${this.orbitTrails.size} orbit trails`);
    }

    /**
     * Walks a hierarchy, asking each body to create its trail.
     *
     * Only bodies that actually end up with a trail are indexed — a body may
     * decline to create one.
     *
     * @private
     * @param {Object} hierarchy - Hierarchy node to descend from.
     * @returns {void}
     */
    _initializeOrbitTrails(hierarchy) {
        if (!hierarchy) return;

        if (hierarchy.body && hierarchy.body.initializeOrbitTrail && typeof hierarchy.body.initializeOrbitTrail === 'function') {
            hierarchy.body.initializeOrbitTrail();

            if (hierarchy.body.orbitTrail) {
                this.orbitTrails.set(hierarchy.body.name, hierarchy.body);
            }
        }

        if (hierarchy.children && hierarchy.children.length > 0) {
            hierarchy.children.forEach(child => {
                this._initializeOrbitTrails(child);
            });
        }
    }

    /**
     * Adds a body's existing trail to the registry.
     *
     * Used for bodies created after startup, such as dropped masses.
     *
     * @param {Body} body - Body that already has a trail.
     * @returns {Body|null} The body, or `null` if it has no trail to register.
     */
    registerOrbitTrail(body) {
        if (!body || !body.orbitTrail) {
            log.warn('OrbitTrailManager', 'Cannot register body without orbit trail');
            return null;
        }

        this.orbitTrails.set(body.name, body);

        log.debug('OrbitTrailManager', `Registered orbit trail for ${body.name}`);
        return body;
    }

    /**
     * Drops a body from the registry.
     *
     * The trail itself is not disposed; that is the body's responsibility.
     *
     * @param {Body} body - Body to remove.
     * @returns {void}
     */
    unregisterOrbitTrail(body) {
        if (!body) return;

        const wasRemoved = this.orbitTrails.delete(body.name);
        if (wasRemoved) {
            log.debug('OrbitTrailManager', `Unregistered orbit trail for ${body.name}`);
        }
    }

    /**
     * Turns recording on or off for every registered trail.
     *
     * @param {boolean} enabled - Whether trails should record.
     * @returns {void}
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
     * Discards the recorded points of every trail, leaving them enabled.
     *
     * @returns {void}
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
     * Flips one body's trail between recording and off.
     *
     * @param {string} bodyName - Name of the body.
     * @returns {boolean|null} The new state, or `null` if the body is not registered.
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
     * Empties the registry.
     *
     * @returns {void}
     */
    dispose() {
        log.dispose('OrbitTrailManager', 'resources');
        this.orbitTrails.clear();
    }
}

export default OrbitTrailManager;