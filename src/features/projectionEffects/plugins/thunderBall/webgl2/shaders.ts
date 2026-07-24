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
  float terminalFade = 1.0 - smoothstep(0.92, 1.0, vAlong);
  float sourceFlare = 1.0 - smoothstep(0.0, 0.28, vAlong);
  float longitudinalEnergy = terminalFade * mix(0.42, 1.0, sourceFlare);
  float distanceFromCenter = abs(vSide);
  float core = 1.0 - smoothstep(uTone.x, uTone.x + 0.08, distanceFromCenter);
  float halo = 1.0 - smoothstep(uTone.y * 0.45, uTone.y, distanceFromCenter);
  float sourceEnergy = clamp(uSourceEnergy, 0.0, 1.0);
  float coreEnergy = core * uTone.z;
  float haloEnergy = halo * uTone.w;
  float carriedEnergy = sourceEnergy * longitudinalEnergy;
  float coverage = 1.0 - pow(1.0 - carriedEnergy, 4.0);
  float sourceCoreBoost = mix(0.62, 1.6, sourceFlare);
  vec3 coreTint = mix(
    vec3(0.22, 0.63, 1.0),
    vec3(0.88, 0.95, 1.0),
    sourceFlare
  );
  vec3 coreColor = coreTint * coreEnergy * sourceCoreBoost;
  vec3 haloColor = vec3(0.12, 0.84, 1.0) * haloEnergy * 0.38;
  vec3 color = (coreColor + haloColor)
    * carriedEnergy;
  float alpha = clamp(
    max(
      core * coverage * mix(0.52, 1.0, sourceFlare),
      halo * coverage * 0.1
    ),
    0.0,
    1.0
  );
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
  float bloom = clamp(uBloomGain, 0.0, 2.0);
  float haloEnergy = clamp(
    dot(blurredColor.rgb, vec3(0.2126, 0.7152, 0.0722)),
    0.0,
    8.0
  );
  float ramp = clamp(haloEnergy, 0.0, 1.0);
  vec3 cyanGlow = vec3(0.12, 0.84, 1.0) * haloEnergy * 0.693;
  vec3 rampGlow = mix(
    vec3(0.0, 0.08, 0.42),
    vec3(0.62, 0.95, 1.0),
    ramp
  ) * haloEnergy * 0.788;
  vec3 bloomColor = blurredColor.rgb * 0.46 + cyanGlow + rampGlow;
  float bloomAlpha = clamp(
    dot(bloomColor, vec3(0.2126, 0.7152, 0.0722)),
    0.0,
    1.0
  );
  outColor = rawColor + vec4(bloomColor, bloomAlpha) * bloom;
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
  vec4 accumulated = max(current, history * clamp(uFeedback, 0.0, 0.82));
  vec3 hdr = accumulated.rgb * clamp(uExposure, 0.5, 2.0);
  vec3 mapped = hdr / (vec3(1.0) + hdr);
  mapped = pow(
    max(mapped, vec3(0.0)),
    vec3(1.0 / clamp(uGamma, 0.6, 1.4))
  );
  float visibleEnergy = max(mapped.r, max(mapped.g, mapped.b));
  float alpha = 1.0 - pow(1.0 - clamp(visibleEnergy, 0.0, 1.0), 2.0);
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
  const along = clamp(input.along, 0, 1)
  const terminalFade = 1 - smoothstep(0.92, 1, along)
  const sourceFlare = 1 - smoothstep(0, 0.28, along)
  const longitudinalEnergy = terminalFade * mix(0.42, 1, sourceFlare)
  const distanceFromCenter = Math.abs(input.side)
  const core =
    1 -
    smoothstep(
      clamp(input.coreWidth, 0.01, 0.4),
      clamp(input.coreWidth, 0.01, 0.4) + 0.08,
      distanceFromCenter
    )
  const halo =
    1 -
    smoothstep(
      clamp(input.haloWidth, 0.2, 1) * 0.45,
      clamp(input.haloWidth, 0.2, 1),
      distanceFromCenter
    )
  const sourceEnergy = clamp(input.sourceEnergy, 0, 1)
  const coreEnergy = core * clamp(input.coreLuminance, 0, 4)
  const haloEnergy = halo * clamp(input.haloLuminance, 0, 2)
  const energy = sourceEnergy * longitudinalEnergy
  const coverage = 1 - Math.pow(1 - energy, 4)
  const sourceCoreBoost = mix(0.62, 1.6, sourceFlare)
  const coreTint = [
    mix(0.22, 0.88, sourceFlare),
    mix(0.63, 0.95, sourceFlare),
    1,
  ] as const
  return Object.freeze({
    red:
      (coreEnergy * coreTint[0] * sourceCoreBoost + haloEnergy * 0.12 * 0.38) *
      energy,
    green:
      (coreEnergy * coreTint[1] * sourceCoreBoost + haloEnergy * 0.84 * 0.38) *
      energy,
    blue:
      (coreEnergy * coreTint[2] * sourceCoreBoost + haloEnergy * 0.38) * energy,
    alpha: clamp(
      Math.max(
        core * coverage * mix(0.52, 1, sourceFlare),
        halo * coverage * 0.1
      ),
      0,
      1
    ),
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
  const bloomEnergy = blurredEnergy * clamp(input.bloomGain, 0, 2)
  const currentEnergy = rawEnergy + bloomEnergy
  const accumulatedEnergy = Math.max(
    currentEnergy,
    clamp(input.historyEnergy, 0, 8) * clamp(input.feedback, 0, 0.82)
  )
  const exposed = accumulatedEnergy * clamp(input.exposure, 0.5, 2)
  const mappedEnergy = Math.pow(
    exposed / (1 + exposed),
    1 / clamp(input.gamma, 0.6, 1.4)
  )
  return Object.freeze({
    alpha: 1 - Math.pow(1 - clamp(mappedEnergy, 0, 1), 2),
    bloomEnergy,
    mappedEnergy,
  })
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = clamp((value - edge0) / Math.max(edge1 - edge0, 1e-6), 0, 1)
  return t * t * (3 - 2 * t)
}

function mix(start: number, end: number, amount: number): number {
  return start + (end - start) * amount
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}
