import { log } from './Logger.js';

export class PerformanceStats {
    constructor(maxHistoryLength = 60) {
        this.maxHistoryLength = maxHistoryLength;

        this.fpsHistory = [];
        this.gpuHistory = [];
        this.cpuHistory = [];
        this.timestamps = [];

        this.currentFPS = 0;
        this.currentGPU = 0;
        this.currentCPU = 0;

        this.statsGL = null;

        this.lastUpdate = performance.now();
        this.updateInterval = 100;
    }

    setStatsGL(statsGL) {
        this.statsGL = statsGL;
    }

    update() {
        const now = performance.now();

        if (now - this.lastUpdate < this.updateInterval) {
            return;
        }

        if (this.statsGL) {
            this.updateFromStatsGL(now);
        } else {
            this.updateBasicStats(now);
        }

        this.lastUpdate = now;
    }

    updateFromStatsGL(now) {
        try {
            let fps = 0, gpu = 0, cpu = 0;

            if (this.statsGL.lastValue) {
                fps = this.statsGL.lastValue.FPS || 0;
                gpu = this.statsGL.lastValue.GPU || 0;
                cpu = this.statsGL.lastValue.CPU || 0;
            }

            this.currentFPS = Math.round(fps);
            this.currentGPU = Math.round(gpu);
            this.currentCPU = Math.min(100, Math.max(0, Math.round(cpu)));

            this.addToHistory('fps', this.currentFPS, now);
            this.addToHistory('gpu', this.currentGPU, now);
            this.addToHistory('cpu', this.currentCPU, now);


        } catch (error) {
            log.warn('PerformanceStats', 'Error reading stats-gl data', error);
            this.updateBasicStats(now);
        }
    }

    updateBasicStats(now) {
        this.frameCount = (this.frameCount || 0) + 1;
        const deltaTime = now - this.lastUpdate;

        if (deltaTime >= 1000) {
            this.currentFPS = Math.round((this.frameCount / deltaTime) * 1000);
            this.frameCount = 0;

            this.currentGPU = 0;
            this.currentCPU = 0;

            this.addToHistory('fps', this.currentFPS, now);
            this.addToHistory('gpu', this.currentGPU, now);
            this.addToHistory('cpu', this.currentCPU, now);
        }
    }

    addToHistory(type, value, timestamp) {
        let history;

        switch (type) {
            case 'fps':
                history = this.fpsHistory;
                break;
            case 'gpu':
                history = this.gpuHistory;
                break;
            case 'cpu':
                history = this.cpuHistory;
                break;
            default:
                return;
        }

        history.push(value);

        if (type === 'fps') {
            this.timestamps.push(timestamp);
        }

        if (history.length > this.maxHistoryLength) {
            history.shift();

            if (type === 'fps' && this.timestamps.length > this.maxHistoryLength) {
                this.timestamps.shift();
            }
        }
    }

    getCurrentStats() {
        return {
            fps: this.currentFPS,
            gpu: Math.round(this.currentGPU),
            cpu: Math.round(this.currentCPU)
        };
    }

    getTimeSeries() {
        return {
            fps: [...this.fpsHistory],
            gpu: [...this.gpuHistory],
            cpu: [...this.cpuHistory],
            timestamps: [...this.timestamps]
        };
    }

    getStatsSummary() {
        const calculateStats = (arr) => {
            if (arr.length === 0) return { min: 0, max: 0, avg: 0 };

            const min = Math.min(...arr);
            const max = Math.max(...arr);
            const avg = arr.reduce((sum, val) => sum + val, 0) / arr.length;

            return { min, max, avg: Math.round(avg * 10) / 10 };
        };

        return {
            fps: calculateStats(this.fpsHistory),
            gpu: calculateStats(this.gpuHistory),
            cpu: calculateStats(this.cpuHistory),
            sampleCount: this.fpsHistory.length
        };
    }

    reset() {
        this.fpsHistory = [];
        this.gpuHistory = [];
        this.cpuHistory = [];
        this.timestamps = [];

        this.currentFPS = 0;
        this.currentGPU = 0;
        this.currentCPU = 0;

        this.frameCount = 0;
        this.lastUpdate = performance.now();
    }

    dispose() {
        this.statsGL = null;
    }
}

export default PerformanceStats;