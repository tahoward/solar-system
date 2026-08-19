import { log } from '../utils/Logger.js';
import { ORBIT } from '../constants.js';

export class ClockManager {
    constructor() {
        this.simulationTime = 0;
        this.realTime = 0;
        this.lastFrameTime = 0;
        this.deltaTime = 0;
        this.isRunning = false;

        this.speedMultiplier = 1.0;
        this.requestedSpeedMultiplier = 1.0;
        this.timeScale = 1.0;
        this.maxDeltaTime = 0.1;
        this.physicsSpeedLimit = Infinity;

        this.orbitalTimeScale = 1.0;

        this.startTime = 0;
        this.pausedTime = 0;
        this.lastPauseStart = 0;

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
        this.startTime = initialTimestamp;
        this.lastFrameTime = initialTimestamp;
        this.isRunning = true;
        this.simulationTime = 0;
        this.realTime = 0;
        this.pausedTime = 0;

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

        this.realTime = (timestamp - this.startTime - this.pausedTime) / 1000;

        const effectiveDeltaTime = this.adaptiveTimestep.enabled ?
            this.adaptiveTimestep.smoothedDeltaTime : this.deltaTime;

        const simulationDelta = effectiveDeltaTime * this.speedMultiplier * this.timeScale;
        this.simulationTime += simulationDelta;
    }

    pause() {
        if (this.isRunning) {
            this.isRunning = false;
            this.lastPauseStart = performance.now();
            log.debug('ClockManager', 'Clock paused');
        }
    }

    resume() {
        if (!this.isRunning) {
            this.isRunning = true;
            if (this.lastPauseStart > 0) {
                this.pausedTime += performance.now() - this.lastPauseStart;
            }
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

    setTimeScale(scale) {
        this.timeScale = Math.max(0, scale);
        log.debug('ClockManager', `Time scale set to ${this.timeScale}`);
    }

    setOrbitalTimeScale(scale) {
        this.orbitalTimeScale = Math.max(0, scale);
        log.debug('ClockManager', `Orbital time scale set to ${this.orbitalTimeScale}`);
    }

    getSimulationTime() {
        return this.simulationTime;
    }

    getSimulationTimeMs() {
        return this.simulationTime * 1000;
    }

    getDeltaTime() {
        return this.adaptiveTimestep.enabled ?
            this.adaptiveTimestep.smoothedDeltaTime : this.deltaTime;
    }

    getRawDeltaTime() {
        return this.deltaTime;
    }

    getPhysicsDeltaTime() {
        const effectiveDeltaTime = this.adaptiveTimestep.enabled ?
            this.adaptiveTimestep.smoothedDeltaTime : this.deltaTime;
        return effectiveDeltaTime * this.speedMultiplier * this.timeScale;
    }

    getOrbitalDeltaTime() {
        const effectiveDeltaTime = this.adaptiveTimestep.enabled ?
            this.adaptiveTimestep.smoothedDeltaTime : this.deltaTime;
        return effectiveDeltaTime * this.speedMultiplier * this.orbitalTimeScale;
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

    getRotationDeltaTime() {
        const effectiveDeltaTime = this.adaptiveTimestep.enabled ?
            this.adaptiveTimestep.smoothedDeltaTime : this.deltaTime;
        return effectiveDeltaTime * this.speedMultiplier * 0.1;
    }

    getEffectsDeltaTime() {
        const effectiveDeltaTime = this.adaptiveTimestep.enabled ?
            this.adaptiveTimestep.smoothedDeltaTime : this.deltaTime;
        return effectiveDeltaTime * this.speedMultiplier;
    }

    getRealTime() {
        return this.realTime;
    }

    isPaused() {
        return !this.isRunning;
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

    getTimeScale() {
        return this.timeScale;
    }

    setAdaptiveTimestep(enabled) {
        this.adaptiveTimestep.enabled = enabled;
        if (enabled) {
            log.debug('ClockManager', 'Adaptive timestep enabled');
        } else {
            log.debug('ClockManager', 'Adaptive timestep disabled');
        }
    }

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

    getStatus() {
        return {
            isRunning: this.isRunning,
            simulationTime: this.simulationTime,
            realTime: this.realTime,
            deltaTime: this.deltaTime,
            speedMultiplier: this.speedMultiplier,
            requestedSpeedMultiplier: this.requestedSpeedMultiplier,
            physicsSpeedLimit: this.physicsSpeedLimit,
            timeScale: this.timeScale,
            orbitalTimeScale: this.orbitalTimeScale,
            fps: this.deltaTime > 0 ? 1 / this.deltaTime : 0,
            adaptiveTimestep: this.getAdaptiveTimestepInfo()
        };
    }

    logStatus() {
        const status = this.getStatus();
        log.info('ClockManager', `Status: ${JSON.stringify(status, null, 2)}`);
    }

    getOrbitalProgress(hierarchy, bodyName) {
        const body = this.findBodyInHierarchy(hierarchy, bodyName);
        if (!body || !body.orbit) {
            return null;
        }

        const currentTime = this.getSimulationTime();
        const orbitalTime = currentTime * 0.00002;

        const meanAnomaly = body.orbit.meanAnomalyAtEpochRadians + body.orbit.n * orbitalTime;

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

    findBodyInHierarchy(hierarchy, bodyName) {
        if (hierarchy.body && hierarchy.body.name === bodyName) {
            return hierarchy.body;
        }

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

    getEarthRotationDegrees(hierarchy) {
        const earth = this.findBodyInHierarchy(hierarchy, 'Earth');
        if (!earth || !earth.mesh) {
            return null;
        }

        const meshRotationRadians = earth.mesh.rotation.y;

        const meshRotationDegrees = meshRotationRadians * (180 / Math.PI);

        return Math.abs(meshRotationDegrees);
    }
}

export const clockManager = new ClockManager();
export default clockManager;