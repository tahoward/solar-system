class Environment {
    static isDevelopment() {
        if (typeof process !== 'undefined' && process.env?.NODE_ENV === 'development') {
            return true;
        }

        if (typeof window !== 'undefined') {
            const hostname = window.location?.hostname;
            const protocol = window.location?.protocol;

            if (hostname === 'localhost' ||
                hostname === '127.0.0.1' ||
                hostname?.startsWith('192.168.') ||
                hostname?.startsWith('10.') ||
                hostname?.endsWith('.local')) {
                return true;
            }

            if (protocol === 'file:') {
                return true;
            }

            const port = window.location?.port;
            const devPorts = ['3000', '3001', '8000', '8080', '8081', '5000', '5173', '4173', '9000'];
            if (port && devPorts.includes(port)) {
                return true;
            }
        }

        return false;
    }

    static isProduction() {
        return !this.isDevelopment();
    }

    static getName() {
        return this.isDevelopment() ? 'development' : 'production';
    }
}

class ConfigService {
    constructor() {
        this.config = new Map();
        this.environmentOverrides = new Map();

        this._initializeDefaults();

        this._applyEnvironmentOverrides();
    }

    _initializeDefaults() {
        this.config.set('ENVIRONMENT', Environment.getName());
        this.config.set('IS_DEVELOPMENT', Environment.isDevelopment());
        this.config.set('IS_PRODUCTION', Environment.isProduction());

        this.config.set('PERFORMANCE.TRACK_GPU', false);
        this.config.set('PERFORMANCE.MAX_FPS', 60);
        this.config.set('PERFORMANCE.ENABLE_STATS', false);
        this.config.set('PERFORMANCE.MEMORY_MONITORING', false);

        this.config.set('LOGGING.LEVEL', 'INFO');
        this.config.set('LOGGING.ENABLED_CONTEXTS', []);
        this.config.set('LOGGING.MAX_HISTORY', 100);

        this.config.set('DEBUG.SHOW_WIREFRAMES', false);
        this.config.set('DEBUG.SHOW_ORBIT_PATHS', true);
        this.config.set('DEBUG.CAMERA_HELPERS', false);
        this.config.set('DEBUG.PERFORMANCE_OVERLAY', false);

        this.config.set('CAMERA.SMOOTH_TRANSITIONS', true);
        this.config.set('CAMERA.AUTO_ZOOM_LIMITS', true);
        this.config.set('CAMERA.DAMPING_FACTOR', 0.1);

        this.config.set('MARKERS.GLOBAL_SIZE_MULTIPLIER', 1.0);
        this.config.set('MARKERS.FADE_ENABLED', true);
        this.config.set('MARKERS.AUTO_HIDE_ON_ZOOM', true);

        this.config.set('ANIMATION.ORBIT_SPEED_MULTIPLIER', 1.0);
        this.config.set('ANIMATION.QUALITY_SCALING', true);
        this.config.set('ANIMATION.PAUSE_ON_BLUR', true);

        this.config.set('UI.SHOW_CONTROLS_HINT', true);
        this.config.set('UI.KEYBOARD_SHORTCUTS', true);
        this.config.set('UI.RESPONSIVE_LAYOUT', true);
    }

    _applyEnvironmentOverrides() {
        if (Environment.isDevelopment()) {
            this.config.set('LOGGING.LEVEL', 'DEBUG');
            this.config.set('DEBUG.PERFORMANCE_OVERLAY', true);
            this.config.set('PERFORMANCE.MEMORY_MONITORING', true);
            this.config.set('PERFORMANCE.TRACK_GPU', true);
        } else {
            this.config.set('LOGGING.LEVEL', 'WARN');
            this.config.set('DEBUG.SHOW_WIREFRAMES', false);
            this.config.set('DEBUG.CAMERA_HELPERS', false);
            this.config.set('PERFORMANCE.ENABLE_STATS', false);
        }

        this._applyUrlParameterOverrides();
    }

    _applyUrlParameterOverrides() {
        if (typeof window === 'undefined') return;

        const params = new URLSearchParams(window.location.search);

        if (params.has('debug')) {
            this.config.set('DEBUG.SHOW_WIREFRAMES', params.get('debug') === 'true');
            this.config.set('DEBUG.CAMERA_HELPERS', params.get('debug') === 'true');
            this.config.set('LOGGING.LEVEL', 'DEBUG');
        }

        if (params.has('perf')) {
            this.config.set('DEBUG.PERFORMANCE_OVERLAY', params.get('perf') === 'true');
        }

        if (params.has('speed')) {
            const speed = parseFloat(params.get('speed'));
            if (!isNaN(speed) && speed > 0) {
                this.config.set('ANIMATION.ORBIT_SPEED_MULTIPLIER', speed);
            }
        }
    }

    get(key, defaultValue = null) {
        return this.config.get(key) ?? defaultValue;
    }

    set(key, value) {
        this.config.set(key, value);
    }

    isEnabled(featureKey) {
        return Boolean(this.get(featureKey, false));
    }

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

    reset() {
        this.config.clear();
        this._initializeDefaults();
        this._applyEnvironmentOverrides();
    }

    export() {
        const configObject = {};
        for (const [key, value] of this.config) {
            configObject[key] = value;
        }
        return JSON.stringify(configObject, null, 2);
    }

    createScopedGetter(modulePrefix) {
        const prefix = modulePrefix + '.';
        return (key, defaultValue = null) => {
            return this.get(prefix + key, defaultValue);
        };
    }
}

const configService = new ConfigService();

export const debugConfig = configService.createScopedGetter('DEBUG');
export const performanceConfig = configService.createScopedGetter('PERFORMANCE');

export { Environment };
export default configService;