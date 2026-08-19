import * as THREE from 'three';
import SunEffect from './SunEffect.js';
import MathUtils from '../utils/MathUtils.js';

/**
 * The camera-facing flare that stands in for a star at a distance.
 *
 * Once a star is far enough away its disc is smaller than a pixel, and a rendered sphere
 * either disappears or flickers. What the eye actually sees looking at a bright point
 * source is not a disc at all but a halo with spikes through it — the diffraction pattern
 * of the eye or the lens — and that is what this draws: a flat quad turned to face the
 * camera, with a soft halo, a bright core and four tapering spikes, all in the fragment
 * shader rather than from a texture, so it stays sharp at any size.
 *
 * Everything scales with distance. Further away the spikes lengthen and sharpen, the core
 * brightens, and the whole quad grows, which is what keeps a distant star readable instead
 * of letting it shrink into nothing.
 *
 * Positioning and orientation are not done here: {@link Body#update} parents the quad to
 * the scene root, moves it to the star and turns it to face the camera.
 */
class SunGlare extends SunEffect {
    /**
     * Builds the glare and its billboard.
     *
     * @param {Object} [options={}] - Glare options.
     * @param {number} [options.sunRadius=1.0] - The star's radius in scene units; the quad
     *   is sized relative to it.
     * @param {number} [options.size=5.0] - Quad size as a multiple of the star's radius.
     * @param {number} [options.opacity=1.0] - Overall opacity.
     * @param {number|THREE.Color} [options.color=0xffaa00] - The star's colour.
     * @param {number} [options.emissiveIntensity=25.0] - Core brightness. High, because the
     *   core has to bloom.
     * @param {number} [options.glowIntensity=1.35] - Halo brightness.
     * @param {number} [options.haloRadius=0.5] - Halo extent, as a fraction of the quad.
     * @param {number} [options.haloFalloff=3.0] - How sharply the halo fades outwards.
     * @param {number} [options.haloStrength=0.55] - Halo opacity.
     * @param {number} [options.coreWhiteness=0.8] - How far the core is pushed towards
     *   white; a bright enough source saturates to white whatever its actual colour.
     * @param {boolean} [options.scaleWithDistance=true] - Grow the quad with distance.
     * @param {number} [options.minScaleDistance=0.5] - Distance at which scaling starts.
     * @param {number} [options.maxScaleDistance=10.0] - Distance at which scaling tops out.
     * @param {number} [options.minScale=0.1] - Scale at the near end.
     * @param {number} [options.maxScale=1.0] - Scale at the far end.
     * @param {boolean} [options.scaleCenterWithDistance=true] - Also grow the core, not just
     *   the quad.
     * @param {number} [options.centerBaseSize=0.01] - Core size.
     * @param {number} [options.centerFadeSize=0.03] - Core fade extent.
     * @param {number} [options.twinkleSpeed=1.5] - How fast the spikes flicker.
     * @param {number} [options.twinkleIntensity=0.12] - How pronounced the flicker is.
     */
    constructor(options = {}) {
        super({
            sunRadius: options.sunRadius || 1.0,
            lowres: options.lowres || false,
            effectName: '✨ SunGlare'
        });

        this.glareSize = options.size || 5.0;
        this.glareOpacity = options.opacity || 1.0;
        this.glareColor = options.color || 0xffaa00;

        this.emissiveIntensity = options.emissiveIntensity || 25.0;
        this.glowIntensity = options.glowIntensity || 1.35;
        this.haloRadius = options.haloRadius || 0.5;
        this.haloFalloff = options.haloFalloff || 3.0;
        this.haloStrength = options.haloStrength || 0.55;
        this.coreWhiteness = options.coreWhiteness !== undefined ? options.coreWhiteness : 0.8;

        this.scaleWithDistance = options.scaleWithDistance !== undefined ? options.scaleWithDistance : true;
        this.minScaleDistance = options.minScaleDistance || 0.5;
        this.maxScaleDistance = options.maxScaleDistance || 10.0;
        this.minScale = options.minScale || 0.1;
        this.maxScale = options.maxScale || 1.0;

        this.scaleCenterWithDistance = options.scaleCenterWithDistance !== undefined ? options.scaleCenterWithDistance : true;
        this.centerBaseSize = options.centerBaseSize || 0.01;
        this.centerFadeSize = options.centerFadeSize || 0.03;

        this.twinkleSpeed = options.twinkleSpeed || 1.5;
        this.twinkleIntensity = options.twinkleIntensity || 0.12;

        this.mesh = this.createGlareBillboard();


    }

    /**
     * Works out the spike geometry for a given distance.
     *
     * Further away the spikes get longer and thinner and the core smaller, which is how a
     * point source actually behaves: the dimmer it is, the more it reads as a cross of light
     * with nothing in the middle rather than as a blob.
     *
     * @param {number} distance - Camera's distance to the star, in scene units.
     * @returns {{spikeLength: number, spikeWidth: number, centerRadius: number}} Spike
     *   length and width, and core radius, all as fractions of the quad.
     */
    createSpikeParameters(distance) {
        let spikeLength = 0.65;
        let spikeWidth = 0.02;
        let centerRadius = 0.05;

        if (distance > this.maxScaleDistance) {
            spikeLength = 0.75;
            spikeWidth = 0.025;
            centerRadius = 0.04;
        } else if (distance > this.minScaleDistance) {
            const { ratio } = MathUtils.clampAndRatio(distance, this.minScaleDistance, this.maxScaleDistance);
            spikeLength = MathUtils.lerp(0.55, 0.7, ratio);
            spikeWidth = MathUtils.lerp(0.015, 0.025, ratio);
            centerRadius = MathUtils.lerp(0.06, 0.04, ratio);
        }

        return { spikeLength, spikeWidth, centerRadius };
    }

    /**
     * Builds the quad and its shader.
     *
     * The shader works in the quad's own UVs, offset so the centre is the origin. Three
     * things are composited by taking the maximum of their alphas — a radial halo, a small
     * bright core, and two crossed spikes — rather than by adding them, so the overlap in
     * the middle does not blow out.
     *
     * The spikes are tapering triangles rather than lines, with the fade along their length
     * raised to a power so they come to a point. Their brightness is modulated by two sine
     * waves at unrelated frequencies, which gives an irregular twinkle instead of an
     * obvious pulse, and the horizontal and vertical spikes are offset in phase so they do
     * not flicker together.
     *
     * The colour is the halo plus a core term squared, which concentrates the white
     * saturation tightly in the middle.
     *
     * Three material choices matter. Additive blending, so the glare adds light rather than
     * masking what is behind it. Frustum culling off, because the mesh is repositioned every
     * frame from outside and Three.js would otherwise cull it against a stale bounding
     * sphere. And a very high render order with `depthWrite` off, so the glare draws last
     * over everything — but with depth testing still on, so a planet passing in front of the
     * star does occlude it.
     *
     * @returns {THREE.Mesh} The billboard mesh.
     */
    createGlareBillboard() {
        const size = this.sunRadius * this.glareSize;
        const geometry = new THREE.PlaneGeometry(size, size);

        const material = new THREE.ShaderMaterial({
            transparent: true,
            depthWrite: false,
            depthTest: true,
            blending: THREE.AdditiveBlending,
            side: THREE.DoubleSide,
            uniforms: {
                uTime: { value: 0.0 },
                uEmissiveColor: { value: new THREE.Color(this.glareColor) },
                uOpacity: { value: this.glareOpacity },
                uCoreIntensity: { value: this.emissiveIntensity },
                uCoreWhiteness: { value: this.coreWhiteness },
                uGlowIntensity: { value: this.glowIntensity },
                uHaloRadius: { value: this.haloRadius },
                uHaloFalloff: { value: this.haloFalloff },
                uHaloStrength: { value: this.haloStrength },
                uSpikeLength: { value: 0.65 },
                uSpikeWidth: { value: 0.02 },
                uCenterRadius: { value: 0.05 },
                uCenterScale: { value: 1.0 },
                uTwinkleIntensity: { value: this.twinkleIntensity },
                uTwinkleSpeed: { value: this.twinkleSpeed },
                uDistanceFactor: { value: 1.0 }
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
                uniform float uCenterScale;
                uniform float uTwinkleIntensity;
                uniform float uTwinkleSpeed;
                uniform float uDistanceFactor;

                varying vec2 vUv;

                void main() {
                    vec2 center = vUv - 0.5;
                    float dist = length(center);

                    float haloFade = max(0.0, 1.0 - dist / uHaloRadius);
                    float halo = pow(haloFade, uHaloFalloff) * uHaloStrength;

                    float coreRadius = uCenterRadius * uCenterScale;
                    float core = smoothstep(coreRadius * 1.2, 0.0, dist);

                    float alpha = max(halo, core);

                    vec2 absCenter = abs(center);

                    float twinklePhase = uTime * uTwinkleSpeed;

                    float horizontalTwinkle = 1.0 + sin(twinklePhase) * uTwinkleIntensity +
                                             sin(twinklePhase * 1.7 + 2.1) * uTwinkleIntensity * 0.5;

                    float verticalTwinkle = 1.0 + sin(twinklePhase + 1.57079632679) * uTwinkleIntensity +
                                           sin(twinklePhase * 1.3 + 3.8) * uTwinkleIntensity * 0.6;

                    float adjustedSpikeLength = uSpikeLength * uDistanceFactor;
                    float adjustedSpikeWidth = uSpikeWidth * uCenterScale;

                    float pointinessFactor = 1.0 + (uDistanceFactor - 1.0) * 0.8;

                    if (absCenter.y <= adjustedSpikeWidth && absCenter.x <= adjustedSpikeLength) {
                        float spikeProgress = absCenter.x / adjustedSpikeLength;

                        float triangleWidth = adjustedSpikeWidth * (1.0 - spikeProgress);

                        if (absCenter.y <= triangleWidth) {
                            float lengthFade = 1.0 - spikeProgress;
                            float widthFade = 1.0 - (absCenter.y / triangleWidth);

                            lengthFade = pow(lengthFade, 2.0 * pointinessFactor);
                            widthFade = pow(widthFade, 0.3);

                            float horizontalAlpha = lengthFade * widthFade * horizontalTwinkle;
                            alpha = max(alpha, horizontalAlpha);
                        }
                    }

                    if (absCenter.x <= adjustedSpikeWidth && absCenter.y <= adjustedSpikeLength) {
                        float spikeProgress = absCenter.y / adjustedSpikeLength;

                        float triangleWidth = adjustedSpikeWidth * (1.0 - spikeProgress);

                        if (absCenter.x <= triangleWidth) {
                            float lengthFade = 1.0 - spikeProgress;
                            float widthFade = 1.0 - (absCenter.x / triangleWidth);

                            lengthFade = pow(lengthFade, 2.0 * pointinessFactor);
                            widthFade = pow(widthFade, 0.3);

                            float verticalAlpha = lengthFade * widthFade * verticalTwinkle;
                            alpha = max(alpha, verticalAlpha);
                        }
                    }

                    if (absCenter.x <= adjustedSpikeWidth && absCenter.y <= adjustedSpikeWidth) {
                        alpha = max(alpha, 0.8);
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
     * Rescales and rebrightens the glare for this frame's viewing distance.
     *
     * Three separate distance responses, which is what makes a star hold its presence
     * across the whole range: the quad grows, the spikes lengthen and sharpen, and past the
     * far scaling distance the core is brightened further still. Without that last boost a
     * genuinely distant star fades out of the frame entirely, because the quad's own growth
     * cannot keep up with how few pixels it covers.
     *
     * Does not orient or position the mesh; {@link Body#update} does that.
     *
     * @param {number} deltaTime - Time since the last frame, in scaled seconds.
     * @param {THREE.Camera} camera - Camera the frame is being drawn from.
     * @param {THREE.Vector3} [sunPosition] - The star's world position.
     * @returns {void}
     */
    update(deltaTime, camera, sunPosition = new THREE.Vector3(0, 0, 0)) {
        this.time += deltaTime;

        if (!this.mesh || !this.mesh.material) return;

        const distance = camera.position.distanceTo(sunPosition);

        let centerScale = 1.0;

        if (this.scaleCenterWithDistance && this.scaleWithDistance) {
            const { ratio: distanceRatio } = MathUtils.clampAndRatio(distance, this.minScaleDistance, this.maxScaleDistance);
            centerScale = MathUtils.lerp(this.minScale, this.maxScale, distanceRatio);
        }

        const spikeParams = this.createSpikeParameters(distance);

        let distanceFactor = 1.0;
        let emissiveBoost = 1.0;

        if (distance > this.minScaleDistance) {
            const { ratio: distanceRatio } = MathUtils.clampAndRatio(distance, this.minScaleDistance, this.maxScaleDistance * 2);
            distanceFactor = MathUtils.lerp(1.0, 1.8, distanceRatio);

            if (distance > this.maxScaleDistance) {
                const extremeDistanceRatio = Math.min((distance - this.maxScaleDistance) / this.maxScaleDistance, 2.0);
                emissiveBoost = 1.0 + extremeDistanceRatio * 1.5;
            }
        }

        if (this.material.uniforms) {
            this.material.uniforms.uTime.value = this.time;
            this.material.uniforms.uCenterScale.value = centerScale;
            this.material.uniforms.uOpacity.value = this.glareOpacity;
            this.material.uniforms.uCoreIntensity.value = this.emissiveIntensity * emissiveBoost;
            this.material.uniforms.uGlowIntensity.value = this.glowIntensity;
            this.material.uniforms.uDistanceFactor.value = distanceFactor;
            this.material.uniforms.uTwinkleIntensity.value = this.twinkleIntensity;
            this.material.uniforms.uTwinkleSpeed.value = this.twinkleSpeed;

            this.material.uniforms.uSpikeLength.value = spikeParams.spikeLength;
            this.material.uniforms.uSpikeWidth.value = spikeParams.spikeWidth;
            this.material.uniforms.uCenterRadius.value = spikeParams.centerRadius;
        }

        let scaleFactor = 1.0;

        if (this.scaleWithDistance) {
            const { ratio: distanceRatio } = MathUtils.clampAndRatio(distance, this.minScaleDistance, this.maxScaleDistance);

            scaleFactor = MathUtils.lerp(this.minScale, this.maxScale, distanceRatio);
        }

        this.mesh.scale.setScalar(scaleFactor);
    }

    /**
     * Sets the core's brightness.
     *
     * Kept on the instance as well as in the uniform, because
     * {@link SunGlare#update} recomputes the uniform from it every frame with the distance
     * boost applied.
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
     * The core's configured brightness, before any distance boost.
     *
     * @returns {number} Core brightness.
     */
    getEmissiveIntensity() {
        return this.emissiveIntensity;
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