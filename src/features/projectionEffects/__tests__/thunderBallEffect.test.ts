import { validateProjectionEffectDefinition } from '../canonical/validation'
import {
  ProjectionEffectHost,
  type ProjectionEffectRuntimeCapabilities,
} from '../effectHost'
import { ProjectionEffectRegistry } from '../registry'
import {
  THUNDER_BALL_EFFECT_ID,
  thunderBallEffectDefinition,
} from '../plugins/thunderBall/definition'
import {
  buildOrderedThunderRibbon,
  selectNearestThunderAnchor,
} from '../plugins/thunderBall/orderedRibbon'
import {
  createThunderBallPlugin,
  ThunderBallRenderer,
  type ThunderBallFrame,
  type ThunderBallSurface,
} from '../plugins/thunderBall/renderer'
import {
  THUNDER_BALL_RIBBON_FRAGMENT_SHADER,
  THUNDER_BALL_RIBBON_VERTEX_SHADER,
} from '../plugins/thunderBall/shaders'

const READY_CAPABILITIES: ProjectionEffectRuntimeCapabilities = {
  webgl2Available: true,
  audioOutputAvailable: true,
  sfxAssetsAvailable: true,
  selfObservationAvailable: true,
}

describe('Thunder Ball source/static effect contract', () => {
  it('registers a bounded Thunder Ball definition without claiming endpoint bolt', () => {
    expect(
      validateProjectionEffectDefinition(thunderBallEffectDefinition)
    ).toEqual(expect.objectContaining({ ok: true }))
    const registry = new ProjectionEffectRegistry()
    registry.register(createThunderBallPlugin())
    expect(registry.listEffectIds()).toEqual([THUNDER_BALL_EFFECT_ID])
    expect(thunderBallEffectDefinition.capabilities).toEqual(
      expect.arrayContaining([
        { id: 'nearestNeighborOrderedRibbon', available: true },
        { id: 'finiteSparkLife', available: true },
        { id: 'endpointBolt', available: false },
        { id: 'browserRuntimeObserved', available: false },
      ])
    )
  })

  it('selects the nearest anchor and preserves source-to-target ribbon order', () => {
    const source = { x: 0.1, y: 0 }
    const nearest = selectNearestThunderAnchor(source, [
      { x: -1, y: 0 },
      { x: 0.2, y: 0 },
      { x: 0.8, y: 0 },
    ])
    expect(nearest).toEqual(
      expect.objectContaining({ index: 1, point: { x: 0.2, y: 0 } })
    )
    if (!nearest) throw new Error('nearest fixture must select one anchor')

    const ribbon = buildOrderedThunderRibbon(source, nearest.point, {
      segmentCount: 6,
      phase: 0.4,
      wrinkleStrength: 0.2,
      seed: 0.7,
    })
    expect(ribbon).toHaveLength(7)
    expect(ribbon[0]).toEqual(
      expect.objectContaining({ ...source, along: 0, intensity: 0 })
    )
    expect(ribbon.at(-1)).toEqual(
      expect.objectContaining({ ...nearest.point, along: 1, intensity: 0 })
    )
    expect(
      ribbon.every(
        (point) =>
          Number.isFinite(point.x) &&
          Number.isFinite(point.y) &&
          Number.isFinite(point.intensity)
      )
    ).toBe(true)
  })

  it('retains each spark birth center when later commands move the orb', () => {
    const frames: ThunderBallFrame[] = []
    const surface = mockSurface((frame) => frames.push(frame))
    const renderer = new ThunderBallRenderer({ surface })
    renderer.render(frameContext({ centerX: 0, centerY: 0 }))
    const first = renderer.snapshot()
    expect(first).toEqual(
      expect.objectContaining({
        sparkCount: 1,
        ribbonCount: 1,
        ribbonPointCount: 21,
        birthCenters: [{ x: 0, y: 0 }],
      })
    )

    renderer.render(frameContext({ centerX: 0.8, centerY: -0.5 }, 1100, 100))
    expect(renderer.snapshot().birthCenters).toEqual([{ x: 0, y: 0 }])
    expect(frames.at(-1)?.ribbons[0].targetAnchorIndex).toBeGreaterThanOrEqual(
      0
    )
  })

  it('expires old sparks while new sparks inherit the current center', () => {
    const renderer = new ThunderBallRenderer()
    renderer.render(frameContext({ centerX: 0, lifetimeMs: 300 }))
    for (let index = 1; index <= 5; index += 1) {
      renderer.render(
        frameContext(
          { centerX: 0.75, centerY: 0.2, lifetimeMs: 300 },
          1000 + index * 100,
          100
        )
      )
    }
    const snapshot = renderer.snapshot()
    expect(snapshot.sparkCount).toBeGreaterThan(0)
    expect(snapshot.maximumSparkLifeMs).toBeLessThanOrEqual(354)
    expect(snapshot.birthCenters.every((point) => point.x === 0.75)).toBe(true)
  })

  it('bounds reduced motion and removes ribbon wrinkles', () => {
    const frames: ThunderBallFrame[] = []
    const renderer = new ThunderBallRenderer({
      surface: mockSurface((frame) => frames.push(frame)),
    })
    renderer.render(
      frameContext({
        reducedMotion: true,
        bloomGain: 2,
        lineWidth: 16,
        masterIntensity: 1,
        postProcessing: true,
        segmentCount: 48,
        wrinkleStrength: 0.4,
      })
    )
    const frame = frames.at(-1)
    expect(frame?.config).toEqual(
      expect.objectContaining({
        bloomGain: 0.35,
        lineWidth: 3,
        masterIntensity: 0.72,
        postProcessing: false,
        reducedMotion: true,
      })
    )
    const points = frame?.ribbons[0].points ?? []
    expect(points).toHaveLength(13)
    const start = points[0]
    const end = points.at(-1)
    if (!start || !end) throw new Error('reduced ribbon fixture is incomplete')
    const dx = end.x - start.x
    const dy = end.y - start.y
    expect(
      points.every(
        (point) =>
          Math.abs(dx * (point.y - start.y) - dy * (point.x - start.x)) < 1e-10
      )
    ).toBe(true)
  })

  it('stops, resets deterministically, and disposes its surface exactly once', async () => {
    const frames: ThunderBallFrame[] = []
    const surface = mockSurface((frame) => frames.push(frame))
    const renderer = new ThunderBallRenderer({
      surface,
      waitFrame: async () => {},
    })
    const context = frameContext()
    renderer.render(context)
    const firstRibbon = frames.at(-1)?.ribbons[0]

    await renderer.stop({ mode: 'fade', fadeMs: 180 })
    expect(renderer.snapshot()).toEqual(
      expect.objectContaining({
        sparkCount: 0,
        ribbonCount: 0,
        lastStopMode: 'fade',
      })
    )
    renderer.reset()
    renderer.render(context)
    expect(frames.at(-1)?.ribbons[0]).toEqual(firstRibbon)

    renderer.dispose()
    renderer.dispose()
    expect(surface.dispose).toHaveBeenCalledTimes(1)
    const drawCount = surface.draw.mock.calls.length
    renderer.render(context)
    expect(surface.draw).toHaveBeenCalledTimes(drawCount)
  })

  it('lets the host own finite Thunder auto-end without residual work', async () => {
    jest.useFakeTimers()
    try {
      const surface = mockSurface()
      const renderer = new ThunderBallRenderer({ surface })
      const registry = new ProjectionEffectRegistry()
      registry.register({
        definition: thunderBallEffectDefinition,
        createRenderer: () => renderer,
      })
      const host = new ProjectionEffectHost({
        registry,
        capabilities: READY_CAPABILITIES,
        defaultLifetimeMs: 500,
        nowMs: incrementingClock(),
      })
      await expect(host.dispatch(startCommand())).resolves.toEqual(
        expect.objectContaining({
          status: 'started',
          activeEffectId: THUNDER_BALL_EFFECT_ID,
        })
      )

      await jest.advanceTimersByTimeAsync(500)
      expect(host.activeEffectId).toBeNull()
      expect(renderer.snapshot()).toEqual(
        expect.objectContaining({
          disposed: true,
          sparkCount: 0,
          lastStopMode: 'fade',
        })
      )
      const drawCount = surface.draw.mock.calls.length
      await jest.advanceTimersByTimeAsync(5_000)
      expect(surface.draw).toHaveBeenCalledTimes(drawCount)
    } finally {
      jest.useRealTimers()
    }
  })

  it('provides bounded WebGL2 ribbon shader sources without runtime claims', () => {
    expect(THUNDER_BALL_RIBBON_VERTEX_SHADER).toContain('#version 300 es')
    expect(THUNDER_BALL_RIBBON_VERTEX_SHADER).toContain('ribbonIntensity')
    expect(THUNDER_BALL_RIBBON_FRAGMENT_SHADER).toContain('#version 300 es')
    expect(THUNDER_BALL_RIBBON_FRAGMENT_SHADER).toContain('masterIntensity')
    expect(THUNDER_BALL_RIBBON_FRAGMENT_SHADER).toContain('bloomGain')
    expect(THUNDER_BALL_RIBBON_FRAGMENT_SHADER).toContain(
      'smoothstep(0.0, 0.08, ribbonAlong)'
    )
    expect(THUNDER_BALL_RIBBON_FRAGMENT_SHADER).toContain(
      '1.0 - smoothstep(0.92, 1.0, ribbonAlong)'
    )
    expect(THUNDER_BALL_RIBBON_FRAGMENT_SHADER).not.toMatch(
      /smoothstep\(\s*1(?:\.0)?\s*,\s*0\.92\s*,\s*ribbonAlong\s*\)/
    )
  })
})

function frameContext(
  overrides: Readonly<Record<string, unknown>> = {},
  nowMs = 1000,
  deltaMs = 16
) {
  return {
    nowMs,
    deltaMs,
    parameters: {
      ...Object.fromEntries(
        thunderBallEffectDefinition.parameters.map((parameter) => [
          parameter.id,
          parameter.defaultValue,
        ])
      ),
      ...overrides,
    },
  }
}

function mockSurface(onDraw?: (frame: ThunderBallFrame) => void) {
  return {
    draw: jest.fn((frame: ThunderBallFrame) => onDraw?.(frame)),
    clear: jest.fn(),
    dispose: jest.fn(),
  } satisfies ThunderBallSurface
}

function startCommand() {
  return {
    schemaVersion: 1,
    commandId: 'thunderBall.start.one',
    effectId: THUNDER_BALL_EFFECT_ID,
    action: 'start',
    parameters: { centerX: 0, centerY: 0 },
    speechCompletion: 'finished',
  } as const
}

function incrementingClock(): () => number {
  let nowMs = 1000
  return () => {
    nowMs += 17
    return nowMs
  }
}
