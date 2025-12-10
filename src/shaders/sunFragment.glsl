uniform float uTime;
uniform vec3 uGlowColor;
uniform float uGlowIntensity;
uniform float uNoiseScale;
uniform float uBrightness;
uniform float uSunspotFrequency;
uniform float uSunspotIntensity;

varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vNormalModel;
varying vec3 vNormalView;
varying vec3 vPosition;

#define NUM_OCTAVES 5

// Random function
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

// Simplified 3D simplex noise function for sunspots
float snoise(vec3 pos) {
    // Use our existing noise function but with different characteristics for sunspots
    return noise(pos) * 2.0 - 1.0; // Convert to -1 to 1 range
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

void main() {
    // FULL SUN SHADER WITH WORKING SUNSPOTS
    // Use model-space normal (which rotates with the mesh) instead of view-space position
    // This ensures the surface pattern rotates with the sun
    vec3 surfacePos = vNormalModel;

    // Add very slow time-based evolution to the surface patterns
    // This creates very slow changes in the sun's surface over time, separate from rotation
    vec3 st = surfacePos + uTime * 0.0005;

    // Create domain warping using multiple noise octaves - much slower animation
    vec3 q = vec3(0.0);
    q.x = fBm(st + uTime * 0.0008, uNoiseScale);
    q.y = fBm(st + vec3(1.2, 3.2, 1.52) + uTime * 0.0005, uNoiseScale);
    q.z = fBm(st + vec3(0.02, 0.12, 0.152) + uTime * 0.001, uNoiseScale);

    // Create the main noise pattern - very slow evolution
    float n = fBm(st + q + vec3(1.82, 1.32, 1.09) + uTime * 0.0003, uNoiseScale);

    // Create color gradients for realistic sun appearance
    vec3 baseColor = vec3(1.0, 0.4, 0.0);    // Deep orange/red
    vec3 hotColor = vec3(1.0, 1.0, 1.0);     // White hot
    vec3 coronaColor = vec3(1.0, 0.8, 0.2);  // Golden corona

    // Create additional noise pattern for darker color variations
    float darkerNoise = fBm(st * 1.3 + q * 0.6 + vec3(2.7, 1.8, 3.1) + uTime * 0.0004, uNoiseScale * 0.8);

    // Create darker version of base color (more saturated and darker)
    vec3 darkerBaseColor = baseColor * 0.6; // Darker version
    darkerBaseColor = mix(darkerBaseColor, vec3(0.4, 0.2, 0.05), 0.3); // Add some warmth/saturation

    // Mix colors based on noise
    vec3 color = mix(baseColor, hotColor, n * n);
    color = mix(color, coronaColor, q.x * 0.7);

    // Add darker color patches using the additional noise
    color = mix(color, darkerBaseColor, darkerNoise * 0.5 * (1.0 - n * 0.7));

    // Add some variation for solar flares - slower animation
    float flare = fBm(st * 2.0 + uTime * 0.008, uNoiseScale * 0.5);
    color += vec3(1.0, 0.6, 0.0) * flare * 0.3;

    // ADD SUNSPOTS generated using noise patterns like the surface
    vec3 sunspotCoords = surfacePos; // Fixed to surface positions

    // Create sunspot noise coordinate system similar to surface
    float timeEvolution = uTime * 0.003; // Slower evolution for sunspots
    vec3 sunspotSt = sunspotCoords + timeEvolution * vec3(0.001, 0.002, 0.0015);

    // Create domain warping for sunspot generation (similar to surface)
    vec3 sunspotQ = vec3(0.0);
    sunspotQ.x = fBm(sunspotSt + timeEvolution * 0.1, uNoiseScale * 0.8);
    sunspotQ.y = fBm(sunspotSt + vec3(2.1, 4.2, 2.7) + timeEvolution * 0.12, uNoiseScale * 0.8);
    sunspotQ.z = fBm(sunspotSt + vec3(0.8, 1.4, 0.9) + timeEvolution * 0.08, uNoiseScale * 0.8);

    // Generate sunspot noise pattern using domain warping
    float sunspotNoise = fBm(sunspotSt + sunspotQ * 0.4 + vec3(3.2, 2.8, 1.9) + timeEvolution * 0.05, uNoiseScale);

    // Create sunspot threshold and intensity - balanced for sparse visibility
    float sunspotThreshold = 0.4 - uSunspotFrequency * 0.25; // Balanced threshold for sparse but visible sunspots
    float sunspotRaw = sunspotNoise - sunspotThreshold;

    // Create smooth sunspot blending with better visibility
    float combined = 0.0;
    if (sunspotRaw > 0.0) {
        // Create organic sunspot shape with smooth falloff and higher intensity
        float sunspotShape = smoothstep(0.0, 0.4, sunspotRaw) * (1.0 - smoothstep(0.6, 1.0, sunspotRaw));
        combined = sunspotShape * 2.0; // Increase intensity for visibility
    }

    // Convert to -1 to 1 range like noise
    float pseudoNoise = combined;

    // Apply sunspot formula with smooth blending
    float t1 = pseudoNoise * 1.5 - 0.8;
    float ss = max(0.0, t1);

    // Create smooth falloff for natural blending
    float sunspotBlend = smoothstep(0.0, 0.3, ss) * (1.0 - smoothstep(0.7, 1.0, ss));

    // Blend sunspots with existing surface noise instead of just subtracting
    float surfaceVariation = n * 0.3; // Use some of the existing surface noise
    float blendedIntensity = sunspotBlend * uSunspotIntensity * (0.8 + surfaceVariation);

    // Apply sunspots as a subtle darkening that respects surface features
    color *= (1.0 - blendedIntensity * 0.6); // Multiply instead of subtract for softer blend

    // Create fresnel effect for glow
    float fresnel = 1.0 - abs(dot(vNormalView, vec3(0.0, 0.0, 1.0)));
    fresnel = pow(fresnel, 2.0);

    // Add glow effect
    vec3 glowEffect = uGlowColor * fresnel * uGlowIntensity;
    color += glowEffect;

    // Apply brightness and ensure we don't exceed limits
    color *= uBrightness;

    gl_FragColor = vec4(color, 1.0);
}