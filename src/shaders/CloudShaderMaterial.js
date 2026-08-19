import * as THREE from 'three';
import ShaderLoader from './ShaderLoader.js';
import BaseCelestialShaderMaterial from './BaseCelestialShaderMaterial.js';

const vertexShader = `
varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vSurfaceOffset;
varying vec3 vViewPosition;
varying vec3 vWorldNormal;

void main() {
    vUv = uv;

    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    vNormal = normalize(normalMatrix * normal);

    vSurfaceOffset = mat3(modelMatrix) * position;

    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    vViewPosition = -mvPosition.xyz;

    gl_Position = projectionMatrix * mvPosition;
}
`;

const fragmentShaderMainCode = `
uniform sampler2D cloudTexture;
uniform float cloudOpacity;
uniform float alphaTest;

varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vSurfaceOffset;
varying vec3 vViewPosition;
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

class CloudShaderMaterial extends BaseCelestialShaderMaterial {
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

    setCloudTexture(texture) {
        this.uniforms.cloudTexture.value = texture;
    }

    setOpacity(opacity) {
        this.uniforms.cloudOpacity.value = opacity;
    }

    setAlphaTest(threshold) {
        this.uniforms.alphaTest.value = threshold;
    }

}

export default CloudShaderMaterial;