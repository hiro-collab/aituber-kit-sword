import type { ProjectionEffectFrameContext } from '../rendererPlugin'
import {
  FIRE_P027_FIXED_DT_SECONDS,
  type FireP027Surface,
} from '../plugins/fire/p027/contracts'
import {
  FireP027Renderer,
  mapFireParametersToP027Controls,
} from '../plugins/fire/p027/renderer'

describe('P027 Fire renderer lifecycle', () => {
  it('maps the existing Fire vocabulary into bounded P027 controls', () => {
    const controls = mapFireParametersToP027Controls({
      emitterX: 0.5,
      emitterY: -0.5,
      particleBudget: 1800,
      emissionRate: 1200,
      lifetimeMs: 2000,
      upwardSpeed: 0.58,
      noiseStrength: 0.34,
      pointSize: 72,
      temperature: 0.8,
      masterIntensity: 1,
      bloomGain: 1,
      internalResolutionScale: 0.8,
      postProcessing: true,
    })
    expect(controls.originCenterX).toBe(0.25)
    expect(controls.originCenterY).toBeCloseTo(-0.14)
    expect(controls.lifeSeconds).toBe(2)
    expect(controls.birthPerSecond).toBe(75)
    expect(controls.sizeX).toBe(0.3)
    expect(controls.forceY).toBe(4)
    expect(controls.windY).toBe(3)
    expect(controls.turbulenceX).toBe(6)
    expect(controls.resolutionScale).toBe(0.8)
    expect(controls.tintR).toBeGreaterThan(controls.tintA)
    expect(controls.tintG).toBeGreaterThan(controls.tintA)
    expect(controls.tintA).toBeLessThanOrEqual(1)
  })

  it('separates visible emission from bounded coverage without changing the public vocabulary', () => {
    const bright = mapFireParametersToP027Controls({
      temperature: 1,
      masterIntensity: 1,
      bloomGain: 2,
      postProcessing: true,
    })
    const off = mapFireParametersToP027Controls({
      masterIntensity: 0,
      bloomGain: 2,
      postProcessing: true,
    })

    expect(bright.tintR).toBeGreaterThan(bright.tintG)
    expect(bright.tintG).toBeGreaterThan(bright.tintB)
    expect(bright.tintR).toBeGreaterThan(bright.tintA)
    expect(bright.tintA).toBeCloseTo(0.94)
    expect(off).toEqual(
      expect.objectContaining({ tintR: 0, tintG: 0, tintB: 0, tintA: 0 })
    )
  })

  it('updates GPU state at fixed 60 Hz, creates origins once, and draws once per host frame', () => {
    const surface = createSurface()
    const renderer = new FireP027Renderer({ surface })
    renderer.render(frame())
    renderer.render(frame({ nowMs: 17 }))
    expect(surface.setOrigins).toHaveBeenCalledTimes(1)
    expect(surface.setOrigins.mock.calls[0]?.[0]).toHaveLength(42)
    expect(surface.step).toHaveBeenCalledTimes(2)
    expect(surface.step.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        count: 2,
        dtSeconds: FIRE_P027_FIXED_DT_SECONDS,
      })
    )
    expect(surface.draw).toHaveBeenCalledTimes(2)
  })

  it('turns Birth off immediately and drains finite life after the compositor loop stops', async () => {
    const surface = createSurface()
    const waitFrame = jest.fn(async () => undefined)
    const renderer = new FireP027Renderer({ surface, waitFrame })
    renderer.render(frame())
    surface.step.mockClear()
    await renderer.stop({ mode: 'fade', fadeMs: 180 })

    expect(surface.step.mock.calls.length).toBeGreaterThan(1)
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
      expect.objectContaining({ start: 0, generationBase: 0, logicalUpdate: 0 })
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
