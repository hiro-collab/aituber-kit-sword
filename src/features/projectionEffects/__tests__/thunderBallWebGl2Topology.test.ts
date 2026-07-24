import {
  THUNDER_WEBGL2_CANDIDATE_COUNT,
  THUNDER_WEBGL2_RIBBON_SAMPLE_COUNT,
  THUNDER_WEBGL2_SOURCE_COUNT,
  THUNDER_WEBGL2_TOTAL_RIBBON_VERTICES,
  THUNDER_WEBGL2_VERTICES_PER_CONNECTION,
} from '../plugins/thunderBall/webgl2/contracts'
import {
  createThunderWebGl2Ribbon,
  createThunderWebGl2Topology,
  nearestThunderWebGl2Candidate,
  resolveThunderWebGl2Tone,
  thunderWebGl2CadenceMs,
} from '../plugins/thunderBall/webgl2/topology'

describe('Thunder Ball WebGL2 topology', () => {
  it('is bounded and deterministic for one seed while different seeds differ', () => {
    const first = createThunderWebGl2Topology({ seed: 71, nowMs: 240 })
    const same = createThunderWebGl2Topology({ seed: 71, nowMs: 240 })
    const different = createThunderWebGl2Topology({ seed: 72, nowMs: 240 })

    expect(first).toEqual(same)
    expect(first).not.toEqual(different)
    expect(first.candidates).toHaveLength(THUNDER_WEBGL2_CANDIDATE_COUNT)
    expect(first.sources).toHaveLength(THUNDER_WEBGL2_SOURCE_COUNT)
    expect(first.connections).toHaveLength(THUNDER_WEBGL2_SOURCE_COUNT)
    expect(new Set(first.sources.map(({ index }) => index)).size).toBe(
      THUNDER_WEBGL2_SOURCE_COUNT
    )
    expect(
      first.sources.every(
        (source) =>
          source.lifeMs > 0 &&
          source.ageMs >= 0 &&
          source.ageMs <= source.lifeMs &&
          source.radius > 0 &&
          source.energy >= 0 &&
          source.energy <= 1
      )
    ).toBe(true)
  })

  it('orders every bounded source birth to the deterministic nearest candidate', () => {
    const topology = createThunderWebGl2Topology({ seed: 19, nowMs: 96 })

    for (const connection of topology.connections) {
      const nearest = nearestThunderWebGl2Candidate(
        topology.candidates,
        connection.source
      )
      expect(connection.source.index).toBe(connection.pIndex)
      expect(connection.target.index).toBe(connection.qIndex)
      expect(connection.qIndex).toBe(nearest?.index)
      expect(connection.ribbon[0]?.sourceBirth).toEqual(connection.source)
    }
  })

  it('builds a fixed-endpoint 30x2 ribbon with interior wrinkle and source flare', () => {
    const source = { x: -0.5, y: -0.2 }
    const target = { x: 0.62, y: 0.44 }
    const sourceBirth = {
      ...source,
      index: 0,
      bornAtMs: 0,
      lifeMs: 213,
      ageMs: 0,
      radius: 0.028,
      energy: 1,
    }
    const ribbon = createThunderWebGl2Ribbon(source, target, {
      seed: 502,
      crackleEpoch: 3,
      sourceBirth,
    })

    expect(ribbon).toHaveLength(THUNDER_WEBGL2_RIBBON_SAMPLE_COUNT)
    expect(ribbon.length * 2).toBe(THUNDER_WEBGL2_VERTICES_PER_CONNECTION)
    expect(ribbon[0]).toMatchObject({
      centerX: source.x,
      centerY: source.y,
      displacement: 0,
    })
    expect(ribbon[0]?.sourceBirth).toBe(sourceBirth)
    expect(ribbon[0]?.width ?? 0).toBeGreaterThan(0)
    expect(ribbon[0]?.width ?? 0).toBeGreaterThan(ribbon[1]?.width ?? 0)
    expect(ribbon.at(-1)).toMatchObject({
      centerX: target.x,
      centerY: target.y,
      displacement: 0,
    })
    expect(ribbon.at(-1)?.width).toBeCloseTo(0)
    expect(
      ribbon
        .slice(1, -1)
        .some((sample) => Math.abs(sample.displacement) > 0.0001)
    ).toBe(true)
    expect(ribbon[5]?.width ?? 0).toBeGreaterThan(ribbon[15]?.width ?? 0)
    expect(
      ribbon.every(
        (sample) =>
          Number.isFinite(sample.leftX) &&
          Number.isFinite(sample.rightY) &&
          sample.width >= 0
      )
    ).toBe(true)
  })

  it('keeps all source-near first mesh cells nondegenerate and centrally connected', () => {
    const topology = createThunderWebGl2Topology({
      seed: 88,
      nowMs: 192,
      center: { x: 0, y: 0.25 },
      radius: 0.32784,
    })
    const width = 960
    const height = 540
    const sourceNearTriangles = topology.connections.flatMap(({ ribbon }) =>
      ribbon.slice(0, 3).flatMap((sample, index) => {
        const next = ribbon[index + 1]
        if (!next) return []
        return [
          [
            sample.leftX,
            sample.leftY,
            sample.rightX,
            sample.rightY,
            next.leftX,
            next.leftY,
          ],
          [
            sample.rightX,
            sample.rightY,
            next.rightX,
            next.rightY,
            next.leftX,
            next.leftY,
          ],
        ] as const
      })
    )
    const pixelTriangles = sourceNearTriangles.map((triangle) =>
      triangle.map((value, index) =>
        index % 2 === 0 ? ((value + 1) * width) / 2 : ((1 - value) * height) / 2
      )
    )

    expect(pixelTriangles).toHaveLength(THUNDER_WEBGL2_SOURCE_COUNT * 6)
    expect(
      pixelTriangles.every(
        ([ax, ay, bx, by, cx, cy]) =>
          triangleArea(ax, ay, bx, by, cx, cy) > 0.01
      )
    ).toBe(true)

    const mask = rasterizeTriangles(pixelTriangles, width, height)
    const components = connectedComponents(mask, width)
    const total = components.reduce((sum, component) => sum + component.size, 0)
    const largest = components[0]
    expect(largest).toBeDefined()
    expect((largest?.size ?? 0) / total).toBeGreaterThanOrEqual(0.6)
    expect(
      largest?.containsNear(
        Math.round(width / 2),
        Math.round(height * 0.375),
        12
      )
    ).toBe(true)
    expect((largest?.maxX ?? 0) - (largest?.minX ?? 0)).toBeLessThanOrEqual(
      width * 0.35
    )
    expect((largest?.maxY ?? 0) - (largest?.minY ?? 0)).toBeLessThanOrEqual(
      height * 0.35
    )
  })

  it('holds the exact 21 by 60 recipe boundary at 1260 vertices', () => {
    const topology = createThunderWebGl2Topology({ seed: 1260, nowMs: 0 })
    const vertexCounts = topology.connections.map(
      (connection) => connection.ribbon.length * 2
    )

    expect(vertexCounts).toHaveLength(THUNDER_WEBGL2_SOURCE_COUNT)
    expect(
      vertexCounts.every(
        (count) => count === THUNDER_WEBGL2_VERTICES_PER_CONNECTION
      )
    ).toBe(true)
    expect(vertexCounts.reduce((total, count) => total + count, 0)).toBe(
      THUNDER_WEBGL2_TOTAL_RIBBON_VERTICES
    )
    expect(THUNDER_WEBGL2_TOTAL_RIBBON_VERTICES).toBe(1260)
  })

  it('keeps candidate crackle on bounded epochs while short-lived sources advance', () => {
    const cadence = thunderWebGl2CadenceMs(false)
    const beforeBoundary = createThunderWebGl2Topology({
      seed: 404,
      nowMs: cadence - 1,
    })
    const sameEpoch = createThunderWebGl2Topology({ seed: 404, nowMs: 0 })
    const next = createThunderWebGl2Topology({
      seed: 404,
      nowMs: cadence,
    })
    const later = createThunderWebGl2Topology({
      seed: 404,
      nowMs: cadence * 2,
    })

    expect(beforeBoundary.candidates).toEqual(sameEpoch.candidates)
    expect(beforeBoundary.sources).not.toEqual(sameEpoch.sources)
    expect(next.epoch).toBe(sameEpoch.epoch + 1)
    expect(next.connections).not.toEqual(sameEpoch.connections)
    const firstDelta = normalizedAngle(
      angle(next.candidates[0]) - angle(sameEpoch.candidates[0])
    )
    const secondDelta = normalizedAngle(
      angle(later.candidates[0]) - angle(next.candidates[0])
    )
    expect(firstDelta).not.toBeCloseTo(secondDelta, 4)
  })

  it('translates the full source/candidate system and scales its envelope with orb radius', () => {
    const origin = createThunderWebGl2Topology({
      seed: 411,
      nowMs: 240,
      center: { x: 0, y: 0 },
      radius: 0.2,
    })
    const translated = createThunderWebGl2Topology({
      seed: 411,
      nowMs: 240,
      center: { x: 0.31, y: -0.24 },
      radius: 0.2,
    })
    const expanded = createThunderWebGl2Topology({
      seed: 411,
      nowMs: 240,
      center: { x: 0, y: 0 },
      radius: 0.6,
    })

    for (let index = 0; index < THUNDER_WEBGL2_SOURCE_COUNT; index += 1) {
      expect(
        (translated.sources[index]?.x ?? 0) - (origin.sources[index]?.x ?? 0)
      ).toBeCloseTo(0.31, 10)
      expect(
        (translated.sources[index]?.y ?? 0) - (origin.sources[index]?.y ?? 0)
      ).toBeCloseTo(-0.24, 10)
    }
    expect(maxRadius(expanded.sources)).toBeCloseTo(
      maxRadius(origin.sources) * 3,
      10
    )
    expect(expanded.sources[0]?.radius ?? 0).toBeCloseTo(
      (origin.sources[0]?.radius ?? 0) * 3,
      10
    )
    expect(maxRadius(expanded.candidates)).toBeCloseTo(
      maxRadius(origin.candidates) * 3,
      10
    )
  })

  it('keeps tone finite/bounded with a thinner core and reduced cadence/feedback', () => {
    const normal = resolveThunderWebGl2Tone(false)
    const reduced = resolveThunderWebGl2Tone(true)
    for (const value of Object.values(normal)) {
      expect(Number.isFinite(value)).toBe(true)
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThanOrEqual(4)
    }
    expect(normal.coreWidth).toBeLessThan(normal.haloWidth)
    expect(reduced.coreWidth).toBeLessThan(reduced.haloWidth)
    expect(thunderWebGl2CadenceMs(true)).toBeGreaterThan(
      thunderWebGl2CadenceMs(false)
    )
    expect(reduced.feedback).toBeLessThan(normal.feedback)
    expect(reduced.pulse).toBeLessThan(normal.pulse)
  })
})

function angle(point: Readonly<{ x: number; y: number }> | undefined): number {
  return Math.atan2(point?.y ?? 0, point?.x ?? 0)
}

function normalizedAngle(value: number): number {
  return Math.atan2(Math.sin(value), Math.cos(value))
}

function maxRadius(
  points: readonly Readonly<{ x: number; y: number }>[]
): number {
  return Math.max(...points.map((point) => Math.hypot(point.x, point.y)))
}

function triangleArea(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number
): number {
  return Math.abs((bx - ax) * (cy - ay) - (by - ay) * (cx - ax)) / 2
}

function rasterizeTriangles(
  triangles: readonly (readonly number[])[],
  width: number,
  height: number
): Set<number> {
  const mask = new Set<number>()
  for (const [ax, ay, bx, by, cx, cy] of triangles) {
    if (
      ax === undefined ||
      ay === undefined ||
      bx === undefined ||
      by === undefined ||
      cx === undefined ||
      cy === undefined
    ) {
      continue
    }
    const minX = Math.max(0, Math.floor(Math.min(ax, bx, cx)))
    const maxX = Math.min(width - 1, Math.ceil(Math.max(ax, bx, cx)))
    const minY = Math.max(0, Math.floor(Math.min(ay, by, cy)))
    const maxY = Math.min(height - 1, Math.ceil(Math.max(ay, by, cy)))
    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        if (pointInTriangle(x + 0.5, y + 0.5, ax, ay, bx, by, cx, cy)) {
          mask.add(y * width + x)
        }
      }
    }
  }
  return mask
}

function pointInTriangle(
  x: number,
  y: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number
): boolean {
  const edge = (
    px: number,
    py: number,
    qx: number,
    qy: number,
    rx: number,
    ry: number
  ) => (rx - px) * (qy - py) - (ry - py) * (qx - px)
  const ab = edge(ax, ay, bx, by, x, y)
  const bc = edge(bx, by, cx, cy, x, y)
  const ca = edge(cx, cy, ax, ay, x, y)
  return (ab >= 0 && bc >= 0 && ca >= 0) || (ab <= 0 && bc <= 0 && ca <= 0)
}

function connectedComponents(mask: ReadonlySet<number>, width: number) {
  const remaining = new Set(mask)
  const components: Array<{
    size: number
    minX: number
    maxX: number
    minY: number
    maxY: number
    containsNear(x: number, y: number, radius: number): boolean
  }> = []
  while (remaining.size > 0) {
    const seed = remaining.values().next().value as number
    const queue = [seed]
    const values = new Set<number>()
    remaining.delete(seed)
    while (queue.length > 0) {
      const value = queue.pop()
      if (value === undefined) continue
      values.add(value)
      const x = value % width
      const y = Math.floor(value / width)
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (dx === 0 && dy === 0) continue
          const nextX = x + dx
          const nextY = y + dy
          if (nextX < 0 || nextX >= width || nextY < 0) continue
          const candidate = nextY * width + nextX
          if (remaining.delete(candidate)) queue.push(candidate)
        }
      }
    }
    const xs = [...values].map((value) => value % width)
    const ys = [...values].map((value) => Math.floor(value / width))
    components.push({
      size: values.size,
      minX: Math.min(...xs),
      maxX: Math.max(...xs),
      minY: Math.min(...ys),
      maxY: Math.max(...ys),
      containsNear: (x, y, radius) => {
        for (let offsetY = -radius; offsetY <= radius; offsetY += 1) {
          for (let offsetX = -radius; offsetX <= radius; offsetX += 1) {
            if (values.has((y + offsetY) * width + x + offsetX)) return true
          }
        }
        return false
      },
    })
  }
  return components.sort((left, right) => right.size - left.size)
}
