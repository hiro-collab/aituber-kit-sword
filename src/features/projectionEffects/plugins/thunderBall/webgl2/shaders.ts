import {
  THUNDER_WEBGL2_BLUR_STAGE_COUNT,
  THUNDER_WEBGL2_BLUR_WEIGHTS,
} from './contracts'

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
uniform float uSourceEnergy;
out vec4 outColor;

void main() {
  float endpoint = smoothstep(0.0, 0.04, vAlong)
    * (1.0 - smoothstep(0.96, 1.0, vAlong));
  float distanceFromCenter = abs(vSide);
  float core = 1.0 - smoothstep(uTone.x, uTone.x + 0.08, distanceFromCenter);
  float halo = 1.0 - smoothstep(uTone.y * 0.45, uTone.y, distanceFromCenter);
  float sourceEnergy = clamp(uSourceEnergy, 0.0, 1.0);
  float coreEnergy = core * uTone.z * sourceEnergy;
  float haloEnergy = halo * uTone.w * sourceEnergy;
  vec3 coreColor = vec3(0.96, 0.99, 1.0) * coreEnergy;
  vec3 haloColor = vec3(0.08, 0.62, 1.0) * haloEnergy;
  vec3 color = (coreColor + haloColor) * endpoint;
  float alpha = endpoint
    * clamp(coreEnergy * 0.42 + haloEnergy * 0.28, 0.0, 1.0);
  outColor = vec4(color, alpha);
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
  vUv = position;
  gl_Position = vec4(position * 2.0 - 1.0, 0.0, 1.0);
}
`

export const THUNDER_WEBGL2_BLOOM_FRAGMENT_SHADER = `#version 300 es
precision highp float;

in vec2 vUv;
uniform sampler2D uRaw;
uniform sampler2D uBlurred;
uniform float uBloomGain;
out vec4 outColor;

void main() {
  vec4 rawColor = texture(uRaw, vUv);
  vec4 blurredColor = texture(uBlurred, vUv);
  float peak = max(rawColor.r, max(rawColor.g, rawColor.b));
  float bloomGate = smoothstep(0.32, 1.08, peak);
  float bloom = clamp(uBloomGain, 0.0, 2.0)
    * (0.72 + bloomGate * 0.34);
  outColor = rawColor + blurredColor * bloom;
}
`

export const THUNDER_WEBGL2_BLUR_FRAGMENT_SHADER = `#version 300 es
precision highp float;

in vec2 vUv;
uniform sampler2D uRaw;
uniform sampler2D uPrevious;
uniform vec2 uTexelStep;
uniform float uStageWeight;
uniform float uPreviousWeight;
out vec4 outColor;

void main() {
  vec4 blurred = texture(uRaw, vUv) * 0.34;
  blurred += texture(uRaw, vUv + uTexelStep) * 0.23;
  blurred += texture(uRaw, vUv - uTexelStep) * 0.23;
  blurred += texture(uRaw, vUv + uTexelStep * 2.0) * 0.10;
  blurred += texture(uRaw, vUv - uTexelStep * 2.0) * 0.10;
  vec4 previous = texture(uPrevious, vUv);
  outColor = blurred * clamp(uStageWeight, 0.0, 1.0)
    + previous * clamp(uPreviousWeight, 0.0, 1.0);
}
`

export const THUNDER_WEBGL2_TEMPORAL_FRAGMENT_SHADER = `#version 300 es
precision highp float;

in vec2 vUv;
uniform sampler2D uCurrent;
uniform sampler2D uHistory;
uniform float uFeedback;
uniform float uExposure;
uniform float uGamma;
out vec4 outColor;

void main() {
  vec4 current = texture(uCurrent, vUv);
  vec4 history = texture(uHistory, vUv);
  vec4 accumulated = max(current, history * clamp(uFeedback, 0.0, 0.82));
  vec3 hdr = accumulated.rgb * clamp(uExposure, 0.5, 2.0);
  vec3 mapped = hdr / (vec3(1.0) + hdr);
  mapped = pow(max(mapped, vec3(0.0)), vec3(clamp(uGamma, 0.6, 1.4)));
  float visibleEnergy = max(mapped.r, max(mapped.g, mapped.b));
  float alpha = clamp(max(accumulated.a, visibleEnergy * 1.15), 0.0, 1.0);
  outColor = vec4(mapped, alpha);
}
`

export interface ThunderWebGl2CompositeOracleInput {
  rawEnergy: number
  blurEnergies: readonly number[]
  bloomGain: number
  historyEnergy: number
  feedback: number
  exposure: number
  gamma: number
}

export interface ThunderWebGl2CompositeOracleResult {
  alpha: number
  bloomEnergy: number
  mappedEnergy: number
}

export function resolveThunderWebGl2CompositeOracle(
  input: Readonly<ThunderWebGl2CompositeOracleInput>
): Readonly<ThunderWebGl2CompositeOracleResult> {
  if (
    input.blurEnergies.length !== THUNDER_WEBGL2_BLUR_STAGE_COUNT ||
    ![
      input.rawEnergy,
      input.bloomGain,
      input.historyEnergy,
      input.feedback,
      input.exposure,
      input.gamma,
      ...input.blurEnergies,
    ].every(Number.isFinite)
  ) {
    return Object.freeze({ alpha: 0, bloomEnergy: 0, mappedEnergy: 0 })
  }
  const rawEnergy = clamp(input.rawEnergy, 0, 4)
  const blurredEnergy = input.blurEnergies.reduce(
    (total, energy, index) =>
      total + clamp(energy, 0, 4) * (THUNDER_WEBGL2_BLUR_WEIGHTS[index] ?? 0),
    0
  )
  const bloomEnergy = blurredEnergy * clamp(input.bloomGain, 0, 2)
  const currentEnergy = rawEnergy + bloomEnergy
  const accumulatedEnergy = Math.max(
    currentEnergy,
    clamp(input.historyEnergy, 0, 8) * clamp(input.feedback, 0, 0.82)
  )
  const exposed = accumulatedEnergy * clamp(input.exposure, 0.5, 2)
  const mappedEnergy = Math.pow(
    exposed / (1 + exposed),
    clamp(input.gamma, 0.6, 1.4)
  )
  return Object.freeze({
    alpha: clamp(mappedEnergy * 1.15, 0, 1),
    bloomEnergy,
    mappedEnergy,
  })
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}
