import * as THREE from 'three';
import ShaderLoader from './ShaderLoader.js';

/**
 * Vertex shader for the star's surface.
 *
 * Two normals are passed on. The model-space one doubles as a position on the unit
 * sphere, which is what the surface pattern is sampled against — being in object space it
 * rotates with the star, so the granulation stays fixed to the surface rather than
 * sliding across it. The view-space one is used for the limb glow, which depends on the
 * viewing angle.
 *
 * @type {string}
 */
const vertexShader = `
varying vec3 vNormalModel;
varying vec3 vNormalView;

void main() {
    vNormalModel = normal;
    vNormalView = normalize(normalMatrix * normal);

    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

/**
 * Fragment shader for the star's surface: granulation, sunspots and a limb glow.
 *
 * The surface pattern is a 3D Voronoi diagram, which is what the real photosphere looks
 * like — a mosaic of convection cells with bright interiors and darker boundaries.
 * `voronoiCorn` returns the distance between the nearest and second-nearest cell points,
 * which is small near a boundary and large in a cell's middle, giving the cell edges
 * directly. Ordinary value noise gives a cloudy blur with no cell structure at all.
 *
 * The sample position is warped by noise before the Voronoi lookup, so the cells come out
 * irregular rather than betraying the underlying grid. The cell points themselves drift
 * with time, which makes the granulation churn slowly.
 *
 * Sunspots are circles around the positions supplied by {@link SunspotManager}, with
 * their own noise warp so the boundary is ragged instead of a perfect circle. Within a
 * spot only cells whose id passes a threshold are darkened, which leaves an uneven
 * penumbra of ordinary granulation mixed in — a uniformly dark disc looks painted on.
 *
 * The limb glow is a Fresnel term: the surface brightens where it turns away from the
 * viewer, which is what makes a star read as a glowing ball rather than a flat disc.
 *
 * Finally the colour is pushed above 1 in proportion to the emissive intensity, which is
 * what the bloom pass picks up — without that a hot star and a cool one would glow
 * identically.
 *
 * @type {string}
 */
const fragmentShaderMainCode = `
uniform float uTime;
uniform vec3 uGlowColor;
uniform float uGlowIntensity;
uniform float uNoiseScale;
uniform float uBrightness;
uniform float uSunspotIntensity;
uniform float uEmissiveIntensity;
uniform vec3 uSunspotPositions[8];
uniform float uSunspotOpacities[8];
uniform float uSunspotRadii[8];

varying vec3 vNormalModel;
varying vec3 vNormalView;

vec3 hash3f(vec3 p) {
    vec3 q = vec3(
        dot(p, vec3(127.1, 311.7, 74.7)),
        dot(p, vec3(269.5, 183.3, 246.1)),
        dot(p, vec3(113.5, 271.9, 124.6))
    );
    return fract(q * fract(q * 0.3183099 + 0.1) * 17.0);
}

vec2 voronoiCorn(vec3 p, float scale, float time) {
    p *= scale;
    vec3 i = floor(p);
    vec3 f = fract(p);

    float minDist = 1.0;
    float secondDist = 1.0;
    float cellId = 0.0;

    for (int x = -1; x <= 1; x++) {
        for (int y = -1; y <= 1; y++) {
            for (int z = -1; z <= 1; z++) {
                vec3 neighbor = vec3(float(x), float(y), float(z));
                vec3 basePoint = hash3f(i + neighbor);
                vec3 point = basePoint + 0.15 * sin(time * 0.1 + basePoint * 6.2831);
                vec3 diff = neighbor + point - f;
                float dist = length(diff);
                if (dist < minDist) {
                    secondDist = minDist;
                    minDist = dist;
                    cellId = fract(sin(dot(i + neighbor, vec3(43.34, 81.74, 31.56))) * 4832.37);
                } else if (dist < secondDist) {
                    secondDist = dist;
                }
            }
        }
    }
    float edgeDist = (secondDist - minDist) * 0.5;
    return vec2(edgeDist, cellId);
}

void main() {
    vec3 surfacePos = vNormalModel;

    vec3 warpedPos = surfacePos + vec3(
        noise(surfacePos * 3.0 + vec3(0.0, 3.3, 7.7)),
        noise(surfacePos * 3.0 + vec3(4.4, 0.0, 2.2)),
        noise(surfacePos * 3.0 + vec3(8.8, 6.6, 0.0))
    ) * 0.08;

    float kernelScale = uNoiseScale * 20.0;
    vec2 voronoi = voronoiCorn(warpedPos, kernelScale, uTime);
    float cellDist = voronoi.x;
    float cellId = voronoi.y;

    float edgeFade = smoothstep(0.0, 0.12, cellDist);

    vec3 nSurf = normalize(surfacePos);
    float sunspotRegion = 0.0;
    for (int i = 0; i < 8; i++) {
        float r = uSunspotRadii[i];
        vec3 warpSeed = nSurf * 3.0 + uSunspotPositions[i] * 7.0;
        vec3 warp = vec3(
            noise(warpSeed + vec3(1.2, 3.4, 5.6)) - 0.5,
            noise(warpSeed + vec3(6.5, 2.1, 8.3)) - 0.5,
            noise(warpSeed + vec3(4.7, 9.0, 1.8)) - 0.5
        ) * r * 1.5;
        vec3 warpedSurf = normalize(nSurf + warp);
        float dist = distance(warpedSurf, uSunspotPositions[i]);
        float spot = smoothstep(r, r * 0.1, dist);
        sunspotRegion = max(sunspotRegion, spot * uSunspotOpacities[i]);
    }

    float cellInSunspot = step(0.4, cellId) * sunspotRegion;
    cellInSunspot *= uSunspotIntensity;

    vec3 orangeColor = vec3(1.0, 0.5, 0.0);
    vec3 darkOrange = vec3(0.6, 0.25, 0.0);
    vec3 sunspotColor = vec3(0.25, 0.12, 0.03);
    vec3 sunspotEdge = vec3(0.15, 0.07, 0.01);

    vec3 normalCell = mix(darkOrange, orangeColor, edgeFade);
    vec3 spotCell = mix(sunspotEdge, sunspotColor, edgeFade);

    vec3 color = mix(normalCell, spotCell, cellInSunspot);

    float fresnel = 1.0 - abs(dot(vNormalView, vec3(0.0, 0.0, 1.0)));
    fresnel = pow(fresnel, 2.0);
    color += uGlowColor * fresnel * uGlowIntensity;

    color *= uBrightness * 0.8;
    vec3 bloomBoost = color * uEmissiveIntensity;
    color = mix(color, bloomBoost, 0.7);

    gl_FragColor = vec4(color, 1.0);
}
`;

/**
 * Material for a star's surface.
 *
 * Does not extend {@link BaseCelestialShaderMaterial}: a star is its own light source, so
 * neither the lighting nor the eclipse-shadow machinery applies to it.
 */
class SunShaderMaterial extends THREE.ShaderMaterial {
    /**
     * Builds the material for one star.
     *
     * Tone mapping is off deliberately. The shader emits values above 1 so the bloom pass
     * has something to bloom, and tone mapping would compress exactly that headroom away.
     *
     * Eight sunspot slots, matching the shader's fixed loop bound; all start fully
     * transparent, so a star with no spots needs no special case.
     *
     * @param {Object} [options={}] - Material options.
     * @param {number|THREE.Color} [options.glowColor=0xffaa00] - Colour of the limb glow.
     * @param {number} [options.glowIntensity=0.3] - Strength of the limb glow.
     * @param {number} [options.noiseScale=5.0] - Granulation cell size; larger means finer
     *   cells.
     * @param {number} [options.brightness=1.6] - Overall surface brightness.
     * @param {number} [options.sunspotIntensity=0.9] - How dark sunspots go.
     * @param {number} [options.emissiveIntensity=1.3] - How far above 1 the output is
     *   pushed, which sets how much the star blooms.
     * @param {Object} [options.materialOptions] - Overrides for the material options set
     *   here.
     */
    constructor(options = {}) {
        const defaultPositions = new Array(8).fill(null).map(() => new THREE.Vector3(0, 1, 0));
        const uniforms = {
            uTime: { value: 0.0 },
            uGlowColor: { value: new THREE.Color(options.glowColor || 0xffaa00) },
            uGlowIntensity: { value: options.glowIntensity || 0.3 },
            uNoiseScale: { value: options.noiseScale || 5.0 },
            uBrightness: { value: options.brightness || 1.6 },
            uSunspotIntensity: { value: options.sunspotIntensity || 0.9 },
            uEmissiveIntensity: { value: options.emissiveIntensity || 1.3 },
            uSunspotPositions: { value: defaultPositions },
            uSunspotOpacities: { value: new Float32Array(8) },
            uSunspotRadii: { value: new Float32Array(8).fill(0.05) }
        };

        super({
            uniforms,
            vertexShader,
            fragmentShader: ShaderLoader.createFragmentShader(fragmentShaderMainCode),
            transparent: false,
            side: THREE.FrontSide,
            toneMapped: false,
            ...options.materialOptions
        });

        this.uTime = uniforms.uTime;
        this.uGlowColor = uniforms.uGlowColor;
        this.uGlowIntensity = uniforms.uGlowIntensity;
        this.uBrightness = uniforms.uBrightness;
        this.uEmissiveIntensity = uniforms.uEmissiveIntensity;
    }

    /**
     * Advances the surface animation.
     *
     * Driven from the simulation clock, not from real time, so the granulation slows and
     * stops with everything else.
     *
     * @param {number} time - Animation time, in scaled seconds.
     * @returns {void}
     */
    updateTime(time) {
        this.uTime.value = time;
    }

    /**
     * Sets the strength of the limb glow.
     *
     * @param {number} intensity - Glow strength.
     * @returns {void}
     */
    setGlowIntensity(intensity) {
        this.uGlowIntensity.value = intensity;
    }

    /**
     * Sets the overall surface brightness.
     *
     * @param {number} brightness - Brightness multiplier.
     * @returns {void}
     */
    setBrightness(brightness) {
        this.uBrightness.value = brightness;
    }

    /**
     * Sets how far above 1 the surface is driven, and so how strongly it blooms.
     *
     * The matching `emissive` properties are kept in step for the sake of anything that
     * inspects the material as a standard one rather than reading the uniform.
     *
     * @param {number} intensity - Emissive intensity.
     * @returns {void}
     */
    setEmissiveIntensity(intensity) {
        this.uEmissiveIntensity.value = intensity;
        this.emissiveIntensity = intensity;

        if (this.emissive && this.uGlowColor) {
            this.emissive.copy(this.uGlowColor.value);
        }

        this.needsUpdate = true;

    }

    /**
     * Replaces the sunspot arrays the shader reads.
     *
     * The arrays are swapped in wholesale rather than copied, so
     * {@link SunspotManager} can keep its own buffers and mutate them in place between
     * calls. All three must be eight long, matching the shader's fixed loop bound.
     *
     * @param {THREE.Vector3[]} positions - Spot centres, as unit vectors in the star's
     *   object space.
     * @param {Float32Array} opacities - How pronounced each spot is; 0 disables it.
     * @param {Float32Array} [radii] - Angular radii; left unchanged if omitted.
     * @returns {void}
     */
    updateSunspots(positions, opacities, radii) {
        this.uniforms.uSunspotPositions.value = positions;
        this.uniforms.uSunspotOpacities.value = opacities;
        if (radii !== undefined) {
            this.uniforms.uSunspotRadii.value = radii;
        }
    }
}

export default SunShaderMaterial;