import * as THREE from 'three';
import BaseCelestialShaderMaterial from './BaseCelestialShaderMaterial.js';

const vertexShader = `
uniform vec3 lightDirection;

varying vec3 vShellPoint;
varying vec3 vCameraDirection;
varying float vCameraDistance;
varying vec3 vSunDirection;

void main() {
    // The scattering integral runs in the shell's own frame, in units of the shell's radius, so a
    // planet and a moon are the same problem and every quantity in the fragment shader sits near
    // one. Working in world space instead would put the camera and the body at orbital distances
    // where float32 coordinates quantize far coarser than a body's radius, and the differences the
    // integral is built out of would lose most of their significant digits.
    float shellRadius = length(position);

    // The body's axes, taken out of the model matrix and unscaled. Bodies carry a uniform scale, so
    // one column's length is the scale factor, and the transpose of the unscaled rotation - which is
    // its inverse - is applied a row at a time to avoid needing transpose(), unavailable in the GLSL
    // version three.js compiles to by default.
    mat3 orientation = mat3(modelMatrix);
    float scale = length(orientation[0]);
    vec3 axisX = orientation[0] / scale;
    vec3 axisY = orientation[1] / scale;
    vec3 axisZ = orientation[2] / scale;

    // Where the camera is, taken from the view matrix rather than from cameraPosition. Both hold the
    // same information, but cameraPosition would have to be reduced by the body's world position here
    // - and out at Pluto's distance a float32 step is already a twentieth of the shell's radius, so
    // what is left of a close-up camera offset after that subtraction is mostly quantization. The
    // view matrix arrives with the difference already taken in double precision on the way in, at a
    // magnitude of the camera's actual distance. Inverting it is the same job as above, and the view
    // transform is a rigid one, so the model matrix's scale factor carries over - once for the
    // transpose and once more to undo the columns' own length.
    mat3 viewOrientation = mat3(modelViewMatrix);
    vec3 toBody = modelViewMatrix[3].xyz;
    vec3 cameraOffset = -vec3(dot(viewOrientation[0], toBody),
                              dot(viewOrientation[1], toBody),
                              dot(viewOrientation[2], toBody)) / (scale * scale);

    // Kept as a direction and a distance rather than combined into one vector. At an orbital remove a
    // body's shell radius is a millionth of the camera's distance, so that vector would run to
    // hundreds of thousands of shell radii - and every float32 step at that magnitude is a sizeable
    // fraction of the shell itself, enough to quantize the shading into blocks that reshuffle as the
    // camera moves. Held apart, the fragment shader can form the ray without ever subtracting
    // something the size of the shell from something that large.
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

// Samples taken along the view ray, and along the sunward ray from each of those. The product is
// the per-pixel cost, and it is the first thing to turn down if atmospheres get expensive.
const int VIEW_STEPS = 12;
const int LIGHT_STEPS = 6;

// Brings the air into the same units as everything else lit in this scene. The phase functions below
// are the physical ones, normalised to integrate to one over the sphere, so they carry a factor of
// 1/4π that is only meaningful next to surfaces measured the same way. A Lambertian surface returns
// albedo/π of the light falling on it, and the bodies here are shaded as albedo times the cosine of
// the light angle with that 1/π left out - so every surface in the scene stands a factor of π
// brighter than physical. Left correct on its own the air came out around a tenth of the brightness
// of the ground it wraps, faint enough that only the bloom pass made it apparent; scaled to match, it
// sits where it belongs, a little brighter at the limb than the sunlit surface below.
const float RADIOMETRIC_SCALE = PI;

// The share of once-scattered light that goes on to scatter again rather than escaping, at the limit
// of a long path. Air scatters almost without absorbing, so this sits close to one; what is left over
// stands in for the part a haze absorbs instead of passing on. It caps the brightening at 1/(1 - x).
const float MULTIPLE_SCATTER = 0.85;

/**
 * Distance from a point along a direction to where it first meets a sphere centred on the frame's
 * origin, or -1 when it never does. Both spheres here are centred on the body.
 *
 * Every ray fed to this starts on or inside the shell, which is what keeps the quadratic well
 * conditioned and is the reason the marching below is anchored at the fragment rather than at the
 * camera: a camera hundreds of thousands of shell radii away would have its distance squared and
 * then reduced by a number of the same size, and the difference that survives is noise.
 */
float sphereEntry(vec3 origin, vec3 direction, float radius) {
    float projection = dot(origin, direction);
    float offset = dot(origin, origin) - radius * radius;
    float discriminant = projection * projection - offset;
    if (discriminant < 0.0) return -1.0;
    return -projection - sqrt(discriminant);
}

/**
 * Air density at a point, relative to density at the surface. Exponential in altitude, which is what
 * a hydrostatic atmosphere settles into, and rebased so it arrives at exactly zero at the top of the
 * shell - left as a bare exponential the shell's outer edge is a step in density and draws itself as
 * a hard circle against the sky.
 */
float densityAt(vec3 point) {
    float altitude = clamp((length(point) - planetRadiusRatio) / (1.0 - planetRadiusRatio), 0.0, 1.0);
    float top = exp(-1.0 / scaleHeight);
    return max(exp(-altitude / scaleHeight) - top, 0.0) / (1.0 - top);
}

/**
 * Depth of air a sunbeam passes through on its way to a point, in surface densities. Sunlight
 * arrives along a single direction because the sun is effectively at infinity at these distances.
 */
float sunwardDepth(vec3 point) {
    // The point is inside the shell, so the beam always has some shell left to cross.
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
    // Keep whichever face of the shell the camera can actually see, and drop the other. Deciding
    // here rather than fixing a side on the material is what lets the camera descend into the
    // atmosphere: from outside only the near hemisphere is wanted, from inside only the far one,
    // and either way exactly one fragment per pixel runs the integral.
    bool inside = vCameraDistance < 1.0;
    if (inside == gl_FrontFacing) discard;

    // Put the ray back on the sphere. Interpolating a position across a facet lands slightly inside
    // the sphere it was built from, and the chord below is exact only for a point on the shell - so
    // taken as rasterized it would carry the facets into the result, faintly, which is the whole
    // thing this shader is meant to stop doing.
    vec3 shellPoint = normalize(vShellPoint);
    vec3 cameraDirection = normalize(vCameraDirection);

    // The ray from the camera through this point, formed from the camera's direction and its
    // distance kept apart rather than from the difference of two positions. Out at an orbital
    // distance the camera is hundreds of thousands of shell radii away, and subtracting a point on
    // the shell from a vector that long leaves the part that varies across the body resolved to a
    // handful of float32 steps - which shades a thin shell in blocks that reshuffle as the camera
    // moves. Factoring the distance out instead keeps the term being subtracted around a millionth,
    // where losing most of its precision costs an angle of no consequence.
    vec3 direction = -normalize(cameraDirection - shellPoint / max(vCameraDistance, 1e-6));

    // The stretch of ray that lies in air, measured from this point. It sits exactly on the shell,
    // so one end of the chord is at zero and the other follows without a square root.
    float entry = inside ? -length(shellPoint - vCameraDistance * cameraDirection) : 0.0;
    float exit = inside ? 0.0 : -2.0 * dot(shellPoint, direction);

    // Cut the chord where it runs into the body. Taking that from the sphere rather than from the
    // depth buffer is what makes the shell independent of how coarsely anything is tessellated: a
    // sphere's facets fall inside its true silhouette, so air behind the planet that relies on the
    // body's polygon to hide it leaks out through the gaps between them, all the way around the limb.
    float surface = sphereEntry(shellPoint, direction, planetRadiusRatio);
    if (surface > entry) exit = min(exit, surface);
    if (exit <= entry) discard;

    // Rayleigh scattering goes as the inverse fourth power of wavelength, and it is the ordering of
    // the resulting per-channel coefficients that gives a sky its colour - along with the sunset at
    // the terminator, where the long grazing path scatters the strong channels out of the beam
    // before it arrives. Rather than fixing those coefficients to Earth's, take their ordering from
    // whatever colour the body's air is given and stretch it with a power, so each body keeps its
    // own character and still behaves like air.
    vec3 scattering = pow(max(atmosphereColor, vec3(0.0)), vec3(scatteringPower));
    scattering /= max(max(scattering.r, max(scattering.g, scattering.b)), 1e-6);

    // How much of the light bends toward the eye depends on the angle it turns through. Rayleigh is
    // gently two-lobed, Mie sharply forward, which is what puts a bright haze around a body seen
    // nearly against its star.
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

        // A sample only lights up if the sun reaches it. Testing that against the body's sphere
        // gives a terminator that softens with altitude for nothing: air high above a point still
        // catches the sun after the ground beneath it has turned away, which is the whole reason a
        // planet's night side keeps a thin bright edge rather than ending at a line.
        if (sphereEntry(point, vSunDirection, planetRadiusRatio) > 0.0) continue;

        // Light lost on the way in and on the way out again, both channel by channel.
        vec3 transmittance = exp(-scattering * opticalThickness * (sunwardDepth(point) + viewDepth));

        rayleighLight += density * transmittance * stepSize;
        mieLight += density * transmittance * stepSize;
    }

    // Light that reaches the eye having scattered more than once. Single scattering on its own cannot
    // make air look bright: once its own extinction is accounted for, the radiance it returns
    // saturates at the value of the phase function, some six percent for Rayleigh seen at a right
    // angle, however much air the ray crosses. Piling on more atmosphere does nothing - which is why
    // the shell was faint enough that only the bloom pass made it apparent. A deep atmosphere is
    // bright because light bounces. Of the light taken out of the beam, roughly the fraction
    // (1 - exp(-depth)) is turned again rather than leaving, and summing that over every order of
    // scattering multiplies the first order by 1/(1 - f). Done per channel, so the strongly scattered
    // end of the spectrum gains most and a long path whitens towards the surface, as a deep sky does.
    vec3 scatteredAgain = MULTIPLE_SCATTER * (1.0 - exp(-scattering * opticalThickness * viewDepth));

    vec3 inScattered = (rayleighLight * scattering * rayleighPhase + mieLight * mieStrength * miePhase)
        * opticalThickness * RADIOMETRIC_SCALE * lightColor / (1.0 - scatteredAgain);

    // An exposure curve, not a clamp. The limb is both the brightest part of the shell and, from any
    // distance, a fraction of a pixel wide, so a value over the bloom threshold there reaches the
    // coarse mip levels as a lone texel and comes back as a white blob winking with the coverage.
    // Rolling off asymptotically stays under that threshold without the flat top a clamp leaves,
    // which is what separates haze from an opaque skin. What comes out is also how much of the body
    // behind the air this air stands in for - see the blend the material is built with.
    vec3 scattered = vec3(1.0) - exp(-inScattered);

    // The colour channels are composited against what is behind them one at a time by the blend
    // function, so alpha is only here for the framebuffer's own channel; the strongest of the three
    // is the one that hides the most.
    gl_FragColor = vec4(scattered, max(scattered.r, max(scattered.g, scattered.b)));
}
`;

/**
 * AtmosphereShaderMaterial - Renders a planetary atmosphere as single-scattered sunlight.
 *
 * The shell geometry only exists to get the pixels it covers rasterized. Where the view ray enters
 * and leaves the air, and where the body cuts it short, are all solved against the two spheres
 * analytically in the fragment shader, so the result does not depend on the detail either sphere is
 * drawn at. Brightness, colour, the limb, the terminator and the night side are consequences of the
 * integral rather than separate authored terms.
 *
 * Simplifications worth knowing about: light is followed along one path and bounced only in the
 * aggregate, by closing the series of scattering orders rather than tracing them, so the colour of
 * multiply scattered light is approximated by that of the first bounce. How much of the body the air
 * hides is taken to be how brightly the air shines, which holds for air that scatters far more than
 * it absorbs but leaves the unlit air of the night side transparent where it should be blocking what
 * is behind it. And with the camera inside the shell, air in front of the body is not drawn -
 * the far hemisphere is what remains visible, and the body is in front of it.
 */
class AtmosphereShaderMaterial extends BaseCelestialShaderMaterial {
    constructor(options = {}) {
        // The body's radius as a fraction of the shell's, which is where the air stops. One leaves no
        // air at all, the safe reading if a caller omits it.
        const planetRadiusRatio = options.planetRadiusRatio ?? 1.0;

        // Height the density falls by e over, as a fraction of the shell's thickness. Small values
        // hug the surface as a thin bright line; large ones fill the shell evenly.
        const scaleHeight = options.scaleHeight ?? 0.2;

        // Air a ray crosses looking straight down, expressed as the fraction of the shell's radius it
        // would fill at the density it has at the surface. Multiplying an optical depth by this is
        // what the shader's coefficient has to be, and it is a small number because a shell is only
        // a few percent of a body's radius.
        const airHeight = scaleHeight * (1.0 - planetRadiusRatio);

        const atmosphereSpecificUniforms = {
            atmosphereColor: { value: new THREE.Color(options.atmosphereColor || 0x87CEEB) },

            planetRadiusRatio: { value: planetRadiusRatio },

            // How much of the light heading straight down through the air is turned aside before it
            // reaches the ground, in the channel that scatters hardest. This is the quantity
            // atmospheres are actually measured by - Earth's is near 0.3 in blue, Titan's around 4,
            // Pluto's a twentieth - so a body can be given the published figure and the shell it
            // happens to be drawn on can be resized without quietly changing how hazy it looks.
            opticalThickness: { value: AtmosphereShaderMaterial.coefficientFor(
                options.verticalOpticalDepth ?? 0.3, airHeight) },

            scaleHeight: { value: scaleHeight },

            // How hard the atmosphere colour is pushed apart into per-channel coefficients. One
            // takes the colour as given; higher exaggerates the wavelength dependence, deepening
            // the sky and reddening the terminator.
            scatteringPower: { value: options.scatteringPower ?? 2.0 },

            // Haze from droplets and dust, which scatters far more sharply forward than air does
            // and is what brightens a body's edge when it sits nearly in front of its star.
            mieStrength: { value: options.mieStrength ?? 0.08 },

            // How forward that haze throws the light, from zero for no preference to just under one
            // for a narrow beam.
            mieDirection: { value: options.mieDirection ?? 0.76 }
        };

        super({
            ...options,
            supportsShadows: false, // Atmospheres don't need shadow calculations
            additionalUniforms: atmosphereSpecificUniforms,
            materialOptions: {
                vertexShader,
                fragmentShader,
                transparent: true,

                // Air adds its own light and hides what is behind it, and here those are the same
                // quantity: a channel scattering strongly enough to send most of the sunlight back
                // is by that fact one the ground cannot be seen through. So the shell composites as
                // scattered + behind * (1 - scattered), channel by channel, which is what
                // OneMinusSrcColor buys - additive where the air is faint, replacing what it covers
                // where the air is deep, and never over one above a background that is not. Adding
                // only the first half is what blew out the sub-solar point of the thickest
                // atmospheres: Uranus reached 1.01 there against a bloom threshold of 1, having laid
                // a veil worth 0.35 over a surface already at 0.66.
                blending: THREE.CustomBlending,
                blendSrc: THREE.OneFactor,
                blendDst: THREE.OneMinusSrcColorFactor,
                blendSrcAlpha: THREE.OneFactor,
                blendDstAlpha: THREE.OneMinusSrcAlphaFactor,

                // Both faces are drawn and the shader keeps the one facing the camera, so the shell
                // survives the camera crossing into it.
                side: THREE.DoubleSide,

                // Still tested against the depth buffer, so a nearer body occludes the air, but it
                // writes no depth of its own.
                depthWrite: false,

                toneMapped: false,
                ...options.materialOptions
            }
        });

        // Store references for easy access
        this.atmosphereColor = this.uniforms.atmosphereColor;
        this.opticalThickness = this.uniforms.opticalThickness;
        this.airHeight = airHeight;
    }

    /**
     * Turn an optical depth measured straight down into the per-shell-radius coefficient the shader
     * integrates with. A shell holding no air at all takes no light out of anything.
     *
     * @param {number} verticalOpticalDepth - Depth of air looking down, in the strongest channel
     * @param {number} airHeight - Height that air occupies, as a fraction of the shell's radius
     * @returns {number} Coefficient for the transmittance exponent
     */
    static coefficientFor(verticalOpticalDepth, airHeight) {
        return airHeight > 0 ? verticalOpticalDepth / airHeight : 0;
    }

    /**
     * Set atmosphere color
     * @param {number|THREE.Color} color - The atmosphere color
     */
    setAtmosphereColor(color) {
        if (typeof color === 'number') {
            this.atmosphereColor.value.setHex(color);
        } else {
            this.atmosphereColor.value.copy(color);
        }
    }

    /**
     * Set how much air the shell holds, which is what makes one atmosphere read as thicker than
     * another - it brightens the limb, reddens the terminator and deepens the colour together,
     * rather than scaling the result the way a plain brightness would.
     *
     * @param {number} verticalOpticalDepth - Depth of air looking straight down, in the channel that
     *     scatters hardest: a few hundredths for a trace atmosphere, a few for one you cannot see
     *     the ground through
     */
    setVerticalOpticalDepth(verticalOpticalDepth) {
        this.opticalThickness.value =
            AtmosphereShaderMaterial.coefficientFor(verticalOpticalDepth, this.airHeight);
    }

    // Inherited methods: updateLighting(), setLightColor()

    /**
     * Dispose of the material and its resources
     */
    dispose() {
        super.dispose();
    }
}

export default AtmosphereShaderMaterial;
