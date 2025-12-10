// Mobile UI Manager for Solar System
// Handles hamburger menu functionality and mobile-specific interactions

import { log } from './Logger.js';

class MobileUI {
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
        // Wait for DOM to be ready
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => this.setupElements());
        } else {
            this.setupElements();
        }

        log.info('MobileUI', 'Mobile UI initialized');
    }

    setupElements() {
        // Get DOM elements
        this.hamburgerBtn = document.getElementById('hamburger-btn');
        this.mobileMenu = document.getElementById('mobile-menu');

        // Get status display elements
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

        // Set up periodic status updates
        this.startStatusUpdates();

        log.info('MobileUI', 'Mobile UI elements setup complete');
    }

    setupEventListeners() {
        // Hamburger button toggle
        this.hamburgerBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.toggleMenu();
        });

        // Menu button clicks
        this.mobileMenu.addEventListener('click', (e) => {
            if (e.target.classList.contains('menu-btn')) {
                e.preventDefault();
                const action = e.target.dataset.action;
                this.handleMenuAction(action);
            }
        });

        // Close menu when clicking outside
        document.addEventListener('click', (e) => {
            if (this.isMenuOpen &&
                !this.mobileMenu.contains(e.target) &&
                !this.hamburgerBtn.contains(e.target)) {
                this.closeMenu();
            }
        });

        // Prevent menu from closing when clicking inside it
        this.mobileMenu.addEventListener('click', (e) => {
            e.stopPropagation();
        });

        // Handle touch events for better mobile experience
        this.setupTouchEvents();

        log.info('MobileUI', 'Event listeners setup complete');
    }

    setupTouchEvents() {
        // Prevent double-tap zoom on buttons
        const buttons = this.mobileMenu.querySelectorAll('.menu-btn');
        buttons.forEach(button => {
            button.addEventListener('touchend', (e) => {
                e.preventDefault();
                // Trigger click after preventing default
                setTimeout(() => {
                    button.click();
                }, 10);
            });
        });

        // Handle hamburger button touch
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

        // Update status when menu opens
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
                default:
                    log.warn('MobileUI', `Unknown action: ${action}`);
                    return;
            }

            // Update status after action
            setTimeout(() => this.updateStatus(), 100);

            // Menu stays open after all actions for easier use

        } catch (error) {
            log.error('MobileUI', `Error handling action ${action}:`, error);
        }
    }

    // Navigation actions
    focusSun() {
        if (typeof window !== 'undefined' && window.SceneManager) {
            // Press spacebar programmatically
            const event = new KeyboardEvent('keydown', { code: 'Space', key: ' ' });
            document.dispatchEvent(event);
        }
    }

    navigateToPreviousBody() {
        if (typeof window !== 'undefined' && window.SceneManager) {
            // Press left arrow programmatically
            const event = new KeyboardEvent('keydown', { code: 'ArrowLeft', key: 'ArrowLeft' });
            document.dispatchEvent(event);
        }
    }

    navigateToNextBody() {
        if (typeof window !== 'undefined' && window.SceneManager) {
            // Press right arrow programmatically
            const event = new KeyboardEvent('keydown', { code: 'ArrowRight', key: 'ArrowRight' });
            document.dispatchEvent(event);
        }
    }

    resetCamera() {
        if (typeof window !== 'undefined' && window.SceneManager) {
            // Press backspace programmatically
            const event = new KeyboardEvent('keydown', { code: 'Backspace', key: 'Backspace' });
            document.dispatchEvent(event);
        }
    }

    // Speed control actions
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

    // Display toggle actions
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

    // Status updates
    updateStatus() {
        try {
            if (typeof window !== 'undefined') {
                // Get current target from InputController
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

                // Get animation speed from clock manager
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

                // Get physics mode from SIMULATION
                if (this.statusElements.physics) {
                    try {
                        // Import SIMULATION from constants if available
                        let physicsMode = 'N-Body'; // Default
                        if (typeof window !== 'undefined' && window.SIMULATION) {
                            physicsMode = window.SIMULATION.getPhysicsMode();
                        }
                        this.statusElements.physics.textContent = physicsMode;
                    } catch (error) {
                        this.statusElements.physics.textContent = 'N-Body';
                    }
                }

                // Get camera distance
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

    // Set references to other managers
    setInputController(inputController) {
        this.inputController = inputController;
        log.debug('MobileUI', 'Input controller reference set');
    }

    setAnimationManager(animationManager) {
        this.animationManager = animationManager;
        log.debug('MobileUI', 'Animation manager reference set');
    }

    // Start periodic status updates
    startStatusUpdates() {
        // Update status every 500ms when menu is open
        this.statusUpdateInterval = setInterval(() => {
            if (this.isMenuOpen) {
                this.updateStatus();
            }
        }, 500);
    }

    // Public API
    isOpen() {
        return this.isMenuOpen;
    }

    forceClose() {
        this.closeMenu();
    }

    hideContainer() {
        const container = document.getElementById('mobile-menu-container');
        if (container) {
            container.style.display = 'none';
            this.isContainerHidden = true;
            // Also close menu if it's open
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

    // Cleanup
    dispose() {
        if (this.hamburgerBtn) {
            this.hamburgerBtn.removeEventListener('click', this.toggleMenu);
        }

        if (this.mobileMenu) {
            this.mobileMenu.removeEventListener('click', this.handleMenuAction);
        }

        document.removeEventListener('click', this.closeMenu);

        // Clear status update interval
        if (this.statusUpdateInterval) {
            clearInterval(this.statusUpdateInterval);
            this.statusUpdateInterval = null;
        }

        log.info('MobileUI', 'Mobile UI disposed');
    }
}

// Create singleton instance
const mobileUI = new MobileUI();

// Export both the class and the singleton
export default mobileUI;
export { MobileUI };