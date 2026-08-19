import { UI, SIMULATION } from '../constants.js';
import configService from '../utils/ConfigService.js';
import clockManager from '../managers/ClockManager.js';
import SceneManager from '../managers/SceneManager.js';

/**
 * The four debug overlays: controls, state, performance stats and environment.
 *
 * Plain functions rather than a class, because there is no state to hold. Each overlay is
 * found by its DOM id, which *is* the state — so any part of the app can toggle an overlay
 * without a reference to whatever created it, and a create call on an overlay that already
 * exists updates it rather than adding a second one.
 *
 * The two that show live data are refreshed by the animation loop, and both return early when
 * hidden so a hidden overlay costs nothing per frame.
 */

/**
 * Builds or refreshes the key bindings list.
 *
 * The contents are written out here rather than derived from
 * {@link InputController#handleKeydown}, which means the two can drift; the list is a little
 * out of date, showing `O` for orbit trails where the handler uses `T`, and omitting `S`,
 * `M`, `P` and `B`.
 *
 * @param {boolean} [isVisible=true] - Whether to show it immediately.
 * @returns {HTMLDivElement} The overlay element.
 */
export function createControlsOverlay(isVisible = true) {
    let controlsOverlay = document.getElementById('controls-overlay');

    if (!controlsOverlay) {
        controlsOverlay = document.createElement('div');
        controlsOverlay.id = 'controls-overlay';

        Object.assign(controlsOverlay.style, UI.CONTROLS_OVERLAY_STYLE);

        document.body.appendChild(controlsOverlay);
    }

    controlsOverlay.innerHTML = `
        <div><strong>🎮 Solar System Controls</strong></div>
        <div><strong>Mouse:</strong></div>
        <div>• Left click + drag: Rotate view</div>
        <div>• Right click + drag: Pan view</div>
        <div>• Scroll wheel: Zoom in/out</div>
        <div>• Shift + click: Drop a mass (n-body mode)</div>
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

    controlsOverlay.style.display = isVisible ? 'block' : 'none';

    return controlsOverlay;
}

/**
 * Shows or hides the controls list, creating it if this is the first request.
 *
 * Creating on first toggle means the overlay need not exist at startup — asking to see it is
 * enough.
 *
 * @returns {void}
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
 * Builds the empty state panel in the bottom-right corner.
 *
 * Reuses the controls overlay's styling with the corner swapped, so the two panels match
 * without a second style block. `left` has to be explicitly cleared, since a shared style
 * that sets it would otherwise stretch the panel across the viewport.
 *
 * Left empty; {@link updateStateDisplay} fills it in.
 *
 * @param {boolean} [isVisible=true] - Whether to show it immediately.
 * @returns {HTMLDivElement} The overlay element.
 */
export function createStateOverlay(isVisible = true) {
    let stateOverlay = document.getElementById('state-overlay');

    if (!stateOverlay) {
        stateOverlay = document.createElement('div');
        stateOverlay.id = 'state-overlay';

        const style = { ...UI.CONTROLS_OVERLAY_STYLE };
        style.bottom = '10px';
        style.right = '10px';
        style.left = 'auto';

        Object.assign(stateOverlay.style, style);

        document.body.appendChild(stateOverlay);
    }

    stateOverlay.style.display = isVisible ? 'block' : 'none';

    return stateOverlay;
}

/**
 * Redraws the state panel's contents.
 *
 * Returns immediately if the panel is hidden, which is what keeps this off the cost of a
 * normal frame — it is called from the animation loop.
 *
 * Every field is defaulted, so a caller that knows only some of the state can still pass what
 * it has.
 *
 * Positions are shown to four decimal places: scene units are large enough that bodies differ
 * in the third or fourth digit, and rounding further would make neighbouring moons look
 * identical.
 *
 * @param {Object} [stateData={}] - What to show.
 * @param {string} [stateData.currentTarget] - Name of the focused body.
 * @param {boolean} [stateData.bloomEnabled] - Whether bloom is on.
 * @param {boolean} [stateData.markersVisible] - Whether markers are on.
 * @param {boolean} [stateData.trailsVisible] - Whether trails are on.
 * @param {boolean} [stateData.orbitLinesVisible] - Whether orbit lines are on.
 * @param {string} [stateData.physicsMode] - Kepler or n-body.
 * @param {number} [stateData.speed] - The speed actually being applied.
 * @param {number|null} [stateData.requestedSpeed] - The speed asked for, when the integrator
 *   cannot keep up. Shown alongside the applied speed so a throttled simulation does not look
 *   like the speed keys have stopped working; `null` when nothing is being held back.
 * @param {number} [stateData.zoomDistance] - Camera distance to its orbit centre.
 * @param {{x: number, y: number, z: number}} [stateData.bodyPosition] - Focused body's
 *   position.
 * @returns {void}
 * @private
 */
function updateStateOverlay(stateData = {}) {
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
        requestedSpeed = null,
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
        <div><strong>Speed:</strong> ${speed.toFixed(1)}x${requestedSpeed
            ? ` <span style="opacity:0.7">(physics limited, ${requestedSpeed.toFixed(0)}x requested)</span>` : ''}</div>
        <div><strong>Camera Distance:</strong> ${zoomDistance.toFixed(4)}</div>
    `;
}

/**
 * Shows or hides the state panel, creating it if needed.
 *
 * @returns {void}
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
 * Builds the empty performance panel.
 *
 * Left empty; {@link updateStatsDisplay} fills it in.
 *
 * @param {boolean} [isVisible=true] - Whether to show it immediately.
 * @returns {HTMLDivElement} The overlay element.
 */
export function createStatsOverlay(isVisible = true) {
    let statsOverlay = document.getElementById('stats-overlay');

    if (!statsOverlay) {
        statsOverlay = document.createElement('div');
        statsOverlay.id = 'stats-overlay';

        Object.assign(statsOverlay.style, UI.STATS_OVERLAY_STYLE);

        document.body.appendChild(statsOverlay);
    }

    statsOverlay.style.display = isVisible ? 'block' : 'none';

    return statsOverlay;
}

/**
 * Redraws the performance panel: three sparkline charts and an average line.
 *
 * Charts rather than numbers, because what matters when tuning is whether the frame rate is
 * steady — a single figure hides the stutters, which is exactly what one wants to see.
 *
 * Drawn as inline SVG paths rather than a canvas, so the panel stays a DOM element and needs
 * no drawing surface of its own alongside the WebGL one.
 *
 * Returns immediately when hidden, since this runs from the animation loop.
 *
 * @param {Object} [statsData={}] - What to show.
 * @param {Object} [statsData.summary] - Min, max and average for each metric.
 * @param {{fps: number[], gpu: number[], cpu: number[]}} [statsData.timeSeries] - Recent
 *   samples, oldest first.
 * @param {number} [statsData.sampleCount] - How many samples the summary covers.
 * @returns {void}
 * @private
 */
function updateStatsOverlay(statsData = {}) {
    const statsOverlay = document.getElementById('stats-overlay');
    if (!statsOverlay || statsOverlay.style.display === 'none') return;

    const {
        summary = { fps: { min: 0, max: 0, avg: 0 }, gpu: { min: 0, max: 0, avg: 0 }, cpu: { min: 0, max: 0, avg: 0 } },
        timeSeries = { fps: [], gpu: [], cpu: [] },
        sampleCount = 0
    } = statsData;

    /**
     * Draws one metric as an SVG sparkline.
     *
     * The vertical axis is fitted to the data rather than pinned to the nominal maximum, so
     * small variations are still visible; the nominal maximum only sets a floor on the range,
     * which stops a flat series from being magnified into noise. The maximum in use is printed
     * in the label, since a chart whose scale moves is misleading without it.
     *
     * @param {number[]} data - Samples, oldest first.
     * @param {string} label - Metric name; the absence of "FPS" in it is what marks the values
     *   as percentages.
     * @param {number} [max=100] - Nominal maximum, used to floor the fitted range.
     * @param {string} [color='#00ff00'] - Line colour.
     * @returns {string} The chart's HTML, or an empty string if there are no samples.
     */
    const createLineChart = (data, label, max = 100, color = '#00ff00') => {
        if (data.length === 0) return '';

        const width = 200;
        const height = 40;
        const padding = 2;
        const maxValue = Math.max(...data, max * 0.1);
        const minValue = Math.min(...data, 0);
        const valueRange = maxValue - minValue || 1;

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
 * Builds the environment panel and fills it in.
 *
 * Styled inline rather than from {@link UI}, unlike the other three, since this one is not
 * meant to match them.
 *
 * Pointer events are off so it cannot intercept a drag that passes over it — it sits in the
 * top-right corner, where the camera is often being rotated.
 *
 * @param {boolean} [isVisible=true] - Whether to show it immediately.
 * @returns {void}
 * @private
 */
function createDebugOverlay(isVisible = true) {
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

    const memory = getMemoryInfo();

    debugOverlay.innerHTML = `
        <div><strong>🚀 Solar System Debug</strong></div>
        <div>Memory: ${memory.usedJSHeapSize || 'N/A'}MB</div>
        <div>Environment: ${configService.get('ENVIRONMENT', 'unknown')}</div>
        <div><small>Press F12 → type dev.help()</small></div>
    `;

    debugOverlay.style.display = isVisible ? 'block' : 'none';
}

/**
 * Shows or hides the environment panel, creating it if needed.
 *
 * @returns {void}
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
 * Refreshes the environment panel's memory reading.
 *
 * Separate from {@link createDebugOverlay} because this one must not create anything: it is
 * called from the animation loop, and creating on demand would make a panel the viewer had
 * dismissed reappear.
 *
 * @returns {void}
 */
export function updateDebugOverlay() {
    const debugOverlay = document.getElementById('debug-overlay');

    if (!debugOverlay || debugOverlay.style.display === 'none') {
        return;
    }

    const memory = getMemoryInfo();

    debugOverlay.innerHTML = `
        <div><strong>🚀 Solar System Debug</strong></div>
        <div>Memory: ${memory.usedJSHeapSize || 'N/A'}MB</div>
        <div>Environment: ${configService.get('ENVIRONMENT', 'unknown')}</div>
        <div><small>Press F12 → type dev.help()</small></div>
    `;
}

/**
 * Reads the JavaScript heap size, in megabytes.
 *
 * `performance.memory` is a Chrome extension to the standard and is missing elsewhere, so its
 * absence is treated as "unknown" rather than an error; the panel shows `N/A`.
 *
 * @returns {{usedJSHeapSize: number|null}} Heap size in MB, or `null` where unavailable.
 * @private
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
 * Whether an overlay exists and is not hidden.
 *
 * Checks the inline `display` rather than computed style, which is enough here because that is
 * the only way these overlays are ever hidden.
 *
 * @param {string} id - The overlay's DOM id.
 * @returns {boolean} True if it is on screen.
 * @private
 */
function isOverlayVisible(id) {
    const overlay = document.getElementById(id);
    return !!overlay && overlay.style.display !== 'none';
}

/**
 * Whether the performance panel is on screen.
 *
 * Exported so the animation loop can skip *collecting* the samples, not just displaying them
 * — the GPU timer queries behind them are not free.
 *
 * @returns {boolean} True if it is visible.
 */
export function isStatsOverlayVisible() {
    return isOverlayVisible('stats-overlay');
}

/**
 * Gathers the current state from around the app and redraws the state panel.
 *
 * This is where the state is collected rather than pushed: each toggle would otherwise have to
 * remember to tell the panel, and any that forgot would leave it stale. Reading everything
 * fresh each frame means the panel cannot disagree with the simulation.
 *
 * The focused body is read off `window.InputController`, since the panel has no reference to
 * the controller; guarded, so it degrades to "Unknown" rather than throwing if the global is
 * not set up.
 *
 * Speeds are multiplied by 100 to match the percent-like units the controls use, the inverse
 * of the conversion in {@link InputController#increaseSpeed}.
 *
 * @param {AnimationManager} animationManager - Source of the visibility flags.
 * @returns {void}
 */
export function updateStateDisplay(animationManager) {
    if (!isOverlayVisible('state-overlay')) return;

    let targetName = 'Unknown';
    let bodyPosition = { x: 0, y: 0, z: 0 };
    if (typeof window !== 'undefined' && window.InputController) {
        const currentTarget = window.InputController.getCurrentTarget();
        targetName = currentTarget?.name || 'Unknown';

        if (currentTarget?.body?.group?.position) {
            const pos = currentTarget.body.group.position;
            bodyPosition = {
                x: pos.x,
                y: pos.y,
                z: pos.z
            };
        }
    }

    const speed = clockManager.getSpeedMultiplier() * 100.0;
    const requestedSpeed = clockManager.isSpeedLimitedByPhysics()
        ? clockManager.getRequestedSpeedMultiplier() * 100.0
        : null;

    let zoomDistance = 0;
    if (SceneManager.camera && SceneManager.controls?.target) {
        zoomDistance = SceneManager.camera.position.distanceTo(SceneManager.controls.target);
    }

    const bloomEnabled = SceneManager.isBloomEnabled() || false;
    const markersVisible = animationManager.getMarkersVisibility();

    const orbitLinesVisible = animationManager.getOrbitLinesVisibility();
    const trailsVisible = animationManager.getTrailsVisibility();

    updateStateOverlay({
        currentTarget: targetName,
        bloomEnabled,
        markersVisible,
        trailsVisible,
        orbitLinesVisible,
        physicsMode: SIMULATION.getPhysicsMode(),
        speed,
        requestedSpeed,
        zoomDistance,
        bodyPosition
    });
}

/**
 * Pulls the latest samples and redraws the performance panel.
 *
 * @param {PerformanceStats} performanceStats - Source of the samples and summary.
 * @returns {void}
 */
export function updateStatsDisplay(performanceStats) {
    if (!isOverlayVisible('stats-overlay')) return;

    const currentStats = performanceStats.getCurrentStats();
    const summary = performanceStats.getStatsSummary();
    const timeSeries = performanceStats.getTimeSeries();

    updateStatsOverlay({
        current: currentStats,
        summary: summary,
        timeSeries: timeSeries,
        sampleCount: summary.sampleCount
    });
}

/**
 * Shows or hides the performance panel, creating it if needed.
 *
 * @returns {void}
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

