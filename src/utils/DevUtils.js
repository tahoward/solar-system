import configService, { debugConfig } from './ConfigService.js';
import logger, { log } from './Logger.js';

/**
 * Registry of named debug commands, exposed on `window.dev` in development.
 *
 * Commands are plain functions returning inspectable objects, so their results
 * render usefully when called straight from the browser console. Each invocation
 * is recorded in a bounded history and thrown errors are captured rather than
 * propagated, so a bad command cannot break the session.
 */
class DevConsole {
    /**
     * Registers the built-in commands and, unless disabled by configuration,
     * publishes the `window.dev` helper.
     */
    constructor() {
        this.commands = new Map();
        this.history = [];
        this.maxHistory = 50;

        this._registerDefaultCommands();

        if (configService.get('DEBUG.CONSOLE_ENABLED', true)) {
            this._exposeToGlobal();
        }
    }

    /**
     * Registers the commands available out of the box.
     *
     * Covers system/browser/WebGL info, configuration and log inspection, and a
     * `cleanup` command that stops the render loop and empties the scene. The
     * cleanup is deliberately destructive and one-way — it is a leak-hunting
     * tool, and the page must be reloaded afterwards.
     *
     * @private
     * @returns {void}
     */
    _registerDefaultCommands() {
        this.register('info', () => this._getSystemInfo(), 'Show system information');

        this.register('cleanup', () => {
            log.info('DevUtils', '🧹 Cleanup: Stopping animation...');
            if (typeof window !== 'undefined' && window.SceneManager?.renderer) {
                window.SceneManager.renderer.setAnimationLoop(null);
            }

            log.info('DevUtils', '🧹 Cleanup: Clearing scene...');
            let sceneChildrenBefore = 0;
            let sceneChildrenAfter = 0;

            if (typeof window !== 'undefined' && window.SceneManager?.scene) {
                sceneChildrenBefore = window.SceneManager.scene.children.length;
                log.info('DevUtils', `🧹 Scene children before cleanup: ${sceneChildrenBefore}`);

                const childrenToRemove = [...window.SceneManager.scene.children];
                childrenToRemove.forEach((child, index) => {
                    log.info('DevUtils', `🧹 Removing child ${index}: ${child.type} (${child.name || 'unnamed'})`);
                    window.SceneManager.scene.remove(child);

                    if (child.geometry?.dispose) {
                        child.geometry.dispose();
                        log.info('DevUtils', `🧹 Disposed geometry for ${child.type}`);
                    }
                    if (child.material?.dispose) {
                        child.material.dispose();
                        log.info('DevUtils', `🧹 Disposed material for ${child.type}`);
                    }
                });

                sceneChildrenAfter = window.SceneManager.scene.children.length;
                log.info('DevUtils', `🧹 Scene children after cleanup: ${sceneChildrenAfter}`);

                window.SceneManager.skyboxManager?.removeSkybox(window.SceneManager.scene);

                if (window.SceneManager.renderer && window.SceneManager.camera) {
                    log.info('DevUtils', '🧹 Forcing render update...');
                    window.SceneManager.renderer.render(window.SceneManager.scene, window.SceneManager.camera);
                }
            } else {
                log.warn('DevUtils', '🧹 WARNING: Could not access SceneManager or scene!');
            }

            log.info('DevUtils', '🧹 Cleanup: Complete! Scene cleared.');

            return {
                message: 'Scene cleared and animation stopped',
                sceneChildrenBefore,
                sceneChildrenAfter,
                warning: 'Scene has been completely cleared. Refresh page to restart.',
                sceneCleared: sceneChildrenAfter === 0,
                debugInfo: {
                    sceneManagerAvailable: !!(typeof window !== 'undefined' && window.SceneManager),
                    rendererAvailable: !!(typeof window !== 'undefined' && window.SceneManager?.renderer),
                    animationStopped: true
                }
            };
        }, 'Clean up all resources and clear scene');

        this.register('config', (category = null) => {
            return category ? configService.getCategory(category.toUpperCase()) : configService.getSummary();
        }, 'Show configuration (optional category)');

        this.register('logs', (count = 20) => {
            return logger.getHistory(parseInt(count));
        }, 'Show recent log entries');

        this.register('perf', () => this._getPerformanceInfo(), 'Show performance information');

        this.register('discStep', (value = null) => this._setDiscStep(value),
            'Show or set the accretion disc march step (higher is cheaper and coarser)');

        this.register('scene', () => this._getSceneInfo(), 'Show scene information');

        this.register('help', () => this._getHelpInfo(), 'Show available commands');
    }

    /**
     * Publishes `window.dev` with `run` plus a shorthand per built-in command.
     *
     * No-ops outside a browser.
     *
     * @private
     * @returns {void}
     */
    _exposeToGlobal() {
        if (typeof window !== 'undefined') {
            window.dev = {
                run: (command, ...args) => this.run(command, ...args),
                help: () => this.run('help'),
                info: () => this.run('info'),
                config: (category) => this.run('config', category),
                logs: (count) => this.run('logs', count),
                perf: () => this.run('perf'),
                discStep: (value) => this.run('discStep', value),
                scene: () => this.run('scene'),
                cleanup: () => this.run('cleanup'),
                register: (name, handler, description) => this.register(name, handler, description)
            };

            log.info('DevUtils', '%c🚀 Solar System Dev Console Available!', 'color: #00ff00; font-weight: bold;');
            log.info('DevUtils', '%cType dev.help() for available commands', 'color: #888;');
        }
    }

    /**
     * Adds or replaces a command.
     *
     * @param {string} name - Command name used by {@link DevConsole#run}.
     * @param {function(...*): *} handler - Implementation; its return value is
     *   surfaced to the caller.
     * @param {string} [description=''] - Text shown by the `help` command.
     * @returns {void}
     */
    register(name, handler, description = '') {
        this.commands.set(name, { handler, description });
    }

    /**
     * Runs a registered command and records it in the history.
     *
     * @param {string} command - Name of the command to run.
     * @param {...*} args - Arguments forwarded to the handler.
     * @returns {*} The handler's return value; a message string if the command is
     *   unknown, or `{error: string}` if the handler threw.
     */
    run(command, ...args) {
        const cmd = this.commands.get(command);
        if (!cmd) {
            return `Unknown command: ${command}. Type 'help' for available commands.`;
        }

        try {
            const result = cmd.handler(...args);
            this.history.unshift({ command, args, result, timestamp: new Date() });

            if (this.history.length > this.maxHistory) {
                this.history = this.history.slice(0, this.maxHistory);
            }

            return result;
        } catch (error) {
            log.error('DevConsole', `Error running command ${command}:`, error);
            return { error: error.message };
        }
    }

    /**
     * Gathers a combined environment snapshot.
     *
     * @private
     * @returns {{environment: Object, browser: Object|string, webgl: Object|string,
     *   memory: Object|string, timestamp: string}} Configuration, browser, WebGL
     *   and memory details with a capture time.
     */
    _getSystemInfo() {
        return {
            environment: configService.getSummary(),
            browser: this._getBrowserInfo(),
            webgl: this._getWebGLInfo(),
            memory: this._getMemoryInfo(),
            timestamp: new Date().toISOString()
        };
    }

    /**
     * Reads identifying details from `navigator`.
     *
     * @private
     * @returns {Object|string} Browser details, or `'Not available'` outside a browser.
     */
    _getBrowserInfo() {
        if (typeof navigator === 'undefined') return 'Not available';

        return {
            userAgent: navigator.userAgent,
            platform: navigator.platform,
            language: navigator.language,
            cookieEnabled: navigator.cookieEnabled,
            onLine: navigator.onLine
        };
    }

    /**
     * Queries driver and capability strings from a throwaway WebGL context.
     *
     * Uses its own canvas so it can be called before (or without) the renderer
     * existing, and reports the shader-relevant limits that explain most
     * device-specific rendering differences.
     *
     * @private
     * @returns {Object|string} Vendor, renderer, version and limits; a message if
     *   unavailable or unsupported; or `{error: string}` if the query threw.
     */
    _getWebGLInfo() {
        if (typeof document === 'undefined') return 'Not available';

        try {
            const canvas = document.createElement('canvas');
            const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');

            if (!gl) return 'WebGL not supported';

            return {
                vendor: gl.getParameter(gl.VENDOR),
                renderer: gl.getParameter(gl.RENDERER),
                version: gl.getParameter(gl.VERSION),
                shadingLanguageVersion: gl.getParameter(gl.SHADING_LANGUAGE_VERSION),
                maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE),
                maxVertexAttributes: gl.getParameter(gl.MAX_VERTEX_ATTRIBS)
            };
        } catch (error) {
            return { error: error.message };
        }
    }

    /**
     * Reports JS heap usage, in megabytes.
     *
     * Relies on the non-standard `performance.memory`, so it is only available in
     * Chromium-based browsers.
     *
     * @private
     * @returns {{usedJSHeapSize: number, totalJSHeapSize: number,
     *   jsHeapSizeLimit: number}|string} Heap sizes in MB, or a message when the
     *   API is missing.
     */
    _getMemoryInfo() {
        if (typeof performance === 'undefined' || !performance.memory) {
            return 'Memory information not available';
        }

        return {
            usedJSHeapSize: Math.round(performance.memory.usedJSHeapSize / 1024 / 1024),
            totalJSHeapSize: Math.round(performance.memory.totalJSHeapSize / 1024 / 1024),
            jsHeapSizeLimit: Math.round(performance.memory.jsHeapSizeLimit / 1024 / 1024)
        };
    }

    /**
     * Collects page-load timings and heap usage.
     *
     * @private
     * @returns {{navigation: PerformanceEntry[], memory: Object|string,
     *   timing: Object|string}} Navigation entries, memory info and derived
     *   load durations in milliseconds.
     */
    _getPerformanceInfo() {
        return {
            navigation: typeof performance !== 'undefined' ? performance.getEntriesByType('navigation') : [],
            memory: this._getMemoryInfo(),
            timing: typeof performance !== 'undefined' ? {
                domContentLoaded: performance.timing?.domContentLoadedEventEnd - performance.timing?.navigationStart,
                loadComplete: performance.timing?.loadEventEnd - performance.timing?.navigationStart
            } : 'Not available'
        };
    }

    /**
     * Shows or sets how finely every accretion disc's march samples its gas.
     *
     * The disc is the most expensive thing in the scene when a hole is on screen — a per-pixel
     * geodesic march — and this is its cost dial; see {@link AccretionDisk#setSlabStep} for the
     * trade and the values worth trying. It is here rather than in the configuration because it
     * is a thing to turn while watching the disc, and a reload loses the view it was being
     * judged from.
     *
     * The holes are reached through the bloom manager's register rather than by walking the
     * scene, since that is the list of what is lensing this frame and a disc without a hole is
     * not a case that arises.
     *
     * @private
     * @param {number|string|null} [value=null] - The new step, or null to only report. Strings
     *   are accepted, since a console argument often arrives as one.
     * @returns {{discs: Array<{body: string, slabStep: number}>, changed: boolean,
     *   message: string}} The step now in force for each disc found.
     */
    _setDiscStep(value = null) {
        const holes = window?.SceneManager?.bloomManager?.blackHoles;
        const discs = [];

        for (const body of holes || []) {
            if (!body?.accretionDisk) continue;

            if (value !== null && value !== undefined && value !== '') {
                body.accretionDisk.setSlabStep(Number(value));
            }

            discs.push({ body: body.name, slabStep: body.accretionDisk.getSlabStep() });
        }

        const changed = discs.length > 0 && value !== null && value !== undefined && value !== '';

        return {
            discs,
            changed,
            message: discs.length === 0
                ? 'No accretion disc in the scene'
                : `${changed ? 'Set' : 'Current'} march step for ${discs.length} disc(s); higher is cheaper and coarser`
        };
    }

    /**
     * Placeholder for scene inspection.
     *
     * This module is imported by low-level code and deliberately holds no
     * reference to the scene, so the real command has to be supplied by the
     * application via {@link DevConsole#register}.
     *
     * @private
     * @returns {{notice: string, suggestion: string}|{error: string}} Guidance on
     *   registering a scene command.
     */
    _getSceneInfo() {
        try {
            return {
                notice: 'Scene information would require SceneManager injection',
                suggestion: 'Register scene commands via DevConsole.register() in your main application'
            };
        } catch (error) {
            return { error: 'Scene information not available' };
        }
    }

    /**
     * Lists the registered commands with usage examples.
     *
     * @private
     * @returns {{availableCommands: Array<{command: string, description: string}>,
     *   usage: string, examples: string[]}} Help payload for the `help` command.
     */
    _getHelpInfo() {
        const commands = [];
        for (const [name, { description }] of this.commands) {
            commands.push({ command: name, description });
        }
        return {
            availableCommands: commands,
            usage: 'dev.run("command", ...args) or use shorthand dev.command()',
            examples: [
                'dev.info() - System information',
                'dev.config("DEBUG") - Debug configuration',
                'dev.logs(10) - Last 10 log entries'
            ]
        };
    }
}

/**
 * Entry point for the development-only tooling.
 *
 * Owns the {@link DevConsole} and the debug keyboard shortcuts. A single instance
 * is created and self-initialises on import unless `DEBUG.AUTO_INIT` is turned
 * off; when `DEBUG.ENABLED` is false, {@link DevUtils#init} does nothing, so the
 * tooling stays inert in production without needing to be tree-shaken out.
 */
class DevUtils {
    /**
     * Creates the dev console and reads the enabled flag from configuration.
     */
    constructor() {
        this.console = new DevConsole();
        this.enabled = configService.get('DEBUG.ENABLED', false);
    }

    /**
     * Installs the debug shortcuts and publishes `window.DevUtils`.
     *
     * No-ops entirely when debug support is disabled.
     *
     * @returns {void}
     */
    init() {
        if (!this.enabled) return;

        log.info('DevUtils', 'Development utilities initialized');

        this._setupKeyboardShortcuts();

        if (typeof window !== 'undefined') {
            window.DevUtils = this;
        }
    }

    /**
     * Binds the debug keyboard shortcuts (F2 toggles wireframes).
     *
     * @private
     * @returns {void}
     */
    _setupKeyboardShortcuts() {
        if (typeof document === 'undefined') return;

        document.addEventListener('keydown', (event) => {
            if (event.key === 'F2') {
                event.preventDefault();
                this.toggleWireframes();
            }
        });
    }

    /**
     * Flips the `DEBUG.SHOW_WIREFRAMES` configuration flag.
     *
     * Materials read the flag themselves, so no scene traversal is needed here.
     *
     * @returns {void}
     */
    toggleWireframes() {
        const currentState = debugConfig('SHOW_WIREFRAMES');
        configService.set('DEBUG.SHOW_WIREFRAMES', !currentState);
        log.info('DevUtils', `Wireframes ${!currentState ? 'enabled' : 'disabled'}`);
    }
}

const devUtils = new DevUtils();

if (configService.get('DEBUG.AUTO_INIT', true)) {
    devUtils.init();
}

export default devUtils;