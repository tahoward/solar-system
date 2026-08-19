import { log } from '../utils/Logger.js';

/**
 * Decides which orbits, markers and trails are shown for the current selection.
 *
 * Drawing everything at once is unreadable — every moon's orbit and label on
 * screen at the same time buries the thing being looked at. The rule applied here
 * is to show only what is relevant to the selected body: its children, its parent
 * (so there is a way back up), and the root's own path. Siblings, grandchildren
 * and unrelated bodies are hidden.
 *
 * Sitting over that are three global switches, one per kind, that the user
 * controls directly and which override the per-selection rule.
 */
export class VisibilityManager {
    /**
     * Creates an empty registry with all three kinds globally enabled.
     *
     * @param {HierarchyManager} hierarchyManager - Hierarchy index, used to answer
     *   parent and child questions about each item.
     */
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

    /**
     * Starts managing an orbit's visibility.
     *
     * @param {Orbit} orbit - Orbit to track.
     * @returns {void}
     */
    registerOrbit(orbit) {
        if (!orbit) {
            log.warn('VisibilityManager', 'Cannot register null or undefined orbit');
            return;
        }

        this.orbits.add(orbit);
    }

    /**
     * Starts managing a marker's visibility.
     *
     * @param {Marker} marker - Marker to track.
     * @returns {void}
     */
    registerMarker(marker) {
        if (!marker) {
            log.warn('VisibilityManager', 'Cannot register null or undefined marker');
            return;
        }

        this.markers.add(marker);
    }

    /**
     * Starts managing a body's trail.
     *
     * The trail is switched on immediately if trails are globally enabled, so a body
     * created mid-session — a dropped mass, say — begins recording at once rather
     * than waiting for the next selection change.
     *
     * @param {Body} body - Body whose trail should be tracked; ignored if it has none.
     * @returns {void}
     */
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

    /**
     * Stops managing an orbit.
     *
     * @param {Orbit} orbit - Orbit to drop.
     * @returns {void}
     */
    unregisterOrbit(orbit) {
        if (!orbit) return;

        const wasRemoved = this.orbits.delete(orbit);
        if (wasRemoved) {
            log.debug('VisibilityManager', `Unregistered orbit for ${orbit.body?.name || 'unknown'}`);
        }
    }

    /**
     * Stops managing a marker.
     *
     * @param {Marker} marker - Marker to drop.
     * @returns {void}
     */
    unregisterMarker(marker) {
        if (!marker) return;

        const wasRemoved = this.markers.delete(marker);
        if (wasRemoved) {
            log.debug('VisibilityManager', `Unregistered marker for ${marker.body?.name || 'unknown'}`);
        }
    }

    /**
     * Stops managing a body's trail.
     *
     * @param {Body} body - Body to drop.
     * @returns {void}
     */
    unregisterOrbitTrail(body) {
        if (!body) return;

        const wasRemoved = this.orbitTrails.delete(body);
        if (wasRemoved) {
            log.debug('VisibilityManager', `Unregistered orbit trail for ${body.name || 'unknown'}`);
        }
    }

    /**
     * Re-applies the visibility rule to everything, for a new selection.
     *
     * Called whenever the selection changes or the hierarchy is reshaped.
     *
     * @param {Body} selectedBody - The newly selected body.
     * @returns {void}
     */
    updateVisibility(selectedBody) {
        const selectedBodyName = selectedBody.name;
        const hierarchyData = this.hierarchyManager.getHierarchyData(selectedBodyName);
        const selectedBodyParent = hierarchyData.parent;

        this.orbits.forEach(orbit => this.applyVisibilityLogic(orbit, selectedBodyName, selectedBodyParent, 'orbit'));
        this.markers.forEach(marker => this.applyVisibilityLogic(marker, selectedBodyName, selectedBodyParent, 'marker'));
        this.orbitTrails.forEach(body => this.applyVisibilityLogic(body, selectedBodyName, selectedBodyParent, 'orbitTrail'));
    }

    /**
     * Re-applies the visibility rule to orbits only.
     *
     * Used when the global orbit switch is turned back on, so markers and trails are
     * left as they were.
     *
     * @param {Body} selectedBody - The currently selected body.
     * @returns {void}
     */
    updateOrbitVisibility(selectedBody) {
        const selectedBodyName = selectedBody.name;
        const hierarchyData = this.hierarchyManager.getHierarchyData(selectedBodyName);
        const selectedBodyParent = hierarchyData.parent;

        this.orbits.forEach(orbit => this.applyVisibilityLogic(orbit, selectedBodyName, selectedBodyParent, 'orbit'));
    }

    /**
     * Re-applies the visibility rule to markers only.
     *
     * @param {Body} selectedBody - The currently selected body.
     * @returns {void}
     */
    updateMarkerVisibility(selectedBody) {
        const selectedBodyName = selectedBody.name;
        const hierarchyData = this.hierarchyManager.getHierarchyData(selectedBodyName);
        const selectedBodyParent = hierarchyData.parent;

        this.markers.forEach(marker => this.applyVisibilityLogic(marker, selectedBodyName, selectedBodyParent, 'marker'));
    }

    /**
     * Re-applies the visibility rule to trails only.
     *
     * @param {Body} selectedBody - The currently selected body.
     * @returns {void}
     */
    updateOrbitTrailVisibility(selectedBody) {
        const selectedBodyName = selectedBody.name;
        const hierarchyData = this.hierarchyManager.getHierarchyData(selectedBodyName);
        const selectedBodyParent = hierarchyData.parent;

        this.orbitTrails.forEach(body => this.applyVisibilityLogic(body, selectedBodyName, selectedBodyParent, 'orbitTrail'));
    }

    /**
     * Shows or hides one item according to its relationship to the selection.
     *
     * Two cases are settled before the general rule is consulted. The selected body's
     * own orbit and trail are hidden, because the camera is sitting on that body and
     * its own path would sweep across the whole view — except at the root, whose path
     * about the barycentre is the interesting one and stays visible. The selected
     * body's *marker* is left exactly as it is, since whoever made the selection has
     * already decided whether to hide it.
     *
     * Trails are keyed by their body rather than by a wrapper, hence the different
     * name lookup.
     *
     * @param {Orbit|Marker|Body} item - Item to update.
     * @param {string} selectedBodyName - Name of the selected body.
     * @param {string|null} selectedBodyParent - Name of the selected body's parent.
     * @param {'orbit'|'marker'|'orbitTrail'} type - Which kind `item` is.
     * @returns {void}
     */
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

    /**
     * The visibility rule itself.
     *
     * In order: a global switch that is off hides everything of that kind; children of
     * the selected body are shown, since they are what one wants to see when looking
     * at a planet; the root is always shown, as it anchors the view of the system; and
     * the selected body's parent is shown to give a route back up the hierarchy.
     * Anything else — siblings, grandchildren, unrelated bodies — is hidden.
     *
     * A reason accompanies the answer, which is what makes this decision traceable in
     * the debug overlay.
     *
     * @private
     * @param {string} itemBodyName - Name of the item's body.
     * @param {{parent: string|null, children: string[]}} itemHierarchyData - The item's
     *   hierarchy entry.
     * @param {string} selectedBodyName - Name of the selected body.
     * @param {string|null} selectedBodyParent - Name of the selected body's parent.
     * @param {'orbit'|'marker'|'orbitTrail'} type - Which kind the item is.
     * @returns {{shouldBeVisible: boolean, reason: string}} The decision and why it was
     *   reached.
     */
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

    /**
     * Shows one item.
     *
     * Markers also have their interaction re-enabled, since hiding one disables its
     * hit testing and showing it again has to restore that or it would be visible but
     * unclickable.
     *
     * @param {Orbit|Marker|Body} item - Item to show.
     * @param {'orbit'|'marker'|'orbitTrail'} type - Which kind it is.
     * @returns {void}
     */
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

    /**
     * Hides one item.
     *
     * @param {Orbit|Marker|Body} item - Item to hide.
     * @param {'orbit'|'marker'|'orbitTrail'} type - Which kind it is.
     * @returns {void}
     */
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

    /**
     * Shows every orbit, ignoring the selection rule.
     *
     * @returns {void}
     */
    showAllOrbits() {
        this.orbits.forEach(orbit => this.showItem(orbit, 'orbit'));
    }

    /**
     * Hides every orbit.
     *
     * @returns {void}
     */
    hideAllOrbits() {
        this.orbits.forEach(orbit => this.hideItem(orbit, 'orbit'));
    }

    /**
     * Shows every marker, ignoring the selection rule.
     *
     * @returns {void}
     */
    showAllMarkers() {
        this.markers.forEach(marker => this.showItem(marker, 'marker'));
    }

    /**
     * Hides every marker.
     *
     * @returns {void}
     */
    hideAllMarkers() {
        this.markers.forEach(marker => this.hideItem(marker, 'marker'));
    }

    /**
     * Shows every trail, ignoring the selection rule.
     *
     * @returns {void}
     */
    showAllOrbitTrails() {
        this.orbitTrails.forEach(body => this.showItem(body, 'orbitTrail'));
    }

    /**
     * Hides every trail.
     *
     * @returns {void}
     */
    hideAllOrbitTrails() {
        this.orbitTrails.forEach(body => this.hideItem(body, 'orbitTrail'));
    }

    /**
     * Flips the global marker switch.
     *
     * Turning markers back on re-applies the selection rule rather than showing all of
     * them, so the state before they were hidden is restored.
     *
     * @param {Body|null} [currentSelectedBody=null] - Selected body, needed to
     *   reconstruct the per-selection visibility.
     * @returns {boolean} `true` if markers are now enabled.
     */
    toggleAllMarkers(currentSelectedBody = null) {
        this.globalMarkersVisible = !this.globalMarkersVisible;

        if (this.globalMarkersVisible) {
            this.updateMarkerVisibility(currentSelectedBody);
        } else {
            this.hideAllMarkers();
        }

        return this.globalMarkersVisible;
    }

    /**
     * Reports the global marker switch.
     *
     * @returns {boolean} `true` if markers are enabled; individual markers may still
     *   be hidden by the selection rule.
     */
    areMarkersVisible() {
        return this.globalMarkersVisible;
    }

    /**
     * Flips the global orbit switch.
     *
     * @param {Body|null} [currentSelectedBody=null] - Selected body, needed to restore
     *   the per-selection visibility when re-enabling.
     * @returns {boolean} `true` if orbits are now enabled.
     */
    toggleAllOrbits(currentSelectedBody = null) {
        this.globalOrbitLinesVisible = !this.globalOrbitLinesVisible;

        if (this.globalOrbitLinesVisible) {
            this.updateOrbitVisibility(currentSelectedBody);
        } else {
            this.hideAllOrbits();
        }

        return this.globalOrbitLinesVisible;
    }

    /**
     * Reports the global orbit switch.
     *
     * @returns {boolean} `true` if orbits are enabled.
     */
    areOrbitsVisible() {
        return this.globalOrbitLinesVisible;
    }

    /**
     * Flips the global trail switch.
     *
     * Unlike orbits and markers, trails are switched at the source: recording is
     * stopped as well as hidden, since a hidden trail still accumulating points would
     * cost memory for nothing and reappear with a stale gap in it.
     *
     * @param {Body|null} [currentSelectedBody=null] - Selected body, needed to restore
     *   the per-selection visibility when re-enabling.
     * @returns {boolean} `true` if trails are now enabled.
     */
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

    /**
     * Reports the global trail switch.
     *
     * @returns {boolean} `true` if trails are enabled.
     */
    areOrbitTrailsVisible() {
        return this.globalOrbitTrailsVisible;
    }

    /**
     * Discards the recorded history of every trail.
     *
     * Recording continues from the bodies' current positions, so this gives a clean
     * slate after changing speed or dropping masses.
     *
     * @returns {void}
     */
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