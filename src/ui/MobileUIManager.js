import { log } from '../utils/Logger.js';

class MobileUIManager {
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

    init() {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => this.setupElements());
        } else {
            this.setupElements();
        }

        log.info('MobileUI', 'Mobile UI initialized');
    }

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

    toggleMenu() {
        if (this.isMenuOpen) {
            this.closeMenu();
        } else {
            this.openMenu();
        }
    }

    openMenu() {
        this.isMenuOpen = true;
        this.hamburgerBtn.classList.add('active');
        this.mobileMenu.classList.add('active');

        this.updateStatus();

        log.debug('MobileUI', 'Mobile menu opened');
    }

    closeMenu() {
        this.isMenuOpen = false;
        this.hamburgerBtn.classList.remove('active');
        this.mobileMenu.classList.remove('active');

        log.debug('MobileUI', 'Mobile menu closed');
    }

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

    focusSun() {
        if (typeof window !== 'undefined' && window.SceneManager) {
            const event = new KeyboardEvent('keydown', { code: 'Space', key: ' ' });
            document.dispatchEvent(event);
        }
    }

    navigateToPreviousBody() {
        if (typeof window !== 'undefined' && window.SceneManager) {
            const event = new KeyboardEvent('keydown', { code: 'ArrowLeft', key: 'ArrowLeft' });
            document.dispatchEvent(event);
        }
    }

    navigateToNextBody() {
        if (typeof window !== 'undefined' && window.SceneManager) {
            const event = new KeyboardEvent('keydown', { code: 'ArrowRight', key: 'ArrowRight' });
            document.dispatchEvent(event);
        }
    }

    resetCamera() {
        if (typeof window !== 'undefined' && window.SceneManager) {
            const event = new KeyboardEvent('keydown', { code: 'Backspace', key: 'Backspace' });
            document.dispatchEvent(event);
        }
    }

    increaseSpeed() {
        const event = new KeyboardEvent('keydown', { code: 'KeyQ', key: 'q' });
        document.dispatchEvent(event);
    }

    decreaseSpeed() {
        const event = new KeyboardEvent('keydown', { code: 'KeyA', key: 'a' });
        document.dispatchEvent(event);
    }

    resetSpeed() {
        const event = new KeyboardEvent('keydown', { code: 'KeyW', key: 'w' });
        document.dispatchEvent(event);
    }

    toggleTrails() {
        const event = new KeyboardEvent('keydown', { code: 'KeyT', key: 't' });
        document.dispatchEvent(event);
    }

    toggleOrbitLines() {
        const event = new KeyboardEvent('keydown', { code: 'KeyL', key: 'l' });
        document.dispatchEvent(event);
    }

    toggleMarkers() {
        const event = new KeyboardEvent('keydown', { code: 'KeyM', key: 'm' });
        document.dispatchEvent(event);
    }

    increaseMarkerSize() {
        const event = new KeyboardEvent('keydown', { code: 'Equal', key: '=' });
        document.dispatchEvent(event);
    }

    decreaseMarkerSize() {
        const event = new KeyboardEvent('keydown', { code: 'Minus', key: '-' });
        document.dispatchEvent(event);
    }

    toggleOverlays() {
        const event = new KeyboardEvent('keydown', { code: 'F3', key: 'F3' });
        document.dispatchEvent(event);
    }

    togglePhysics() {
        const event = new KeyboardEvent('keydown', { code: 'KeyP', key: 'p' });
        document.dispatchEvent(event);
    }

    toggleBloom() {
        const event = new KeyboardEvent('keydown', { code: 'KeyB', key: 'b' });
        document.dispatchEvent(event);
    }

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

    setInputController(inputController) {
        this.inputController = inputController;
        log.debug('MobileUI', 'Input controller reference set');
    }

    setAnimationManager(animationManager) {
        this.animationManager = animationManager;
        log.debug('MobileUI', 'Animation manager reference set');
    }

    startStatusUpdates() {
        this.statusUpdateInterval = setInterval(() => {
            if (this.isMenuOpen) {
                this.updateStatus();
            }
        }, 500);
    }

    hideContainer() {
        const container = document.getElementById('mobile-menu-container');
        if (container) {
            container.style.display = 'none';
            this.isContainerHidden = true;
            this.closeMenu();
        }
    }

    showContainer() {
        const container = document.getElementById('mobile-menu-container');
        if (container) {
            container.style.display = 'block';
            this.isContainerHidden = false;
        }
    }

    toggleContainer() {
        if (this.isContainerHidden) {
            this.showContainer();
        } else {
            this.hideContainer();
        }
    }

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