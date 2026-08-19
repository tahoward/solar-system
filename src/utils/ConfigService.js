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

    static getName() {
        return this.isDevelopment() ? 'development' : 'production';
    }
}

class ConfigService {
    constructor() {
        this.config = new Map();

        this._initializeDefaults();

        this._applyUrlParameterOverrides();
    }

    _initializeDefaults() {
        this.config.set('ENVIRONMENT', Environment.getName());

        this.config.set('PERFORMANCE.ENABLE_STATS', false);

        this.config.set('DEBUG.SHOW_WIREFRAMES', false);
    }

    _applyUrlParameterOverrides() {
        if (typeof window === 'undefined') return;

        const params = new URLSearchParams(window.location.search);

        if (params.has('debug')) {
            this.config.set('DEBUG.SHOW_WIREFRAMES', params.get('debug') === 'true');
        }
    }

    get(key, defaultValue = null) {
        return this.config.get(key) ?? defaultValue;
    }

    set(key, value) {
        this.config.set(key, value);
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
                debug: this.getCategory('DEBUG')
            }
        };
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

export default configService;