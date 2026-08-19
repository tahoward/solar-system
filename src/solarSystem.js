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
import { createControlsOverlay, createStateOverlay, createStatsOverlay } from './ui/OverlayManager.js';
import mobileUI from './ui/MobileUIManager.js';
import clockManager from './managers/ClockManager.js';
import TexturePreloader from './utils/TexturePreloader.js';
import LoadingScreen from './ui/LoadingScreen.js';
import { MaterialFactory } from './factories/MaterialFactory.js';
import Body from './model/Body.js';

async function initializeSolarSystem() {
    devUtils.init();

    const loadingScreen = new LoadingScreen();
    loadingScreen.show();

    const texturePreloader = new TexturePreloader();

    texturePreloader.setCallbacks(
        (loaded, total, percentage) => {
            loadingScreen.updateProgress(loaded, total, percentage);
        },
        (loadedTextures) => {
            loadingScreen.showComplete();
            MaterialFactory.setPreloadedTextures(loadedTextures);
            Body.setPreloadedTextures(loadedTextures);
            SceneManager.skyboxManager.setPreloadedTextures(loadedTextures);
        },
        (error) => {
            log.error('SolarSystem', 'Failed to preload textures', error);
            loadingScreen.showError('Failed to load textures');
        }
    );

    try {
        loadingScreen.updateStatus('Initializing texture preloader...');
        const loadedTextures = await texturePreloader.preloadTextures();

        await new Promise(resolve => setTimeout(resolve, 800));

        loadingScreen.updateStatus('Initializing solar system...');
        await initializeScene(loadedTextures);

        await loadingScreen.hide();

        log.info('SolarSystem', 'Solar system initialization complete with preloaded textures');
    } catch (error) {
        log.error('SolarSystem', 'Failed to initialize solar system', error);
        loadingScreen.showError(error.message);
    }
}

async function initializeScene(loadedTextures) {
    let stats = new Stats({
        horizontal: false,
        trackGPU: true
    });
    stats.init(SceneManager.renderer);

    if (performanceConfig('ENABLE_STATS')) {
        document.body.appendChild(stats.dom);
    }

    const hierarchy = SolarSystemFactory.createSolarSystem();

    log.info('SolarSystem', `Initialized unified structure supporting both physics modes`);
    log.info('SolarSystem', `Current physics mode: ${SIMULATION.getPhysicsMode()}`);

    if (hierarchy) {
        SceneManager.registerHierarchy(hierarchy);
        log.info('SolarSystem', 'Registered hierarchy for hierarchical marker visibility');
    }

    const animationManager = new AnimationManager(hierarchy, stats);

    const targetableBodies = SceneManager.getTargetableBodies(animationManager.orbits);
    const inputController = new InputController(targetableBodies, animationManager);

    if (typeof window !== 'undefined') {
        window.InputController = inputController;
        window.SIMULATION = SIMULATION;
    }

    mobileUI.setInputController(inputController);
    mobileUI.setAnimationManager(animationManager);

    SceneManager.cameraController.initializeCamera(hierarchy.body);

    SceneManager.onBodySelected(hierarchy.body);

    if (typeof window !== 'undefined') {
        window.SceneManager = SceneManager;
        window.clockManager = clockManager;
        window.mobileUI = mobileUI;
    }

    log.info('SolarSystem', 'Creating night sky skybox...');
    await SceneManager.createSkybox(TEXTURES.nightSky)
        .then(() => {
            log.info('SolarSystem', 'Night sky skybox created successfully');
        })
        .catch((error) => {
            log.error('SolarSystem', 'Failed to create skybox:', error);
        });

    createControlsOverlay(false);

    createStateOverlay(false);

    createStatsOverlay(false);

    log.info('SolarSystem', 'Solar system initialization complete - starting animation');
    animationManager.start();
}

initializeSolarSystem().catch(error => {
    log.error('SolarSystem', 'Failed to initialize solar system', error);
});
