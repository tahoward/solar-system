import * as THREE from 'three';
import BaseCelestialShaderMaterial from './BaseCelestialShaderMaterial.js';

/**
 * Vertex shader for a ring system.
 *
 * Like the planet shader, it passes on the position rotated into world space but not
 * translated, so the shadow test works in small numbers around the planet's centre.
 *
 * @type {string}
 */
const vertexShader = `
varying vec2 vUv;
varying vec3 vSurfaceOffset;
varying vec3 vNormal;

void main() {
    vUv = uv;
    vNormal = normalize(normalMatrix * normal);

    vSurfaceOffset = mat3(modelMatrix) * position;

    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

/**
 * Fragment shader for a ring system.
 *
 * The reverse of the planet's ring shadow: here the planet casts its shadow across the
 * rings, which is visible as a dark wedge cutting through them.
 *
 * `calculatePlanetShadow` only needs a cylinder test, not a cone — the shadow is taken
 * as the planet's own radius extended along the anti-sunward direction. A ring point is
 * in shadow if it lies behind the planet relative to the star and within that radius of
 * the shadow axis. The penumbra is ignored, because at the planet's size relative to
 * the rings it is a fraction of a pixel wide.
 *
 * Lighting is deliberately flat — mostly ambient with only a slight directional term.
 * Ring particles scatter light in all directions, so shading the ring plane as a
 * Lambertian surface makes it look like a solid disc rather than a cloud of debris.
 *
 * @type {string}
 */
const fragmentShader = `
uniform sampler2D ringTexture;
uniform float planetRadius;
uniform float opacity;
uniform bool hasPlanetShadow;

${BaseCelestialShaderMaterial.getCommonUniforms(false)}

varying vec2 vUv;
varying vec3 vSurfaceOffset;
varying vec3 vNormal;

float calculatePlanetShadow(vec3 planetToRing) {
    if (!hasPlanetShadow) return 1.0;

    vec3 sunDirection = normalize(lightDirection);

    float projectionLength = dot(planetToRing, sunDirection);

    if (projectionLength > 0.0) {
        return 1.0;
    }

    vec3 shadowAxis = projectionLength * sunDirection;
    vec3 perpendicular = planetToRing - shadowAxis;
    float perpDistance = length(perpendicular);

    if (perpDistance <= planetRadius) {
        return 0.001;
    }

    return 1.0;
}

void main() {
    vec4 baseColor = texture2D(ringTexture, vUv);

    vec3 lightDir = normalize(lightDirection);
    vec3 normal = normalize(vNormal);

    float lightIntensity = 0.8 + 0.2 * max(dot(normal, lightDir), 0.0);

    float shadowFactor = calculatePlanetShadow(vSurfaceOffset);

    vec3 ambient = baseColor.rgb * lightColor * 0.1;
    vec3 diffuse = baseColor.rgb * lightColor * lightIntensity;

    vec3 litColor = ambient + diffuse;

    vec3 finalColor = litColor * shadowFactor;
    float finalOpacity = baseColor.a * opacity;

    gl_FragColor = vec4(finalColor, finalOpacity);
}
`;

/**
 * Material for a planet's ring system.
 *
 * A transparent textured annulus with the planet's shadow cut across it.
 */
class RingShaderMaterial extends BaseCelestialShaderMaterial {
    /**
     * Builds the material for one ring system.
     *
     * `supportsShadows` is off: the base class's eclipse machinery is for shadows falling
     * *on* a sphere, and the rings need the opposite test, which this shader does itself.
     *
     * `alphaTest` discards nearly transparent fragments outright, so the gaps between
     * ringlets do not accumulate depth-sorting artefacts where the rings overlap
     * themselves across the far side of the planet.
     *
     * @param {Object} [options={}] - Options, passed on to
     *   {@link BaseCelestialShaderMaterial}.
     * @param {THREE.Texture|null} [options.ringTexture=null] - Ring colour and opacity
     *   across the rings' width.
     * @param {number} [options.planetRadius=1.0] - Planet's radius in scene units, which
     *   sets the width of its shadow.
     * @param {number} [options.opacity=1.0] - Overall opacity multiplier.
     * @param {boolean} [options.hasPlanetShadow=true] - Set `false` to skip the shadow
     *   test.
     */
    constructor(options = {}) {
        const ringSpecificUniforms = {
            ringTexture: { value: options.ringTexture || null },
            planetRadius: { value: options.planetRadius || 1.0 },
            opacity: { value: options.opacity || 1.0 },
            hasPlanetShadow: { value: options.hasPlanetShadow !== false }
        };

        super({
            ...options,
            supportsShadows: false,
            additionalUniforms: ringSpecificUniforms,
            materialOptions: {
                vertexShader: vertexShader,
                fragmentShader: fragmentShader,
                transparent: true,
                side: THREE.FrontSide,
                alphaTest: 0.1
            }
        });
    }

}

export default RingShaderMaterial;