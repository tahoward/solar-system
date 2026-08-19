import SceneManager from '../managers/SceneManager.js';
import clockManager from '../managers/ClockManager.js';
import massDropManager from '../managers/MassDropManager.js';
import collisionManager from '../managers/CollisionManager.js';
import { cancelSystemDrift } from '../physics/barycentre.js';
import { TARGETING, MARKER, ORBIT, SIMULATION, MASS_DROP } from '../constants.js';
import { toggleControlsOverlay, toggleStateOverlay, toggleStatsOverlay, toggleDebugOverlay } from '../ui/OverlayManager.js';

export class InputController {
    constructor(targetableBodies, animationManager = null) {
        this.targetableBodies = targetableBodies;
        this.animationManager = animationManager;
        this.currentTargetIndex = TARGETING.INITIAL_TARGET_INDEX;
        this.pressOrigin = null;

        this.setupEventListeners();

        collisionManager.onBodyRemoved((survivor, removed) => this.forgetTarget(survivor, removed));
    }

    forgetTarget(survivor, removed) {
        const index = this.targetableBodies.findIndex(entry => entry.body === removed);
        if (index === -1) return;

        this.targetableBodies.splice(index, 1);

        if (index < this.currentTargetIndex) {
            this.currentTargetIndex--;
        } else if (index === this.currentTargetIndex) {
            const survivorIndex = this.targetableBodies.findIndex(entry => entry.body === survivor);
            this.currentTargetIndex = survivorIndex !== -1 ? survivorIndex : TARGETING.SUN_INDEX;
        }
    }

    getRootBody() {
        const rootBodyName = SceneManager.hierarchyManager.getRootBodyName();
        if (!rootBodyName) return null;

        const rootBodyData = this.targetableBodies.find(body =>
            body.name.toLowerCase() === rootBodyName.toLowerCase()
        );

        return rootBodyData ? rootBodyData.body : null;
    }

    setupEventListeners() {
        document.addEventListener('keydown', (event) => this.handleKeydown(event));

        window.addEventListener('planetSelected', (event) => this.handlePlanetSelection(event));

        const canvas = SceneManager.renderer.domElement;
        canvas.addEventListener('pointerdown', (event) => this.handlePointerDown(event));
        canvas.addEventListener('pointerup', (event) => this.handlePointerUp(event));
    }

    handlePointerDown(event) {
        this.pressOrigin = { x: event.clientX, y: event.clientY, button: event.button };
    }

    handlePointerUp(event) {
        const press = this.pressOrigin;
        this.pressOrigin = null;

        if (!event.shiftKey || !press || press.button !== 0 || event.button !== 0) return;

        const travelled = Math.hypot(event.clientX - press.x, event.clientY - press.y);
        if (travelled > MASS_DROP.DRAG_TOLERANCE_PIXELS) return;

        massDropManager.dropAt(event.clientX, event.clientY);
    }

    handleKeydown(event) {
        switch(event.key) {
            case 'ArrowLeft':
                this.switchToPreviousTarget();
                break;
            case 'ArrowRight':
                this.switchToNextTarget();
                break;
            case ' ':
                this.resetToRoot();
                break;
            case 's':
                this.smoothTransitionToCurrent();
                break;
            case '=':
            case '+':
                this.adjustMarkerSize(MARKER.SIZE_INCREMENT);
                break;
            case '-':
                this.adjustMarkerSize(-MARKER.SIZE_INCREMENT);
                break;
            case 'Backspace':
                this.resetCamera();
                break;
            case 'q':
            case 'Q':
                this.increaseSpeed();
                break;
            case 'a':
            case 'A':
                this.decreaseSpeed();
                break;
            case 'w':
            case 'W':
                this.resetSpeed();
                break;
            case 't':
            case 'T':
                this.toggleOrbitTrails();
                break;
            case 'l':
            case 'L':
                this.toggleOrbitLines();
                break;
            case 'm':
            case 'M':
                this.toggleMarkerVisibility();
                break;
            case 'p':
            case 'P':
                this.togglePhysicsMode();
                break;
            case 'b':
            case 'B':
                this.toggleBloom();
                break;
            case 'F3':
                event.preventDefault();
                toggleControlsOverlay();
                toggleStateOverlay();
                toggleStatsOverlay();
                toggleDebugOverlay();
                if (typeof window !== 'undefined' && window.mobileUI) {
                    window.mobileUI.toggleContainer();
                }
                break;
        }
    }

    switchToPreviousTarget() {
        this.currentTargetIndex = (this.currentTargetIndex - 1 + this.targetableBodies.length) % this.targetableBodies.length;
        this.transitionToCurrentTarget();
    }

    switchToNextTarget() {
        this.currentTargetIndex = (this.currentTargetIndex + 1) % this.targetableBodies.length;
        this.transitionToCurrentTarget();
    }

    resetToRoot() {
        const rootBody = this.getRootBody();
        if (rootBody) {
            this.currentTargetIndex = TARGETING.SUN_INDEX;
            SceneManager.setTargetSmooth(rootBody.group);
            SceneManager.onBodySelected(rootBody);
        }
    }

    smoothTransitionToCurrent() {
        const currentBody = this.targetableBodies[this.currentTargetIndex].body;
        SceneManager.setTargetSmooth(currentBody.group);
        SceneManager.onBodySelected(currentBody);
    }

    transitionToCurrentTarget() {
        const currentTarget = this.targetableBodies[this.currentTargetIndex];
        SceneManager.setTargetSmooth(currentTarget.body.group);

        SceneManager.onBodySelected(currentTarget.body);
    }

    adjustMarkerSize(delta) {
        const currentSize = SceneManager.getMarkerSizeMultiplier();
        const newSize = delta > 0
            ? Math.min(currentSize + Math.abs(delta), MARKER.MAX_SIZE_MULTIPLIER)
            : Math.max(currentSize - Math.abs(delta), MARKER.MIN_SIZE_MULTIPLIER);

        SceneManager.setMarkerSizeMultiplier(newSize);
    }

    resetCamera() {
        SceneManager.cameraController.resetCameraSmooth();

        this.currentTargetIndex = TARGETING.SUN_INDEX;

        const rootBody = this.getRootBody();
        if (rootBody) {
            SceneManager.onBodySelected(rootBody);

            setTimeout(() => {
                const { minDistance } = SceneManager.cameraController.calculateZoomLimits(rootBody.group);
                SceneManager.controls.minDistance = minDistance;
            }, 100);
        }
    }

    increaseSpeed() {
        const currentSpeed = clockManager.getRequestedSpeedMultiplier() * 100.0;
        const newSpeed = Math.min(currentSpeed * ORBIT.SPEED_FACTOR, ORBIT.MAX_SPEED_MULTIPLIER);

        if (SIMULATION.USE_N_BODY_PHYSICS || this.animationManager) {
            clockManager.setSpeedMultiplier(newSpeed / 100.0);
        }
    }

    decreaseSpeed() {
        const currentSpeed = Math.min(clockManager.getSpeedMultiplier(),
            clockManager.getRequestedSpeedMultiplier()) * 100.0;
        const newSpeed = Math.max(currentSpeed / ORBIT.SPEED_FACTOR, ORBIT.MIN_SPEED_MULTIPLIER);

        if (SIMULATION.USE_N_BODY_PHYSICS || this.animationManager) {
            clockManager.setSpeedMultiplier(newSpeed / 100.0);
        }
    }

    resetSpeed() {
        if (SIMULATION.USE_N_BODY_PHYSICS) {
            clockManager.setSpeedMultiplier(1.0);
        } else if (this.animationManager) {
            clockManager.setSpeedMultiplier(1.0);
        }
    }

    toggleOrbitTrails() {
        const currentTarget = this.targetableBodies[this.currentTargetIndex]?.body;
        SceneManager.toggleOrbitTrails(currentTarget);
    }

    toggleOrbitLines() {
        const currentTarget = this.targetableBodies[this.currentTargetIndex]?.body;
        SceneManager.toggleAllOrbits(currentTarget);
    }

    toggleMarkerVisibility() {
        const currentTarget = this.targetableBodies[this.currentTargetIndex]?.body;
        SceneManager.toggleAllMarkers(currentTarget);
    }

    togglePhysicsMode() {
        SIMULATION.togglePhysicsMode();

        if (!SIMULATION.USE_N_BODY_PHYSICS) {
            massDropManager.clearAll();
            return;
        }

        const root = SceneManager.orbitManager?.hierarchy?.body;
        if (root) cancelSystemDrift(root);
    }

    toggleBloom() {
        SceneManager.toggleBloom();
    }

    handlePlanetSelection(event) {
        const bodyName = event.detail.bodyName;

        const targetIndex = this.targetableBodies.findIndex(body =>
            body.name.toLowerCase() === bodyName.toLowerCase()
        );

        if (targetIndex !== TARGETING.NOT_FOUND_INDEX) {
            this.currentTargetIndex = targetIndex;
        }
    }

    getCurrentTarget() {
        return this.targetableBodies[this.currentTargetIndex];
    }
}

export default InputController;