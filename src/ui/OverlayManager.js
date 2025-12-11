/**
 * OverlayManager - UI Overlay Management Functions
 *
 * Manages all UI overlays in the solar system application:
 * - Controls overlay (keyboard/mouse help)
 * - State overlay (system status and current target info)
 * - Stats overlay (performance statistics)
 * - Debug overlay (development information)
 */

import { UI } from '../constants.js';
import configService from '../utils/ConfigService.js';

// Target info display removed - info now shown in state overlay


/**
 * Creates or updates the controls overlay display
 * @param {boolean} [isVisible=true] - Whether to show or hide the overlay
 */
export function createControlsOverlay(isVisible = true) {
    let controlsOverlay = document.getElementById('controls-overlay');

    if (!controlsOverlay) {
        controlsOverlay = document.createElement('div');
        controlsOverlay.id = 'controls-overlay';

        // Apply styles from constants
        Object.assign(controlsOverlay.style, UI.CONTROLS_OVERLAY_STYLE);

        document.body.appendChild(controlsOverlay);
    }

    // Update content
    controlsOverlay.innerHTML = `
        <div><strong>🎮 Solar System Controls</strong></div>
        <div><strong>Mouse:</strong></div>
        <div>• Left click + drag: Rotate view</div>
        <div>• Right click + drag: Pan view</div>
        <div>• Scroll wheel: Zoom in/out</div>
        <div><strong>Keyboard:</strong></div>
        <div>• ←/→ Arrow keys: Switch planets</div>
        <div>• Space: Focus on Sun</div>
        <div>• Backspace: Reset camera</div>
        <div>• Q/A: Increase/decrease speed</div>
        <div>• W: Reset speed</div>
        <div>• O: Toggle orbit trails</div>
        <div>• L: Toggle orbit lines</div>
        <div>• +/-: Adjust marker size</div>
        <div>• F3: Toggle all overlays</div>
    `;

    // Set visibility
    controlsOverlay.style.display = isVisible ? 'block' : 'none';

    return controlsOverlay;
}

/**
 * Toggles the controls overlay visibility
 */
export function toggleControlsOverlay() {
    const controlsOverlay = document.getElementById('controls-overlay');

    if (!controlsOverlay) {
        createControlsOverlay(true);
    } else {
        const isCurrentlyVisible = controlsOverlay.style.display !== 'none';
        controlsOverlay.style.display = isCurrentlyVisible ? 'none' : 'block';
    }
}

/**
 * Creates or updates the state overlay display
 * @param {boolean} [isVisible=true] - Whether to show or hide the overlay
 */
export function createStateOverlay(isVisible = true) {
    let stateOverlay = document.getElementById('state-overlay');

    if (!stateOverlay) {
        stateOverlay = document.createElement('div');
        stateOverlay.id = 'state-overlay';

        // Apply same styles as controls overlay but position bottom right
        const style = { ...UI.CONTROLS_OVERLAY_STYLE };
        style.bottom = '10px';
        style.right = '10px';
        style.left = 'auto';

        Object.assign(stateOverlay.style, style);

        document.body.appendChild(stateOverlay);
    }

    // Set visibility
    stateOverlay.style.display = isVisible ? 'block' : 'none';

    return stateOverlay;
}

/**
 * Updates the state overlay with current system state
 * @param {Object} stateData - Object containing current state information
 */
export function updateStateOverlay(stateData = {}) {
    const stateOverlay = document.getElementById('state-overlay');
    if (!stateOverlay || stateOverlay.style.display === 'none') return;

    const {
        currentTarget = 'Unknown',
        bloomEnabled = false,
        markersVisible = true,
        trailsVisible = false,
        orbitLinesVisible = false,
        physicsMode = 'Unknown',
        speed = 1,
        zoomDistance = 0,
        bodyPosition = { x: 0, y: 0, z: 0 }
    } = stateData;

    stateOverlay.innerHTML = `
        <div><strong>📊 Solar System State</strong></div>
        <div><strong>Focus:</strong> ${currentTarget}</div>
        <div><strong>Position:</strong></div>
        <div>&nbsp;&nbsp;X: ${bodyPosition.x.toFixed(4)}</div>
        <div>&nbsp;&nbsp;Y: ${bodyPosition.y.toFixed(4)}</div>
        <div>&nbsp;&nbsp;Z: ${bodyPosition.z.toFixed(4)}</div>
        <div><strong>Physics:</strong> ${physicsMode}</div>
        <div><strong>Bloom:</strong> ${bloomEnabled ? 'ON' : 'OFF'}</div>
        <div><strong>Markers:</strong> ${markersVisible ? 'ON' : 'OFF'}</div>
        <div><strong>Trails:</strong> ${trailsVisible ? 'ON' : 'OFF'}</div>
        <div><strong>Orbit Lines:</strong> ${orbitLinesVisible ? 'ON' : 'OFF'}</div>
        <div><strong>Speed:</strong> ${speed.toFixed(1)}x</div>
        <div><strong>Camera Distance:</strong> ${zoomDistance.toFixed(4)}</div>
    `;
}

/**
 * Toggles the state overlay visibility
 */
export function toggleStateOverlay() {
    const stateOverlay = document.getElementById('state-overlay');

    if (!stateOverlay) {
        createStateOverlay(true);
    } else {
        const isCurrentlyVisible = stateOverlay.style.display !== 'none';
        stateOverlay.style.display = isCurrentlyVisible ? 'none' : 'block';
    }
}

/**
 * Creates or updates the stats overlay display
 * @param {boolean} [isVisible=true] - Whether to show or hide the overlay
 */
export function createStatsOverlay(isVisible = true) {
    let statsOverlay = document.getElementById('stats-overlay');

    if (!statsOverlay) {
        statsOverlay = document.createElement('div');
        statsOverlay.id = 'stats-overlay';

        // Apply styles from constants
        Object.assign(statsOverlay.style, UI.STATS_OVERLAY_STYLE);

        document.body.appendChild(statsOverlay);
    }

    // Set visibility
    statsOverlay.style.display = isVisible ? 'block' : 'none';

    return statsOverlay;
}

/**
 * Updates the stats overlay with performance data
 * @param {Object} statsData - Object containing performance statistics
 */
export function updateStatsOverlay(statsData = {}) {
    const statsOverlay = document.getElementById('stats-overlay');
    if (!statsOverlay || statsOverlay.style.display === 'none') return;

    const {
        summary = { fps: { min: 0, max: 0, avg: 0 }, gpu: { min: 0, max: 0, avg: 0 }, cpu: { min: 0, max: 0, avg: 0 } },
        timeSeries = { fps: [], gpu: [], cpu: [] },
        sampleCount = 0
    } = statsData;

    // Create SVG line charts for time series data
    const createLineChart = (data, label, max = 100, color = '#00ff00') => {
        if (data.length === 0) return '';

        const width = 200;
        const height = 40;
        const padding = 2;
        const maxValue = Math.max(...data, max * 0.1); // Ensure some scale
        const minValue = Math.min(...data, 0);
        const valueRange = maxValue - minValue || 1;

        // Create path points
        let pathData = '';
        data.forEach((value, index) => {
            const x = padding + (index / (data.length - 1 || 1)) * (width - 2 * padding);
            const y = height - padding - ((value - minValue) / valueRange) * (height - 2 * padding);

            if (index === 0) {
                pathData += `M ${x} ${y}`;
            } else {
                pathData += ` L ${x} ${y}`;
            }
        });

        // Create grid lines for reference
        const gridLines = [];
        for (let i = 0; i <= 4; i++) {
            const y = padding + (i / 4) * (height - 2 * padding);
            gridLines.push(`<line x1="${padding}" y1="${y}" x2="${width - padding}" y2="${y}" stroke="#333" stroke-width="0.5" opacity="0.3"/>`);
        }

        const svg = `
            <div style="margin: 2px 0;">
                <div style="font-size: 10px; margin-bottom: 2px;">${label}: ${data[data.length - 1] || 0}${label.includes('FPS') ? '' : '%'} (max: ${Math.round(maxValue)})</div>
                <svg width="${width}" height="${height}" style="background: rgba(0,0,0,0.2); border-radius: 2px;">
                    ${gridLines.join('')}
                    <path d="${pathData}" stroke="${color}" stroke-width="1.5" fill="none" opacity="0.9"/>
                </svg>
            </div>
        `;

        return svg;
    };

    statsOverlay.innerHTML = `
        <div><strong>⚡ Performance Stats (${sampleCount} samples)</strong></div>
        <div style="margin-top: 5px;">
            ${createLineChart(timeSeries.fps, 'FPS', 120, '#00ff88')}
            ${createLineChart(timeSeries.gpu, 'GPU', 100, '#ffaa00')}
            ${createLineChart(timeSeries.cpu, 'CPU', 100, '#ff4444')}
        </div>
        <div style="margin-top: 5px; font-size: 10px; opacity: 0.8;">
            <div>Avg: FPS ${summary.fps.avg} | GPU ${summary.gpu.avg}% | CPU ${summary.cpu.avg}%</div>
        </div>
    `;
}

/**
 * Creates or updates the debug overlay display
 * @param {boolean} [isVisible=true] - Whether to show or hide the overlay
 */
export function createDebugOverlay(isVisible = true) {
    let debugOverlay = document.getElementById('debug-overlay');

    if (!debugOverlay) {
        debugOverlay = document.createElement('div');
        debugOverlay.id = 'debug-overlay';
        debugOverlay.style.cssText = `
            position: fixed;
            top: 10px;
            right: 10px;
            background: rgba(0, 0, 0, 0.8);
            color: #00ff00;
            font-family: 'Courier New', monospace;
            font-size: 12px;
            padding: 10px;
            border-radius: 5px;
            z-index: 10000;
            min-width: 200px;
            pointer-events: none;
            user-select: none;
        `;
        document.body.appendChild(debugOverlay);
    }

    // Update content
    const memory = getMemoryInfo();

    debugOverlay.innerHTML = `
        <div><strong>🚀 Solar System Debug</strong></div>
        <div>Memory: ${memory.usedJSHeapSize || 'N/A'}MB</div>
        <div>Environment: ${configService.get('ENVIRONMENT', 'unknown')}</div>
        <div><small>Press F12 → type dev.help()</small></div>
    `;

    // Show or hide the overlay
    debugOverlay.style.display = isVisible ? 'block' : 'none';
}

/**
 * Toggles the debug overlay visibility
 */
export function toggleDebugOverlay() {
    const debugOverlay = document.getElementById('debug-overlay');

    if (!debugOverlay) {
        createDebugOverlay(true);
    } else {
        const isCurrentlyVisible = debugOverlay.style.display !== 'none';
        debugOverlay.style.display = isCurrentlyVisible ? 'none' : 'block';
    }
}

/**
 * Get memory information
 */
function getMemoryInfo() {
    if (typeof performance === 'undefined' || !performance.memory) {
        return { usedJSHeapSize: null };
    }

    return {
        usedJSHeapSize: Math.round(performance.memory.usedJSHeapSize / 1024 / 1024)
    };
}

/**
 * Toggles the stats overlay visibility
 */
export function toggleStatsOverlay() {
    const statsOverlay = document.getElementById('stats-overlay');

    if (!statsOverlay) {
        createStatsOverlay(true);
    } else {
        const isCurrentlyVisible = statsOverlay.style.display !== 'none';
        statsOverlay.style.display = isCurrentlyVisible ? 'none' : 'block';
    }
}

