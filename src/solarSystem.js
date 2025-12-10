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
import TexturePreloader from './utils/TexturePreloader.js';
import LoadingScreen from './ui/LoadingScreen.js';
import { MaterialFactory } from './factories/MaterialFactory.js';
import Body from './model/Body.js';

/**
 * Initialize the solar system with texture preloading and loading screen
 */
async function initializeSolarSystem() {
    // Initialize development utilities
    devUtils.init();

    // Create and show loading screen
    const loadingScreen = new LoadingScreen();
    loadingScreen.show();

    // Create texture preloader
    const texturePreloader = new TexturePreloader();

    // Set up loading callbacks
    texturePreloader.setCallbacks(
        // On progress
        (loaded, total, percentage) => {
            loadingScreen.updateProgress(loaded, total, percentage);
        },
        // On complete
        (loadedTextures) => {
            loadingScreen.showComplete();
            // Set preloaded textures in factories
            MaterialFactory.setPreloadedTextures(loadedTextures);
            Body.setPreloadedTextures(loadedTextures);
            SceneManager.skyboxManager.setPreloadedTextures(loadedTextures);
        },
        // On error
        (error) => {
            console.error('Failed to preload textures:', error);
            loadingScreen.showError('Failed to load textures');
        }
    );

    try {
        // Preload all textures
        loadingScreen.updateStatus('Initializing texture preloader...');
        const loadedTextures = await texturePreloader.preloadTextures();

        // Brief delay to show completion status
        await new Promise(resolve => setTimeout(resolve, 800));

        // Initialize the rest of the solar system
        loadingScreen.updateStatus('Initializing solar system...');
        await initializeScene(loadedTextures);

        // Hide loading screen with fade
        await loadingScreen.hide();

        log.info('SolarSystem', 'Solar system initialization complete with preloaded textures');
    } catch (error) {
        console.error('Failed to initialize solar system:', error);
        loadingScreen.showError(error.message);
    }
}

/**
 * Initialize the scene after textures are preloaded
 * @param {Map<string, THREE.Texture>} loadedTextures - Preloaded textures
 */
async function initializeScene(loadedTextures) {
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

    // Connect hierarchy manager to animation manager for moon shadows
    if (hierarchy) {
        if (SceneManager && SceneManager.hierarchyManager) {
            animationManager.setHierarchyManager(SceneManager.hierarchyManager);
        }
    }

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
    await SceneManager.createSkybox(TEXTURES.nightSky)
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
}

// Start the initialization process
initializeSolarSystem().catch(error => {
    console.error('Failed to initialize solar system:', error);
});
