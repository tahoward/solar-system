/**
 * Configuration validation utilities for the solar system application
 * Ensures consistent and valid configuration across all modules
 */

/**
 * @typedef {Object} ValidationRule
 * @property {string} type - Expected type ('number', 'string', 'boolean', 'object')
 * @property {number} [min] - Minimum value for numbers
 * @property {number} [max] - Maximum value for numbers
 * @property {boolean} [required] - Whether the field is required
 * @property {Array} [allowedValues] - Allowed values for enums
 */

/**
 * @typedef {Object} ValidationSchema
 * @property {Object<string, ValidationRule>} fields - Field validation rules
 */

class ConfigValidator {
    /**
     * Validates a configuration object against a schema
     * @param {Object} config - Configuration to validate
     * @param {ValidationSchema} schema - Validation schema
     * @param {string} [context='Configuration'] - Context for error messages
     * @throws {Error} If validation fails
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
     * Creates a validation schema with common field patterns
     * @param {Object<string, ValidationRule>} fields - Field rules
     * @returns {ValidationSchema} Complete validation schema
     */
    static createSchema(fields) {
        return { fields };
    }

    /**
     * Helper method to create common field types
     */
    static field = {
        /**
         * Required string field with length constraints
         * @param {number} minLength - Minimum length
         * @param {number} maxLength - Maximum length
         * @returns {ValidationRule} String validation rule
         */
        requiredString: (minLength = 1, maxLength = 100) => ({
            type: 'string',
            required: true,
            minLength,
            maxLength
        }),

        /**
         * Optional string field with length constraints
         * @param {number} minLength - Minimum length
         * @param {number} maxLength - Maximum length
         * @returns {ValidationRule} String validation rule
         */
        optionalString: (minLength = 0, maxLength = 100) => ({
            type: 'string',
            required: false,
            minLength,
            maxLength
        }),

        /**
         * Required number field with range constraints
         * @param {number} min - Minimum value
         * @param {number} max - Maximum value
         * @returns {ValidationRule} Number validation rule
         */
        requiredNumber: (min = Number.NEGATIVE_INFINITY, max = Number.POSITIVE_INFINITY) => ({
            type: 'number',
            required: true,
            min,
            max
        }),

        /**
         * Optional number field with range constraints
         * @param {number} min - Minimum value
         * @param {number} max - Maximum value
         * @returns {ValidationRule} Number validation rule
         */
        optionalNumber: (min = Number.NEGATIVE_INFINITY, max = Number.POSITIVE_INFINITY) => ({
            type: 'number',
            required: false,
            min,
            max
        }),

        /**
         * Required boolean field
         * @returns {ValidationRule} Boolean validation rule
         */
        requiredBoolean: () => ({
            type: 'boolean',
            required: true
        }),

        /**
         * Optional boolean field
         * @returns {ValidationRule} Boolean validation rule
         */
        optionalBoolean: () => ({
            type: 'boolean',
            required: false
        }),

        /**
         * Enum field with allowed values
         * @param {Array} allowedValues - Array of allowed values
         * @param {boolean} required - Whether field is required
         * @returns {ValidationRule} Enum validation rule
         */
        enum: (allowedValues, required = true) => ({
            type: typeof allowedValues[0],
            required,
            allowedValues
        }),

        /**
         * Positive number (> 0)
         * @param {number} max - Maximum value
         * @param {boolean} required - Whether field is required
         * @returns {ValidationRule} Positive number validation rule
         */
        positiveNumber: (max = Number.POSITIVE_INFINITY, required = true) => ({
            type: 'number',
            required,
            min: 0.000000001, // Effectively > 0
            max
        }),

        /**
         * Percentage value (0-100)
         * @param {boolean} required - Whether field is required
         * @returns {ValidationRule} Percentage validation rule
         */
        percentage: (required = true) => ({
            type: 'number',
            required,
            min: 0,
            max: 100
        }),

        /**
         * Angle in degrees (-180 to 180)
         * @param {boolean} required - Whether field is required
         * @returns {ValidationRule} Angle validation rule
         */
        angle: (required = false) => ({
            type: 'number',
            required,
            min: -180,
            max: 180
        })
    };

    /**
     * Validates a single field
     * @param {any} value - Value to validate
     * @param {ValidationRule} rule - Validation rule
     * @param {string} fieldName - Field name for error messages
     * @param {string} context - Context for error messages
     * @throws {Error} If validation fails
     * @private
     */
    static _validateField(value, rule, fieldName, context) {
        const fullFieldName = `${context}.${fieldName}`;

        // Check if field is required
        if (rule.required && (value === undefined || value === null)) {
            throw new Error(`${fullFieldName}: is required but not provided`);
        }

        // Skip validation if value is undefined and not required
        if (value === undefined && !rule.required) {
            return;
        }

        // Type validation
        if (rule.type && typeof value !== rule.type) {
            throw new Error(`${fullFieldName}: expected ${rule.type}, got ${typeof value}`);
        }

        // Number-specific validations
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

        // String-specific validations
        if (rule.type === 'string') {
            if (rule.minLength !== undefined && value.length < rule.minLength) {
                throw new Error(`${fullFieldName}: must be at least ${rule.minLength} characters long`);
            }
            if (rule.maxLength !== undefined && value.length > rule.maxLength) {
                throw new Error(`${fullFieldName}: must be at most ${rule.maxLength} characters long`);
            }
        }

        // Enum validation
        if (rule.allowedValues && !rule.allowedValues.includes(value)) {
            throw new Error(`${fullFieldName}: must be one of ${rule.allowedValues.join(', ')}, got ${value}`);
        }
    }

    /**
     * Validates celestial body configuration
     * @param {Object} bodyConfig - Body configuration
     * @throws {Error} If validation fails
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
     * Validates orbit configuration
     * @param {Object} orbitConfig - Orbit configuration
     * @throws {Error} If validation fails
     */
    static validateOrbitConfig(orbitConfig) {
        const schema = this.createSchema({
            semiMajorAxis: this.field.requiredNumber(0.0001, 1000), // Reduced min for close moons like Charon
            eccentricity: this.field.requiredNumber(0, 0.99),
            inclination: this.field.angle(false)
        });
        this.validate(orbitConfig, schema, 'Orbit configuration');
    }

    /**
     * Validates camera configuration
     * @param {Object} cameraConfig - Camera configuration
     * @throws {Error} If validation fails
     */
    static validateCameraConfig(cameraConfig) {
        const schema = this.createSchema({
            fov: this.field.requiredNumber(10, 150),
            near: this.field.positiveNumber(),
            far: this.field.positiveNumber(),
            autoRotate: this.field.optionalBoolean(),
            enableZoom: this.field.optionalBoolean()
        });
        this.validate(cameraConfig, schema, 'Camera configuration');
    }

    /**
     * Validates lighting configuration
     * @param {Object} lightConfig - Light configuration
     * @throws {Error} If validation fails
     */
    static validateLightConfig(lightConfig) {
        const schema = this.createSchema({
            intensity: this.field.positiveNumber(),
            color: this.field.optionalString(),
            castShadow: this.field.optionalBoolean(),
            distance: this.field.optionalNumber(0)
        });
        this.validate(lightConfig, schema, 'Light configuration');
    }

    /**
     * Validates effect configuration (bloom, glare, etc.)
     * @param {Object} effectConfig - Effect configuration
     * @throws {Error} If validation fails
     */
    static validateEffectConfig(effectConfig) {
        const schema = this.createSchema({
            enabled: this.field.optionalBoolean(),
            intensity: this.field.optionalNumber(0, 10),
            opacity: this.field.percentage(false),
            size: this.field.positiveNumber(100, false),
            color: this.field.optionalString()
        });
        this.validate(effectConfig, schema, 'Effect configuration');
    }


}

export default ConfigValidator;