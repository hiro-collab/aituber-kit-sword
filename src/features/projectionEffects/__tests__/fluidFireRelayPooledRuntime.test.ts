import { getAvatarLightingContribution } from '../avatarLighting'
import {
  FluidFireRelayPooledRuntime,
  type FluidFireRelayPooledRuntimeOptions,
} from '../browser/fluidFireRelayPooledRuntime'
import type {
  ProjectionEffectCompositorController,
  ProjectionEffectCompositorFrameCallback,
  ProjectionEffectCompositorSnapshot,
} from '../browser/projectionEffectCompositor'
import { ProjectionEffectSurfacePool } from '../browser/projectionEffectSurfacePool'
import { fluidFireRelayDefinition } from '../plugins/fluidFireRelay/definition'
import type {
  ProjectionEffectFrameContext,
  ProjectionEffectRenderResult,
  ProjectionEffectSession,
} from '../rendererPlugin'
import { DEFAULT_FLUID_FIRE_RELAY_PARAMETERS } from '../settings'

describe('FluidFireRelayPooledRuntime', () => {
  it('leases the fixed Canvas2D surface lazily and joins cleanup before release', async () => {
    const fixture = createFixture()
    const runtime = createRuntime(fixture)

    expect(fixture.pool.snapshot().activeLeaseCount).toBe(0)
    await expect(runtime.start()).resolves.toBe('completed')
    expect(fixture.pool.snapshot()).toMatchObject({
      canvasCount: 2,
      activeLeaseCount: 1,
      activeBackend: 'canvas2d',
    })
    expect(fixture.callbacks).toHaveLength(1)

    await fixture.callbacks[0]({ nowMs: 16, pool: fixture.pool })
    expect(fixture.drawFrame).toHaveBeenCalledTimes(1)
    expect(getAvatarLightingContribution().status).toBe('active')

    await expect(runtime.stop()).resolves.toBe('completed')
    expect(runtime.snapshot()).toMatchObject({
      state: 'idle',
      activeSessionCount: 0,
      activeLeaseCount: 0,
      cleanupUnproved: false,
    })
    expect(fixture.pool.snapshot()).toMatchObject({
      state: 'ready',
      activeLeaseCount: 0,
      releaseCount: 1,
    })
    expect(getAvatarLightingContribution().status).toBe('neutral')
  })

  it('does not release the lease until the active session termination joins', async () => {
    const termination = deferred<ProjectionEffectRenderResult>()
    const session = createSession({
      terminate: () => termination.promise,
    })
    const fixture = createFixture()
    const runtime = createRuntime(fixture, {
      createSession: () => session,
    })
    await runtime.start()

    const stopping = runtime.stop()
    expect(fixture.pool.snapshot().activeLeaseCount).toBe(1)
    expect(
      fixture.pool.acquire({
        backend: 'webgl2',
        effectId: 'fire',
        sessionId: 'next.fire',
      }).status
    ).toBe('busy')

    termination.resolve(result('disposed'))
    await expect(stopping).resolves.toBe('completed')
    expect(fixture.pool.snapshot().activeLeaseCount).toBe(0)
  })

  it('does not steal an existing lease or stop a frame loop it did not start', async () => {
    const fixture = createFixture()
    const existing = fixture.pool.acquire({
      backend: 'webgl2',
      effectId: 'fire',
      sessionId: 'existing.fire',
    })
    const runtime = createRuntime(fixture)

    await expect(runtime.start()).resolves.toBe('surface-busy')
    expect(fixture.stopFrameLoop).not.toHaveBeenCalled()
    expect(fixture.pool.snapshot()).toMatchObject({
      activeBackend: 'webgl2',
      activeLeaseCount: 1,
    })
    expect(existing.lease?.finish('cleanup-proved').status).toBe('completed')
  })

  it('rejects a stale prior-generation frame after a clean restart', async () => {
    const fixture = createFixture()
    const runtime = createRuntime(fixture)
    await runtime.start()
    const staleCallback = fixture.callbacks[0]
    await runtime.reset()
    await runtime.start()

    await staleCallback({ nowMs: 32, pool: fixture.pool })
    expect(runtime.snapshot().staleFrameRejectionCount).toBe(1)
    expect(fixture.drawFrame).not.toHaveBeenCalled()

    await fixture.callbacks[1]({ nowMs: 48, pool: fixture.pool })
    expect(fixture.drawFrame).toHaveBeenCalledTimes(1)
    await runtime.dispose()
  })

  it('quarantines cleanup uncertainty and rejects every later start', async () => {
    const fixture = createFixture({ clearThrows: true })
    const runtime = createRuntime(fixture)
    await runtime.start()
    await fixture.callbacks[0]({ nowMs: 16, pool: fixture.pool })

    await expect(runtime.stop()).resolves.toBe('cleanup-unproved')
    expect(runtime.snapshot()).toMatchObject({
      state: 'quarantined',
      cleanupUnproved: true,
      activeLeaseCount: 1,
    })
    expect(fixture.pool.snapshot().state).toBe('cleanup-unproved')
    await expect(runtime.start()).resolves.toBe('runtime-quarantined')
    expect(getAvatarLightingContribution().status).toBe('neutral')
  })

  it('fails closed when Canvas2D is unavailable without starting a session or loop', async () => {
    const fixture = createFixture({ contextUnavailable: true })
    const createSession = jest.fn()
    const runtime = createRuntime(fixture, { createSession })

    await expect(runtime.start()).resolves.toBe('surface-unavailable')
    expect(createSession).not.toHaveBeenCalled()
    expect(fixture.startFrameLoop).not.toHaveBeenCalled()
    expect(fixture.pool.snapshot().activeLeaseCount).toBe(0)
  })

  it('releases cleanly without stopping or quarantining an unowned running loop', async () => {
    const fixture = createFixture({ loopStartStatus: 'already-running' })
    const runtime = createRuntime(fixture)

    await expect(runtime.start()).resolves.toBe('start-failed')
    expect(fixture.stopFrameLoop).not.toHaveBeenCalled()
    expect(runtime.snapshot()).toMatchObject({
      state: 'idle',
      cleanupUnproved: false,
      activeLeaseCount: 0,
    })
    expect(fixture.pool.snapshot()).toMatchObject({
      state: 'ready',
      activeLeaseCount: 0,
    })
  })

  it('stops the sole loop and suppresses every late draw before termination', async () => {
    const termination = deferred<ProjectionEffectRenderResult>()
    const observerRef: { current: ((...args: never[]) => void) | null } = {
      current: null,
    }
    const fixture = createFixture()
    const runtime = createRuntime(fixture, {
      createSession: (observer) => {
        observerRef.current = observer as (...args: never[]) => void
        return createSession({ terminate: () => termination.promise })
      },
    })
    await runtime.start()
    const stopping = runtime.dispose()

    expect(fixture.stopFrameLoop).toHaveBeenCalledTimes(1)
    expect(getAvatarLightingContribution().status).toBe('neutral')
    observerRef.current?.(
      {
        disposed: false,
        frameCount: 1,
        densityEnergy: 1,
        temperatureEnergy: 1,
        pressureEnergy: 1,
        completedPassCount: 4,
      } as never,
      {
        nowMs: 16,
        deltaMs: 16,
        parameters: DEFAULT_FLUID_FIRE_RELAY_PARAMETERS,
      } as never
    )
    expect(fixture.drawFrame).not.toHaveBeenCalled()

    termination.resolve(result('disposed'))
    await expect(stopping).resolves.toBe('completed')
    expect(runtime.snapshot().state).toBe('disposed')
  })

  it('serializes a rejecting session update into one quarantined termination', async () => {
    const privateSentinel = 'PRIVATE_UPDATE_FAILURE'
    const terminate = jest.fn(async () => result('disposed'))
    const update = jest.fn(async () => {
      throw new Error(privateSentinel)
    })
    const statuses: string[] = []
    const fixture = createFixture()
    const runtime = createRuntime(fixture, {
      createSession: () => createSession({ update, terminate }),
      onStatusChange: (status) => statuses.push(status),
    })
    await runtime.start()
    const frame = fixture.callbacks[0]

    await expect(
      frame({ nowMs: 16, pool: fixture.pool })
    ).resolves.toBeUndefined()
    expect(fixture.stopFrameLoop).toHaveBeenCalledTimes(1)
    expect(terminate).toHaveBeenCalledTimes(1)
    expect(update).toHaveBeenCalledTimes(1)
    expect(fixture.drawFrame).not.toHaveBeenCalled()
    expect(runtime.snapshot()).toMatchObject({
      state: 'quarantined',
      cleanupUnproved: true,
      activeSessionCount: 0,
      activeLeaseCount: 1,
    })
    expect(getAvatarLightingContribution().status).toBe('neutral')

    await frame({ nowMs: 32, pool: fixture.pool })
    expect(fixture.stopFrameLoop).toHaveBeenCalledTimes(1)
    expect(terminate).toHaveBeenCalledTimes(1)
    expect(update).toHaveBeenCalledTimes(1)
    expect(
      JSON.stringify({ statuses, snapshot: runtime.snapshot() })
    ).not.toContain(privateSentinel)
  })

  it('serializes a throwing pooled draw into one quarantined termination', async () => {
    const privateSentinel = 'PRIVATE_DRAW_FAILURE'
    const terminate = jest.fn(async () => result('disposed'))
    const statuses: string[] = []
    const fixture = createFixture()
    fixture.drawFrame.mockImplementation(() => {
      throw new Error(privateSentinel)
    })
    const runtime = createRuntime(fixture, {
      createSession: (observer) =>
        createSession({
          update: async (context) => {
            try {
              observer(
                {
                  disposed: false,
                  frameCount: 1,
                  densityEnergy: 1,
                  temperatureEnergy: 1,
                  pressureEnergy: 1,
                  completedPassCount: 4,
                },
                context
              )
              return result('rendered')
            } catch {
              return result('render-failed')
            }
          },
          terminate,
        }),
      onStatusChange: (status) => statuses.push(status),
    })
    await runtime.start()
    const frame = fixture.callbacks[0]

    await expect(
      frame({ nowMs: 16, pool: fixture.pool })
    ).resolves.toBeUndefined()
    expect(fixture.stopFrameLoop).toHaveBeenCalledTimes(1)
    expect(terminate).toHaveBeenCalledTimes(1)
    expect(fixture.drawFrame).toHaveBeenCalledTimes(1)
    expect(runtime.snapshot()).toMatchObject({
      state: 'quarantined',
      cleanupUnproved: true,
      activeSessionCount: 0,
      activeLeaseCount: 1,
    })
    expect(getAvatarLightingContribution().status).toBe('neutral')

    await frame({ nowMs: 32, pool: fixture.pool })
    expect(fixture.stopFrameLoop).toHaveBeenCalledTimes(1)
    expect(terminate).toHaveBeenCalledTimes(1)
    expect(fixture.drawFrame).toHaveBeenCalledTimes(1)
    expect(
      JSON.stringify({ statuses, snapshot: runtime.snapshot() })
    ).not.toContain(privateSentinel)
  })

  it('keeps uncertain termination quarantined across later Fluid and cross-effect acquisition', async () => {
    const privateSentinel = 'PRIVATE_TERMINATION_FAILURE'
    const terminate = jest.fn(async () => {
      throw new Error(privateSentinel)
    })
    const statuses: string[] = []
    const fixture = createFixture()
    const runtime = createRuntime(fixture, {
      createSession: () => createSession({ terminate }),
      onStatusChange: (status) => statuses.push(status),
    })
    await runtime.start()

    await expect(runtime.stop()).resolves.toBe('cleanup-unproved')
    expect(terminate).toHaveBeenCalledTimes(1)
    expect(runtime.snapshot()).toMatchObject({
      state: 'quarantined',
      cleanupUnproved: true,
      activeLeaseCount: 1,
    })
    expect(
      fixture.controller.acquireSurface({
        backend: 'webgl2',
        effectId: 'fire',
        sessionId: 'blocked.fire.after.uncertain.cleanup',
      }).status
    ).toBe('cleanup-unproved')

    const laterFluid = createRuntime(fixture)
    await expect(laterFluid.start()).resolves.toBe('runtime-quarantined')
    expect(fixture.startFrameLoop).toHaveBeenCalledTimes(1)
    expect(
      JSON.stringify({ statuses, snapshot: runtime.snapshot() })
    ).not.toContain(privateSentinel)
  })
})

function createRuntime(
  fixture: ReturnType<typeof createFixture>,
  overrides: Partial<FluidFireRelayPooledRuntimeOptions> = {}
): FluidFireRelayPooledRuntime {
  return new FluidFireRelayPooledRuntime({
    compositor: fixture.controller,
    getParameters: () => DEFAULT_FLUID_FIRE_RELAY_PARAMETERS,
    drawFrame: fixture.drawFrame,
    ...overrides,
  })
}

function createFixture(
  options: {
    clearThrows?: boolean
    contextUnavailable?: boolean
    loopStartStatus?: 'completed' | 'already-running'
  } = {}
) {
  const webgl2Canvas = document.createElement('canvas')
  const canvas2dCanvas = document.createElement('canvas')
  const canvas2dContext = {
    setTransform: jest.fn(),
    clearRect: jest.fn(() => {
      if (options.clearThrows) throw new Error('clear failed')
    }),
  } as unknown as CanvasRenderingContext2D
  Object.defineProperty(webgl2Canvas, 'getContext', {
    configurable: true,
    value: jest.fn(() => ({})),
  })
  Object.defineProperty(canvas2dCanvas, 'getContext', {
    configurable: true,
    value: jest.fn(() => (options.contextUnavailable ? null : canvas2dContext)),
  })
  const pool = new ProjectionEffectSurfacePool({
    webgl2Canvas,
    canvas2dCanvas,
  })
  const callbacks: ProjectionEffectCompositorFrameCallback[] = []
  const startFrameLoop = jest.fn(
    (callback: ProjectionEffectCompositorFrameCallback) => {
      callbacks.push(callback)
      return options.loopStartStatus ?? ('completed' as const)
    }
  )
  const stopFrameLoop = jest.fn(() => 'completed' as const)
  const controller: ProjectionEffectCompositorController = {
    acquireSurface: (request) => pool.acquire(request),
    startFrameLoop,
    stopFrameLoop,
    shutdown: () => 'completed',
    snapshot: () =>
      ({
        state: 'idle',
        scheduledFrameCount: 0,
        completedFrameCount: 0,
        staleFrameRejectionCount: 0,
        frameFailureCount: 0,
        browserBoundaryFailureCount: 0,
        activeRequestCount: 0,
        loopGeneration: 0,
        pool: pool.snapshot(),
      }) satisfies ProjectionEffectCompositorSnapshot,
  }
  return {
    pool,
    controller,
    callbacks,
    startFrameLoop,
    stopFrameLoop,
    drawFrame: jest.fn(() => ({
      status: 'active' as const,
      intensityScale: 1.1,
      warmthClass: 'warm' as const,
    })),
  }
}

function createSession(
  overrides: Partial<ProjectionEffectSession> = {}
): ProjectionEffectSession {
  return {
    definition: fluidFireRelayDefinition,
    lifecycle: 'registered',
    start: async () => result('started'),
    update: async (_context: ProjectionEffectFrameContext) =>
      result('rendered'),
    stop: async () => result('stopped'),
    reset: async () => result('reset'),
    dispose: async () => result('disposed'),
    terminate: async () => result('disposed'),
    ...overrides,
  }
}

function result(
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
