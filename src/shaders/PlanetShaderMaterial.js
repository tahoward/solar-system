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
uniform sampler2D surfaceTexture;

varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vSurfaceOffset;
varying vec3 vViewPosition;
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

class PlanetShaderMaterial extends BaseCelestialShaderMaterial {
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

    setSurfaceTexture(texture) {
        this.uniforms.surfaceTexture.value = texture;
    }

}

export default PlanetShaderMaterial;