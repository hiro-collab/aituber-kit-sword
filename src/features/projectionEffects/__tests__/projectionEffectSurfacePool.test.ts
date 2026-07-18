import {
  ProjectionEffectSurfacePool,
  type ProjectionEffectSurfaceBackend,
} from '../browser/projectionEffectSurfacePool'

describe('ProjectionEffectSurfacePool', () => {
  it('requires two distinct caller-owned canvases', () => {
    const canvas = document.createElement('canvas')
    expect(
      () =>
        new ProjectionEffectSurfacePool({
          webgl2Canvas: canvas,
          canvas2dCanvas: canvas,
        })
    ).toThrow('projection effect surfaces require distinct canvases')
  })

  it('keeps one active lease and rejects stale draw and release operations', () => {
    const fixture = createPoolFixture()
    const first = fixture.pool.acquire({
      backend: 'webgl2',
      effectId: 'fire',
      sessionId: 'fire.session.1',
    })
    expect(first.status).toBe('completed')
    expect(first.lease).not.toBeNull()
    expect(
      fixture.pool.acquire({
        backend: 'canvas2d',
        effectId: 'thunderBall',
        sessionId: 'thunder.session.1',
      })
    ).toEqual({ status: 'busy', lease: null })

    const draw = jest.fn()
    expect(first.lease?.draw(draw)).toEqual({ status: 'completed' })
    expect(draw).toHaveBeenCalledWith(
      expect.objectContaining({
        canvas: fixture.webgl2Canvas,
        context: fixture.webgl2Context,
      })
    )
    expect(first.lease?.finish('cleanup-proved')).toEqual({
      status: 'completed',
    })

    const second = fixture.pool.acquire({
      backend: 'canvas2d',
      effectId: 'thunderBall',
      sessionId: 'thunder.session.2',
    })
    expect(second.status).toBe('completed')
    expect(second.lease?.generation).toBeGreaterThan(
      first.lease?.generation ?? 0
    )
    expect(first.lease?.draw(jest.fn())).toEqual({
      status: 'stale-lease-rejected',
    })
    expect(first.lease?.finish('cleanup-proved')).toEqual({
      status: 'stale-lease-rejected',
    })

    expect(fixture.pool.snapshot()).toEqual(
      expect.objectContaining({
        state: 'leased',
        canvasCount: 2,
        activeLeaseCount: 1,
        activeBackend: 'canvas2d',
        activeOwnerPresent: true,
        activeSessionPresent: true,
        acquireCount: 2,
        releaseCount: 1,
        busyRejectionCount: 1,
        staleRejectionCount: 2,
      })
    )
  })

  it('clears idempotently and records a balanced cleanup ledger', () => {
    const fixture = createPoolFixture()
    const acquired = fixture.pool.acquire({
      backend: 'canvas2d',
      effectId: 'fluidFireRelay',
      sessionId: 'relay.session.1',
    })

    expect(acquired.lease?.clear()).toEqual({ status: 'already-clear' })
    expect(acquired.lease?.draw(() => {})).toEqual({ status: 'completed' })
    expect(acquired.lease?.clear()).toEqual({ status: 'completed' })
    expect(acquired.lease?.clear()).toEqual({ status: 'already-clear' })
    expect(acquired.lease?.finish('cleanup-proved')).toEqual({
      status: 'completed',
    })
    expect(fixture.canvas2dContext.clearRect).toHaveBeenCalledTimes(1)
    expect(fixture.pool.snapshot()).toEqual(
      expect.objectContaining({
        state: 'ready',
        activeLeaseCount: 0,
        acquireCount: 1,
        releaseCount: 1,
        drawCount: 1,
        clearCount: 1,
        cleanupAttemptCount: 1,
      })
    )
  })

  it('quarantines an unproved cleanup and never reuses that lease', () => {
    const fixture = createPoolFixture()
    const acquired = fixture.pool.acquire({
      backend: 'webgl2',
      effectId: 'fire',
      sessionId: 'fire.session.failure',
    })
    acquired.lease?.draw(() => {})
    expect(acquired.lease?.finish('cleanup-unproved')).toEqual({
      status: 'cleanup-unproved',
    })
    expect(acquired.lease?.draw(jest.fn())).toEqual({
      status: 'cleanup-unproved',
    })
    expect(
      fixture.pool.acquire({
        backend: 'canvas2d',
        effectId: 'thunderBall',
        sessionId: 'thunder.after.failure',
      })
    ).toEqual({ status: 'cleanup-unproved', lease: null })

    expect(fixture.pool.dispose()).toEqual({
      status: 'cleanup-unproved',
    })
    expect(fixture.pool.dispose()).toEqual({
      status: 'cleanup-unproved',
    })
    expect(fixture.webgl2Context.clear).not.toHaveBeenCalled()
    expect(fixture.pool.snapshot()).toEqual(
      expect.objectContaining({
        state: 'cleanup-unproved',
        activeLeaseCount: 1,
        cleanupAttemptCount: 1,
        cleanupUnprovedCount: 1,
        releaseCount: 0,
      })
    )
  })

  it('rejects runtime-invalid backends before every pool or browser side effect', () => {
    const fixture = createPoolFixture()
    const invalidBackends = ['', 'webgl', 'WEBGL2', 2, null, {}]

    for (const backend of invalidBackends) {
      expect(
        fixture.pool.acquire({
          backend,
          effectId: 'fire',
          sessionId: 'fire.session.invalid-backend',
        } as never)
      ).toEqual({ status: 'invalid-request', lease: null })
    }
    expect(
      fixture.pool.acquire({
        backend: 'canvas2d',
        effectId: 'private value',
        sessionId: 'valid.session',
      })
    ).toEqual({ status: 'invalid-request', lease: null })
    expect(
      fixture.pool.acquire({
        backend: 'canvas2d',
        effectId: 'fire',
        sessionId: '',
      })
    ).toEqual({ status: 'invalid-request', lease: null })

    expect(fixture.webgl2Canvas.getContext).not.toHaveBeenCalled()
    expect(fixture.canvas2dCanvas.getContext).not.toHaveBeenCalled()
    expect(fixture.pool.snapshot()).toEqual({
      state: 'ready',
      canvasCount: 2,
      activeLeaseCount: 0,
      activeBackend: null,
      activeOwnerPresent: false,
      activeSessionPresent: false,
      activeGeneration: null,
      generation: 0,
      acquireCount: 0,
      releaseCount: 0,
      drawCount: 0,
      clearCount: 0,
      staleRejectionCount: 0,
      busyRejectionCount: 0,
      unavailableCount: 0,
      cleanupAttemptCount: 0,
      cleanupUnprovedCount: 0,
      disposeCount: 0,
    })
  })

  it('fails closed when contexts are unavailable or throw', () => {
    const unavailable = createPoolFixture({ webgl2Available: false })
    expect(
      unavailable.pool.acquire({
        backend: 'webgl2',
        effectId: 'fire',
        sessionId: 'fire.session.1',
      })
    ).toEqual({ status: 'surface-unavailable', lease: null })
    expect(unavailable.pool.snapshot()).toEqual(
      expect.objectContaining({
        activeLeaseCount: 0,
        generation: 0,
        acquireCount: 0,
        unavailableCount: 1,
      })
    )

    const throwing = createPoolFixture({ webgl2Throws: true })
    expect(
      throwing.pool.acquire({
        backend: 'webgl2',
        effectId: 'fire',
        sessionId: 'fire.session.context-throw',
      })
    ).toEqual({ status: 'surface-unavailable', lease: null })
    expect(throwing.pool.snapshot()).toEqual(
      expect.objectContaining({
        activeLeaseCount: 0,
        generation: 0,
        acquireCount: 0,
        unavailableCount: 1,
      })
    )
    expect(JSON.stringify(throwing.pool.snapshot())).not.toContain(
      'private browser error'
    )
  })

  it('does not expose caller owner or session identifiers in snapshots', () => {
    const fixture = createPoolFixture()
    const privateEffectId = 'private.owner.identifier'
    const privateSessionId = 'private.session.identifier'

    expect(
      fixture.pool.acquire({
        backend: 'canvas2d',
        effectId: privateEffectId,
        sessionId: privateSessionId,
      }).status
    ).toBe('completed')

    const snapshot = fixture.pool.snapshot()
    expect(snapshot).toEqual(
      expect.objectContaining({
        state: 'leased',
        activeOwnerPresent: true,
        activeSessionPresent: true,
      })
    )
    const serialized = JSON.stringify(snapshot)
    expect(serialized).not.toContain(privateEffectId)
    expect(serialized).not.toContain(privateSessionId)
  })

  it('reuses the same two canvases through one hundred backend handoffs', () => {
    const fixture = createPoolFixture()
    const canvases = new Set<HTMLCanvasElement>()

    for (let index = 0; index < 100; index += 1) {
      const backend: ProjectionEffectSurfaceBackend =
        index % 2 === 0 ? 'webgl2' : 'canvas2d'
      const acquired = fixture.pool.acquire({
        backend,
        effectId: backend === 'webgl2' ? 'fire' : 'thunderBall',
        sessionId: `session.${index}`,
      })
      expect(acquired.status).toBe('completed')
      expect(
        acquired.lease?.draw(({ canvas }) => {
          canvases.add(canvas)
        })
      ).toEqual({ status: 'completed' })
      expect(acquired.lease?.finish('cleanup-proved')).toEqual({
        status: 'completed',
      })
    }

    expect(canvases).toEqual(
      new Set([fixture.webgl2Canvas, fixture.canvas2dCanvas])
    )
    expect(fixture.pool.snapshot()).toEqual(
      expect.objectContaining({
        state: 'ready',
        canvasCount: 2,
        activeLeaseCount: 0,
        generation: 100,
        acquireCount: 100,
        releaseCount: 100,
      })
    )
    expect(fixture.pool.dispose()).toEqual({ status: 'completed' })
    expect(fixture.pool.dispose()).toEqual({ status: 'completed' })
    expect(
      fixture.pool.acquire({
        backend: 'webgl2',
        effectId: 'fire',
        sessionId: 'after.dispose',
      })
    ).toEqual({ status: 'pool-disposed', lease: null })
  })
})

function createPoolFixture(
  options: { webgl2Available?: boolean; webgl2Throws?: boolean } = {}
) {
  const webgl2Canvas = document.createElement('canvas')
  const canvas2dCanvas = document.createElement('canvas')
  const webgl2Context = {
    COLOR_BUFFER_BIT: 0x4000,
    clearColor: jest.fn(),
    clear: jest.fn(),
  }
  const canvas2dContext = {
    setTransform: jest.fn(),
    clearRect: jest.fn(),
  }

  Object.defineProperty(webgl2Canvas, 'getContext', {
    value: jest.fn((kind: string) => {
      if (options.webgl2Throws) throw new Error('private browser error')
      return kind === 'webgl2' && options.webgl2Available !== false
        ? webgl2Context
        : null
    }),
  })
  Object.defineProperty(canvas2dCanvas, 'getContext', {
    value: jest.fn((kind: string) => (kind === '2d' ? canvas2dContext : null)),
  })

  return {
    webgl2Canvas,
    canvas2dCanvas,
    webgl2Context,
    canvas2dContext,
    pool: new ProjectionEffectSurfacePool({
      webgl2Canvas,
      canvas2dCanvas,
    }),
  }
}
