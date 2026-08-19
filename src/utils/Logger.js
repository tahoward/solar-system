const LogLevel = {
    DEBUG: 0,
    INFO: 1,
    WARN: 2,
    ERROR: 3,
    NONE: 4
};

class Logger {
    constructor() {
        this.currentLevel = this._getEnvironmentLogLevel();
        this.logHistory = [];
        this.maxHistorySize = 100;
    }

    _getEnvironmentLogLevel() {
        if (typeof process !== 'undefined' && process.env?.NODE_ENV === 'production') {
            return LogLevel.WARN;
        }
        return LogLevel.DEBUG;
    }

    _shouldLog(level) {
        return level >= this.currentLevel;
    }

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

    _formatMessage(context, message) {
        const timestamp = new Date().toISOString().substr(11, 12);
        return `[${timestamp}] ${context}: ${message}`;
    }

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

    getHistory(maxEntries = null) {
        if (maxEntries) {
            return this.logHistory.slice(-maxEntries);
        }
        return [...this.logHistory];
    }

}

const logger = new Logger();

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