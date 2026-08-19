class ConfigValidator {
    static validate(config, schema, context = 'Configuration') {
        if (!config || typeof config !== 'object') {
            throw new Error(`${context}: must be a valid object`);
        }

        for (const [fieldName, rule] of Object.entries(schema.fields)) {
            const value = config[fieldName];
            this._validateField(value, rule, fieldName, context);
        }
    }

    static createSchema(fields) {
        return { fields };
    }

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

    static validateBodyConfig(bodyConfig) {
        const schema = this.createSchema({
            name: this.field.requiredString(1, 50),
            radius: this.field.positiveNumber(1000000),
            marker: this.field.optionalBoolean()
        });
        this.validate(bodyConfig, schema, 'Body configuration');
    }

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