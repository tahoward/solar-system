/**
 * Manages visibility of orbits, markers, and orbit trails based on hierarchical relationships
 * Uses unified visibility logic and maintains global visibility state for all visual elements
 */
export class VisibilityManager {
    constructor(hierarchyManager) {
        this.hierarchyManager = hierarchyManager;
        this.orbits = new Set();
        this.markers = new Set();
        this.orbitTrails = new Set();

        // Global visibility states - VisibilityManager is the source of truth
        // Start with orbits hidden as they get hidden by initial hierarchical visibility logic
        this.globalOrbitLinesVisible = true;
        this.globalMarkersVisible = true;
        this.globalOrbitTrailsVisible = true;


        console.log('VisibilityManager: Initialized');
    }

    /**
     * Register an orbit for visibility management
     * @param {Object} orbit - The orbit to register
     */
    registerOrbit(orbit) {
        if (!orbit) {
            console.warn('VisibilityManager: Cannot register null or undefined orbit');
            return;
        }

        this.orbits.add(orbit);
    }

    /**
     * Register a marker for visibility management
     * @param {Object} marker - The marker to register
     */
    registerMarker(marker) {
        if (!marker) {
            console.warn('VisibilityManager: Cannot register null or undefined marker');
            return;
        }

        this.markers.add(marker);
    }

    /**
     * Register a body with orbit trail for visibility management
     * @param {Object} body - The body with orbit trail to register
     */
    registerOrbitTrail(body) {
        if (!body || !body.orbitTrail) {
            console.warn('VisibilityManager: Cannot register body without orbit trail');
            return;
        }

        this.orbitTrails.add(body);

        // Enable the orbit trail if globally enabled
        if (this.globalOrbitTrailsVisible && body.setOrbitTrailEnabled) {
            body.setOrbitTrailEnabled(true);
        }
    }

    /**
     * Unregister an orbit from visibility management
     * @param {Object} orbit - The orbit to unregister
     */
    unregisterOrbit(orbit) {
        if (!orbit) return;

        const wasRemoved = this.orbits.delete(orbit);
        if (wasRemoved) {
            console.log(`VisibilityManager: Unregistered orbit for ${orbit.body?.name || 'unknown'}`);
        }
    }

    /**
     * Unregister a marker from visibility management
     * @param {Object} marker - The marker to unregister
     */
    unregisterMarker(marker) {
        if (!marker) return;

        const wasRemoved = this.markers.delete(marker);
        if (wasRemoved) {
            console.log(`VisibilityManager: Unregistered marker for ${marker.body?.name || 'unknown'}`);
        }
    }

    /**
     * Unregister a body with orbit trail from visibility management
     * @param {Object} body - The body to unregister
     */
    unregisterOrbitTrail(body) {
        if (!body) return;

        const wasRemoved = this.orbitTrails.delete(body);
        if (wasRemoved) {
            console.log(`VisibilityManager: Unregistered orbit trail for ${body.name || 'unknown'}`);
        }
    }

    /**
     * Update visibility of all orbits, markers, and orbit trails based on selected body
     * Uses unified visibility logic for all items
     * @param {Object} selectedBody - The currently selected body
     */
    updateVisibility(selectedBody) {
        const selectedBodyName = selectedBody.name;
        const hierarchyData = this.hierarchyManager.getHierarchyData(selectedBodyName);
        const selectedBodyParent = hierarchyData.parent;

        // Apply unified visibility logic to orbits, markers, and orbit trails
        this.orbits.forEach(orbit => this.applyVisibilityLogic(orbit, selectedBodyName, selectedBodyParent, 'orbit'));
        this.markers.forEach(marker => this.applyVisibilityLogic(marker, selectedBodyName, selectedBodyParent, 'marker'));
        this.orbitTrails.forEach(body => this.applyVisibilityLogic(body, selectedBodyName, selectedBodyParent, 'orbitTrail'));
    }

    /**
     * Update visibility of only orbits based on selected body
     * @param {Object} selectedBody - The currently selected body
     */
    updateOrbitVisibility(selectedBody) {
        const selectedBodyName = selectedBody.name;
        const hierarchyData = this.hierarchyManager.getHierarchyData(selectedBodyName);
        const selectedBodyParent = hierarchyData.parent;

        // Apply visibility logic only to orbits
        this.orbits.forEach(orbit => this.applyVisibilityLogic(orbit, selectedBodyName, selectedBodyParent, 'orbit'));
    }

    /**
     * Update visibility of only markers based on selected body
     * @param {Object} selectedBody - The currently selected body
     */
    updateMarkerVisibility(selectedBody) {
        const selectedBodyName = selectedBody.name;
        const hierarchyData = this.hierarchyManager.getHierarchyData(selectedBodyName);
        const selectedBodyParent = hierarchyData.parent;

        // Apply visibility logic only to markers
        this.markers.forEach(marker => this.applyVisibilityLogic(marker, selectedBodyName, selectedBodyParent, 'marker'));
    }

    /**
     * Update visibility of only orbit trails based on selected body
     * @param {Object} selectedBody - The currently selected body
     */
    updateOrbitTrailVisibility(selectedBody) {
        const selectedBodyName = selectedBody.name;
        const hierarchyData = this.hierarchyManager.getHierarchyData(selectedBodyName);
        const selectedBodyParent = hierarchyData.parent;

        // Apply visibility logic only to orbit trails
        this.orbitTrails.forEach(body => this.applyVisibilityLogic(body, selectedBodyName, selectedBodyParent, 'orbitTrail'));
    }

    /**
     * Apply unified visibility logic to an item (orbit, marker, or orbitTrail)
     * @param {Object} item - The orbit, marker, or body with orbit trail
     * @param {string} selectedBodyName - Name of the selected body
     * @param {string|null} selectedBodyParent - Parent of the selected body
     * @param {string} type - 'orbit', 'marker', or 'orbitTrail' for different show/hide behavior
     */
    applyVisibilityLogic(item, selectedBodyName, selectedBodyParent, type) {
        let itemBodyName;

        if (type === 'orbitTrail') {
            // For orbit trails, the item is the body itself
            itemBodyName = item.name;
        } else {
            // For orbits and markers, the item has a body property
            if (!item?.body?.name) return;
            itemBodyName = item.body.name;
        }

        const itemHierarchyData = this.hierarchyManager.getHierarchyData(itemBodyName);

        if (!itemHierarchyData) {
            // Default to hidden for unknown bodies during selection (to be safe)
            this.hideItem(item, type);
            return;
        }

        // Skip the selected body's orbit (orbits don't orbit themselves)
        // For markers and orbit trails, the selected item gets special handling elsewhere
        if (itemBodyName === selectedBodyName && (type === 'orbit' || type === 'orbitTrail')) {
            this.hideItem(item, type);
            return;
        }

        // For markers, skip the selected body as it's handled elsewhere
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
     * Determine if an item should be visible based on unified visibility rules
     * @param {string} itemBodyName - Name of the item's body
     * @param {Object} itemHierarchyData - Hierarchy data for the item's body
     * @param {string} selectedBodyName - Name of the selected body
     * @param {string|null} selectedBodyParent - Parent of the selected body
     * @param {string} type - 'orbit', 'marker', or 'orbitTrail'
     * @returns {Object} Object with shouldBeVisible (boolean) and reason (string)
     * @private
     */
    _shouldItemBeVisible(itemBodyName, itemHierarchyData, selectedBodyName, selectedBodyParent, type) {
        // Rule 0: Check global visibility flags first
        if (type === 'orbit' && !this.globalOrbitLinesVisible) {
            return { shouldBeVisible: false, reason: 'orbit lines globally disabled' };
        }
        if (type === 'marker' && !this.globalMarkersVisible) {
            return { shouldBeVisible: false, reason: 'markers globally disabled' };
        }
        if (type === 'orbitTrail' && !this.globalOrbitTrailsVisible) {
            return { shouldBeVisible: false, reason: 'orbit trails globally disabled' };
        }

        // Rule 1: Direct children of selected body should be visible
        if (itemHierarchyData.parent === selectedBodyName) {
            return { shouldBeVisible: true, reason: `direct child ${type}` };
        }

        // Rule 2: Root body handling
        if (itemHierarchyData.parent === null) {
            if (type === 'orbit') {
                // Root body doesn't have an orbit
                return { shouldBeVisible: false, reason: 'root body (no orbit)' };
            } else if (type === 'orbitTrail') {
                // Root body doesn't have an orbit trail (it's stationary)
                return { shouldBeVisible: false, reason: 'root body (no orbit trail)' };
            } else {
                // Root body marker should always be visible (unless it's selected)
                return { shouldBeVisible: true, reason: 'root body' };
            }
        }

        // Rule 3: Parent of selected body should remain visible (for navigation context)
        if (selectedBodyParent && itemBodyName === selectedBodyParent) {
            return { shouldBeVisible: true, reason: `parent ${type} for navigation` };
        }

        // Rule 4: All other items should be hidden
        return { shouldBeVisible: false, reason: `sibling/grandchild/unrelated ${type}` };
    }

    /**
     * Show an item (orbit, marker, or orbit trail)
     * @param {Object} item - The item to show
     * @param {string} type - 'orbit', 'marker', or 'orbitTrail'
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
     * Hide an item (orbit, marker, or orbit trail)
     * @param {Object} item - The item to hide
     * @param {string} type - 'orbit', 'marker', or 'orbitTrail'
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
     * Show all orbits
     */
    showAllOrbits() {
        this.orbits.forEach(orbit => this.showItem(orbit, 'orbit'));
    }

    /**
     * Hide all orbits
     */
    hideAllOrbits() {
        this.orbits.forEach(orbit => this.hideItem(orbit, 'orbit'));
    }

    /**
     * Show all markers
     */
    showAllMarkers() {
        this.markers.forEach(marker => this.showItem(marker, 'marker'));
    }

    /**
     * Hide all markers
     */
    hideAllMarkers() {
        this.markers.forEach(marker => this.hideItem(marker, 'marker'));
    }

    /**
     * Show all orbit trails
     */
    showAllOrbitTrails() {
        this.orbitTrails.forEach(body => this.showItem(body, 'orbitTrail'));
    }

    /**
     * Hide all orbit trails
     */
    hideAllOrbitTrails() {
        this.orbitTrails.forEach(body => this.hideItem(body, 'orbitTrail'));
    }

    /**
     * Toggle visibility of all markers
     * @param {Object} currentSelectedBody - The currently selected body (optional)
     * @returns {boolean} True if markers are now visible, false if hidden
     */
    toggleAllMarkers(currentSelectedBody = null) {
        // Toggle global state
        this.globalMarkersVisible = !this.globalMarkersVisible;

        if (this.globalMarkersVisible) {
            // Don't show all - respect current hierarchical selection
            // Only update marker visibility, not orbits or orbit trails
            this.updateMarkerVisibility(currentSelectedBody);
        } else {
            this.hideAllMarkers();
        }

        return this.globalMarkersVisible;
    }

    /**
     * Check if markers are currently visible
     * @returns {boolean} True if markers are visible, false if hidden
     */
    areMarkersVisible() {
        return this.globalMarkersVisible;
    }

    /**
     * Toggle visibility of all orbits
     * @param {Object} currentSelectedBody - The currently selected body (optional)
     * @returns {boolean} True if orbits are now visible, false if hidden
     */
    toggleAllOrbits(currentSelectedBody = null) {
        // Toggle global state
        this.globalOrbitLinesVisible = !this.globalOrbitLinesVisible;

        if (this.globalOrbitLinesVisible) {
            // Don't show all - respect current hierarchical selection
            // Only update orbit visibility, not markers or orbit trails
            this.updateOrbitVisibility(currentSelectedBody);
        } else {
            this.hideAllOrbits();
        }

        return this.globalOrbitLinesVisible;
    }

    /**
     * Check if orbits are currently visible
     * @returns {boolean} True if orbits are visible, false if hidden
     */
    areOrbitsVisible() {
        return this.globalOrbitLinesVisible;
    }

    /**
     * Toggle orbit trails enabled/disabled for all bodies
     * @param {Object} currentSelectedBody - The currently selected body (optional)
     * @returns {boolean} New enabled state
     */
    toggleOrbitTrails(currentSelectedBody = null) {
        // Toggle global state
        this.globalOrbitTrailsVisible = !this.globalOrbitTrailsVisible;

        // Apply the state to all orbit trails
        this.orbitTrails.forEach(body => {
            if (body.setOrbitTrailEnabled) {
                body.setOrbitTrailEnabled(this.globalOrbitTrailsVisible);
            }
        });

        // If we just enabled orbit trails, respect current hierarchical selection
        // Only update orbit trail visibility, not orbits or markers
        if (this.globalOrbitTrailsVisible) {
            this.updateOrbitTrailVisibility(currentSelectedBody);
        }

        console.log(`VisibilityManager: Orbit trails ${this.globalOrbitTrailsVisible ? 'enabled' : 'disabled'}`);
        return this.globalOrbitTrailsVisible;
    }

    /**
     * Check if orbit trails are currently enabled
     * @returns {boolean} True if orbit trails are enabled, false if disabled
     */
    areOrbitTrailsVisible() {
        return this.globalOrbitTrailsVisible;
    }

    /**
     * Clear all orbit trails
     */
    clearAllOrbitTrails() {
        this.orbitTrails.forEach(body => {
            if (body.clearOrbitTrail) {
                body.clearOrbitTrail();
            }
        });
        console.log('VisibilityManager: Cleared all orbit trails');
    }





}

export default VisibilityManager;