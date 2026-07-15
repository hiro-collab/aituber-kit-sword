import { act, render, waitFor } from '@testing-library/react'
import {
  FluidFireRelayCanvasLayer,
  resolveProjectionEffectSelection,
} from '../browser/fluidFireRelayCanvasLayer'

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
    jest.restoreAllMocks()
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
      configurable: true,
      value: originalGetContext,
    })
  })

  it('fails closed for unknown, array, URL, and disabled selections', () => {
    expect(resolveProjectionEffectSelection('fluidFireRelay', null)).toBe(
      'fluidFireRelay'
    )
    expect(resolveProjectionEffectSelection(undefined, 'fluidFireRelay')).toBe(
      'fluidFireRelay'
    )
    expect(
      resolveProjectionEffectSelection(['fluidFireRelay'], 'fluidFireRelay')
    ).toBeNull()
    expect(resolveProjectionEffectSelection(null, 'fluidFireRelay')).toBeNull()
    expect(resolveProjectionEffectSelection({}, 'fluidFireRelay')).toBeNull()
    expect(
      resolveProjectionEffectSelection('unknown', 'fluidFireRelay')
    ).toBeNull()
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

    act(() =>
      canvas.dispatchEvent(new Event('contextlost', { cancelable: true }))
    )
    expect(canvas.dataset.effectStatus).toBe('context-lost')
    expect(requestCallbacks.size).toBe(0)

    act(() => canvas.dispatchEvent(new Event('contextrestored')))
    expect(canvas.dataset.effectStatus).toBe('recovering')
    expect(requestCallbacks.size).toBe(1)

    view.unmount()
    expect(requestCallbacks.size).toBe(0)
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
})
