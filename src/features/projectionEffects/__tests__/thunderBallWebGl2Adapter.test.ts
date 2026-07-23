import type {
  ProjectionEffectFrameContext,
  ProjectionEffectStopContext,
} from '../rendererPlugin'
import {
  ThunderBallWebGl2Adapter,
  ThunderWebGl2AdapterError,
  fixedThunderWebGl2AdapterResult,
  mapThunderParametersToWebGl2AdapterConfig,
  normalizeThunderWebGl2AdapterSurface,
  type ThunderWebGl2AdapterSurface,
} from '../plugins/thunderBall/webgl2/adapter'
import type { ThunderWebGl2RendererResult } from '../plugins/thunderBall/webgl2/contracts'

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
