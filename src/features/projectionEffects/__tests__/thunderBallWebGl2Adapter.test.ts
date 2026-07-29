import type {
  ProjectionEffectFrameContext,
  ProjectionEffectStopContext,
} from '../rendererPlugin'
import {
  ThunderBallWebGl2Adapter,
  ThunderWebGl2AdapterError,
  createThunderBallWebGl2CanvasSurface,
  fixedThunderWebGl2AdapterResult,
  mapThunderWebGl2EngineFrame,
  mapThunderParametersToWebGl2AdapterConfig,
  normalizeThunderWebGl2AdapterSurface,
  type ThunderWebGl2AdapterSurface,
} from '../plugins/thunderBall/webgl2/adapter'
import {
  THUNDER_WEBGL2_GPU_FAILURE_STAGE_ATTRIBUTE,
  THUNDER_WEBGL2_PASS_GRAPH,
  type ThunderWebGl2RendererResult,
} from '../plugins/thunderBall/webgl2/contracts'
import { resolveThunderWebGl2CompositeOracle } from '../plugins/thunderBall/webgl2/shaders'
import {
  createThunderWebGl2Topology,
  resolveThunderWebGl2Tone,
} from '../plugins/thunderBall/webgl2/topology'

const PRIVATE_ERROR = 'private://driver/C:/secret/thunder-adapter.bin'

describe('Thunder Ball WebGL2 host adapter', () => {
  it('maps the public schema deterministically while retaining recipe bounds', () => {
    const parameters = {
      anchorCount: 32,
      bloomGain: 1.15,
      centerX: 0.28,
      centerY: -0.06,
      emissionRate: 16,
      internalResolutionScale: 0.9,
      lifetimeMs: 1200,
      lineWidth: 4.6,
      masterIntensity: 0.94,
      orbitSpeed: 0.85,
      orbRadius: 0.48,
      postProcessing: true,
      reducedMotion: true,
      segmentCount: 24,
      sparkBudget: 28,
      updateRateHz: 60,
      wrinkleStrength: 0.22,
    }
    const first = mapThunderParametersToWebGl2AdapterConfig(parameters)
    const second = mapThunderParametersToWebGl2AdapterConfig(parameters)

    expect(first).toEqual(second)
    expect(first).toMatchObject({
      centerX: 0.28,
      centerY: -0.06,
      internalResolutionScale: 0.9,
      lineWidth: 3,
      masterIntensity: 0.72,
      orbRadius: 0.48,
      bloomGain: 0.35,
      postProcessing: false,
      reducedMotion: true,
      updateRateHz: 60,
      wrinkleStrength: 0.22,
    })
    expect(first.topologySeed).toBeGreaterThanOrEqual(0)
    expect(
      mapThunderParametersToWebGl2AdapterConfig({
        ...parameters,
        sparkBudget: 29,
      }).topologySeed
    ).not.toBe(first.topologySeed)
    const explicitSeed = mapThunderParametersToWebGl2AdapterConfig({
      ...parameters,
      seed: 41,
    })
    expect(
      mapThunderParametersToWebGl2AdapterConfig({
        ...parameters,
        seed: 41,
      }).topologySeed
    ).toBe(explicitSeed.topologySeed)
    expect(
      mapThunderParametersToWebGl2AdapterConfig({
        ...parameters,
        seed: 42,
      }).topologySeed
    ).not.toBe(explicitSeed.topologySeed)
    expect(
      mapThunderParametersToWebGl2AdapterConfig({
        ...parameters,
        seed: 0,
      }).topologySeed
    ).toBe(first.topologySeed)
  })

  it('starts once, maps configuration, and uses compositor frame cadence only', () => {
    const fixture = createSurfaceFixture()
    const adapter = new ThunderBallWebGl2Adapter({
      surface: fixture.surface,
    })

    adapter.render(frameContext(1_000, { updateRateHz: 30 }))
    adapter.render(frameContext(1_010, { updateRateHz: 30 }))
    adapter.render(frameContext(1_040, { updateRateHz: 30 }))

    expect(fixture.configure).toHaveBeenCalledTimes(3)
    expect(fixture.start).toHaveBeenCalledTimes(1)
    expect(fixture.renderFrame).toHaveBeenCalledTimes(2)
    expect(adapter.snapshot()).toMatchObject({
      configured: true,
      frameCount: 2,
      quarantined: false,
      started: true,
    })
  })

  it('keeps Stage5.3 geometry unscaled at the engine boundary and maps intensity once', () => {
    const topology = createThunderWebGl2Topology({ seed: 88, nowMs: 240 })
    const frame = {
      ribbons: topology.connections.map(({ ribbon }) => ribbon),
      sources: topology.sources,
      tone: resolveThunderWebGl2Tone(false),
    }
    const weakConfig = mapThunderParametersToWebGl2AdapterConfig({
      bloomGain: 0.65,
      centerX: 0.3,
      centerY: -0.2,
      masterIntensity: 0.4,
      orbRadius: 0.42,
    })
    const weak = mapThunderWebGl2EngineFrame(frame, weakConfig)
    const off = mapThunderWebGl2EngineFrame(
      frame,
      mapThunderParametersToWebGl2AdapterConfig({
        masterIntensity: 0,
      })
    )

    expect(weak.sources).toHaveLength(21)
    expect(weak.passGraph).toBe(THUNDER_WEBGL2_PASS_GRAPH)
    expect(weak.ribbons).toBe(frame.ribbons)
    expect(weak.sources?.[0]).toMatchObject({
      birthId: topology.sources[0]?.birthId,
      birthTag: topology.sources[0]?.birthTag,
      birthOriginX: topology.sources[0]?.birthOriginX,
      birthOriginY: topology.sources[0]?.birthOriginY,
      birthOriginZ: topology.sources[0]?.birthOriginZ,
    })
    expect(weak.sources?.[0]?.energy).toBeCloseTo(0.4)
    expect(weak.tone.coreLuminance).toBeGreaterThan(0)
    expect(weak.tone.bloomGain).toBeGreaterThan(0)
    expect(off.tone.feedback).toBe(0)
    expect(off.tone.coreLuminance).toBe(0)
    expect(off.tone.haloLuminance).toBe(weak.tone.haloLuminance)
    expect(off.tone.bloomGain).toBe(weak.tone.bloomGain)
    expect(off.sources?.every(({ energy }) => energy === 0)).toBe(true)
  })

  it('passes current emitter/profile controls into the renderer before geometry creation', () => {
    const attributes = new Map<string, string>()
    const canvas = {
      clientHeight: 540,
      clientWidth: 960,
      height: 150,
      width: 300,
      getContext: jest.fn(() => null),
      setAttribute: (name: string, value: string) =>
        attributes.set(name, value),
    } as unknown as HTMLCanvasElement
    const surface = createThunderBallWebGl2CanvasSurface(canvas)
    const renderFrame = jest.fn(() =>
      fixedThunderWebGl2AdapterResult('running', 'rendered')
    )
    const renderer = {
      start: jest.fn(() =>
        fixedThunderWebGl2AdapterResult('running', 'started')
      ),
      renderFrame,
      stop: jest.fn(() => fixedThunderWebGl2AdapterResult('stopped')),
      reset: jest.fn(() => fixedThunderWebGl2AdapterResult('idle', 'reset')),
      emergencyStop: jest.fn(() =>
        fixedThunderWebGl2AdapterResult('stopped', 'emergency-stopped')
      ),
      dispose: jest.fn(() =>
        fixedThunderWebGl2AdapterResult('disposed', 'disposed')
      ),
      snapshot: jest.fn(() => ({ engine: { failureStage: 'none' as const } })),
    }
    ;(surface as unknown as { renderer: unknown }).renderer = renderer
    surface.configure(
      mapThunderParametersToWebGl2AdapterConfig({
        centerX: 0.24,
        centerY: 0.43,
        lineWidth: 8,
        orbRadius: 0.84,
        wrinkleStrength: 0.16,
      })
    )

    surface.renderFrame({ nowMs: 240 })

    expect(renderFrame).toHaveBeenCalledWith(
      expect.objectContaining({
        centerX: 0.24,
        centerY: 0.43,
        height: 405,
        projectionAspect: 16 / 9,
        radiusScale: 2,
        width: 720,
        widthScale: 2,
        wrinkleScale: 2,
      })
    )
  })

  it('keeps CSS projection aspect when backing dimensions are independently capped', () => {
    const canvas = {
      clientHeight: 9_000,
      clientWidth: 12_000,
      height: 150,
      width: 300,
      getContext: jest.fn(() => null),
      setAttribute: jest.fn(),
    } as unknown as HTMLCanvasElement
    const surface = createThunderBallWebGl2CanvasSurface(canvas)
    const renderFrame = jest.fn(() =>
      fixedThunderWebGl2AdapterResult('running', 'rendered')
    )
    ;(surface as unknown as { renderer: unknown }).renderer = {
      start: jest.fn(() =>
        fixedThunderWebGl2AdapterResult('running', 'started')
      ),
      renderFrame,
      stop: jest.fn(() => fixedThunderWebGl2AdapterResult('stopped')),
      reset: jest.fn(() => fixedThunderWebGl2AdapterResult('idle', 'reset')),
      emergencyStop: jest.fn(() =>
        fixedThunderWebGl2AdapterResult('stopped', 'emergency-stopped')
      ),
      dispose: jest.fn(() =>
        fixedThunderWebGl2AdapterResult('disposed', 'disposed')
      ),
      snapshot: jest.fn(() => ({ engine: { failureStage: 'none' as const } })),
    }
    surface.configure(mapThunderParametersToWebGl2AdapterConfig({}))

    surface.renderFrame({ nowMs: 240 })

    expect(renderFrame).toHaveBeenCalledWith(
      expect.objectContaining({
        height: 6_750,
        projectionAspect: 4 / 3,
        width: 8_192,
      })
    )
  })

  it('keeps source temporal smoothing at zero and does not republish an off frame', () => {
    const topology = createThunderWebGl2Topology({ seed: 91, nowMs: 240 })
    const frame = {
      ribbons: topology.connections.map(({ ribbon }) => ribbon),
      tone: resolveThunderWebGl2Tone(false),
    }
    const active = mapThunderWebGl2EngineFrame(
      frame,
      mapThunderParametersToWebGl2AdapterConfig({
        masterIntensity: 0.82,
      })
    )
    const off = mapThunderWebGl2EngineFrame(
      frame,
      mapThunderParametersToWebGl2AdapterConfig({
        masterIntensity: 0,
      })
    )
    const firstOffFrame = resolveThunderWebGl2CompositeOracle({
      rawEnergy: 0,
      blurEnergies: [0, 0, 0, 0, 0, 0],
      bloomGain: off.tone.bloomGain,
      historyEnergy: active.tone.coreLuminance,
      feedback: off.tone.feedback,
      exposure: off.tone.exposure,
      gamma: off.tone.gamma,
    })

    expect(active.tone).toMatchObject({
      bloomGain: expect.any(Number),
      feedback: expect.any(Number),
    })
    expect(active.tone.bloomGain).toBeGreaterThan(0)
    expect(active.tone.feedback).toBe(0)
    expect(off.tone.feedback).toBe(0)
    expect(off.sources?.every(({ energy }) => energy === 0)).toBe(true)
    expect(firstOffFrame).toEqual({
      alpha: 0,
      bloomEnergy: 0,
      mappedEnergy: 0,
    })
  })

  it('requests a straight-alpha WebGL2 presentation boundary', () => {
    const getContext = jest.fn(() => null)
    const canvas = {
      clientHeight: 540,
      clientWidth: 960,
      height: 150,
      width: 300,
      getContext,
      setAttribute: jest.fn(),
    } as unknown as HTMLCanvasElement
    const surface = createThunderBallWebGl2CanvasSurface(canvas)

    expect(surface.start()).toMatchObject({
      status: 'blocked',
      state: 'quarantined',
    })
    expect(getContext).toHaveBeenCalledWith('webgl2', {
      alpha: true,
      antialias: true,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
    })
  })

  it('drains in a bounded sequence and clears immediately for emergency', async () => {
    const fixture = createSurfaceFixture()
    const waitFrame = jest.fn(async () => {})
    const adapter = new ThunderBallWebGl2Adapter({
      surface: fixture.surface,
      waitFrame,
    })
    adapter.render(frameContext(100))
    fixture.beginDrain()

    await adapter.stop(stopContext('fade', 180))
    expect(fixture.stop).toHaveBeenCalledWith({ nowMs: 100, fadeMs: 180 })
    expect(waitFrame.mock.calls.length).toBeGreaterThan(0)
    expect(waitFrame.mock.calls.length).toBeLessThanOrEqual(6)
    expect(adapter.snapshot().started).toBe(false)

    adapter.render(frameContext(300))
    await adapter.stop(stopContext('immediate', 0))
    expect(fixture.emergencyStop).toHaveBeenCalledTimes(1)
    expect(waitFrame).toHaveBeenCalledTimes(2)
  })

  it('routes Reset to the core surface before terminal disposal', () => {
    const fixture = createSurfaceFixture()
    const adapter = new ThunderBallWebGl2Adapter({
      surface: fixture.surface,
    })
    adapter.render(frameContext(10))

    adapter.reset()
    expect(fixture.reset).toHaveBeenCalledTimes(1)
    expect(adapter.snapshot()).toMatchObject({ frameCount: 0, started: false })
    adapter.dispose()
    expect(fixture.dispose).toHaveBeenCalledTimes(1)
    expect(adapter.snapshot()).toMatchObject({
      cleanupComplete: true,
      disposed: true,
    })
  })

  it('quarantines cleanup uncertainty, blocks later work, and never echoes native text', () => {
    const fixture = createSurfaceFixture({ disposeFailures: 1 })
    const adapter = new ThunderBallWebGl2Adapter({
      surface: fixture.surface,
    })
    adapter.render(frameContext(10))

    let failure: unknown = null
    try {
      adapter.dispose()
    } catch (error) {
      failure = error
    }
    expect(failure).toBeInstanceOf(ThunderWebGl2AdapterError)
    expect(JSON.stringify(failure)).not.toContain(PRIVATE_ERROR)
    const renderCalls = fixture.renderFrame.mock.calls.length
    expect(() => adapter.render(frameContext(20))).toThrow(
      ThunderWebGl2AdapterError
    )
    expect(fixture.renderFrame).toHaveBeenCalledTimes(renderCalls)

    adapter.dispose()
    expect(fixture.dispose).toHaveBeenCalledTimes(2)
    expect(adapter.snapshot()).toMatchObject({
      cleanupComplete: true,
      disposed: true,
      quarantined: true,
    })
  })

  it('publishes only a sticky allowlisted GPU stage and resets it on a fresh successful start', () => {
    const attributes = new Map<string, string>()
    const canvas = {
      clientHeight: 540,
      clientWidth: 960,
      height: 150,
      width: 300,
      getAttribute: (name: string) => attributes.get(name) ?? null,
      setAttribute: (name: string, value: string) => {
        attributes.set(name, value)
      },
    } as unknown as HTMLCanvasElement
    const failedSurface = createThunderBallWebGl2CanvasSurface(canvas)
    const failedRenderer = {
      start: jest.fn(() =>
        fixedThunderWebGl2AdapterResult('running', 'started')
      ),
      renderFrame: jest.fn(
        (): ThunderWebGl2RendererResult => ({
          status: 'blocked',
          state: 'quarantined',
          failure: 'draw-failed',
        })
      ),
      stop: jest.fn(() => fixedThunderWebGl2AdapterResult('stopped')),
      reset: jest.fn(() => fixedThunderWebGl2AdapterResult('idle', 'reset')),
      emergencyStop: jest.fn(
        (): ThunderWebGl2RendererResult => ({
          status: 'blocked',
          state: 'quarantined',
          failure: 'draw-failed',
        })
      ),
      dispose: jest.fn(() =>
        fixedThunderWebGl2AdapterResult('disposed', 'disposed')
      ),
      snapshot: jest.fn(() => ({
        engine: { failureStage: 'presentation' as const },
      })),
    }
    ;(failedSurface as unknown as { renderer: unknown }).renderer =
      failedRenderer
    const failedAdapter = new ThunderBallWebGl2Adapter({
      surface: failedSurface,
    })

    expect(() => failedAdapter.render(frameContext(10))).toThrow(
      ThunderWebGl2AdapterError
    )
    expect(
      canvas.getAttribute(THUNDER_WEBGL2_GPU_FAILURE_STAGE_ATTRIBUTE)
    ).toBe('presentation')
    expect(
      canvas.getAttribute(THUNDER_WEBGL2_GPU_FAILURE_STAGE_ATTRIBUTE)
    ).not.toContain(PRIVATE_ERROR)

    failedAdapter.dispose()
    expect(
      canvas.getAttribute(THUNDER_WEBGL2_GPU_FAILURE_STAGE_ATTRIBUTE)
    ).toBe('presentation')

    const blockedSurface = createThunderBallWebGl2CanvasSurface(canvas)
    const blockedRenderer = {
      start: jest.fn(
        (): ThunderWebGl2RendererResult => ({
          status: 'blocked',
          state: 'quarantined',
          failure: 'context-unavailable',
        })
      ),
      snapshot: jest.fn(() => ({
        engine: { failureStage: 'none' as const },
      })),
    }
    ;(blockedSurface as unknown as { renderer: unknown }).renderer =
      blockedRenderer
    const blockedAdapter = new ThunderBallWebGl2Adapter({
      surface: blockedSurface,
    })
    expect(() => blockedAdapter.render(frameContext(15))).toThrow(
      ThunderWebGl2AdapterError
    )
    expect(
      canvas.getAttribute(THUNDER_WEBGL2_GPU_FAILURE_STAGE_ATTRIBUTE)
    ).toBe('presentation')

    const successfulSurface = createThunderBallWebGl2CanvasSurface(canvas)
    const successfulRenderer = {
      start: jest.fn(() =>
        fixedThunderWebGl2AdapterResult('running', 'started')
      ),
      renderFrame: jest.fn(() =>
        fixedThunderWebGl2AdapterResult('running', 'rendered')
      ),
      stop: jest.fn(() => fixedThunderWebGl2AdapterResult('stopped')),
      reset: jest.fn(() => fixedThunderWebGl2AdapterResult('idle', 'reset')),
      emergencyStop: jest.fn(() =>
        fixedThunderWebGl2AdapterResult('stopped', 'emergency-stopped')
      ),
      dispose: jest.fn(() =>
        fixedThunderWebGl2AdapterResult('disposed', 'disposed')
      ),
      snapshot: jest.fn(() => ({
        engine: { failureStage: 'none' as const },
      })),
    }
    ;(successfulSurface as unknown as { renderer: unknown }).renderer =
      successfulRenderer
    const successfulAdapter = new ThunderBallWebGl2Adapter({
      surface: successfulSurface,
    })

    successfulAdapter.render(frameContext(20))
    expect(
      canvas.getAttribute(THUNDER_WEBGL2_GPU_FAILURE_STAGE_ATTRIBUTE)
    ).toBe('none')
  })

  it('keeps the frozen Canvas2D injection boundary compatibility-only', () => {
    const legacy = {
      draw: jest.fn(),
      clear: jest.fn(),
      dispose: jest.fn(),
    }
    const surface = normalizeThunderWebGl2AdapterSurface(legacy)
    const adapter = new ThunderBallWebGl2Adapter({ surface })

    adapter.render(frameContext(17))
    expect(legacy.draw).toHaveBeenCalledTimes(1)
    adapter.dispose()
    expect(legacy.dispose).toHaveBeenCalledTimes(1)
  })
})

function createSurfaceFixture(
  options: Readonly<{ disposeFailures?: number }> = {}
) {
  let draining = false
  let drainFrames = 0
  let remainingDisposeFailures = options.disposeFailures ?? 0
  const configure = jest.fn()
  const start = jest.fn(() =>
    fixedThunderWebGl2AdapterResult('running', 'started')
  )
  const renderFrame = jest.fn((): ThunderWebGl2RendererResult => {
    if (!draining) {
      return fixedThunderWebGl2AdapterResult('running', 'rendered')
    }
    drainFrames += 1
    if (drainFrames >= 2) {
      draining = false
      return fixedThunderWebGl2AdapterResult('stopped')
    }
    return fixedThunderWebGl2AdapterResult('draining', 'draining')
  })
  const stop = jest.fn(() =>
    fixedThunderWebGl2AdapterResult('draining', 'draining')
  )
  const reset = jest.fn(() => fixedThunderWebGl2AdapterResult('idle', 'reset'))
  const emergencyStop = jest.fn(() =>
    fixedThunderWebGl2AdapterResult('stopped', 'emergency-stopped')
  )
  const dispose = jest.fn(() => {
    if (remainingDisposeFailures > 0) {
      remainingDisposeFailures -= 1
      throw new Error(PRIVATE_ERROR)
    }
  })
  const surface = {
    configure,
    start,
    renderFrame,
    stop,
    reset,
    emergencyStop,
    dispose,
  } satisfies ThunderWebGl2AdapterSurface
  return {
    beginDrain() {
      draining = true
      drainFrames = 0
    },
    configure,
    dispose,
    emergencyStop,
    renderFrame,
    reset,
    start,
    stop,
    surface,
  }
}

function frameContext(
  nowMs: number,
  parameters: Readonly<Record<string, unknown>> = {}
): ProjectionEffectFrameContext {
  return { nowMs, deltaMs: 16, parameters }
}

function stopContext(
  mode: ProjectionEffectStopContext['mode'],
  fadeMs: number
): ProjectionEffectStopContext {
  return { mode, fadeMs }
}
