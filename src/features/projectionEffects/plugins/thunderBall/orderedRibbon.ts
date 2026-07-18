export interface ThunderPoint {
  x: number
  y: number
}

export interface ThunderAnchorSelection {
  index: number
  point: ThunderPoint
  distanceSquared: number
}

export interface ThunderRibbonPoint extends ThunderPoint {
  along: number
  intensity: number
}

export interface ThunderRibbonOptions {
  segmentCount: number
  phase: number
  wrinkleStrength: number
  seed: number
  reducedMotion?: boolean
}

const MIN_ANCHORS = 4
const MAX_ANCHORS = 64
const MIN_SEGMENTS = 2
const MAX_SEGMENTS = 48

export function createThunderOrbAnchors(
  center: Readonly<ThunderPoint>,
  radius: number,
  count: number,
  rotation = 0
): readonly ThunderPoint[] {
  const safeCenter = finitePoint(center)
  const safeRadius = clamp(finiteOr(radius, 0), 0, 2)
  const anchorCount = boundedInteger(count, MIN_ANCHORS, MAX_ANCHORS)
  return Array.from({ length: anchorCount }, (_, index) => {
    const angle = rotation + (index / anchorCount) * Math.PI * 2
    const alternatingRadius = safeRadius * (index % 2 === 0 ? 1 : 0.92)
    return {
      x: safeCenter.x + Math.cos(angle) * alternatingRadius,
      y: safeCenter.y + Math.sin(angle) * alternatingRadius,
    }
  })
}

export function selectNearestThunderAnchor(
  source: Readonly<ThunderPoint>,
  anchors: readonly Readonly<ThunderPoint>[]
): ThunderAnchorSelection | null {
  const safeSource = finitePoint(source)
  let nearest: ThunderAnchorSelection | null = null
  anchors.forEach((anchor, index) => {
    if (!isFinitePoint(anchor)) return
    const candidateDistance = thunderDistanceSquared(safeSource, anchor)
    if (!nearest || candidateDistance < nearest.distanceSquared) {
      nearest = {
        index,
        point: { x: anchor.x, y: anchor.y },
        distanceSquared: candidateDistance,
      }
    }
  })
  return nearest
}

export function buildOrderedThunderRibbon(
  source: Readonly<ThunderPoint>,
  target: Readonly<ThunderPoint>,
  options: Readonly<ThunderRibbonOptions>
): readonly ThunderRibbonPoint[] {
  const start = finitePoint(source)
  const end = finitePoint(target)
  const segmentCount = boundedInteger(
    options.segmentCount,
    MIN_SEGMENTS,
    MAX_SEGMENTS
  )
  const dx = end.x - start.x
  const dy = end.y - start.y
  const length = Math.hypot(dx, dy)
  const perpendicularX = length > 0 ? -dy / length : 0
  const perpendicularY = length > 0 ? dx / length : 0
  const wrinkleStrength = options.reducedMotion
    ? 0
    : clamp(finiteOr(options.wrinkleStrength, 0), 0, 0.4)
  const phase = finiteOr(options.phase, 0)
  const seed = finiteOr(options.seed, 0)

  return Array.from({ length: segmentCount + 1 }, (_, index) => {
    const along = index / segmentCount
    if (index === 0) {
      return { x: start.x, y: start.y, along, intensity: 0 }
    }
    if (index === segmentCount) {
      return { x: end.x, y: end.y, along, intensity: 0 }
    }
    const envelope = Math.sin(Math.PI * along)
    const primaryWave = Math.sin(along * Math.PI * 6 + phase + seed * 9.7)
    const secondaryWave = Math.sin(along * Math.PI * 17 + seed * 23.1) * 0.35
    const offset =
      length * wrinkleStrength * envelope * (primaryWave + secondaryWave)
    return {
      x: start.x + dx * along + perpendicularX * offset,
      y: start.y + dy * along + perpendicularY * offset,
      along,
      intensity: envelope,
    }
  })
}

export function thunderDistanceSquared(
  left: Readonly<ThunderPoint>,
  right: Readonly<ThunderPoint>
): number {
  const dx = left.x - right.x
  const dy = left.y - right.y
  return dx * dx + dy * dy
}

function finitePoint(point: Readonly<ThunderPoint>): ThunderPoint {
  return {
    x: finiteOr(point.x, 0),
    y: finiteOr(point.y, 0),
  }
}

function isFinitePoint(point: Readonly<ThunderPoint>): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y)
}

function boundedInteger(
  value: number,
  minimum: number,
  maximum: number
): number {
  return Math.round(clamp(finiteOr(value, minimum), minimum, maximum))
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value))
}

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback
}
