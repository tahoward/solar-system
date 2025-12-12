import SceneManager from './SceneManager.js';
import clockManager from './ClockManager.js';
import devUtils from '../utils/DevUtils.js';
import logger from '../utils/Logger.js';
import { updateStateDisplay, updateStatsDisplay, updateDebugOverlay } from '../ui/OverlayManager.js';
import { SIMULATION } from '../constants.js';
import PerformanceStats from '../utils/PerformanceStats.js';

/**
 * Manages the main animation loop and all animated objects in the solar system
 */
export class AnimationManager {
    constructor(hierarchy, stats) {
        // Input validation
        if (!hierarchy || typeof hierarchy !== 'object') {
            throw new Error('AnimationManager constructor: hierarchy must be an object');
        }

        // Extract orbits from hierarchy
        this.orbits = [];
        this._extractOrbits(hierarchy);

        // Store hierarchy reference for future use
        this.hierarchy = hierarchy;
        this.stats = stats;
        // nBodySystem parameter is deprecated but kept for compatibility
        this.isRunning = false;

        // Get OrbitManager from SceneManager
        this.orbitManager = SceneManager.orbitManager;

        // Initialize performance stats tracker
        this.performanceStats = new PerformanceStats(60); // 60 samples = ~1 second

        // Physics timing - simplified for adaptive timestep
        this.lastTime = 0;
        this.lastFrameTime = 0; // For rotation deltaTime calculation

        // Kepler system accumulated time
        this.keplerAccumulatedTime = 0;


        // Bind the animate method to preserve 'this' context
        this.animate = this.animate.bind(this);

        logger.info('AnimationManager', `Initialized with ${SIMULATION.USE_N_BODY_PHYSICS ? 'n-body physics' : 'Kepler orbits'}`);
        logger.info('AnimationManager', 'Using unified ClockManager for time coordination');
    }

    /**
     * Start the animation loop
     */
    start() {
        if (this.isRunning) {
            logger.warn('AnimationManager', 'Animation loop is already running');
            return;
        }

        this.isRunning = true;
        // Initialize the unified clock with proper time scaling for orbital synchronization
        clockManager.start(performance.now());

        // Set orbital time scale (legacy - no longer used with simplified ClockManager)
        clockManager.setOrbitalTimeScale(5.0);
        clockManager.setSpeedMultiplier(1.0); // 1.0 = 100x speed equivalent for both modes

        // Initialize performance stats with stats-gl if available
        if (this.stats) {
            this.performanceStats.setStatsGL(this.stats);
        }

        logger.info('AnimationManager', `Starting with speed: ${clockManager.getSpeedMultiplier()}x`);
        SceneManager.renderer.setAnimationLoop(this.animate);
    }

    /**
     * Stop the animation loop
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
     * Main animation loop function
     * @param {number} timestamp - Current timestamp from requestAnimationFrame
     */
    animate(timestamp) {
        if (!this.isRunning) {
            return;
        }

        try {
            // Update stats-gl first if available
            if (this.stats && typeof this.stats.update === 'function') {
                this.stats.update();
            }

            

            // Update performance stats (call at start of frame)
            this.performanceStats.update();

            // Update the unified clock system
            clockManager.update(timestamp);

            // Update all planetary orbits using unified clock first
            this.updateOrbits();

            // Update star rotation and effects using unified clock (after orbit positions are updated)
            const star = this.getFirstStar()
            this.hierarchy.body.update(
                clockManager.getRotationDeltaTime(),
                1,
                star.starPosition,
                star.starLightColor,
            )

            // Update scene manager animations (TWEEN)
            this.updateSceneAnimations();

            // Render the scene
            this.render();

            // Update performance stats
            this.updateStats();

            // Update state overlay with current system state
            updateStateDisplay(this);

            // Update stats overlay with performance data
            updateStatsDisplay(this.performanceStats);

            // Update debug overlay with live data
            updateDebugOverlay();


            // Record frame for development tools
            devUtils.recordFrame();

        } catch (error) {
            logger.error('AnimationManager', 'Error in animation loop', error);
            // Continue animation even if one frame fails
        }
    }

    /**
     * Update all planetary orbits or physics bodies using unified clock with adaptive timestep
     */
    updateOrbits() {
        // Get adaptive timestep increment from ClockManager
        const timeIncrement = clockManager.getKeplerTimeIncrement();
        this.keplerAccumulatedTime += timeIncrement;

        // Update all Kepler orbit positions using OrbitManager
        this.orbitManager.updateBodyPositions(this.keplerAccumulatedTime, SceneManager.scale);
    }


    /**
     * Update atmosphere lighting for all bodies with atmospheres
     */
    getFirstStar() {
        // Find the first star in the orbits array to use as light source
        let starPosition = null;
        let starLightColor = 0xffffff; // Default white

        for (const orbit of this.orbits) {
            if (orbit.body.isStar) {
                starPosition = orbit.body.group.position;

                // Get star light color from the attached light
                orbit.body.group.traverse((child) => {
                    if (child.isLight && child.color) {
                        starLightColor = child.color.getHex();
                    }
                });
                break; // Use first star found
            }
        }

        return { starLightColor, starPosition }
    }

    /**
     * Update scene manager animations (TWEEN library)
     */
    updateSceneAnimations() {
        SceneManager.updateAnimations();
    }

    /**
     * Render the scene
     */
    render() {
        SceneManager.render();
    }

    /**
     * Update performance statistics
     */
    updateStats() {
        if (this.stats && typeof this.stats.update === 'function') {
            this.stats.update();
        }
    }

    /**
     * Pause the animation loop (keeps it registered but stops updates)
     */
    pause() {
        this.isRunning = false;
        logger.info('AnimationManager', 'Animation paused');
    }

    /**
     * Resume a paused animation loop
     */
    resume() {
        if (!this.isRunning) {
            this.isRunning = true;
            logger.info('AnimationManager', 'Animation resumed');
        }
    }


    /**
     * Check if orbit lines are currently visible
     */
    getOrbitLinesVisibility() {
        // Get orbit lines state from SceneManager's VisibilityManager
        if (typeof window !== 'undefined' && window.SceneManager) {
            return window.SceneManager.areOrbitsVisible();
        }

        return true; // Default to visible
    }

    /**
     * Check if orbit trails are currently visible
     */
    getTrailsVisibility() {
        // Get orbit trails state from SceneManager's VisibilityManager
        if (SceneManager && typeof SceneManager.areMarkersVisible === 'function') {
            return SceneManager.areOrbitTrailsVisible();
        }

        return true;
    }

    /**
     * Check if markers are currently visible
     */
    getMarkersVisibility() {
        // Check SceneManager for marker visibility
        if (SceneManager && typeof SceneManager.areMarkersVisible === 'function') {
            return SceneManager.areMarkersVisible();
        }

        return true; // Default to visible
    }

    /**
     * Clean up resources and stop animation
     */
    dispose() {
        this.stop();

        // Dispose of all orbits and their bodies (including stars)
        if (this.orbits) {
            this.orbits.forEach(orbit => {
                if (orbit && orbit.body && typeof orbit.body.dispose === 'function') {
                    orbit.body.dispose();
                }
            });
        }

        // Dispose performance stats
        if (this.performanceStats) {
            this.performanceStats.dispose();
            this.performanceStats = null;
        }

        // Clear references
        this.orbits = [];
        this.hierarchy = null;
        this.stats = null;
    }

    /**
     * Extract all orbits from hierarchy structure into flat array
     * @private
     * @param {Object} node - Hierarchy node to traverse
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