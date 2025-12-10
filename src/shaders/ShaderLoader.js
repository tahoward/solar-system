/**
 * ShaderLoader - Utility for loading and managing shader includes
 */

// Import shader utilities as a string
// In a real project, you might want to use a build tool to load .glsl files as strings
const shaderUtils = `
// Common matrix for twisted sine noise
#define m4 mat4( 0.00, 0.80, 0.60, -0.4, \\
                -0.80, 0.36, -0.48, -0.5, \\
                -0.60, -0.48, 0.64, 0.2,  \\
                 0.40, 0.30, 0.20, 0.4)

// Twisted sine noise function - used by both flares and rays
vec4 twistedSineNoise(vec4 q, float falloff) {
    float a = 1.0;
    float f = 1.0;
    vec4 sum = vec4(0.0);
    for (int i = 0; i < 4; i++) {
        q = m4 * q;
        vec4 s = sin(q.ywxz * f) * a;
        q += s;
        sum += s;
        a *= falloff;
        f /= falloff;
    }
    return sum;
}

// Random function for noise generation
float random(in vec3 st) {
    return fract(sin(dot(st, vec3(12.9898, 78.233, 23.112))) * 12943.145);
}

// 3D Noise function
float noise(in vec3 _pos) {
    vec3 i = floor(_pos);
    vec3 f = fract(_pos);
    f = f * f * (3.0 - 2.0 * f);

    float n = mix(
        mix(mix(random(i), random(i + vec3(1.0, 0.0, 0.0)), f.x),
            mix(random(i + vec3(0.0, 1.0, 0.0)), random(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
        mix(mix(random(i + vec3(0.0, 0.0, 1.0)), random(i + vec3(1.0, 0.0, 1.0)), f.x),
            mix(random(i + vec3(0.0, 1.0, 1.0)), random(i + vec3(1.0, 1.0, 1.0)), f.x), f.y), f.z);

    return n;
}

// Perlin noise function for smooth organic patterns
float perlin(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);

    // Smooth interpolation (Hermite cubic)
    vec3 u = f * f * (3.0 - 2.0 * f);

    return mix(
        mix(mix(random(i + vec3(0.0, 0.0, 0.0)),
                random(i + vec3(1.0, 0.0, 0.0)), u.x),
            mix(random(i + vec3(0.0, 1.0, 0.0)),
                random(i + vec3(1.0, 1.0, 0.0)), u.x), u.y),
        mix(mix(random(i + vec3(0.0, 0.0, 1.0)),
                random(i + vec3(1.0, 0.0, 1.0)), u.x),
            mix(random(i + vec3(0.0, 1.0, 1.0)),
                random(i + vec3(1.0, 1.0, 1.0)), u.x), u.y), u.z);
}

// Rotation matrices for domain warping
mat3 rotx = mat3(vec3(1.0, 0.0, 0.0),
                 vec3(0.0, cos(0.5), -sin(0.5)),
                 vec3(0.0, sin(0.5), cos(0.5)));

mat3 roty = mat3(vec3(cos(0.5), 0.0, sin(0.5)),
                 vec3(0.0, 1.0, 0.0),
                 vec3(-sin(0.5), 0.0, cos(0.5)));

mat3 rotz = mat3(vec3(cos(0.5), -sin(0.5), 0.0),
                 vec3(sin(0.5), cos(0.5), 0.0),
                 vec3(0.0, 0.0, 1.0));

// Fractal Brownian Motion
#define NUM_OCTAVES 5

float fBm(in vec3 _pos, in float sz) {
    float v = 0.0;
    float a = 0.2;
    _pos *= sz;

    for (int i = 0; i < NUM_OCTAVES; ++i) {
        v += a * noise(_pos);
        _pos = rotx * roty * rotz * _pos * 2.0;
        a *= 0.8;
    }
    return v;
}

// Hue calculation for color variations
#define hue(v) ( .6 + .6 * cos( 6.3*(v) + vec3(0.0,23.0,21.0) ) )

// Simplified 3D simplex noise function for sunspots
float snoise(vec3 pos) {
    // Use our existing noise function but with different characteristics for sunspots
    return noise(pos) * 2.0 - 1.0; // Convert to -1 to 1 range
}
`;

class ShaderLoader {
    /**
     * Prepend shader utilities to a shader source
     * @param {string} shaderSource - The main shader source code
     * @returns {string} Shader source with utilities prepended
     */
    static includeUtils(shaderSource) {
        // Add precision directive and utils at the beginning
        const precision = '#ifdef GL_ES\nprecision highp float;\n#endif\n\n';
        return precision + shaderUtils + '\n' + shaderSource;
    }

    /**
     * Get the raw shader utilities string
     * @returns {string} The shader utilities source code
     */
    static getUtils() {
        return shaderUtils;
    }

    /**
     * Create a vertex shader with utilities included
     * @param {string} mainShaderCode - Main shader code (without precision header)
     * @returns {string} Complete vertex shader source
     */
    static createVertexShader(mainShaderCode) {
        return this.includeUtils(mainShaderCode);
    }

    /**
     * Create a fragment shader with utilities included
     * @param {string} mainShaderCode - Main shader code (without precision header)
     * @returns {string} Complete fragment shader source
     */
    static createFragmentShader(mainShaderCode) {
        return this.includeUtils(mainShaderCode);
    }
}

export default ShaderLoader;