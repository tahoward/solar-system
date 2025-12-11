import { MARKER } from '../constants.js';
import { log } from '../utils/Logger.js';

/**
 * Manages marker lifecycle, selection, and coordinates with hierarchy/orbit managers
 */
export class MarkerManager {
    constructor(hierarchyManager) {
        // Marker registry for fade management
        this.markers = new Set();
        this.currentSelectedMarker = null;
        this.markerSizeMultiplier = MARKER.DEFAULT_SIZE_MULTIPLIER;

        // Store reference to shared hierarchy manager
        this.hierarchyManager = hierarchyManager;

        log.init('MarkerManager', 'MarkerManager');
    }

    /**
     * Set global marker size multiplier
     * @param {number} multiplier - Size multiplier (1.0 = default, 2.0 = double size, etc.)
     */
    setMarkerSizeMultiplier(multiplier) {
        if (typeof multiplier !== 'number' || multiplier < MARKER.MIN_SIZE_MULTIPLIER || multiplier > MARKER.MAX_SIZE_MULTIPLIER) {
            log.warn('MarkerManager', `Invalid marker size multiplier: ${multiplier}. Must be between ${MARKER.MIN_SIZE_MULTIPLIER} and ${MARKER.MAX_SIZE_MULTIPLIER}`);
            return;
        }

        this.markerSizeMultiplier = multiplier;
    }

    /**
     * Get global marker size multiplier
     * @returns {number} Current marker size multiplier
     */
    getMarkerSizeMultiplier() {
        return this.markerSizeMultiplier || MARKER.DEFAULT_SIZE_MULTIPLIER;
    }

    /**
     * Register a marker for fade management
     * @param {Object} marker - The marker to register
     */
    registerMarker(marker) {
        if (!marker) {
            log.warn('MarkerManager', 'Cannot register null or undefined marker');
            return;
        }

        this.markers.add(marker);
    }

    // Orbit registration removed - handled directly by external systems

    /**
     * Register the hierarchy map (delegates to HierarchyManager)
     * @param {Object} hierarchy - The hierarchy data from SolarSystemFactory
     */
    registerHierarchy(hierarchy) {
        this.hierarchyManager.registerHierarchy(hierarchy);
    }

    /**
     * Unregister a marker from fade management
     * @param {Object} marker - The marker to unregister
     */
    unregisterMarker(marker) {
        if (!marker) {
            log.warn('MarkerManager', 'Cannot unregister null or undefined marker');
            return;
        }

        const wasRemoved = this.markers.delete(marker);
        if (wasRemoved) {
            log.debug('MarkerManager', `Unregistered marker (total: ${this.markers.size})`);

            // Clean up if this was the current selected marker
            if (this.currentSelectedMarker === marker) {
                this.currentSelectedMarker = null;
            }
        } else {
            log.warn('MarkerManager', 'Attempted to unregister marker that was not registered');
        }
    }

    // Orbit unregistration removed - handled directly by external systems

    /**
     * Handle marker selection - fade out selected marker and restore others
     * @param {Object} selectedMarker - The marker that was selected
     */
    onMarkerSelected(selectedMarker) {
        if (!selectedMarker) {
            log.warn('MarkerManager', 'Cannot select null or undefined marker');
            return;
        }

        // Set new selected marker and update hierarchy
        this.currentSelectedMarker = selectedMarker;
        this.hierarchyManager.setSelectedBody(selectedMarker.body);

        // Update visibility using SceneManager's VisibilityManager
        if (typeof window !== 'undefined' && window.SceneManager?.visibilityManager) {
            window.SceneManager.visibilityManager.updateVisibility(selectedMarker.body);
        }
    }

    /**
     * Handle body selection (for keyboard or other navigation) - finds marker and fades it
     * @param {Object} body - The body that was selected
     */
    onBodySelected(body) {
        if (!body) {
            log.warn('MarkerManager', 'Cannot select body - body is null or undefined');
            return;
        }

        // Update hierarchy manager
        this.hierarchyManager.setSelectedBody(body);

        // Find the marker for this body
        const marker = body.marker;
        if (marker) {
            this.onMarkerSelected(marker);

            // Hide the selected marker
            if (typeof marker.hide === 'function') {
                marker.hide();
            } else {
                log.warn('MarkerManager', 'Marker does not have hide method');
            }
        } else {
        }

        // Update visibility using SceneManager's VisibilityManager
        if (typeof window !== 'undefined' && window.SceneManager?.visibilityManager) {
            window.SceneManager.visibilityManager.updateVisibility(body);
        }
    }

    // Complex visibility logic moved to VisibilityManager
    // MarkerManager now focuses on marker lifecycle and selection

    // Orbit visibility methods removed - handled directly by VisibilityManager

    /**
     * Restore all markers to full opacity
     */
    restoreAllMarkers() {
        log.debug('MarkerManager', `Restoring all markers (${this.markers.size} total)`);

        let restoredCount = 0;
        this.markers.forEach(marker => {
            if (marker && typeof marker.show === 'function') {
                // Re-enable interaction for all markers
                if (typeof marker.reenableInteraction === 'function') {
                    marker.reenableInteraction();
                }
                marker.show();
                restoredCount++;
            } else {
                log.warn('MarkerManager', 'Marker missing or does not have show method');
            }
        });

        this.currentSelectedMarker = null;
        this.hierarchyManager.clearSelectedBody();
        log.debug('MarkerManager', `Restored ${restoredCount} markers`);
    }

    // fadeOutAllMarkers() removed - unused method

    /**
     * Get the currently selected marker
     * @returns {Object|null} The currently selected marker, or null if none
     */
    getCurrentSelectedMarker() {
        return this.currentSelectedMarker;
    }

    /**
     * Get the total number of registered markers
     * @returns {number} Number of registered markers
     */
    getMarkerCount() {
        return this.markers.size;
    }

    /**
     * Check if a marker is registered
     * @param {Object} marker - The marker to check
     * @returns {boolean} True if the marker is registered
     */
    isMarkerRegistered(marker) {
        return this.markers.has(marker);
    }

    /**
     * Get all registered markers
     * @returns {Array} Array of all registered markers
     */
    getAllMarkers() {
        return Array.from(this.markers);
    }

    /**
     * Clear all marker registrations (useful for cleanup)
     */
    clearAllMarkers() {
        const count = this.markers.size;
        this.markers.clear();
        this.currentSelectedMarker = null;
        log.info('MarkerManager', `Cleared all marker registrations (${count} markers removed)`);
    }

    /**
     * Update marker size for all registered markers
     * This method can be called when the global size changes to update all markers
     */
    updateAllMarkerSizes() {
        log.debug('MarkerManager', `Updating size for all markers to ${this.markerSizeMultiplier.toFixed(1)}x`);

        // Note: Individual markers will read the size multiplier from SceneManager
        // This method is here for potential future functionality where we actively push updates
    }

    /**
     * Hide all markers by setting their visibility to false
     */
    hideAllMarkers() {
        let hiddenCount = 0;
        this.markers.forEach(marker => {
            if (marker && marker.group) {
                marker.group.visible = false;
                hiddenCount++;
            } else if (marker && !marker.group && marker.isReady === false) {
                // Marker not ready yet, but we can set a flag to hide when ready
                marker._shouldBeHidden = true;
                hiddenCount++;
            }
        });

    }

    /**
     * Show all markers by setting their visibility to true
     */
    showAllMarkers() {
        let shownCount = 0;
        this.markers.forEach(marker => {
            if (marker && marker.group) {
                marker.group.visible = true;
                shownCount++;
            } else if (marker && !marker.group && marker.isReady === false) {
                // Marker not ready yet, but we can clear the hide flag
                marker._shouldBeHidden = false;
                shownCount++;
            }
        });

    }

    /**
     * Check if markers are currently visible
     * @returns {boolean} True if any markers are visible, false if all are hidden
     */
    areMarkersVisible() {
        let anyVisible = false;

        this.markers.forEach(marker => {
            if (marker && marker.group) {
                if (marker.group.visible) {
                    anyVisible = true;
                }
            } else if (marker && !marker.group && marker.isReady === false) {
                // Check pending markers - if they don't have hide flag, consider them visible
                if (!marker._shouldBeHidden) {
                    anyVisible = true;
                }
            }
        });

        return anyVisible;
    }

    /**
     * Toggle visibility of all markers
     * @returns {boolean} True if markers are now visible, false if hidden
     */
    toggleAllMarkers() {
        const anyVisible = this.areMarkersVisible();

        if (anyVisible) {
            this.hideAllMarkers();
            return false;
        } else {
            this.showAllMarkers();
            return true;
        }
    }


    // Orbit clearing removed - handled directly by external systems

    /**
     * Clean up resources
     */
    dispose() {
        log.dispose('MarkerManager', 'resources');
        this.clearAllMarkers();
        this.hierarchyManager.dispose();
        // orbitManager.dispose() removed - orbitManager no longer owned by MarkerManager
        this.markerSizeMultiplier = MARKER.DEFAULT_SIZE_MULTIPLIER;
    }

    // Expose hierarchyManager for backwards compatibility (markers check hierarchy during construction)
    get hierarchyMap() {
        return this.hierarchyManager.hierarchyMap;
    }
}

export default MarkerManager;
