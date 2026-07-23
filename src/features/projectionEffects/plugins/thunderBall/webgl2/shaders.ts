export const THUNDER_WEBGL2_RIBBON_VERTEX_SHADER = `#version 300 es
precision highp float;

layout(location = 0) in vec2 position;
layout(location = 1) in float along;
layout(location = 2) in float side;

out float vAlong;
out float vSide;

void main() {
  vAlong = along;
  vSide = side;
  gl_Position = vec4(position, 0.0, 1.0);
}
`

export const THUNDER_WEBGL2_RIBBON_FRAGMENT_SHADER = `#version 300 es
precision highp float;

in float vAlong;
in float vSide;
uniform vec4 uTone;
out vec4 outColor;

void main() {
  float endpoint = smoothstep(0.0, 0.04, vAlong)
    * (1.0 - smoothstep(0.96, 1.0, vAlong));
  float distanceFromCenter = abs(vSide);
  float core = 1.0 - smoothstep(uTone.x, uTone.x + 0.08, distanceFromCenter);
  float halo = 1.0 - smoothstep(uTone.y * 0.45, uTone.y, distanceFromCenter);
  vec3 coreColor = vec3(0.96, 0.99, 1.0) * uTone.z;
  vec3 haloColor = vec3(0.08, 0.62, 1.0) * uTone.w;
  float alpha = endpoint * clamp(core + halo * 0.7, 0.0, 1.0);
  outColor = vec4((coreColor * core + haloColor * halo) * endpoint, alpha);
}
`

export const THUNDER_WEBGL2_FULLSCREEN_VERTEX_SHADER = `#version 300 es
precision highp float;

out vec2 vUv;

void main() {
  vec2 position = vec2(
    float((gl_VertexID << 1) & 2),
    float(gl_VertexID & 2)
  );
  vUv = position * 0.5;
  gl_Position = vec4(position * 2.0 - 1.0, 0.0, 1.0);
}
`

export const THUNDER_WEBGL2_BLOOM_FRAGMENT_SHADER = `#version 300 es
precision highp float;

in vec2 vUv;
uniform sampler2D uRaw;
uniform sampler2D uBlurred;
out vec4 outColor;

void main() {
  vec4 rawColor = texture(uRaw, vUv);
  vec4 blurredColor = texture(uBlurred, vUv);
  float peak = max(rawColor.r, max(rawColor.g, rawColor.b));
  float bloomGate = smoothstep(0.32, 1.08, peak);
  outColor = rawColor + blurredColor * (0.72 + bloomGate * 0.34);
}
`

export const THUNDER_WEBGL2_BLUR_FRAGMENT_SHADER = `#version 300 es
precision highp float;

in vec2 vUv;
uniform sampler2D uSource;
uniform vec2 uTexelStep;
out vec4 outColor;

void main() {
  vec4 value = texture(uSource, vUv) * 0.34;
  value += texture(uSource, vUv + uTexelStep) * 0.23;
  value += texture(uSource, vUv - uTexelStep) * 0.23;
  value += texture(uSource, vUv + uTexelStep * 2.0) * 0.10;
  value += texture(uSource, vUv - uTexelStep * 2.0) * 0.10;
  outColor = value;
}
`

export const THUNDER_WEBGL2_TEMPORAL_FRAGMENT_SHADER = `#version 300 es
precision highp float;

in vec2 vUv;
uniform sampler2D uCurrent;
uniform sampler2D uHistory;
uniform float uFeedback;
out vec4 outColor;

void main() {
  vec4 current = texture(uCurrent, vUv);
  vec4 history = texture(uHistory, vUv);
  vec4 accumulated = max(current, history * clamp(uFeedback, 0.0, 0.82));
  vec3 hdr = accumulated.rgb;
  vec3 mapped = hdr / (vec3(1.0) + hdr);
  float alpha = clamp(accumulated.a, 0.0, 1.0);
  outColor = vec4(mapped, alpha);
}
`
