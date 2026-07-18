export const FIRE_PARTICLE_VERTEX_SHADER = `#version 300 es
precision highp float;

layout(location = 0) in vec2 particlePosition;
layout(location = 1) in float particleSize;
layout(location = 2) in float particleHeat;
layout(location = 3) in float particleAlpha;
layout(location = 4) in float particleAge;
layout(location = 5) in float particleSeed;

out float heat;
out float alpha;
out float age;
out float seed;

void main() {
  heat = particleHeat;
  alpha = particleAlpha;
  age = particleAge;
  seed = particleSeed;
  gl_Position = vec4(particlePosition, 0.0, 1.0);
  gl_PointSize = particleSize;
}
`

export const FIRE_PARTICLE_FRAGMENT_SHADER = `#version 300 es
precision highp float;

in float heat;
in float alpha;
in float age;
in float seed;
uniform float bloomGain;
uniform float masterIntensity;
out vec4 outputColor;

void main() {
  vec2 centered = gl_PointCoord * 2.0 - 1.0;
  float verticalTaper = mix(
    1.0,
    0.5,
    smoothstep(-0.45, 0.95, centered.y)
  );
  vec2 flameShape = vec2(
    centered.x / max(0.25, verticalTaper),
    centered.y * 0.82
  );
  float radius = length(flameShape);
  if (radius > 1.0) discard;

  float core = 1.0 - smoothstep(0.02, 0.58, radius);
  float softEdge = 1.0 - smoothstep(0.48, 1.0, radius);
  float glow = (1.0 - smoothstep(0.16, 1.0, radius)) * bloomGain;
  float flicker = 0.93 + 0.07 * sin(seed * 91.7 + age * 18.0);
  float ageHeat = clamp(heat * (1.0 - age * 0.72), 0.0, 1.0);
  vec3 ember = vec3(1.0, 0.10, 0.01);
  vec3 flame = vec3(1.0, 0.48, 0.04);
  vec3 hot = vec3(1.0, 0.96, 0.68);
  vec3 temperatureColor = mix(ember, flame, ageHeat);
  temperatureColor = mix(temperatureColor, hot, core * ageHeat);
  float lifeFade = 1.0 - smoothstep(0.55, 1.0, age);
  float compositeAlpha =
    (core * 0.78 + softEdge * 0.34 + glow * 0.3) *
    alpha *
    lifeFade *
    flicker;
  outputColor = vec4(
    temperatureColor * (core + softEdge * 0.22 + glow) * masterIntensity * flicker,
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
