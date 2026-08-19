import * as THREE from 'three';
import BaseCelestialShaderMaterial from './BaseCelestialShaderMaterial.js';

const vertexShader = `
uniform vec3 lightDirection;

varying vec3 vShellPoint;
varying vec3 vCameraDirection;
varying float vCameraDistance;
varying vec3 vSunDirection;

void main() {
    float shellRadius = length(position);

    mat3 orientation = mat3(modelMatrix);
    float scale = length(orientation[0]);
    vec3 axisX = orientation[0] / scale;
    vec3 axisY = orientation[1] / scale;
    vec3 axisZ = orientation[2] / scale;

    mat3 viewOrientation = mat3(modelViewMatrix);
    vec3 toBody = modelViewMatrix[3].xyz;
    vec3 cameraOffset = -vec3(dot(viewOrientation[0], toBody),
                              dot(viewOrientation[1], toBody),
                              dot(viewOrientation[2], toBody)) / (scale * scale);

    vCameraDirection = normalize(cameraOffset);
    vCameraDistance = length(cameraOffset) / shellRadius;

    vShellPoint = position / shellRadius;
    vSunDirection = normalize(vec3(dot(axisX, lightDirection),
                                   dot(axisY, lightDirection),
                                   dot(axisZ, lightDirection)));

    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const fragmentShader = `
uniform vec3 atmosphereColor;
uniform float planetRadiusRatio;
uniform float opticalThickness;
uniform float scaleHeight;
uniform float scatteringPower;
uniform float mieStrength;
uniform float mieDirection;

${BaseCelestialShaderMaterial.getCommonUniforms(false)}

varying vec3 vShellPoint;
varying vec3 vCameraDirection;
varying float vCameraDistance;
varying vec3 vSunDirection;

#ifndef PI
#define PI 3.141592653589793
#endif

const int VIEW_STEPS = 12;
const int LIGHT_STEPS = 6;

const float RADIOMETRIC_SCALE = PI;

const float MULTIPLE_SCATTER = 0.85;

float sphereEntry(vec3 origin, vec3 direction, float radius) {
    float projection = dot(origin, direction);
    float offset = dot(origin, origin) - radius * radius;
    float discriminant = projection * projection - offset;
    if (discriminant < 0.0) return -1.0;
    return -projection - sqrt(discriminant);
}

float densityAt(vec3 point) {
    float altitude = clamp((length(point) - planetRadiusRatio) / (1.0 - planetRadiusRatio), 0.0, 1.0);
    float top = exp(-1.0 / scaleHeight);
    return max(exp(-altitude / scaleHeight) - top, 0.0) / (1.0 - top);
}

float sunwardDepth(vec3 point) {
    float projection = dot(point, vSunDirection);
    float exit = -projection + sqrt(max(projection * projection - dot(point, point) + 1.0, 0.0));

    float stepSize = exit / float(LIGHT_STEPS);
    float depth = 0.0;
    for (int i = 0; i < LIGHT_STEPS; i++) {
        depth += densityAt(point + vSunDirection * (float(i) + 0.5) * stepSize);
    }
    return depth * stepSize;
}

void main() {
    bool inside = vCameraDistance < 1.0;
    if (inside == gl_FrontFacing) discard;

    vec3 shellPoint = normalize(vShellPoint);
    vec3 cameraDirection = normalize(vCameraDirection);

    vec3 direction = -normalize(cameraDirection - shellPoint / max(vCameraDistance, 1e-6));

    float entry = inside ? -length(shellPoint - vCameraDistance * cameraDirection) : 0.0;
    float exit = inside ? 0.0 : -2.0 * dot(shellPoint, direction);

    float surface = sphereEntry(shellPoint, direction, planetRadiusRatio);
    if (surface > entry) exit = min(exit, surface);
    if (exit <= entry) discard;

    vec3 scattering = pow(max(atmosphereColor, vec3(0.0)), vec3(scatteringPower));
    scattering /= max(max(scattering.r, max(scattering.g, scattering.b)), 1e-6);

    float cosAngle = dot(direction, vSunDirection);
    float rayleighPhase = 3.0 / (16.0 * PI) * (1.0 + cosAngle * cosAngle);
    float mieDenominator = 1.0 + mieDirection * mieDirection - 2.0 * mieDirection * cosAngle;
    float miePhase = (1.0 - mieDirection * mieDirection)
        / (4.0 * PI * pow(max(mieDenominator, 1e-4), 1.5));

    float stepSize = (exit - entry) / float(VIEW_STEPS);
    float viewDepth = 0.0;
    vec3 rayleighLight = vec3(0.0);
    vec3 mieLight = vec3(0.0);

    for (int i = 0; i < VIEW_STEPS; i++) {
        vec3 point = shellPoint + direction * (entry + (float(i) + 0.5) * stepSize);
        float density = densityAt(point);
        viewDepth += density * stepSize;

        if (sphereEntry(point, vSunDirection, planetRadiusRatio) > 0.0) continue;

        vec3 transmittance = exp(-scattering * opticalThickness * (sunwardDepth(point) + viewDepth));

        rayleighLight += density * transmittance * stepSize;
        mieLight += density * transmittance * stepSize;
    }

    vec3 scatteredAgain = MULTIPLE_SCATTER * (1.0 - exp(-scattering * opticalThickness * viewDepth));

    vec3 inScattered = (rayleighLight * scattering * rayleighPhase + mieLight * mieStrength * miePhase)
        * opticalThickness * RADIOMETRIC_SCALE * lightColor / (1.0 - scatteredAgain);

    vec3 scattered = vec3(1.0) - exp(-inScattered);

    gl_FragColor = vec4(scattered, max(scattered.r, max(scattered.g, scattered.b)));
}
`;

class AtmosphereShaderMaterial extends BaseCelestialShaderMaterial {
    constructor(options = {}) {
        const planetRadiusRatio = options.planetRadiusRatio ?? 1.0;

        const scaleHeight = options.scaleHeight ?? 0.2;

        const airHeight = scaleHeight * (1.0 - planetRadiusRatio);

        const atmosphereSpecificUniforms = {
            atmosphereColor: { value: new THREE.Color(options.atmosphereColor || 0x87CEEB) },

            planetRadiusRatio: { value: planetRadiusRatio },

            opticalThickness: { value: AtmosphereShaderMaterial.coefficientFor(
                options.verticalOpticalDepth ?? 0.3, airHeight) },

            scaleHeight: { value: scaleHeight },

            scatteringPower: { value: options.scatteringPower ?? 2.0 },

            mieStrength: { value: options.mieStrength ?? 0.08 },

            mieDirection: { value: options.mieDirection ?? 0.76 }
        };

        super({
            ...options,
            supportsShadows: false,
            additionalUniforms: atmosphereSpecificUniforms,
            materialOptions: {
                vertexShader,
                fragmentShader,
                transparent: true,

                blending: THREE.CustomBlending,
                blendSrc: THREE.OneFactor,
                blendDst: THREE.OneMinusSrcColorFactor,
                blendSrcAlpha: THREE.OneFactor,
                blendDstAlpha: THREE.OneMinusSrcAlphaFactor,

                side: THREE.DoubleSide,

                depthWrite: false,

                toneMapped: false,
                ...options.materialOptions
            }
        });

        this.atmosphereColor = this.uniforms.atmosphereColor;
        this.opticalThickness = this.uniforms.opticalThickness;
        this.airHeight = airHeight;
    }

    static coefficientFor(verticalOpticalDepth, airHeight) {
        return airHeight > 0 ? verticalOpticalDepth / airHeight : 0;
    }

    setAtmosphereColor(color) {
        if (typeof color === 'number') {
            this.atmosphereColor.value.setHex(color);
        } else {
            this.atmosphereColor.value.copy(color);
        }
    }

    setVerticalOpticalDepth(verticalOpticalDepth) {
        this.opticalThickness.value =
            AtmosphereShaderMaterial.coefficientFor(verticalOpticalDepth, this.airHeight);
    }

    dispose() {
        super.dispose();
    }
}

export default AtmosphereShaderMaterial;
