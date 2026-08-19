import { log } from '../utils/Logger.js';
import { ORBIT } from '../constants.js';

export class ClockManager {
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

    start(initialTimestamp) {
        this.lastFrameTime = initialTimestamp;
        this.isRunning = true;
        this.simulationTime = 0;

        log.debug('ClockManager', 'Clock started');
    }

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

    pause() {
        if (this.isRunning) {
            this.isRunning = false;
            log.debug('ClockManager', 'Clock paused');
        }
    }

    resume() {
        if (!this.isRunning) {
            this.isRunning = true;
            log.debug('ClockManager', 'Clock resumed');
        }
    }

    toggle() {
        if (this.isRunning) {
            this.pause();
        } else {
            this.resume();
        }
    }

    reset() {
        const currentTimestamp = performance.now();
        this.start(currentTimestamp);

        this.adaptiveTimestep.frameTimeHistory = [];
        this.adaptiveTimestep.smoothedDeltaTime = 1/60;

        log.debug('ClockManager', 'Clock reset');
    }

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

    setSpeedMultiplier(multiplier) {
        this.requestedSpeedMultiplier = Math.max(ORBIT.MIN_SPEED_MULTIPLIER / 100.0,
            Math.min(multiplier, ORBIT.MAX_SPEED_MULTIPLIER / 100.0));
        this.#applySpeedLimit();
        log.debug('ClockManager', `Speed multiplier set to ${this.speedMultiplier}x` +
            (this.speedMultiplier < this.requestedSpeedMultiplier ? ` (asked for ${this.requestedSpeedMultiplier}x)` : ''));
    }

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

    #applySpeedLimit() {
        this.speedMultiplier = Math.max(ORBIT.MIN_SPEED_MULTIPLIER / 100.0,
            Math.min(this.requestedSpeedMultiplier, this.physicsSpeedLimit));
    }

    getSimulationTime() {
        return this.simulationTime;
    }

    getKeplerTimeIncrement() {
        const effectiveDeltaTime = this.adaptiveTimestep.enabled ?
            this.adaptiveTimestep.smoothedDeltaTime : this.deltaTime;
        return effectiveDeltaTime * this.speedMultiplier * 0.00002;
    }

    getNBodyTimeIncrement() {
        const effectiveDeltaTime = this.adaptiveTimestep.enabled ?
            this.adaptiveTimestep.smoothedDeltaTime : this.deltaTime;
        return effectiveDeltaTime * this.speedMultiplier * 0.002;
    }

    getEffectsDeltaTime() {
        const effectiveDeltaTime = this.adaptiveTimestep.enabled ?
            this.adaptiveTimestep.smoothedDeltaTime : this.deltaTime;
        return effectiveDeltaTime * this.speedMultiplier;
    }

    getSpeedMultiplier() {
        return this.speedMultiplier;
    }

    getRequestedSpeedMultiplier() {
        return this.requestedSpeedMultiplier;
    }

    isSpeedLimitedByPhysics() {
        return this.speedMultiplier < this.requestedSpeedMultiplier;
    }
}

export const clockManager = new ClockManager();
export default clockManager;