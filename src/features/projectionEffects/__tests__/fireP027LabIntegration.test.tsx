import { act, render, waitFor } from '@testing-library/react'
import { createRef } from 'react'
import {
  FireThunderLabCanvasLayer,
  type FireThunderLabController,
} from '../browser/fireThunderLabCanvasLayer'
import type {
  FireP027Controls,
  FireP027OriginPoint,
  FireP027SpawnBatch,
  FireP027Surface,
} from '../plugins/fire/p027/contracts'
import { FIRE_EFFECT_ID } from '../plugins/fire/definition'
import { THUNDER_BALL_EFFECT_ID } from '../plugins/thunderBall/definition'
import type {
  ThunderBallFrame,
  ThunderBallSurface,
} from '../plugins/thunderBall/renderer'

describe('P027 Fire lab integration', () => {
  const requestCallbacks = new Map<number, FrameRequestCallback>()
  let nextRequestId = 1

  beforeEach(() => {
    requestCallbacks.clear()
    nextRequestId = 1
    jest
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((callback) => {
        const requestId = nextRequestId++
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
    jest.restoreAllMocks()
  })

  it('drains finite P027 state after the compositor RAF has stopped', async () => {
    const events: string[] = []
    installCanvasContexts(events)
    const fire = createFireSurface(events)
    const controllerRef = createRef<FireThunderLabController>()
    const view = render(
      <FireThunderLabCanvasLayer
        ref={controllerRef}
        createFireSurface={() => fire}
        createThunderSurface={() => createThunderSurface(events)}
        webgl2Available
        waitFrame={async () => {
          events.push('wait-frame')
        }}
      />
    )

    await act(async () => {
      await controllerRef.current?.start(FIRE_EFFECT_ID)
    })
    expect(requestCallbacks.size).toBe(1)
    events.length = 0

    let result: Awaited<ReturnType<FireThunderLabController['stop']>> = null
    await act(async () => {
      result = (await controllerRef.current?.stop()) ?? null
    })

    expect(result).toEqual(expect.objectContaining({ status: 'stopped' }))
    expect(requestCallbacks.size).toBe(0)
    expect(events.filter((event) => event === 'step:0').length).toBeGreaterThan(
      0
    )
    expect(events).toContain('wait-frame')
    expect(events.indexOf('step:0')).toBeLessThan(events.indexOf('dispose'))
    view.unmount()
  })

  it('routes Reset through the P027 atomic reset before terminal cleanup', async () => {
    const events: string[] = []
    installCanvasContexts(events)
    const fire = createFireSurface(events)
    const controllerRef = createRef<FireThunderLabController>()
    const view = render(
      <FireThunderLabCanvasLayer
        ref={controllerRef}
        createFireSurface={() => fire}
        createThunderSurface={() => createThunderSurface(events)}
        webgl2Available
        waitFrame={async () => {}}
      />
    )

    await act(async () => {
      await controllerRef.current?.start(FIRE_EFFECT_ID)
    })
    events.length = 0
    let result: Awaited<ReturnType<FireThunderLabController['reset']>> = null
    await act(async () => {
      result = (await controllerRef.current?.reset()) ?? null
    })

    expect(result).toEqual(expect.objectContaining({ status: 'reset' }))
    expect(fire.reset).toHaveBeenCalledTimes(1)
    expect(events.indexOf('reset')).toBeLessThan(events.indexOf('clear'))
    expect(events.indexOf('clear')).toBeLessThan(events.indexOf('dispose'))
    expect(requestCallbacks.size).toBe(0)
    view.unmount()
  })

  it('clears immediately on Emergency Stop without adding drain steps', async () => {
    const events: string[] = []
    installCanvasContexts(events)
    const fire = createFireSurface(events)
    const controllerRef = createRef<FireThunderLabController>()
    const view = render(
      <FireThunderLabCanvasLayer
        ref={controllerRef}
        createFireSurface={() => fire}
        createThunderSurface={() => createThunderSurface(events)}
        webgl2Available
      />
    )

    await act(async () => {
      await controllerRef.current?.start(FIRE_EFFECT_ID)
    })
    events.length = 0
    await act(async () => {
      await controllerRef.current?.emergencyStop()
    })

    expect(events.some((event) => event.startsWith('step:'))).toBe(false)
    expect(events).toEqual(expect.arrayContaining(['clear', 'dispose']))
    expect(requestCallbacks.size).toBe(0)
    view.unmount()
  })

  it('joins host termination before release on unmount and replacement', async () => {
    const events: string[] = []
    installCanvasContexts(events)
    const fire = createFireSurface(events)
    const controllerRef = createRef<FireThunderLabController>()
    const view = render(
      <FireThunderLabCanvasLayer
        ref={controllerRef}
        createFireSurface={() => fire}
        createThunderSurface={() => createThunderSurface(events)}
        webgl2Available
        waitFrame={async () => {}}
      />
    )

    await act(async () => {
      await controllerRef.current?.start(FIRE_EFFECT_ID)
    })
    events.length = 0
    await act(async () => {
      await controllerRef.current?.start(THUNDER_BALL_EFFECT_ID)
    })
    expect(events.indexOf('dispose')).toBeLessThan(
      events.indexOf('thunder-draw')
    )

    await act(async () => {
      await controllerRef.current?.start(FIRE_EFFECT_ID)
    })
    events.length = 0
    view.unmount()
    await waitFor(() => expect(events).toContain('dispose'))
    await act(async () => {
      await Promise.resolve()
    })

    expect(events.indexOf('clear')).toBeLessThan(events.indexOf('dispose'))
    expect(events.indexOf('dispose')).toBeLessThan(events.indexOf('pool-clear'))
    expect(requestCallbacks.size).toBe(0)
  })
})

function createFireSurface(events: string[]) {
  return {
    step: jest.fn(
      (
        _batch: Readonly<FireP027SpawnBatch>,
        rawGate: number,
        _controls: Readonly<FireP027Controls>
      ) => {
        events.push(`step:${rawGate}`)
      }
    ),
    draw: jest.fn((_controls: Readonly<FireP027Controls>) => {
      events.push('fire-draw')
    }),
    setOrigins: jest.fn((_points: readonly Readonly<FireP027OriginPoint>[]) => {
      events.push('origins')
    }),
    reset: jest.fn(() => {
      events.push('reset')
    }),
    clear: jest.fn(() => {
      events.push('clear')
    }),
    dispose: jest.fn(() => {
      events.push('dispose')
    }),
  } satisfies FireP027Surface
}

function createThunderSurface(events: string[]): ThunderBallSurface {
  return {
    draw: jest.fn((_frame: Readonly<ThunderBallFrame>) => {
      events.push('thunder-draw')
    }),
    clear: jest.fn(),
    dispose: jest.fn(() => {
      events.push('thunder-dispose')
    }),
  }
}

function installCanvasContexts(events: string[]): void {
  const webgl2Context = {
    COLOR_BUFFER_BIT: 0x4000,
    clearColor: jest.fn(),
    clear: jest.fn(() => {
      events.push('pool-clear')
    }),
  }
  const canvas2dContext = {
    setTransform: jest.fn(),
    clearRect: jest.fn(() => {
      events.push('pool-clear-2d')
    }),
  }
  jest.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(((
    contextId: string
  ) => {
    if (contextId === 'webgl2') return webgl2Context
    if (contextId === '2d') return canvas2dContext
    return null
  }) as typeof HTMLCanvasElement.prototype.getContext)
}
