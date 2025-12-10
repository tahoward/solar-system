/**
 * Centralized logging utility for the solar system application
 * Provides consistent logging with levels, filtering, and conditional output
 */

/**
 * Log levels in order of severity
 */
export const LogLevel = {
    DEBUG: 0,
    INFO: 1,
    WARN: 2,
    ERROR: 3,
    NONE: 4
};

/**
 * Centralized logger class
 */
class Logger {
    constructor() {
        // Set log level based on environment
        this.currentLevel = this._getEnvironmentLogLevel();
        this.enabledContexts = new Set();
        this.logHistory = [];
        this.maxHistorySize = 100;
    }

    /**
     * Determines log level based on environment
     * @returns {number} Log level
     * @private
     */
    _getEnvironmentLogLevel() {
        // In production, only show warnings and errors
        if (typeof process !== 'undefined' && process.env?.NODE_ENV === 'production') {
            return LogLevel.WARN;
        }
        // In development, show all logs
        return LogLevel.DEBUG;
    }

    /**
     * Sets the global log level
     * @param {number} level - Log level from LogLevel enum
     */
    setLevel(level) {
        this.currentLevel = level;
    }

    /**
     * Enables logging for specific contexts
     * @param {...string} contexts - Context names to enable
     */
    enableContexts(...contexts) {
        contexts.forEach(context => this.enabledContexts.add(context));
    }

    /**
     * Disables logging for specific contexts
     * @param {...string} contexts - Context names to disable
     */
    disableContexts(...contexts) {
        contexts.forEach(context => this.enabledContexts.delete(context));
    }

    /**
     * Clears all enabled contexts (disables context filtering)
     */
    clearContexts() {
        this.enabledContexts.clear();
    }

    /**
     * Checks if a log should be output
     * @param {number} level - Log level
     * @param {string} context - Log context
     * @returns {boolean} Whether to output the log
     * @private
     */
    _shouldLog(level, context) {
        // Check log level
        if (level < this.currentLevel) {
            return false;
        }

        // Check context filtering (if any contexts are enabled)
        if (this.enabledContexts.size > 0 && !this.enabledContexts.has(context)) {
            return false;
        }

        return true;
    }

    /**
     * Adds a log entry to history
     * @param {number} level - Log level
     * @param {string} context - Log context
     * @param {string} message - Log message
     * @param {any} data - Additional data
     * @private
     */
    _addToHistory(level, context, message, data) {
        const entry = {
            timestamp: new Date().toISOString(),
            level,
            context,
            message,
            data
        };

        this.logHistory.push(entry);

        // Limit history size
        if (this.logHistory.length > this.maxHistorySize) {
            this.logHistory.shift();
        }
    }

    /**
     * Formats a log message
     * @param {string} context - Log context
     * @param {string} message - Log message
     * @returns {string} Formatted message
     * @private
     */
    _formatMessage(context, message) {
        const timestamp = new Date().toISOString().substr(11, 12); // HH:mm:ss.SSS
        return `[${timestamp}] ${context}: ${message}`;
    }

    /**
     * Debug level logging
     * @param {string} context - Log context (e.g., 'CameraController', 'Marker')
     * @param {string} message - Log message
     * @param {any} [data] - Additional data to log
     */
    debug(context, message, data = null) {
        if (!this._shouldLog(LogLevel.DEBUG, context)) return;

        const formatted = this._formatMessage(context, message);
        this._addToHistory(LogLevel.DEBUG, context, message, data);

        if (data !== null) {
            console.debug(formatted, data);
        } else {
            console.debug(formatted);
        }
    }

    /**
     * Info level logging
     * @param {string} context - Log context
     * @param {string} message - Log message
     * @param {any} [data] - Additional data to log
     */
    info(context, message, data = null) {
        if (!this._shouldLog(LogLevel.INFO, context)) return;

        const formatted = this._formatMessage(context, message);
        this._addToHistory(LogLevel.INFO, context, message, data);

        if (data !== null) {
            console.info(formatted, data);
        } else {
            console.info(formatted);
        }
    }

    /**
     * Warning level logging
     * @param {string} context - Log context
     * @param {string} message - Log message
     * @param {any} [data] - Additional data to log
     */
    warn(context, message, data = null) {
        if (!this._shouldLog(LogLevel.WARN, context)) return;

        const formatted = this._formatMessage(context, message);
        this._addToHistory(LogLevel.WARN, context, message, data);

        if (data !== null) {
            console.warn(formatted, data);
        } else {
            console.warn(formatted);
        }
    }

    /**
     * Error level logging
     * @param {string} context - Log context
     * @param {string} message - Log message
     * @param {Error|any} [error] - Error object or additional data
     */
    error(context, message, error = null) {
        if (!this._shouldLog(LogLevel.ERROR, context)) return;

        const formatted = this._formatMessage(context, message);
        this._addToHistory(LogLevel.ERROR, context, message, error);

        if (error !== null) {
            console.error(formatted, error);
        } else {
            console.error(formatted);
        }
    }

    /**
     * Gets the log history
     * @param {number} [maxEntries] - Maximum number of entries to return
     * @returns {Array} Log history
     */
    getHistory(maxEntries = null) {
        if (maxEntries) {
            return this.logHistory.slice(-maxEntries);
        }
        return [...this.logHistory];
    }

    /**
     * Clears the log history
     */
    clearHistory() {
        this.logHistory = [];
    }

    /**
     * Gets current logger configuration
     * @returns {Object} Logger configuration
     */
    getConfig() {
        return {
            currentLevel: this.currentLevel,
            enabledContexts: Array.from(this.enabledContexts),
            historySize: this.logHistory.length,
            maxHistorySize: this.maxHistorySize
        };
    }
}

// Create and export singleton logger instance
const logger = new Logger();

// Export convenience functions for common contexts
export const log = {
    // Direct logger methods
    debug: (context, message, data) => logger.debug(context, message, data),
    info: (context, message, data) => logger.info(context, message, data),
    warn: (context, message, data) => logger.warn(context, message, data),
    error: (context, message, error) => logger.error(context, message, error),

    // General system contexts
    scene: (message, data) => logger.info('SceneManager', message, data),
    camera: (message, data) => logger.debug('CameraController', message, data),
    animation: (message, data) => logger.debug('AnimationManager', message, data),
    marker: (message, data) => logger.debug('Marker', message, data),
    input: (message, data) => logger.debug('InputController', message, data),

    // System events
    init: (context, message, data) => logger.info(context, `Initialized: ${message}`, data),
    dispose: (context, message, data) => logger.info(context, `Disposed: ${message}`, data),

    // Performance logging
    perf: (context, operation, duration) => {
        logger.debug(context, `Performance: ${operation} took ${duration.toFixed(2)}ms`);
    }
};

export default logger;