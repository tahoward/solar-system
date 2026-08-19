import configService, { debugConfig } from './ConfigService.js';
import logger, { log } from './Logger.js';

class DevConsole {
    constructor() {
        this.commands = new Map();
        this.history = [];
        this.maxHistory = 50;

        this._registerDefaultCommands();

        if (configService.get('DEBUG.CONSOLE_ENABLED', true)) {
            this._exposeToGlobal();
        }
    }

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

        this.register('scene', () => this._getSceneInfo(), 'Show scene information');

        this.register('help', () => this._getHelpInfo(), 'Show available commands');
    }

    _exposeToGlobal() {
        if (typeof window !== 'undefined') {
            window.dev = {
                run: (command, ...args) => this.run(command, ...args),
                help: () => this.run('help'),
                info: () => this.run('info'),
                config: (category) => this.run('config', category),
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

    register(name, handler, description = '') {
        this.commands.set(name, { handler, description });
    }

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

    _getSystemInfo() {
        return {
            environment: configService.getSummary(),
            browser: this._getBrowserInfo(),
            webgl: this._getWebGLInfo(),
            memory: this._getMemoryInfo(),
            timestamp: new Date().toISOString()
        };
    }

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

class DevUtils {
    constructor() {
        this.console = new DevConsole();
        this.enabled = configService.get('DEBUG.ENABLED', false);
    }

    init() {
        if (!this.enabled) return;

        log.info('DevUtils', 'Development utilities initialized');

        this._setupKeyboardShortcuts();

        if (typeof window !== 'undefined') {
            window.DevUtils = this;
        }
    }

    _setupKeyboardShortcuts() {
        if (typeof document === 'undefined') return;

        document.addEventListener('keydown', (event) => {
            if (event.key === 'F2') {
                event.preventDefault();
                this.toggleWireframes();
            }
        });
    }

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