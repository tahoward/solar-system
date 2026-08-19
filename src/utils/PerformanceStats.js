import { log } from './Logger.js';

/**
 * Samples frame timing into rolling histories for the debug overlay.
 *
 * Readings come from `stats-gl` when it has been attached, which provides real
 * GPU and CPU timings; otherwise the class falls back to counting frames for a
 * plain FPS figure. Sampling is throttled to a fixed interval so the overlay
 * stays readable and measurement stays cheap.
 */
export class PerformanceStats {
    /**
     * Creates an empty sampler.
     *
     * @param {number} [maxHistoryLength=60] - Number of samples retained per
     *   series before the oldest is dropped.
     */
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

    /**
     * Attaches a `stats-gl` instance to read GPU and CPU timings from.
     *
     * @param {Object} statsGL - Live `stats-gl` instance; pass `null` to fall back
     *   to basic frame counting.
     * @returns {void}
     */
    setStatsGL(statsGL) {
        this.statsGL = statsGL;
    }

    /**
     * Takes a sample if the throttle interval has elapsed.
     *
     * Safe to call every frame; calls inside the interval return immediately.
     *
     * @returns {void}
     */
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

    /**
     * Reads the latest FPS, GPU and CPU values from `stats-gl`.
     *
     * Falls back to {@link PerformanceStats#updateBasicStats} if the read throws,
     * since a broken profiler should not take the overlay down with it.
     *
     * @param {number} now - Current `performance.now()` timestamp.
     * @returns {void}
     */
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

    /**
     * Derives FPS by counting frames when no profiler is attached.
     *
     * Accumulates frames and only emits a sample once a full second has passed;
     * GPU and CPU are reported as zero because they cannot be measured this way.
     *
     * @param {number} now - Current `performance.now()` timestamp.
     * @returns {void}
     */
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

    /**
     * Appends a value to one series, trimming it to the history limit.
     *
     * Timestamps are recorded only alongside the `fps` series, which acts as the
     * shared time axis for all three.
     *
     * @param {'fps'|'gpu'|'cpu'} type - Series to append to; unknown types are ignored.
     * @param {number} value - Sample value.
     * @param {number} timestamp - Time the sample was taken.
     * @returns {void}
     */
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

    /**
     * Returns the most recent sample of each metric.
     *
     * @returns {{fps: number, gpu: number, cpu: number}} Latest readings; GPU and
     *   CPU are zero when no profiler is attached.
     */
    getCurrentStats() {
        return {
            fps: this.currentFPS,
            gpu: Math.round(this.currentGPU),
            cpu: Math.round(this.currentCPU)
        };
    }

    /**
     * Returns the full rolling histories, for plotting.
     *
     * @returns {{fps: number[], gpu: number[], cpu: number[], timestamps: number[]}}
     *   Copies of each series, oldest first; safe to mutate.
     */
    getTimeSeries() {
        return {
            fps: [...this.fpsHistory],
            gpu: [...this.gpuHistory],
            cpu: [...this.cpuHistory],
            timestamps: [...this.timestamps]
        };
    }

    /**
     * Aggregates each series into minimum, maximum and mean values.
     *
     * @returns {{fps: {min: number, max: number, avg: number},
     *   gpu: {min: number, max: number, avg: number},
     *   cpu: {min: number, max: number, avg: number},
     *   sampleCount: number}} Per-metric summary with averages rounded to one
     *   decimal place; all zeroes for an empty series.
     */
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

    /**
     * Clears all histories and current readings, restarting the sampling window.
     *
     * The attached `stats-gl` instance is kept.
     *
     * @returns {void}
     */
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

    /**
     * Releases the profiler reference.
     *
     * @returns {void}
     */
    dispose() {
        this.statsGL = null;
    }
}

export default PerformanceStats;
