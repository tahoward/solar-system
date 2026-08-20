import * as THREE from 'three';
import SunEffect from './SunEffect.js';
import MathUtils from '../utils/MathUtils.js';
import { getAUScale } from '../physics/kepler.js';

/**
 * The core brightness of a star of one solar luminosity seen from one AU.
 *
 * The anchor for the whole brightness response: the Sun from Earth comes out at exactly this,
 * and every other star and distance is placed relative to it.
 *
 * @type {number}
 */
const SOLAR_CORE_INTENSITY = 50.0;

/**
 * How much core brightness one magnitude of apparent flux is worth.
 *
 * Flux spans an absurd range — a hot giant seen close up against a red dwarf across the
 * system is a factor of billions — so brightness is driven by the logarithm of it rather than
 * the flux itself. That is what a magnitude is, and it is also roughly how the eye responds,
 * which is why a compressed scale still reads as "much brighter" rather than as clipping.
 *
 * @type {number}
 */
const INTENSITY_PER_MAGNITUDE = 4.0;

/**
 * Bounds on the core brightness, whatever the flux works out to.
 *
 * The floor keeps a very distant star as a faint point rather than nothing at all; the ceiling
 * stops a near or enormous star from filling the frame with white through the bloom pass.
 *
 * @type {number}
 */
const MIN_CORE_INTENSITY = 8.0;
const MAX_CORE_INTENSITY = 150.0;

/**
 * The star's disc, in multiples of the glare's core radius, over which the glare fades out.
 *
 * The glare is a point-spread function: it is what a source too small to resolve looks like
 * after the eye or the lens has smeared it out. Over a disc that is plainly a disc it is
 * nonsense, and worse than nonsense — an additive blob sitting in the middle of the star,
 * which is exactly what it looked like.
 *
 * The core is what has to go, so the core is what the handover is measured against. While the
 * disc is smaller than the core the core swamps it and the star simply reads as blown out,
 * which is right and is how the Sun looks from Earth. Once the disc is several times the core
 * the core is a hard dot sitting on a surface, which is the artefact. So the fade runs between
 * those two, and it runs in multiples of the core's own radius rather than of the quad, so
 * changing the core's size moves the handover with it.
 *
 * A ratio rather than a distance, so it happens at the same apparent size for a red dwarf and
 * for a supergiant. The depth buffer cannot be left to hide the glare behind the disc instead:
 * the near plane is a hundred-thousandth of a scene unit against a far plane of 1200, so the
 * buffer's resolution at a distance z is around z² ⁄ 170 scene units — coarser than a star's
 * whole radius at any distance a star is actually looked at from.
 *
 * @type {number}
 */
const DISC_FADE_START_CORE_RADII = 1.5;
const DISC_FADE_END_CORE_RADII = 3.6;

/**
 * The power the disc fade is raised to before it reaches the core's brightness.
 *
 * A core at fifty times white does not perceptibly dim on a linear ramp: at half opacity it is
 * still twenty-five times over the bloom threshold, so it is still a saturated white blob with
 * a halo of bloom around it, and it only actually disappears in the last few per cent of the
 * ramp. Brightness has to come down with it, steeply, for the fade to mean anything on screen —
 * which is the same reason the flux response works in magnitudes.
 *
 * @type {number}
 */
const CORE_FADE_EXPONENT = 3.0;

/**
 * The camera-facing flare that stands in for a star at a distance.
 *
 * Once a star is far enough away its disc is smaller than a pixel, and a rendered sphere
 * either disappears or flickers. What the eye actually sees looking at a bright point source
 * is not a disc at all but a halo with spikes through it — the diffraction pattern of the eye
 * or the lens — and that is what this draws: a flat quad turned to face the camera, with a
 * soft halo, a bright core and four tapering spikes, all in the fragment shader rather than
 * from a texture, so it stays sharp at any size.
 *
 * The quad holds a constant size on screen, which is the point of it. A point spread is a
 * property of the instrument looking at the star, not of the star, so it does not grow or
 * shrink as the camera moves: what changes with distance is how bright it is, from the
 * apparent flux, and whether it is drawn at all, from how large the star's disc has become.
 *
 * Orientation and placement are not done here: {@link Body#update} parents the quad to the
 * scene root, moves it to the star, turns it to face the camera and works out whether
 * anything is in front of it.
 */
class SunGlare extends SunEffect {
    /**
     * Builds the glare and its billboard.
     *
     * @param {Object} [options={}] - Glare options.
     * @param {number} [options.sunRadius=1.0] - The star's radius in scene units, which the
     *   disc fade is measured against.
     * @param {number} [options.screenFraction=0.05] - The glare's size on screen, as a
     *   fraction of the viewport's height.
     * @param {number} [options.luminosity=1.0] - The star's luminosity in solar units, which
     *   sets how bright the glare is for a given distance.
     * @param {number} [options.opacity=1.0] - Overall opacity.
     * @param {number|THREE.Color} [options.color=0xffaa00] - The star's colour.
     * @param {number} [options.emissiveIntensity] - Core brightness, pinning it and bypassing
     *   the flux response entirely.
     * @param {number} [options.glowIntensity=1.35] - Halo brightness.
     * @param {number} [options.haloRadius=0.5] - Halo extent, as a fraction of the quad.
     * @param {number} [options.haloFalloff=3.0] - How sharply the halo fades outwards.
     * @param {number} [options.haloStrength=0.55] - Halo opacity.
     * @param {number} [options.coreWhiteness=0.8] - How far the core is pushed towards white;
     *   a bright enough source saturates to white whatever its actual colour.
     * @param {number} [options.coreRadius=0.05] - Core size, as a fraction of the quad.
     * @param {number} [options.spikeLength=0.65] - Spike length, as a fraction of the quad.
     * @param {number} [options.spikeWidth=0.02] - Spike width at its base, likewise.
     * @param {number} [options.twinkleSpeed=1.5] - How fast the spikes flicker.
     * @param {number} [options.twinkleIntensity=0.12] - How pronounced the flicker is.
     */
    constructor(options = {}) {
        super({
            sunRadius: options.sunRadius || 1.0,
            lowres: options.lowres || false,
            effectName: '✨ SunGlare'
        });

        this.screenFraction = options.screenFraction || 0.05;
        this.luminosity = options.luminosity || 1.0;
        this.glareOpacity = options.opacity || 1.0;
        this.glareColor = options.color || 0xffaa00;

        this.emissiveIntensity = options.emissiveIntensity;
        this.glowIntensity = options.glowIntensity || 1.35;
        this.haloRadius = options.haloRadius || 0.5;
        this.haloFalloff = options.haloFalloff || 3.0;
        this.haloStrength = options.haloStrength || 0.55;
        this.coreWhiteness = options.coreWhiteness !== undefined ? options.coreWhiteness : 0.8;

        this.coreRadius = options.coreRadius || 0.05;
        this.spikeLength = options.spikeLength || 0.65;
        this.spikeWidth = options.spikeWidth || 0.02;

        this.twinkleSpeed = options.twinkleSpeed || 1.5;
        this.twinkleIntensity = options.twinkleIntensity || 0.12;

        this.mesh = this.createGlareBillboard();
    }

    /**
     * Builds the quad and its shader.
     *
     * The geometry is a unit quad, scaled every frame to whatever world size holds the
     * configured fraction of the screen. The shader therefore works in nothing but the quad's
     * own UVs, offset so the centre is the origin, and every size in it is a fraction of the
     * quad — which means a fraction of the screen too, so the pattern is identical at every
     * distance.
     *
     * Three things are composited by taking the maximum of their alphas — a radial halo, a
     * small bright core, and two crossed spikes — rather than by adding them, so the overlap
     * in the middle does not blow out.
     *
     * The spikes are tapering triangles rather than lines, with the fade along their length
     * raised to a power so they come to a point. Their brightness is modulated by two sine
     * waves at unrelated frequencies, which gives an irregular twinkle instead of an obvious
     * pulse, and the horizontal and vertical spikes are offset in phase so they do not flicker
     * together.
     *
     * The colour is the halo plus a core term squared, which concentrates the white saturation
     * tightly in the middle.
     *
     * Three material choices matter. Additive blending, so the glare adds light rather than
     * masking what is behind it. Frustum culling off, because the mesh is repositioned every
     * frame from outside and Three.js would otherwise cull it against a stale bounding sphere.
     * And a very high render order with both depth writing and depth testing off, so the glare
     * draws last over everything: at the star's centre the quad is coplanar with the star's own
     * silhouette, so a depth test there is a tie that floating-point noise settles differently
     * from frame to frame, which is a flicker rather than an occlusion. Whether something is in
     * front of the star is decided on the CPU instead, by {@link Body#update}.
     *
     * @returns {THREE.Mesh} The billboard mesh.
     */
    createGlareBillboard() {
        const geometry = new THREE.PlaneGeometry(1, 1);

        const material = new THREE.ShaderMaterial({
            transparent: true,
            depthWrite: false,
            depthTest: false,
            blending: THREE.AdditiveBlending,
            side: THREE.DoubleSide,
            uniforms: {
                uTime: { value: 0.0 },
                uEmissiveColor: { value: new THREE.Color(this.glareColor) },
                uOpacity: { value: this.glareOpacity },
                uCoreIntensity: { value: this.emissiveIntensity ?? SOLAR_CORE_INTENSITY },
                uCoreWhiteness: { value: this.coreWhiteness },
                uGlowIntensity: { value: this.glowIntensity },
                uHaloRadius: { value: this.haloRadius },
                uHaloFalloff: { value: this.haloFalloff },
                uHaloStrength: { value: this.haloStrength },
                uSpikeLength: { value: this.spikeLength },
                uSpikeWidth: { value: this.spikeWidth },
                uCenterRadius: { value: this.coreRadius },
                uTwinkleIntensity: { value: this.twinkleIntensity },
                uTwinkleSpeed: { value: this.twinkleSpeed }
            },
            vertexShader: `
                varying vec2 vUv;

                void main() {
                    vUv = uv;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                uniform float uTime;
                uniform vec3 uEmissiveColor;
                uniform float uOpacity;
                uniform float uCoreIntensity;
                uniform float uCoreWhiteness;
                uniform float uGlowIntensity;
                uniform float uHaloRadius;
                uniform float uHaloFalloff;
                uniform float uHaloStrength;
                uniform float uSpikeLength;
                uniform float uSpikeWidth;
                uniform float uCenterRadius;
                uniform float uTwinkleIntensity;
                uniform float uTwinkleSpeed;

                varying vec2 vUv;

                void main() {
                    vec2 center = vUv - 0.5;
                    float dist = length(center);

                    float haloFade = max(0.0, 1.0 - dist / uHaloRadius);
                    float halo = pow(haloFade, uHaloFalloff) * uHaloStrength;

                    float core = smoothstep(uCenterRadius * 1.2, 0.0, dist);

                    float alpha = max(halo, core);

                    vec2 absCenter = abs(center);

                    float twinklePhase = uTime * uTwinkleSpeed;

                    float horizontalTwinkle = 1.0 + sin(twinklePhase) * uTwinkleIntensity +
                                             sin(twinklePhase * 1.7 + 2.1) * uTwinkleIntensity * 0.5;

                    float verticalTwinkle = 1.0 + sin(twinklePhase + 1.57079632679) * uTwinkleIntensity +
                                           sin(twinklePhase * 1.3 + 3.8) * uTwinkleIntensity * 0.6;

                    if (absCenter.y <= uSpikeWidth && absCenter.x <= uSpikeLength) {
                        float spikeProgress = absCenter.x / uSpikeLength;

                        float triangleWidth = uSpikeWidth * (1.0 - spikeProgress);

                        if (absCenter.y <= triangleWidth) {
                            float lengthFade = pow(1.0 - spikeProgress, 2.0);
                            float widthFade = pow(1.0 - (absCenter.y / triangleWidth), 0.3);

                            alpha = max(alpha, lengthFade * widthFade * horizontalTwinkle);
                        }
                    }

                    if (absCenter.x <= uSpikeWidth && absCenter.y <= uSpikeLength) {
                        float spikeProgress = absCenter.y / uSpikeLength;

                        float triangleWidth = uSpikeWidth * (1.0 - spikeProgress);

                        if (absCenter.x <= triangleWidth) {
                            float lengthFade = pow(1.0 - spikeProgress, 2.0);
                            float widthFade = pow(1.0 - (absCenter.x / triangleWidth), 0.3);

                            alpha = max(alpha, lengthFade * widthFade * verticalTwinkle);
                        }
                    }

                    alpha = clamp(alpha, 0.0, 1.0);

                    vec3 haloColor = uEmissiveColor * uGlowIntensity;
                    vec3 coreColor = mix(uEmissiveColor, vec3(1.0), uCoreWhiteness) * uCoreIntensity;
                    vec3 finalColor = haloColor + coreColor * core * core;

                    gl_FragColor = vec4(finalColor, alpha * uOpacity);
                }
            `
        });

        this.material = material;

        const mesh = new THREE.Mesh(geometry, material);
        mesh.frustumCulled = false;
        mesh.renderOrder = 9999;

        mesh.position.set(0, 0, 0);

        return mesh;
    }

    /**
     * Resizes and rebrightens the glare for this frame.
     *
     * The quad is scaled to hold a constant fraction of the viewport's height, worked out from
     * the camera's field of view and the distance to the star. Everything the shader draws is
     * a fraction of the quad, so the whole pattern is fixed on screen and none of it can
     * alias, whatever the star's size or distance.
     *
     * Brightness comes from the apparent flux — the star's luminosity over the square of its
     * distance in AU — compressed to magnitudes. The Sun from Earth is the unit of that, so it
     * lands on {@link SOLAR_CORE_INTENSITY} by construction, and a star ten times as far or a
     * hundred times as luminous is placed relative to it rather than tuned.
     *
     * The whole thing is then faded out as the star's disc outgrows the core, per
     * {@link DISC_FADE_START_CORE_RADII} — including the halo, which is as much of a blob over a
     * resolved star as the core is. The core additionally loses brightness rather than only
     * opacity, since at fifty times white it would otherwise still be saturated at half a fade.
     *
     * Does not position or orient the mesh, and does not work out the occlusion it is passed;
     * {@link Body#update} does both.
     *
     * @param {number} deltaTime - Time since the last frame, in scaled seconds.
     * @param {THREE.Camera} camera - Camera the frame is being drawn from.
     * @param {THREE.Vector3} [sunPosition] - The star's world position.
     * @param {number} [occlusion=1.0] - How much of the glare is unobstructed, 0 to 1.
     * @returns {void}
     */
    update(deltaTime, camera, sunPosition = new THREE.Vector3(0, 0, 0), occlusion = 1.0) {
        this.time += deltaTime;

        if (!this.mesh || !this.material || !this.material.uniforms) return;

        const distance = camera.position.distanceTo(sunPosition);
        if (!(distance > 0)) return;

        const viewportHeight = 2.0 * Math.tan(THREE.MathUtils.degToRad(camera.fov) * 0.5) * distance;
        const quadSize = this.screenFraction * viewportHeight;

        this.mesh.scale.setScalar(quadSize);

        const discRadius = this.sunRadius / quadSize;
        const { ratio: discRatio } = MathUtils.clampAndRatio(
            discRadius,
            this.coreRadius * DISC_FADE_START_CORE_RADII,
            this.coreRadius * DISC_FADE_END_CORE_RADII);

        const discFade = 1.0 - discRatio;

        this.material.uniforms.uTime.value = this.time;
        this.material.uniforms.uOpacity.value = this.glareOpacity * discFade * occlusion;
        this.material.uniforms.uCoreIntensity.value =
            this.#coreIntensity(distance) * Math.pow(discFade, CORE_FADE_EXPONENT);
        this.material.uniforms.uGlowIntensity.value = this.glowIntensity;
        this.material.uniforms.uTwinkleIntensity.value = this.twinkleIntensity;
        this.material.uniforms.uTwinkleSpeed.value = this.twinkleSpeed;
    }

    /**
     * How bright the core should be, given how much light is actually arriving.
     *
     * The flux is relative to the Sun at one AU, so its logarithm is the number of magnitudes
     * brighter than that familiar case — positive for brighter, which is the opposite sign to
     * an astronomical magnitude but reads the right way round here.
     *
     * A star whose brightness is pinned in the data skips all of this.
     *
     * @private
     * @param {number} distance - Camera's distance to the star, in scene units.
     * @returns {number} Core brightness, within
     *   {@link MIN_CORE_INTENSITY}–{@link MAX_CORE_INTENSITY}.
     */
    #coreIntensity(distance) {
        if (this.emissiveIntensity !== undefined) {
            return this.emissiveIntensity;
        }

        const distanceAU = distance / getAUScale();
        const relativeFlux = this.luminosity / (distanceAU * distanceAU);

        if (!(relativeFlux > 0)) {
            return MIN_CORE_INTENSITY;
        }

        const magnitudesBrighter = 2.5 * Math.log10(relativeFlux);

        return MathUtils.clamp(
            SOLAR_CORE_INTENSITY + INTENSITY_PER_MAGNITUDE * magnitudesBrighter,
            MIN_CORE_INTENSITY,
            MAX_CORE_INTENSITY);
    }

    /**
     * Pins the core's brightness, overriding the flux response.
     *
     * @param {number} intensity - Core brightness.
     * @returns {void}
     */
    setEmissiveIntensity(intensity) {
        this.emissiveIntensity = intensity;
        if (this.material && this.material.uniforms) {
            this.material.uniforms.uCoreIntensity.value = intensity;
        }
    }

    /**
     * Sets the halo's brightness.
     *
     * @param {number} intensity - Halo brightness.
     * @returns {void}
     */
    setGlowIntensity(intensity) {
        this.glowIntensity = intensity;
        if (this.material && this.material.uniforms) {
            this.material.uniforms.uGlowIntensity.value = intensity;
        }
    }

    /**
     * The core's current brightness.
     *
     * @returns {number} Core brightness, as last written to the shader.
     */
    getEmissiveIntensity() {
        return this.material?.uniforms?.uCoreIntensity.value ?? SOLAR_CORE_INTENSITY;
    }

    /**
     * The billboard mesh.
     *
     * @returns {THREE.Mesh} The mesh.
     */
    getMesh() {
        return this.mesh;
    }

    /**
     * Every mesh this effect owns.
     *
     * A list, so callers that position and orient the glare do not have to know it is
     * currently a single quad.
     *
     * @returns {THREE.Mesh[]} The effect's meshes.
     */
    getAllMeshes() {
        return [this.mesh].filter(mesh => mesh !== null);
    }

    /**
     * Parents the billboard to another object.
     *
     * In practice the scene root, since the glare must not inherit the star's rotation or
     * scale.
     *
     * @param {THREE.Object3D} parent - Object to add the mesh to.
     * @returns {void}
     */
    addToScene(parent) {
        if (this.mesh) {
            parent.add(this.mesh);
        }
    }

    /**
     * Unparents the billboard.
     *
     * @param {THREE.Object3D} parent - Object to remove the mesh from.
     * @returns {void}
     */
    removeFromScene(parent) {
        if (this.mesh) {
            parent.remove(this.mesh);
        }
    }

    /**
     * Releases the billboard's geometry and material.
     *
     * @returns {void}
     */
    dispose() {
        if (this.mesh) {
            if (this.mesh.geometry) this.mesh.geometry.dispose();
            if (this.material) {
                if (this.material.map) this.material.map.dispose();
                this.material.dispose();
            }
        }
    }
}

export default SunGlare;
