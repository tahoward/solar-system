import * as THREE from 'three';
import { log } from '../utils/Logger.js';

class BaseCelestialShaderMaterial extends THREE.ShaderMaterial {
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

    updateLighting(lightPosition, planetPosition, ringRotation = null) {
        const direction = new THREE.Vector3().subVectors(lightPosition, planetPosition).normalize();
        this.uniforms.lightDirection.value.copy(direction);

        if (ringRotation && this._supportsShadows) {
            const normal = new THREE.Vector3(0, 1, 0);
            normal.applyEuler(ringRotation);
            this.uniforms.ringNormal.value.copy(normal);
        }
    }

    setLightColor(color) {
        if (typeof color === 'number') {
            this.uniforms.lightColor.value.setHex(color);
        } else {
            this.uniforms.lightColor.value.copy(color);
        }
    }

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

    clearMoons() {
        if (!this._supportsShadows) {
            return;
        }

        this.uniforms.numBodies.value = 0;
    }

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