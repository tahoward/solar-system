/**
 * Severity levels, ordered so that a numerically higher level is more severe.
 *
 * `NONE` sits above every real level and is used as a threshold to silence
 * output entirely.
 *
 * @enum {number}
 */
const LogLevel = {
    DEBUG: 0,
    INFO: 1,
    WARN: 2,
    ERROR: 3,
    NONE: 4
};

/**
 * Console logger with level filtering and a bounded in-memory history.
 *
 * A single shared instance backs the whole application; prefer the {@link log}
 * facade over constructing this directly. Messages below the active level are
 * dropped before formatting, so disabled logging costs almost nothing.
 */
class Logger {
    /**
     * Creates a logger with a level chosen from the build environment and an
     * empty history buffer.
     */
    constructor() {
        this.currentLevel = this._getEnvironmentLogLevel();
        this.logHistory = [];
        this.maxHistorySize = 100;
    }

    /**
     * Picks the starting level for the current environment.
     *
     * @private
     * @returns {number} A {@link LogLevel} value: `WARN` in production builds,
     *   `DEBUG` everywhere else.
     */
    _getEnvironmentLogLevel() {
        if (typeof process !== 'undefined' && process.env?.NODE_ENV === 'production') {
            return LogLevel.WARN;
        }
        return LogLevel.DEBUG;
    }

    /**
     * Tests a level against the active threshold.
     *
     * @private
     * @param {number} level - {@link LogLevel} value to test.
     * @returns {boolean} `true` when a message at this level should be emitted.
     */
    _shouldLog(level) {
        return level >= this.currentLevel;
    }

    /**
     * Appends an entry to the history, evicting the oldest once full.
     *
     * @private
     * @param {number} level - {@link LogLevel} value of the entry.
     * @param {string} context - Subsystem the message came from.
     * @param {string} message - Message text.
     * @param {*} data - Arbitrary payload logged alongside the message.
     * @returns {void}
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

        if (this.logHistory.length > this.maxHistorySize) {
            this.logHistory.shift();
        }
    }

    /**
     * Builds the console line for a message.
     *
     * @private
     * @param {string} context - Subsystem the message came from.
     * @param {string} message - Message text.
     * @returns {string} The message prefixed with a time-of-day stamp and context.
     */
    _formatMessage(context, message) {
        const timestamp = new Date().toISOString().substr(11, 12);
        return `[${timestamp}] ${context}: ${message}`;
    }

    /**
     * Logs a message at `DEBUG` level.
     *
     * @param {string} context - Subsystem the message came from.
     * @param {string} message - Message text.
     * @param {*} [data=null] - Optional payload appended to the console call.
     * @returns {void}
     */
    debug(context, message, data = null) {
        if (!this._shouldLog(LogLevel.DEBUG)) return;

        const formatted = this._formatMessage(context, message);
        this._addToHistory(LogLevel.DEBUG, context, message, data);

        if (data !== null) {
            console.debug(formatted, data);
        } else {
            console.debug(formatted);
        }
    }

    /**
     * Logs a message at `INFO` level.
     *
     * @param {string} context - Subsystem the message came from.
     * @param {string} message - Message text.
     * @param {*} [data=null] - Optional payload appended to the console call.
     * @returns {void}
     */
    info(context, message, data = null) {
        if (!this._shouldLog(LogLevel.INFO)) return;

        const formatted = this._formatMessage(context, message);
        this._addToHistory(LogLevel.INFO, context, message, data);

        if (data !== null) {
            console.info(formatted, data);
        } else {
            console.info(formatted);
        }
    }

    /**
     * Logs a message at `WARN` level.
     *
     * @param {string} context - Subsystem the message came from.
     * @param {string} message - Message text.
     * @param {*} [data=null] - Optional payload appended to the console call.
     * @returns {void}
     */
    warn(context, message, data = null) {
        if (!this._shouldLog(LogLevel.WARN)) return;

        const formatted = this._formatMessage(context, message);
        this._addToHistory(LogLevel.WARN, context, message, data);

        if (data !== null) {
            console.warn(formatted, data);
        } else {
            console.warn(formatted);
        }
    }

    /**
     * Logs a message at `ERROR` level.
     *
     * @param {string} context - Subsystem the message came from.
     * @param {string} message - Message text.
     * @param {Error|*} [error=null] - Optional error or payload appended to the
     *   console call.
     * @returns {void}
     */
    error(context, message, error = null) {
        if (!this._shouldLog(LogLevel.ERROR)) return;

        const formatted = this._formatMessage(context, message);
        this._addToHistory(LogLevel.ERROR, context, message, error);

        if (error !== null) {
            console.error(formatted, error);
        } else {
            console.error(formatted);
        }
    }

    /**
     * Returns recorded log entries, newest last.
     *
     * @param {number|null} [maxEntries=null] - When set, return only the most
     *   recent this many entries.
     * @returns {Array<{timestamp: string, level: number, context: string, message: string, data: *}>}
     *   A copy of the requested history slice; safe to mutate.
     */
    getHistory(maxEntries = null) {
        if (maxEntries) {
            return this.logHistory.slice(-maxEntries);
        }
        return [...this.logHistory];
    }

}

const logger = new Logger();

/**
 * Convenience facade over the shared logger instance.
 *
 * Alongside the plain severity methods it offers per-subsystem shorthands
 * (`scene`, `camera`, ...) that bind a fixed context, and lifecycle helpers
 * (`init`, `dispose`, `perf`) that apply a consistent message format.
 *
 * @type {{
 *   debug: function(string, string, *=): void,
 *   info: function(string, string, *=): void,
 *   warn: function(string, string, *=): void,
 *   error: function(string, string, *=): void,
 *   scene: function(string, *=): void,
 *   camera: function(string, *=): void,
 *   animation: function(string, *=): void,
 *   marker: function(string, *=): void,
 *   input: function(string, *=): void,
 *   init: function(string, string, *=): void,
 *   dispose: function(string, string, *=): void,
 *   perf: function(string, string, number): void
 * }}
 */
export const log = {
    debug: (context, message, data) => logger.debug(context, message, data),
    info: (context, message, data) => logger.info(context, message, data),
    warn: (context, message, data) => logger.warn(context, message, data),
    error: (context, message, error) => logger.error(context, message, error),

    scene: (message, data) => logger.info('SceneManager', message, data),
    camera: (message, data) => logger.debug('CameraController', message, data),
    animation: (message, data) => logger.debug('AnimationManager', message, data),
    marker: (message, data) => logger.debug('Marker', message, data),
    input: (message, data) => logger.debug('InputController', message, data),

    init: (context, message, data) => logger.info(context, `Initialized: ${message}`, data),
    dispose: (context, message, data) => logger.info(context, `Disposed: ${message}`, data),

    perf: (context, operation, duration) => {
        logger.debug(context, `Performance: ${operation} took ${duration.toFixed(2)}ms`);
    }
};

export default logger;
