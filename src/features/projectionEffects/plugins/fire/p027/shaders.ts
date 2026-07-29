export interface FireP027ColorSample {
  r: number
  g: number
  b: number
  a: number
}

const FIRE_P027_LUMA_R = 0.2126
const FIRE_P027_LUMA_G = 0.7152
const FIRE_P027_LUMA_B = 0.0722
const FIRE_P027_ALPHA_LUMA_START = 0.015
const FIRE_P027_ALPHA_LUMA_END = 0.18

/**
 * CPU reference for the raster shader's additive contribution.
 * Generator RGB is already alpha-shaped, so rasterization keeps its energy
 * monotonic instead of multiplying it by alpha again. Alpha remains tied to
 * visible energy so transparent black cannot accumulate into a dark veil.
 */
export function composeFireP027SpriteSample(
  sprite: Readonly<FireP027ColorSample>,
  tint: Readonly<FireP027ColorSample>,
  opacity: number
): FireP027ColorSample {
  const safeOpacity = clamp01(opacity)
  const tintAlpha = clamp01(tint.a)
  const spriteAlpha = clamp01(sprite.a)
  const sourceAlpha = spriteAlpha * tintAlpha * safeOpacity
  const sourceRgb = {
    r: nonNegative(sprite.r) * nonNegative(tint.r) * tintAlpha * safeOpacity,
    g: nonNegative(sprite.g) * nonNegative(tint.g) * tintAlpha * safeOpacity,
    b: nonNegative(sprite.b) * nonNegative(tint.b) * tintAlpha * safeOpacity,
  }
  const sourceLuminance = luminance(sourceRgb)
  const correlatedAlpha =
    sourceAlpha *
    smoothstep(
      FIRE_P027_ALPHA_LUMA_START,
      FIRE_P027_ALPHA_LUMA_END,
      sourceLuminance
    )
  return {
    r: sourceRgb.r,
    g: sourceRgb.g,
    b: sourceRgb.b,
    a: correlatedAlpha,
  }
}

/**
 * CPU reference for the O1-compatible fixed-output display boundary.
 *
 * The source recipe accumulates its colored sprite layers into a bounded
 * target. Presentation therefore preserves the accumulated straight RGBA
 * channel-by-channel and only applies the fixed target's 0..1 clamp. It does
 * not add a second exposure, gamma, white-core, or luminance-alpha transform.
 */
export function toneMapFireP027DisplaySample(
  accumulated: Readonly<FireP027ColorSample>
): FireP027ColorSample {
  return {
    r: clamp01(accumulated.r),
    g: clamp01(accumulated.g),
    b: clamp01(accumulated.b),
    a: clamp01(accumulated.a),
  }
}

export interface FireP027MetricSummary {
  width: number
  height: number
  supportPixels: number
  supportArea: number
  bboxMinX: number
  bboxMinY: number
  bboxMaxXExclusive: number
  bboxMaxYExclusive: number
  centroidX: number
  centroidY: number
  upperThirdSupportArea: number
  lowerThirdSupportArea: number
  hotPixels: number
  warmPixels: number
  hotToWarmRatio: number
  clippedPixels: number
  clippedArea: number
  nearWhitePixels: number
  nearWhiteFraction: number
  saturatedRedFraction: number
  saturatedOrangeFraction: number
  saturatedYellowFraction: number
  internalLuminanceMean: number
  internalLuminanceVariance: number
  hotCentroidX: number
  hotCentroidY: number
  warmCentroidX: number
  warmCentroidY: number
  hotInsideWarmBbox: boolean
  outsideSupportMaxRgb: number
  outsideSupportAlphaMin: number
  outsideSupportAlphaMax: number
  outsideSupportAlphaMean: number
  postOffRgbaZero: boolean
}

/**
 * Reduces transient RGBA samples to the source-oracle measurement vocabulary.
 * The input array is never retained or returned; callers can persist the
 * bounded summary without persisting frames or pixel payloads.
 */
export function summarizeFireP027RgbaMetrics(
  rgba: ArrayLike<number>,
  width: number,
  height: number
): Readonly<FireP027MetricSummary> {
  const safeWidth = Math.floor(width)
  const safeHeight = Math.floor(height)
  if (
    safeWidth < 1 ||
    safeHeight < 1 ||
    rgba.length !== safeWidth * safeHeight * 4
  ) {
    throw new Error('P027 metric input shape invalid')
  }

  const visibleThreshold = 1 / 255
  let supportPixels = 0
  let hotPixels = 0
  let warmPixels = 0
  let clippedPixels = 0
  let nearWhitePixels = 0
  let saturatedRedPixels = 0
  let saturatedOrangePixels = 0
  let saturatedYellowPixels = 0
  let luminanceMean = 0
  let luminanceM2 = 0
  let hotX = 0
  let hotY = 0
  let warmX = 0
  let warmY = 0
  let warmMinX = safeWidth
  let warmMinY = safeHeight
  let warmMaxXExclusive = 0
  let warmMaxYExclusive = 0
  let minX = safeWidth
  let minY = safeHeight
  let maxXExclusive = 0
  let maxYExclusive = 0
  let weightedX = 0
  let weightedY = 0
  let weightSum = 0
  let binaryX = 0
  let binaryY = 0
  let upperThirdSupport = 0
  let lowerThirdSupport = 0
  let outsideCount = 0
  let outsideMaxRgb = 0
  let outsideAlphaMin = Number.POSITIVE_INFINITY
  let outsideAlphaMax = 0
  let outsideAlphaSum = 0
  let absoluteMaxRgb = 0
  let absoluteMaxAlpha = 0

  for (let y = 0; y < safeHeight; y += 1) {
    for (let x = 0; x < safeWidth; x += 1) {
      const offset = (y * safeWidth + x) * 4
      const r = nonNegative(rgba[offset] ?? 0)
      const g = nonNegative(rgba[offset + 1] ?? 0)
      const b = nonNegative(rgba[offset + 2] ?? 0)
      const a = nonNegative(rgba[offset + 3] ?? 0)
      const maximumRgb = Math.max(r, g, b)
      absoluteMaxRgb = Math.max(absoluteMaxRgb, maximumRgb)
      absoluteMaxAlpha = Math.max(absoluteMaxAlpha, a)
      if (maximumRgb <= visibleThreshold) {
        outsideCount += 1
        outsideMaxRgb = Math.max(outsideMaxRgb, maximumRgb)
        outsideAlphaMin = Math.min(outsideAlphaMin, a)
        outsideAlphaMax = Math.max(outsideAlphaMax, a)
        outsideAlphaSum += a
        continue
      }

      supportPixels += 1
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      maxXExclusive = Math.max(maxXExclusive, x + 1)
      maxYExclusive = Math.max(maxYExclusive, y + 1)
      binaryX += x + 0.5
      binaryY += y + 0.5
      const pixelLuminance = luminance({ r, g, b })
      const luminanceDelta = pixelLuminance - luminanceMean
      luminanceMean += luminanceDelta / supportPixels
      luminanceM2 += luminanceDelta * (pixelLuminance - luminanceMean)
      weightedX += (x + 0.5) * pixelLuminance
      weightedY += (y + 0.5) * pixelLuminance
      weightSum += pixelLuminance
      if (y < safeHeight / 3) upperThirdSupport += 1
      if (y >= (safeHeight * 2) / 3) lowerThirdSupport += 1

      const hot = pixelLuminance >= 0.7 && r >= 0.7 && g >= 0.35
      const warm =
        !hot && pixelLuminance >= 0.05 && r >= 0.9 * g && g >= 1.1 * b
      if (hot) {
        hotPixels += 1
        hotX += x + 0.5
        hotY += y + 0.5
      } else if (warm) {
        warmPixels += 1
        warmX += x + 0.5
        warmY += y + 0.5
        warmMinX = Math.min(warmMinX, x)
        warmMinY = Math.min(warmMinY, y)
        warmMaxXExclusive = Math.max(warmMaxXExclusive, x + 1)
        warmMaxYExclusive = Math.max(warmMaxYExclusive, y + 1)
      }

      if (maximumRgb >= 254 / 255) clippedPixels += 1
      const minimumRgb = Math.min(r, g, b)
      if (minimumRgb >= 0.92 && maximumRgb - minimumRgb <= 0.08) {
        nearWhitePixels += 1
      }
      const saturation =
        maximumRgb > 0 ? (maximumRgb - minimumRgb) / maximumRgb : 0
      if (saturation >= 0.25) {
        const hue = rgbHueDegrees(r, g, b)
        if (hue < 30 || hue >= 330) saturatedRedPixels += 1
        else if (hue < 55) saturatedOrangePixels += 1
        else if (hue < 75) saturatedYellowPixels += 1
      }
    }
  }

  const totalPixels = safeWidth * safeHeight
  const centroidDenominator = weightSum > 0 ? weightSum : supportPixels
  const centroidNumeratorX = weightSum > 0 ? weightedX : binaryX
  const centroidNumeratorY = weightSum > 0 ? weightedY : binaryY
  return Object.freeze({
    width: safeWidth,
    height: safeHeight,
    supportPixels,
    supportArea: supportPixels / totalPixels,
    bboxMinX: supportPixels > 0 ? minX / safeWidth : 0,
    bboxMinY: supportPixels > 0 ? minY / safeHeight : 0,
    bboxMaxXExclusive: supportPixels > 0 ? maxXExclusive / safeWidth : 0,
    bboxMaxYExclusive: supportPixels > 0 ? maxYExclusive / safeHeight : 0,
    centroidX:
      centroidDenominator > 0
        ? centroidNumeratorX / centroidDenominator / safeWidth
        : 0,
    centroidY:
      centroidDenominator > 0
        ? centroidNumeratorY / centroidDenominator / safeHeight
        : 0,
    upperThirdSupportArea: upperThirdSupport / totalPixels,
    lowerThirdSupportArea: lowerThirdSupport / totalPixels,
    hotPixels,
    warmPixels,
    hotToWarmRatio: hotPixels / Math.max(1, warmPixels),
    clippedPixels,
    clippedArea: clippedPixels / Math.max(1, supportPixels),
    nearWhitePixels,
    nearWhiteFraction: nearWhitePixels / Math.max(1, supportPixels),
    saturatedRedFraction: saturatedRedPixels / Math.max(1, supportPixels),
    saturatedOrangeFraction: saturatedOrangePixels / Math.max(1, supportPixels),
    saturatedYellowFraction: saturatedYellowPixels / Math.max(1, supportPixels),
    internalLuminanceMean: luminanceMean,
    internalLuminanceVariance:
      supportPixels > 0 ? luminanceM2 / supportPixels : 0,
    hotCentroidX: hotPixels > 0 ? hotX / hotPixels / safeWidth : 0,
    hotCentroidY: hotPixels > 0 ? hotY / hotPixels / safeHeight : 0,
    warmCentroidX: warmPixels > 0 ? warmX / warmPixels / safeWidth : 0,
    warmCentroidY: warmPixels > 0 ? warmY / warmPixels / safeHeight : 0,
    hotInsideWarmBbox:
      hotPixels > 0 &&
      warmPixels > 0 &&
      hotX / hotPixels >= warmMinX &&
      hotX / hotPixels <= warmMaxXExclusive &&
      hotY / hotPixels >= warmMinY &&
      hotY / hotPixels <= warmMaxYExclusive,
    outsideSupportMaxRgb: outsideMaxRgb,
    outsideSupportAlphaMin: outsideCount > 0 ? outsideAlphaMin : 0,
    outsideSupportAlphaMax: outsideAlphaMax,
    outsideSupportAlphaMean:
      outsideCount > 0 ? outsideAlphaSum / outsideCount : 0,
    postOffRgbaZero: absoluteMaxRgb === 0 && absoluteMaxAlpha === 0,
  })
}

export interface FireP027VectorSample {
  x: number
  y: number
  z: number
}

export interface FireP027EmitterMotionSample {
  centerDelta: FireP027VectorSample
  localPosition: FireP027VectorSample
  worldPosition: FireP027VectorSample
}

/**
 * CPU reference for the state shader's emitter-motion branch. Existing
 * particles follow the emitter exactly once; births already originate in the
 * current origin texture and therefore never receive the survivor delta.
 */
export function applyFireP027EmitterMotion(
  previousPosition: Readonly<FireP027VectorSample>,
  previousCenter: Readonly<FireP027VectorSample>,
  currentCenter: Readonly<FireP027VectorSample>,
  currentOrigin: Readonly<FireP027VectorSample>,
  isBirth: boolean
): FireP027EmitterMotionSample {
  const centerDelta = {
    x: currentCenter.x - previousCenter.x,
    y: currentCenter.y - previousCenter.y,
    z: currentCenter.z - previousCenter.z,
  }
  const worldPosition = isBirth
    ? { ...currentOrigin }
    : {
        x: previousPosition.x + centerDelta.x,
        y: previousPosition.y + centerDelta.y,
        z: previousPosition.z + centerDelta.z,
      }
  return {
    centerDelta,
    localPosition: {
      x: worldPosition.x - currentCenter.x,
      y: worldPosition.y - currentCenter.y,
      z: worldPosition.z - currentCenter.z,
    },
    worldPosition,
  }
}

/**
 * CPU reference for the emitter-local turbulence field used by the state
 * shader. The X component is odd under local-X reflection while Y/Z are even,
 * so paired fallback origins cannot acquire an unexplained persistent side
 * wind. Seed is intentionally bounded before it reaches GLSL float uniforms.
 */
export function sampleFireP027LocalTurbulence(
  localPosition: Readonly<FireP027VectorSample>,
  period: number,
  seed: number
): FireP027VectorSample {
  const safePeriod = Math.max(0.001, finiteOr(period, 0.001))
  const p = {
    x: finiteOr(localPosition.x, 0) / safePeriod,
    y: finiteOr(localPosition.y, 0) / safePeriod,
    z: finiteOr(localPosition.z, 0) / safePeriod,
  }
  const mirrored = { x: -p.x, y: p.y, z: p.z }
  const xA = coherentNoise1(p, seed + 11)
  const xB = coherentNoise1(mirrored, seed + 11)
  const yOffset = { x: 37.2, y: 17.1, z: 53.7 }
  const zOffset = { x: 71.9, y: 41.3, z: 29.4 }
  const yA = coherentNoise1(addVector(p, yOffset), seed + 23)
  const yB = coherentNoise1(addVector(mirrored, yOffset), seed + 23)
  const zA = coherentNoise1(addVector(p, zOffset), seed + 47)
  const zB = coherentNoise1(addVector(mirrored, zOffset), seed + 47)
  return {
    x: (xA - xB) * 0.5,
    y: (yA + yB) * 0.5,
    z: (zA + zB) * 0.5,
  }
}

export const FIRE_P027_FULLSCREEN_VERTEX_SHADER = `#version 300 es
precision highp float;
out vec2 vUV;
void main() {
  vec2 p = gl_VertexID == 0 ? vec2(-1.0, -1.0)
    : (gl_VertexID == 1 ? vec2(3.0, -1.0) : vec2(-1.0, 3.0));
  vUV = p * 0.5 + 0.5;
  gl_Position = vec4(p, 0.0, 1.0);
}`

export const FIRE_P027_STATE_FRAGMENT_SHADER = `#version 300 es
precision highp float;
precision highp int;
layout(location = 0) out vec4 oPositionAge;
layout(location = 1) out vec4 oGenerationLife;
layout(location = 2) out vec4 oVelocityOpacity;
layout(location = 3) out vec4 oControlRelay;

/* One fragment owns one particle slot. Four MRT outputs commit one atomic state. */
uniform sampler2D uOrigins;
uniform sampler2D uPreviousPositionAge;
uniform sampler2D uPreviousGenerationLife;
uniform sampler2D uPreviousVelocityOpacity;
uniform sampler2D uPreviousControlRelay;
uniform vec4 uSpawn;
uniform vec4 uTimeLife;
uniform vec4 uForceMass;
uniform vec4 uWindDrag;
uniform vec4 uTurbulence;
uniform vec4 uOriginCenter;
uniform vec4 uOriginDelta;
uniform vec4 uConfig;
uniform vec4 uGateLag;
uniform int uOriginCount;

float hash11(float value) {
  return fract(sin(value * 12.9898 + 78.233) * 43758.5453);
}

float hash31(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}

vec3 quintic(vec3 value) {
  return value * value * value * (value * (value * 6.0 - 15.0) + 10.0);
}

float coherentNoise1(vec3 p, float seed) {
  vec3 cell = floor(p);
  vec3 blend = quintic(fract(p));
  vec3 offset = vec3(seed * 19.19, seed * 7.73, seed * 31.17);
  float n000 = hash31(cell + vec3(0,0,0) + offset);
  float n100 = hash31(cell + vec3(1,0,0) + offset);
  float n010 = hash31(cell + vec3(0,1,0) + offset);
  float n110 = hash31(cell + vec3(1,1,0) + offset);
  float n001 = hash31(cell + vec3(0,0,1) + offset);
  float n101 = hash31(cell + vec3(1,0,1) + offset);
  float n011 = hash31(cell + vec3(0,1,1) + offset);
  float n111 = hash31(cell + vec3(1,1,1) + offset);
  float n00 = mix(n000, n100, blend.x);
  float n10 = mix(n010, n110, blend.x);
  float n01 = mix(n001, n101, blend.x);
  float n11 = mix(n011, n111, blend.x);
  return mix(mix(n00, n10, blend.y), mix(n01, n11, blend.y), blend.z) * 2.0 - 1.0;
}

vec3 coherentVectorNoise(vec3 p, float seed) {
  vec3 mirrored = vec3(-p.x, p.y, p.z);
  float xA = coherentNoise1(p, seed + 11.0);
  float xB = coherentNoise1(mirrored, seed + 11.0);
  float yA = coherentNoise1(p + vec3(37.2, 17.1, 53.7), seed + 23.0);
  float yB = coherentNoise1(mirrored + vec3(37.2, 17.1, 53.7), seed + 23.0);
  float zA = coherentNoise1(p + vec3(71.9, 41.3, 29.4), seed + 47.0);
  float zB = coherentNoise1(mirrored + vec3(71.9, 41.3, 29.4), seed + 47.0);
  return vec3((xA - xB) * 0.5, (yA + yB) * 0.5, (zA + zB) * 0.5);
}

int spawnOrdinal(int slot, int startSlot, int spawnCount, int slotCount) {
  if (spawnCount <= 0) return -1;
  int distance = slot - startSlot;
  if (distance < 0) distance += slotCount;
  return distance < spawnCount ? distance : -1;
}

void main() {
  int slot = int(gl_FragCoord.x);
  int slotCount = clamp(int(uTimeLife.z + 0.5), 1, 150);
  float dt = max(0.0, uTimeLife.x);
  float rawGate = clamp(uGateLag.x, 0.0, 1.0);
  vec4 previousRelay = texelFetch(uPreviousControlRelay, ivec2(slot, 0), 0);
  float lagSeconds = max(0.0, uGateLag.y);
  float lagAlpha = lagSeconds <= 1e-6 ? 1.0 : 1.0 - exp(-dt / lagSeconds);
  float laggedGate = uTimeLife.w > 0.5 ? rawGate : mix(previousRelay.g, rawGate, lagAlpha);
  vec4 nextRelay = vec4(rawGate, laggedGate, uSpawn.y, uTimeLife.w);

  vec4 nextPositionAge = vec4(0.0);
  vec4 nextGenerationLife = vec4(0.0);
  vec4 nextVelocityOpacity = vec4(0.0);
  if (slot < slotCount && uTimeLife.w <= 0.5) {
    vec4 previousPositionAge = texelFetch(uPreviousPositionAge, ivec2(slot, 0), 0);
    vec4 previousGenerationLife = texelFetch(uPreviousGenerationLife, ivec2(slot, 0), 0);
    vec4 previousVelocityOpacity = texelFetch(uPreviousVelocityOpacity, ivec2(slot, 0), 0);
    int startSlot = int(uSpawn.x + 0.5);
    int spawnCount = int(uSpawn.y + 0.5);
    int generationBase = int(uSpawn.z + 0.5);
    int ordinal = spawnOrdinal(slot, startSlot, spawnCount, slotCount);

    if (ordinal >= 0) {
      int generationInt = generationBase + ordinal;
      int originIndex = generationInt % max(1, uOriginCount);
      vec3 origin = texelFetch(uOrigins, ivec2(originIndex, 0), 0).rgb;
      float generation = float(generationInt);
      float lifetime = max(0.0001,
        uTimeLife.y + (hash11(generation + uConfig.x * 23.0) * 2.0 - 1.0) * max(0.0, uConfig.y));
      float birthAge = uConfig.w > 0.5 ? hash11(generation + uConfig.x * 61.0) * dt : 0.0;
      nextPositionAge = vec4(origin, birthAge);
      nextGenerationLife = vec4(generation, 1.0, uSpawn.w, lifetime);
      nextVelocityOpacity = vec4(0.0, 0.0, 0.0, 1.0);
    } else if (previousGenerationLife.g > 0.5) {
      float nextAge = previousPositionAge.a + dt;
      float lifetime = max(0.0001, previousGenerationLife.a);
      if (nextAge < lifetime) {
        float mass = uGateLag.z > 0.5 ? max(0.0001, uForceMass.w) : 1.0;
        float drag = uGateLag.w > 0.5 ? max(0.0, uWindDrag.w) : 0.0;
        vec3 translatedPosition = previousPositionAge.rgb + uOriginDelta.xyz;
        vec3 velocity = previousVelocityOpacity.rgb;
        vec3 acceleration = uForceMass.rgb / mass;
        acceleration += (uWindDrag.rgb - velocity) / mass;
        acceleration -= drag * velocity / mass;
        float period = max(0.001, uTurbulence.w);
        vec3 localPosition = translatedPosition - uOriginCenter.xyz;
        acceleration += coherentVectorNoise(localPosition / period, uConfig.x)
          * uTurbulence.rgb / mass;
        velocity += acceleration * dt;
        vec3 position = translatedPosition + velocity * dt;
        float opacity = pow(0.5, max(0.0, uConfig.z) * length(velocity));
        nextPositionAge = vec4(position, nextAge);
        nextGenerationLife = previousGenerationLife;
        nextVelocityOpacity = vec4(velocity, opacity);
      }
    }
  }
  oPositionAge = nextPositionAge;
  oGenerationLife = nextGenerationLife;
  oVelocityOpacity = nextVelocityOpacity;
  oControlRelay = nextRelay;
}`

export const FIRE_P027_GENERATOR_FRAGMENT_SHADER = `#version 300 es
precision highp float;
in vec2 vUV;
layout(location = 0) out vec4 fragColor;
uniform vec4 uGeneratorTimePreset;
uniform vec4 uGeneratorPresetA;
uniform vec4 uGeneratorPresetB;

float hash31(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}

float valueNoise(vec3 p, float seed) {
  p += vec3(seed * 0.173, seed * 0.071, seed * 0.319);
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float n000 = hash31(i + vec3(0,0,0));
  float n100 = hash31(i + vec3(1,0,0));
  float n010 = hash31(i + vec3(0,1,0));
  float n110 = hash31(i + vec3(1,1,0));
  float n001 = hash31(i + vec3(0,0,1));
  float n101 = hash31(i + vec3(1,0,1));
  float n011 = hash31(i + vec3(0,1,1));
  float n111 = hash31(i + vec3(1,1,1));
  float n00 = mix(n000, n100, f.x);
  float n10 = mix(n010, n110, f.x);
  float n01 = mix(n001, n101, f.x);
  float n11 = mix(n011, n111, f.x);
  return mix(mix(n00, n10, f.y), mix(n01, n11, f.y), f.z);
}

float fbm(vec3 p, float harmonics, float spread, float gain, float seed) {
  float sum = 0.0;
  float amplitude = 1.0;
  float norm = 0.0;
  for (int octave = 0; octave < 5; ++octave) {
    if (float(octave) >= harmonics) break;
    sum += amplitude * valueNoise(p, seed + float(octave) * 37.0);
    norm += amplitude;
    p = p * spread + vec3(17.1, 9.2, 13.7);
    amplitude *= gain;
  }
  return sum / max(norm, 1e-6);
}

vec3 rgbToHsv(vec3 c) {
  vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  float d = q.x - min(q.w, q.y);
  float e = 1.0e-10;
  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}

vec3 hsvToRgb(vec3 c) {
  vec3 p = abs(fract(c.xxx + vec3(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0);
  return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y);
}

void main() {
  float seconds = uGeneratorTimePreset.x;
  float preset = mod(floor(seconds * 2.0), 2.0);
  float period = mix(uGeneratorPresetA.x, uGeneratorPresetB.x, preset);
  float harmonics = mix(uGeneratorPresetA.y, uGeneratorPresetB.y, preset);
  float spread = mix(uGeneratorPresetA.z, uGeneratorPresetB.z, preset);
  float gain = mix(uGeneratorPresetA.w, uGeneratorPresetB.w, preset);
  float primarySeed = mix(1.0, 480.0, preset);
  float displacementSeed = mix(1.0, 181.0, preset);
  float displacementPeriod = mix(1.0, 2.0, preset);
  float displacementHarmonics = mix(2.0, 1.0, preset);
  float displacementSpread = mix(2.0, 20.0, preset);
  float displacementGain = mix(0.7, 0.34, preset);
  vec2 centered = vUV * 2.0 - vec2(1.0);
  vec3 displacementPosition = vec3(
    centered.x * displacementPeriod,
    (centered.y + seconds * 2.0) * displacementPeriod,
    seconds * displacementPeriod
  );
  vec2 displacement = vec2(
    fbm(displacementPosition, displacementHarmonics, displacementSpread,
      displacementGain, displacementSeed),
    fbm(displacementPosition + vec3(19.0, 7.0, 31.0),
      displacementHarmonics, displacementSpread, displacementGain,
      displacementSeed + 53.0)
  );
  displacement = mix(vec2(-0.6), vec2(1.0), displacement) * 0.16;
  vec2 warped = centered + displacement;
  float radial = clamp(1.0 - length(warped), 0.0, 1.0);
  vec3 primaryPosition = vec3(
    warped.x * period,
    (warped.y + seconds * 2.0) * period,
    seconds * period
  );
  vec3 multiplied = radial * vec3(
    fbm(primaryPosition, harmonics, spread, gain, primarySeed),
    fbm(primaryPosition + vec3(13.0, 29.0, 5.0), harmonics, spread, gain,
      primarySeed + 101.0),
    fbm(primaryPosition + vec3(41.0, 3.0, 23.0), harmonics, spread, gain,
      primarySeed + 211.0)
  );
  vec3 clamped = clamp(multiplied, vec3(0.0), vec3(1.0));
  float alpha = clamped.r;
  vec3 hsv = rgbToHsv(clamped);
  hsv.x = fract(hsv.x - 150.0 / 360.0);
  vec3 color = hsvToRgb(hsv) * 2.0;
  fragColor = vec4(color, alpha);
}`

export const FIRE_P027_RASTER_VERTEX_SHADER = `#version 300 es
precision highp float;
precision highp int;
layout(location = 0) in vec2 aCorner;
uniform sampler2D uPositionAge;
uniform sampler2D uGenerationLife;
uniform sampler2D uVelocityOpacity;
uniform sampler2D uControlRelay;
uniform vec4 uSizeOrthoSlots;
uniform vec4 uCssViewportLayers;
out vec2 vLocal;
out float vOpacity;
flat out int vLayer;
flat out float vAlive;

void main() {
  int slot = gl_InstanceID;
  vec4 generationLife = texelFetch(uGenerationLife, ivec2(slot, 0), 0);
  vAlive = generationLife.g;
  vLocal = aCorner;
  if (vAlive <= 0.5 || slot >= int(uSizeOrthoSlots.w + 0.5)) {
    gl_Position = vec4(2.0, 2.0, 0.0, 1.0);
    vOpacity = 0.0;
    vLayer = 0;
    return;
  }
  vec4 positionAge = texelFetch(uPositionAge, ivec2(slot, 0), 0);
  vec4 velocityOpacity = texelFetch(uVelocityOpacity, ivec2(slot, 0), 0);
  float sizeGate = clamp(texelFetch(uControlRelay, ivec2(0, 0), 0).g, 0.0, 1.0);
  vec2 cssViewport = max(uCssViewportLayers.xy, vec2(1.0));
  vec2 spriteOrthoSize = max(uSizeOrthoSlots.xy * sizeGate, vec2(1e-6));
  float aspect = cssViewport.x / cssViewport.y;
  float ortho = max(uSizeOrthoSlots.z, 1e-6);
  vec2 centerClip = vec2(
    positionAge.x * 2.0 / ortho,
    positionAge.y * 2.0 * aspect / ortho
  );
  vec2 spriteClipOffset = (aCorner - vec2(0.5)) * vec2(
    spriteOrthoSize.x * 2.0 / ortho,
    spriteOrthoSize.y * 2.0 * aspect / ortho
  );
  gl_Position = vec4(centerClip + spriteClipOffset, 0.0, 1.0);
  float phase = float(slot) / float(max(int(uSizeOrthoSlots.w + 0.5) - 1, 1)) * 60.0;
  float lifePhase = generationLife.a > 0.0 ? positionAge.a / generationLife.a * 60.0 : 0.0;
  vLayer = clamp(int(floor(phase + lifePhase + 0.5)), 0, max(int(uCssViewportLayers.z + 0.5) - 1, 0));
  vOpacity = clamp(velocityOpacity.a, 0.0, 1.0);
}`

export const FIRE_P027_RASTER_FRAGMENT_SHADER = `#version 300 es
precision highp float;
precision highp sampler2DArray;
in vec2 vLocal;
in float vOpacity;
flat in int vLayer;
flat in float vAlive;
uniform sampler2DArray uFireLayers;
uniform vec4 uTint;
layout(location = 0) out vec4 fragColor;
void main() {
  if (vAlive <= 0.5) discard;
  vec4 sprite = texture(uFireLayers, vec3(vLocal.x, 1.0 - vLocal.y, float(vLayer)));
  float safeOpacity = clamp(vOpacity, 0.0, 1.0);
  float tintAlpha = clamp(uTint.a, 0.0, 1.0);
  float sourceAlpha = clamp(sprite.a, 0.0, 1.0) * tintAlpha * safeOpacity;
  vec3 sourceRgb = max(sprite.rgb, vec3(0.0))
    * max(uTint.rgb, vec3(0.0)) * tintAlpha * safeOpacity;
  float sourceLuminance = dot(sourceRgb, vec3(${FIRE_P027_LUMA_R}, ${FIRE_P027_LUMA_G}, ${FIRE_P027_LUMA_B}));
  float correlatedAlpha = sourceAlpha
    * smoothstep(${FIRE_P027_ALPHA_LUMA_START}, ${FIRE_P027_ALPHA_LUMA_END}, sourceLuminance);
  fragColor = vec4(sourceRgb, correlatedAlpha);
}`

export const FIRE_P027_DISPLAY_FRAGMENT_SHADER = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D uAccumulatedFire;
layout(location = 0) out vec4 fragColor;
void main() {
  vec4 accumulated = texture(uAccumulatedFire, vUV);
  fragColor = clamp(accumulated, vec4(0.0), vec4(1.0));
}`

function coherentNoise1(
  position: Readonly<FireP027VectorSample>,
  seed: number
): number {
  const cell = {
    x: Math.floor(position.x),
    y: Math.floor(position.y),
    z: Math.floor(position.z),
  }
  const blend = {
    x: quintic(fract(position.x)),
    y: quintic(fract(position.y)),
    z: quintic(fract(position.z)),
  }
  const offset = { x: seed * 19.19, y: seed * 7.73, z: seed * 31.17 }
  const sample = (x: number, y: number, z: number) =>
    hash31({
      x: cell.x + x + offset.x,
      y: cell.y + y + offset.y,
      z: cell.z + z + offset.z,
    })
  const n000 = sample(0, 0, 0)
  const n100 = sample(1, 0, 0)
  const n010 = sample(0, 1, 0)
  const n110 = sample(1, 1, 0)
  const n001 = sample(0, 0, 1)
  const n101 = sample(1, 0, 1)
  const n011 = sample(0, 1, 1)
  const n111 = sample(1, 1, 1)
  const n00 = mixUnbounded(n000, n100, blend.x)
  const n10 = mixUnbounded(n010, n110, blend.x)
  const n01 = mixUnbounded(n001, n101, blend.x)
  const n11 = mixUnbounded(n011, n111, blend.x)
  return (
    mixUnbounded(
      mixUnbounded(n00, n10, blend.y),
      mixUnbounded(n01, n11, blend.y),
      blend.z
    ) *
      2 -
    1
  )
}

function hash31(position: Readonly<FireP027VectorSample>): number {
  const p = {
    x: fract(position.x * 0.1031),
    y: fract(position.y * 0.1031),
    z: fract(position.z * 0.1031),
  }
  const dot = p.x * (p.y + 33.33) + p.y * (p.z + 33.33) + p.z * (p.x + 33.33)
  p.x += dot
  p.y += dot
  p.z += dot
  return fract((p.x + p.y) * p.z)
}

function quintic(value: number): number {
  return value * value * value * (value * (value * 6 - 15) + 10)
}

function addVector(
  left: Readonly<FireP027VectorSample>,
  right: Readonly<FireP027VectorSample>
): FireP027VectorSample {
  return {
    x: left.x + right.x,
    y: left.y + right.y,
    z: left.z + right.z,
  }
}

function mixUnbounded(left: number, right: number, amount: number): number {
  return left * (1 - amount) + right * amount
}

function fract(value: number): number {
  return value - Math.floor(value)
}

function luminance(
  color: Readonly<{ r: number; g: number; b: number }>
): number {
  return (
    color.r * FIRE_P027_LUMA_R +
    color.g * FIRE_P027_LUMA_G +
    color.b * FIRE_P027_LUMA_B
  )
}

function rgbHueDegrees(r: number, g: number, b: number): number {
  const maximum = Math.max(r, g, b)
  const minimum = Math.min(r, g, b)
  const delta = maximum - minimum
  if (delta === 0) return 0
  const sector =
    maximum === r
      ? ((g - b) / delta) % 6
      : maximum === g
        ? (b - r) / delta + 2
        : (r - g) / delta + 4
  return (((sector * 60) % 360) + 360) % 360
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = clamp01((finiteOr(value, edge0) - edge0) / (edge1 - edge0))
  return t * t * (3 - 2 * t)
}

function nonNegative(value: number): number {
  return Math.max(0, finiteOr(value, 0))
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, finiteOr(value, 0)))
}

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback
}
