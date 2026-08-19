import { log } from '../utils/Logger.js';
import { ORBIT } from '../constants.js';

/**
 * The simulation's single source of time.
 *
 * Everything time-dependent — orbital motion, rotation, shader animation — draws
 * its increment from here, so pausing or changing speed affects the whole scene
 * coherently rather than each subsystem drifting on its own clock.
 *
 * Raw frame deltas are smoothed before use, because a single long frame would
 * otherwise let bodies jump far enough to destabilise the integrator. Each
 * consumer gets a differently scaled increment, since Kepler propagation, n-body
 * integration and visual effects each want time in their own units.
 *
 * Speed is split into what was *requested* and what is actually *applied*: the
 * n-body integrator can report that it cannot keep up, and the applied speed is
 * held back until it can, so the requested value is remembered and restored
 * rather than being overwritten.
 */
export class ClockManager {
    /**
     * Creates a stopped clock at time zero.
     */
    constructor() {
        this.simulationTime = 0;
        this.lastFrameTime = 0;
        this.deltaTime = 0;
        this.isRunning = false;

        this.speedMultiplier = 1.0;
        this.requestedSpeedMultiplier = 1.0;
        this.timeScale = 1.0;
        this.maxDeltaTime = 0.1;
        this.physicsSpeedLimit = Infinity;

        this.adaptiveTimestep = {
            enabled: true,
            targetFPS: 60,
            minTimestep: 1/120,
            maxTimestep: 1/30,
            smoothingFactor: 0.1,
            smoothedDeltaTime: 1/60,
            frameTimeHistory: [],
            historyLength: 10,
            adaptationRate: 0.05,
            performanceThreshold: 0.016
        };

        log.init('ClockManager', 'Initialized unified clock system with adaptive timestep');
    }

    /**
     * Starts the clock from zero.
     *
     * @param {number} initialTimestamp - Baseline timestamp, in milliseconds, that
     *   the first frame delta is measured from.
     * @returns {void}
     */
    start(initialTimestamp) {
        this.lastFrameTime = initialTimestamp;
        this.isRunning = true;
        this.simulationTime = 0;

        log.debug('ClockManager', 'Clock started');
    }

    /**
     * Advances the clock by one frame.
     *
     * The raw delta is capped at `maxDeltaTime` first, which matters most when the
     * tab has been backgrounded: without it the first frame back would carry a
     * delta of many seconds and fling the simulation apart.
     *
     * Does nothing while paused, so simulation time simply stops.
     *
     * @param {number} timestamp - Current timestamp in milliseconds, as from
     *   `requestAnimationFrame`.
     * @returns {void}
     */
    update(timestamp) {
        if (!this.isRunning) {
            return;
        }

        const rawDeltaTime = this.lastFrameTime ? (timestamp - this.lastFrameTime) / 1000 : 1/60;
        this.deltaTime = Math.min(rawDeltaTime, this.maxDeltaTime);
        this.lastFrameTime = timestamp;

        this.updateAdaptiveTimestep(this.deltaTime);

        const effectiveDeltaTime = this.adaptiveTimestep.enabled ?
            this.adaptiveTimestep.smoothedDeltaTime : this.deltaTime;

        const simulationDelta = effectiveDeltaTime * this.speedMultiplier * this.timeScale;
        this.simulationTime += simulationDelta;
    }

    /**
     * Freezes simulation time.
     *
     * @returns {void}
     */
    pause() {
        if (this.isRunning) {
            this.isRunning = false;
            log.debug('ClockManager', 'Clock paused');
        }
    }

    /**
     * Resumes simulation time.
     *
     * The next frame's delta is measured from the last frame before the pause, but
     * the cap in {@link ClockManager#update} keeps that from producing a jump.
     *
     * @returns {void}
     */
    resume() {
        if (!this.isRunning) {
            this.isRunning = true;
            log.debug('ClockManager', 'Clock resumed');
        }
    }

    /**
     * Flips between running and paused.
     *
     * @returns {void}
     */
    toggle() {
        if (this.isRunning) {
            this.pause();
        } else {
            this.resume();
        }
    }

    /**
     * Restarts the clock at zero and discards the frame-time history.
     *
     * The history is cleared so the smoothed timestep is not carried over from
     * before the reset.
     *
     * @returns {void}
     */
    reset() {
        const currentTimestamp = performance.now();
        this.start(currentTimestamp);

        this.adaptiveTimestep.frameTimeHistory = [];
        this.adaptiveTimestep.smoothedDeltaTime = 1/60;

        log.debug('ClockManager', 'Clock reset');
    }

    /**
     * Updates the smoothed timestep from recent frame times.
     *
     * Frame times are noisy, and feeding that noise straight into the integrator
     * shows up as visible jitter in the orbits. A rolling average over the last
     * `historyLength` frames is therefore eased towards, with the target biased
     * lower when the average frame time exceeds `performanceThreshold` so a
     * struggling frame rate produces smaller steps rather than larger ones.
     *
     * @param {number} currentDeltaTime - This frame's capped delta, in seconds.
     * @returns {void}
     */
    updateAdaptiveTimestep(currentDeltaTime) {
        if (!this.adaptiveTimestep.enabled) {
            return;
        }

        const adaptive = this.adaptiveTimestep;

        adaptive.frameTimeHistory.push(currentDeltaTime);
        if (adaptive.frameTimeHistory.length > adaptive.historyLength) {
            adaptive.frameTimeHistory.shift();
        }

        const avgFrameTime = adaptive.frameTimeHistory.reduce((sum, time) => sum + time, 0) /
                            adaptive.frameTimeHistory.length;

        let targetTimestep;
        if (avgFrameTime > adaptive.performanceThreshold) {
            targetTimestep = Math.min(avgFrameTime * 0.8, adaptive.maxTimestep);
        } else {
            targetTimestep = Math.max(avgFrameTime, adaptive.minTimestep);
        }

        const timestepDifference = targetTimestep - adaptive.smoothedDeltaTime;
        adaptive.smoothedDeltaTime += timestepDifference * adaptive.adaptationRate;

        adaptive.smoothedDeltaTime = Math.max(adaptive.minTimestep,
            Math.min(adaptive.maxTimestep, adaptive.smoothedDeltaTime));

        const smoothingFactor = adaptive.smoothingFactor;
        adaptive.smoothedDeltaTime = (1 - smoothingFactor) * adaptive.smoothedDeltaTime +
                                    smoothingFactor * currentDeltaTime;
    }

    /**
     * Sets the requested simulation speed.
     *
     * Stored as the *requested* speed and then limited by what physics can sustain,
     * so the user's choice is remembered and restored once the integrator catches
     * up.
     *
     * @param {number} multiplier - Desired speed multiplier; clamped to the
     *   configured range.
     * @returns {void}
     */
    setSpeedMultiplier(multiplier) {
        this.requestedSpeedMultiplier = Math.max(ORBIT.MIN_SPEED_MULTIPLIER / 100.0,
            Math.min(multiplier, ORBIT.MAX_SPEED_MULTIPLIER / 100.0));
        this.#applySpeedLimit();
        log.debug('ClockManager', `Speed multiplier set to ${this.speedMultiplier}x` +
            (this.speedMultiplier < this.requestedSpeedMultiplier ? ` (asked for ${this.requestedSpeedMultiplier}x)` : ''));
    }

    /**
     * Reports the fastest speed the physics can currently sustain.
     *
     * Called by the n-body integrator when its step budget runs out. Rather than
     * letting the integration go unstable, the clock is slowed to what it can
     * manage; the requested speed is untouched, so raising the limit again restores
     * it.
     *
     * @param {number} limit - Maximum sustainable multiplier; `Infinity` or any
     *   non-finite value removes the limit.
     * @returns {void}
     */
    setPhysicsSpeedLimit(limit) {
        this.physicsSpeedLimit = Number.isFinite(limit) ? Math.max(0, limit) : Infinity;

        const before = this.speedMultiplier;
        this.#applySpeedLimit();

        if (this.speedMultiplier !== before) {
            const held = this.speedMultiplier < this.requestedSpeedMultiplier;
            log.debug('ClockManager', held
                ? `Physics cannot keep up with ${(this.requestedSpeedMultiplier * 100).toFixed(0)}x, ` +
                  `holding at ${(this.speedMultiplier * 100).toFixed(0)}x`
                : `Physics caught up, back to the requested ${(this.speedMultiplier * 100).toFixed(0)}x`);
        }
    }

    /**
     * Derives the applied speed from the requested speed and the physics limit.
     *
     * @private
     * @returns {void}
     */
    #applySpeedLimit() {
        this.speedMultiplier = Math.max(ORBIT.MIN_SPEED_MULTIPLIER / 100.0,
            Math.min(this.requestedSpeedMultiplier, this.physicsSpeedLimit));
    }

    /**
     * Returns the accumulated simulation time.
     *
     * @returns {number} Simulation time in internal units, from the last start or
     *   reset.
     */
    getSimulationTime() {
        return this.simulationTime;
    }

    /**
     * Returns this frame's time increment for Kepler propagation.
     *
     * Scaled to give orbital periods that read well on screen at 1× speed.
     *
     * @returns {number} Increment in Kepler time units.
     */
    getKeplerTimeIncrement() {
        const effectiveDeltaTime = this.adaptiveTimestep.enabled ?
            this.adaptiveTimestep.smoothedDeltaTime : this.deltaTime;
        return effectiveDeltaTime * this.speedMultiplier * 0.00002;
    }

    /**
     * Returns this frame's time increment for the n-body integrator.
     *
     * A hundred times the Kepler increment, which compensates for the integrator
     * working in scene units while its gravitational constant is in AU³ yr⁻² — see
     * {@link updateHierarchyNBodyPhysics} — so both models run at comparable
     * apparent speeds.
     *
     * @returns {number} Increment in internal n-body time units.
     */
    getNBodyTimeIncrement() {
        const effectiveDeltaTime = this.adaptiveTimestep.enabled ?
            this.adaptiveTimestep.smoothedDeltaTime : this.deltaTime;
        return effectiveDeltaTime * this.speedMultiplier * 0.002;
    }

    /**
     * Returns this frame's time increment for visual effects.
     *
     * Unscaled seconds, so shader animation runs in real time but still speeds up,
     * slows and stops with the simulation.
     *
     * @returns {number} Increment in scaled seconds.
     */
    getEffectsDeltaTime() {
        const effectiveDeltaTime = this.adaptiveTimestep.enabled ?
            this.adaptiveTimestep.smoothedDeltaTime : this.deltaTime;
        return effectiveDeltaTime * this.speedMultiplier;
    }

    /**
     * Returns the speed actually in effect.
     *
     * @returns {number} Applied multiplier, which may be below what was requested.
     */
    getSpeedMultiplier() {
        return this.speedMultiplier;
    }

    /**
     * Returns the speed that was asked for.
     *
     * The UI shows this rather than the applied speed, so a slider does not appear
     * to move on its own when physics imposes a limit.
     *
     * @returns {number} Requested multiplier.
     */
    getRequestedSpeedMultiplier() {
        return this.requestedSpeedMultiplier;
    }

    /**
     * Reports whether physics is currently holding the speed back.
     *
     * Lets the UI indicate that the requested speed is not being met.
     *
     * @returns {boolean} `true` if the applied speed is below the requested one.
     */
    isSpeedLimitedByPhysics() {
        return this.speedMultiplier < this.requestedSpeedMultiplier;
    }
}

export const clockManager = new ClockManager();
export default clockManager;