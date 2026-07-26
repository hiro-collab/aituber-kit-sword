import type { ProjectionEffectFrameContext } from '../rendererPlugin'
import {
  FIRE_P027_FIXED_DT_SECONDS,
  FIRE_P027_SOURCE_ORACLE_PROFILE,
  FIRE_P027_SOURCE_POST_OFF_FRAME,
  type FireP027Surface,
} from '../plugins/fire/p027/contracts'
import {
  FireP027Renderer,
  mapFireParametersToP027Controls,
} from '../plugins/fire/p027/renderer'
import { generateFireP027FallbackOrigins } from '../plugins/fire/p027/webglEngine'

describe('P027 Fire renderer lifecycle', () => {
  it('maps product input to the fixed O1 recipe while retaining position and seed', () => {
    const controls = mapFireParametersToP027Controls({
      emitterX: 0.5,
      emitterY: -0.5,
      emissionRate: 1,
      lifetimeMs: 4_000,
      particleBudget: 64,
      pointSize: 2,
      upwardSpeed: 0.05,
      noiseStrength: 0,
      masterIntensity: 1,
      seed: 41,
    })

    expect(controls).toEqual(
      expect.objectContaining({
        birthPerSecond: FIRE_P027_SOURCE_ORACLE_PROFILE.birthPerSecond,
        lifeSeconds: FIRE_P027_SOURCE_ORACLE_PROFILE.lifeSeconds,
        spriteWidthOrtho: FIRE_P027_SOURCE_ORACLE_PROFILE.spriteWidthOrtho,
        spriteHeightOrtho: FIRE_P027_SOURCE_ORACLE_PROFILE.spriteHeightOrtho,
        inputLagSeconds: FIRE_P027_SOURCE_ORACLE_PROFILE.sizeLagSeconds,
        forceX: 0,
        forceY: 4,
        forceZ: 0,
        windX: 0,
        windY: 3,
        windZ: 0,
        turbulenceX: 6,
        turbulenceY: 6,
        turbulenceZ: 6,
        turbulencePeriod: 0.01,
        lifeVarianceSeconds: 0,
        jitterBirths: false,
        alphaSpeed: 0,
      })
    )
    expect(controls.originCenterX).toBe(0.25)
    expect(controls.originCenterY).toBeCloseTo(-0.14)
    expect(controls.originSeed).toBeGreaterThanOrEqual(0)
    expect(controls.originSeed).toBeLessThanOrEqual(10_000)
    expect(controls.particleSeed).toBeGreaterThanOrEqual(0)
    expect(controls.particleSeed).toBeLessThanOrEqual(10_000)
  })

  it('does not let strength controls rewrite source birth, life, size, or motion', () => {
    const bright = mapFireParametersToP027Controls({
      masterIntensity: 1,
      temperature: 1,
      bloomGain: 2,
      postProcessing: true,
    })
    const weak = mapFireParametersToP027Controls({
      masterIntensity: 0.4,
      temperature: 0.2,
      bloomGain: 0,
      postProcessing: false,
    })
    const off = mapFireParametersToP027Controls({ masterIntensity: 0 })

    for (const controls of [bright, weak]) {
      expect(controls.birthPerSecond).toBe(300)
      expect(controls.lifeSeconds).toBe(0.5)
      expect(controls.spriteWidthOrtho).toBe(0.3)
      expect(controls.spriteHeightOrtho).toBe(0.3)
      expect(controls.forceY).toBe(4)
      expect(controls.windY).toBe(3)
      expect(controls.turbulenceY).toBe(6)
      expect(controls.lifeVarianceSeconds).toBe(0)
      expect(controls.jitterBirths).toBe(false)
    }
    expect(bright.tintR).toBeGreaterThan(weak.tintR)
    expect(bright.tintA).toBeGreaterThan(weak.tintA)
    expect(off).toEqual(
      expect.objectContaining({
        birthPerSecond: 0,
        tintR: 0,
        tintG: 0,
        tintB: 0,
        tintA: 0,
      })
    )
  })

  it('keeps the 42 fallback origins deterministic, paired, and centered', () => {
    const controls = mapFireParametersToP027Controls({
      emitterX: 0.4,
      emitterY: -0.2,
      seed: 73,
    })
    const origins = generateFireP027FallbackOrigins(controls)
    expect(origins).toHaveLength(42)
    expect(generateFireP027FallbackOrigins(controls)).toEqual(origins)

    for (let index = 0; index < origins.length; index += 2) {
      const positive = origins[index]!
      const negative = origins[index + 1]!
      expect(positive.x + negative.x).toBeCloseTo(
        controls.originCenterX * 2,
        12
      )
      expect(positive.y).toBeCloseTo(negative.y, 12)
      expect(positive.z).toBeCloseTo(negative.z, 12)
    }
  })

  it('updates at fixed 60 Hz with five ordered births per source step', () => {
    const surface = createSurface()
    const renderer = new FireP027Renderer({ surface })
    renderer.render(frame())
    renderer.render(frame({ nowMs: 17 }))

    expect(surface.setOrigins).toHaveBeenCalledTimes(1)
    expect(surface.setOrigins.mock.calls[0]?.[0]).toHaveLength(42)
    expect(surface.step).toHaveBeenCalledTimes(2)
    expect(surface.step.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        start: 0,
        count: 5,
        generationBase: 0,
        logicalUpdate: 0,
        dtSeconds: FIRE_P027_FIXED_DT_SECONDS,
      })
    )
    expect(surface.step.mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({ start: 5, count: 5, generationBase: 5 })
    )
    expect(surface.draw).toHaveBeenCalledTimes(2)
  })

  it('keeps Birth off through the complete source OFF0-45 observation window', async () => {
    const surface = createSurface()
    const waitFrame = jest.fn(async () => undefined)
    const renderer = new FireP027Renderer({ surface, waitFrame })
    renderer.render(frame())
    surface.step.mockClear()

    await renderer.stop({ mode: 'fade', fadeMs: 180 })

    expect(surface.step).toHaveBeenCalledTimes(
      FIRE_P027_SOURCE_POST_OFF_FRAME + 1
    )
    for (const [batch, rawGate] of surface.step.mock.calls) {
      expect(batch.count).toBe(0)
      expect(rawGate).toBe(0)
    }
    expect(waitFrame.mock.calls.length).toBeLessThanOrEqual(6)
    expect(surface.clear).toHaveBeenCalledTimes(1)
    expect(renderer.snapshot().scheduler.state).toBe('stopped')
  })

  it('clears immediately for Emergency Stop without starting drain work', async () => {
    const surface = createSurface()
    const renderer = new FireP027Renderer({ surface })
    await renderer.stop({ mode: 'immediate', fadeMs: 500 })
    expect(surface.step).not.toHaveBeenCalled()
    expect(surface.draw).not.toHaveBeenCalled()
    expect(surface.clear).toHaveBeenCalledTimes(1)
  })

  it('atomically resets GPU state and CPU cursor/generation before reuse', () => {
    const surface = createSurface()
    const renderer = new FireP027Renderer({ surface })
    renderer.render(frame())
    renderer.reset()
    surface.step.mockClear()
    surface.setOrigins.mockClear()
    renderer.render(frame({ nowMs: 33 }))
    expect(surface.reset).toHaveBeenCalledTimes(1)
    expect(surface.setOrigins).toHaveBeenCalledTimes(1)
    expect(surface.step.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        start: 0,
        count: 5,
        generationBase: 0,
        logicalUpdate: 0,
      })
    )
  })

  it('disposes once and performs no later GPU work', () => {
    const surface = createSurface()
    const renderer = new FireP027Renderer({ surface })
    renderer.dispose()
    renderer.dispose()
    renderer.render(frame())
    renderer.reset()
    expect(surface.dispose).toHaveBeenCalledTimes(1)
    expect(surface.step).not.toHaveBeenCalled()
    expect(surface.draw).not.toHaveBeenCalled()
    expect(surface.reset).not.toHaveBeenCalled()
    expect(renderer.snapshot().disposed).toBe(true)
  })

  it('preserves failure truth while still clearing after a failed normal drain', async () => {
    const surface = createSurface()
    surface.step.mockImplementation(() => {
      throw new Error('synthetic P027 drain failure')
    })
    const renderer = new FireP027Renderer({ surface })
    await expect(renderer.stop({ mode: 'fade', fadeMs: 180 })).rejects.toThrow(
      'synthetic P027 drain failure'
    )
    expect(surface.clear).toHaveBeenCalledTimes(1)
  })
})

function frame(
  patch: Partial<ProjectionEffectFrameContext> = {}
): ProjectionEffectFrameContext {
  return {
    nowMs: 0,
    deltaMs: 1000 / 60,
    parameters: {},
    ...patch,
  }
}

function createSurface() {
  return {
    step: jest.fn<void, Parameters<FireP027Surface['step']>>(),
    draw: jest.fn<void, Parameters<FireP027Surface['draw']>>(),
    setOrigins: jest.fn<void, Parameters<FireP027Surface['setOrigins']>>(),
    reset: jest.fn<void, []>(),
    clear: jest.fn<void, []>(),
    dispose: jest.fn<void, []>(),
  }
}
