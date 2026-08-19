import * as THREE from 'three';
import BaseCelestialShaderMaterial from './BaseCelestialShaderMaterial.js';

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

class RingShaderMaterial extends BaseCelestialShaderMaterial {
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