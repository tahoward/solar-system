import SceneManager from './SceneManager.js';
import clockManager from './ClockManager.js';
import collisionManager from './CollisionManager.js';
import logger from '../utils/Logger.js';
import { updateStateDisplay, updateStatsDisplay, updateDebugOverlay, isStatsOverlayVisible } from '../ui/OverlayManager.js';
import { SIMULATION } from '../constants.js';
import PerformanceStats from '../utils/PerformanceStats.js';

export class AnimationManager {
    constructor(hierarchy, stats) {
        if (!hierarchy || typeof hierarchy !== 'object') {
            throw new Error('AnimationManager constructor: hierarchy must be an object');
        }

        this.orbits = [];
        this._extractOrbits(hierarchy);

        this.hierarchy = hierarchy;
        this.stats = stats;
        this.isRunning = false;

        this.orbitManager = SceneManager.orbitManager;

        this.performanceStats = new PerformanceStats(60);

        this.lastFrameTime = 0;

        this.keplerAccumulatedTime = 0;

        this.frameCount = 0;

        this.animate = this.animate.bind(this);

        logger.info('AnimationManager', `Initialized with ${SIMULATION.USE_N_BODY_PHYSICS ? 'n-body physics' : 'Kepler orbits'}`);
        logger.info('AnimationManager', 'Using unified ClockManager for time coordination');
    }

    start() {
        if (this.isRunning) {
            logger.warn('AnimationManager', 'Animation loop is already running');
            return;
        }

        this.isRunning = true;
        clockManager.start(performance.now());

        clockManager.setSpeedMultiplier(1.0);

        if (this.stats) {
            this.performanceStats.setStatsGL(this.stats);
        }

        logger.info('AnimationManager', `Starting with speed: ${clockManager.getSpeedMultiplier()}x`);
        SceneManager.renderer.setAnimationLoop(this.animate);
    }

    stop() {
        if (!this.isRunning) {
            logger.warn('AnimationManager', 'Animation loop is not running');
            return;
        }

        this.isRunning = false;
        logger.info('AnimationManager', 'Stopping animation loop');
        SceneManager.renderer.setAnimationLoop(null);
    }

    animate(timestamp) {
        if (!this.isRunning) {
            return;
        }

        try {
            if (this.stats && typeof this.stats.update === 'function' && this.#isPerformanceDisplayVisible()) {
                this.stats.update();
            }

            this.performanceStats.update();

            clockManager.update(timestamp);

            this.updateOrbits();

            collisionManager.resolveCollisions();

            SceneManager.updateCamera();

            const star = this.getFirstStar()
            this.hierarchy.body.update(
                this.keplerAccumulatedTime,
                star.starPosition,
                star.starLightColor,
            )

            this.render();

            this.frameCount++;

            if (this.frameCount % 3 === 0) {
                updateStateDisplay(this);

                updateStatsDisplay(this.performanceStats);

                updateDebugOverlay();
            }

        } catch (error) {
            logger.error('AnimationManager', 'Error in animation loop', error);
        }
    }

    #isPerformanceDisplayVisible() {
        return !!this.stats?.dom?.isConnected || isStatsOverlayVisible();
    }

    updateOrbits() {
        const timeIncrement = clockManager.getKeplerTimeIncrement();
        this.keplerAccumulatedTime += timeIncrement;

        this.orbitManager.updateBodyPositions(this.keplerAccumulatedTime, SceneManager.scale);
    }

    getFirstStar() {
        if (!this._starCache || this._starCache.orbitCount !== this.orbits.length) {
            this._starCache = this.#findFirstStar();
        }

        return this._starCache;
    }

    #findFirstStar() {
        let starPosition = null;
        let starLightColor = 0xffffff;

        for (const orbit of this.orbits) {
            if (orbit.body.isStar) {
                starPosition = orbit.body.group.position;

                orbit.body.group.traverse((child) => {
                    if (child.isLight && child.color) {
                        starLightColor = child.color.getHex();
                    }
                });
                break;
            }
        }

        return { starLightColor, starPosition, orbitCount: this.orbits.length };
    }

    render() {
        SceneManager.render();
    }

    pause() {
        this.isRunning = false;
        logger.info('AnimationManager', 'Animation paused');
    }

    resume() {
        if (!this.isRunning) {
            this.isRunning = true;
            logger.info('AnimationManager', 'Animation resumed');
        }
    }

    getOrbitLinesVisibility() {
        if (typeof window !== 'undefined' && window.SceneManager) {
            return window.SceneManager.areOrbitsVisible();
        }

        return true;
    }

    getTrailsVisibility() {
        if (SceneManager && typeof SceneManager.areOrbitTrailsVisible === 'function') {
            return SceneManager.areOrbitTrailsVisible();
        }

        return true;
    }

    getMarkersVisibility() {
        if (SceneManager && typeof SceneManager.areMarkersVisible === 'function') {
            return SceneManager.areMarkersVisible();
        }

        return true;
    }

    dispose() {
        this.stop();

        if (this.orbits) {
            this.orbits.forEach(orbit => {
                if (orbit && orbit.body && typeof orbit.body.dispose === 'function') {
                    orbit.body.dispose();
                }
            });
        }

        if (this.performanceStats) {
            this.performanceStats.dispose();
            this.performanceStats = null;
        }

        this.orbits = [];
        this.hierarchy = null;
        this.stats = null;
    }

    _extractOrbits(node) {
        if (node.orbit) {
            this.orbits.push(node.orbit);
        }
        if (node.children && Array.isArray(node.children)) {
            node.children.forEach(child => this._extractOrbits(child));
        }
    }
}

export default AnimationManager;