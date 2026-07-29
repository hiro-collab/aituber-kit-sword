import {
  THUNDER_WEBGL2_CANDIDATE_COUNT,
  THUNDER_WEBGL2_RIBBON_SAMPLE_COUNT,
  THUNDER_WEBGL2_SAMPLE_WIDTH_LIMIT,
  THUNDER_WEBGL2_SOURCE_COUNT,
  THUNDER_WEBGL2_STAGE53_PROFILE,
  type ThunderWebGl2Candidate,
  type ThunderWebGl2Connection,
  type ThunderWebGl2Point,
  type ThunderWebGl2RibbonSample,
  type ThunderWebGl2SourceBirth,
  type ThunderWebGl2Tone,
  type ThunderWebGl2Topology,
} from './contracts'

export interface ThunderWebGl2TopologyOptions {
  seed: number
  nowMs: number
  center?: Readonly<ThunderWebGl2Point>
  radius?: number
  reducedMotion?: boolean
  aspect?: number
  retainedSources?: readonly Readonly<ThunderWebGl2SourceBirth>[]
  widthScale?: number
  wrinkleScale?: number
}

export interface ThunderWebGl2RibbonOptions {
  seed: number
  crackleEpoch: number
  sampleCount?: number
  /** Compatibility input; sampleCount is the recipe-facing boundary. */
  segmentCount?: number
  haloWidth?: number
  displacement?: number
  reducedMotion?: boolean
  sourceBirth?: Readonly<ThunderWebGl2SourceBirth>
  nowMs?: number
  aspect?: number
  widthScale?: number
  wrinkleScale?: number
}

const NORMAL_CADENCE_MS = 10
const REDUCED_CADENCE_MS = 20
const SOURCE_BIRTH_INTERVAL_MS = 10
const NORMAL_SOURCE_LIFE_MS = 213
const REDUCED_SOURCE_LIFE_MS = 320
const PARTICLE_TAG_PERIOD = 1024
const TAU = Math.PI * 2

type Vec3 = readonly [number, number, number]

export const THUNDER_WEBGL2_STAGE53_SPHERE = Object.freeze([
  [0, 0, 0.400000006],
  [0.199999988, -0.064984061, 0.340260327],
  [0, -0.210292503, 0.340260327],
  [0.340260357, -0.110557482, 0.178885281],
  [0.199999988, -0.275276542, 0.210292235],
  [0, -0.35777095, 0.178885251],
  [0.123606801, 0.170130163, 0.340260357],
  [0.210292488, 0.289442778, 0.178885326],
  [0.323606908, 0.105146155, 0.210292324],
  [-0.123606801, 0.170130163, 0.340260357],
  [-0.210292488, 0.289442778, 0.178885326],
  [0, 0.340260416, 0.21029231],
  [-0.199999988, -0.064984061, 0.340260327],
  [-0.340260357, -0.110557482, 0.178885281],
  [-0.323606908, 0.105146155, 0.210292324],
  [-0.199999988, -0.275276542, 0.210292235],
  [-0.123606794, -0.380422652, 0],
  [-0.210292488, -0.289442778, -0.178885326],
  [-0.32360673, -0.235114172, 0],
  [-0.400000006, 0, 0],
  [-0.340260357, 0.110557482, -0.178885281],
  [-0.32360673, 0.235114172, 0],
  [-0.123606794, 0.380422652, 0],
  [0, 0.35777095, -0.178885251],
  [0.123606794, 0.380422652, 0],
  [0.32360673, 0.235114172, 0],
  [0.340260357, 0.110557482, -0.178885281],
  [0.400000006, 0, 0],
  [0.32360673, -0.235114172, 0],
  [0.210292488, -0.289442778, -0.178885326],
  [0.123606794, -0.380422652, 0],
  [0, -0.340260416, -0.21029231],
  [-0.323606908, -0.105146155, -0.210292324],
  [-0.199999988, 0.275276542, -0.210292235],
  [0.199999988, 0.275276542, -0.210292235],
  [0.323606908, -0.105146155, -0.210292324],
  [0, 0, -0.400000006],
  [-0.123606801, -0.170130163, -0.340260357],
  [0.123606801, -0.170130163, -0.340260357],
  [0.199999988, 0.064984061, -0.340260327],
  [0, 0.210292503, -0.340260327],
  [-0.199999988, 0.064984061, -0.340260327],
] as const satisfies readonly Vec3[])

export function thunderWebGl2CadenceMs(reducedMotion: boolean): number {
  return reducedMotion ? REDUCED_CADENCE_MS : NORMAL_CADENCE_MS
}

export function resolveThunderWebGl2Tone(
  reducedMotion: boolean
): ThunderWebGl2Tone {
  const motionScale = reducedMotion ? 0.72 : 1
  return Object.freeze({
    coreWidth: 0.1,
    haloWidth: 0.72,
    coreLuminance: 1,
    haloLuminance: 0,
    bloomGain: THUNDER_WEBGL2_STAGE53_PROFILE.bloomLevel * motionScale,
    exposure: THUNDER_WEBGL2_STAGE53_PROFILE.intensity,
    gamma: THUNDER_WEBGL2_STAGE53_PROFILE.gamma,
    feedback: THUNDER_WEBGL2_STAGE53_PROFILE.temporalSmooth,
    pulse: 0,
    contrast: THUNDER_WEBGL2_STAGE53_PROFILE.contrast,
    glowColor: THUNDER_WEBGL2_STAGE53_PROFILE.glowColor,
    glowLevel: THUNDER_WEBGL2_STAGE53_PROFILE.glowLevel * motionScale,
    inputLevel: THUNDER_WEBGL2_STAGE53_PROFILE.inputLevel,
    intensity: THUNDER_WEBGL2_STAGE53_PROFILE.intensity,
    rampLevel: THUNDER_WEBGL2_STAGE53_PROFILE.rampLevel * motionScale,
  })
}

export function createThunderWebGl2Topology(
  options: Readonly<ThunderWebGl2TopologyOptions>
): ThunderWebGl2Topology {
  const seed = integerOr(options.seed, 1)
  const nowMs = Math.max(0, finiteOr(options.nowMs, 0))
  const reducedMotion = options.reducedMotion === true
  const cadenceMs = thunderWebGl2CadenceMs(reducedMotion)
  const epoch = Math.floor(nowMs / cadenceMs)
  const bornAtMs = epoch * cadenceMs
  const aspect = clamp(finiteOr(options.aspect, 1), 0.25, 4)
  const center = finitePoint(options.center ?? { x: 0, y: 0 })
  const radius = clamp(
    finiteOr(options.radius, THUNDER_WEBGL2_STAGE53_PROFILE.radius),
    0.05,
    1.5
  )
  const widthScale = clamp(finiteOr(options.widthScale, 1), 0.1, 4)
  const wrinkleScale = clamp(finiteOr(options.wrinkleScale, 1), 0, 4)
  const centerWorld = outputCenterToWorld(center, aspect)
  const candidates = createCandidates(centerWorld, radius, nowMs / 1000, aspect)
  const provisionalSources = createSourceBirths(
    centerWorld,
    radius,
    nowMs,
    reducedMotion,
    aspect,
    options.retainedSources ?? []
  )
  const connections = provisionalSources.map((source, sourceIndex) => {
    const qIndex = nearestCandidateIndex(candidates, source)
    const target = candidates[qIndex] as ThunderWebGl2Candidate
    const ribbon = createThunderWebGl2Ribbon(source, target, {
      seed: sourceIndex + 1,
      crackleEpoch: epoch,
      nowMs,
      aspect,
      widthScale,
      wrinkleScale,
      reducedMotion,
      sourceBirth: source,
    })
    const frameSource = ribbon[0]?.sourceBirth ?? source
    return Object.freeze({
      pIndex: source.index,
      qIndex,
      source: frameSource,
      target,
      bornAtMs: frameSource.bornAtMs,
      lifeMs: frameSource.lifeMs,
      seed: sourceIndex + 1,
      ribbon,
    } satisfies ThunderWebGl2Connection)
  })
  const sources = connections.map((connection) => connection.source)

  return Object.freeze({
    seed,
    epoch,
    bornAtMs,
    cadenceMs,
    candidates: Object.freeze(candidates),
    sources: Object.freeze(sources),
    connections: Object.freeze(connections),
  })
}

export function createThunderWebGl2Ribbon(
  sourceValue: Readonly<ThunderWebGl2Point>,
  targetValue: Readonly<ThunderWebGl2Point>,
  options: Readonly<ThunderWebGl2RibbonOptions>
): readonly ThunderWebGl2RibbonSample[] {
  const source = finitePoint3(sourceValue)
  const target = finitePoint3(targetValue)
  const hasWorld =
    hasFiniteWorldPoint(sourceValue) && hasFiniteWorldPoint(targetValue)
  const sampleCount = boundedInteger(
    options.sampleCount ??
      (options.segmentCount === undefined
        ? THUNDER_WEBGL2_RIBBON_SAMPLE_COUNT
        : options.segmentCount + 1),
    3,
    61
  )
  const segmentCount = sampleCount - 1
  const nowMs = Math.max(0, finiteOr(options.nowMs, options.crackleEpoch * 10))
  const aspect = clamp(finiteOr(options.aspect, 1), 0.25, 4)
  const widthScale = clamp(finiteOr(options.widthScale, 1), 0.1, 4)
  const wrinkleScale = clamp(finiteOr(options.wrinkleScale, 1), 0, 4)
  const dx = target[0] - source[0]
  const dy = target[1] - source[1]
  const dz = target[2] - source[2]
  const length = Math.max(1e-6, Math.hypot(dx, dy, dz))
  const axis: Vec3 = [dx / length, dy / length, dz / length]
  const seed = integerOr(options.seed, 1)
  const sourceProjected = hasWorld
    ? projectPoint(source, aspect)
    : ([source[0], source[1]] as const)
  const targetProjected = hasWorld
    ? projectPoint(target, aspect)
    : ([target[0], target[1]] as const)

  return Object.freeze(
    Array.from({ length: sampleCount }, (_, column) => {
      const along = column / segmentCount
      const noise = centerlineNoise(
        along,
        seed,
        axis,
        nowMs / 1000,
        wrinkleScale
      )
      const centerWorld: Vec3 = [
        source[0] + dx * along + noise[0],
        source[1] + dy * along + noise[1],
        source[2] + dz * along + noise[2],
      ]
      const signedWidth = signedRowOffset(column, nowMs / 1000) * widthScale
      const row0: Vec3 = [
        centerWorld[0] - signedWidth,
        centerWorld[1] - signedWidth,
        centerWorld[2] - signedWidth,
      ]
      const row1: Vec3 = [
        centerWorld[0] + signedWidth,
        centerWorld[1] + signedWidth,
        centerWorld[2] + signedWidth,
      ]
      const left = hasWorld
        ? projectPoint(row0, aspect)
        : ([
            centerWorld[0] - signedWidth,
            centerWorld[1] - signedWidth,
          ] as const)
      const right = hasWorld
        ? projectPoint(row1, aspect)
        : ([
            centerWorld[0] + signedWidth,
            centerWorld[1] + signedWidth,
          ] as const)
      const centerX = (left[0] + right[0]) * 0.5
      const centerY = (left[1] + right[1]) * 0.5
      const baselineX =
        sourceProjected[0] + (targetProjected[0] - sourceProjected[0]) * along
      const baselineY =
        sourceProjected[1] + (targetProjected[1] - sourceProjected[1]) * along
      const displacement = signedDistance(
        centerX - baselineX,
        centerY - baselineY,
        targetProjected[0] - sourceProjected[0],
        targetProjected[1] - sourceProjected[1]
      )
      const width = clamp(
        Math.hypot(right[0] - left[0], right[1] - left[1]) * 0.5,
        0,
        THUNDER_WEBGL2_SAMPLE_WIDTH_LIMIT
      )
      const sourceBirth =
        column === 0 && options.sourceBirth
          ? Object.freeze({
              ...options.sourceBirth,
              x: centerX,
              y: centerY,
            })
          : undefined
      return Object.freeze({
        along,
        centerX,
        centerY,
        displacement,
        leftX: left[0],
        leftY: left[1],
        rightX: right[0],
        rightY: right[1],
        width,
        sourceBirth,
      })
    })
  )
}

export function nearestThunderWebGl2Candidate(
  candidates: readonly Readonly<ThunderWebGl2Candidate>[],
  sourceValue: number | Readonly<ThunderWebGl2Point>
): Readonly<ThunderWebGl2Candidate> | null {
  if (
    typeof sourceValue === 'number' &&
    (sourceValue < 0 || sourceValue >= candidates.length)
  ) {
    return null
  }
  const qIndex = nearestCandidateIndex(candidates, sourceValue)
  return candidates[qIndex] ?? null
}

function createCandidates(
  center: Vec3,
  radius: number,
  seconds: number,
  aspect: number
): ThunderWebGl2Candidate[] {
  const radiusScale = radius / THUNDER_WEBGL2_STAGE53_PROFILE.radius
  const angles = THUNDER_WEBGL2_STAGE53_PROFILE.spinDegreesPerSecond.map(
    (speed) => radians(speed * seconds)
  ) as readonly number[]
  return THUNDER_WEBGL2_STAGE53_SPHERE.map((point, index) => {
    let rotated: Vec3 = [
      point[0] * radiusScale,
      point[1] * radiusScale,
      point[2] * radiusScale,
    ]
    rotated = rotateX(rotated, angles[0] ?? 0)
    rotated = rotateY(rotated, angles[1] ?? 0)
    rotated = rotateZ(rotated, angles[2] ?? 0)
    const world: Vec3 = [
      rotated[0] + center[0],
      rotated[1] + center[1],
      rotated[2] + center[2],
    ]
    const projected = projectPoint(world, aspect)
    return Object.freeze({
      index,
      x: projected[0],
      y: projected[1],
      z: world[2],
      worldX: world[0],
      worldY: world[1],
      worldZ: world[2],
    })
  })
}

function createSourceBirths(
  center: Vec3,
  radius: number,
  sampleNowMs: number,
  reducedMotion: boolean,
  aspect: number,
  retainedSources: readonly Readonly<ThunderWebGl2SourceBirth>[]
): ThunderWebGl2SourceBirth[] {
  const newestBirthId = Math.floor(sampleNowMs / SOURCE_BIRTH_INTERVAL_MS)
  const lifeMs = reducedMotion ? REDUCED_SOURCE_LIFE_MS : NORMAL_SOURCE_LIFE_MS
  const retained = new Map<number, Readonly<ThunderWebGl2SourceBirth>>()
  for (const source of retainedSources) {
    if (Number.isInteger(source.birthId))
      retained.set(source.birthId as number, source)
  }
  return Array.from({ length: THUNDER_WEBGL2_SOURCE_COUNT }, (_, index) => {
    const birthId = newestBirthId - index
    const birthTimeSeconds = birthId * 0.01
    const bornAtMs = Math.max(0, birthId * SOURCE_BIRTH_INTERVAL_MS)
    const ageSeconds = clamp(
      sampleNowMs / 1000 - birthTimeSeconds,
      0,
      lifeMs / 1000
    )
    const previous = retained.get(birthId)
    const birthOrigin =
      retainedBirthOrigin(previous) ??
      freshParticleBirthSource(birthId, center, radius, birthTimeSeconds)
    const world = proceduralParticle(
      birthId,
      birthOrigin,
      ageSeconds,
      reducedMotion
    )
    const projected = projectPoint(world, aspect)
    return Object.freeze({
      index,
      birthId,
      birthTag: particleStateTag(birthId),
      birthOriginX: birthOrigin[0],
      birthOriginY: birthOrigin[1],
      birthOriginZ: birthOrigin[2],
      x: projected[0],
      y: projected[1],
      z: world[2],
      worldX: world[0],
      worldY: world[1],
      worldZ: world[2],
      bornAtMs,
      lifeMs,
      ageMs: ageSeconds * 1000,
      radius: clamp(
        THUNDER_WEBGL2_STAGE53_PROFILE.ribbonWidth * 0.25,
        0.001,
        0.12
      ),
      energy: 1,
    })
  })
}

function freshParticleBirthSource(
  birthId: number,
  center: Vec3,
  radius: number,
  birthTimeSeconds: number
): Vec3 {
  const sourceIndex = positiveModulo(
    birthId * 17 + 11,
    THUNDER_WEBGL2_CANDIDATE_COUNT
  )
  const candidates = createCandidates(center, radius, birthTimeSeconds, 1)
  const selected = candidates[sourceIndex] as ThunderWebGl2Candidate
  return [selected.worldX ?? 0, selected.worldY ?? 0, selected.worldZ ?? 0]
}

function proceduralParticle(
  birthId: number,
  source: Vec3,
  age: number,
  reducedMotion: boolean
): Vec3 {
  const randomVector = normalize3(
    hash31(birthId + 1).map((value) => value * 2 - 1) as unknown as Vec3
  )
  const speedScale = reducedMotion ? 0.65 : 1
  const acceleration = mix(105, 185, hash11(birthId + 91.7)) * speedScale
  const integratedDrag = age - 1 + Math.exp(-age)
  const bend = hash31(Math.floor(birthId * 0.37) + 203).map(
    (value) => value * 2 - 1
  ) as unknown as Vec3
  return [
    source[0] +
      randomVector[0] * acceleration * integratedDrag +
      bend[0] * age * age * 18 * speedScale,
    source[1] +
      randomVector[1] * acceleration * integratedDrag +
      bend[1] * age * age * 18 * speedScale,
    source[2] +
      randomVector[2] * acceleration * integratedDrag +
      bend[2] * age * age * 18 * speedScale,
  ]
}

function centerlineNoise(
  along: number,
  seed: number,
  lineAxis: Vec3,
  seconds: number,
  wrinkleScale: number
): Vec3 {
  const spatialFrequency = THUNDER_WEBGL2_STAGE53_PROFILE.centerFrequency
  const timeCoordinate =
    seconds * THUNDER_WEBGL2_STAGE53_PROFILE.noiseSpeed + seed * 0.173
  const value: Vec3 = [
    endpointConstrainedNoise(along, seed, 0, timeCoordinate, spatialFrequency),
    endpointConstrainedNoise(along, seed, 1, timeCoordinate, spatialFrequency),
    endpointConstrainedNoise(along, seed, 2, timeCoordinate, spatialFrequency),
  ]
  const projection = dot3(value, lineAxis)
  const parallel: Vec3 = lineAxis.map(
    (axis) => axis * projection
  ) as unknown as Vec3
  const perpendicular: Vec3 = value.map(
    (component, index) => component - (parallel[index] ?? 0)
  ) as unknown as Vec3
  const lateralGain = THUNDER_WEBGL2_STAGE53_PROFILE.gainLateral / 0.054
  const perpendicularGain =
    THUNDER_WEBGL2_STAGE53_PROFILE.gainPerpendicular / 0.604
  return value.map(
    (_, index) =>
      ((parallel[index] ?? 0) * lateralGain +
        (perpendicular[index] ?? 0) * perpendicularGain) *
      THUNDER_WEBGL2_STAGE53_PROFILE.noiseAmount *
      wrinkleScale
  ) as unknown as Vec3
}

function endpointConstrainedNoise(
  along: number,
  seed: number,
  channel: number,
  timeCoordinate: number,
  spatialFrequency: number
): number {
  const startValue = hermiteValueNoise(timeCoordinate, seed, channel)
  const endValue = hermiteValueNoise(
    timeCoordinate + spatialFrequency,
    seed,
    channel
  )
  const value = hermiteValueNoise(
    timeCoordinate + along * spatialFrequency,
    seed,
    channel
  )
  return value - mix(startValue, endValue, along)
}

function hermiteValueNoise(
  coordinate: number,
  seed: number,
  channel: number
): number {
  const cell = Math.floor(coordinate)
  const fraction = fract(coordinate)
  const hermite = fraction * fraction * (3 - 2 * fraction)
  return mix(
    hashValue(cell, seed, channel),
    hashValue(cell + 1, seed, channel),
    hermite
  )
}

function hashValue(lattice: number, seed: number, channel: number): number {
  return (
    fract(
      Math.sin(lattice * 127.1 + seed * 311.7 + channel * 74.7) * 43758.5453123
    ) *
      2 -
    1
  )
}

function signedRowOffset(column: number, seconds: number): number {
  const sampleIndex = column
  const fastRamp = fract(
    seconds * THUNDER_WEBGL2_STAGE53_PROFILE.wrinkleSpeed + 0.192666
  )
  const sineWave = 0.15 + Math.sin(TAU * (sampleIndex / 36 - fastRamp))
  const slowLfo = Math.sin(
    TAU * THUNDER_WEBGL2_STAGE53_PROFILE.wrinkleDrift * seconds - 2.608
  )
  const normalCoordinate = wrappedDistance(sampleIndex / 60 - slowLfo - 0.5)
  const sigma = Math.max(0.02, THUNDER_WEBGL2_STAGE53_PROFILE.wrinkleSigma)
  const normalBase =
    0.925 *
      Math.exp((-0.5 * normalCoordinate * normalCoordinate) / (sigma * sigma)) -
    0.1
  const normalWave = Math.max(0, 0.4 + 0.71 * normalBase)
  return (
    sineWave *
    Math.pow(normalWave, 3.19) *
    -THUNDER_WEBGL2_STAGE53_PROFILE.ribbonWidth
  )
}

function nearestCandidateIndex(
  candidates: readonly Readonly<ThunderWebGl2Candidate>[],
  sourceValue: number | Readonly<ThunderWebGl2Point>
): number {
  const source =
    typeof sourceValue === 'number' ? candidates[sourceValue] : sourceValue
  if (!source) return 0
  const source3 = finitePoint3(source)
  let bestIndex = 0
  let bestDistance = Number.POSITIVE_INFINITY
  for (const candidate of candidates) {
    if (typeof sourceValue === 'number' && candidate.index === sourceValue)
      continue
    const point = finitePoint3(candidate)
    const dx = point[0] - source3[0]
    const dy = point[1] - source3[1]
    const dz = point[2] - source3[2]
    const distance = dx * dx + dy * dy + dz * dz
    if (
      distance < bestDistance ||
      (distance === bestDistance && candidate.index < bestIndex)
    ) {
      bestIndex = candidate.index
      bestDistance = distance
    }
  }
  return bestIndex
}

function outputCenterToWorld(center: ThunderWebGl2Point, aspect: number): Vec3 {
  const depth = THUNDER_WEBGL2_STAGE53_PROFILE.projectionDepth
  const focal =
    1 / Math.tan(radians(THUNDER_WEBGL2_STAGE53_PROFILE.fovDegrees) * 0.5)
  const cameraDistance = depth * 2
  return [
    (center.x * cameraDistance * aspect) / focal,
    (center.y * cameraDistance) / focal,
    -depth,
  ]
}

function projectPoint(point: Vec3, aspect: number): readonly [number, number] {
  const focal =
    1 / Math.tan(radians(THUNDER_WEBGL2_STAGE53_PROFILE.fovDegrees) * 0.5)
  const distance = Math.max(
    0.1,
    THUNDER_WEBGL2_STAGE53_PROFILE.projectionDepth - point[2]
  )
  return [
    (point[0] * focal) / (aspect * distance),
    (point[1] * focal) / distance,
  ]
}

function retainedBirthOrigin(
  source: Readonly<ThunderWebGl2SourceBirth> | undefined
): Vec3 | null {
  if (!source) return null
  const values = [source.birthOriginX, source.birthOriginY, source.birthOriginZ]
  return values.every(
    (value) => typeof value === 'number' && Number.isFinite(value)
  )
    ? [values[0] as number, values[1] as number, values[2] as number]
    : null
}

function particleStateTag(birthId: number): number {
  return positiveModulo(birthId, PARTICLE_TAG_PERIOD) + 1
}

function positiveModulo(value: number, period: number): number {
  const remainder = value % period
  return remainder < 0 ? remainder + period : remainder
}

function hash11(value: number): number {
  let hashed = fract(value * 0.1031)
  hashed *= hashed + 33.33
  hashed *= hashed + hashed
  return fract(hashed)
}

function hash31(value: number): Vec3 {
  return [hash11(value + 3.17), hash11(value + 17.71), hash11(value + 47.53)]
}

function rotateX(point: Vec3, angle: number): Vec3 {
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  return [point[0], c * point[1] - s * point[2], s * point[1] + c * point[2]]
}

function rotateY(point: Vec3, angle: number): Vec3 {
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  return [c * point[0] + s * point[2], point[1], -s * point[0] + c * point[2]]
}

function rotateZ(point: Vec3, angle: number): Vec3 {
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  return [c * point[0] - s * point[1], s * point[0] + c * point[1], point[2]]
}

function hasFiniteWorldPoint(point: Readonly<ThunderWebGl2Point>): boolean {
  return [point.worldX, point.worldY, point.worldZ].every(
    (value) => typeof value === 'number' && Number.isFinite(value)
  )
}

function finitePoint(point: Readonly<ThunderWebGl2Point>): ThunderWebGl2Point {
  return {
    x: finiteOr(point.x, 0),
    y: finiteOr(point.y, 0),
    z: finiteOr(point.z, 0),
  }
}

function finitePoint3(point: Readonly<ThunderWebGl2Point>): Vec3 {
  if (hasFiniteWorldPoint(point)) {
    return [
      point.worldX as number,
      point.worldY as number,
      point.worldZ as number,
    ]
  }
  return [finiteOr(point.x, 0), finiteOr(point.y, 0), finiteOr(point.z, 0)]
}

function normalize3(point: Vec3): Vec3 {
  const length = Math.max(1e-5, Math.hypot(point[0], point[1], point[2]))
  return [point[0] / length, point[1] / length, point[2] / length]
}

function dot3(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

function signedDistance(
  dx: number,
  dy: number,
  axisX: number,
  axisY: number
): number {
  const length = Math.max(1e-6, Math.hypot(axisX, axisY))
  return (-axisY * dx + axisX * dy) / length
}

function wrappedDistance(value: number): number {
  return fract(value + 0.5) - 0.5
}

function fract(value: number): number {
  return value - Math.floor(value)
}

function radians(value: number): number {
  return (value * Math.PI) / 180
}

function mix(start: number, end: number, amount: number): number {
  return start + (end - start) * amount
}

function integerOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? Math.round(value) : fallback
}

function boundedInteger(
  value: number,
  minimum: number,
  maximum: number
): number {
  return Math.round(clamp(finiteOr(value, minimum), minimum, maximum))
}

function finiteOr(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}
