import * as THREE from 'three';
import ShaderLoader from './ShaderLoader.js';
import BaseCelestialShaderMaterial from './BaseCelestialShaderMaterial.js';

/**
 * Vertex shader for a planet or moon surface.
 *
 * Passes on the surface offset — the vertex position rotated and scaled into world
 * space but *not* translated — because the eclipse maths works in offsets from the
 * body's centre. Translating into full world coordinates would give numbers in the
 * thousands, which float32 in the fragment shader cannot resolve finely enough to
 * place a shadow.
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
 * Fragment shader for a planet or moon surface.
 *
 * Lambertian diffuse from the star, with a very low ambient term so the night side is
 * almost but not entirely black — completely unlit, a planet's dark limb disappears
 * against the sky and the body reads as a crescent floating in nothing.
 *
 * Ring and body shadows are then multiplied in. Neither is allowed to reach full
 * darkness, which keeps a shadowed region distinguishable from the night side.
 *
 * Ring shadows are skipped on the night side, where they cannot fall, and their
 * strength is floored near the terminator: at grazing incidence the geometric shadow
 * covers most of the surface, and letting it scale with the light would make the
 * shadow fade out exactly where it should be longest.
 *
 * @type {string}
 */
const fragmentShaderMainCode = `
uniform sampler2D surfaceTexture;

varying vec2 vUv;
varying vec3 vSurfaceOffset;
varying vec3 vWorldNormal;

${BaseCelestialShaderMaterial.getCommonUniforms(true)}
${BaseCelestialShaderMaterial.getShadowCalculationShader()}

void main() {
    vec4 baseColor = texture2D(surfaceTexture, vUv);

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

    vec3 ambient = baseColor.rgb * lightColor * 0.005;
    vec3 diffuse = baseColor.rgb * lightColor * hemisphereLight;

    vec3 litColor = ambient + diffuse;

    float shadowIntensity = max(0.8, hemisphereLight);
    float ringShadowFactor = 1.0 - (0.999 * ringShadow * shadowIntensity);
    float bodyShadowFactor = 1.0 - (0.999 * bodyShadow);

    vec3 finalColor = litColor * ringShadowFactor * bodyShadowFactor;

    gl_FragColor = vec4(finalColor, baseColor.a);
}
`;

/**
 * Surface material for planets and moons.
 *
 * A textured sphere lit by the star, with eclipse shadows from the body's rings and
 * from up to eight nearby bodies. See {@link BaseCelestialShaderMaterial} for why the
 * shadows are computed analytically rather than with shadow maps.
 */
class PlanetShaderMaterial extends BaseCelestialShaderMaterial {
    /**
     * Builds the material for one body.
     *
     * Opaque and front-faced: these are solid spheres, so back faces and blending would
     * only cost fill rate.
     *
     * @param {Object} [options={}] - Options, passed on to
     *   {@link BaseCelestialShaderMaterial} along with the shaders.
     * @param {THREE.Texture|null} [options.surfaceTexture=null] - The body's surface
     *   texture.
     */
    constructor(options = {}) {
        const planetSpecificUniforms = {
            surfaceTexture: { value: options.surfaceTexture || null }
        };

        super({
            ...options,
            additionalUniforms: planetSpecificUniforms,
            materialOptions: {
                vertexShader: vertexShader,
                fragmentShader: ShaderLoader.createFragmentShader(fragmentShaderMainCode),
                side: THREE.FrontSide,
                transparent: false
            }
        });
    }

}

export default PlanetShaderMaterial;