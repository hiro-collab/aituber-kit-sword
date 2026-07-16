export const FIRE_PARTICLE_VERTEX_SHADER = `#version 300 es
precision highp float;

layout(location = 0) in vec2 particlePosition;
layout(location = 1) in float particleSize;
layout(location = 2) in float particleHeat;
layout(location = 3) in float particleAlpha;
layout(location = 4) in float particleAge;

out float heat;
out float alpha;
out float age;

void main() {
  heat = particleHeat;
  alpha = particleAlpha;
  age = particleAge;
  gl_Position = vec4(particlePosition, 0.0, 1.0);
  gl_PointSize = particleSize;
}
`

export const FIRE_PARTICLE_FRAGMENT_SHADER = `#version 300 es
precision highp float;

in float heat;
in float alpha;
in float age;
uniform float bloomGain;
uniform float masterIntensity;
out vec4 outputColor;

void main() {
  vec2 centered = gl_PointCoord * 2.0 - 1.0;
  float radius = length(centered);
  if (radius > 1.0) discard;

  float core = 1.0 - smoothstep(0.02, 0.72, radius);
  float glow = (1.0 - smoothstep(0.18, 1.0, radius)) * bloomGain;
  vec3 ember = vec3(1.0, 0.10, 0.01);
  vec3 flame = vec3(1.0, 0.48, 0.04);
  vec3 hot = vec3(1.0, 0.92, 0.54);
  vec3 temperatureColor = mix(ember, flame, clamp(heat, 0.0, 1.0));
  temperatureColor = mix(temperatureColor, hot, core * heat);
  float lifeFade = 1.0 - smoothstep(0.55, 1.0, age);
  float compositeAlpha = (core + glow * 0.42) * alpha * lifeFade;
  outputColor = vec4(
    temperatureColor * (core + glow) * masterIntensity,
    compositeAlpha * masterIntensity
  );
}
`

export const FIRE_COMPOSITE_FRAGMENT_SHADER = `#version 300 es
precision highp float;

in vec2 projectionUv;
uniform sampler2D fireEmission;
uniform sampler2D fireBloom;
uniform float bloomGain;
out vec4 outputColor;

void main() {
  vec4 emission = texture(fireEmission, projectionUv);
  vec4 bloom = texture(fireBloom, projectionUv) * bloomGain;
  outputColor = emission + bloom;
}
`
