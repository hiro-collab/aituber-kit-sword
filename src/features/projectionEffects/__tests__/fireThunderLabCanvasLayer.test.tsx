import { act, render, waitFor } from '@testing-library/react'
import { createRef } from 'react'
import {
  FIRE_THUNDER_LAB_VISUAL_PARAMETERS,
  FireThunderLabCanvasLayer,
  resolveFireThunderLabVisualParameters,
  type FireThunderLabController,
  type FireThunderLabVisualParameterOverrides,
} from '../browser/fireThunderLabCanvasLayer'
import {
  PROJECTION_EFFECT_COMMAND_SCHEMA_VERSION,
  type ProjectionEffectStartCommand,
} from '../effectCommand'
import { createFireThunderLabHost } from '../lab/fireThunderLabRegistry'
import { FIRE_EFFECT_ID } from '../plugins/fire/definition'
import type { FireP027Surface } from '../plugins/fire/p027/contracts'
import { THUNDER_BALL_EFFECT_ID } from '../plugins/thunderBall/definition'
import type { ProjectionPerformancePlan } from '../projectionPerformancePlan'
import {
  fixedThunderWebGl2AdapterResult,
  type ThunderWebGl2AdapterSurface,
} from '../plugins/thunderBall/webgl2/adapter'
import FireThunderLabPage from '../../../pages/projection-effects-fire-thunder-lab'

describe('standalone Fire+Thunder lab registry and canvas lifecycle', () => {
  const requestCallbacks = new Map<number, FrameRequestCallback>()
  let nextRequestId = 1

  beforeEach(() => {
    requestCallbacks.clear()
    nextRequestId = 1
    installCanvasContextMocks()
    jest
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((callback) => {
        const requestId = nextRequestId
        nextRequestId += 1
        requestCallbacks.set(requestId, callback)
        return requestId
      })
    jest
      .spyOn(window, 'cancelAnimationFrame')
      .mockImplementation((requestId) => {
        requestCallbacks.delete(requestId)
      })
  })

  afterEach(() => {
    jest.useRealTimers()
    jest.restoreAllMocks()
  })

  it('accepts only bounded presentation overrides and preserves lifecycle defaults', () => {
    const injected = {
      fire: {
        emitterX: 0.3,
        emitterY: -0.25,
        internalResolutionScale: 0.2,
        lifetimeMs: 99_999,
        pointSize: 46,
      },
      thunderBall: {
        centerX: 0.28,
        centerY: -0.06,
        lifetimeMs: 99_999,
        lineWidth: 3.8,
        orbRadius: 0.32,
      },
    } as unknown as Readonly<FireThunderLabVisualParameterOverrides>

    const fire = resolveFireThunderLabVisualParameters(FIRE_EFFECT_ID, injected)
    expect(fire).toEqual(
      expect.objectContaining({
        emitterX: 0.3,
        emitterY: -0.25,
        internalResolutionScale:
          FIRE_THUNDER_LAB_VISUAL_PARAMETERS.fire.internalResolutionScale,
        lifetimeMs: FIRE_THUNDER_LAB_VISUAL_PARAMETERS.fire.lifetimeMs,
        pointSize: 46,
      })
    )

    const invalidFire = resolveFireThunderLabVisualParameters(FIRE_EFFECT_ID, {
      fire: { emitterX: Number.POSITIVE_INFINITY, pointSize: 161 },
    })
    expect(invalidFire).toEqual(FIRE_THUNDER_LAB_VISUAL_PARAMETERS.fire)

    const thunder = resolveFireThunderLabVisualParameters(
      THUNDER_BALL_EFFECT_ID,
      injected,
      true
    )
    expect(thunder).toEqual(
      expect.objectContaining({
        centerX: 0.28,
        centerY: -0.06,
        lifetimeMs: FIRE_THUNDER_LAB_VISUAL_PARAMETERS.thunderBall.lifetimeMs,
        lineWidth: 3.8,
        orbRadius: 0.32,
        reducedMotion: true,
      })
    )
  })

  it('exposes the complete filming control surface in an idle initial state', () => {
    const view = render(<FireThunderLabPage />)

    expect(view.getByRole('button', { name: 'Start Fire' })).toBeEnabled()
    expect(view.getByRole('button', { name: 'Start Thunder' })).toBeEnabled()
    expect(view.getByRole('button', { name: 'Stop' })).toBeEnabled()
    expect(view.getByRole('button', { name: 'Reset' })).toBeEnabled()
    expect(view.getByRole('button', { name: 'Emergency Stop' })).toBeEnabled()
    expect(view.getByTestId('fire-thunder-lab-stage')).toBeInTheDocument()
    expect(
      view.getByRole('checkbox', { name: 'Reduced motion (Thunder)' })
    ).toBeEnabled()
    expect(view.getByTestId('fire-thunder-lab-status')).toHaveTextContent(
      'idle'
    )

    view.unmount()
  })

  it('uses one local host, replaces Fire with Thunder, and creates fresh surfaces', async () => {
    const fireSurfaces: ReturnType<typeof mockFireSurface>[] = []
    const thunderSurfaces: ReturnType<typeof mockThunderSurface>[] = []
    const host = createFireThunderLabHost({
      createFireSurface: () => {
        const surface = mockFireSurface()
        fireSurfaces.push(surface)
        return surface
      },
      createThunderSurface: () => {
        const surface = mockThunderSurface()
        thunderSurfaces.push(surface)
        return surface
      },
      webgl2Available: true,
      waitFrame: async () => {},
      nowMs: incrementingClock(),
    })

    await expect(host.dispatch(startCommand(FIRE_EFFECT_ID))).resolves.toEqual(
      expect.objectContaining({
        status: 'started',
        activeEffectId: FIRE_EFFECT_ID,
      })
    )
    expect(fireSurfaces[0].draw).toHaveBeenCalled()

    await expect(
      host.dispatch(
        startCommand(THUNDER_BALL_EFFECT_ID, { reducedMotion: true })
      )
    ).resolves.toEqual(
      expect.objectContaining({
        status: 'started',
        activeEffectId: THUNDER_BALL_EFFECT_ID,
        replacedEffectId: FIRE_EFFECT_ID,
      })
    )
    expect(fireSurfaces[0].dispose).toHaveBeenCalledTimes(1)
    expect(thunderSurfaces[0].configure).toHaveBeenCalledWith(
      expect.objectContaining({ reducedMotion: true })
    )

    await host.dispatch({
      schemaVersion: PROJECTION_EFFECT_COMMAND_SCHEMA_VERSION,
      commandId: 'lab.thunder.emergency.one',
      effectId: THUNDER_BALL_EFFECT_ID,
      action: 'stop',
      mode: 'emergency',
    })
    await host.dispatch({
      schemaVersion: PROJECTION_EFFECT_COMMAND_SCHEMA_VERSION,
      commandId: 'lab.thunder.reset.one',
      effectId: THUNDER_BALL_EFFECT_ID,
      action: 'reset',
    })
    await host.dispatch(startCommand(THUNDER_BALL_EFFECT_ID))
    expect(thunderSurfaces).toHaveLength(2)
    expect(thunderSurfaces[0].dispose).toHaveBeenCalledTimes(1)
  })

  it('mounts exactly two canvases and leaves no RAF or renderer after unmount', async () => {
    let nowMs = 1_000
    jest.spyOn(performance, 'now').mockImplementation(() => nowMs)
    const fireSurfaces: ReturnType<typeof mockFireSurface>[] = []
    const controllerRef = createRef<FireThunderLabController>()
    const view = render(
      <FireThunderLabCanvasLayer
        ref={controllerRef}
        createFireSurface={() => {
          const surface = mockFireSurface()
          fireSurfaces.push(surface)
          return surface
        }}
        createThunderSurface={() => mockThunderSurface()}
        webgl2Available
        waitFrame={async () => {}}
      />
    )
    expect(
      view.getByTestId('fire-thunder-lab-layer').querySelectorAll('canvas')
    ).toHaveLength(2)
    expect(
      view.getByTestId('projection-effect-webgl2-canvas')
    ).toBeInTheDocument()
    expect(
      view.getByTestId('projection-effect-canvas2d-canvas')
    ).toBeInTheDocument()

    await act(async () => {
      await controllerRef.current?.start(FIRE_EFFECT_ID)
    })
    expect(fireSurfaces[0].draw).toHaveBeenCalledWith(
      expect.objectContaining({
        lifeSeconds: FIRE_THUNDER_LAB_VISUAL_PARAMETERS.fire.lifetimeMs / 1_000,
        resolutionScale: 0.75,
        originCenterY: FIRE_THUNDER_LAB_VISUAL_PARAMETERS.fire.emitterY * 0.28,
      })
    )
    expect(requestCallbacks.size).toBe(1)
    const frame = [...requestCallbacks.entries()][0]
    const initialDrawCount = fireSurfaces[0].draw.mock.calls.length
    requestCallbacks.delete(frame[0])
    nowMs += 20
    await act(async () => frame[1](16))
    expect(fireSurfaces[0].draw.mock.calls.length).toBeGreaterThan(
      initialDrawCount
    )
    expect(requestCallbacks.size).toBe(1)

    view.unmount()
    expect(requestCallbacks.size).toBe(0)
    await waitFor(() =>
      expect(fireSurfaces[0].dispose).toHaveBeenCalledTimes(1)
    )
    const drawCount = fireSurfaces[0].draw.mock.calls.length
    await Promise.resolve()
    expect(fireSurfaces[0].draw).toHaveBeenCalledTimes(drawCount)
  })

  it('executes one planned start on the compositor RAF with bounded duration and seed', async () => {
    jest.useFakeTimers()
    jest
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((callback) => {
        const requestId = nextRequestId
        nextRequestId += 1
        requestCallbacks.set(requestId, callback)
        return requestId
      })
    jest
      .spyOn(window, 'cancelAnimationFrame')
      .mockImplementation((requestId) => {
        requestCallbacks.delete(requestId)
      })
    let nowMs = 1_000
    jest.spyOn(performance, 'now').mockImplementation(() => nowMs)
    const fireSurfaces: ReturnType<typeof mockFireSurface>[] = []
    const thunderSurfaces: ReturnType<typeof mockThunderSurface>[] = []
    const controllerRef = createRef<FireThunderLabController>()
    render(
      <FireThunderLabCanvasLayer
        ref={controllerRef}
        createFireSurface={() => {
          const surface = mockFireSurface()
          fireSurfaces.push(surface)
          return surface
        }}
        createThunderSurface={() => {
          const surface = mockThunderSurface()
          thunderSurfaces.push(surface)
          return surface
        }}
        webgl2Available
        waitFrame={async () => {}}
      />
    )

    let fireResult:
      | Awaited<ReturnType<NonNullable<FireThunderLabController['startPlan']>>>
      | undefined
    await act(async () => {
      fireResult = await controllerRef.current?.startPlan?.(
        performancePlan({
          effectId: 'fire',
          durationMs: 500,
          seed: 42,
          keyframes: [
            {
              atMs: 0,
              position: { x: -1, y: 0.5 },
              strength: 0,
            },
            {
              atMs: 500,
              position: { x: 1, y: -0.5 },
              strength: 1,
            },
          ],
        })
      )
    })
    expect(fireResult).toEqual(
      expect.objectContaining({
        status: 'accepted',
        hostResult: expect.objectContaining({ status: 'started' }),
      })
    )
    expect(fireSurfaces).toHaveLength(1)
    expect(fireSurfaces[0].draw).toHaveBeenCalledWith(
      expect.objectContaining({
        originCenterX: -0.5,
        originCenterY: 0.14,
        sizeX: 0.1,
      })
    )
    expect(requestCallbacks.size).toBe(1)

    const firstFrame = [...requestCallbacks.entries()][0]
    requestCallbacks.delete(firstFrame[0])
    nowMs += 20
    await act(async () => firstFrame[1](1_000))
    const secondFrame = [...requestCallbacks.entries()][0]
    requestCallbacks.delete(secondFrame[0])
    nowMs += 250
    await act(async () => secondFrame[1](1_250))
    expect(fireSurfaces[0].draw).toHaveBeenLastCalledWith(
      expect.objectContaining({
        originCenterX: 0,
        originCenterY: 0,
        sizeX: 0.25,
      })
    )

    await act(async () => {
      await jest.advanceTimersByTimeAsync(500)
    })
    const finalFrame = [...requestCallbacks.entries()][0]
    requestCallbacks.delete(finalFrame[0])
    nowMs += 20
    await act(async () => finalFrame[1](1_520))
    expect(requestCallbacks.size).toBe(0)

    let thunderResult:
      | Awaited<ReturnType<NonNullable<FireThunderLabController['startPlan']>>>
      | undefined
    await act(async () => {
      thunderResult = await controllerRef.current?.startPlan?.(
        performancePlan({
          planId: 'plan-thunder',
          effectId: 'thunderBall',
          durationMs: 500,
          position: { x: 0.2, y: 0.4 },
          strength: 0.5,
          seed: 77,
          keyframes: [
            {
              atMs: 0,
              position: { x: 0.2, y: 0.4 },
              strength: 0.5,
            },
          ],
        })
      )
    })
    expect(thunderResult?.status).toBe('accepted')
    expect(thunderSurfaces[0].configure).toHaveBeenCalledWith(
      expect.objectContaining({
        centerX: 0.2,
        centerY: 0.4,
        lineWidth: 4,
        orbRadius: 0.39,
        publicParameters: expect.objectContaining({ seed: 77 }),
        topologySeed: expect.any(Number),
      })
    )
  })

  it('rejects a planned start as busy without replacing a manual effect', async () => {
    const fireSurfaces: ReturnType<typeof mockFireSurface>[] = []
    const thunderSurfaces: ReturnType<typeof mockThunderSurface>[] = []
    const controllerRef = createRef<FireThunderLabController>()
    render(
      <FireThunderLabCanvasLayer
        ref={controllerRef}
        createFireSurface={() => {
          const surface = mockFireSurface()
          fireSurfaces.push(surface)
          return surface
        }}
        createThunderSurface={() => {
          const surface = mockThunderSurface()
          thunderSurfaces.push(surface)
          return surface
        }}
        webgl2Available
        waitFrame={async () => {}}
      />
    )
    await act(async () => {
      await controllerRef.current?.start(FIRE_EFFECT_ID)
    })

    let result:
      | Awaited<ReturnType<NonNullable<FireThunderLabController['startPlan']>>>
      | undefined
    await act(async () => {
      result = await controllerRef.current?.startPlan?.(
        performancePlan({ effectId: 'thunderBall' })
      )
    })
    expect(result).toEqual({ status: 'busy', hostResult: null })
    expect(fireSurfaces).toHaveLength(1)
    expect(thunderSurfaces).toHaveLength(0)
  })

  it('revokes all frame and start authority after planned cleanup remains unproved', async () => {
    const fireFactory = jest.fn(() => mockFireSurface())
    const thunderSurfaces: ReturnType<typeof mockThunderSurface>[] = []
    const statuses: string[] = []
    const controllerRef = createRef<FireThunderLabController>()
    jest.spyOn(performance, 'now').mockImplementation(incrementingClock())
    render(
      <FireThunderLabCanvasLayer
        ref={controllerRef}
        createFireSurface={fireFactory}
        createThunderSurface={() => {
          const surface = mockThunderSurface()
          thunderSurfaces.push(surface)
          return surface
        }}
        onStatusChange={(result) => statuses.push(result.status)}
        webgl2Available
        waitFrame={async () => {}}
      />
    )

    let initial:
      | Awaited<ReturnType<NonNullable<FireThunderLabController['startPlan']>>>
      | undefined
    await act(async () => {
      initial = await controllerRef.current?.startPlan?.(
        performancePlan({ effectId: 'thunderBall' })
      )
    })
    expect(initial?.status).toBe('accepted')
    expect(thunderSurfaces).toHaveLength(1)
    expect(requestCallbacks.size).toBe(1)

    thunderSurfaces[0].renderFrame.mockReturnValue(
      fixedThunderWebGl2AdapterResult('stopped', 'blocked')
    )
    thunderSurfaces[0].dispose.mockImplementation(() => {
      throw new Error('private retained cleanup detail')
    })
    const failedFrame = [...requestCallbacks.entries()][0]
    requestCallbacks.delete(failedFrame[0])
    await act(async () => failedFrame[1](1_000))

    expect(statuses).toContain('visual-failed')
    expect(requestCallbacks.size).toBe(0)
    const frameCountAfterFailure =
      thunderSurfaces[0].renderFrame.mock.calls.length
    await act(async () => failedFrame[1](1_016))
    expect(thunderSurfaces[0].renderFrame).toHaveBeenCalledTimes(
      frameCountAfterFailure
    )
    expect(requestCallbacks.size).toBe(0)

    let manualResult: Awaited<ReturnType<FireThunderLabController['start']>> =
      null
    let plannedResult:
      | Awaited<ReturnType<NonNullable<FireThunderLabController['startPlan']>>>
      | undefined
    await act(async () => {
      manualResult =
        (await controllerRef.current?.start(FIRE_EFFECT_ID)) ?? null
      plannedResult = await controllerRef.current?.startPlan?.(
        performancePlan({
          planId: 'plan-after-unproved-cleanup',
          effectId: 'fire',
        })
      )
    })

    expect(manualResult).toBeNull()
    expect(plannedResult).toEqual({
      status: 'cleanup_unproved',
      hostResult: null,
    })
    expect(fireFactory).not.toHaveBeenCalled()
    expect(thunderSurfaces).toHaveLength(1)
    expect(requestCallbacks.size).toBe(0)
    expect(
      JSON.stringify({ manualResult, plannedResult, statuses })
    ).not.toContain('private retained cleanup detail')
  })

  it('clears pooled surfaces on stop, reset, and emergency without late draws', async () => {
    const fireSurfaces: ReturnType<typeof mockFireSurface>[] = []
    const thunderSurfaces: ReturnType<typeof mockThunderSurface>[] = []
    const controllerRef = createRef<FireThunderLabController>()
    render(
      <FireThunderLabCanvasLayer
        ref={controllerRef}
        createFireSurface={() => {
          const surface = mockFireSurface()
          fireSurfaces.push(surface)
          return surface
        }}
        createThunderSurface={() => {
          const surface = mockThunderSurface()
          thunderSurfaces.push(surface)
          return surface
        }}
        webgl2Available
        waitFrame={async () => {}}
      />
    )

    await act(async () => {
      await controllerRef.current?.start(FIRE_EFFECT_ID)
    })
    const staleFireFrame = [...requestCallbacks.values()][0]
    await act(async () => {
      await controllerRef.current?.stop()
    })
    expect(requestCallbacks.size).toBe(0)
    expect(fireSurfaces[0].dispose).toHaveBeenCalledTimes(1)
    const stoppedFireDrawCount = fireSurfaces[0].draw.mock.calls.length
    await act(async () => staleFireFrame(32))
    expect(fireSurfaces[0].draw).toHaveBeenCalledTimes(stoppedFireDrawCount)
    expect(requestCallbacks.size).toBe(0)

    await act(async () => {
      await controllerRef.current?.start(THUNDER_BALL_EFFECT_ID)
    })
    await act(async () => {
      await controllerRef.current?.emergencyStop()
    })
    expect(requestCallbacks.size).toBe(0)
    expect(thunderSurfaces[0].dispose).toHaveBeenCalledTimes(1)
    await act(async () => {
      await controllerRef.current?.reset()
      await controllerRef.current?.start(THUNDER_BALL_EFFECT_ID)
    })
    const staleThunderFrame = [...requestCallbacks.values()][0]
    await act(async () => {
      await controllerRef.current?.reset()
    })
    expect(requestCallbacks.size).toBe(0)
    expect(thunderSurfaces[1].reset).toHaveBeenCalledTimes(1)
    expect(thunderSurfaces[1].dispose).toHaveBeenCalledTimes(1)
    const resetThunderDrawCount =
      thunderSurfaces[1].renderFrame.mock.calls.length
    await act(async () => staleThunderFrame(48))
    expect(thunderSurfaces[1].renderFrame).toHaveBeenCalledTimes(
      resetThunderDrawCount
    )
    expect(requestCallbacks.size).toBe(0)
  })

  it('returns Thunder to idle at finite auto-end without a later draw', async () => {
    jest.useFakeTimers()
    jest
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((callback) => {
        const requestId = nextRequestId
        nextRequestId += 1
        requestCallbacks.set(requestId, callback)
        return requestId
      })
    jest
      .spyOn(window, 'cancelAnimationFrame')
      .mockImplementation((requestId) => {
        requestCallbacks.delete(requestId)
      })
    const thunderSurfaces: ReturnType<typeof mockThunderSurface>[] = []
    const statuses: string[] = []
    const controllerRef = createRef<FireThunderLabController>()
    render(
      <FireThunderLabCanvasLayer
        ref={controllerRef}
        createFireSurface={() => mockFireSurface()}
        createThunderSurface={() => {
          const surface = mockThunderSurface()
          thunderSurfaces.push(surface)
          return surface
        }}
        onStatusChange={(result) => statuses.push(result.status)}
        reducedMotion
        webgl2Available
        waitFrame={async () => {}}
      />
    )
    await act(async () => {
      await controllerRef.current?.start(THUNDER_BALL_EFFECT_ID)
    })
    expect(requestCallbacks.size).toBe(1)

    await act(async () => {
      await jest.advanceTimersByTimeAsync(5_000)
    })
    expect(thunderSurfaces[0].dispose).toHaveBeenCalledTimes(1)
    const drawCount = thunderSurfaces[0].renderFrame.mock.calls.length
    const finalFrame = [...requestCallbacks.entries()][0]
    requestCallbacks.delete(finalFrame[0])
    await act(async () => finalFrame[1](5_016))

    expect(statuses).toContain('no-active-effect')
    expect(requestCallbacks.size).toBe(0)
    expect(thunderSurfaces[0].renderFrame).toHaveBeenCalledTimes(drawCount)
  })

  it('fails closed without scheduling when a renderer surface is unavailable', async () => {
    const controllerRef = createRef<FireThunderLabController>()
    render(
      <FireThunderLabCanvasLayer
        ref={controllerRef}
        createFireSurface={() => {
          throw new Error('test surface unavailable')
        }}
        createThunderSurface={() => mockThunderSurface()}
        webgl2Available
      />
    )
    let result: Awaited<ReturnType<FireThunderLabController['start']>> = null
    await act(async () => {
      result = (await controllerRef.current?.start(FIRE_EFFECT_ID)) ?? null
    })
    expect(result).toEqual(
      expect.objectContaining({ status: 'visual-failed', activeEffectId: null })
    )
    expect(requestCallbacks.size).toBe(0)
  })

  it('waits for proved cleanup before allowing one replacement start', async () => {
    const firstFire = mockFireSurface()
    const secondFire = mockFireSurface()
    const firstFactory = jest.fn(() => firstFire)
    const secondFactory = jest.fn(() => secondFire)
    const controllerRef = createRef<FireThunderLabController>()
    const createThunderSurface = () => mockThunderSurface()
    const view = render(
      <FireThunderLabCanvasLayer
        ref={controllerRef}
        createFireSurface={firstFactory}
        createThunderSurface={createThunderSurface}
        webgl2Available
      />
    )

    await act(async () => {
      await controllerRef.current?.start(FIRE_EFFECT_ID)
    })
    view.rerender(
      <FireThunderLabCanvasLayer
        ref={controllerRef}
        createFireSurface={secondFactory}
        createThunderSurface={createThunderSurface}
        webgl2Available
      />
    )

    let result: Awaited<ReturnType<FireThunderLabController['start']>> = null
    await act(async () => {
      result = (await controllerRef.current?.start(FIRE_EFFECT_ID)) ?? null
    })

    expect(firstFire.dispose).toHaveBeenCalledTimes(1)
    expect(secondFactory).toHaveBeenCalledTimes(1)
    expect(secondFire.draw).toHaveBeenCalledTimes(1)
    expect(result).toEqual(expect.objectContaining({ status: 'started' }))
    view.unmount()
  })

  it('quarantines failed cleanup and blocks replacement acquisition', async () => {
    const firstFire = mockFireSurface()
    firstFire.dispose.mockImplementation(() => {
      throw new Error('private renderer cleanup detail')
    })
    const replacementFactory = jest.fn(() => mockFireSurface())
    const controllerRef = createRef<FireThunderLabController>()
    const createThunderSurface = () => mockThunderSurface()
    const view = render(
      <FireThunderLabCanvasLayer
        ref={controllerRef}
        createFireSurface={() => firstFire}
        createThunderSurface={createThunderSurface}
        webgl2Available
      />
    )

    await act(async () => {
      await controllerRef.current?.start(FIRE_EFFECT_ID)
    })
    view.rerender(
      <FireThunderLabCanvasLayer
        ref={controllerRef}
        createFireSurface={replacementFactory}
        createThunderSurface={createThunderSurface}
        webgl2Available
      />
    )

    let result: Awaited<ReturnType<FireThunderLabController['start']>> = null
    await act(async () => {
      result = (await controllerRef.current?.start(FIRE_EFFECT_ID)) ?? null
    })

    expect(result).toBeNull()
    expect(replacementFactory).not.toHaveBeenCalled()
    expect(requestCallbacks.size).toBe(0)
    expect(JSON.stringify(result)).not.toContain(
      'private renderer cleanup detail'
    )
    view.unmount()
  })
})

function mockFireSurface() {
  return {
    step: jest.fn(),
    draw: jest.fn(),
    setOrigins: jest.fn(),
    reset: jest.fn(),
    clear: jest.fn(),
    dispose: jest.fn(),
  } satisfies FireP027Surface
}

function mockThunderSurface() {
  return {
    configure: jest.fn(),
    start: jest.fn(() => fixedThunderWebGl2AdapterResult('running', 'started')),
    renderFrame: jest.fn(() =>
      fixedThunderWebGl2AdapterResult('running', 'rendered')
    ),
    stop: jest.fn(() => fixedThunderWebGl2AdapterResult('stopped', 'stopped')),
    reset: jest.fn(() => fixedThunderWebGl2AdapterResult('idle', 'reset')),
    emergencyStop: jest.fn(() =>
      fixedThunderWebGl2AdapterResult('stopped', 'emergency-stopped')
    ),
    dispose: jest.fn(),
  } satisfies ThunderWebGl2AdapterSurface
}

function performancePlan(
  overrides: Partial<ProjectionPerformancePlan> = {}
): ProjectionPerformancePlan {
  return {
    schemaVersion: 1,
    planId: 'plan-layer',
    sessionId: 'session-layer',
    revision: 1,
    action: 'start',
    effectId: 'fire',
    position: { x: 0, y: 0 },
    strength: 0.5,
    durationMs: 1_000,
    seed: 1,
    keyframes: [
      {
        atMs: 0,
        position: { x: 0, y: 0 },
        strength: 0.5,
      },
    ],
    ...overrides,
  }
}

function startCommand(
  effectId: typeof FIRE_EFFECT_ID | typeof THUNDER_BALL_EFFECT_ID,
  parameters: Readonly<Record<string, unknown>> = {}
): ProjectionEffectStartCommand {
  return {
    schemaVersion: PROJECTION_EFFECT_COMMAND_SCHEMA_VERSION,
    commandId: `lab.${effectId}.start.test`,
    effectId,
    action: 'start',
    parameters,
    speechCompletion: 'finished',
  }
}

function incrementingClock(): () => number {
  let nowMs = 1000
  return () => {
    nowMs += 17
    return nowMs
  }
}

function installCanvasContextMocks(): void {
  const webgl2Context = {
    COLOR_BUFFER_BIT: 0x4000,
    clearColor: jest.fn(),
    clear: jest.fn(),
  }
  const canvas2dContext = {
    setTransform: jest.fn(),
    clearRect: jest.fn(),
  }
  jest.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(((
    contextId: string
  ) => {
    if (contextId === 'webgl2') return webgl2Context
    if (contextId === '2d') return canvas2dContext
    return null
  }) as typeof HTMLCanvasElement.prototype.getContext)
}
