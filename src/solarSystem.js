import SceneManager from "./managers/SceneManager.js";
import InputController from './controllers/InputController.js';
import AnimationManager from './managers/AnimationManager.js';
import SolarSystemFactory from './factories/SolarSystemFactory.js';
import { performanceConfig } from './utils/ConfigService.js';
import devUtils from './utils/DevUtils.js';
import { log } from './utils/Logger.js';
import Stats from 'stats-gl';
import { TEXTURES } from './assets/index.js';
import { SIMULATION } from './constants.js';
import { createControlsOverlay, createStateOverlay, createStatsOverlay } from './utils/ui.js';
import mobileUI from './utils/MobileUI.js';
import clockManager from './managers/ClockManager.js';


// Initialize development utilities
devUtils.init();

// Initialize stats - always create for performance monitoring but only show UI if enabled
let stats = new Stats({
    horizontal: false,
    trackGPU: true // Always track GPU for our custom charts
});
stats.init(SceneManager.renderer);

// Only add to DOM if performance config is enabled
if (performanceConfig('ENABLE_STATS')) {
    document.body.appendChild(stats.dom);

}


// Create the solar system using the factory
// Use unified structure that supports both physics modes for runtime toggling
let orbits, hierarchy;

const result = SolarSystemFactory.createSolarSystem(SceneManager.scale);
orbits = result.orbits;
hierarchy = result.hierarchy;

console.log(`Solar System: Initialized unified structure supporting both physics modes`);
console.log(`Solar System: Current physics mode: ${SIMULATION.getPhysicsMode()}`);

// Register hierarchy with SceneManager for hierarchical marker visibility
if (hierarchy) {
    SceneManager.registerHierarchy(hierarchy);
    console.log('SolarSystem: Registered hierarchy for hierarchical marker visibility');
}

// N-body system is now handled functionally, no separate object to register

// Initialize animation manager
const animationManager = new AnimationManager(orbits, stats);


// Set up input controls
const targetableBodies = SceneManager.getTargetableBodies(orbits);
const inputController = new InputController(targetableBodies, animationManager);

// Make InputController globally accessible for orbit state checking
if (typeof window !== 'undefined') {
    window.InputController = inputController;
    window.SIMULATION = SIMULATION; // Make SIMULATION accessible for mobile UI
}


// Set up mobile UI with references to other managers
mobileUI.setInputController(inputController);
mobileUI.setAnimationManager(animationManager);



// Initialize camera using CameraController
SceneManager.cameraController.initializeCamera(hierarchy.body);

// Start with root of hierarchy selected to show planet markers and set up hierarchy
SceneManager.onBodySelected(hierarchy.body);

// Register any other stars in the system
orbits?.forEach((orbit) => {
    if (orbit?.body?.isStar) {
        SceneManager.registerStar(orbit.body.group);
        log.info('SolarSystem', `Registered ${orbit.body.name} for bloom effects`);
    }
});

// Expose SceneManager, clockManager, and mobileUI globally for cleanup access
if (typeof window !== 'undefined') {
    window.SceneManager = SceneManager;
    // @ts-ignore: Adding clockManager to window for cleanup access
    window.clockManager = clockManager;
    window.mobileUI = mobileUI;
}

// Initialize skybox with night sky background
log.info('SolarSystem', 'Creating night sky skybox...');
SceneManager.createSkybox(TEXTURES.nightSky)
    .then(() => {
        log.info('SolarSystem', 'Night sky skybox created successfully');
    })
    .catch((error) => {
        log.error('SolarSystem', 'Failed to create skybox:', error);
        // Continue without skybox - it's not critical for functionality
    });

// Create the controls overlay (hidden by default)
createControlsOverlay(false);

// Create the state overlay (hidden by default)
createStateOverlay(false);

// Create the stats overlay (hidden by default)
createStatsOverlay(false);

log.info('SolarSystem', 'Solar system initialization complete - starting animation');
animationManager.start();
