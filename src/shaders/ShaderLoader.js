const shaderUtils = `
#define m4 mat4( 0.00, 0.80, 0.60, -0.4, \\
                -0.80, 0.36, -0.48, -0.5, \\
                -0.60, -0.48, 0.64, 0.2,  \\
                 0.40, 0.30, 0.20, 0.4)

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

float random(in vec3 st) {
    return fract(sin(dot(st, vec3(12.9898, 78.233, 23.112))) * 12943.145);
}

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

#define hue(v) ( .6 + .6 * cos( 6.3*(v) + vec3(0.0,23.0,21.0) ) )
`;

class ShaderLoader {
    static includeUtils(shaderSource) {
        const precision = '#ifdef GL_ES\nprecision highp float;\n#endif\n\n';
        return precision + shaderUtils + '\n' + shaderSource;
    }

    static createVertexShader(mainShaderCode) {
        return this.includeUtils(mainShaderCode);
    }

    static createFragmentShader(mainShaderCode) {
        return this.includeUtils(mainShaderCode);
    }
}

export default ShaderLoader;