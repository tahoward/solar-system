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

        log.init('ClockManager', 'Initialized unified clock system');
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

        // Update real time (wall clock time since start, excluding pauses)
        this.realTime = (timestamp - this.startTime - this.pausedTime) / 1000;

        // Update simulation time (affected by speed multiplier and time scale)
        const simulationDelta = this.deltaTime * this.speedMultiplier * this.timeScale;
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
        log.debug('ClockManager', 'Clock reset');
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
        return this.deltaTime;
    }

    /**
     * Get scaled delta time for physics simulation
     * @returns {number} Delta time scaled for physics
     */
    getPhysicsDeltaTime() {
        return this.deltaTime * this.speedMultiplier * this.timeScale;
    }

    /**
     * Get scaled delta time for orbital calculations
     * @returns {number} Delta time scaled for orbital motion
     */
    getOrbitalDeltaTime() {
        return this.deltaTime * this.speedMultiplier * this.orbitalTimeScale;
    }

    /**
     * Get time increment for Kepler orbits (calibrated to match n-body)
     * @param {number} fixedTimeStep - The fixed timestep from accumulator
     * @returns {number} Time increment for Kepler system
     */
    getKeplerTimeIncrement(fixedTimeStep) {
        const speedMultiplier = this.speedMultiplier * 100.0;
        return fixedTimeStep * speedMultiplier * 0.0000002; // Calibrated factor
    }

    /**
     * Get time increment for n-body physics (calibrated)
     * @param {number} deltaTime - The delta time
     * @param {number} nBodySpeedMultiplier - N-body internal speed
     * @returns {number} Time increment for n-body system
     */
    getNBodyTimeIncrement(deltaTime, nBodySpeedMultiplier) {
        return deltaTime * nBodySpeedMultiplier * 0.00002; // Calibrated factor
    }

    /**
     * Get scaled delta time for rotations
     * @returns {number} Delta time scaled for body rotation
     */
    getRotationDeltaTime() {
        // Scale rotation time to match orbital time scaling
        // Need to find balance: visible rotation but ~27-30 rotations per Moon orbit
        return this.deltaTime * this.speedMultiplier * 0.2;
    }

    /**
     * Get scaled delta time for visual effects
     * @returns {number} Delta time scaled for effects
     */
    getEffectsDeltaTime() {
        return this.deltaTime * this.speedMultiplier;
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
            fps: this.deltaTime > 0 ? 1 / this.deltaTime : 0
        };
    }

    /**
     * Log current clock status
     */
    logStatus() {
        const status = this.getStatus();
        log.info('ClockManager', `Status: ${JSON.stringify(status, null, 2)}`);
    }
}

// Create singleton instance
export const clockManager = new ClockManager();
export default clockManager;