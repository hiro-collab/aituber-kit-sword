export const THUNDER_BALL_RIBBON_VERTEX_SHADER = `#version 300 es
precision highp float;

layout(location = 0) in vec2 position;
layout(location = 1) in float along;
layout(location = 2) in float intensity;

out float ribbonAlong;
out float ribbonIntensity;

void main() {
  ribbonAlong = along;
  ribbonIntensity = intensity;
  gl_Position = vec4(position, 0.0, 1.0);
}
`

export const THUNDER_BALL_RIBBON_FRAGMENT_SHADER = `#version 300 es
precision highp float;

in float ribbonAlong;
in float ribbonIntensity;

uniform float masterIntensity;
uniform float bloomGain;
out vec4 outColor;

void main() {
  float endpointFade = smoothstep(0.0, 0.08, ribbonAlong)
    * (1.0 - smoothstep(0.92, 1.0, ribbonAlong));
  float core = clamp(ribbonIntensity * endpointFade, 0.0, 1.0);
  vec3 electricBlue = mix(
    vec3(0.15, 0.45, 1.0),
    vec3(0.92, 0.98, 1.0),
    core
  );
  float glow = core * masterIntensity * (1.0 + bloomGain * 0.35);
  outColor = vec4(electricBlue * glow, glow);
}
`
