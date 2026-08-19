import { MARKER } from '../constants.js';
import { log } from '../utils/Logger.js';

export class MarkerManager {
    constructor(hierarchyManager) {
        this.markers = new Set();
        this.currentSelectedMarker = null;
        this.markerSizeMultiplier = MARKER.DEFAULT_SIZE_MULTIPLIER;

        this.hierarchyManager = hierarchyManager;

        log.init('MarkerManager', 'MarkerManager');
    }

    setMarkerSizeMultiplier(multiplier) {
        if (typeof multiplier !== 'number' || multiplier < MARKER.MIN_SIZE_MULTIPLIER || multiplier > MARKER.MAX_SIZE_MULTIPLIER) {
            log.warn('MarkerManager', `Invalid marker size multiplier: ${multiplier}. Must be between ${MARKER.MIN_SIZE_MULTIPLIER} and ${MARKER.MAX_SIZE_MULTIPLIER}`);
            return;
        }

        this.markerSizeMultiplier = multiplier;
    }

    getMarkerSizeMultiplier() {
        return this.markerSizeMultiplier || MARKER.DEFAULT_SIZE_MULTIPLIER;
    }

    registerMarker(marker) {
        if (!marker) {
            log.warn('MarkerManager', 'Cannot register null or undefined marker');
            return;
        }

        this.markers.add(marker);
    }

    registerHierarchy(hierarchy) {
        this.hierarchyManager.registerHierarchy(hierarchy);
    }

    unregisterMarker(marker) {
        if (!marker) {
            log.warn('MarkerManager', 'Cannot unregister null or undefined marker');
            return;
        }

        const wasRemoved = this.markers.delete(marker);
        if (wasRemoved) {
            log.debug('MarkerManager', `Unregistered marker (total: ${this.markers.size})`);

            if (this.currentSelectedMarker === marker) {
                this.currentSelectedMarker = null;
            }
        } else {
            log.warn('MarkerManager', 'Attempted to unregister marker that was not registered');
        }
    }

    onMarkerSelected(selectedMarker) {
        if (!selectedMarker) {
            log.warn('MarkerManager', 'Cannot select null or undefined marker');
            return;
        }

        this.currentSelectedMarker = selectedMarker;
        this.hierarchyManager.setSelectedBody(selectedMarker.body);

        if (typeof window !== 'undefined' && window.SceneManager?.visibilityManager) {
            window.SceneManager.visibilityManager.updateVisibility(selectedMarker.body);
        }
    }

    onBodySelected(body) {
        if (!body) {
            log.warn('MarkerManager', 'Cannot select body - body is null or undefined');
            return;
        }

        this.hierarchyManager.setSelectedBody(body);

        const marker = body.marker;
        if (marker) {
            this.onMarkerSelected(marker);

            if (typeof marker.hide === 'function') {
                marker.hide();
            } else {
                log.warn('MarkerManager', 'Marker does not have hide method');
            }
        } else {
        }

        if (typeof window !== 'undefined' && window.SceneManager?.visibilityManager) {
            window.SceneManager.visibilityManager.updateVisibility(body);
        }
    }

    restoreAllMarkers() {
        log.debug('MarkerManager', `Restoring all markers (${this.markers.size} total)`);

        let restoredCount = 0;
        this.markers.forEach(marker => {
            if (marker && typeof marker.show === 'function') {
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

    getCurrentSelectedMarker() {
        return this.currentSelectedMarker;
    }

    getMarkerCount() {
        return this.markers.size;
    }

    isMarkerRegistered(marker) {
        return this.markers.has(marker);
    }

    getAllMarkers() {
        return Array.from(this.markers);
    }

    clearAllMarkers() {
        const count = this.markers.size;
        this.markers.clear();
        this.currentSelectedMarker = null;
        log.info('MarkerManager', `Cleared all marker registrations (${count} markers removed)`);
    }

    updateAllMarkerSizes() {
        log.debug('MarkerManager', `Updating size for all markers to ${this.markerSizeMultiplier.toFixed(1)}x`);
    }

    hideAllMarkers() {
        let hiddenCount = 0;
        this.markers.forEach(marker => {
            if (marker && marker.group) {
                marker.group.visible = false;
                hiddenCount++;
            } else if (marker && !marker.group && marker.isReady === false) {
                marker._shouldBeHidden = true;
                hiddenCount++;
            }
        });

    }

    showAllMarkers() {
        let shownCount = 0;
        this.markers.forEach(marker => {
            if (marker && marker.group) {
                marker.group.visible = true;
                shownCount++;
            } else if (marker && !marker.group && marker.isReady === false) {
                marker._shouldBeHidden = false;
                shownCount++;
            }
        });

    }

    areMarkersVisible() {
        let anyVisible = false;

        this.markers.forEach(marker => {
            if (marker && marker.group) {
                if (marker.group.visible) {
                    anyVisible = true;
                }
            } else if (marker && !marker.group && marker.isReady === false) {
                if (!marker._shouldBeHidden) {
                    anyVisible = true;
                }
            }
        });

        return anyVisible;
    }

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

    dispose() {
        log.dispose('MarkerManager', 'resources');
        this.clearAllMarkers();
        this.hierarchyManager.dispose();
        this.markerSizeMultiplier = MARKER.DEFAULT_SIZE_MULTIPLIER;
    }

    get hierarchyMap() {
        return this.hierarchyManager.hierarchyMap;
    }
}

export default MarkerManager;
