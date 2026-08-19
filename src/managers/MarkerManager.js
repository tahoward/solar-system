import { MARKER } from '../constants.js';
import { log } from '../utils/Logger.js';

/**
 * Registry and bulk control for every body's {@link Marker}.
 *
 * Also the entry point for selection: clicking a marker or choosing a body from
 * the UI both arrive here, and this notifies the hierarchy and visibility
 * managers so the rest of the scene follows.
 */
export class MarkerManager {
    /**
     * Creates an empty marker registry.
     *
     * @param {HierarchyManager} hierarchyManager - Hierarchy manager, used to record
     *   selection and resolve relationships.
     */
    constructor(hierarchyManager) {
        this.markers = new Set();
        this.currentSelectedMarker = null;
        this.markerSizeMultiplier = MARKER.DEFAULT_SIZE_MULTIPLIER;

        this.hierarchyManager = hierarchyManager;

        log.init('MarkerManager', 'MarkerManager');
    }

    /**
     * Sets the global scale applied to every marker.
     *
     * Out-of-range values are rejected rather than clamped, since they come from the
     * UI and a silently clamped slider would misrepresent its own state.
     *
     * @param {number} multiplier - Size multiplier, within the configured range.
     * @returns {void}
     */
    setMarkerSizeMultiplier(multiplier) {
        if (typeof multiplier !== 'number' || multiplier < MARKER.MIN_SIZE_MULTIPLIER || multiplier > MARKER.MAX_SIZE_MULTIPLIER) {
            log.warn('MarkerManager', `Invalid marker size multiplier: ${multiplier}. Must be between ${MARKER.MIN_SIZE_MULTIPLIER} and ${MARKER.MAX_SIZE_MULTIPLIER}`);
            return;
        }

        this.markerSizeMultiplier = multiplier;
    }

    /**
     * Returns the global marker size multiplier.
     *
     * Read by every marker each frame, so it falls back to the default rather than
     * ever returning a falsy value that would collapse the markers.
     *
     * @returns {number} The current multiplier.
     */
    getMarkerSizeMultiplier() {
        return this.markerSizeMultiplier || MARKER.DEFAULT_SIZE_MULTIPLIER;
    }

    /**
     * Adds a marker to the registry.
     *
     * Markers call this from their own constructor, before their geometry has
     * loaded.
     *
     * @param {Marker} marker - Marker to track.
     * @returns {void}
     */
    registerMarker(marker) {
        if (!marker) {
            log.warn('MarkerManager', 'Cannot register null or undefined marker');
            return;
        }

        this.markers.add(marker);
    }

    /**
     * Passes a hierarchy through to the hierarchy manager.
     *
     * Markers reach this manager rather than the hierarchy manager directly, so this
     * forwards on their behalf.
     *
     * @param {Object} hierarchy - Root hierarchy node.
     * @returns {void}
     */
    registerHierarchy(hierarchy) {
        this.hierarchyManager.registerHierarchy(hierarchy);
    }

    /**
     * Removes a marker from the registry, clearing the selection if it held it.
     *
     * @param {Marker} marker - Marker to stop tracking.
     * @returns {void}
     */
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

    /**
     * Records a marker as selected and updates what the scene shows.
     *
     * The visibility manager is reached through `window.SceneManager` rather than an
     * import, which avoids a circular dependency between the two managers; the
     * guard covers the window between startup and that global being assigned.
     *
     * @param {Marker} selectedMarker - Marker that was selected.
     * @returns {void}
     */
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

    /**
     * Selects a body, hiding its own marker.
     *
     * The selected body's marker is hidden because the camera moves to it — a label
     * floating over the body being examined would just be in the way.
     *
     * @param {Body} body - Body that was selected.
     * @returns {void}
     */
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

    /**
     * Empties the registry and clears the selection.
     *
     * The markers themselves are not disposed; that is their bodies' concern.
     *
     * @returns {void}
     */
    clearAllMarkers() {
        const count = this.markers.size;
        this.markers.clear();
        this.currentSelectedMarker = null;
        log.info('MarkerManager', `Cleared all marker registrations (${count} markers removed)`);
    }

    /**
     * Hides every marker.
     *
     * Markers still loading have no group to hide, so the request is left on them
     * as a flag for their initialisation to apply.
     *
     * @returns {void}
     */
    hideAllMarkers() {
        this.markers.forEach(marker => {
            if (marker && marker.group) {
                marker.group.visible = false;
            } else if (marker && !marker.group && marker.isReady === false) {
                marker._shouldBeHidden = true;
            }
        });
    }

    /**
     * Shows every marker, including any still loading.
     *
     * @returns {void}
     */
    showAllMarkers() {
        this.markers.forEach(marker => {
            if (marker && marker.group) {
                marker.group.visible = true;
            } else if (marker && !marker.group && marker.isReady === false) {
                marker._shouldBeHidden = false;
            }
        });
    }

    /**
     * Reports whether any marker is currently shown.
     *
     * Answers "any", not "all", because individual markers are hidden for their own
     * reasons — selection, or being out of the current system — so requiring all of
     * them would almost never be true.
     *
     * @returns {boolean} `true` if at least one marker is visible or pending visible.
     */
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

    /**
     * Flips all markers between shown and hidden.
     *
     * @returns {boolean} `true` if markers are now shown.
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

    /**
     * Empties the registry and disposes the hierarchy manager.
     *
     * @returns {void}
     */
    dispose() {
        log.dispose('MarkerManager', 'resources');
        this.clearAllMarkers();
        this.hierarchyManager.dispose();
        this.markerSizeMultiplier = MARKER.DEFAULT_SIZE_MULTIPLIER;
    }

    /**
     * The hierarchy manager's name-to-relationship map.
     *
     * Exposed here because markers consult it — to decide whether they should start
     * out clickable — and only hold a reference to this manager.
     *
     * @type {Map<string, Object>}
     */
    get hierarchyMap() {
        return this.hierarchyManager.hierarchyMap;
    }
}

export default MarkerManager;
