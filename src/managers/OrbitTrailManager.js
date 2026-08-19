import { log } from '../utils/Logger.js';

export class OrbitTrailManager {
    constructor(hierarchyManager) {
        this.hierarchyManager = hierarchyManager;
        this.orbitTrails = new Map();
        this.globalEnabled = true;

        log.init('OrbitTrailManager', 'OrbitTrailManager');
    }

    initializeHierarchy(hierarchy) {
        if (!hierarchy) return;

        this._initializeOrbitTrails(hierarchy);

        if (this.globalEnabled) {
            this.enableAll(true);
        }

        log.info('OrbitTrailManager', `Initialized ${this.orbitTrails.size} orbit trails`);
    }

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

    registerOrbitTrail(body) {
        if (!body || !body.orbitTrail) {
            log.warn('OrbitTrailManager', 'Cannot register body without orbit trail');
            return null;
        }

        this.orbitTrails.set(body.name, body);

        log.debug('OrbitTrailManager', `Registered orbit trail for ${body.name}`);
        return body;
    }

    unregisterOrbitTrail(body) {
        if (!body) return;

        const wasRemoved = this.orbitTrails.delete(body.name);
        if (wasRemoved) {
            log.debug('OrbitTrailManager', `Unregistered orbit trail for ${body.name}`);
        }
    }

    enableAll(enabled) {
        this.orbitTrails.forEach(body => {
            if (body.setOrbitTrailEnabled) {
                body.setOrbitTrailEnabled(enabled);
            }
        });

        log.info('OrbitTrailManager', `${enabled ? 'Enabled' : 'Disabled'} all orbit trails`);
    }

    clearAll() {
        this.orbitTrails.forEach(body => {
            if (body.clearOrbitTrail) {
                body.clearOrbitTrail();
            }
        });

        log.info('OrbitTrailManager', 'Cleared all orbit trails');
    }

    toggle(bodyName) {
        const body = this.orbitTrails.get(bodyName);
        if (body && body.toggleOrbitTrail) {
            const newState = body.toggleOrbitTrail();
            log.debug('OrbitTrailManager', `Toggled orbit trail for ${bodyName} -> ${newState ? 'enabled' : 'disabled'}`);
            return newState;
        }
        return null;
    }

    dispose() {
        log.dispose('OrbitTrailManager', 'resources');
        this.orbitTrails.clear();
    }
}

export default OrbitTrailManager;