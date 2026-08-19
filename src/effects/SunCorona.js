import * as THREE from 'three';
import { log } from '../utils/Logger.js';

/**
 * The glowing shell of hot gas around a star.
 *
 * A sphere considerably larger than the star, drawn from the inside with additive blending,
 * so what is seen is the far wall of the shell glowing through. Density comes from animated
 * fractal noise, giving the streamers a real corona has, and a Fresnel term fades the shell
 * out where it faces the viewer directly — otherwise the star would be seen through a flat
 * disc of haze rather than a shell around it.
 *
 * Does not extend {@link SunEffect}: this one predates that base class and carries its own
 * shaders inline rather than going through {@link ShaderLoader}.
 */
class SunCorona {
    /**
     * Builds the corona and its mesh.
     *
     * @param {Object} [options={}] - Corona options.
     * @param {number} [options.sunRadius=1.0] - The star's radius in scene units.
     * @param {number} [options.coronaRadius] - Shell radius; defaults to 2.5 times the
     *   star's.
     * @param {number|THREE.Color} [options.coronaColor=0xffaa00] - Colour of the glow.
     * @param {number} [options.coronaIntensity=0.8] - How bright and opaque the shell is.
     * @param {number} [options.noiseScale=3.0] - Size of the streamer structure; larger
     *   means finer detail.
     * @param {number} [options.animationSpeed=0.001] - How fast the streamers drift.
     * @param {number} [options.fresnelPower=2.0] - How sharply the shell fades where it
     *   faces the viewer.
     * @param {boolean} [options.lowres=false] - Halve the sphere's tessellation.
     */
    constructor(options = {}) {
        this.sunRadius = options.sunRadius || 1.0;
        this.coronaRadius = options.coronaRadius || (this.sunRadius * 2.5);
        this.coronaColor = new THREE.Color(options.coronaColor || 0xffaa00);
        this.coronaIntensity = options.coronaIntensity || 0.8;
        this.noiseScale = options.noiseScale || 3.0;
        this.animationSpeed = options.animationSpeed || 0.001;
        this.fresnelPower = options.fresnelPower || 2.0;
        this.lowres = options.lowres || false;

        this.mesh = this.createCoronaMesh();

        this.time = 0;

    }

    /**
     * Builds the shell mesh.
     *
     * The render order is raised so the corona is drawn after the star's surface. It writes
     * no depth, so without that it could be drawn first and then blended against whatever
     * happened to be behind it rather than against the star.
     *
     * @returns {THREE.Mesh} The corona mesh.
     */
    createCoronaMesh() {
        const geometry = new THREE.SphereGeometry(
            this.coronaRadius,
            this.lowres ? 32 : 64,
            this.lowres ? 16 : 32
        );

        const material = this.createCoronaMaterial();

        const mesh = new THREE.Mesh(geometry, material);

        mesh.renderOrder = 1;

        return mesh;
    }

    /**
     * Builds the corona's shader material.
     *
     * `BackSide` is the point of the whole effect: the shell's front faces are culled, so
     * every pixel shows the inside of the far wall, which is what gives depth to the glow
     * rather than a flat ring. `depthWrite` is off so the shell does not occlude the star
     * inside it, but depth testing stays on so a planet in front of the star still hides it.
     *
     * The noise position is taken from object space, so the streamers are fixed to the
     * corona and turn with it instead of sliding across the screen as the camera moves.
     *
     * The noise is three octaves of value noise, mixed with a second two-octave field that
     * drifts faster along one axis; that second field is what reads as outward flow. Alpha
     * is capped below 1 so the corona never becomes fully opaque, since a solid shell would
     * hide the star's surface.
     *
     * @returns {THREE.ShaderMaterial} The corona material.
     */
    createCoronaMaterial() {
        const vertexShader = `
            varying vec3 vNormal;
            varying vec3 vViewPosition;
            varying vec3 vNoisePosition;

            void main() {
                vNormal = normalize(normalMatrix * normal);
                vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                vViewPosition = -mvPosition.xyz;

                vNoisePosition = position;

                gl_Position = projectionMatrix * mvPosition;
            }
        `;

        const fragmentShader = `
            uniform float uTime;
            uniform vec3 uCoronaColor;
            uniform float uCoronaIntensity;
            uniform float uNoiseScale;
            uniform float uAnimationSpeed;
            uniform float uFresnelPower;

            varying vec3 vNormal;
            varying vec3 vViewPosition;
            varying vec3 vNoisePosition;

            float random(vec3 st) {
                return fract(sin(dot(st, vec3(12.9898, 78.233, 23.112))) * 12943.145);
            }

            float noise(vec3 pos) {
                vec3 i = floor(pos);
                vec3 f = fract(pos);
                f = f * f * (3.0 - 2.0 * f);

                return mix(
                    mix(mix(random(i), random(i + vec3(1.0, 0.0, 0.0)), f.x),
                        mix(random(i + vec3(0.0, 1.0, 0.0)), random(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
                    mix(mix(random(i + vec3(0.0, 0.0, 1.0)), random(i + vec3(1.0, 0.0, 1.0)), f.x),
                        mix(random(i + vec3(0.0, 1.0, 1.0)), random(i + vec3(1.0, 1.0, 1.0)), f.x), f.y), f.z);
            }

            float fractalNoise(vec3 pos, int octaves) {
                float value = 0.0;
                float amplitude = 0.5;
                float frequency = 1.0;

                for (int i = 0; i < 4; i++) {
                    if (i >= octaves) break;
                    value += noise(pos * frequency) * amplitude;
                    frequency *= 2.0;
                    amplitude *= 0.5;
                }

                return value;
            }

            void main() {
                vec3 viewDirection = normalize(vViewPosition);
                float fresnel = abs(dot(vNormal, viewDirection));

                float centerToEdgeFade = pow(fresnel, uFresnelPower);

                vec3 noisePos = vNoisePosition * uNoiseScale + uTime * uAnimationSpeed;

                float coronaDensity = fractalNoise(noisePos, 3);

                float streamFlow = fractalNoise(vNoisePosition * uNoiseScale * 0.5 + vec3(uTime * uAnimationSpeed * 2.0, 0.0, 0.0), 2);
                coronaDensity = mix(coronaDensity, streamFlow, 0.3);

                float finalAlpha = centerToEdgeFade * (0.4 + coronaDensity * 0.6) * uCoronaIntensity;

                finalAlpha = clamp(finalAlpha, 0.0, 0.9);

                vec3 finalColor = uCoronaColor;

                float colorVariation = fractalNoise(vNoisePosition * uNoiseScale * 2.0, 2);
                finalColor = mix(finalColor, finalColor * 1.3, colorVariation * 0.2);

                gl_FragColor = vec4(finalColor, finalAlpha);
            }
        `;

        return new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0.0 },
                uCoronaColor: { value: this.coronaColor.clone() },
                uCoronaIntensity: { value: this.coronaIntensity },
                uNoiseScale: { value: this.noiseScale },
                uAnimationSpeed: { value: this.animationSpeed },
                uFresnelPower: { value: this.fresnelPower }
            },
            vertexShader,
            fragmentShader,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            depthTest: true,
            side: THREE.BackSide
        });
    }

    /**
     * Advances the streamer animation.
     *
     * @param {number} deltaTime - Time since the last frame, in scaled seconds.
     * @returns {void}
     */
    update(deltaTime) {
        this.time += deltaTime;

        if (this.mesh.material.uniforms) {
            this.mesh.material.uniforms.uTime.value = this.time;
        }
    }

    /**
     * Moves the shell, relative to whatever it is parented to.
     *
     * @param {THREE.Vector3} position - The new position.
     * @returns {void}
     */
    setPosition(position) {
        this.mesh.position.copy(position);
    }

    /**
     * Parents the shell to another object.
     *
     * @param {THREE.Object3D} parent - Object to add the mesh to.
     * @returns {void}
     */
    addToScene(parent) {
        parent.add(this.mesh);
        log.info('SunCorona', '🌟 SunCorona added to scene');
    }

    /**
     * Unparents the shell.
     *
     * @param {THREE.Object3D} parent - Object to remove the mesh from.
     * @returns {void}
     */
    removeFromScene(parent) {
        parent.remove(this.mesh);
    }

    /**
     * The corona's mesh.
     *
     * @returns {THREE.Mesh} The mesh.
     */
    getMesh() {
        return this.mesh;
    }

    /**
     * Releases the shell's geometry and material.
     *
     * @returns {void}
     */
    dispose() {
        if (this.mesh.geometry) {
            this.mesh.geometry.dispose();
        }
        if (this.mesh.material) {
            this.mesh.material.dispose();
        }

        log.info('SunCorona', '🌟 SunCorona disposed');
    }
}

export default SunCorona;