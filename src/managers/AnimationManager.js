import SceneManager from './SceneManager.js';
import clockManager from './ClockManager.js';
import devUtils from '../utils/DevUtils.js';
import memoryMonitor from '../utils/MemoryMonitor.js';
import { updateStateOverlay, updateStatsOverlay } from '../utils/ui.js';
import { SIMULATION } from '../constants.js';
import PerformanceStats from '../utils/PerformanceStats.js';

/**
 * Manages the main animation loop and all animated objects in the solar system
 */
export class AnimationManager {
    constructor(orbits, stats) {
        // Input validation
        if (!Array.isArray(orbits)) {
            throw new Error('AnimationManager constructor: orbits must be an array');
        }

        this.orbits = orbits;
        this.stats = stats;
        // nBodySystem parameter is deprecated but kept for compatibility
        this.isRunning = false;

        // Get OrbitManager from SceneManager
        this.orbitManager = SceneManager.orbitManager;

        // Initialize performance stats tracker
        this.performanceStats = new PerformanceStats(60); // 60 samples = ~1 second

        // Physics timing
        this.lastTime = 0;
        this.accumulator = 0;
        this.fixedTimeStep = 1 / 60; // 60 FPS physics updates
        this.lastFrameTime = 0; // For rotation deltaTime calculation


        // Kepler system accumulated time
        this.keplerAccumulatedTime = 0;

        // Bind the animate method to preserve 'this' context
        this.animate = this.animate.bind(this);

        console.log(`AnimationManager: Initialized with ${SIMULATION.USE_N_BODY_PHYSICS ? 'n-body physics' : 'Kepler orbits'}`);
        console.log(`AnimationManager: Using unified ClockManager for time coordination`);
    }

    /**
     * Start the animation loop
     */
    start() {
        if (this.isRunning) {
            console.warn('AnimationManager: Animation loop is already running');
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

        console.log(`AnimationManager: Starting with speed: ${clockManager.getSpeedMultiplier()}x`);
        SceneManager.renderer.setAnimationLoop(this.animate);
    }

    /**
     * Stop the animation loop
     */
    stop() {
        if (!this.isRunning) {
            console.warn('AnimationManager: Animation loop is not running');
            return;
        }

        this.isRunning = false;
        console.log('AnimationManager: Stopping animation loop');
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

            // Update star rotation and effects using unified clock
            this.updateStars();

            // Update all planetary orbits using unified clock
            this.updateOrbits();

            // Update LOD systems for all planets
            this.updateLODSystems();

            // Update scene manager animations (TWEEN)
            this.updateSceneAnimations();

            // Render the scene
            this.render();

            // Update performance stats
            this.updateStats();

            // Update state overlay with current system state
            this.updateStateDisplay();

            // Update stats overlay with performance data
            this.updateStatsDisplay();

            // Record frame for development tools
            devUtils.recordFrame();

            // Check memory usage occasionally
            if (Math.random() < 0.01) { // 1% of frames
                memoryMonitor.check();
            }
        } catch (error) {
            console.error('AnimationManager: Error in animation loop:', error);
            // Continue animation even if one frame fails
        }
    }

    /**
     * Update any stars found in the orbits array (marker, rotation, effects)
     */
    updateStars() {
        const deltaTime = clockManager.getRotationDeltaTime();

        // Find all stars in the orbits array and update them
        this.orbits.forEach(orbit => {
            const body = orbit.body;

            // Skip if this body is not a star
            if (!body.isStar) return;

            // Update star marker using unified clock
            if (body.marker) {
                body.marker.update();
            }

            // Update star rotation with unified clock
            if (body.updateRotation) {
                // Use deltaTime that already includes speed multiplier from clock manager
                body.updateRotation(deltaTime, 1);
            }

            // Update star shader animation if it's using a shader material
            if (body.isShaderMaterial && body.material.updateTime) {
                const currentTime = clockManager.getSimulationTime();
                body.material.updateTime(currentTime);
            }

            // Update star corona effect using unified clock
            if (body.billboard && body.billboard.update) {
                const effectsDeltaTime = clockManager.getEffectsDeltaTime();
                const camera = SceneManager.camera;
                body.billboard.update(effectsDeltaTime, camera);
            }

            // Update star rays effect using unified clock
            if (body.sunRays && body.sunRays.update) {
                const effectsDeltaTime = clockManager.getEffectsDeltaTime();
                // Get camera and star position for rays animation
                const camera = SceneManager.camera;
                const starPosition = body.group.position;
                body.sunRays.update(effectsDeltaTime, camera, starPosition);
            }

            // Update star flares effect using unified clock
            if (body.sunFlares && body.sunFlares.update) {
                const camera = SceneManager.camera;
                // Use animation speed from star configuration (default 0.1 for slow animation)
                const animationSpeed = body.starData?.flares?.animationSpeed || 0.1;
                const currentTime = clockManager.getSimulationTime() * animationSpeed;
                // Pass star material uniforms for synchronization
                const starMaterialUniforms = body.material ? body.material.uniforms : {};
                body.sunFlares.update(currentTime, camera, starMaterialUniforms);
            }

            // Update star glare effect using unified clock
            if (body.sunGlare && body.sunGlare.update) {
                const effectsDeltaTime = clockManager.getEffectsDeltaTime();
                const camera = SceneManager.camera;
                const starPosition = body.group.position;

                // Ensure glare is added to scene if not already (includes bloom layers)
                if (!body.sunGlare.mesh.parent) {
                    body.sunGlare.addToScene(SceneManager.scene);
                }

                // Position glare and all bloom layers at star's world position
                body.sunGlare.getAllMeshes().forEach(mesh => {
                    mesh.position.copy(starPosition);
                    mesh.visible = true;
                    // Make billboard face camera after positioning
                    mesh.lookAt(camera.position);
                });

                // Always keep star visible and let glare handle its own fading overlay
                if (body.mesh) body.mesh.visible = true;

                body.sunGlare.update(effectsDeltaTime, camera, starPosition);
            }
        });
    }

    /**
     * Update all planetary orbits or physics bodies using unified clock
     */
    updateOrbits() {
        if (SIMULATION.USE_N_BODY_PHYSICS) {
            // Use raw delta time - n-body system will apply its own speed multiplier internally
            const physicsDeltaTime = clockManager.getDeltaTime();

            // Use fixed timestep accumulator for physics stability
            this.accumulator += physicsDeltaTime;

            let updateCount = 0;
            // Update physics with fixed timestep using functional n-body physics
            while (this.accumulator >= this.fixedTimeStep) {
                // Update all n-body physics positions using OrbitManager
                if (this.orbitManager && typeof this.orbitManager.updateBodyPositions === 'function') {
                    this.orbitManager.updateBodyPositions(this.fixedTimeStep, SceneManager.scale);
                } else {
                    console.warn('AnimationManager: OrbitManager not available for n-body physics');
                }
                this.accumulator -= this.fixedTimeStep;
                updateCount++;
            }

            // Update atmosphere lighting for n-body physics bodies
            this.updateAtmosphereLighting();

        } else {
            // Use same timestep accumulator approach as n-body for perfect synchronization
            const keplerDeltaTime = clockManager.getDeltaTime();

            // Use same accumulator pattern as n-body
            this.accumulator += keplerDeltaTime;

            let updateCount = 0;
            // Update Kepler orbits with same fixed timestep as n-body
            while (this.accumulator >= this.fixedTimeStep) {
                // Use centralized time calculation from ClockManager
                const timeIncrement = clockManager.getKeplerTimeIncrement(this.fixedTimeStep);
                this.keplerAccumulatedTime += timeIncrement;

                // Update all Kepler orbit positions using OrbitManager
                if (this.orbitManager && typeof this.orbitManager.updateBodyPositions === 'function') {
                    this.orbitManager.updateBodyPositions(this.keplerAccumulatedTime, SceneManager.scale);
                } else {
                    console.warn('AnimationManager: OrbitManager not available, falling back to individual orbit updates');
                    // Fallback to individual orbit updates if OrbitManager is not available
                    this.orbits.forEach(orbit => {
                        if (orbit && typeof orbit.update === 'function') {
                            orbit.update(this.keplerAccumulatedTime);
                        }
                    });
                }

                this.accumulator -= this.fixedTimeStep;
                updateCount++;
            }

            // Update atmosphere lighting for Kepler orbit bodies
            this.updateAtmosphereLighting();

        }
    }

    /**
     * Update LOD systems for all celestial bodies
     */
    updateLODSystems() {
        const camera = SceneManager.camera;
        if (!camera) return;

        // Update LOD for all bodies (including stars) and orbits
        this.orbits.forEach(orbit => {
            if (orbit && orbit.body && typeof orbit.body.updateLOD === 'function') {
                orbit.body.updateLOD(camera);
            }

            // Update orbit line LOD based on camera distance
            if (orbit && typeof orbit.updateLOD === 'function') {
                orbit.updateLOD(camera.position);
            }
        });
    }

    /**
     * Update atmosphere lighting for all bodies with atmospheres
     */
    updateAtmosphereLighting() {
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

        // Only proceed if we found a star
        if (!starPosition) return;

        // Update atmosphere lighting for all orbiting bodies
        this.orbits.forEach(orbit => {
            if (orbit && orbit.body && orbit.body.updateAtmosphereLighting) {
                orbit.body.updateAtmosphereLighting(starPosition, starLightColor);

                // Update shadow light for Saturn (for ring shadows)
                if (orbit.body.name === 'Saturn' && starPosition) {
                    const sceneManager = SceneManager.getInstance ? SceneManager.getInstance() : SceneManager.instance;
                    if (sceneManager && sceneManager.updateShadowLight) {
                        sceneManager.updateShadowLight(starPosition, orbit.body.group.position);
                    }
                }
            }
        });

        // Update bidirectional shadows for all planets and moons
        this.updateBidirectionalShadows();
    }

    /**
     * Update bidirectional shadows: moons cast shadows on planets AND planets cast shadows on moons
     */
    updateBidirectionalShadows() {
        // Try to get HierarchyManager instance
        const hierarchyManager = this.hierarchyManager;

        if (!hierarchyManager || !hierarchyManager.hierarchyMap) {
            return; // No hierarchy data available
        }

        // Create a map of body names to body objects for quick lookup
        const bodyMap = new Map();
        this.orbits.forEach(orbit => {
            if (orbit && orbit.body && orbit.body.name) {
                bodyMap.set(orbit.body.name, orbit.body);
            }
        });

        // Collect all shadow casters for each body
        const shadowCastersMap = new Map();

        // Initialize shadow casters map for all bodies
        hierarchyManager.hierarchyMap.forEach((hierarchyData, bodyName) => {
            shadowCastersMap.set(bodyName, []);
        });

        // Build shadow relationships
        hierarchyManager.hierarchyMap.forEach((hierarchyData, bodyName) => {
            const currentBody = bodyMap.get(bodyName);
            if (!currentBody) return;

            // 1. MOONS CAST SHADOWS ON PLANETS
            // If this body has children (moons), add them as shadow casters for this body (planet)
            if (hierarchyData.children && hierarchyData.children.length > 0) {
                const currentShadowCasters = shadowCastersMap.get(bodyName) || [];

                hierarchyData.children.forEach(childName => {
                    const moonBody = bodyMap.get(childName);
                    if (moonBody) {
                        currentShadowCasters.push(moonBody);
                    }
                });

                shadowCastersMap.set(bodyName, currentShadowCasters);
            }

            // 2. PLANETS CAST SHADOWS ON MOONS
            // If this body has a parent (this is a moon), add parent as shadow caster for this body
            if (hierarchyData.parent) {
                const parentBody = bodyMap.get(hierarchyData.parent);
                if (parentBody) {
                    const currentShadowCasters = shadowCastersMap.get(bodyName) || [];
                    currentShadowCasters.push(parentBody);
                    shadowCastersMap.set(bodyName, currentShadowCasters);
                }
            }
        });

        // Apply all shadows at once for each body
        shadowCastersMap.forEach((shadowCasters, bodyName) => {
            const targetBody = bodyMap.get(bodyName);
            if (targetBody && shadowCasters.length > 0) {
                targetBody.updateMoonShadows(shadowCasters);
            }
        });
    }

    /**
     * Set hierarchy manager reference for moon shadow calculations
     * @param {HierarchyManager} hierarchyManager - The hierarchy manager instance
     */
    setHierarchyManager(hierarchyManager) {
        this.hierarchyManager = hierarchyManager;
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
        console.log('AnimationManager: Animation paused');
    }

    /**
     * Resume a paused animation loop
     */
    resume() {
        if (!this.isRunning) {
            this.isRunning = true;
            console.log('AnimationManager: Animation resumed');
        }
    }

    /**
     * Get animation status
     * @returns {boolean} True if animation is running
     */
    isAnimating() {
        return this.isRunning;
    }

    /**
     * Add a new orbit to the animation loop
     * @param {Object} orbit - The orbit or physics body to add
     */
    addOrbit(orbit) {
        if (!this.orbits.includes(orbit)) {
            this.orbits.push(orbit);
            console.log('AnimationManager: Added new orbit to animation loop');
        }
    }

    /**
     * Remove an orbit from the animation loop
     * @param {Object} orbit - The orbit or physics body to remove
     */
    removeOrbit(orbit) {
        const index = this.orbits.indexOf(orbit);
        if (index !== -1) {
            this.orbits.splice(index, 1);
            console.log('AnimationManager: Removed orbit from animation loop');
        }
    }

    /**
     * Get the current number of animated orbits
     * @returns {number} Number of orbits being animated
     */
    getOrbitCount() {
        return this.orbits.length;
    }


    /**
     * Update the state overlay with current system information
     */
    updateStateDisplay() {
        // Only update occasionally to avoid performance impact
        if (Math.random() < 0.3) { // 30% of frames, ~18fps
            // Get current target from InputController (globally accessible)
            let targetName = 'Unknown';
            let bodyPosition = { x: 0, y: 0, z: 0 };
            if (typeof window !== 'undefined' && window.InputController) {
                const currentTarget = window.InputController.getCurrentTarget();
                targetName = currentTarget?.name || 'Unknown';

                // Get the body position if available
                if (currentTarget?.body?.group?.position) {
                    const pos = currentTarget.body.group.position;
                    bodyPosition = {
                        x: pos.x,
                        y: pos.y,
                        z: pos.z
                    };
                }
            }

            // Get current speed from clock manager and convert to display scale
            const speed = clockManager.getSpeedMultiplier() * 100.0;

            // Get zoom distance from camera to target
            let zoomDistance = 0;
            if (SceneManager.camera && SceneManager.controls?.target) {
                zoomDistance = SceneManager.camera.position.distanceTo(SceneManager.controls.target);
            }

            // Get state from various managers
            const bloomEnabled = SceneManager.isBloomEnabled() || false;
            const markersVisible = this.getMarkersVisibility();

            // Check if orbit trails/lines are visible - we'll need to track this
            const orbitLinesVisible = this.getOrbitLinesVisibility();
            const trailsVisible = this.getTrailsVisibility();

            updateStateOverlay({
                currentTarget: targetName,
                bloomEnabled,
                markersVisible,
                trailsVisible,
                orbitLinesVisible,
                physicsMode: SIMULATION.getPhysicsMode(),
                speed,
                zoomDistance,
                bodyPosition
            });
        }
    }

    /**
     * Update the stats overlay with performance data
     */
    updateStatsDisplay() {
        // Update at 30fps for smooth UI
        if (Math.random() < 0.5) { // 50% of frames, ~30fps at 60fps
            const currentStats = this.performanceStats.getCurrentStats();
            const summary = this.performanceStats.getStatsSummary();
            const timeSeries = this.performanceStats.getTimeSeries();

            updateStatsOverlay({
                current: currentStats,
                summary: summary,
                timeSeries: timeSeries,
                sampleCount: summary.sampleCount
            });
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
        if (typeof window !== 'undefined' && window.SceneManager) {
            return window.SceneManager.areOrbitTrailsVisible();
        }

        return false;
    }

    /**
     * Check if markers are currently visible
     */
    getMarkersVisibility() {
        // Check SceneManager for marker visibility
        if (SceneManager && typeof SceneManager.areMarkersVisible === 'function') {
            return SceneManager.areMarkersVisible();
        }

        // Fallback: check the first orbit's marker visibility as a representative
        if (this.orbits && this.orbits.length > 0) {
            const firstOrbit = this.orbits[0];
            if (firstOrbit && firstOrbit.body && firstOrbit.body.marker) {
                return firstOrbit.body.marker.visible;
            }
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
        this.stats = null;
    }
}

export default AnimationManager;