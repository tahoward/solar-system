import * as THREE from 'three';
import { log } from '../utils/Logger.js';

/**
 * Shared base for the materials on celestial bodies: lighting and eclipse shadows.
 *
 * Three.js's own shadow maps are a poor fit here. They work from the camera's
 * viewpoint at a fixed resolution, and the scene spans from a moon a few units
 * across to orbits thousands of units wide — a shadow map covering that range has
 * nothing like the resolution to resolve a moon's shadow on a planet. Instead the
 * shadow is computed analytically in the fragment shader: bodies are spheres and the
 * star is a sphere of known size, so whether a surface point is eclipsed is a
 * ray-sphere test, exact at any scale.
 *
 * Two shadow sources are handled — the body's own rings, and up to eight nearby
 * bodies. Eight is a shader constant because GLSL loop bounds must be fixed at
 * compile time; it comfortably covers a planet's major moons.
 *
 * Subclasses supply their own shaders and extra uniforms; this sets up the common
 * ones and the JavaScript side of keeping them current.
 */
class BaseCelestialShaderMaterial extends THREE.ShaderMaterial {
    /**
     * Sets up the common uniforms and merges in a subclass's own.
     *
     * The shadow uniforms are only declared when shadows are wanted, since a material
     * that will never cast them — the sun's own surface, for instance — would otherwise
     * carry eight vectors and a texture sampler for nothing.
     *
     * `lightDirection` and `lightColor` are also exposed as plain properties, so callers
     * can write to them without reaching through `uniforms`.
     *
     * @param {Object} [options={}] - Material options.
     * @param {number|THREE.Color} [options.lightColor=0xffffff] - Colour of the
     *   illuminating star.
     * @param {boolean} [options.supportsShadows=true] - Set `false` to omit the shadow
     *   uniforms entirely.
     * @param {number} [options.ringInnerRadius=1.0] - Inner ring radius, in scene units.
     * @param {number} [options.ringOuterRadius=2.0] - Outer ring radius, in scene units.
     * @param {number} [options.lightRadius=0.1] - Star's angular size as a fraction of a
     *   shadowing body's radius, which sets how soft the penumbra is.
     * @param {boolean} [options.hasRings=false] - Whether ring shadows apply.
     * @param {THREE.Texture|null} [options.ringAlphaTexture=null] - Ring opacity across
     *   the rings' width.
     * @param {Object} [options.additionalUniforms] - Subclass uniforms.
     * @param {Object} [options.materialOptions] - Options passed to `ShaderMaterial`,
     *   including the shaders themselves.
     */
    constructor(options = {}) {
        const commonUniforms = {
            lightDirection: { value: new THREE.Vector3(1.0, 0.0, 0.0) },
            lightColor: { value: new THREE.Color(options.lightColor || 0xffffff) }
        };

        if (options.supportsShadows !== false) {
            Object.assign(commonUniforms, {
                ringNormal: { value: new THREE.Vector3(0.0, 1.0, 0.0) },
                ringInnerRadius: { value: options.ringInnerRadius || 1.0 },
                ringOuterRadius: { value: options.ringOuterRadius || 2.0 },
                lightRadius: { value: options.lightRadius || 0.1 },
                hasRings: { value: options.hasRings || false },
                ringAlphaTexture: { value: options.ringAlphaTexture || null },
                bodyOffsets: { value: Array(8).fill(null).map(() => new THREE.Vector3()) },
                bodyRadii: { value: new Float32Array(8) },
                numBodies: { value: 0 }
            });
        }

        const uniforms = {
            ...commonUniforms,
            ...(options.additionalUniforms || {})
        };

        super({
            uniforms,
            ...options.materialOptions
        });

        this.lightDirection = uniforms.lightDirection.value;
        this.lightColor = uniforms.lightColor.value;

        if (options.supportsShadows !== false) {
            this.ringNormal = uniforms.ringNormal.value;
        }

        this._supportsShadows = options.supportsShadows !== false;
    }

    /**
     * Points the shader's light at the star and orients the ring plane.
     *
     * A direction rather than a position is passed to the shader: at these distances the
     * star's rays are effectively parallel across a single body, and a direction avoids
     * the precision trouble of large coordinates in the fragment shader.
     *
     * @param {THREE.Vector3} lightPosition - Star's world position.
     * @param {THREE.Vector3} planetPosition - This body's world position.
     * @param {THREE.Euler|null} [ringRotation=null] - Rotation of the ring plane; needed
     *   for ring shadows to land in the right place on a tilted planet.
     * @returns {void}
     */
    updateLighting(lightPosition, planetPosition, ringRotation = null) {
        const direction = new THREE.Vector3().subVectors(lightPosition, planetPosition).normalize();
        this.uniforms.lightDirection.value.copy(direction);

        if (ringRotation && this._supportsShadows) {
            const normal = new THREE.Vector3(0, 1, 0);
            normal.applyEuler(ringRotation);
            this.uniforms.ringNormal.value.copy(normal);
        }
    }

    /**
     * Sets the colour of the illuminating light.
     *
     * @param {number|THREE.Color} color - Hex value or colour.
     * @returns {void}
     */
    setLightColor(color) {
        if (typeof color === 'number') {
            this.uniforms.lightColor.value.setHex(color);
        } else {
            this.uniforms.lightColor.value.copy(color);
        }
    }

    /**
     * Tells the shader which nearby bodies can cast a shadow on this one.
     *
     * Positions are converted to offsets from this body, keeping the numbers the shader
     * works with small — world coordinates run to thousands of units and float32 in a
     * fragment shader cannot resolve a moon's radius against them.
     *
     * All eight slots are cleared before the live ones are written, so stale offsets
     * from a longer list cannot leave a phantom shadow behind.
     *
     * Anything past the eighth body is dropped; callers are expected to pass the nearest
     * or largest first.
     *
     * @param {THREE.Vector3[]} positions - World positions of the shadowing bodies.
     * @param {number[]} radii - Their radii, in scene units, in the same order.
     * @param {THREE.Vector3} planetPosition - This body's world position.
     * @returns {void}
     */
    updateMoons(positions, radii, planetPosition) {
        if (!this._supportsShadows) {
            log.warn('BaseCelestialShaderMaterial', 'Attempting to update moons on material that does not support shadows');
            return;
        }

        const maxBodies = 8;
        const numBodies = Math.min(positions.length, maxBodies);

        this.uniforms.numBodies.value = numBodies;

        for (let i = 0; i < maxBodies; i++) {
            this.uniforms.bodyOffsets.value[i].set(0, 0, 0);
            this.uniforms.bodyRadii.value[i] = 0;
        }

        for (let i = 0; i < numBodies; i++) {
            this.uniforms.bodyOffsets.value[i].subVectors(positions[i], planetPosition);
            this.uniforms.bodyRadii.value[i] = radii[i];
        }
    }

    /**
     * Stops any body shadows being cast on this one.
     *
     * Only the count is zeroed; the shader's loop exits on it, so the stale offsets are
     * never read.
     *
     * @returns {void}
     */
    clearMoons() {
        if (!this._supportsShadows) {
            return;
        }

        this.uniforms.numBodies.value = 0;
    }

    /**
     * Returns the GLSL that computes eclipse shadows, for a subclass to include.
     *
     * Two functions come back. `eclipseByRings` intersects the ray from the surface
     * point towards the star with the ring plane, and if it lands between the ring
     * radii, looks up how opaque the rings are there. Nine taps in a small ring around
     * that lookup soften the shadow's edge — a single tap gives a hard-edged band that
     * looks wrong against the penumbra everything else produces. The opacity is raised
     * to a low power so thin ring material still darkens the surface noticeably.
     *
     * `eclipseByBodies` does the same for spheres: for each shadowing body, the closest
     * approach of the star-ward ray to its centre is compared against its radius. The
     * radius is inflated by `lightRadius` and the result smoothstepped, which is what
     * gives the penumbra its soft edge — the star is not a point, so a real eclipse
     * shadow has no sharp boundary. Only bodies in front of the surface point cast
     * anything, and the shadow is attenuated with distance so a far-off moon does not
     * darken a planet as much as a close one.
     *
     * @returns {string} GLSL source defining `eclipseByRings` and `eclipseByBodies`.
     */
    static getShadowCalculationShader() {
        return `
#define DIV 7
#if DIV == 0
  #define INV_DIV 1.0
#else
  #define INV_DIV (1.0/float(DIV))
#endif

float eclipseByRings(vec3 surfaceOffset, vec3 sunRadiusPerp) {
    if (!hasRings) return 0.0;

    vec3 sunRay = normalize(lightDirection);

    float s = -dot(ringNormal, surfaceOffset) / dot(ringNormal, sunRay);

    if (s > 0.0) {
        vec3 ringVec = surfaceOffset + sunRay * s;

        float ringDistance = length(ringVec - dot(ringVec, ringNormal) * ringNormal);

        if (ringDistance >= ringInnerRadius && ringDistance <= ringOuterRadius) {
            float alphaRatio = (ringDistance - ringInnerRadius) / (ringOuterRadius - ringInnerRadius);

            float shadowSum = 0.0;
            float blurRadius = 0.02;

            for (int i = 0; i < 9; i++) {
                vec2 sampleCoord = vec2(alphaRatio, 0.5);

                if (i > 0) {
                    float angle = float(i - 1) * 0.785398;
                    vec2 offset = vec2(cos(angle), sin(angle)) * blurRadius;
                    sampleCoord += offset;
                }

                float ringAlpha = texture2D(ringAlphaTexture, sampleCoord).r;
                shadowSum += pow(ringAlpha, 0.3);
            }

            return shadowSum / 9.0;
        }
    }

    return 0.0;
}

float eclipseByBodies(vec3 surfaceOffset) {
    if (numBodies == 0) return 0.0;

    vec3 sunRay = normalize(lightDirection);
    float totalShadow = 0.0;

    for (int i = 0; i < 8; i++) {
        if (i >= numBodies) break;

        vec3 bodyCenter = bodyOffsets[i];
        float bodyRadius = bodyRadii[i];

        vec3 surfaceToBody = bodyCenter - surfaceOffset;

        float projectionLength = dot(surfaceToBody, sunRay);

        if (projectionLength > 0.0) {
            vec3 closestPointOnRay = surfaceOffset + sunRay * projectionLength;

            float distanceToRay = length(bodyCenter - closestPointOnRay);

            float shadowRadius = bodyRadius * (1.0 + lightRadius);

            if (distanceToRay < shadowRadius) {
                float shadowIntensity = 1.0 - smoothstep(bodyRadius * 0.8, shadowRadius, distanceToRay);

                float distanceAttenuation = 1.0 / (1.0 + projectionLength * 0.01);

                totalShadow += shadowIntensity * distanceAttenuation;
            }
        }
    }

    return min(totalShadow, 1.0);
}
`;
    }

    /**
     * Returns the GLSL uniform declarations matching the constructor's uniforms.
     *
     * The two have to agree: declaring the shadow uniforms in a shader whose material
     * was built without them leaves them unset, and omitting them from a shader that
     * uses them will not compile.
     *
     * @param {boolean} [includeShadows=true] - Whether to include the shadow uniforms.
     * @returns {string} GLSL uniform declarations.
     */
    static getCommonUniforms(includeShadows = true) {
        const baseUniforms = `
uniform vec3 lightDirection;
uniform vec3 lightColor;
`;

        const shadowUniforms = `
uniform sampler2D ringAlphaTexture;
uniform vec3 ringNormal;
uniform float ringInnerRadius;
uniform float ringOuterRadius;
uniform float lightRadius;
uniform bool hasRings;
uniform vec3 bodyOffsets[8];
uniform float bodyRadii[8];
uniform int numBodies;
`;

        return includeShadows ? baseUniforms + shadowUniforms : baseUniforms;
    }
}

export default BaseCelestialShaderMaterial;