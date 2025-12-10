/**
 * Environment-aware configuration service for the solar system application
 * Provides centralized configuration management with environment overrides
 */

/**
 * Environment detection utilities
 */
class Environment {
    /**
     * Checks if running in development mode
     * @returns {boolean} True if in development
     */
    static isDevelopment() {
        // Check Node.js environment
        if (typeof process !== 'undefined' && process.env?.NODE_ENV === 'development') {
            return true;
        }

        // Check browser environment
        if (typeof window !== 'undefined') {
            const hostname = window.location?.hostname;
            const protocol = window.location?.protocol;

            // Common development hostnames
            if (hostname === 'localhost' ||
                hostname === '127.0.0.1' ||
                hostname?.startsWith('192.168.') ||
                hostname?.startsWith('10.') ||
                hostname?.endsWith('.local')) {
                return true;
            }

            // File protocol (local files)
            if (protocol === 'file:') {
                return true;
            }

            // Development ports
            const port = window.location?.port;
            const devPorts = ['3000', '3001', '8000', '8080', '8081', '5000', '5173', '4173', '9000'];
            if (port && devPorts.includes(port)) {
                return true;
            }
        }

        return false;
    }

    /**
     * Checks if running in production mode
     * @returns {boolean} True if in production
     */
    static isProduction() {
        return !this.isDevelopment();
    }

    /**
     * Gets the current environment name
     * @returns {string} Environment name
     */
    static getName() {
        return this.isDevelopment() ? 'development' : 'production';
    }
}

/**
 * Configuration service with environment-aware settings
 */
class ConfigService {
    constructor() {
        this.config = new Map();
        this.environmentOverrides = new Map();

        // Initialize default configuration
        this._initializeDefaults();

        // Apply environment-specific overrides
        this._applyEnvironmentOverrides();
    }

    /**
     * Initialize default configuration values
     * @private
     */
    _initializeDefaults() {
        // Environment settings
        this.config.set('ENVIRONMENT', Environment.getName());
        this.config.set('IS_DEVELOPMENT', Environment.isDevelopment());
        this.config.set('IS_PRODUCTION', Environment.isProduction());

        // Performance settings
        this.config.set('PERFORMANCE.TRACK_GPU', false);
        this.config.set('PERFORMANCE.MAX_FPS', 60);
        this.config.set('PERFORMANCE.ENABLE_STATS', false);
        this.config.set('PERFORMANCE.MEMORY_MONITORING', false);

        // Logging settings
        this.config.set('LOGGING.LEVEL', 'INFO');
        this.config.set('LOGGING.ENABLED_CONTEXTS', []);
        this.config.set('LOGGING.MAX_HISTORY', 100);

        // Debug settings
        this.config.set('DEBUG.SHOW_WIREFRAMES', false);
        this.config.set('DEBUG.SHOW_ORBIT_PATHS', true);
        this.config.set('DEBUG.CAMERA_HELPERS', false);
        this.config.set('DEBUG.PERFORMANCE_OVERLAY', false);

        // Camera settings
        this.config.set('CAMERA.SMOOTH_TRANSITIONS', true);
        this.config.set('CAMERA.AUTO_ZOOM_LIMITS', true);
        this.config.set('CAMERA.DAMPING_FACTOR', 0.1);

        // Marker settings
        this.config.set('MARKERS.GLOBAL_SIZE_MULTIPLIER', 1.0);
        this.config.set('MARKERS.FADE_ENABLED', true);
        this.config.set('MARKERS.AUTO_HIDE_ON_ZOOM', true);

        // Animation settings
        this.config.set('ANIMATION.ORBIT_SPEED_MULTIPLIER', 1.0);
        this.config.set('ANIMATION.QUALITY_SCALING', true);
        this.config.set('ANIMATION.PAUSE_ON_BLUR', true);

        // UI settings
        this.config.set('UI.SHOW_CONTROLS_HINT', true);
        this.config.set('UI.KEYBOARD_SHORTCUTS', true);
        this.config.set('UI.RESPONSIVE_LAYOUT', true);
    }

    /**
     * Apply environment-specific configuration overrides
     * @private
     */
    _applyEnvironmentOverrides() {
        if (Environment.isDevelopment()) {
            // Development overrides
            this.config.set('LOGGING.LEVEL', 'DEBUG');
            this.config.set('DEBUG.PERFORMANCE_OVERLAY', true);
            this.config.set('PERFORMANCE.MEMORY_MONITORING', true);
            this.config.set('PERFORMANCE.TRACK_GPU', true);
        } else {
            // Production overrides
            this.config.set('LOGGING.LEVEL', 'WARN');
            this.config.set('DEBUG.SHOW_WIREFRAMES', false);
            this.config.set('DEBUG.CAMERA_HELPERS', false);
            this.config.set('PERFORMANCE.ENABLE_STATS', false);
        }

        // Apply any URL parameter overrides
        this._applyUrlParameterOverrides();
    }

    /**
     * Apply configuration overrides from URL parameters
     * @private
     */
    _applyUrlParameterOverrides() {
        if (typeof window === 'undefined') return;

        const params = new URLSearchParams(window.location.search);

        // Debug mode override
        if (params.has('debug')) {
            this.config.set('DEBUG.SHOW_WIREFRAMES', params.get('debug') === 'true');
            this.config.set('DEBUG.CAMERA_HELPERS', params.get('debug') === 'true');
            this.config.set('LOGGING.LEVEL', 'DEBUG');
        }

        // Performance overlay
        if (params.has('perf')) {
            this.config.set('DEBUG.PERFORMANCE_OVERLAY', params.get('perf') === 'true');
        }

        // Orbit speed
        if (params.has('speed')) {
            const speed = parseFloat(params.get('speed'));
            if (!isNaN(speed) && speed > 0) {
                this.config.set('ANIMATION.ORBIT_SPEED_MULTIPLIER', speed);
            }
        }
    }

    /**
     * Gets a configuration value
     * @param {string} key - Configuration key (dot-separated)
     * @param {any} [defaultValue] - Default value if key not found
     * @returns {any} Configuration value
     */
    get(key, defaultValue = null) {
        return this.config.get(key) ?? defaultValue;
    }

    /**
     * Sets a configuration value
     * @param {string} key - Configuration key
     * @param {any} value - Configuration value
     */
    set(key, value) {
        this.config.set(key, value);
    }

    /**
     * Checks if a feature is enabled
     * @param {string} featureKey - Feature key
     * @returns {boolean} True if feature is enabled
     */
    isEnabled(featureKey) {
        return Boolean(this.get(featureKey, false));
    }

    /**
     * Gets all configuration for a specific category
     * @param {string} category - Category prefix (e.g., 'DEBUG', 'PERFORMANCE')
     * @returns {Object} Configuration object for category
     */
    getCategory(category) {
        const result = {};
        const prefix = category + '.';

        for (const [key, value] of this.config) {
            if (key.startsWith(prefix)) {
                const shortKey = key.substring(prefix.length);
                result[shortKey] = value;
            }
        }

        return result;
    }

    /**
     * Gets current configuration summary
     * @returns {Object} Configuration summary
     */
    getSummary() {
        return {
            environment: Environment.getName(),
            development: Environment.isDevelopment(),
            totalConfigs: this.config.size,
            categories: {
                performance: this.getCategory('PERFORMANCE'),
                debug: this.getCategory('DEBUG'),
                logging: this.getCategory('LOGGING'),
                animation: this.getCategory('ANIMATION')
            }
        };
    }

    /**
     * Resets configuration to defaults
     */
    reset() {
        this.config.clear();
        this._initializeDefaults();
        this._applyEnvironmentOverrides();
    }

    /**
     * Exports configuration as JSON
     * @returns {string} JSON configuration
     */
    export() {
        const configObject = {};
        for (const [key, value] of this.config) {
            configObject[key] = value;
        }
        return JSON.stringify(configObject, null, 2);
    }

    /**
     * Creates a scoped configuration getter for a specific module
     * @param {string} modulePrefix - Module prefix (e.g., 'CAMERA', 'MARKERS')
     * @returns {Function} Scoped getter function
     */
    createScopedGetter(modulePrefix) {
        const prefix = modulePrefix + '.';
        return (key, defaultValue = null) => {
            return this.get(prefix + key, defaultValue);
        };
    }
}

// Create and export singleton instance
const configService = new ConfigService();

// Export convenience getters for common modules
export const debugConfig = configService.createScopedGetter('DEBUG');
export const performanceConfig = configService.createScopedGetter('PERFORMANCE');

export { Environment };
export default configService;