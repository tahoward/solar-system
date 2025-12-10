/**
 * Performance statistics tracker with time series data
 * Tracks FPS, GPU utilization, and CPU utilization over time
 */
export class PerformanceStats {
    constructor(maxHistoryLength = 60) { // 60 samples = ~1 second at 60fps
        this.maxHistoryLength = maxHistoryLength;

        // Time series data arrays
        this.fpsHistory = [];
        this.gpuHistory = [];
        this.cpuHistory = [];
        this.timestamps = [];

        // Current values
        this.currentFPS = 0;
        this.currentGPU = 0;
        this.currentCPU = 0;

        // stats-gl integration
        this.statsGL = null;

        // Update intervals
        this.lastUpdate = performance.now();
        this.updateInterval = 100; // Update every 100ms for smooth data collection
    }

    /**
     * Set the stats-gl instance for accurate performance data
     */
    setStatsGL(statsGL) {
        this.statsGL = statsGL;
    }

    /**
     * Update statistics - call this once per frame
     */
    update() {
        const now = performance.now();

        // Only update at specified intervals to avoid too frequent updates
        if (now - this.lastUpdate < this.updateInterval) {
            return;
        }

        if (this.statsGL) {
            // Get accurate stats from stats-gl
            this.updateFromStatsGL(now);
        } else {
            // Fallback to basic FPS calculation if stats-gl not available
            this.updateBasicStats(now);
        }

        this.lastUpdate = now;
    }

    /**
     * Update statistics using stats-gl data
     */
    updateFromStatsGL(now) {
        try {
            // Call stats-gl update method to ensure fresh data
            if (typeof this.statsGL.update === 'function') {
                this.statsGL.update();
            }

            // Access stats-gl data from the correct properties
            // Based on debug output, the current values are in lastValue object
            let fps = 0, gpu = 0, cpu = 0;

            if (this.statsGL.lastValue) {
                fps = this.statsGL.lastValue.FPS || 0;
                gpu = this.statsGL.lastValue.GPU || 0;
                cpu = this.statsGL.lastValue.CPU || 0; // This is already frame time in ms
            }

            this.currentFPS = Math.round(fps);
            this.currentGPU = Math.round(gpu);
            // CPU is already a frame time in ms, convert to percentage for display
            // stats-gl CPU shows frame time, we'll use it directly as a percentage approximation
            this.currentCPU = Math.min(100, Math.max(0, Math.round(cpu)));

            // Add to history
            this.addToHistory('fps', this.currentFPS, now);
            this.addToHistory('gpu', this.currentGPU, now);
            this.addToHistory('cpu', this.currentCPU, now);


        } catch (error) {
            console.warn('PerformanceStats: Error reading stats-gl data:', error);
            this.updateBasicStats(now);
        }
    }

    /**
     * Fallback method for basic stats when stats-gl is not available
     */
    updateBasicStats(now) {
        // Basic FPS calculation
        this.frameCount = (this.frameCount || 0) + 1;
        const deltaTime = now - this.lastUpdate;

        if (deltaTime >= 1000) { // Update every second
            this.currentFPS = Math.round((this.frameCount / deltaTime) * 1000);
            this.frameCount = 0;

            // No accurate GPU/CPU data available, set to 0
            this.currentGPU = 0;
            this.currentCPU = 0;

            // Add to history
            this.addToHistory('fps', this.currentFPS, now);
            this.addToHistory('gpu', this.currentGPU, now);
            this.addToHistory('cpu', this.currentCPU, now);
        }
    }

    /**
     * Add a value to the appropriate history array
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

        // Add new value
        history.push(value);

        // Only add timestamp once (they're all synchronized)
        if (type === 'fps') {
            this.timestamps.push(timestamp);
        }

        // Trim to max length
        if (history.length > this.maxHistoryLength) {
            history.shift();

            if (type === 'fps' && this.timestamps.length > this.maxHistoryLength) {
                this.timestamps.shift();
            }
        }
    }

    /**
     * Get current statistics
     */
    getCurrentStats() {
        return {
            fps: this.currentFPS,
            gpu: Math.round(this.currentGPU),
            cpu: Math.round(this.currentCPU)
        };
    }

    /**
     * Get full time series data
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
     * Get statistics summary
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
     * Reset all statistics
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
     * Clean up resources
     */
    dispose() {
        this.statsGL = null;
    }
}

export default PerformanceStats;