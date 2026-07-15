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
    expect(
      render(<FluidFireRelayCanvasLayer enabled={false} />).container
    ).toBeEmptyDOMElement()
    expect(window.requestAnimationFrame).not.toHaveBeenCalled()
  })

  it('renders through the registered plugin and stops on context loss or dispose', async () => {
    const view = render(<FluidFireRelayCanvasLayer enabled />)
    const canvas = view.getByTestId('fluid-fire-relay-layer')

    await waitFor(() => expect(canvas.dataset.effectStatus).toBe('started'))
    expect(canvas.dataset.projectionEffectId).toBe('fluidFireRelay')
    expect(requestCallbacks.size).toBe(1)

    const firstFrame = [...requestCallbacks.entries()][0]
    requestCallbacks.delete(firstFrame[0])
    await act(async () => firstFrame[1](16))

    await waitFor(() => expect(canvas.dataset.effectStatus).toBe('rendered'))
    expect(canvas.dataset.effectFrameCount).toBe('1')
    expect(drawingContext.clearRect).toHaveBeenCalledTimes(1)
    expect(drawingContext.arc).toHaveBeenCalledTimes(18)
    expect(requestCallbacks.size).toBe(1)
    const lightingContribution = getAvatarLightingContribution()
    expect(lightingContribution.status).toBe('active')
    expect(lightingContribution.intensityScale).toBeGreaterThanOrEqual(1)
    expect(lightingContribution.intensityScale).toBeLessThanOrEqual(1.5)

    act(() =>
      canvas.dispatchEvent(new Event('contextlost', { cancelable: true }))
    )
    expect(canvas.dataset.effectStatus).toBe('context-lost')
    expect(requestCallbacks.size).toBe(0)
    expect(getAvatarLightingContribution().status).toBe('neutral')

    act(() => canvas.dispatchEvent(new Event('contextrestored')))
    expect(canvas.dataset.effectStatus).toBe('recovering')
    expect(requestCallbacks.size).toBe(1)

    view.unmount()
    expect(requestCallbacks.size).toBe(0)
    expect(getAvatarLightingContribution().status).toBe('neutral')
  })

  it('reports unavailable without scheduling when Canvas 2D is absent', () => {
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
      configurable: true,
      value: jest.fn(() => null),
    })
    const view = render(<FluidFireRelayCanvasLayer enabled />)
    expect(view.getByTestId('fluid-fire-relay-layer')).toHaveAttribute(
      'data-effect-status',
      'unavailable'
    )
    expect(window.requestAnimationFrame).not.toHaveBeenCalled()
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
    const canvas = view.getByTestId('fluid-fire-relay-layer')
    await waitFor(() => expect(canvas.dataset.effectStatus).toBe('started'))

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
    expect(canvas.dataset.effectFrameCount).toBe('2')
    expect(window.requestAnimationFrame).toHaveBeenCalledTimes(3)
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
})
