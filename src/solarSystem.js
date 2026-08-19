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

/**
 * The application's entry point: loads textures, then builds and starts the scene.
 *
 * Two stages, in that order for a reason. Materials are built with their textures already in
 * hand, so nothing has to be created grey and patched up when an image arrives — which would
 * otherwise be visible as bodies popping into detail one at a time. The loading screen covers
 * the wait.
 *
 * A failure at any point leaves the loading screen up showing the error rather than revealing a
 * half-built scene.
 *
 * @returns {Promise<void>} Resolves once the animation loop is running, or once the failure has
 *   been reported.
 */
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

/**
 * Builds the scene, wires the pieces together and starts the animation loop.
 *
 * Order matters here more than the flat sequence suggests. The hierarchy has to exist before
 * anything can be targeted, targets before the input controller, and the camera has to be
 * initialised against the root body before the first frame or it starts pointing at nothing.
 *
 * Several objects are hung on `window`. Mostly that is for the browser console, but it is not
 * only a convenience: {@link Body} reaches for `clockManager` as a bare global, and
 * {@link updateStateDisplay} and {@link MobileUIManager#updateStatus} read
 * `window.InputController`, so those assignments are load-bearing.
 *
 * The overlays are all created hidden, so the scene is unobstructed until F3 is pressed.
 *
 * The skybox is built last of the visual pieces and awaited, but a failure only logs — a
 * missing star field is a cosmetic loss and not worth abandoning the scene over.
 *
 * @param {Object<string, THREE.Texture>} loadedTextures - The preloaded textures. Accepted for
 *   symmetry with the caller, but the handoff to the factories has already happened in the
 *   preload callback by the time this runs.
 * @returns {Promise<void>} Resolves once the animation loop has started.
 */
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
