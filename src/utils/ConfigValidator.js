/**
 * Schema-based validation for the body and orbit configuration literals.
 *
 * Bad configuration data would otherwise surface much later as `NaN`
 * coordinates or invisible geometry, so validators throw eagerly with a message
 * naming the offending field. All members are static; the class is used purely
 * as a namespace.
 */
class ConfigValidator {
    /**
     * Validates a configuration object against a schema.
     *
     * @param {Object} config - Object to validate.
     * @param {{fields: Object<string, Object>}} schema - Schema from
     *   {@link ConfigValidator.createSchema}.
     * @param {string} [context='Configuration'] - Label used to prefix error
     *   messages.
     * @throws {Error} If `config` is not an object, or any field breaks its rule.
     * @returns {void}
     */
    static validate(config, schema, context = 'Configuration') {
        if (!config || typeof config !== 'object') {
            throw new Error(`${context}: must be a valid object`);
        }

        for (const [fieldName, rule] of Object.entries(schema.fields)) {
            const value = config[fieldName];
            this._validateField(value, rule, fieldName, context);
        }
    }

    /**
     * Wraps a map of field rules into a schema object.
     *
     * @param {Object<string, Object>} fields - Field name to rule, built with
     *   the {@link ConfigValidator.field} factories.
     * @returns {{fields: Object<string, Object>}} Schema for
     *   {@link ConfigValidator.validate}.
     */
    static createSchema(fields) {
        return { fields };
    }

    /**
     * Factories for the field rules used by the schemas in this project.
     *
     * Each returns a plain rule object describing a type, whether the field is
     * required, and any bounds to enforce.
     *
     * @type {{
     *   requiredString: function(number=, number=): Object,
     *   requiredNumber: function(number=, number=): Object,
     *   optionalBoolean: function(): Object,
     *   positiveNumber: function(number=, boolean=): Object,
     *   angle: function(boolean=): Object
     * }}
     */
    static field = {
        requiredString: (minLength = 1, maxLength = 100) => ({
            type: 'string',
            required: true,
            minLength,
            maxLength
        }),

        requiredNumber: (min = Number.NEGATIVE_INFINITY, max = Number.POSITIVE_INFINITY) => ({
            type: 'number',
            required: true,
            min,
            max
        }),

        optionalBoolean: () => ({
            type: 'boolean',
            required: false
        }),

        positiveNumber: (max = Number.POSITIVE_INFINITY, required = true) => ({
            type: 'number',
            required,
            min: 0.000000001,
            max
        }),

        angle: (required = false) => ({
            type: 'number',
            required,
            min: -180,
            max: 180
        })
    };

    /**
     * Checks one value against one rule.
     *
     * Absent optional fields pass without further checks. Numbers are also
     * rejected when not finite, since `NaN` would silently propagate through the
     * physics integrators.
     *
     * @private
     * @param {*} value - Value to check.
     * @param {Object} rule - Rule describing type, requiredness and bounds.
     * @param {string} fieldName - Name of the field, for error messages.
     * @param {string} context - Label prefixed to the field name in errors.
     * @throws {Error} If the value is missing when required, of the wrong type,
     *   out of bounds, or a non-finite number.
     * @returns {void}
     */
    static _validateField(value, rule, fieldName, context) {
        const fullFieldName = `${context}.${fieldName}`;

        if (rule.required && (value === undefined || value === null)) {
            throw new Error(`${fullFieldName}: is required but not provided`);
        }

        if (value === undefined && !rule.required) {
            return;
        }

        if (rule.type && typeof value !== rule.type) {
            throw new Error(`${fullFieldName}: expected ${rule.type}, got ${typeof value}`);
        }

        if (rule.type === 'number') {
            if (rule.min !== undefined && value < rule.min) {
                throw new Error(`${fullFieldName}: must be >= ${rule.min}, got ${value}`);
            }
            if (rule.max !== undefined && value > rule.max) {
                throw new Error(`${fullFieldName}: must be <= ${rule.max}, got ${value}`);
            }
            if (isNaN(value) || !isFinite(value)) {
                throw new Error(`${fullFieldName}: must be a finite number, got ${value}`);
            }
        }

        if (rule.type === 'string') {
            if (rule.minLength !== undefined && value.length < rule.minLength) {
                throw new Error(`${fullFieldName}: must be at least ${rule.minLength} characters long`);
            }
            if (rule.maxLength !== undefined && value.length > rule.maxLength) {
                throw new Error(`${fullFieldName}: must be at most ${rule.maxLength} characters long`);
            }
        }
    }

    /**
     * Validates a celestial body definition.
     *
     * Checks `name`, `radius` and the optional `marker` flag; other body fields
     * are not constrained.
     *
     * @param {Object} bodyConfig - Body configuration literal.
     * @throws {Error} If the configuration is invalid.
     * @returns {void}
     */
    static validateBodyConfig(bodyConfig) {
        const schema = this.createSchema({
            name: this.field.requiredString(1, 50),
            radius: this.field.positiveNumber(1000000),
            marker: this.field.optionalBoolean()
        });
        this.validate(bodyConfig, schema, 'Body configuration');
    }

    /**
     * Validates an orbit definition.
     *
     * Checks `semiMajorAxis`, `eccentricity` (bounded below 1 so the orbit stays
     * elliptical) and the optional `inclination`.
     *
     * @param {Object} orbitConfig - Orbit configuration literal.
     * @throws {Error} If the configuration is invalid.
     * @returns {void}
     */
    static validateOrbitConfig(orbitConfig) {
        const schema = this.createSchema({
            semiMajorAxis: this.field.requiredNumber(0.0001, 1000),
            eccentricity: this.field.requiredNumber(0, 0.99),
            inclination: this.field.angle(false)
        });
        this.validate(orbitConfig, schema, 'Orbit configuration');
    }
}

export default ConfigValidator;
