/**
 * Development utilities and debugging aids for the solar system application
 * Provides tools for debugging, performance analysis, and development workflow
 */

import configService, { debugConfig } from './ConfigService.js';
import logger, { log } from './Logger.js';

/**
 * Development console commands and debugging utilities
 */
class DevConsole {
    constructor() {
        this.commands = new Map();
        this.history = [];
        this.maxHistory = 50;

        // Register default commands
        this._registerDefaultCommands();

        // Expose to global scope in development
        if (configService.get('DEBUG.CONSOLE_ENABLED', true)) {
            this._exposeToGlobal();
        }
    }

    /**
     * Register default development commands
     * @private
     */
    _registerDefaultCommands() {
        // System information
        this.register('info', () => this._getSystemInfo(), 'Show system information');

        this.register('cleanup', () => {
            // Stop animation first - force stop the renderer animation loop
            log.info('DevUtils', '🧹 Cleanup: Stopping animation...');
            if (typeof window !== 'undefined' && window.SceneManager?.renderer) {
                window.SceneManager.renderer.setAnimationLoop(null);
            }

            // Clear the entire scene as a nuclear option
            log.info('DevUtils', '🧹 Cleanup: Clearing scene...');
            let sceneChildrenBefore = 0;
            let sceneChildrenAfter = 0;

            if (typeof window !== 'undefined' && window.SceneManager?.scene) {
                sceneChildrenBefore = window.SceneManager.scene.children.length;
                log.info('DevUtils', `🧹 Scene children before cleanup: ${sceneChildrenBefore}`);

                // Remove all children from the scene
                const childrenToRemove = [...window.SceneManager.scene.children];
                childrenToRemove.forEach((child, index) => {
                    log.info('DevUtils', `🧹 Removing child ${index}: ${child.type} (${child.name || 'unnamed'})`);
                    window.SceneManager.scene.remove(child);

                    // Dispose of the child if it has dispose methods
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

                // Force a render to update the display
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

        // Configuration
        this.register('config', (category = null) => {
            return category ? configService.getCategory(category.toUpperCase()) : configService.getSummary();
        }, 'Show configuration (optional category)');

        // Logging
        this.register('logs', (count = 20) => {
            return logger.getHistory(parseInt(count));
        }, 'Show recent log entries');

        // Performance
        this.register('perf', () => this._getPerformanceInfo(), 'Show performance information');

        // Scene debugging
        this.register('scene', () => this._getSceneInfo(), 'Show scene information');

        // Help command
        this.register('help', () => this._getHelpInfo(), 'Show available commands');
    }

    /**
     * Expose development console to global scope
     * @private
     */
    _exposeToGlobal() {
        if (typeof window !== 'undefined') {
            window.dev = {
                run: (command, ...args) => this.run(command, ...args),
                help: () => this.run('help'),
                info: () => this.run('info'),
                config: (category) => this.run('config', category),
                resources: () => this.run('resources'),
                logs: (count) => this.run('logs', count),
                perf: () => this.run('perf'),
                scene: () => this.run('scene'),
                cleanup: () => this.run('cleanup'),
                register: (name, handler, description) => this.register(name, handler, description)
            };

            log.info('DevUtils', '%c🚀 Solar System Dev Console Available!', 'color: #00ff00; font-weight: bold;');
            log.info('DevUtils', '%cType dev.help() for available commands', 'color: #888;');
        }
    }

    /**
     * Register a new console command
     * @param {string} name - Command name
     * @param {Function} handler - Command handler function
     * @param {string} [description] - Command description
     */
    register(name, handler, description = '') {
        this.commands.set(name, { handler, description });
    }

    /**
     * Run a console command
     * @param {string} command - Command name
     * @param {...any} args - Command arguments
     * @returns {any} Command result
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
     * Get system information
     * @private
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
     * Get browser information
     * @private
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
     * Get WebGL information
     * @private
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
     * Get memory information
     * @private
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
     * Get performance information
     * @private
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
     * Get scene information (requires SceneManager)
     * @private
     */
    _getSceneInfo() {
        try {
            // Try to access SceneManager - this would need to be injected in real usage
            return {
                notice: 'Scene information would require SceneManager injection',
                suggestion: 'Register scene commands via DevConsole.register() in your main application'
            };
        } catch (error) {
            return { error: 'Scene information not available' };
        }
    }

    /**
     * Get help information
     * @private
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
                'dev.logs(10) - Last 10 log entries',
                'dev.resources() - Resource statistics'
            ]
        };
    }
}


/**
 * Development utilities collection
 */
class DevUtils {
    constructor() {
        this.console = new DevConsole();
        this.enabled = configService.get('DEBUG.ENABLED', false);
    }

    /**
     * Initialize development utilities
     */
    init() {
        if (!this.enabled) return;

        log.info('DevUtils', 'Development utilities initialized');

        // Setup keyboard shortcuts
        this._setupKeyboardShortcuts();

        // Expose utilities globally
        if (typeof window !== 'undefined') {
            window.DevUtils = this;
        }
    }

    /**
     * Setup development keyboard shortcuts
     * @private
     */
    _setupKeyboardShortcuts() {
        if (typeof document === 'undefined') return;

        document.addEventListener('keydown', (event) => {
            // Debug overlay now toggles with F3 along with other UI elements
            // if (event.key === 'F1') {
            //     event.preventDefault();
            //     this.toggleOverlay();
            // }

            // Toggle wireframes with F2
            if (event.key === 'F2') {
                event.preventDefault();
                this.toggleWireframes();
            }
        });
    }


    /**
     * Toggle wireframe mode (would need SceneManager integration)
     */
    toggleWireframes() {
        const currentState = debugConfig('SHOW_WIREFRAMES');
        configService.set('DEBUG.SHOW_WIREFRAMES', !currentState);
        log.info('DevUtils', `Wireframes ${!currentState ? 'enabled' : 'disabled'}`);
    }

    /**
     * Record performance frame
     */
    recordFrame() {
        // Performance frame recording moved to ui.js
    }
}

// Create singleton instance
const devUtils = new DevUtils();

// Auto-initialize in development
if (configService.get('DEBUG.AUTO_INIT', true)) {
    devUtils.init();
}

export { DevConsole };
export default devUtils;