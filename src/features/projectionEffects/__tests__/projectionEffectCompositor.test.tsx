import { act, render } from '@testing-library/react'
import { createRef } from 'react'
import {
  ProjectionEffectCompositor,
  type ProjectionEffectCompositorController,
} from '../browser/projectionEffectCompositor'

describe('ProjectionEffectCompositor', () => {
  beforeEach(() => {
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
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('mounts exactly two fixed canvases in backend z-order', () => {
    const view = render(<ProjectionEffectCompositor />)
    const root = view.getByTestId('projection-effect-compositor')
    const canvases = root.querySelectorAll('canvas')

    expect(canvases).toHaveLength(2)
    expect(view.getByTestId('projection-effect-webgl2-canvas')).toHaveStyle({
      zIndex: '0',
      mixBlendMode: 'normal',
    })
    expect(view.getByTestId('projection-effect-canvas2d-canvas')).toHaveStyle({
      zIndex: '1',
      mixBlendMode: 'normal',
    })
    expect(root).toHaveStyle({ isolation: 'isolate' })
    expect(root.querySelector('[style*="mix-blend-mode: screen"]')).toBeNull()
  })

  it('owns at most one RAF and rejects a cancelled stale callback', async () => {
    const raf = createRafFixture()
    const controllerRef = createRef<ProjectionEffectCompositorController>()
    const draw = jest.fn()
    render(
      <ProjectionEffectCompositor
        ref={controllerRef}
        requestFrame={raf.requestFrame}
        cancelFrame={raf.cancelFrame}
      />
    )

    expect(controllerRef.current?.startFrameLoop(draw)).toBe('completed')
    expect(controllerRef.current?.startFrameLoop(jest.fn())).toBe(
      'already-running'
    )
    expect(raf.callbacks).toHaveLength(1)
    const stale = raf.callbacks[0]
    expect(controllerRef.current?.stopFrameLoop()).toBe('completed')
    expect(raf.cancelFrame).toHaveBeenCalledTimes(1)

    await act(async () => stale.callback(16))
    expect(draw).not.toHaveBeenCalled()
    expect(controllerRef.current?.snapshot()).toEqual(
      expect.objectContaining({
        state: 'idle',
        activeRequestCount: 0,
        staleFrameRejectionCount: 1,
      })
    )
  })

  it('does not schedule a later frame after unmount during an async draw', async () => {
    const raf = createRafFixture()
    const controllerRef = createRef<ProjectionEffectCompositorController>()
    let resolveDraw: (() => void) | null = null
    const draw = jest.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveDraw = resolve
        })
    )
    const view = render(
      <ProjectionEffectCompositor
        ref={controllerRef}
        requestFrame={raf.requestFrame}
        cancelFrame={raf.cancelFrame}
      />
    )
    controllerRef.current?.startFrameLoop(draw)
    const frame = raf.callbacks[0]
    raf.callbacks.length = 0
    await act(async () => frame.callback(32))
    expect(draw).toHaveBeenCalledTimes(1)

    view.unmount()
    await act(async () => resolveDraw?.())
    expect(raf.callbacks).toHaveLength(0)
    expect(draw).toHaveBeenCalledTimes(1)
  })

  it('normalizes synchronous frame-callback failures', async () => {
    const raf = createRafFixture()
    const callbackFailureRef = createRef<ProjectionEffectCompositorController>()
    render(
      <ProjectionEffectCompositor
        ref={callbackFailureRef}
        requestFrame={raf.requestFrame}
        cancelFrame={raf.cancelFrame}
      />
    )
    expect(
      callbackFailureRef.current?.startFrameLoop(() => {
        throw new Error('private frame callback error')
      })
    ).toBe('completed')
    const frame = raf.callbacks[0]
    raf.callbacks.length = 0
    await act(async () => frame.callback(48))
    await act(async () => Promise.resolve())
    expect(callbackFailureRef.current?.snapshot()).toEqual(
      expect.objectContaining({
        state: 'running',
        completedFrameCount: 0,
        frameFailureCount: 1,
        activeRequestCount: 1,
      })
    )
  })

  it('quarantines a request that registers ownership and then throws', async () => {
    const callbacks: FrameRequestCallback[] = []
    const privateBrowserError = 'private request-frame error'
    const requestFrame = jest.fn((callback: FrameRequestCallback) => {
      callbacks.push(callback)
      throw new Error(privateBrowserError)
    })
    const controllerRef = createRef<ProjectionEffectCompositorController>()
    render(
      <ProjectionEffectCompositor
        ref={controllerRef}
        requestFrame={requestFrame}
      />
    )

    expect(controllerRef.current?.startFrameLoop(jest.fn())).toBe(
      'browser-boundary-failed'
    )
    expect(controllerRef.current?.startFrameLoop(jest.fn())).toBe(
      'compositor-quarantined'
    )
    expect(requestFrame).toHaveBeenCalledTimes(1)
    expect(callbacks).toHaveLength(1)
    await act(async () => callbacks[0](64))
    expect(requestFrame).toHaveBeenCalledTimes(1)
    const snapshot = controllerRef.current?.snapshot()
    expect(snapshot).toEqual(
      expect.objectContaining({
        state: 'quarantined',
        activeRequestCount: 0,
        browserBoundaryFailureCount: 1,
      })
    )
    expect(JSON.stringify(snapshot)).not.toContain(privateBrowserError)
  })

  it('quarantines an invalid request identity before restart', async () => {
    const callbacks: FrameRequestCallback[] = []
    const requestFrame = jest.fn((callback: FrameRequestCallback) => {
      callbacks.push(callback)
      return -1
    })
    const controllerRef = createRef<ProjectionEffectCompositorController>()
    render(
      <ProjectionEffectCompositor
        ref={controllerRef}
        requestFrame={requestFrame}
      />
    )

    expect(controllerRef.current?.startFrameLoop(jest.fn())).toBe(
      'browser-boundary-failed'
    )
    expect(controllerRef.current?.startFrameLoop(jest.fn())).toBe(
      'compositor-quarantined'
    )
    expect(requestFrame).toHaveBeenCalledTimes(1)
    await act(async () => callbacks[0](80))
    expect(requestFrame).toHaveBeenCalledTimes(1)
    expect(controllerRef.current?.snapshot()).toEqual(
      expect.objectContaining({
        state: 'quarantined',
        activeRequestCount: 0,
        browserBoundaryFailureCount: 1,
      })
    )
  })

  it('quarantines cancellation uncertainty and rejects restart', async () => {
    const raf = createRafFixture()
    raf.cancelFrame.mockImplementation(() => {
      throw new Error('private cancellation error')
    })
    const controllerRef = createRef<ProjectionEffectCompositorController>()
    render(
      <ProjectionEffectCompositor
        ref={controllerRef}
        requestFrame={raf.requestFrame}
        cancelFrame={raf.cancelFrame}
      />
    )
    const acquired = controllerRef.current?.acquireSurface({
      backend: 'canvas2d',
      effectId: 'thunderBall',
      sessionId: 'thunder.shutdown.cancel-failure',
    })
    acquired?.lease?.draw(() => {})
    expect(controllerRef.current?.startFrameLoop(jest.fn())).toBe('completed')

    const unresolvedFrame = raf.callbacks[0]
    expect(controllerRef.current?.stopFrameLoop()).toBe(
      'browser-boundary-failed'
    )
    expect(controllerRef.current?.startFrameLoop(jest.fn())).toBe(
      'compositor-quarantined'
    )
    expect(raf.requestFrame).toHaveBeenCalledTimes(1)
    await act(async () => unresolvedFrame.callback(96))
    expect(raf.requestFrame).toHaveBeenCalledTimes(1)
    expect(controllerRef.current?.shutdown()).toBe('compositor-quarantined')
    expect(controllerRef.current?.snapshot()).toEqual(
      expect.objectContaining({
        state: 'quarantined',
        activeRequestCount: 0,
        browserBoundaryFailureCount: 1,
        pool: expect.objectContaining({
          state: 'disposed',
          activeLeaseCount: 0,
          releaseCount: 1,
        }),
      })
    )
    expect(JSON.stringify(controllerRef.current?.snapshot())).not.toContain(
      'private cancellation error'
    )
    expect(acquired?.lease?.draw(jest.fn())).toEqual({
      status: 'stale-lease-rejected',
    })
  })

  it('quarantines pool cleanup uncertainty before any frame request', () => {
    const raf = createRafFixture()
    const controllerRef = createRef<ProjectionEffectCompositorController>()
    render(
      <ProjectionEffectCompositor
        ref={controllerRef}
        requestFrame={raf.requestFrame}
        cancelFrame={raf.cancelFrame}
      />
    )
    const acquired = controllerRef.current?.acquireSurface({
      backend: 'canvas2d',
      effectId: 'thunderBall',
      sessionId: 'thunder.pool.cleanup-unproved',
    })
    acquired?.lease?.draw(() => {})
    expect(acquired?.lease?.finish('cleanup-unproved')).toEqual({
      status: 'cleanup-unproved',
    })

    expect(controllerRef.current?.startFrameLoop(jest.fn())).toBe(
      'compositor-quarantined'
    )
    expect(raf.requestFrame).not.toHaveBeenCalled()
    expect(controllerRef.current?.snapshot()).toEqual(
      expect.objectContaining({
        state: 'quarantined',
        activeRequestCount: 0,
        pool: expect.objectContaining({
          state: 'cleanup-unproved',
          activeLeaseCount: 1,
          releaseCount: 0,
        }),
      })
    )
    expect(controllerRef.current?.shutdown()).toBe('cleanup-unproved')
    expect(controllerRef.current?.snapshot()).toEqual(
      expect.objectContaining({
        state: 'quarantined',
        pool: expect.objectContaining({
          state: 'cleanup-unproved',
          activeLeaseCount: 1,
          releaseCount: 0,
        }),
      })
    )
  })

  it('disposes the pool during unmount even when cancellation throws', () => {
    const raf = createRafFixture()
    raf.cancelFrame.mockImplementation(() => {
      throw new Error('private unmount cancellation error')
    })
    const controllerRef = createRef<ProjectionEffectCompositorController>()
    const view = render(
      <ProjectionEffectCompositor
        ref={controllerRef}
        requestFrame={raf.requestFrame}
        cancelFrame={raf.cancelFrame}
      />
    )
    const acquired = controllerRef.current?.acquireSurface({
      backend: 'canvas2d',
      effectId: 'thunderBall',
      sessionId: 'thunder.unmount.cancel-failure',
    })
    acquired?.lease?.draw(() => {})
    expect(controllerRef.current?.startFrameLoop(jest.fn())).toBe('completed')

    expect(() => view.unmount()).not.toThrow()
    expect(acquired?.lease?.draw(jest.fn())).toEqual({
      status: 'stale-lease-rejected',
    })
  })

  it('defers pool disposal while synchronously detaching the compositor', () => {
    const raf = createRafFixture()
    const controllerRef = createRef<ProjectionEffectCompositorController>()
    const view = render(
      <ProjectionEffectCompositor
        ref={controllerRef}
        requestFrame={raf.requestFrame}
        cancelFrame={raf.cancelFrame}
        unmountPoolOwnership="external-deferred"
      />
    )
    const controller = controllerRef.current!
    const acquired = controller.acquireSurface({
      backend: 'canvas2d',
      effectId: 'thunderBall',
      sessionId: 'thunder.deferred-unmount',
    })
    expect(acquired.status).toBe('completed')
    acquired.lease?.draw(() => {})
    expect(controller.startFrameLoop(jest.fn())).toBe('completed')

    view.unmount()

    expect(raf.cancelFrame).toHaveBeenCalledTimes(1)
    expect(raf.callbacks).toHaveLength(0)
    expect(controller.startFrameLoop(jest.fn())).toBe('compositor-disposed')
    expect(
      controller.acquireSurface({
        backend: 'canvas2d',
        effectId: 'thunderBall',
        sessionId: 'thunder.deferred-rejected',
      })
    ).toEqual({ status: 'compositor-unavailable', lease: null })
    expect(controller.snapshot()).toEqual(
      expect.objectContaining({
        state: 'disposed',
        activeRequestCount: 0,
        pool: expect.objectContaining({
          state: 'leased',
          activeLeaseCount: 1,
          releaseCount: 0,
        }),
      })
    )
    expect(acquired.lease?.draw(jest.fn())).toEqual({ status: 'completed' })
    expect(acquired.lease?.finish('cleanup-proved')).toEqual({
      status: 'completed',
    })
    expect(controller.shutdown()).toBe('completed')
    expect(controller.snapshot()).toEqual(
      expect.objectContaining({ state: 'disposed', pool: null })
    )
    expect(acquired.lease?.draw(jest.fn())).toEqual({
      status: 'stale-lease-rejected',
    })
  })

  it('keeps deferred cancellation uncertainty quarantined and non-echoing', () => {
    const raf = createRafFixture()
    const privateCancellationError = 'private deferred cancellation detail'
    raf.cancelFrame.mockImplementation(() => {
      throw new Error(privateCancellationError)
    })
    const controllerRef = createRef<ProjectionEffectCompositorController>()
    const view = render(
      <ProjectionEffectCompositor
        ref={controllerRef}
        requestFrame={raf.requestFrame}
        cancelFrame={raf.cancelFrame}
        unmountPoolOwnership="external-deferred"
      />
    )
    const controller = controllerRef.current!
    const acquired = controller.acquireSurface({
      backend: 'canvas2d',
      effectId: 'thunderBall',
      sessionId: 'thunder.deferred-cancel-failure',
    })
    acquired.lease?.draw(() => {})
    expect(controller.startFrameLoop(jest.fn())).toBe('completed')

    expect(() => view.unmount()).not.toThrow()

    expect(controller.startFrameLoop(jest.fn())).toBe('compositor-quarantined')
    expect(
      controller.acquireSurface({
        backend: 'canvas2d',
        effectId: 'thunderBall',
        sessionId: 'thunder.deferred-cancel-rejected',
      })
    ).toEqual({ status: 'compositor-quarantined', lease: null })
    expect(acquired.lease?.finish('cleanup-proved')).toEqual({
      status: 'completed',
    })
    expect(controller.shutdown()).toBe('compositor-quarantined')
    const snapshot = controller.snapshot()
    expect(snapshot).toEqual(
      expect.objectContaining({
        state: 'quarantined',
        activeRequestCount: 0,
        browserBoundaryFailureCount: 1,
        pool: null,
      })
    )
    expect(JSON.stringify(snapshot)).not.toContain(privateCancellationError)
  })

  it('uses the compositor pool and clears the active surface at shutdown', () => {
    const controllerRef = createRef<ProjectionEffectCompositorController>()
    render(<ProjectionEffectCompositor ref={controllerRef} />)
    const acquired = controllerRef.current?.acquireSurface({
      backend: 'canvas2d',
      effectId: 'thunderBall',
      sessionId: 'thunder.session.1',
    })
    expect(acquired?.status).toBe('completed')
    acquired?.lease?.draw(() => {})

    expect(controllerRef.current?.shutdown()).toBe('completed')
    expect(controllerRef.current?.snapshot()).toEqual(
      expect.objectContaining({
        state: 'disposed',
        activeRequestCount: 0,
        pool: expect.objectContaining({
          state: 'disposed',
          canvasCount: 2,
          activeLeaseCount: 0,
          acquireCount: 1,
          releaseCount: 1,
        }),
      })
    )
    expect(controllerRef.current?.startFrameLoop(jest.fn())).toBe(
      'compositor-disposed'
    )
  })
})

function createRafFixture() {
  const callbacks: Array<{
    id: number
    callback: FrameRequestCallback
  }> = []
  let nextId = 1
  const requestFrame = jest.fn((callback: FrameRequestCallback) => {
    const id = nextId
    nextId += 1
    callbacks.push({ id, callback })
    return id
  })
  const cancelFrame = jest.fn((requestId: number) => {
    const index = callbacks.findIndex(({ id }) => id === requestId)
    if (index >= 0) callbacks.splice(index, 1)
  })
  return { callbacks, requestFrame, cancelFrame }
}
