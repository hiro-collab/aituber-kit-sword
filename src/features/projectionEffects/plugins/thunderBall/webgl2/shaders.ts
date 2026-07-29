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
  float sourceEnergy = clamp(uSourceEnergy, 0.0, 1.0);
  outColor = vec4(vec3(sourceEnergy), sourceEnergy);
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
uniform float uGlowLevel;
uniform float uRampLevel;
uniform float uInputLevel;
uniform float uIntensity;
uniform float uContrast;
uniform float uGamma;
uniform vec3 uGlowColor;
out vec4 outColor;

vec3 originalRamp(float value) {
  float t = clamp(value, 0.0, 1.0);
  if (t < 0.347607) {
    return mix(vec3(0.0), vec3(0.0, 0.0, 1.0), t / 0.347607);
  }
  if (t < 0.6675063) {
    return mix(
      vec3(0.0, 0.0, 1.0),
      vec3(0.0, 1.0, 0.0),
      (t - 0.347607) / (0.6675063 - 0.347607)
    );
  }
  return mix(
    vec3(0.0, 1.0, 0.0),
    vec3(1.0, 0.0, 0.0),
    (t - 0.6675063) / (1.0 - 0.6675063)
  );
}

void main() {
  vec4 rawColor = texture(uRaw, vUv);
  vec3 blur = texture(uBlurred, vUv).rgb * max(uIntensity, 0.0);
  blur = (blur - 0.5) * max(uContrast, 0.0) + 0.5;
  blur = pow(max(blur, vec3(0.0)), vec3(1.0 / max(uGamma, 1e-4)));
  float luma = dot(blur, vec3(0.2126, 0.7152, 0.0722));
  vec3 bloom = blur * clamp(uBloomGain, 0.0, 2.0);
  bloom += uGlowColor * luma * max(uGlowLevel, 0.0);
  bloom += originalRamp(luma) * max(uRampLevel, 0.0);
  vec3 color = rawColor.rgb * max(uInputLevel, 0.0) + bloom;
  float alpha = clamp(max(rawColor.a * max(uInputLevel, 0.0), luma), 0.0, 1.0);
  outColor = vec4(color, alpha);
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
  vec4 blurred = texture(uRaw, vUv) * 4.0;
  blurred += texture(uRaw, vUv + vec2(uTexelStep.x, 0.0)) * 2.0;
  blurred += texture(uRaw, vUv - vec2(uTexelStep.x, 0.0)) * 2.0;
  blurred += texture(uRaw, vUv + vec2(0.0, uTexelStep.y)) * 2.0;
  blurred += texture(uRaw, vUv - vec2(0.0, uTexelStep.y)) * 2.0;
  blurred += texture(uRaw, vUv + uTexelStep);
  blurred += texture(uRaw, vUv - uTexelStep);
  blurred += texture(uRaw, vUv + vec2(uTexelStep.x, -uTexelStep.y));
  blurred += texture(uRaw, vUv + vec2(-uTexelStep.x, uTexelStep.y));
  blurred /= 16.0;
  vec4 previous = texture(uPrevious, vUv);
  outColor = blurred * clamp(uStageWeight, 0.0, 2.1)
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
  outColor = mix(current, history, clamp(uFeedback, 0.0, 0.9999));
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

export interface ThunderWebGl2RawOracleInput {
  along: number
  side: number
  sourceEnergy: number
  coreWidth: number
  haloWidth: number
  coreLuminance: number
  haloLuminance: number
}

export interface ThunderWebGl2RawOracleResult {
  red: number
  green: number
  blue: number
  alpha: number
}

export function resolveThunderWebGl2RawOracle(
  input: Readonly<ThunderWebGl2RawOracleInput>
): Readonly<ThunderWebGl2RawOracleResult> {
  if (!Object.values(input).every(Number.isFinite)) {
    return Object.freeze({ red: 0, green: 0, blue: 0, alpha: 0 })
  }
  const sourceEnergy = clamp(input.sourceEnergy, 0, 1)
  return Object.freeze({
    red: sourceEnergy,
    green: sourceEnergy,
    blue: sourceEnergy,
    alpha: sourceEnergy,
  })
}

export function resolveThunderWebGl2BlurOracle(
  center: number,
  axis: readonly number[],
  diagonal: readonly number[]
): number {
  if (
    !Number.isFinite(center) ||
    axis.length !== 4 ||
    diagonal.length !== 4 ||
    ![...axis, ...diagonal].every(Number.isFinite)
  ) {
    return 0
  }
  return (
    (center * 4 +
      axis.reduce((total, value) => total + value * 2, 0) +
      diagonal.reduce((total, value) => total + value, 0)) /
    16
  )
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
  const temporalState = mix(
    blurredEnergy,
    clamp(input.historyEnergy, 0, 8),
    clamp(input.feedback, 0, 0.9999)
  )
  const shaped = Math.pow(
    Math.max(0, temporalState * clamp(input.exposure, 0, 2)),
    1 / clamp(input.gamma, 0.1, 4)
  )
  const bloomEnergy =
    shaped * clamp(input.bloomGain, 0, 2) +
    shaped * 0.693 +
    sourceRampEnergy(shaped) * 0.788
  const mappedEnergy = rawEnergy + bloomEnergy
  return Object.freeze({
    alpha: clamp(Math.max(rawEnergy, shaped), 0, 1),
    bloomEnergy,
    mappedEnergy,
  })
}

function sourceRampEnergy(value: number): number {
  const t = clamp(value, 0, 1)
  if (t < 0.347607) return t / 0.347607
  if (t < 0.6675063) return 1
  return Math.max(
    (t - 0.6675063) / (1 - 0.6675063),
    1 - (t - 0.6675063) / (1 - 0.6675063)
  )
}

function mix(start: number, end: number, amount: number): number {
  return start + (end - start) * amount
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}
