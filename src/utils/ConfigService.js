/**
 * Detects whether the app is running in a development or production context.
 *
 * There is no build-time flag to rely on for the static GitHub Pages build, so
 * detection falls back to inspecting the current location: loopback and private
 * network hostnames, `file:` URLs and well-known dev server ports all count as
 * development.
 *
 * All members are static; the class is used purely as a namespace.
 */
class Environment {
    /**
     * Reports whether the current context looks like a development one.
     *
     * @returns {boolean} `true` for a development context, `false` otherwise
     *   (which includes any environment that cannot be identified).
     */
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

    /**
     * Returns the detected environment as a label.
     *
     * @returns {'development'|'production'} Name of the current environment.
     */
    static getName() {
        return this.isDevelopment() ? 'development' : 'production';
    }
}

/**
 * Runtime configuration store keyed by dotted strings such as `DEBUG.SHOW_WIREFRAMES`.
 *
 * Defaults are seeded on construction and may then be overridden by URL query
 * parameters, which makes settings toggleable without a rebuild. A single shared
 * instance is exported as the module default.
 */
class ConfigService {
    /**
     * Builds the store, seeds defaults, then applies any URL overrides.
     */
    constructor() {
        this.config = new Map();

        this._initializeDefaults();

        this._applyUrlParameterOverrides();
    }

    /**
     * Seeds the built-in default values.
     *
     * @private
     * @returns {void}
     */
    _initializeDefaults() {
        this.config.set('ENVIRONMENT', Environment.getName());

        this.config.set('PERFORMANCE.ENABLE_STATS', false);

        this.config.set('DEBUG.SHOW_WIREFRAMES', false);
    }

    /**
     * Overrides defaults from the query string.
     *
     * Only `?debug=true|false` is recognised. No-ops outside a browser.
     *
     * @private
     * @returns {void}
     */
    _applyUrlParameterOverrides() {
        if (typeof window === 'undefined') return;

        const params = new URLSearchParams(window.location.search);

        if (params.has('debug')) {
            this.config.set('DEBUG.SHOW_WIREFRAMES', params.get('debug') === 'true');
        }
    }

    /**
     * Reads a configuration value.
     *
     * @param {string} key - Fully qualified key, e.g. `'DEBUG.SHOW_WIREFRAMES'`.
     * @param {*} [defaultValue=null] - Returned when the key is absent or null.
     * @returns {*} The stored value, or `defaultValue`.
     */
    get(key, defaultValue = null) {
        return this.config.get(key) ?? defaultValue;
    }

    /**
     * Writes a configuration value, replacing any existing entry.
     *
     * @param {string} key - Fully qualified key.
     * @param {*} value - Value to store.
     * @returns {void}
     */
    set(key, value) {
        this.config.set(key, value);
    }

    /**
     * Collects every value under a key prefix.
     *
     * @param {string} category - Prefix without the trailing dot, e.g. `'DEBUG'`.
     * @returns {Object<string, *>} Plain object of the keys in that category with
     *   the prefix stripped; empty if nothing matches.
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
     * Produces a snapshot of the whole configuration, for debug overlays and logs.
     *
     * @returns {{environment: string, development: boolean, totalConfigs: number,
     *   categories: {performance: Object<string, *>, debug: Object<string, *>}}}
     *   Current environment and grouped configuration values.
     */
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

    /**
     * Builds a getter bound to a key prefix, so callers can use short key names.
     *
     * @param {string} modulePrefix - Prefix without the trailing dot, e.g. `'DEBUG'`.
     * @returns {function(string, *=): *} A getter taking a key relative to the
     *   prefix and an optional default.
     */
    createScopedGetter(modulePrefix) {
        const prefix = modulePrefix + '.';
        return (key, defaultValue = null) => {
            return this.get(prefix + key, defaultValue);
        };
    }
}

const configService = new ConfigService();

/**
 * Reads a value from the `DEBUG` category, e.g. `debugConfig('SHOW_WIREFRAMES')`.
 *
 * @type {function(string, *=): *}
 */
export const debugConfig = configService.createScopedGetter('DEBUG');

/**
 * Reads a value from the `PERFORMANCE` category, e.g. `performanceConfig('ENABLE_STATS')`.
 *
 * @type {function(string, *=): *}
 */
export const performanceConfig = configService.createScopedGetter('PERFORMANCE');

export default configService;
