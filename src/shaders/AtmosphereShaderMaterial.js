import * as THREE from 'three';

const vertexShader = `
uniform vec3 lightDirection;
varying vec3 vNormal;
varying vec3 vWorldPosition;
varying vec3 vViewPosition;
varying vec3 vLightDir;

void main() {
    vNormal = normalize(normalMatrix * normal);

    // World position for lighting calculations
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    vWorldPosition = worldPosition.xyz;

    // View position for fresnel calculation
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    vViewPosition = -mvPosition.xyz;

    // Light direction in world space
    vLightDir = normalize(lightDirection);

    gl_Position = projectionMatrix * mvPosition;
}
`;

const fragmentShader = `
uniform vec3 atmosphereColor;
uniform float atmosphereTransparency;
uniform vec3 lightDirection;
uniform vec3 lightColor;
uniform vec3 planetCenter;
uniform float fadeStart;
uniform float fadeEnd;

varying vec3 vNormal;
varying vec3 vWorldPosition;
varying vec3 vViewPosition;
varying vec3 vLightDir;

void main() {
    // Use fresnel effect for natural atmospheric limb - fade based on viewing angle
    vec3 viewDirection = normalize(vViewPosition);
    float fresnel = abs(dot(vNormal, viewDirection));

    // For BackSide rendering, invert fresnel to match expectations:
    // We want: center (toward planet) = 1.0, edge (toward space) = 0.0
    float normalizedDistance = 1.0 - fresnel;

    // Linear fade control with fresnel:
    // fadeStart = where fade begins (full opacity before this)
    // fadeEnd = where it reaches zero opacity (transparent after this)
    float t = clamp((normalizedDistance - fadeStart) / (fadeEnd - fadeStart), 0.0, 1.0);
    float edgeFade = 1.0 - t;

    // Rim lighting effect for atmosphere glow
    float rimPower = 2.0;
    float rim = 1.0 - dot(vNormal, vec3(0.0, 0.0, 1.0));
    rim = pow(rim, rimPower);

    // Calculate lighting based on sun position
    vec3 surfaceNormal = normalize(vWorldPosition - planetCenter);
    float lightDot = dot(surfaceNormal, vLightDir);

    // Create day/night terminator effect
    // lightDot > 0 = day side, lightDot < 0 = night side
    float dayNightFactor = clamp(lightDot + 0.3, 0.0, 1.0); // +0.3 for softer transition

    // Enhanced atmosphere on the terminator (day/night boundary)
    float terminatorEffect = 1.0 - abs(lightDot);
    terminatorEffect = pow(terminatorEffect, 1.5) * 0.5; // Enhance sunset/sunrise glow

    // Combine rim lighting with day/night effects and edge fade
    float atmosphereIntensity = rim * (dayNightFactor + terminatorEffect) * edgeFade;

    // Blend atmosphere base color with star light color for realistic lighting
    vec3 litAtmosphereColor = mix(atmosphereColor * 0.3, atmosphereColor * lightColor, dayNightFactor);
    vec3 color = litAtmosphereColor * atmosphereIntensity * atmosphereTransparency;
    float alpha = atmosphereIntensity * atmosphereTransparency;

    gl_FragColor = vec4(color, alpha);
}
`;

/**
 * AtmosphereShaderMaterial - A custom Three.js material for rendering planetary atmospheres
 * Based on the flexible atmosphere shader technique from petrocket.blogspot.com
 */
class AtmosphereShaderMaterial extends THREE.ShaderMaterial {
    constructor(options = {}) {
        // Enhanced uniform values with lighting and fade controls
        const uniforms = {
            atmosphereColor: { value: new THREE.Color(options.atmosphereColor || 0x87CEEB) },
            atmosphereTransparency: { value: options.atmosphereTransparency || 0.8 },
            lightDirection: { value: new THREE.Vector3(1.0, 0.0, 0.0) },
            lightColor: { value: new THREE.Color(options.lightColor || 0xffffff) },
            planetCenter: { value: new THREE.Vector3(0, 0, 0) },
            fadeStart: { value: options.fadeStart || 0.7 },  // Where fade begins (0.0=center, 1.0=edge)
            fadeEnd: { value: options.fadeEnd || 1.0 }       // Where it reaches zero opacity
        };

        super({
            uniforms,
            vertexShader,
            fragmentShader,
            transparent: true,
            blending: THREE.AdditiveBlending,
            side: THREE.BackSide, // Render atmosphere from inside
            depthWrite: false,
            toneMapped: false,  // Required for emissive > 1.0 to work with bloom
            ...options.materialOptions
        });


        // Store references for easy access
        this.atmosphereColor = uniforms.atmosphereColor;
        this.atmosphereTransparency = uniforms.atmosphereTransparency;
        this.lightDirection = uniforms.lightDirection;
        this.lightColor = uniforms.lightColor;
        this.planetCenter = uniforms.planetCenter;
        this.fadeStart = uniforms.fadeStart;
        this.fadeEnd = uniforms.fadeEnd;
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
     * Set atmosphere transparency
     * @param {number} transparency - The atmosphere transparency (0-1)
     */
    setAtmosphereTransparency(transparency) {
        this.atmosphereTransparency.value = transparency;
    }

    /**
     * Set light color for atmosphere illumination
     * @param {number|THREE.Color} color - The light color
     */
    setLightColor(color) {
        if (typeof color === 'number') {
            this.lightColor.value.setHex(color);
        } else {
            this.lightColor.value.copy(color);
        }
    }

    /**
     * Update atmosphere lighting based on sun and planet positions
     */
    updateLighting(lightPosition, planetPosition) {
        // Calculate light direction from planet to sun
        const lightDirection = new THREE.Vector3()
            .subVectors(lightPosition, planetPosition)
            .normalize();

        this.lightDirection.value.copy(lightDirection);
        this.planetCenter.value.copy(planetPosition);
    }

    /**
     * Set fade start point for smooth radial fade-out
     * @param {number} fadeStart - Where to start fading (0.0-1.0)
     */
    setFadeStart(fadeStart) {
        this.fadeStart.value = fadeStart;
    }

    /**
     * Set fade end point for smooth radial fade-out
     * @param {number} fadeEnd - Where to complete fade (0.0-1.0)
     */
    setFadeEnd(fadeEnd) {
        this.fadeEnd.value = fadeEnd;
    }

    /**
     * Dispose of the material and its resources
     */
    dispose() {
        super.dispose();
    }
}

export default AtmosphereShaderMaterial;