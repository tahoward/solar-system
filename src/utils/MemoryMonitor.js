/**
 * Simple memory monitoring utility for debugging memory leaks
 */
export class MemoryMonitor {
    constructor() {
        this.enabled = false;
        this.lastMemory = 0;
        this.samples = [];
        this.maxSamples = 100;
    }

    /**
     * Enable memory monitoring
     */
    enable() {
        this.enabled = true;
    }

    /**
     * Disable memory monitoring
     */
    disable() {
        this.enabled = false;
    }

    /**
     * Check memory usage (call this occasionally)
     */
    check() {
        if (!this.enabled || !window.performance || !window.performance.memory) {
            return;
        }

        const memory = window.performance.memory;
        const currentMemory = memory.usedJSHeapSize;
        const memoryMB = Math.round(currentMemory / 1024 / 1024);

        // Store sample
        this.samples.push({
            timestamp: Date.now(),
            memory: memoryMB
        });

        // Keep only recent samples
        if (this.samples.length > this.maxSamples) {
            this.samples.shift();
        }

        // Log significant changes
        const memoryChange = currentMemory - this.lastMemory;
        const changeMB = Math.round(memoryChange / 1024 / 1024);


        this.lastMemory = currentMemory;
    }

    /**
     * Get memory usage summary
     * @returns {Object} Memory usage data
     */
    getSummary() {
        if (!window.performance || !window.performance.memory) {
            return { available: false };
        }

        const memory = window.performance.memory;
        return {
            available: true,
            usedMB: Math.round(memory.usedJSHeapSize / 1024 / 1024),
            totalMB: Math.round(memory.totalJSHeapSize / 1024 / 1024),
            limitMB: Math.round(memory.jsHeapSizeLimit / 1024 / 1024),
            samples: this.samples.length
        };
    }

    /**
     * Force garbage collection (if available)
     */
    forceGC() {
        if (window.gc) {
            console.log('MemoryMonitor: Forcing garbage collection');
            window.gc();
        } else {
            console.log('MemoryMonitor: Garbage collection not available (try running with --expose-gc)');
        }
    }
}

// Create singleton instance
const memoryMonitor = new MemoryMonitor();

// Enable in development
if (typeof window !== 'undefined' && window.location.hostname === 'localhost') {
    memoryMonitor.enable();
}

export default memoryMonitor;