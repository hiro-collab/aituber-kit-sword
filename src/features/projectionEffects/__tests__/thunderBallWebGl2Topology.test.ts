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
    const ribbon = createThunderWebGl2Ribbon(source, target, {
      seed: 502,
      crackleEpoch: 3,
    })

    expect(ribbon).toHaveLength(THUNDER_WEBGL2_RIBBON_SAMPLE_COUNT)
    expect(ribbon.length * 2).toBe(THUNDER_WEBGL2_VERTICES_PER_CONNECTION)
    expect(ribbon[0]).toMatchObject({
      centerX: source.x,
      centerY: source.y,
      displacement: 0,
      width: 0,
    })
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
