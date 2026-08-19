import { log } from '../utils/Logger.js';

export class VisibilityManager {
    constructor(hierarchyManager) {
        this.hierarchyManager = hierarchyManager;
        this.orbits = new Set();
        this.markers = new Set();
        this.orbitTrails = new Set();

        this.globalOrbitLinesVisible = true;
        this.globalMarkersVisible = true;
        this.globalOrbitTrailsVisible = true;


        log.init('VisibilityManager', 'VisibilityManager');
    }

    registerOrbit(orbit) {
        if (!orbit) {
            log.warn('VisibilityManager', 'Cannot register null or undefined orbit');
            return;
        }

        this.orbits.add(orbit);
    }

    registerMarker(marker) {
        if (!marker) {
            log.warn('VisibilityManager', 'Cannot register null or undefined marker');
            return;
        }

        this.markers.add(marker);
    }

    registerOrbitTrail(body) {
        if (!body || !body.orbitTrail) {
            log.warn('VisibilityManager', 'Cannot register body without orbit trail');
            return;
        }

        this.orbitTrails.add(body);

        if (this.globalOrbitTrailsVisible && body.setOrbitTrailEnabled) {
            body.setOrbitTrailEnabled(true);
        }
    }

    unregisterOrbit(orbit) {
        if (!orbit) return;

        const wasRemoved = this.orbits.delete(orbit);
        if (wasRemoved) {
            log.debug('VisibilityManager', `Unregistered orbit for ${orbit.body?.name || 'unknown'}`);
        }
    }

    unregisterMarker(marker) {
        if (!marker) return;

        const wasRemoved = this.markers.delete(marker);
        if (wasRemoved) {
            log.debug('VisibilityManager', `Unregistered marker for ${marker.body?.name || 'unknown'}`);
        }
    }

    unregisterOrbitTrail(body) {
        if (!body) return;

        const wasRemoved = this.orbitTrails.delete(body);
        if (wasRemoved) {
            log.debug('VisibilityManager', `Unregistered orbit trail for ${body.name || 'unknown'}`);
        }
    }

    updateVisibility(selectedBody) {
        const selectedBodyName = selectedBody.name;
        const hierarchyData = this.hierarchyManager.getHierarchyData(selectedBodyName);
        const selectedBodyParent = hierarchyData.parent;

        this.orbits.forEach(orbit => this.applyVisibilityLogic(orbit, selectedBodyName, selectedBodyParent, 'orbit'));
        this.markers.forEach(marker => this.applyVisibilityLogic(marker, selectedBodyName, selectedBodyParent, 'marker'));
        this.orbitTrails.forEach(body => this.applyVisibilityLogic(body, selectedBodyName, selectedBodyParent, 'orbitTrail'));
    }

    updateOrbitVisibility(selectedBody) {
        const selectedBodyName = selectedBody.name;
        const hierarchyData = this.hierarchyManager.getHierarchyData(selectedBodyName);
        const selectedBodyParent = hierarchyData.parent;

        this.orbits.forEach(orbit => this.applyVisibilityLogic(orbit, selectedBodyName, selectedBodyParent, 'orbit'));
    }

    updateMarkerVisibility(selectedBody) {
        const selectedBodyName = selectedBody.name;
        const hierarchyData = this.hierarchyManager.getHierarchyData(selectedBodyName);
        const selectedBodyParent = hierarchyData.parent;

        this.markers.forEach(marker => this.applyVisibilityLogic(marker, selectedBodyName, selectedBodyParent, 'marker'));
    }

    updateOrbitTrailVisibility(selectedBody) {
        const selectedBodyName = selectedBody.name;
        const hierarchyData = this.hierarchyManager.getHierarchyData(selectedBodyName);
        const selectedBodyParent = hierarchyData.parent;

        this.orbitTrails.forEach(body => this.applyVisibilityLogic(body, selectedBodyName, selectedBodyParent, 'orbitTrail'));
    }

    applyVisibilityLogic(item, selectedBodyName, selectedBodyParent, type) {
        let itemBodyName;

        if (type === 'orbitTrail') {
            itemBodyName = item.name;
        } else {
            if (!item?.body?.name) return;
            itemBodyName = item.body.name;
        }

        const itemHierarchyData = this.hierarchyManager.getHierarchyData(itemBodyName);

        if (!itemHierarchyData) {
            this.hideItem(item, type);
            return;
        }

        const isRootPath = itemHierarchyData.parent === null;
        if (itemBodyName === selectedBodyName && !isRootPath
            && (type === 'orbit' || type === 'orbitTrail')) {
            this.hideItem(item, type);
            return;
        }

        if (itemBodyName === selectedBodyName && type === 'marker') {
            return;
        }

        const { shouldBeVisible } = this._shouldItemBeVisible(
            itemBodyName,
            itemHierarchyData,
            selectedBodyName,
            selectedBodyParent,
            type
        );


        if (shouldBeVisible) {
            this.showItem(item, type);
        } else {
            this.hideItem(item, type);
        }
    }

    _shouldItemBeVisible(itemBodyName, itemHierarchyData, selectedBodyName, selectedBodyParent, type) {
        if (type === 'orbit' && !this.globalOrbitLinesVisible) {
            return { shouldBeVisible: false, reason: 'orbit lines globally disabled' };
        }
        if (type === 'marker' && !this.globalMarkersVisible) {
            return { shouldBeVisible: false, reason: 'markers globally disabled' };
        }
        if (type === 'orbitTrail' && !this.globalOrbitTrailsVisible) {
            return { shouldBeVisible: false, reason: 'orbit trails globally disabled' };
        }

        if (itemHierarchyData.parent === selectedBodyName) {
            return { shouldBeVisible: true, reason: `direct child ${type}` };
        }

        if (itemHierarchyData.parent === null) {
            if (type === 'orbit' || type === 'orbitTrail') {
                return { shouldBeVisible: true, reason: 'root body (path about the barycentre)' };
            } else {
                return { shouldBeVisible: true, reason: 'root body' };
            }
        }

        if (selectedBodyParent && itemBodyName === selectedBodyParent) {
            return { shouldBeVisible: true, reason: `parent ${type} for navigation` };
        }

        return { shouldBeVisible: false, reason: `sibling/grandchild/unrelated ${type}` };
    }

    showItem(item, type) {
        if (type === 'orbit') {
            if (item && typeof item.show === 'function') {
                item.show();
            }
        } else if (type === 'marker') {
            if (item && typeof item.reenableInteraction === 'function') {
                item.reenableInteraction();
            }
            if (item && typeof item.show === 'function') {
                item.show();
            }
        } else if (type === 'orbitTrail') {
            if (item && typeof item.show === 'function') {
                item.show();
            }
        }
    }

    hideItem(item, type) {
        if (type === 'orbit') {
            if (item && typeof item.hide === 'function') {
                item.hide();
            }
        } else if (type === 'marker') {
            if (item && typeof item.hide === 'function') {
                item.hide();
            }
        } else if (type === 'orbitTrail') {
            if (item && typeof item.hide === 'function') {
                item.hide();
            }
        }
    }

    showAllOrbits() {
        this.orbits.forEach(orbit => this.showItem(orbit, 'orbit'));
    }

    hideAllOrbits() {
        this.orbits.forEach(orbit => this.hideItem(orbit, 'orbit'));
    }

    showAllMarkers() {
        this.markers.forEach(marker => this.showItem(marker, 'marker'));
    }

    hideAllMarkers() {
        this.markers.forEach(marker => this.hideItem(marker, 'marker'));
    }

    showAllOrbitTrails() {
        this.orbitTrails.forEach(body => this.showItem(body, 'orbitTrail'));
    }

    hideAllOrbitTrails() {
        this.orbitTrails.forEach(body => this.hideItem(body, 'orbitTrail'));
    }

    toggleAllMarkers(currentSelectedBody = null) {
        this.globalMarkersVisible = !this.globalMarkersVisible;

        if (this.globalMarkersVisible) {
            this.updateMarkerVisibility(currentSelectedBody);
        } else {
            this.hideAllMarkers();
        }

        return this.globalMarkersVisible;
    }

    areMarkersVisible() {
        return this.globalMarkersVisible;
    }

    toggleAllOrbits(currentSelectedBody = null) {
        this.globalOrbitLinesVisible = !this.globalOrbitLinesVisible;

        if (this.globalOrbitLinesVisible) {
            this.updateOrbitVisibility(currentSelectedBody);
        } else {
            this.hideAllOrbits();
        }

        return this.globalOrbitLinesVisible;
    }

    areOrbitsVisible() {
        return this.globalOrbitLinesVisible;
    }

    toggleOrbitTrails(currentSelectedBody = null) {
        this.globalOrbitTrailsVisible = !this.globalOrbitTrailsVisible;

        this.orbitTrails.forEach(body => {
            if (body.setOrbitTrailEnabled) {
                body.setOrbitTrailEnabled(this.globalOrbitTrailsVisible);
            }
        });

        if (this.globalOrbitTrailsVisible) {
            this.updateOrbitTrailVisibility(currentSelectedBody);
        }

        log.info('VisibilityManager', `Orbit trails ${this.globalOrbitTrailsVisible ? 'enabled' : 'disabled'}`);
        return this.globalOrbitTrailsVisible;
    }

    areOrbitTrailsVisible() {
        return this.globalOrbitTrailsVisible;
    }

    clearAllOrbitTrails() {
        this.orbitTrails.forEach(body => {
            if (body.clearOrbitTrail) {
                body.clearOrbitTrail();
            }
        });
        log.info('VisibilityManager', 'Cleared all orbit trails');
    }





}

export default VisibilityManager;