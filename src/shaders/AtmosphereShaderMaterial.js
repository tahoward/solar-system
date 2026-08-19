import * as THREE from 'three';
import BaseCelestialShaderMaterial from './BaseCelestialShaderMaterial.js';

/**
 * Vertex shader for the atmosphere shell.
 *
 * Its whole job is to move the problem into a normalised body space where the shell has
 * radius 1 and the planet sits at the origin. The camera offset and the sun direction
 * are both transformed into that space and handed to the fragment shader, which can then
 * raymarch in numbers of order 1 regardless of whether the body is Earth-sized or a
 * gas giant a thousand scene units across. Marching in world space would put the
 * integration at coordinates in the thousands, where float32 has nothing like the
 * resolution the density falloff needs.
 *
 * The model matrix's scale is divided out to recover its rotation, since the shell is
 * scaled to the atmosphere's extent and the direction vectors must not be.
 *
 * @type {string}
 */
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

/**
 * Fragment shader for the atmosphere: a single-scattering raymarch.
 *
 * For each pixel it walks the view ray through the shell, and at each sample walks a
 * second, shorter ray towards the star to find how much light reaches that point. That
 * nested integral is what produces a blue sky, a red sunset and a bright limb from the
 * same code, rather than the three being faked separately.
 *
 * Twelve view steps and six light steps: enough that banding is not visible at these
 * shell thicknesses, and small enough that the nested loop stays affordable at 72
 * samples per pixel.
 *
 * Both phase functions are the standard ones. Rayleigh is nearly isotropic and gives the
 * overall blue; Henyey–Greenstein Mie is strongly forward-scattering, `mieDirection`
 * setting how sharply, and supplies the white glare around the star's position and the
 * haze near the horizon.
 *
 * Three details worth knowing:
 *
 * The first line discards half the faces. The shell is drawn double-sided so it is still
 * visible from inside the atmosphere, but only one face per pixel should be integrated —
 * the front face when the camera is outside, the back face when it is inside — or every
 * pixel would be shaded twice.
 *
 * `densityAt` subtracts the density at the top of the shell before normalising, so the
 * exponential reaches exactly zero at the boundary. Left as a bare exponential it would
 * still be slightly positive there, and the shell's edge would show as a visible ring.
 *
 * `scatteredAgain` is a cheap stand-in for multiple scattering. A true multiple-scatter
 * integral is far too expensive here, but without any of it the night side and the deep
 * limb come out unnaturally dark, since in reality light reaches them after several
 * bounces.
 *
 * @type {string}
 */
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

/**
 * Material for a planet's atmosphere, rendered on a shell around the body.
 *
 * Parameters are given in terms one can reason about — a colour, a scale height, a
 * vertical optical depth — and converted here into what the shader needs.
 */
class AtmosphereShaderMaterial extends BaseCelestialShaderMaterial {
    /**
     * Builds the material for one atmosphere.
     *
     * The blending is custom and deliberate. Source is added at full weight while the
     * destination is attenuated by the source's own colour, which makes the effect
     * additive where the atmosphere is thin but saturating where it is thick — plain
     * additive blending blows the limb out to white, and ordinary alpha blending loses
     * the glow entirely.
     *
     * `depthWrite` is off so the shell does not occlude the planet inside it, and
     * `DoubleSide` keeps it visible from within; the fragment shader discards whichever
     * face is not wanted. Tone mapping is off because the shader already applies its own
     * exponential exposure at the end.
     *
     * @param {Object} [options={}] - Options, passed on to
     *   {@link BaseCelestialShaderMaterial}.
     * @param {number|THREE.Color} [options.atmosphereColor=0x87CEEB] - Colour the
     *   scattering coefficients are derived from.
     * @param {number} [options.planetRadiusRatio=1.0] - Planet radius as a fraction of
     *   the shell radius; the raymarch stops at this surface.
     * @param {number} [options.scaleHeight=0.2] - Density falloff height, as a fraction
     *   of the shell's thickness.
     * @param {number} [options.verticalOpticalDepth=0.3] - Optical depth looking straight
     *   up through the atmosphere; in effect, how hazy it is.
     * @param {number} [options.scatteringPower=2.0] - Exponent applied to the colour when
     *   deriving per-channel coefficients, controlling how strongly wavelengths separate.
     * @param {number} [options.mieStrength=0.08] - Weight of the Mie term against
     *   Rayleigh.
     * @param {number} [options.mieDirection=0.76] - Mie anisotropy, from 0 (isotropic)
     *   towards 1 (sharply forward).
     * @param {Object} [options.materialOptions] - Overrides for the material options set
     *   here.
     */
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
    }

    /**
     * Converts a vertical optical depth into the shader's per-unit-length coefficient.
     *
     * The shader multiplies this by an integrated density, so it needs a coefficient per
     * unit length, whereas the readable parameter is the total depth through the
     * atmosphere. Dividing by the air column's height converts between them, which means
     * a given `verticalOpticalDepth` looks the same however thick the shell is made.
     *
     * @param {number} verticalOpticalDepth - Optical depth straight up through the
     *   atmosphere.
     * @param {number} airHeight - Height of the air column, in normalised shell units.
     * @returns {number} The coefficient, or 0 if the atmosphere has no thickness.
     */
    static coefficientFor(verticalOpticalDepth, airHeight) {
        return airHeight > 0 ? verticalOpticalDepth / airHeight : 0;
    }
}

export default AtmosphereShaderMaterial;
