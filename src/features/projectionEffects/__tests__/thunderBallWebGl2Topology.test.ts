import {
  THUNDER_WEBGL2_CANDIDATE_COUNT,
  THUNDER_WEBGL2_RIBBON_SAMPLE_COUNT,
  THUNDER_WEBGL2_SOURCE_COUNT,
  THUNDER_WEBGL2_STAGE53_PROFILE,
  THUNDER_WEBGL2_TOTAL_RIBBON_VERTICES,
  THUNDER_WEBGL2_VERTICES_PER_CONNECTION,
} from '../plugins/thunderBall/webgl2/contracts'
import {
  createThunderWebGl2Ribbon,
  createThunderWebGl2Topology,
  nearestThunderWebGl2Candidate,
  resolveThunderWebGl2Tone,
  THUNDER_WEBGL2_STAGE53_SPHERE,
  thunderWebGl2CadenceMs,
} from '../plugins/thunderBall/webgl2/topology'

describe('Thunder Ball WebGL2 Stage5.3 topology', () => {
  it('uses the fixed frequency-2 sphere42 table instead of a candidate-derived seed shell', () => {
    const first = createThunderWebGl2Topology({ seed: 71, nowMs: 0 })
    const differentSeed = createThunderWebGl2Topology({ seed: 72, nowMs: 0 })

    expect(THUNDER_WEBGL2_STAGE53_SPHERE).toHaveLength(
      THUNDER_WEBGL2_CANDIDATE_COUNT
    )
    expect(THUNDER_WEBGL2_STAGE53_SPHERE[0]).toEqual([0, 0, 0.400000006])
    expect(THUNDER_WEBGL2_STAGE53_SPHERE[41]).toEqual([
      -0.199999988, 0.064984061, -0.340260327,
    ])
    expect(first.candidates).toEqual(differentSeed.candidates)
    expect(first.sources).toEqual(differentSeed.sources)
    expect(first.connections).toEqual(differentSeed.connections)
    expect(first.seed).toBe(71)
    expect(differentSeed.seed).toBe(72)
  })

  it('retains exactly 21 tagged birth origins and moves only a new birth with the emitter', () => {
    const initial = createThunderWebGl2Topology({
      seed: 19,
      nowMs: 240,
      center: { x: 0, y: 0 },
      aspect: 16 / 9,
    })
    const moved = createThunderWebGl2Topology({
      seed: 19,
      nowMs: 250,
      center: { x: 0.31, y: -0.24 },
      aspect: 16 / 9,
      retainedSources: initial.sources,
    })

    expect(initial.sources).toHaveLength(THUNDER_WEBGL2_SOURCE_COUNT)
    expect(new Set(initial.sources.map(({ birthId }) => birthId)).size).toBe(21)
    expect(
      initial.sources.every(
        ({ birthId, birthTag }) =>
          Number.isInteger(birthId) &&
          birthTag === ((((birthId as number) % 1024) + 1024) % 1024) + 1
      )
    ).toBe(true)

    const retainedByBirthId = new Map(
      initial.sources.map((source) => [source.birthId, source] as const)
    )
    const common = moved.sources.filter((source) =>
      retainedByBirthId.has(source.birthId)
    )
    expect(common).toHaveLength(20)
    for (const source of common) {
      const previous = retainedByBirthId.get(source.birthId)
      expect(source.birthOriginX).toBe(previous?.birthOriginX)
      expect(source.birthOriginY).toBe(previous?.birthOriginY)
      expect(source.birthOriginZ).toBe(previous?.birthOriginZ)
    }
    const newBirth = moved.sources.find(
      (source) => !retainedByBirthId.has(source.birthId)
    )
    expect(newBirth).toBeDefined()
    expect(Math.abs(newBirth?.x ?? 0)).toBeGreaterThan(0.1)
  })

  it('preserves the source-world shape and requested center across display aspects', () => {
    const viewports = [
      { width: 1_600, height: 900 },
      { width: 1_200, height: 900 },
      { width: 750, height: 1_000 },
    ] as const
    const centered = viewports.map(({ width, height }) =>
      createThunderWebGl2Topology({
        seed: 502,
        nowMs: 240,
        aspect: width / height,
      })
    )
    const bboxAspects = centered.map((topology, index) =>
      cssBboxAspect(
        topology.candidates,
        viewports[index]!.width,
        viewports[index]!.height
      )
    )

    for (const bboxAspect of bboxAspects.slice(1)) {
      expect(bboxAspect).toBeCloseTo(bboxAspects[0]!, 6)
    }
    for (const topology of centered.slice(1)) {
      expect(
        topology.candidates.map(({ worldX, worldY, worldZ }) => [
          worldX,
          worldY,
          worldZ,
        ])
      ).toEqual(
        centered[0]!.candidates.map(({ worldX, worldY, worldZ }) => [
          worldX,
          worldY,
          worldZ,
        ])
      )
    }

    const movedCentroids = viewports.map(({ width, height }) => {
      const topology = createThunderWebGl2Topology({
        seed: 502,
        nowMs: 240,
        aspect: width / height,
        center: { x: 0.27, y: -0.18 },
      })
      const centroid = topology.candidates.reduce(
        (sum, candidate) => ({
          x: sum.x + candidate.x,
          y: sum.y + candidate.y,
        }),
        { x: 0, y: 0 }
      )
      return {
        x: centroid.x / topology.candidates.length,
        y: centroid.y / topology.candidates.length,
      }
    })
    for (const centroid of movedCentroids.slice(1)) {
      expect(centroid.x).toBeCloseTo(movedCentroids[0]!.x, 6)
      expect(centroid.y).toBeCloseTo(movedCentroids[0]!.y, 6)
    }
  })

  it('matches every moving particle to the nearest rotated candidate in full 3D', () => {
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

  it('builds the source 30x2 Hermite ribbon with constrained endpoints and broad live cells', () => {
    const topology = createThunderWebGl2Topology({
      seed: 502,
      nowMs: 240,
      aspect: 16 / 9,
    })
    const ribbon = topology.connections[0]?.ribbon ?? []

    expect(ribbon).toHaveLength(THUNDER_WEBGL2_RIBBON_SAMPLE_COUNT)
    expect(ribbon.length * 2).toBe(THUNDER_WEBGL2_VERTICES_PER_CONNECTION)
    expect(ribbon[0]?.sourceBirth).toEqual(topology.connections[0]?.source)
    expect(ribbon.every((sample) => sample.width > 0)).toBe(true)
    const first = ribbon[0]
    const last = ribbon.at(-1)
    expect(
      first !== undefined &&
        last !== undefined &&
        ribbon.slice(1, -1).some((sample) => {
          const baselineX =
            first.centerX + (last.centerX - first.centerX) * sample.along
          const baselineY =
            first.centerY + (last.centerY - first.centerY) * sample.along
          return (
            Math.abs(sample.centerX - baselineX) > 1e-6 ||
            Math.abs(sample.centerY - baselineY) > 1e-6
          )
        })
    ).toBe(true)
    expect(
      ribbon.every(
        (sample) =>
          Number.isFinite(sample.leftX) &&
          Number.isFinite(sample.leftY) &&
          Number.isFinite(sample.rightX) &&
          Number.isFinite(sample.rightY)
      )
    ).toBe(true)
  })

  it('keeps the compatibility ribbon API deterministic without a world-depth fixture', () => {
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
    const first = createThunderWebGl2Ribbon(source, target, {
      seed: 1,
      crackleEpoch: 3,
      sourceBirth,
    })
    const same = createThunderWebGl2Ribbon(source, target, {
      seed: 1,
      crackleEpoch: 3,
      sourceBirth,
    })

    expect(first).toEqual(same)
    expect(first[0]?.sourceBirth).toMatchObject({ index: 0 })
    expect(first).toHaveLength(30)
  })

  it('holds the exact 21 by 60 recipe boundary at 1260 vertices', () => {
    const topology = createThunderWebGl2Topology({ seed: 1260, nowMs: 240 })
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

  it('advances one source birth each 10ms while rotating the source sphere', () => {
    const cadence = thunderWebGl2CadenceMs(false)
    const first = createThunderWebGl2Topology({ seed: 404, nowMs: 240 })
    const next = createThunderWebGl2Topology({
      seed: 404,
      nowMs: 240 + cadence,
      retainedSources: first.sources,
    })

    expect(cadence).toBe(10)
    expect(next.epoch).toBe(first.epoch + 1)
    expect(next.sources[0]?.birthId).toBe((first.sources[0]?.birthId ?? 0) + 1)
    expect(next.candidates).not.toEqual(first.candidates)
  })

  it('uses the source multiresolution, color and zero-temporal defaults', () => {
    const normal = resolveThunderWebGl2Tone(false)
    const reduced = resolveThunderWebGl2Tone(true)

    expect(normal).toMatchObject({
      bloomGain: THUNDER_WEBGL2_STAGE53_PROFILE.bloomLevel,
      contrast: 1,
      exposure: THUNDER_WEBGL2_STAGE53_PROFILE.intensity,
      feedback: 0,
      gamma: 1,
      glowColor: [0.12, 0.84, 1],
      glowLevel: THUNDER_WEBGL2_STAGE53_PROFILE.glowLevel,
      inputLevel: 1,
      intensity: THUNDER_WEBGL2_STAGE53_PROFILE.intensity,
      pulse: 0,
      rampLevel: THUNDER_WEBGL2_STAGE53_PROFILE.rampLevel,
    })
    expect(reduced.feedback).toBe(0)
    expect(reduced.pulse).toBe(0)
    expect(reduced.bloomGain).toBeLessThan(normal.bloomGain)
    expect(thunderWebGl2CadenceMs(true)).toBe(20)
  })
})

function cssBboxAspect(
  points: readonly Readonly<{ x: number; y: number }>[],
  width: number,
  height: number
): number {
  const xs = points.map(({ x }) => x)
  const ys = points.map(({ y }) => y)
  return (
    ((Math.max(...xs) - Math.min(...xs)) * width) /
    ((Math.max(...ys) - Math.min(...ys)) * height)
  )
}
