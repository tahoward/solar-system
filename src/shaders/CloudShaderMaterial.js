import * as THREE from 'three';
import ShaderLoader from './ShaderLoader.js';
import BaseCelestialShaderMaterial from './BaseCelestialShaderMaterial.js';

/**
 * Vertex shader for the cloud shell.
 *
 * Identical in shape to the planet's: the untranslated world-space offset is passed on so
 * the eclipse tests work in small numbers around the body's centre.
 *
 * @type {string}
 */
const vertexShader = `
varying vec2 vUv;
varying vec3 vSurfaceOffset;
varying vec3 vWorldNormal;

void main() {
    vUv = uv;

    vWorldNormal = normalize(mat3(modelMatrix) * normal);

    vSurfaceOffset = mat3(modelMatrix) * position;

    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

/**
 * Fragment shader for the cloud shell.
 *
 * Lit like the surface below, but the lighting drives *alpha* rather than colour: clouds
 * on the night side fade out instead of going black, since an opaque black shell over an
 * already dark planet reads as a hole rather than as cloud.
 *
 * Nearly transparent fragments are discarded outright, so the gaps between cloud banks do
 * not leave a faint sheen across the whole planet.
 *
 * Ring and body shadows are weakened relative to the surface's: cloud tops sit above the
 * surface and are lit from more directions, so a shadow that darkens the ground fully
 * still leaves the cloud above it visible.
 *
 * @type {string}
 */
const fragmentShaderMainCode = `
uniform sampler2D cloudTexture;
uniform float cloudOpacity;
uniform float alphaTest;

varying vec2 vUv;
varying vec3 vSurfaceOffset;
varying vec3 vWorldNormal;

${BaseCelestialShaderMaterial.getCommonUniforms(true)}
${BaseCelestialShaderMaterial.getShadowCalculationShader()}

const float CLOUD_AMBIENT = 0.02;

void main() {
    vec4 cloudColor = texture2D(cloudTexture, vUv);

    if (cloudColor.a < alphaTest) {
        discard;
    }

    vec3 surfaceNormal = normalize(vWorldNormal);
    vec3 normalizedLightDir = normalize(lightDirection);
    float lightDot = dot(surfaceNormal, normalizedLightDir);
    float hemisphereLight = max(lightDot, 0.0);

    float ringShadow = 0.0;
    if (hasRings && hemisphereLight > 0.0) {
        vec3 sunRadiusPerp = ringNormal - dot(normalizedLightDir, ringNormal) / dot(normalizedLightDir, normalizedLightDir) * normalizedLightDir;
        sunRadiusPerp = normalize(sunRadiusPerp) * lightRadius;

        ringShadow = eclipseByRings(vSurfaceOffset, sunRadiusPerp);
    }

    float bodyShadow = eclipseByBodies(vSurfaceOffset);

    float shadowIntensity = max(0.8, hemisphereLight);
    float ringShadowFactor = 1.0 - (0.8 * ringShadow * shadowIntensity);
    float bodyShadowFactor = 1.0 - (0.9 * bodyShadow);

    float illumination = min(hemisphereLight + CLOUD_AMBIENT, 1.0) * ringShadowFactor * bodyShadowFactor;

    float coverage = cloudColor.a * cloudOpacity;

    gl_FragColor = vec4(cloudColor.rgb * lightColor, coverage * illumination);
}
`;

/**
 * Material for a cloud layer, drawn on a shell just above the surface.
 */
class CloudShaderMaterial extends BaseCelestialShaderMaterial {
    /**
     * Builds the material for one cloud layer.
     *
     * `depthWrite` is off so the shell does not occlude anything drawn after it, and the
     * blending is ordinary alpha, since clouds obscure what is behind them rather than
     * adding to it.
     *
     * The alpha test is done in the shader rather than through the material's own
     * `alphaTest`, because the threshold has to be applied to the texture's alpha before
     * lighting scales it — afterwards the night side would fall below any useful
     * threshold and the clouds would vanish rather than fade.
     *
     * @param {Object} [options={}] - Options, passed on to
     *   {@link BaseCelestialShaderMaterial}.
     * @param {THREE.Texture|null} [options.cloudTexture=null] - Cloud colour and coverage.
     * @param {number} [options.opacity=0.8] - Overall coverage multiplier.
     * @param {number} [options.alphaTest=0.1] - Coverage below which fragments are
     *   discarded.
     */
    constructor(options = {}) {
        const cloudSpecificUniforms = {
            cloudTexture: { value: options.cloudTexture || null },
            cloudOpacity: { value: options.opacity || 0.8 },
            alphaTest: { value: options.alphaTest || 0.1 }
        };

        super({
            ...options,
            additionalUniforms: cloudSpecificUniforms,
            materialOptions: {
                vertexShader: vertexShader,
                fragmentShader: ShaderLoader.createFragmentShader(fragmentShaderMainCode),
                side: THREE.FrontSide,
                transparent: true,
                depthWrite: false,
                blending: THREE.NormalBlending
            }
        });
    }

}

export default CloudShaderMaterial;