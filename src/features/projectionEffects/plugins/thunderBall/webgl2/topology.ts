import {
  THUNDER_WEBGL2_CANDIDATE_COUNT,
  THUNDER_WEBGL2_RIBBON_SAMPLE_COUNT,
  THUNDER_WEBGL2_SOURCE_COUNT,
  type ThunderWebGl2Candidate,
  type ThunderWebGl2Connection,
  type ThunderWebGl2Point,
  type ThunderWebGl2RibbonSample,
  type ThunderWebGl2Tone,
  type ThunderWebGl2Topology,
} from './contracts'

export interface ThunderWebGl2TopologyOptions {
  seed: number
  nowMs: number
  center?: Readonly<ThunderWebGl2Point>
  radius?: number
  reducedMotion?: boolean
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
}

const NORMAL_CADENCE_MS = 96
const REDUCED_CADENCE_MS = 192

export function thunderWebGl2CadenceMs(reducedMotion: boolean): number {
  return reducedMotion ? REDUCED_CADENCE_MS : NORMAL_CADENCE_MS
}

export function resolveThunderWebGl2Tone(
  reducedMotion: boolean
): ThunderWebGl2Tone {
  return Object.freeze({
    coreWidth: reducedMotion ? 0.12 : 0.1,
    haloWidth: reducedMotion ? 0.58 : 0.72,
    coreLuminance: reducedMotion ? 1.7 : 2.4,
    haloLuminance: reducedMotion ? 0.48 : 0.82,
    feedback: reducedMotion ? 0.32 : 0.72,
    pulse: reducedMotion ? 0.06 : 0.18,
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
  const center = finitePoint(options.center ?? { x: 0, y: 0 })
  const radius = clamp(finiteOr(options.radius, 0.72), 0.05, 1.5)
  const random = mulberry32(mixSeed(seed, epoch, 0x54484e44))
  const candidates = createCandidates(center, radius, random)
  const sourceOrder = shuffledIndices(
    THUNDER_WEBGL2_CANDIDATE_COUNT,
    random
  ).slice(0, THUNDER_WEBGL2_SOURCE_COUNT)
  const tone = resolveThunderWebGl2Tone(reducedMotion)
  const connections = sourceOrder.map((pIndex, sourceOrderIndex) => {
    const qIndex = nearestCandidateIndex(candidates, pIndex)
    const connectionSeed = mixSeed(seed, epoch, sourceOrderIndex + 1)
    const lifeRandom = mulberry32(connectionSeed)()
    const source = candidates[pIndex] as ThunderWebGl2Candidate
    const target = candidates[qIndex] as ThunderWebGl2Candidate
    return Object.freeze({
      pIndex,
      qIndex,
      source,
      target,
      bornAtMs,
      lifeMs: (reducedMotion ? 280 : 180) + lifeRandom * 220,
      seed: connectionSeed,
      ribbon: createThunderWebGl2Ribbon(source, target, {
        seed: connectionSeed,
        crackleEpoch: epoch,
        haloWidth: tone.haloWidth * 0.028,
        displacement: reducedMotion ? 0.035 : 0.075,
        reducedMotion,
      }),
    } satisfies ThunderWebGl2Connection)
  })

  return Object.freeze({
    seed,
    epoch,
    bornAtMs,
    cadenceMs,
    candidates: Object.freeze(candidates),
    connections: Object.freeze(connections),
  })
}

export function createThunderWebGl2Ribbon(
  sourceValue: Readonly<ThunderWebGl2Point>,
  targetValue: Readonly<ThunderWebGl2Point>,
  options: Readonly<ThunderWebGl2RibbonOptions>
): readonly ThunderWebGl2RibbonSample[] {
  const source = finitePoint(sourceValue)
  const target = finitePoint(targetValue)
  const sampleCount = boundedInteger(
    options.sampleCount ??
      (options.segmentCount === undefined
        ? THUNDER_WEBGL2_RIBBON_SAMPLE_COUNT
        : options.segmentCount + 1),
    3,
    61
  )
  const segmentCount = sampleCount - 1
  const dx = target.x - source.x
  const dy = target.y - source.y
  const length = Math.max(1e-6, Math.hypot(dx, dy))
  const perpendicularX = -dy / length
  const perpendicularY = dx / length
  const haloWidth = clamp(finiteOr(options.haloWidth, 0.02), 0, 0.12)
  const displacement = clamp(finiteOr(options.displacement, 0.075), 0, 0.25)
  const seedPhase = hashUnit(mixSeed(options.seed, options.crackleEpoch, 17))
  const crackleRandom = mulberry32(
    mixSeed(options.seed, options.crackleEpoch, 29)
  )
  const crackle = Array.from(
    { length: segmentCount + 1 },
    () => crackleRandom() * 2 - 1
  )

  return Object.freeze(
    Array.from({ length: segmentCount + 1 }, (_, index) => {
      const along = index / segmentCount
      const endpointEnvelope = Math.sin(Math.PI * along)
      const octaveOne = Math.sin(
        along * Math.PI * 5.2 + seedPhase * Math.PI * 2
      )
      const octaveTwo =
        Math.sin(along * Math.PI * 13.6 + seedPhase * Math.PI * 5.3) * 0.42
      const octaveThree =
        Math.sin(along * Math.PI * 31.4 + seedPhase * Math.PI * 9.1) * 0.18
      const crackleValue =
        ((crackle[index] ?? 0) * 0.7 +
          (crackle[Math.max(0, index - 1)] ?? 0) * 0.3) *
        0.28
      const motionScale = options.reducedMotion ? 0.45 : 1
      const lateralDisplacement =
        index === 0 || index === segmentCount
          ? 0
          : length *
            displacement *
            motionScale *
            endpointEnvelope *
            (octaveOne + octaveTwo + octaveThree + crackleValue)
      const centerX =
        index === 0
          ? source.x
          : index === segmentCount
            ? target.x
            : source.x + dx * along + perpendicularX * lateralDisplacement
      const centerY =
        index === 0
          ? source.y
          : index === segmentCount
            ? target.y
            : source.y + dy * along + perpendicularY * lateralDisplacement
      const taper =
        index === 0 || index === segmentCount
          ? 0
          : Math.pow(Math.max(0, endpointEnvelope), 0.72)
      const width = haloWidth * taper

      return Object.freeze({
        along,
        centerX,
        centerY,
        displacement: lateralDisplacement,
        leftX: centerX + perpendicularX * width,
        leftY: centerY + perpendicularY * width,
        rightX: centerX - perpendicularX * width,
        rightY: centerY - perpendicularY * width,
        width,
      })
    })
  )
}

export function nearestThunderWebGl2Candidate(
  candidates: readonly Readonly<ThunderWebGl2Candidate>[],
  pIndex: number
): Readonly<ThunderWebGl2Candidate> | null {
  if (pIndex < 0 || pIndex >= candidates.length) return null
  const qIndex = nearestCandidateIndex(candidates, pIndex)
  return candidates[qIndex] ?? null
}

function createCandidates(
  center: Readonly<ThunderWebGl2Point>,
  radius: number,
  random: () => number
): ThunderWebGl2Candidate[] {
  const goldenAngle = Math.PI * (3 - Math.sqrt(5))
  return Array.from({ length: THUNDER_WEBGL2_CANDIDATE_COUNT }, (_, index) => {
    const normalized = (index + 0.5) / THUNDER_WEBGL2_CANDIDATE_COUNT
    const shell = Math.sqrt(normalized) * (0.76 + random() * 0.24)
    const angle =
      index * goldenAngle + (random() - 0.5) * 0.46 + (random() - 0.5) * Math.PI
    return Object.freeze({
      index,
      x: center.x + Math.cos(angle) * radius * shell,
      y: center.y + Math.sin(angle) * radius * shell,
    })
  })
}

function nearestCandidateIndex(
  candidates: readonly Readonly<ThunderWebGl2Candidate>[],
  pIndex: number
): number {
  const source = candidates[pIndex]
  if (!source) return pIndex
  let bestIndex = pIndex
  let bestDistance = Number.POSITIVE_INFINITY
  for (const candidate of candidates) {
    if (candidate.index === pIndex) continue
    const dx = candidate.x - source.x
    const dy = candidate.y - source.y
    const distance = dx * dx + dy * dy
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

function shuffledIndices(count: number, random: () => number): number[] {
  const values = Array.from({ length: count }, (_, index) => index)
  for (let index = values.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1))
    const current = values[index] as number
    values[index] = values[swapIndex] as number
    values[swapIndex] = current
  }
  return values
}

function mulberry32(seed: number): () => number {
  let value = seed >>> 0
  return () => {
    value += 0x6d2b79f5
    let mixed = value
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1)
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61)
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296
  }
}

function mixSeed(seed: number, epoch: number, salt: number): number {
  let value = integerOr(seed, 1) ^ Math.imul(integerOr(epoch, 0), 0x9e3779b1)
  value ^= Math.imul(integerOr(salt, 0), 0x85ebca6b)
  value = Math.imul(value ^ (value >>> 16), 0x7feb352d)
  value = Math.imul(value ^ (value >>> 15), 0x846ca68b)
  return (value ^ (value >>> 16)) >>> 0
}

function hashUnit(value: number): number {
  return (value >>> 0) / 4294967296
}

function finitePoint(point: Readonly<ThunderWebGl2Point>): ThunderWebGl2Point {
  return { x: finiteOr(point.x, 0), y: finiteOr(point.y, 0) }
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
