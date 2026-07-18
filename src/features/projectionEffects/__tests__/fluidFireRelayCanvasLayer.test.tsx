import { act, render, waitFor } from '@testing-library/react'
import {
  deriveFluidFireRelayAvatarLighting,
  drawFluidFireRelayFrame,
  FluidFireRelayCanvasLayer,
  resolveProjectionEffectSelection,
} from '../browser/fluidFireRelayCanvasLayer'
import { DEFAULT_FLUID_FIRE_RELAY_PARAMETERS } from '../settings'
import {
  getAvatarLightingContribution,
  resetAvatarLightingContribution,
} from '../avatarLighting'
import * as pooledRuntimeModule from '../browser/fluidFireRelayPooledRuntime'
import { fluidFireRelayDefinition } from '../plugins/fluidFireRelay/definition'
import type { FluidFireRelayFrameObserver } from '../plugins/fluidFireRelay/renderer'
import type {
  ProjectionEffectRenderResult,
  ProjectionEffectSession,
} from '../rendererPlugin'

describe('FluidFireRelayCanvasLayer', () => {
  const originalGetContext = HTMLCanvasElement.prototype.getContext
  const requestCallbacks = new Map<number, FrameRequestCallback>()
  let nextRequestId = 1
  const gradient = { addColorStop: jest.fn() }
  const drawingContext = {
    setTransform: jest.fn(),
    clearRect: jest.fn(),
    save: jest.fn(),
    restore: jest.fn(),
    createRadialGradient: jest.fn(() => gradient),
    beginPath: jest.fn(),
    arc: jest.fn(),
    fill: jest.fn(),
    fillStyle: '',
    globalCompositeOperation: 'source-over',
  } as unknown as CanvasRenderingContext2D

  beforeEach(() => {
    resetAvatarLightingContribution()
    requestCallbacks.clear()
    nextRequestId = 1
    jest.clearAllMocks()
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
      configurable: true,
      value: jest.fn(() => drawingContext),
    })
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
    resetAvatarLightingContribution()
    jest.restoreAllMocks()
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
      configurable: true,
      value: originalGetContext,
    })
  })

  it('fails closed for unknown, array, URL, and disabled selections', () => {
    expect(resolveProjectionEffectSelection('fluidFireRelay', null)).toBeNull()
    expect(resolveProjectionEffectSelection(undefined, 'fluidFireRelay')).toBe(
      'fluidFireRelay'
    )
    expect(
      resolveProjectionEffectSelection(['fluidFireRelay'], 'fluidFireRelay')
    ).toBe('fluidFireRelay')
    expect(resolveProjectionEffectSelection(null, 'fluidFireRelay')).toBe(
      'fluidFireRelay'
    )
    expect(resolveProjectionEffectSelection({}, 'fluidFireRelay')).toBe(
      'fluidFireRelay'
    )
    expect(resolveProjectionEffectSelection('unknown', 'fluidFireRelay')).toBe(
      'fluidFireRelay'
    )
    expect(
      resolveProjectionEffectSelection(' fluidFireRelay ', undefined)
    ).toBeNull()
    expect(
      resolveProjectionEffectSelection(undefined, ' fluidFireRelay ')
    ).toBeNull()
    expect(
      resolveProjectionEffectSelection('https://example.test/effect', null)
    ).toBeNull()

    expect(
      resolveProjectionEffectSelection('fluidFireRelay', 'none', true)
    ).toBe('fluidFireRelay')
    for (const malformed of [
      ['fluidFireRelay'],
      null,
      {},
      'unknown',
      ' fluidFireRelay ',
      'https://example.test/effect',
    ]) {
      expect(
        resolveProjectionEffectSelection(malformed, 'fluidFireRelay', true)
      ).toBeNull()
    }
    const disabled = render(<FluidFireRelayCanvasLayer enabled={false} />)
    expect(disabled.getByTestId('fluid-fire-relay-layer')).not.toBeVisible()
    expect(
      disabled.queryAllByTestId(/^projection-effect-.*-canvas$/)
    ).toHaveLength(2)
    expect(window.requestAnimationFrame).not.toHaveBeenCalled()
  })

  it('renders through the shared compositor and stops on disable or dispose', async () => {
    const view = render(<FluidFireRelayCanvasLayer enabled />)
    const layer = view.getByTestId('fluid-fire-relay-layer')

    await waitFor(() => expect(layer.dataset.effectStatus).toBe('started'))
    expect(layer.dataset.projectionEffectId).toBe('fluidFireRelay')
    expect(view.getAllByTestId(/^projection-effect-.*-canvas$/)).toHaveLength(2)
    expect(requestCallbacks.size).toBe(1)

    const firstFrame = [...requestCallbacks.entries()][0]
    requestCallbacks.delete(firstFrame[0])
    await act(async () => firstFrame[1](16))

    await waitFor(() => expect(layer.dataset.effectStatus).toBe('rendered'))
    expect(layer.dataset.effectFrameCount).toBe('1')
    expect(drawingContext.clearRect).toHaveBeenCalledTimes(1)
    expect(drawingContext.arc).toHaveBeenCalledTimes(18)
    expect(requestCallbacks.size).toBe(1)
    const lightingContribution = getAvatarLightingContribution()
    expect(lightingContribution.status).toBe('active')
    expect(lightingContribution.intensityScale).toBeGreaterThanOrEqual(1)
    expect(lightingContribution.intensityScale).toBeLessThanOrEqual(1.5)

    view.rerender(<FluidFireRelayCanvasLayer enabled={false} />)
    await waitFor(() => expect(requestCallbacks.size).toBe(0))
    expect(getAvatarLightingContribution().status).toBe('neutral')

    await unmountAndFlush(view)
    expect(requestCallbacks.size).toBe(0)
    expect(getAvatarLightingContribution().status).toBe('neutral')
  })

  it('reports unavailable without scheduling when Canvas 2D is absent', async () => {
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
      configurable: true,
      value: jest.fn(() => null),
    })
    const view = render(<FluidFireRelayCanvasLayer enabled />)
    await waitFor(() =>
      expect(view.getByTestId('fluid-fire-relay-layer')).toHaveAttribute(
        'data-effect-status',
        'surface-unavailable'
      )
    )
    expect(window.requestAnimationFrame).not.toHaveBeenCalled()
    await unmountAndFlush(view)
  })

  it('applies a valid parameter update on the next frame without restarting the layer', async () => {
    const view = render(
      <FluidFireRelayCanvasLayer
        enabled
        parameters={{
          ...DEFAULT_FLUID_FIRE_RELAY_PARAMETERS,
          temperatureGain: 0,
        }}
      />
    )
    const layer = view.getByTestId('fluid-fire-relay-layer')
    await waitFor(() => expect(layer.dataset.effectStatus).toBe('started'))

    const firstFrame = [...requestCallbacks.entries()][0]
    requestCallbacks.delete(firstFrame[0])
    await act(async () => firstFrame[1](16))
    const firstColorStops = gradient.addColorStop.mock.calls.map((call) =>
      String(call[1])
    )

    view.rerender(
      <FluidFireRelayCanvasLayer
        enabled
        parameters={{
          ...DEFAULT_FLUID_FIRE_RELAY_PARAMETERS,
          temperatureGain: 2,
        }}
      />
    )
    const secondFrame = [...requestCallbacks.entries()][0]
    requestCallbacks.delete(secondFrame[0])
    await act(async () => secondFrame[1](32))
    const secondColorStops = gradient.addColorStop.mock.calls
      .slice(firstColorStops.length)
      .map((call) => String(call[1]))

    expect(secondColorStops).not.toEqual(firstColorStops)
    expect(layer.dataset.effectFrameCount).toBe('2')
    expect(window.requestAnimationFrame).toHaveBeenCalledTimes(3)
    await unmountAndFlush(view)
  })

  it('uses bloom gain in the rendered frame instead of exposing a no-op control', () => {
    const snapshot = {
      disposed: false,
      frameCount: 1,
      densityEnergy: 1,
      temperatureEnergy: 1,
      pressureEnergy: 1,
      completedPassCount: 4,
    }
    drawFluidFireRelayFrame(drawingContext, 1920, 1080, snapshot, {
      nowMs: 16,
      deltaMs: 16,
      parameters: {
        ...DEFAULT_FLUID_FIRE_RELAY_PARAMETERS,
        bloomGain: 0,
      },
    })
    const noBloomStops = gradient.addColorStop.mock.calls.map((call) =>
      String(call[1])
    )
    gradient.addColorStop.mockClear()

    drawFluidFireRelayFrame(drawingContext, 1920, 1080, snapshot, {
      nowMs: 16,
      deltaMs: 16,
      parameters: {
        ...DEFAULT_FLUID_FIRE_RELAY_PARAMETERS,
        bloomGain: 1.5,
      },
    })
    const fullBloomStops = gradient.addColorStop.mock.calls.map((call) =>
      String(call[1])
    )

    expect(fullBloomStops).not.toEqual(noBloomStops)
    expect(fullBloomStops[0]).not.toBe(noBloomStops[0])
  })

  it('derives one bounded avatar-light sample and fails closed on invalid energy', () => {
    const frameContext = {
      nowMs: 16,
      deltaMs: 16,
      parameters: DEFAULT_FLUID_FIRE_RELAY_PARAMETERS,
    }
    const contribution = deriveFluidFireRelayAvatarLighting(
      {
        disposed: false,
        frameCount: 1,
        densityEnergy: 2,
        temperatureEnergy: 3,
        pressureEnergy: 1,
        completedPassCount: 4,
      },
      frameContext
    )
    expect(contribution.status).toBe('active')
    expect(contribution.intensityScale).toBeCloseTo(1.304)
    expect(contribution.warmthClass).toBe('warm')

    expect(
      deriveFluidFireRelayAvatarLighting(
        {
          disposed: false,
          frameCount: 1,
          densityEnergy: Number.NaN,
          temperatureEnergy: 1,
          pressureEnergy: 1,
          completedPassCount: 4,
        },
        frameContext
      )
    ).toEqual({
      status: 'neutral',
      intensityScale: 1,
      warmthClass: 'neutral',
    })
  })

  it('retains the compositor until direct-unmount session termination joins', async () => {
    const termination = deferred<ProjectionEffectRenderResult>()
    let observer: FluidFireRelayFrameObserver | null = null
    let runtime: pooledRuntimeModule.FluidFireRelayPooledRuntime | null = null
    let compositor:
      | pooledRuntimeModule.FluidFireRelayPooledRuntimeOptions['compositor']
      | null = null
    jest
      .spyOn(pooledRuntimeModule, 'createFluidFireRelayPooledRuntime')
      .mockImplementation((options) => {
        compositor = options.compositor
        runtime = new pooledRuntimeModule.FluidFireRelayPooledRuntime(options)
        return runtime
      })
    const terminate = jest.fn(() => termination.promise)
    const createSession = (
      nextObserver: FluidFireRelayFrameObserver
    ): ProjectionEffectSession => {
      observer = nextObserver
      return {
        definition: fluidFireRelayDefinition,
        lifecycle: 'registered',
        start: async () => renderResult('started'),
        update: async (frameContext) => {
          observer?.(
            {
              disposed: false,
              frameCount: 1,
              densityEnergy: 1,
              temperatureEnergy: 1,
              pressureEnergy: 1,
              completedPassCount: 4,
            },
            frameContext
          )
          return renderResult('rendered')
        },
        stop: async () => renderResult('stopped'),
        reset: async () => renderResult('reset'),
        dispose: async () => renderResult('disposed'),
        terminate,
      }
    }
    const view = render(
      <FluidFireRelayCanvasLayer enabled createSession={createSession} />
    )
    const layer = view.getByTestId('fluid-fire-relay-layer')
    await waitFor(() => expect(layer.dataset.effectStatus).toBe('started'))
    const firstFrame = [...requestCallbacks.entries()][0]
    requestCallbacks.delete(firstFrame[0])
    await act(async () => firstFrame[1](16))
    const clearCountBeforeUnmount = drawingContext.clearRect.mock.calls.length
    expect(getAvatarLightingContribution().status).toBe('active')

    act(() => view.unmount())
    expect(requestCallbacks.size).toBe(0)
    expect(terminate).toHaveBeenCalledTimes(1)
    expect(runtime?.snapshot()).toMatchObject({
      state: 'terminating',
      activeLeaseCount: 1,
    })
    expect(drawingContext.clearRect).toHaveBeenCalledTimes(
      clearCountBeforeUnmount
    )
    expect(
      compositor?.acquireSurface({
        backend: 'webgl2',
        effectId: 'fire',
        sessionId: 'blocked.before.termination',
      }).status
    ).toBe('busy')
    expect(getAvatarLightingContribution().status).toBe('neutral')

    await act(async () => {
      termination.resolve(renderResult('disposed'))
      await termination.promise
      await Promise.resolve()
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
    })
    await waitFor(() =>
      expect(runtime?.snapshot()).toMatchObject({
        state: 'disposed',
        activeLeaseCount: 0,
      })
    )
    expect(drawingContext.clearRect.mock.calls.length).toBeGreaterThan(
      clearCountBeforeUnmount
    )
    expect(requestCallbacks.size).toBe(0)
    expect(getAvatarLightingContribution().status).toBe('neutral')
  })

  it('serializes disable and re-enable behind proved termination on one compositor', async () => {
    const termination = deferred<ProjectionEffectRenderResult>()
    const runtimes: pooledRuntimeModule.FluidFireRelayPooledRuntime[] = []
    const compositors: pooledRuntimeModule.FluidFireRelayPooledRuntimeOptions['compositor'][] =
      []
    jest
      .spyOn(pooledRuntimeModule, 'createFluidFireRelayPooledRuntime')
      .mockImplementation((options) => {
        compositors.push(options.compositor)
        const runtime = new pooledRuntimeModule.FluidFireRelayPooledRuntime(
          options
        )
        runtimes.push(runtime)
        return runtime
      })
    let sessionCount = 0
    const firstTerminate = jest.fn(() => termination.promise)
    const createSession = (
      observer: FluidFireRelayFrameObserver
    ): ProjectionEffectSession => {
      sessionCount += 1
      return observedSession(
        observer,
        sessionCount === 1
          ? firstTerminate
          : async () => renderResult('disposed')
      )
    }
    const view = render(
      <FluidFireRelayCanvasLayer enabled createSession={createSession} />
    )
    const layer = view.getByTestId('fluid-fire-relay-layer')
    await waitFor(() => expect(layer.dataset.effectStatus).toBe('started'))
    expect(runtimes).toHaveLength(1)

    view.rerender(
      <FluidFireRelayCanvasLayer
        enabled={false}
        createSession={createSession}
      />
    )
    await waitFor(() => expect(firstTerminate).toHaveBeenCalledTimes(1))
    expect(requestCallbacks.size).toBe(0)
    view.rerender(
      <FluidFireRelayCanvasLayer enabled createSession={createSession} />
    )
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(runtimes).toHaveLength(1)
    expect(runtimes[0].snapshot().activeLeaseCount).toBe(1)
    expect(
      compositors[0].acquireSurface({
        backend: 'webgl2',
        effectId: 'fire',
        sessionId: 'blocked.during.disable.transition',
      }).status
    ).toBe('busy')

    await act(async () => {
      termination.resolve(renderResult('disposed'))
      await termination.promise
    })
    await waitFor(() => expect(runtimes).toHaveLength(2))
    await waitFor(() => expect(layer.dataset.effectStatus).toBe('started'))
    expect(compositors[1]).toBe(compositors[0])
    expect(sessionCount).toBe(2)
    expect(requestCallbacks.size).toBe(1)
    await unmountAndFlush(view)
  })

  it('serializes createSession identity replacement behind proved termination', async () => {
    const termination = deferred<ProjectionEffectRenderResult>()
    const runtimes: pooledRuntimeModule.FluidFireRelayPooledRuntime[] = []
    const compositors: pooledRuntimeModule.FluidFireRelayPooledRuntimeOptions['compositor'][] =
      []
    jest
      .spyOn(pooledRuntimeModule, 'createFluidFireRelayPooledRuntime')
      .mockImplementation((options) => {
        compositors.push(options.compositor)
        const runtime = new pooledRuntimeModule.FluidFireRelayPooledRuntime(
          options
        )
        runtimes.push(runtime)
        return runtime
      })
    const firstTerminate = jest.fn(() => termination.promise)
    const firstFactory = (observer: FluidFireRelayFrameObserver) =>
      observedSession(observer, firstTerminate)
    const secondFactory = (observer: FluidFireRelayFrameObserver) =>
      observedSession(observer, async () => renderResult('disposed'))
    const view = render(
      <FluidFireRelayCanvasLayer enabled createSession={firstFactory} />
    )
    const layer = view.getByTestId('fluid-fire-relay-layer')
    await waitFor(() => expect(layer.dataset.effectStatus).toBe('started'))

    view.rerender(
      <FluidFireRelayCanvasLayer enabled createSession={secondFactory} />
    )
    await waitFor(() => expect(firstTerminate).toHaveBeenCalledTimes(1))
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(runtimes).toHaveLength(1)
    expect(requestCallbacks.size).toBe(0)

    await act(async () => {
      termination.resolve(renderResult('disposed'))
      await termination.promise
    })
    await waitFor(() => expect(runtimes).toHaveLength(2))
    await waitFor(() => expect(layer.dataset.effectStatus).toBe('started'))
    expect(compositors[1]).toBe(compositors[0])
    expect(requestCallbacks.size).toBe(1)
    await unmountAndFlush(view)
  })

  it('permanently blocks queued replacement after uncertain termination', async () => {
    const privateSentinel = 'PRIVATE_LAYER_TERMINATION_FAILURE'
    const runtimes: pooledRuntimeModule.FluidFireRelayPooledRuntime[] = []
    const compositors: pooledRuntimeModule.FluidFireRelayPooledRuntimeOptions['compositor'][] =
      []
    jest
      .spyOn(pooledRuntimeModule, 'createFluidFireRelayPooledRuntime')
      .mockImplementation((options) => {
        compositors.push(options.compositor)
        const runtime = new pooledRuntimeModule.FluidFireRelayPooledRuntime(
          options
        )
        runtimes.push(runtime)
        return runtime
      })
    const failingFactory = (observer: FluidFireRelayFrameObserver) =>
      observedSession(observer, async () => {
        throw new Error(privateSentinel)
      })
    const replacementFactory = (observer: FluidFireRelayFrameObserver) =>
      observedSession(observer, async () => renderResult('disposed'))
    const view = render(
      <FluidFireRelayCanvasLayer enabled createSession={failingFactory} />
    )
    const layer = view.getByTestId('fluid-fire-relay-layer')
    await waitFor(() => expect(layer.dataset.effectStatus).toBe('started'))

    view.rerender(
      <FluidFireRelayCanvasLayer enabled createSession={replacementFactory} />
    )
    await waitFor(() =>
      expect(layer.dataset.effectStatus).toBe('runtime-quarantined')
    )
    expect(runtimes).toHaveLength(1)
    expect(requestCallbacks.size).toBe(0)
    expect(
      compositors[0].acquireSurface({
        backend: 'webgl2',
        effectId: 'fire',
        sessionId: 'blocked.after.layer.quarantine',
      }).status
    ).toBe('compositor-quarantined')
    expect(JSON.stringify(runtimes[0].snapshot())).not.toContain(
      privateSentinel
    )

    await unmountAndFlush(view)
    expect(runtimes).toHaveLength(1)
  })
})

function renderResult(
  status: ProjectionEffectRenderResult['status']
): ProjectionEffectRenderResult {
  return {
    status,
    lifecycle: status === 'disposed' ? 'disposed' : 'running',
    parameterErrorCount: 0,
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

function observedSession(
  observer: FluidFireRelayFrameObserver,
  terminate: () => Promise<ProjectionEffectRenderResult>
): ProjectionEffectSession {
  return {
    definition: fluidFireRelayDefinition,
    lifecycle: 'registered',
    start: async () => renderResult('started'),
    update: async (frameContext) => {
      observer(
        {
          disposed: false,
          frameCount: 1,
          densityEnergy: 1,
          temperatureEnergy: 1,
          pressureEnergy: 1,
          completedPassCount: 4,
        },
        frameContext
      )
      return renderResult('rendered')
    },
    stop: async () => renderResult('stopped'),
    reset: async () => renderResult('reset'),
    dispose: async () => renderResult('disposed'),
    terminate,
  }
}

async function unmountAndFlush(view: { unmount(): void }): Promise<void> {
  await act(async () => {
    view.unmount()
    for (let attempt = 0; attempt < 10; attempt += 1) {
      if (
        document.querySelector('[data-fluid-relay-compositor-host="true"]') ===
        null
      ) {
        return
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
    }
  })
}
