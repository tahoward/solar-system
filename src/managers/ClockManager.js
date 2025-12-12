/**
 * ClockManager - Unified time system for the solar system simulation
 *
 * Provides a single source of truth for all time-related calculations across:
 * - Kepler orbits
 * - N-body physics
 * - Body rotations
 * - Visual effects
 * - Material animations
 */

import { log } from '../utils/Logger.js';
import { ORBIT } from '../constants.js';

export class ClockManager {
    constructor() {
        // Simulation time state
        this.simulationTime = 0;        // Current simulation time in seconds
        this.realTime = 0;              // Real world time since start in seconds
        this.lastFrameTime = 0;         // Last requestAnimationFrame timestamp
        this.deltaTime = 0;             // Frame delta time in seconds
        this.isRunning = false;         // Paused state

        // Speed and scaling controls
        this.speedMultiplier = 1.0;     // Global simulation speed (1.0 = normal)
        this.timeScale = 1.0;           // Time compression for orbital mechanics
        this.maxDeltaTime = 0.1;        // Cap frame time to prevent large jumps

        // Orbital time scaling (for realistic orbital periods)
        this.orbitalTimeScale = 1.0;    // Separate scale for orbital motion vs rotation

        // Internal state
        this.startTime = 0;             // When simulation started
        this.pausedTime = 0;            // Accumulated paused time
        this.lastPauseStart = 0;        // When current pause started

        // Adaptive timestep system
        this.adaptiveTimestep = {
            enabled: true,                    // Enable adaptive timestep
            targetFPS: 60,                   // Target frame rate
            minTimestep: 1/120,              // Minimum timestep (120 FPS)
            maxTimestep: 1/30,               // Maximum timestep (30 FPS)
            smoothingFactor: 0.1,            // Delta time smoothing (0.1 = 10% new, 90% old)
            smoothedDeltaTime: 1/60,         // Smoothed delta time for stable physics
            frameTimeHistory: [],            // Frame time history for analysis
            historyLength: 10,               // Number of frames to keep in history
            adaptationRate: 0.05,            // How quickly to adapt timestep (5%)
            performanceThreshold: 0.016      // 60 FPS threshold in seconds
        };

        log.init('ClockManager', 'Initialized unified clock system with adaptive timestep');
    }

    /**
     * Start the clock (call once at initialization)
     * @param {number} initialTimestamp - Initial requestAnimationFrame timestamp
     */
    start(initialTimestamp) {
        this.startTime = initialTimestamp;
        this.lastFrameTime = initialTimestamp;
        this.isRunning = true;
        this.simulationTime = 0;
        this.realTime = 0;
        this.pausedTime = 0;

        log.debug('ClockManager', 'Clock started');
    }

    /**
     * Update the clock (call every frame)
     * @param {number} timestamp - Current requestAnimationFrame timestamp
     */
    update(timestamp) {
        if (!this.isRunning) {
            return;
        }

        // Calculate real frame delta time (capped for stability)
        const rawDeltaTime = this.lastFrameTime ? (timestamp - this.lastFrameTime) / 1000 : 1/60;
        this.deltaTime = Math.min(rawDeltaTime, this.maxDeltaTime);
        this.lastFrameTime = timestamp;

        // Update adaptive timestep system
        this.updateAdaptiveTimestep(this.deltaTime);

        // Update real time (wall clock time since start, excluding pauses)
        this.realTime = (timestamp - this.startTime - this.pausedTime) / 1000;

        // Update simulation time using adaptive timestep if enabled
        const effectiveDeltaTime = this.adaptiveTimestep.enabled ?
            this.adaptiveTimestep.smoothedDeltaTime : this.deltaTime;

        const simulationDelta = effectiveDeltaTime * this.speedMultiplier * this.timeScale;
        this.simulationTime += simulationDelta;
    }

    /**
     * Pause the simulation
     */
    pause() {
        if (this.isRunning) {
            this.isRunning = false;
            this.lastPauseStart = performance.now();
            log.debug('ClockManager', 'Clock paused');
        }
    }

    /**
     * Resume the simulation
     */
    resume() {
        if (!this.isRunning) {
            this.isRunning = true;
            // Accumulate the paused time
            if (this.lastPauseStart > 0) {
                this.pausedTime += performance.now() - this.lastPauseStart;
            }
            log.debug('ClockManager', 'Clock resumed');
        }
    }

    /**
     * Toggle pause/resume
     */
    toggle() {
        if (this.isRunning) {
            this.pause();
        } else {
            this.resume();
        }
    }

    /**
     * Reset the simulation time to zero
     */
    reset() {
        const currentTimestamp = performance.now();
        this.start(currentTimestamp);

        // Reset adaptive timestep history
        this.adaptiveTimestep.frameTimeHistory = [];
        this.adaptiveTimestep.smoothedDeltaTime = 1/60;

        log.debug('ClockManager', 'Clock reset');
    }

    /**
     * Update the adaptive timestep system
     * @param {number} currentDeltaTime - Current frame delta time
     */
    updateAdaptiveTimestep(currentDeltaTime) {
        if (!this.adaptiveTimestep.enabled) {
            return;
        }

        const adaptive = this.adaptiveTimestep;

        // Add current frame time to history
        adaptive.frameTimeHistory.push(currentDeltaTime);
        if (adaptive.frameTimeHistory.length > adaptive.historyLength) {
            adaptive.frameTimeHistory.shift();
        }

        // Calculate average frame time over history
        const avgFrameTime = adaptive.frameTimeHistory.reduce((sum, time) => sum + time, 0) /
                            adaptive.frameTimeHistory.length;

        // Determine target timestep based on performance
        let targetTimestep;
        if (avgFrameTime > adaptive.performanceThreshold) {
            // Performance is poor, use larger timestep for stability
            targetTimestep = Math.min(avgFrameTime * 0.8, adaptive.maxTimestep);
        } else {
            // Performance is good, use smaller timestep for accuracy
            targetTimestep = Math.max(avgFrameTime, adaptive.minTimestep);
        }

        // Smoothly adapt towards target timestep
        const timestepDifference = targetTimestep - adaptive.smoothedDeltaTime;
        adaptive.smoothedDeltaTime += timestepDifference * adaptive.adaptationRate;

        // Clamp to min/max bounds
        adaptive.smoothedDeltaTime = Math.max(adaptive.minTimestep,
            Math.min(adaptive.maxTimestep, adaptive.smoothedDeltaTime));

        // Apply additional smoothing for stability
        const smoothingFactor = adaptive.smoothingFactor;
        adaptive.smoothedDeltaTime = (1 - smoothingFactor) * adaptive.smoothedDeltaTime +
                                    smoothingFactor * currentDeltaTime;
    }

    /**
     * Set simulation speed multiplier
     * @param {number} multiplier - Speed multiplier (1.0 = normal, 2.0 = 2x speed, 0.5 = half speed)
     */
    setSpeedMultiplier(multiplier) {
        // Use ORBIT constants for consistent speed limits across systems
        const maxClockSpeed = ORBIT.MAX_SPEED_MULTIPLIER / 100.0; // Convert display scale to ClockManager scale
        this.speedMultiplier = Math.max(ORBIT.MIN_SPEED_MULTIPLIER / 100.0, Math.min(multiplier, maxClockSpeed));
        log.debug('ClockManager', `Speed multiplier set to ${this.speedMultiplier}x`);
    }

    /**
     * Set time scale for orbital mechanics
     * @param {number} scale - Time scale for orbital calculations
     */
    setTimeScale(scale) {
        this.timeScale = Math.max(0, scale);
        log.debug('ClockManager', `Time scale set to ${this.timeScale}`);
    }

    /**
     * Set orbital time scale (separate from general time scale)
     * @param {number} scale - Time scale specifically for orbital motion
     */
    setOrbitalTimeScale(scale) {
        this.orbitalTimeScale = Math.max(0, scale);
        log.debug('ClockManager', `Orbital time scale set to ${this.orbitalTimeScale}`);
    }

    // === TIME GETTERS FOR DIFFERENT SYSTEMS ===

    /**
     * Get current simulation time in seconds (for general use)
     * @returns {number} Simulation time in seconds
     */
    getSimulationTime() {
        return this.simulationTime;
    }

    /**
     * Get current simulation time in milliseconds (for Kepler orbits)
     * @returns {number} Simulation time in milliseconds
     */
    getSimulationTimeMs() {
        return this.simulationTime * 1000;
    }

    /**
     * Get frame delta time in seconds (for rotations, effects)
     * @returns {number} Delta time in seconds
     */
    getDeltaTime() {
        return this.adaptiveTimestep.enabled ?
            this.adaptiveTimestep.smoothedDeltaTime : this.deltaTime;
    }

    /**
     * Get raw frame delta time (unprocessed by adaptive timestep)
     * @returns {number} Raw delta time in seconds
     */
    getRawDeltaTime() {
        return this.deltaTime;
    }

    /**
     * Get scaled delta time for physics simulation
     * @returns {number} Delta time scaled for physics
     */
    getPhysicsDeltaTime() {
        const effectiveDeltaTime = this.adaptiveTimestep.enabled ?
            this.adaptiveTimestep.smoothedDeltaTime : this.deltaTime;
        return effectiveDeltaTime * this.speedMultiplier * this.timeScale;
    }

    /**
     * Get scaled delta time for orbital calculations
     * @returns {number} Delta time scaled for orbital motion
     */
    getOrbitalDeltaTime() {
        const effectiveDeltaTime = this.adaptiveTimestep.enabled ?
            this.adaptiveTimestep.smoothedDeltaTime : this.deltaTime;
        return effectiveDeltaTime * this.speedMultiplier * this.orbitalTimeScale;
    }

    /**
     * Get time increment for Kepler orbits (adaptive timestep version)
     * @returns {number} Time increment for Kepler system
     */
    getKeplerTimeIncrement() {
        const effectiveDeltaTime = this.adaptiveTimestep.enabled ?
            this.adaptiveTimestep.smoothedDeltaTime : this.deltaTime;
        return effectiveDeltaTime * this.speedMultiplier * 0.00002; // Calibrated factor
    }

    /**
     * Get time increment for n-body physics (adaptive timestep version)
     * @returns {number} Time increment for n-body system
     */
    getNBodyTimeIncrement() {
        const effectiveDeltaTime = this.adaptiveTimestep.enabled ?
            this.adaptiveTimestep.smoothedDeltaTime : this.deltaTime;
        return effectiveDeltaTime * this.speedMultiplier * 0.002; // Calibrated factor
    }

    /**
     * Get scaled delta time for rotations
     * @returns {number} Delta time scaled for body rotation
     */
    getRotationDeltaTime() {
        // Scale rotation time to match orbital time scaling
        // Need to find balance: visible rotation but ~27-30 rotations per Moon orbit
        const effectiveDeltaTime = this.adaptiveTimestep.enabled ?
            this.adaptiveTimestep.smoothedDeltaTime : this.deltaTime;
        return effectiveDeltaTime * this.speedMultiplier * 0.1;
    }

    /**
     * Get scaled delta time for visual effects
     * @returns {number} Delta time scaled for effects
     */
    getEffectsDeltaTime() {
        const effectiveDeltaTime = this.adaptiveTimestep.enabled ?
            this.adaptiveTimestep.smoothedDeltaTime : this.deltaTime;
        return effectiveDeltaTime * this.speedMultiplier;
    }

    /**
     * Get real time since simulation start (excluding pauses)
     * @returns {number} Real time in seconds
     */
    getRealTime() {
        return this.realTime;
    }

    // === STATUS AND DEBUG ===

    /**
     * Check if the clock is running
     * @returns {boolean} True if running, false if paused
     */
    isPaused() {
        return !this.isRunning;
    }

    /**
     * Get current speed multiplier
     * @returns {number} Current speed multiplier
     */
    getSpeedMultiplier() {
        return this.speedMultiplier;
    }

    /**
     * Get current time scale
     * @returns {number} Current time scale
     */
    getTimeScale() {
        return this.timeScale;
    }

    /**
     * Enable or disable adaptive timestep
     * @param {boolean} enabled - Whether to enable adaptive timestep
     */
    setAdaptiveTimestep(enabled) {
        this.adaptiveTimestep.enabled = enabled;
        if (enabled) {
            log.debug('ClockManager', 'Adaptive timestep enabled');
        } else {
            log.debug('ClockManager', 'Adaptive timestep disabled');
        }
    }

    /**
     * Configure adaptive timestep parameters
     * @param {Object} config - Configuration object
     */
    configureAdaptiveTimestep(config) {
        if (config.targetFPS !== undefined) {
            this.adaptiveTimestep.targetFPS = config.targetFPS;
            this.adaptiveTimestep.performanceThreshold = 1 / config.targetFPS;
        }
        if (config.minTimestep !== undefined) {
            this.adaptiveTimestep.minTimestep = config.minTimestep;
        }
        if (config.maxTimestep !== undefined) {
            this.adaptiveTimestep.maxTimestep = config.maxTimestep;
        }
        if (config.smoothingFactor !== undefined) {
            this.adaptiveTimestep.smoothingFactor = config.smoothingFactor;
        }
        if (config.adaptationRate !== undefined) {
            this.adaptiveTimestep.adaptationRate = config.adaptationRate;
        }

        log.debug('ClockManager', 'Adaptive timestep configured', config);
    }

    /**
     * Get adaptive timestep information
     * @returns {Object} Adaptive timestep status
     */
    getAdaptiveTimestepInfo() {
        return {
            enabled: this.adaptiveTimestep.enabled,
            smoothedDeltaTime: this.adaptiveTimestep.smoothedDeltaTime,
            targetFPS: this.adaptiveTimestep.targetFPS,
            currentFPS: this.adaptiveTimestep.smoothedDeltaTime > 0 ? 1 / this.adaptiveTimestep.smoothedDeltaTime : 0,
            avgFrameTime: this.adaptiveTimestep.frameTimeHistory.length > 0 ?
                this.adaptiveTimestep.frameTimeHistory.reduce((sum, time) => sum + time, 0) /
                this.adaptiveTimestep.frameTimeHistory.length : 0
        };
    }

    /**
     * Get clock status for debugging
     * @returns {Object} Clock status information
     */
    getStatus() {
        return {
            isRunning: this.isRunning,
            simulationTime: this.simulationTime,
            realTime: this.realTime,
            deltaTime: this.deltaTime,
            speedMultiplier: this.speedMultiplier,
            timeScale: this.timeScale,
            orbitalTimeScale: this.orbitalTimeScale,
            fps: this.deltaTime > 0 ? 1 / this.deltaTime : 0,
            adaptiveTimestep: this.getAdaptiveTimestepInfo()
        };
    }

    /**
     * Log current clock status
     */
    logStatus() {
        const status = this.getStatus();
        log.info('ClockManager', `Status: ${JSON.stringify(status, null, 2)}`);
    }

    /**
     * Get orbital progress for a specific body using mean anomaly
     * @param {Object} hierarchy - The solar system hierarchy
     * @param {string} bodyName - Name of the body to track (e.g., "Moon")
     * @returns {Object|null} Orbital progress information or null if not found
     */
    getOrbitalProgress(hierarchy, bodyName) {
        const body = this.findBodyInHierarchy(hierarchy, bodyName);
        if (!body || !body.orbit) {
            return null;
        }

        // Convert simulation time to the same time units used by orbital calculations
        // The orbital calculations use a different time scale than raw simulation time
        const currentTime = this.getSimulationTime();
        const orbitalTime = currentTime * 0.00002; // Use same conversion as getKeplerTimeIncrement

        // Calculate current mean anomaly: M = M0 + n*t (where t is in orbital time units)
        const meanAnomaly = body.orbit.meanAnomalyAtEpochRadians + body.orbit.n * orbitalTime;

        // Calculate progress metrics
        const meanAnomalyDegrees = (meanAnomaly * 180 / Math.PI) % 360;
        const orbitsCompleted = Math.floor(meanAnomaly / (2 * Math.PI));
        const orbitalProgress = (meanAnomaly % (2 * Math.PI)) / (2 * Math.PI);

        return {
            bodyName: body.name,
            meanAnomalyDegrees: meanAnomalyDegrees < 0 ? meanAnomalyDegrees + 360 : meanAnomalyDegrees,
            orbitsCompleted,
            orbitalProgress: orbitalProgress < 0 ? orbitalProgress + 1 : orbitalProgress,
            totalDegrees: meanAnomaly * 180 / Math.PI,
            orbitalPeriod: body.orbit.orbitalPeriod,
            meanMotion: body.orbit.n
        };
    }

    /**
     * Find a body by name in the hierarchy
     * @param {Object} hierarchy - The solar system hierarchy
     * @param {string} bodyName - Name of the body to find
     * @returns {Object|null} The body object or null if not found
     */
    findBodyInHierarchy(hierarchy, bodyName) {
        // Check current node
        if (hierarchy.body && hierarchy.body.name === bodyName) {
            return hierarchy.body;
        }

        // Recursively search children
        if (hierarchy.children && Array.isArray(hierarchy.children)) {
            for (const child of hierarchy.children) {
                const found = this.findBodyInHierarchy(child, bodyName);
                if (found) {
                    return found;
                }
            }
        }

        return null;
    }

    /**
     * Get Earth's actual rotation count in degrees from the mesh rotation
     * @param {Object} hierarchy - The solar system hierarchy
     * @returns {number|null} Total degrees Earth has rotated or null if not found
     */
    getEarthRotationDegrees(hierarchy) {
        const earth = this.findBodyInHierarchy(hierarchy, 'Earth');
        if (!earth || !earth.mesh) {
            return null;
        }

        // Get the actual rotation from the Earth's mesh (in radians)
        const meshRotationRadians = earth.mesh.rotation.y;

        // Convert radians to degrees
        const meshRotationDegrees = meshRotationRadians * (180 / Math.PI);

        return Math.abs(meshRotationDegrees);
    }
}

// Create singleton instance
export const clockManager = new ClockManager();
export default clockManager;