import * as THREE from 'three';

/**
 * SunCorona - Creates a 3D outer sphere corona effect to replace the billboard
 * This provides a more realistic 3D corona that properly interacts with depth and lighting
 */
class SunCorona {
    constructor(options = {}) {
        // Configuration options
        this.sunRadius = options.sunRadius || 1.0;
        this.coronaRadius = options.coronaRadius || (this.sunRadius * 2.5);
        this.coronaColor = new THREE.Color(options.coronaColor || 0xffaa00);
        this.coronaIntensity = options.coronaIntensity || 0.8;
        this.noiseScale = options.noiseScale || 3.0;
        this.animationSpeed = options.animationSpeed || 0.001;
        this.fresnelPower = options.fresnelPower || 2.0;
        this.lowres = options.lowres || false;

        // Create the corona mesh
        this.mesh = this.createCoronaMesh();

        // Animation properties
        this.time = 0;

    }

    /**
     * Create the corona mesh with custom geometry and shader material
     * @returns {THREE.Mesh} The corona mesh
     */
    createCoronaMesh() {
        // Create sphere geometry - more detailed for better corona effect
        const geometry = new THREE.SphereGeometry(
            this.coronaRadius,
            this.lowres ? 32 : 64,
            this.lowres ? 16 : 32
        );

        // Create custom shader material for corona effect
        const material = this.createCoronaMaterial();

        // Create the mesh
        const mesh = new THREE.Mesh(geometry, material);

        // Set render order to render after the sun but before other objects
        mesh.renderOrder = 1;

        return mesh;
    }

    /**
     * Create the custom corona shader material
     * @returns {THREE.ShaderMaterial} The corona shader material
     */
    createCoronaMaterial() {
        const vertexShader = `
            varying vec3 vNormal;
            varying vec3 vViewPosition;
            varying vec3 vWorldPosition;
            varying vec2 vUv;

            void main() {
                vNormal = normalize(normalMatrix * normal);
                vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                vViewPosition = -mvPosition.xyz;
                vWorldPosition = (modelMatrix * vec4(position, 1.0)).xyz;
                vUv = uv;

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
            uniform vec3 uCameraPosition;
            uniform float uSunRadius;

            varying vec3 vNormal;
            varying vec3 vViewPosition;
            varying vec3 vWorldPosition;
            varying vec2 vUv;

            // Noise functions for corona density variation
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

            // Fractal noise for complex corona structure
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
                // Use fresnel effect but invert it - bright when looking straight at surface (center)
                // and fade toward edges where we're looking at grazing angles
                vec3 viewDirection = normalize(vViewPosition);
                float fresnel = abs(dot(vNormal, viewDirection));

                // Apply power to control the falloff curve
                float centerToEdgeFade = pow(fresnel, uFresnelPower);

                // Create animated noise for corona density variation
                vec3 noisePos = vWorldPosition * uNoiseScale + uTime * uAnimationSpeed;

                // Multiple noise octaves for complex corona structure
                float coronaDensity = fractalNoise(noisePos, 3);

                // Add some directional flow for corona streams
                float streamFlow = fractalNoise(vWorldPosition * uNoiseScale * 0.5 + vec3(uTime * uAnimationSpeed * 2.0, 0.0, 0.0), 2);
                coronaDensity = mix(coronaDensity, streamFlow, 0.3);

                // Combine center-to-edge fade with noise
                float finalAlpha = centerToEdgeFade * (0.4 + coronaDensity * 0.6) * uCoronaIntensity;

                // Clamp alpha to prevent oversaturation
                finalAlpha = clamp(finalAlpha, 0.0, 0.9);

                // Create color with temperature variation
                vec3 finalColor = uCoronaColor;

                // Add some color variation based on noise for more realistic corona
                float colorVariation = fractalNoise(vWorldPosition * uNoiseScale * 2.0, 2);
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
                uFresnelPower: { value: this.fresnelPower },
                uCameraPosition: { value: new THREE.Vector3() },
                uSunRadius: { value: this.sunRadius }
            },
            vertexShader,
            fragmentShader,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            depthTest: true,
            side: THREE.BackSide // Render from inside for proper corona effect
        });
    }

    /**
     * Update the corona animation and camera position
     * @param {number} deltaTime - Time since last update in seconds
     * @param {THREE.Camera} camera - Camera for position updates
     */
    update(deltaTime, camera) {
        this.time += deltaTime;

        // Update shader uniforms
        if (this.mesh.material.uniforms) {
            this.mesh.material.uniforms.uTime.value = this.time;

            if (camera) {
                this.mesh.material.uniforms.uCameraPosition.value.copy(camera.position);
            }
        }
    }

    /**
     * Set the position of the corona (should match sun position)
     * @param {THREE.Vector3} position - The position to set
     */
    setPosition(position) {
        this.mesh.position.copy(position);
    }

    /**
     * Set the corona color
     * @param {number|THREE.Color} color - The new corona color
     */
    setCoronaColor(color) {
        if (typeof color === 'number') {
            this.coronaColor.setHex(color);
        } else {
            this.coronaColor.copy(color);
        }

        if (this.mesh.material.uniforms) {
            this.mesh.material.uniforms.uCoronaColor.value.copy(this.coronaColor);
        }
    }

    /**
     * Set the corona intensity
     * @param {number} intensity - The new corona intensity (0-1)
     */
    setCoronaIntensity(intensity) {
        this.coronaIntensity = intensity;

        if (this.mesh.material.uniforms) {
            this.mesh.material.uniforms.uCoronaIntensity.value = intensity;
        }
    }

    /**
     * Set the corona radius
     * @param {number} radius - The new corona radius
     */
    setCoronaRadius(radius) {
        this.coronaRadius = radius;

        // Update geometry scale
        const scale = radius / this.sunRadius;
        this.mesh.scale.setScalar(scale / 2.5); // Adjust for base scale

        if (this.mesh.material.uniforms) {
            this.mesh.material.uniforms.uSunRadius.value = this.sunRadius;
        }
    }

    /**
     * Set noise parameters
     * @param {number} scale - Noise scale
     * @param {number} speed - Animation speed
     */
    setNoiseParameters(scale, speed) {
        this.noiseScale = scale;
        this.animationSpeed = speed;

        if (this.mesh.material.uniforms) {
            this.mesh.material.uniforms.uNoiseScale.value = scale;
            this.mesh.material.uniforms.uAnimationSpeed.value = speed;
        }
    }

    /**
     * Set fresnel power for rim lighting effect
     * @param {number} power - Fresnel power (higher = sharper rim)
     */
    setFresnelPower(power) {
        this.fresnelPower = power;

        if (this.mesh.material.uniforms) {
            this.mesh.material.uniforms.uFresnelPower.value = power;
        }
    }

    /**
     * Add the corona to a Three.js scene
     * @param {THREE.Scene|THREE.Group} parent - The parent to add to
     */
    addToScene(parent) {
        parent.add(this.mesh);
        console.log('🌟 SunCorona added to scene');
    }

    /**
     * Remove the corona from a Three.js scene
     * @param {THREE.Scene|THREE.Group} parent - The parent to remove from
     */
    removeFromScene(parent) {
        parent.remove(this.mesh);
    }

    /**
     * Get the Three.js mesh object
     * @returns {THREE.Mesh} The corona mesh
     */
    getMesh() {
        return this.mesh;
    }

    /**
     * Dispose of resources
     */
    dispose() {
        if (this.mesh.geometry) {
            this.mesh.geometry.dispose();
        }
        if (this.mesh.material) {
            this.mesh.material.dispose();
        }

        console.log('🌟 SunCorona disposed');
    }
}

export default SunCorona;