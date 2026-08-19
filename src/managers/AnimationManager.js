import SceneManager from './SceneManager.js';
import clockManager from './ClockManager.js';
import collisionManager from './CollisionManager.js';
import logger from '../utils/Logger.js';
import { updateStateDisplay, updateStatsDisplay, updateDebugOverlay, isStatsOverlayVisible } from '../ui/OverlayManager.js';
import { SIMULATION } from '../constants.js';
import PerformanceStats from '../utils/PerformanceStats.js';

/**
 * The main loop: advances the simulation and draws each frame.
 *
 * Frame order matters and is fixed here — the clock is advanced, then positions,
 * then collisions, then the camera, then the bodies' own per-frame update, and
 * only then the render. Drawing before the camera has been moved, for instance,
 * would leave the view a frame behind the bodies it is following.
 *
 * The whole frame is wrapped in a `try`/`catch`, because an uncaught throw inside
 * `setAnimationLoop` kills the loop outright and leaves a frozen canvas with no
 * indication of why.
 */
export class AnimationManager {
    /**
     * Prepares the loop for a hierarchy, without starting it.
     *
     * @param {Object} hierarchy - Root hierarchy node.
     * @param {Object} [stats] - Optional `stats-gl` instance for the performance
     *   overlay.
     * @throws {Error} If `hierarchy` is not an object.
     */
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

    /**
     * Starts the render loop and the clock.
     *
     * Uses the renderer's own animation loop rather than `requestAnimationFrame`
     * directly, since that is what WebXR requires.
     *
     * @returns {void}
     */
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

    /**
     * Stops the render loop.
     *
     * @returns {void}
     */
    stop() {
        if (!this.isRunning) {
            logger.warn('AnimationManager', 'Animation loop is not running');
            return;
        }

        this.isRunning = false;
        logger.info('AnimationManager', 'Stopping animation loop');
        SceneManager.renderer.setAnimationLoop(null);
    }

    /**
     * Runs one frame: advance the simulation, then draw it.
     *
     * The lighting the bodies are updated with comes from the system's star, which
     * is why {@link AnimationManager#getFirstStar} is consulted before the update
     * rather than after.
     *
     * The overlays are refreshed every third frame — they read a good deal of state
     * and touch the DOM, and at 60 fps a 20 Hz update is indistinguishable.
     *
     * Errors are caught and logged so a single bad frame does not stop the loop.
     *
     * @param {number} timestamp - Frame timestamp in milliseconds, from the renderer.
     * @returns {void}
     */
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

    /**
     * Reports whether any performance readout is on screen.
     *
     * `stats-gl` issues GPU timer queries when updated, which is not free, so it is
     * only stepped while something is actually displaying its output.
     *
     * @private
     * @returns {boolean} `true` if the stats panel or the stats overlay is visible.
     */
    #isPerformanceDisplayVisible() {
        return !!this.stats?.dom?.isConnected || isStatsOverlayVisible();
    }

    /**
     * Advances simulation time and moves every body.
     *
     * Time is accumulated here rather than read from the clock's own total, because
     * this is the timeline the bodies' orbital positions and rotations are
     * evaluated against and it must not jump.
     *
     * @returns {void}
     */
    updateOrbits() {
        const timeIncrement = clockManager.getKeplerTimeIncrement();
        this.keplerAccumulatedTime += timeIncrement;

        this.orbitManager.updateBodyPositions(this.keplerAccumulatedTime, SceneManager.scale);
    }

    /**
     * Returns the system's light source, cached between frames.
     *
     * Finding the star means traversing the scene graph for its light, which is far
     * too much to repeat every frame. The cache is invalidated when the orbit count
     * changes, which is the cheapest available signal that the hierarchy has been
     * altered.
     *
     * @returns {{starPosition: THREE.Vector3|null, starLightColor: number,
     *   orbitCount: number}} The star's live position, its light colour as a hex
     *   value, and the orbit count the cache was built at.
     */
    getFirstStar() {
        if (!this._starCache || this._starCache.orbitCount !== this.orbits.length) {
            this._starCache = this.#findFirstStar();
        }

        return this._starCache;
    }

    /**
     * Searches the orbits for the first star and its light colour.
     *
     * The position is stored by reference, not copied, so the cached value keeps
     * tracking the star as it moves.
     *
     * @private
     * @returns {{starPosition: THREE.Vector3|null, starLightColor: number,
     *   orbitCount: number}} The star's position and light colour, defaulting to
     *   white if no light is found.
     */
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

    /**
     * Draws the scene.
     *
     * @returns {void}
     */
    render() {
        SceneManager.render();
    }

    /**
     * Stops updating and drawing, leaving the loop registered.
     *
     * @returns {void}
     */
    pause() {
        this.isRunning = false;
        logger.info('AnimationManager', 'Animation paused');
    }

    /**
     * Resumes updating and drawing.
     *
     * @returns {void}
     */
    resume() {
        if (!this.isRunning) {
            this.isRunning = true;
            logger.info('AnimationManager', 'Animation resumed');
        }
    }

    /**
     * Reports whether orbit lines are shown, for the state overlay.
     *
     * @returns {boolean} `true` if orbits are visible, or if the scene manager is not
     *   yet reachable.
     */
    getOrbitLinesVisibility() {
        if (typeof window !== 'undefined' && window.SceneManager) {
            return window.SceneManager.areOrbitsVisible();
        }

        return true;
    }

    /**
     * Reports whether orbit trails are shown, for the state overlay.
     *
     * @returns {boolean} `true` if trails are visible, or if the scene manager cannot
     *   answer.
     */
    getTrailsVisibility() {
        if (SceneManager && typeof SceneManager.areOrbitTrailsVisible === 'function') {
            return SceneManager.areOrbitTrailsVisible();
        }

        return true;
    }

    /**
     * Reports whether markers are shown, for the state overlay.
     *
     * @returns {boolean} `true` if markers are visible, or if the scene manager cannot
     *   answer.
     */
    getMarkersVisibility() {
        if (SceneManager && typeof SceneManager.areMarkersVisible === 'function') {
            return SceneManager.areMarkersVisible();
        }

        return true;
    }

    /**
     * Stops the loop and disposes every body in the hierarchy.
     *
     * @returns {void}
     */
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

    /**
     * Collects every orbit in a hierarchy into a flat list.
     *
     * Flattened once at construction so the per-frame code iterates an array instead
     * of recursing the tree.
     *
     * @private
     * @param {Object} node - Node to descend from.
     * @returns {void}
     */
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