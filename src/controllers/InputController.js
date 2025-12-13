import SceneManager from '../managers/SceneManager.js';
import clockManager from '../managers/ClockManager.js';
import { TARGETING, MARKER, ORBIT, SIMULATION } from '../constants.js';
import { toggleControlsOverlay, toggleStateOverlay, toggleStatsOverlay, toggleDebugOverlay } from '../ui/OverlayManager.js';

/**
 * Handles all keyboard and mouse input for the solar system application
 */
export class InputController {
    constructor(targetableBodies, animationManager = null) {
        this.targetableBodies = targetableBodies;
        this.animationManager = animationManager;
        this.currentTargetIndex = TARGETING.INITIAL_TARGET_INDEX;

        // Global orbit line visibility state
        // Orbit visibility is now managed by SceneManager/VisibilityManager

        this.setupEventListeners();
        // Target info now shown in state overlay
    }

    /**
     * Get the root body (highest in hierarchy) for reset operations
     * @returns {Object|null} The root body object, or null if not found
     */
    getRootBody() {
        // Get root body name from hierarchy manager
        const rootBodyName = SceneManager.hierarchyManager.getRootBodyName();
        if (!rootBodyName) return null;

        // Find the corresponding body in targetableBodies
        const rootBodyData = this.targetableBodies.find(body =>
            body.name.toLowerCase() === rootBodyName.toLowerCase()
        );

        return rootBodyData ? rootBodyData.body : null;
    }

    /**
     * Set up all event listeners for input handling
     */
    setupEventListeners() {
        // Keyboard controls
        document.addEventListener('keydown', (event) => this.handleKeydown(event));

        // Planet selection events from marker clicks
        window.addEventListener('planetSelected', (event) => this.handlePlanetSelection(event));
    }

    /**
     * Handle keyboard input
     * @param {KeyboardEvent} event - The keyboard event
     */
    handleKeydown(event) {
        switch(event.key) {
            case 'ArrowLeft':
                this.switchToPreviousTarget();
                break;
            case 'ArrowRight':
                this.switchToNextTarget();
                break;
            case ' ': // Spacebar to reset to Sun
                this.resetToRoot();
                break;
            case 's': // 's' key for smooth transition
                this.smoothTransitionToCurrent();
                break;
            case '=': // '+' key to increase marker size
            case '+':
                this.adjustMarkerSize(MARKER.SIZE_INCREMENT);
                break;
            case '-': // '-' key to decrease marker size
                this.adjustMarkerSize(-MARKER.SIZE_INCREMENT);
                break;
            case 'Backspace': // Backspace to reset camera to initial position
                this.resetCamera();
                break;
            case 'q': // 'q' key to increase simulation speed
            case 'Q':
                this.increaseSpeed();
                break;
            case 'a': // 'a' key to decrease simulation speed
            case 'A':
                this.decreaseSpeed();
                break;
            case 'w': // 'w' key to reset to normal speed
            case 'W':
                this.resetSpeed();
                break;
            case 't': // 't' key to toggle orbit trails
            case 'T':
                this.toggleOrbitTrails();
                break;
            case 'l': // 'l' key to toggle orbit lines
            case 'L':
                this.toggleOrbitLines();
                break;
            case 'm': // 'm' key to toggle marker visibility
            case 'M':
                this.toggleMarkerVisibility();
                break;
            case 'p': // 'p' key to toggle physics mode
            case 'P':
                this.togglePhysicsMode();
                break;
            case 'b': // 'b' key to toggle bloom effect
            case 'B':
                this.toggleBloom();
                break;
            case 'F3': // F3 key to toggle all overlays
                event.preventDefault(); // Prevent browser default behavior
                toggleControlsOverlay();
                toggleStateOverlay();
                toggleStatsOverlay();
                toggleDebugOverlay();
                // Toggle mobile UI container (hide hamburger icon and menu)
                if (typeof window !== 'undefined' && window.mobileUI) {
                    window.mobileUI.toggleContainer();
                }
                break;
        }
    }

    /**
     * Switch to the previous target in the list
     */
    switchToPreviousTarget() {
        this.currentTargetIndex = (this.currentTargetIndex - 1 + this.targetableBodies.length) % this.targetableBodies.length;
        this.transitionToCurrentTarget();
    }

    /**
     * Switch to the next target in the list
     */
    switchToNextTarget() {
        this.currentTargetIndex = (this.currentTargetIndex + 1) % this.targetableBodies.length;
        this.transitionToCurrentTarget();
    }

    /**
     * Reset target to the root body (highest in hierarchy)
     */
    resetToRoot() {
        const rootBody = this.getRootBody();
        if (rootBody) {
            this.currentTargetIndex = TARGETING.SUN_INDEX; // Keep using SUN_INDEX for consistency with constants
            SceneManager.setTargetSmooth(rootBody.group);
            SceneManager.onBodySelected(rootBody);
        }
        // Target info now shown in state overlay
    }

    /**
     * Apply smooth transition to current target
     */
    smoothTransitionToCurrent() {
        const currentBody = this.targetableBodies[this.currentTargetIndex].body;
        SceneManager.setTargetSmooth(currentBody.group);
        SceneManager.onBodySelected(currentBody);
    }

    /**
     * Transition to the currently selected target with appropriate method
     */
    transitionToCurrentTarget() {
        const currentTarget = this.targetableBodies[this.currentTargetIndex];
        // Use smooth transition for all bodies including Sun
        SceneManager.setTargetSmooth(currentTarget.body.group);

        SceneManager.onBodySelected(currentTarget.body);
        // Target info now shown in state overlay
    }

    /**
     * Adjust marker size by the given delta
     * @param {number} delta - The amount to adjust marker size
     */
    adjustMarkerSize(delta) {
        const currentSize = SceneManager.getMarkerSizeMultiplier();
        const newSize = delta > 0
            ? Math.min(currentSize + Math.abs(delta), MARKER.MAX_SIZE_MULTIPLIER)
            : Math.max(currentSize - Math.abs(delta), MARKER.MIN_SIZE_MULTIPLIER);

        SceneManager.setMarkerSizeMultiplier(newSize);
        // Target info now shown in state overlay
    }

    /**
     * Reset camera to initial position
     */
    resetCamera() {
        // Reset camera without calling restoreAllMarkers (use camera controller directly)
        SceneManager.cameraController.resetCameraSmooth();

        this.currentTargetIndex = TARGETING.SUN_INDEX; // Reset to root for consistency

        const rootBody = this.getRootBody();
        if (rootBody) {
            // Select root body to ensure proper hierarchical state
            SceneManager.onBodySelected(rootBody);

            // Apply minimum zoom limit for the root body to prevent zooming inside
            setTimeout(() => {
                const { minDistance } = SceneManager.cameraController.calculateZoomLimits(rootBody.group);
                SceneManager.controls.minDistance = minDistance;
            }, 100); // Small delay to let the reset animation start
        }

        // Target info now shown in state overlay
    }

    /**
     * Increase simulation speed
     */
    increaseSpeed() {
        if (SIMULATION.USE_N_BODY_PHYSICS) {
            // For n-body mode: increase ClockManager speed (functional n-body physics uses ClockManager directly)
            const currentSpeed = clockManager.getSpeedMultiplier() * 100.0; // Convert to display scale
            const newSpeed = Math.min(currentSpeed * ORBIT.SPEED_FACTOR, ORBIT.MAX_SPEED_MULTIPLIER); // Cap at ORBIT limit
            clockManager.setSpeedMultiplier(newSpeed / 100.0);
            // Speed info now shown in state overlay
        } else if (this.animationManager) {
            // For Kepler mode: increase ClockManager speed
            const currentSpeed = clockManager.getSpeedMultiplier() * 100.0; // Convert to display scale
            const newSpeed = Math.min(currentSpeed * ORBIT.SPEED_FACTOR, ORBIT.MAX_SPEED_MULTIPLIER); // Cap at ORBIT limit
            clockManager.setSpeedMultiplier(newSpeed / 100.0);
            // Speed info now shown in state overlay
        }
    }

    /**
     * Decrease simulation speed
     */
    decreaseSpeed() {
        if (SIMULATION.USE_N_BODY_PHYSICS) {
            // For n-body mode: decrease ClockManager speed (functional n-body physics uses ClockManager directly)
            const currentSpeed = clockManager.getSpeedMultiplier() * 100.0; // Convert to display scale
            const newSpeed = Math.max(currentSpeed / ORBIT.SPEED_FACTOR, ORBIT.MIN_SPEED_MULTIPLIER); // Cap at ORBIT minimum
            clockManager.setSpeedMultiplier(newSpeed / 100.0);
            // Speed info now shown in state overlay
        } else if (this.animationManager) {
            // For Kepler mode: decrease ClockManager speed
            const currentSpeed = clockManager.getSpeedMultiplier() * 100.0; // Convert to display scale
            const newSpeed = Math.max(currentSpeed / ORBIT.SPEED_FACTOR, ORBIT.MIN_SPEED_MULTIPLIER); // Cap at ORBIT minimum
            clockManager.setSpeedMultiplier(newSpeed / 100.0);
            // Speed info now shown in state overlay
        }
    }

    /**
     * Reset simulation speed to normal (100x for both systems)
     */
    resetSpeed() {
        if (SIMULATION.USE_N_BODY_PHYSICS) {
            // For n-body mode: reset ClockManager speed to 100x equivalent
            clockManager.setSpeedMultiplier(1.0); // 100x equivalent
            // Speed info now shown in state overlay
        } else if (this.animationManager) {
            // For Kepler mode: reset ClockManager speed to 100x equivalent
            clockManager.setSpeedMultiplier(1.0); // 100x equivalent
            // Speed info now shown in state overlay
        }
    }

    // displaySpeedInfo method removed - speed info now shown in state overlay

    /**
     * Toggle orbit trails visibility (dynamic accumulated paths)
     */
    toggleOrbitTrails() {
        const currentTarget = this.targetableBodies[this.currentTargetIndex]?.body;
        SceneManager.toggleOrbitTrails(currentTarget);
    }

    /**
     * Toggle orbit lines visibility (fixed elliptical paths)
     */
    toggleOrbitLines() {
        const currentTarget = this.targetableBodies[this.currentTargetIndex]?.body;
        SceneManager.toggleAllOrbits(currentTarget);
    }



    /**
     * Toggle marker visibility
     */
    toggleMarkerVisibility() {
        const currentTarget = this.targetableBodies[this.currentTargetIndex]?.body;
        SceneManager.toggleAllMarkers(currentTarget);
    }

    /**
     * Toggle physics mode between N-Body and Kepler
     */
    togglePhysicsMode() {
        SIMULATION.togglePhysicsMode();
    }

    /**
     * Toggle bloom effect
     */
    toggleBloom() {
        SceneManager.toggleBloom();
        // Message display removed per user request
    }


    /**
     * Handle planet selection from marker clicks
     * @param {CustomEvent} event - The planet selection event
     */
    handlePlanetSelection(event) {
        const bodyName = event.detail.bodyName;

        // Update currentTargetIndex to match the clicked planet
        const targetIndex = this.targetableBodies.findIndex(body =>
            body.name.toLowerCase() === bodyName.toLowerCase()
        );

        if (targetIndex !== TARGETING.NOT_FOUND_INDEX) {
            this.currentTargetIndex = targetIndex;
            // Target info now shown in state overlay
        }
    }

    // displayTargetInfo method removed - info now shown in state overlay

    /**
     * Get the current target index
     * @returns {number} Current target index
     */
    getCurrentTargetIndex() {
        return this.currentTargetIndex;
    }

    /**
     * Get the current target body
     * @returns {Object} Current target body object
     */
    getCurrentTarget() {
        return this.targetableBodies[this.currentTargetIndex];
    }

    /**
     * Get current global orbit line visibility state
     * @returns {boolean} True if orbit lines should be globally visible
     */
    getOrbitLinesVisible() {
        // Delegate to SceneManager for unified state management
        return SceneManager.areOrbitsVisible();
    }
}

export default InputController;