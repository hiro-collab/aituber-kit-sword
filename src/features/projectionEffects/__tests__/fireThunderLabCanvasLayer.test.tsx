import { act, render, waitFor } from '@testing-library/react'
import { createRef } from 'react'
import {
  FIRE_THUNDER_LAB_VISUAL_PARAMETERS,
  FireThunderLabCanvasLayer,
  type FireThunderLabController,
} from '../browser/fireThunderLabCanvasLayer'
import {
  PROJECTION_EFFECT_COMMAND_SCHEMA_VERSION,
  type ProjectionEffectStartCommand,
} from '../effectCommand'
import { createFireThunderLabHost } from '../lab/fireThunderLabRegistry'
import { FIRE_EFFECT_ID } from '../plugins/fire/definition'
import type { FireParticleSurface } from '../plugins/fire/renderer'
import { THUNDER_BALL_EFFECT_ID } from '../plugins/thunderBall/definition'
import type {
  ThunderBallFrame,
  ThunderBallSurface,
} from '../plugins/thunderBall/renderer'
import FireThunderLabPage from '../../../pages/projection-effects-fire-thunder-lab'

describe('standalone Fire+Thunder lab registry and canvas lifecycle', () => {
  const requestCallbacks = new Map<number, FrameRequestCallback>()
  let nextRequestId = 1

  beforeEach(() => {
    requestCallbacks.clear()
    nextRequestId = 1
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
    expect(thunderSurfaces[0].draw).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({ reducedMotion: true }),
      })
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

    await act(async () => {
      await controllerRef.current?.start(FIRE_EFFECT_ID)
    })
    expect(fireSurfaces[0].draw).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({
        bloomGain: FIRE_THUNDER_LAB_VISUAL_PARAMETERS.fire.bloomGain,
        masterIntensity:
          FIRE_THUNDER_LAB_VISUAL_PARAMETERS.fire.masterIntensity,
        postProcessing: true,
      })
    )
    expect(requestCallbacks.size).toBe(1)
    const frame = [...requestCallbacks.entries()][0]
    requestCallbacks.delete(frame[0])
    await act(async () => frame[1](16))
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
    const drawCount = thunderSurfaces[0].draw.mock.calls.length
    const finalFrame = [...requestCallbacks.entries()][0]
    requestCallbacks.delete(finalFrame[0])
    await act(async () => finalFrame[1](5_016))

    expect(statuses).toContain('no-active-effect')
    expect(requestCallbacks.size).toBe(0)
    expect(thunderSurfaces[0].draw).toHaveBeenCalledTimes(drawCount)
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
})

function mockFireSurface() {
  return {
    draw: jest.fn(),
    clear: jest.fn(),
    dispose: jest.fn(),
  } satisfies FireParticleSurface
}

function mockThunderSurface() {
  return {
    draw: jest.fn((_frame: Readonly<ThunderBallFrame>) => {}),
    clear: jest.fn(),
    dispose: jest.fn(),
  } satisfies ThunderBallSurface
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
