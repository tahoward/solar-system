import SceneManager from '../managers/SceneManager.js';
import clockManager from '../managers/ClockManager.js';
import massDropManager from '../managers/MassDropManager.js';
import collisionManager from '../managers/CollisionManager.js';
import { cancelSystemDrift } from '../physics/barycentre.js';
import { TARGETING, MARKER, ORBIT, SIMULATION, MASS_DROP } from '../constants.js';
import { toggleControlsOverlay, toggleStateOverlay, toggleStatsOverlay, toggleDebugOverlay } from '../ui/OverlayManager.js';

/**
 * Turns keyboard and pointer input into simulation commands.
 *
 * All of it goes through {@link SceneManager}, so this file only has to know what a key
 * means, not how to carry it out.
 *
 * Keeps a cursor into the list of targetable bodies, which is what makes the arrow keys a
 * tour of the system rather than needing each body to be found by name. That list changes
 * underneath it — bodies can collide and merge — so it subscribes to removals and fixes the
 * cursor up rather than letting it drift onto the wrong body or off the end.
 */
export class InputController {
    /**
     * Wires up the listeners.
     *
     * @param {Array<{name: string, body: Body}>} targetableBodies - The bodies the arrow keys
     *   cycle through, in order. Held by reference and mutated in place when bodies merge.
     * @param {AnimationManager|null} [animationManager=null] - The animation manager; its
     *   presence is what allows speed changes in Kepler mode.
     */
    constructor(targetableBodies, animationManager = null) {
        this.targetableBodies = targetableBodies;
        this.animationManager = animationManager;
        this.currentTargetIndex = TARGETING.INITIAL_TARGET_INDEX;
        this.pressOrigin = null;

        this.setupEventListeners();

        collisionManager.onBodyRemoved((survivor, removed) => this.forgetTarget(survivor, removed));
    }

    /**
     * Drops a merged-away body from the tour and repairs the cursor.
     *
     * Three cases, and each has to be handled or the arrow keys start behaving oddly. A body
     * removed from before the cursor shifts everything down, so the cursor follows. A body
     * removed from after it does not affect it. A body removed *at* the cursor moves the
     * cursor to whatever absorbed it — which is where the viewer would expect to be taken,
     * since that is what the thing they were watching became.
     *
     * @param {Body} survivor - The body that absorbed the other.
     * @param {Body} removed - The body that was merged away.
     * @returns {void}
     */
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

    /**
     * The hierarchy's root body, looked up by name.
     *
     * Read from the hierarchy rather than assumed to be the first entry, since which body is
     * the root depends on the system that was loaded.
     *
     * @returns {Body|null} The root body, or `null` if there is none or it is not targetable.
     */
    getRootBody() {
        const rootBodyName = SceneManager.hierarchyManager.getRootBodyName();
        if (!rootBodyName) return null;

        const rootBodyData = this.targetableBodies.find(body =>
            body.name.toLowerCase() === rootBodyName.toLowerCase()
        );

        return rootBodyData ? rootBodyData.body : null;
    }

    /**
     * Attaches the keyboard, selection and pointer listeners.
     *
     * Keys are taken on the document so they work wherever focus happens to be, but pointer
     * events are taken on the canvas alone — a click on the UI overlay must not drop a mass
     * into the scene behind it.
     *
     * Selection arrives as a window event rather than a direct call, so the UI can announce a
     * selection without needing a reference to this controller.
     *
     * @returns {void}
     */
    setupEventListeners() {
        document.addEventListener('keydown', (event) => this.handleKeydown(event));

        window.addEventListener('planetSelected', (event) => this.handlePlanetSelection(event));

        const canvas = SceneManager.renderer.domElement;
        canvas.addEventListener('pointerdown', (event) => this.handlePointerDown(event));
        canvas.addEventListener('pointerup', (event) => this.handlePointerUp(event));
    }

    /**
     * Records where a press began.
     *
     * Needed because a shift-click drops a mass but a shift-drag orbits the camera, and the
     * two can only be told apart by comparing where the pointer went up with where it went
     * down.
     *
     * @param {PointerEvent} event - The pointer event.
     * @returns {void}
     */
    handlePointerDown(event) {
        this.pressOrigin = { x: event.clientX, y: event.clientY, button: event.button };
    }

    /**
     * Drops a mass, if this was a shift-click rather than a shift-drag.
     *
     * A small tolerance rather than requiring no movement at all, since a pointer almost
     * always shifts by a pixel or two during a click and demanding none of it would make the
     * gesture feel broken.
     *
     * The recorded press is cleared first, whatever happens, so a press whose release did not
     * qualify cannot be matched against some later release.
     *
     * @param {PointerEvent} event - The pointer event.
     * @returns {void}
     */
    handlePointerUp(event) {
        const press = this.pressOrigin;
        this.pressOrigin = null;

        if (!event.shiftKey || !press || press.button !== 0 || event.button !== 0) return;

        const travelled = Math.hypot(event.clientX - press.x, event.clientY - press.y);
        if (travelled > MASS_DROP.DRAG_TOLERANCE_PIXELS) return;

        massDropManager.dropAt(event.clientX, event.clientY);
    }

    /**
     * Dispatches a keypress.
     *
     * Letter keys are matched in both cases, so the bindings work with caps lock on.
     *
     * F3 toggles every overlay at once, including the mobile UI, as a single "show or hide the
     * instrumentation" switch; its default browser action is suppressed.
     *
     * @param {KeyboardEvent} event - The key event.
     * @returns {void}
     */
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

    /**
     * Moves to the previous body, wrapping round at the start.
     *
     * The list length is added before the modulus, since JavaScript's `%` keeps the sign of
     * its left operand and would otherwise return a negative index at the start of the list.
     *
     * @returns {void}
     */
    switchToPreviousTarget() {
        this.currentTargetIndex = (this.currentTargetIndex - 1 + this.targetableBodies.length) % this.targetableBodies.length;
        this.transitionToCurrentTarget();
    }

    /**
     * Moves to the next body, wrapping round at the end.
     *
     * @returns {void}
     */
    switchToNextTarget() {
        this.currentTargetIndex = (this.currentTargetIndex + 1) % this.targetableBodies.length;
        this.transitionToCurrentTarget();
    }

    /**
     * Flies back to the root body.
     *
     * Both the camera and the selection are set, since the selection is what
     * {@link VisibilityManager} keys its orbit and label decisions off — moving the camera
     * alone would leave the display showing whatever was previously selected.
     *
     * @returns {void}
     */
    resetToRoot() {
        const rootBody = this.getRootBody();
        if (rootBody) {
            this.currentTargetIndex = TARGETING.SUN_INDEX;
            SceneManager.setTargetSmooth(rootBody.group);
            SceneManager.onBodySelected(rootBody);
        }
    }

    /**
     * Flies to the body the cursor is on.
     *
     * Useful after the cursor has been moved by a click, where the camera was not brought
     * along.
     *
     * @returns {void}
     */
    smoothTransitionToCurrent() {
        const currentBody = this.targetableBodies[this.currentTargetIndex].body;
        SceneManager.setTargetSmooth(currentBody.group);
        SceneManager.onBodySelected(currentBody);
    }

    /**
     * Flies to the body the cursor is on and selects it.
     *
     * @returns {void}
     */
    transitionToCurrentTarget() {
        const currentTarget = this.targetableBodies[this.currentTargetIndex];
        SceneManager.setTargetSmooth(currentTarget.body.group);

        SceneManager.onBodySelected(currentTarget.body);
    }

    /**
     * Grows or shrinks the body markers, within limits.
     *
     * The sign of the delta chooses the direction and its magnitude the step, so one binding
     * can serve both keys.
     *
     * @param {number} delta - Signed change to the size multiplier.
     * @returns {void}
     */
    adjustMarkerSize(delta) {
        const currentSize = SceneManager.getMarkerSizeMultiplier();
        const newSize = delta > 0
            ? Math.min(currentSize + Math.abs(delta), MARKER.MAX_SIZE_MULTIPLIER)
            : Math.max(currentSize - Math.abs(delta), MARKER.MIN_SIZE_MULTIPLIER);

        SceneManager.setMarkerSizeMultiplier(newSize);
    }

    /**
     * Flies back to the whole-system view.
     *
     * The root body is selected so the display has something to key off, but the camera is
     * pulled right out rather than taken to it.
     *
     * The zoom limit is reapplied on a short delay, after the flight's own limit changes have
     * settled: setting it immediately would have it overwritten by the transition that is
     * about to start.
     *
     * @returns {void}
     */
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

    /**
     * Doubles the simulation speed, up to the maximum.
     *
     * The speed limits are expressed as percentages while the clock holds a plain multiplier,
     * hence the conversion in and back out.
     *
     * The *requested* speed is read rather than the applied one. In n-body mode the applied
     * speed can be held below what was asked for when the integrator cannot keep up, and
     * reading that back would mean each press raised the speed from the throttled value —
     * making it impossible to ask for more than the simulation is currently managing.
     *
     * @returns {void}
     */
    increaseSpeed() {
        const currentSpeed = clockManager.getRequestedSpeedMultiplier() * 100.0;
        const newSpeed = Math.min(currentSpeed * ORBIT.SPEED_FACTOR, ORBIT.MAX_SPEED_MULTIPLIER);

        if (SIMULATION.USE_N_BODY_PHYSICS || this.animationManager) {
            clockManager.setSpeedMultiplier(newSpeed / 100.0);
        }
    }

    /**
     * Halves the simulation speed, down to the minimum.
     *
     * Takes the lower of the requested and applied speeds, the opposite way round from
     * {@link InputController#increaseSpeed}. Slowing down should start from what the viewer
     * is actually seeing: if the simulation has been throttled, halving the requested speed
     * might not visibly change anything at all.
     *
     * @returns {void}
     */
    decreaseSpeed() {
        const currentSpeed = Math.min(clockManager.getSpeedMultiplier(),
            clockManager.getRequestedSpeedMultiplier()) * 100.0;
        const newSpeed = Math.max(currentSpeed / ORBIT.SPEED_FACTOR, ORBIT.MIN_SPEED_MULTIPLIER);

        if (SIMULATION.USE_N_BODY_PHYSICS || this.animationManager) {
            clockManager.setSpeedMultiplier(newSpeed / 100.0);
        }
    }

    /**
     * Returns the simulation to real speed.
     *
     * @returns {void}
     */
    resetSpeed() {
        if (SIMULATION.USE_N_BODY_PHYSICS) {
            clockManager.setSpeedMultiplier(1.0);
        } else if (this.animationManager) {
            clockManager.setSpeedMultiplier(1.0);
        }
    }

    /**
     * Flips the trails that bodies leave behind them.
     *
     * The current selection is passed on because the visibility rules depend on it — the
     * selected body's own trail is treated differently from everything else's.
     *
     * @returns {void}
     */
    toggleOrbitTrails() {
        const currentTarget = this.targetableBodies[this.currentTargetIndex]?.body;
        SceneManager.toggleOrbitTrails(currentTarget);
    }

    /**
     * Flips the drawn orbit paths.
     *
     * @returns {void}
     */
    toggleOrbitLines() {
        const currentTarget = this.targetableBodies[this.currentTargetIndex]?.body;
        SceneManager.toggleAllOrbits(currentTarget);
    }

    /**
     * Flips the body markers and their labels.
     *
     * @returns {void}
     */
    toggleMarkerVisibility() {
        const currentTarget = this.targetableBodies[this.currentTargetIndex]?.body;
        SceneManager.toggleAllMarkers(currentTarget);
    }

    /**
     * Switches between Kepler orbits and n-body integration.
     *
     * Both directions need tidying up. Leaving n-body mode discards any dropped masses, since
     * Kepler orbits are precomputed paths with no way to represent an extra body. Entering it
     * cancels the system's net momentum, because the positions and velocities the integrator
     * starts from generally sum to a drift, and left in place the whole system would slide
     * steadily off across the scene.
     *
     * @returns {void}
     */
    togglePhysicsMode() {
        SIMULATION.togglePhysicsMode();

        if (!SIMULATION.USE_N_BODY_PHYSICS) {
            massDropManager.clearAll();
            return;
        }

        const root = SceneManager.orbitManager?.hierarchy?.body;
        if (root) cancelSystemDrift(root);
    }

    /**
     * Flips the bloom post-processing.
     *
     * @returns {void}
     */
    toggleBloom() {
        SceneManager.toggleBloom();
    }

    /**
     * Moves the cursor to a body selected elsewhere.
     *
     * Only the cursor is moved; the camera is not. The selection has usually come from a
     * click, which has already dealt with the camera, and moving it again here would fight
     * that. The effect is that the arrow keys carry on from wherever the viewer last clicked
     * rather than from wherever they last pressed an arrow key.
     *
     * @param {CustomEvent} event - A `planetSelected` event carrying `detail.bodyName`.
     * @returns {void}
     */
    handlePlanetSelection(event) {
        const bodyName = event.detail.bodyName;

        const targetIndex = this.targetableBodies.findIndex(body =>
            body.name.toLowerCase() === bodyName.toLowerCase()
        );

        if (targetIndex !== TARGETING.NOT_FOUND_INDEX) {
            this.currentTargetIndex = targetIndex;
        }
    }

    /**
     * The entry the cursor is on.
     *
     * @returns {{name: string, body: Body}|undefined} The current entry, or `undefined` if
     *   the list is empty.
     */
    getCurrentTarget() {
        return this.targetableBodies[this.currentTargetIndex];
    }
}

export default InputController;