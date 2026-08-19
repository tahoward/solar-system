import { log } from '../utils/Logger.js';

/**
 * The hamburger menu and status readout for touch devices.
 *
 * Every button here works by synthesising the keyboard event its desktop equivalent would
 * produce and dispatching it on the document, where {@link InputController} is already
 * listening. That looks indirect, but it means the two interfaces cannot diverge: there is one
 * implementation of "next planet", and adding a binding to the keyboard handler makes it
 * available to a button for free. The alternative — calling the controller directly — would
 * need a reference to it and would duplicate the dispatch logic.
 *
 * The markup is expected to already be in the page, found by id. If it is not there this
 * quietly disables itself, since a desktop page has no reason to include it.
 *
 * A module singleton, exported as the default; `window.mobileUI` is set elsewhere so
 * {@link InputController}'s F3 handler can reach it.
 */
class MobileUIManager {
    /**
     * Sets up immediately on construction.
     *
     * Safe at module scope because {@link MobileUIManager#init} waits for the document when it
     * has to.
     */
    constructor() {
        this.isMenuOpen = false;
        this.isContainerHidden = false;
        this.hamburgerBtn = null;
        this.mobileMenu = null;
        this.statusElements = {};
        this.inputController = null;
        this.animationManager = null;

        this.init();
    }

    /**
     * Finds the elements, now or once the document is ready.
     *
     * The readiness check is what lets this be constructed at import time: a module loaded in
     * the head would otherwise look for elements the parser has not reached yet, while one
     * loaded at the end of the body can go straight ahead.
     *
     * @returns {void}
     */
    init() {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => this.setupElements());
        } else {
            this.setupElements();
        }

        log.info('MobileUI', 'Mobile UI initialized');
    }

    /**
     * Looks up the elements and, if the essential ones are present, starts working.
     *
     * A missing button or menu disables the whole thing with a warning rather than an error:
     * the page simply is not a mobile one, which is not a fault. The status elements are not
     * required — each is guarded individually where it is written to, so a page can include the
     * menu without the readout.
     *
     * @returns {void}
     */
    setupElements() {
        this.hamburgerBtn = document.getElementById('hamburger-btn');
        this.mobileMenu = document.getElementById('mobile-menu');

        this.statusElements = {
            target: document.getElementById('current-target'),
            speed: document.getElementById('current-speed'),
            physics: document.getElementById('current-physics'),
            distance: document.getElementById('camera-distance')
        };

        if (!this.hamburgerBtn || !this.mobileMenu) {
            log.warn('MobileUI', 'Mobile UI elements not found, mobile functionality disabled');
            return;
        }

        this.setupEventListeners();

        this.startStatusUpdates();

        log.info('MobileUI', 'Mobile UI elements setup complete');
    }

    /**
     * Wires up the button, the menu and the dismiss-on-outside-click behaviour.
     *
     * Menu clicks are handled by one listener on the menu itself rather than one per button, so
     * the buttons only need a `data-action` attribute and no JavaScript has to know what they
     * are.
     *
     * The two listeners on the menu look contradictory but are not: the first acts on button
     * clicks, the second stops any click inside the menu from reaching the document listener
     * that closes it — without which opening the menu and pressing a button would close it
     * again in the same gesture.
     *
     * @returns {void}
     */
    setupEventListeners() {
        this.hamburgerBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.toggleMenu();
        });

        this.mobileMenu.addEventListener('click', (e) => {
            if (e.target.classList.contains('menu-btn')) {
                e.preventDefault();
                const action = e.target.dataset.action;
                this.handleMenuAction(action);
            }
        });

        document.addEventListener('click', (e) => {
            if (this.isMenuOpen &&
                !this.mobileMenu.contains(e.target) &&
                !this.hamburgerBtn.contains(e.target)) {
                this.closeMenu();
            }
        });

        this.mobileMenu.addEventListener('click', (e) => {
            e.stopPropagation();
        });

        this.setupTouchEvents();

        log.info('MobileUI', 'Event listeners setup complete');
    }

    /**
     * Adds touch handling on top of the click handling.
     *
     * Mobile browsers delay the synthetic click after a touch by around 300ms while they wait
     * to see whether a double-tap is coming, which makes the menu feel unresponsive. Acting on
     * `touchend` and suppressing the default removes that wait.
     *
     * The buttons then fire a real click, so there is still only one code path per action. The
     * short timeout before it lets the suppressed default settle first, so the browser does not
     * also deliver its own click and double-fire the action.
     *
     * @returns {void}
     */
    setupTouchEvents() {
        const buttons = this.mobileMenu.querySelectorAll('.menu-btn');
        buttons.forEach(button => {
            button.addEventListener('touchend', (e) => {
                e.preventDefault();
                setTimeout(() => {
                    button.click();
                }, 10);
            });
        });

        this.hamburgerBtn.addEventListener('touchend', (e) => {
            e.preventDefault();
            setTimeout(() => {
                this.toggleMenu();
            }, 10);
        });
    }

    /**
     * Opens the menu if closed, closes it if open.
     *
     * @returns {void}
     */
    toggleMenu() {
        if (this.isMenuOpen) {
            this.closeMenu();
        } else {
            this.openMenu();
        }
    }

    /**
     * Opens the menu.
     *
     * Adds a class rather than setting styles, leaving the appearance and any transition to the
     * stylesheet.
     *
     * The status is refreshed immediately, because the periodic refresh only runs while the
     * menu is open and the viewer would otherwise see values up to half a second stale for the
     * first moment.
     *
     * @returns {void}
     */
    openMenu() {
        this.isMenuOpen = true;
        this.hamburgerBtn.classList.add('active');
        this.mobileMenu.classList.add('active');

        this.updateStatus();

        log.debug('MobileUI', 'Mobile menu opened');
    }

    /**
     * Closes the menu.
     *
     * @returns {void}
     */
    closeMenu() {
        this.isMenuOpen = false;
        this.hamburgerBtn.classList.remove('active');
        this.mobileMenu.classList.remove('active');

        log.debug('MobileUI', 'Mobile menu closed');
    }

    /**
     * Runs the action named by a button's `data-action`.
     *
     * Wrapped in a try/catch because the action names come from markup: a typo or a stale
     * button should log and carry on rather than take the menu down with it.
     *
     * The status refresh is deferred rather than immediate, since most of these actions start
     * something asynchronous — a camera flight, a physics mode change — and reading the state
     * back straight away would show the values from before the action took effect.
     *
     * The menu is deliberately left open, so several adjustments can be made in a row.
     *
     * @param {string} action - The action name from the button's dataset.
     * @returns {void}
     */
    handleMenuAction(action) {
        log.debug('MobileUI', `Handling menu action: ${action}`);

        try {
            switch (action) {
                case 'focusSun':
                    this.focusSun();
                    break;
                case 'prevPlanet':
                    this.navigateToPreviousBody();
                    break;
                case 'nextPlanet':
                    this.navigateToNextBody();
                    break;
                case 'resetCamera':
                    this.resetCamera();
                    break;
                case 'increaseSpeed':
                    this.increaseSpeed();
                    break;
                case 'decreaseSpeed':
                    this.decreaseSpeed();
                    break;
                case 'resetSpeed':
                    this.resetSpeed();
                    break;
                case 'toggleTrails':
                    this.toggleTrails();
                    break;
                case 'toggleOrbitLines':
                    this.toggleOrbitLines();
                    break;
                case 'toggleMarkers':
                    this.toggleMarkers();
                    break;
                case 'increaseMarkers':
                    this.increaseMarkerSize();
                    break;
                case 'decreaseMarkers':
                    this.decreaseMarkerSize();
                    break;
                case 'toggleOverlays':
                    this.toggleOverlays();
                    break;
                case 'togglePhysics':
                    this.togglePhysics();
                    break;
                case 'toggleBloom':
                    this.toggleBloom();
                    break;
                default:
                    log.warn('MobileUI', `Unknown action: ${action}`);
                    return;
            }

            setTimeout(() => this.updateStatus(), 100);

        } catch (error) {
            log.error('MobileUI', `Error handling action ${action}:`, error);
        }
    }

    /**
     * Focuses the root body, as Space does.
     *
     * The `window.SceneManager` check on this and the three below is a guard against acting
     * before the scene exists; the dispatch would otherwise reach a handler with nothing to
     * move.
     *
     * @returns {void}
     */
    focusSun() {
        if (typeof window !== 'undefined' && window.SceneManager) {
            const event = new KeyboardEvent('keydown', { code: 'Space', key: ' ' });
            document.dispatchEvent(event);
        }
    }

    /**
     * Moves to the previous body, as the left arrow does.
     *
     * @returns {void}
     */
    navigateToPreviousBody() {
        if (typeof window !== 'undefined' && window.SceneManager) {
            const event = new KeyboardEvent('keydown', { code: 'ArrowLeft', key: 'ArrowLeft' });
            document.dispatchEvent(event);
        }
    }

    /**
     * Moves to the next body, as the right arrow does.
     *
     * @returns {void}
     */
    navigateToNextBody() {
        if (typeof window !== 'undefined' && window.SceneManager) {
            const event = new KeyboardEvent('keydown', { code: 'ArrowRight', key: 'ArrowRight' });
            document.dispatchEvent(event);
        }
    }

    /**
     * Pulls back to the whole-system view, as Backspace does.
     *
     * @returns {void}
     */
    resetCamera() {
        if (typeof window !== 'undefined' && window.SceneManager) {
            const event = new KeyboardEvent('keydown', { code: 'Backspace', key: 'Backspace' });
            document.dispatchEvent(event);
        }
    }

    /**
     * Doubles the simulation speed, as `Q` does.
     *
     * This and the ones below skip the scene check: they change the clock or a display flag,
     * neither of which needs the scene to be up.
     *
     * @returns {void}
     */
    increaseSpeed() {
        const event = new KeyboardEvent('keydown', { code: 'KeyQ', key: 'q' });
        document.dispatchEvent(event);
    }

    /**
     * Halves the simulation speed, as `A` does.
     *
     * @returns {void}
     */
    decreaseSpeed() {
        const event = new KeyboardEvent('keydown', { code: 'KeyA', key: 'a' });
        document.dispatchEvent(event);
    }

    /**
     * Returns to real speed, as `W` does.
     *
     * @returns {void}
     */
    resetSpeed() {
        const event = new KeyboardEvent('keydown', { code: 'KeyW', key: 'w' });
        document.dispatchEvent(event);
    }

    /**
     * Flips the trails, as `T` does.
     *
     * @returns {void}
     */
    toggleTrails() {
        const event = new KeyboardEvent('keydown', { code: 'KeyT', key: 't' });
        document.dispatchEvent(event);
    }

    /**
     * Flips the orbit lines, as `L` does.
     *
     * @returns {void}
     */
    toggleOrbitLines() {
        const event = new KeyboardEvent('keydown', { code: 'KeyL', key: 'l' });
        document.dispatchEvent(event);
    }

    /**
     * Flips the markers, as `M` does.
     *
     * @returns {void}
     */
    toggleMarkers() {
        const event = new KeyboardEvent('keydown', { code: 'KeyM', key: 'm' });
        document.dispatchEvent(event);
    }

    /**
     * Grows the markers, as `=` does.
     *
     * @returns {void}
     */
    increaseMarkerSize() {
        const event = new KeyboardEvent('keydown', { code: 'Equal', key: '=' });
        document.dispatchEvent(event);
    }

    /**
     * Shrinks the markers, as `-` does.
     *
     * @returns {void}
     */
    decreaseMarkerSize() {
        const event = new KeyboardEvent('keydown', { code: 'Minus', key: '-' });
        document.dispatchEvent(event);
    }

    /**
     * Flips all the debug overlays, as F3 does.
     *
     * Note that the F3 handler also toggles this menu's own container, so pressing this button
     * hides the menu it was pressed from.
     *
     * @returns {void}
     */
    toggleOverlays() {
        const event = new KeyboardEvent('keydown', { code: 'F3', key: 'F3' });
        document.dispatchEvent(event);
    }

    /**
     * Switches between Kepler and n-body, as `P` does.
     *
     * @returns {void}
     */
    togglePhysics() {
        const event = new KeyboardEvent('keydown', { code: 'KeyP', key: 'p' });
        document.dispatchEvent(event);
    }

    /**
     * Flips bloom, as `B` does.
     *
     * @returns {void}
     */
    toggleBloom() {
        const event = new KeyboardEvent('keydown', { code: 'KeyB', key: 'b' });
        document.dispatchEvent(event);
    }

    /**
     * Refreshes the four status readings in the menu.
     *
     * Everything is read off globals rather than injected, and every read is guarded and
     * defaulted. That is deliberate: this runs on a timer independently of the rest of the app,
     * and a status readout is not worth an exception — a missing value should show as `Unknown`
     * or `0`, not stop the timer.
     *
     * Speed is scaled by 100 into the percent-like units the controls use, matching
     * {@link updateStateDisplay}.
     *
     * @returns {void}
     */
    updateStatus() {
        try {
            if (typeof window !== 'undefined') {
                let currentTarget = null;
                if (window.InputController && window.InputController.getCurrentTarget) {
                    currentTarget = window.InputController.getCurrentTarget();
                }
                if (currentTarget && this.statusElements.target) {
                    const targetName = currentTarget.name || 'Unknown';
                    this.statusElements.target.textContent = targetName;
                } else if (this.statusElements.target) {
                    this.statusElements.target.textContent = 'Unknown';
                }

                if (this.statusElements.speed) {
                    let speed = 1.0;
                    try {
                        if (typeof window !== 'undefined' && window.clockManager) {
                            speed = window.clockManager.getSpeedMultiplier() * 100.0;
                        }
                    } catch (error) {
                        speed = 1.0;
                    }
                    const speedText = `${speed.toFixed(1)}x`;
                    this.statusElements.speed.textContent = speedText;
                }

                if (this.statusElements.physics) {
                    try {
                        let physicsMode = 'N-Body';
                        if (typeof window !== 'undefined' && window.SIMULATION) {
                            physicsMode = window.SIMULATION.getPhysicsMode();
                        }
                        this.statusElements.physics.textContent = physicsMode;
                    } catch (error) {
                        this.statusElements.physics.textContent = 'N-Body';
                    }
                }

                if (window.SceneManager && window.SceneManager.camera && window.SceneManager.controls && this.statusElements.distance) {
                    const distance = window.SceneManager.camera.position.distanceTo(
                        window.SceneManager.controls.target
                    );
                    const distanceText = distance.toFixed(1);
                    this.statusElements.distance.textContent = distanceText;
                } else if (this.statusElements.distance) {
                    this.statusElements.distance.textContent = '0';
                }
            }
        } catch (error) {
            log.warn('MobileUI', 'Error updating status:', error);
        }
    }

    /**
     * Stores a reference to the input controller.
     *
     * Kept for callers that want to hand one over, but nothing here uses it: the actions go
     * through dispatched key events and the status readout goes through
     * `window.InputController`.
     *
     * @param {InputController} inputController - The input controller.
     * @returns {void}
     */
    setInputController(inputController) {
        this.inputController = inputController;
        log.debug('MobileUI', 'Input controller reference set');
    }

    /**
     * Stores a reference to the animation manager.
     *
     * As with {@link MobileUIManager#setInputController}, held but not currently read.
     *
     * @param {AnimationManager} animationManager - The animation manager.
     * @returns {void}
     */
    setAnimationManager(animationManager) {
        this.animationManager = animationManager;
        log.debug('MobileUI', 'Animation manager reference set');
    }

    /**
     * Starts the twice-a-second status refresh.
     *
     * On a timer rather than in the animation loop, and skipped entirely while the menu is
     * closed, so the readout costs nothing when it cannot be seen. Half a second is fast enough
     * for text a human is reading and far cheaper than every frame.
     *
     * @returns {void}
     */
    startStatusUpdates() {
        this.statusUpdateInterval = setInterval(() => {
            if (this.isMenuOpen) {
                this.updateStatus();
            }
        }, 500);
    }

    /**
     * Hides the hamburger button and its menu entirely.
     *
     * Closes the menu on the way out, so that reshowing the container does not bring back an
     * open menu the viewer had no chance to dismiss.
     *
     * @returns {void}
     */
    hideContainer() {
        const container = document.getElementById('mobile-menu-container');
        if (container) {
            container.style.display = 'none';
            this.isContainerHidden = true;
            this.closeMenu();
        }
    }

    /**
     * Brings the hamburger button back, closed.
     *
     * @returns {void}
     */
    showContainer() {
        const container = document.getElementById('mobile-menu-container');
        if (container) {
            container.style.display = 'block';
            this.isContainerHidden = false;
        }
    }

    /**
     * Shows or hides the whole mobile interface.
     *
     * Called by {@link InputController}'s F3 handler, so the menu goes away with the rest of the
     * on-screen furniture when the scene is being looked at rather than driven.
     *
     * @returns {void}
     */
    toggleContainer() {
        if (this.isContainerHidden) {
            this.showContainer();
        } else {
            this.hideContainer();
        }
    }

    /**
     * Stops the status timer and attempts to drop the listeners.
     *
     * Only the timer is actually released. The `removeEventListener` calls have no effect: the
     * listeners were registered as arrow functions in
     * {@link MobileUIManager#setupEventListeners}, and the method references passed here are
     * different function objects, so nothing matches. Harmless in practice — this is a
     * singleton that lives as long as the page — but it does mean disposal is not complete.
     *
     * @returns {void}
     */
    dispose() {
        if (this.hamburgerBtn) {
            this.hamburgerBtn.removeEventListener('click', this.toggleMenu);
        }

        if (this.mobileMenu) {
            this.mobileMenu.removeEventListener('click', this.handleMenuAction);
        }

        document.removeEventListener('click', this.closeMenu);

        if (this.statusUpdateInterval) {
            clearInterval(this.statusUpdateInterval);
            this.statusUpdateInterval = null;
        }

        log.info('MobileUI', 'Mobile UI disposed');
    }
}

const mobileUI = new MobileUIManager();

export default mobileUI;
export { MobileUIManager };