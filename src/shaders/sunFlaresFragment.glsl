#ifdef GL_ES
precision highp float;
#endif

uniform float uVisibility;
uniform float uDirection;
uniform vec3  uLightView;
uniform vec3 uBaseColor;

float getAlpha(vec3 n){
  float nDotL = dot(n, uLightView) * uDirection;
  return smoothstep(1.0, 1.5, nDotL + uVisibility * 2.5);
}

varying float vUVY;
varying float vOpacity;
varying vec3  vColor;
varying vec3  vNormal;

uniform float uAlphaBlended;

void main(void){
    // Create smooth falloff along the flare
    float alpha = smoothstep(1.0, 0.0, abs(vUVY));
    alpha *= alpha;
    alpha *= vOpacity;
    alpha *= getAlpha(vNormal);  // Lighting-based visibility

    // No occlusion for now - keep flares always visible

    gl_FragColor = vec4(vColor * alpha, alpha * uAlphaBlended);
}