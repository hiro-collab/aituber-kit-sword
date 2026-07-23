import {
  FireThunderPooledSurfaceError,
  FireThunderPooledSurfaces,
} from '../browser/fireThunderPooledSurfaces'
import type {
  ProjectionEffectCompositorController,
  ProjectionEffectCompositorSnapshot,
} from '../browser/projectionEffectCompositor'
import {
  ProjectionEffectSurfacePool,
  type ProjectionEffectSurfacePoolSnapshot,
} from '../browser/projectionEffectSurfacePool'
import {
  FIRE_P027_DEFAULT_CONTROLS,
  type FireP027SpawnBatch,
  type FireP027Surface,
} from '../plugins/fire/p027/contracts'
import {
  fixedThunderWebGl2AdapterResult,
  mapThunderParametersToWebGl2AdapterConfig,
  type ThunderWebGl2AdapterSurface,
} from '../plugins/thunderBall/webgl2/adapter'

describe('FireThunderPooledSurfaces', () => {
  it('acquires lazily, releases Fire before Thunder, and rejects stale generations', () => {
    const fixture = createFixture()
    const pooled = new FireThunderPooledSurfaces({
      compositor: fixture.controller,
      createFireSurface: fixture.createFireSurface,
      createThunderSurface: fixture.createThunderSurface,
    })
    const firstFire = pooled.createFireSurface()
    const thunder = pooled.createThunderSurface()

    expect(fixture.pool.snapshot()).toEqual(
      expect.objectContaining({ generation: 0, activeLeaseCount: 0 })
    )
    exerciseFire(firstFire)
    expect(fixture.pool.snapshot()).toEqual(
      expect.objectContaining({
        generation: 1,
        activeBackend: 'webgl2',
        activeLeaseCount: 1,
      })
    )
    firstFire.clear()
    firstFire.dispose()

    exerciseThunder(thunder)
    expect(fixture.acquireSnapshots[1]).toEqual(
      expect.objectContaining({
        activeLeaseCount: 0,
        releaseCount: 1,
      })
    )
    expect(fixture.pool.snapshot()).toEqual(
      expect.objectContaining({
        generation: 2,
        activeBackend: 'webgl2',
        activeLeaseCount: 1,
      })
    )
    thunder.dispose()

    const secondFire = pooled.createFireSurface()
    exerciseFire(secondFire)
    expect(fixture.pool.snapshot()).toEqual(
      expect.objectContaining({
        generation: 3,
        activeBackend: 'webgl2',
        activeLeaseCount: 1,
        releaseCount: 2,
      })
    )
    expect(() => exerciseFire(firstFire)).toThrow(FireThunderPooledSurfaceError)
    expect(pooled.snapshot()).toEqual(
      expect.objectContaining({
        generation: 3,
        activeSurfaceCount: 1,
        cleanupUnproved: false,
        staleOperationCount: 1,
      })
    )
    secondFire.dispose()
    expect(fixture.pool.snapshot()).toEqual(
      expect.objectContaining({
        activeLeaseCount: 0,
        releaseCount: 3,
        staleRejectionCount: 1,
      })
    )
  })

  it('quarantines cleanup uncertainty without release or backend reuse', () => {
    const fixture = createFixture({ fireDisposeThrows: true })
    const pooled = new FireThunderPooledSurfaces({
      compositor: fixture.controller,
      createFireSurface: fixture.createFireSurface,
      createThunderSurface: fixture.createThunderSurface,
    })
    const fire = pooled.createFireSurface()
    exerciseFire(fire)

    expect(() => fire.dispose()).toThrow(FireThunderPooledSurfaceError)
    expect(pooled.snapshot()).toEqual(
      expect.objectContaining({
        activeSurfaceCount: 1,
        cleanupUnproved: true,
      })
    )
    expect(fixture.pool.snapshot()).toEqual(
      expect.objectContaining({
        state: 'cleanup-unproved',
        activeBackend: 'webgl2',
        activeLeaseCount: 1,
        releaseCount: 0,
      })
    )

    const thunder = pooled.createThunderSurface()
    expect(() => exerciseThunder(thunder)).toThrow(
      FireThunderPooledSurfaceError
    )
    expect(fixture.acquireSnapshots).toHaveLength(1)
    expect(pooled.disposeActive()).toBe('cleanup-unproved')
    expect(fixture.pool.snapshot()).toEqual(
      expect.objectContaining({
        state: 'cleanup-unproved',
        activeLeaseCount: 1,
        releaseCount: 0,
      })
    )
  })

  it('keeps a failed Thunder cleanup lease quarantined and blocks Fire reacquire', () => {
    const fixture = createFixture({ thunderDisposeThrows: true })
    const pooled = new FireThunderPooledSurfaces({
      compositor: fixture.controller,
      createFireSurface: fixture.createFireSurface,
      createThunderSurface: fixture.createThunderSurface,
    })
    const thunder = pooled.createThunderSurface()
    exerciseThunder(thunder)

    expect(() => thunder.dispose()).toThrow(FireThunderPooledSurfaceError)
    expect(pooled.snapshot()).toEqual(
      expect.objectContaining({
        activeSurfaceCount: 1,
        cleanupUnproved: true,
      })
    )
    expect(fixture.pool.snapshot()).toEqual(
      expect.objectContaining({
        activeBackend: 'webgl2',
        activeLeaseCount: 1,
        releaseCount: 0,
        state: 'cleanup-unproved',
      })
    )

    const fire = pooled.createFireSurface()
    expect(() => exerciseFire(fire)).toThrow(FireThunderPooledSurfaceError)
    expect(fixture.acquireSnapshots).toHaveLength(1)
  })
})

function createFixture(
  options: {
    fireDisposeThrows?: boolean
    thunderDisposeThrows?: boolean
  } = {}
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
    value: jest.fn((kind: string) =>
      kind === 'webgl2' ? webgl2Context : null
    ),
  })
  Object.defineProperty(canvas2dCanvas, 'getContext', {
    value: jest.fn((kind: string) => (kind === '2d' ? canvas2dContext : null)),
  })

  const pool = new ProjectionEffectSurfacePool({
    webgl2Canvas,
    canvas2dCanvas,
  })
  const acquireSnapshots: ProjectionEffectSurfacePoolSnapshot[] = []
  const controller: ProjectionEffectCompositorController = {
    acquireSurface(request) {
      acquireSnapshots.push(pool.snapshot())
      return pool.acquire(request)
    },
    startFrameLoop: () => 'completed',
    stopFrameLoop: () => 'completed',
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
  const fireSurfaces: FireP027Surface[] = []
  const thunderSurfaces: ThunderWebGl2AdapterSurface[] = []
  const createFireSurface = jest.fn(() => {
    const surface = {
      step: jest.fn(),
      draw: jest.fn(),
      setOrigins: jest.fn(),
      reset: jest.fn(),
      clear: jest.fn(),
      dispose: jest.fn(() => {
        if (options.fireDisposeThrows) {
          throw new Error('private fire disposal failure')
        }
      }),
    } satisfies FireP027Surface
    fireSurfaces.push(surface)
    return surface
  })
  const createThunderSurface = jest.fn(() => {
    const surface = {
      configure: jest.fn(),
      start: jest.fn(() =>
        fixedThunderWebGl2AdapterResult('running', 'started')
      ),
      renderFrame: jest.fn(() =>
        fixedThunderWebGl2AdapterResult('running', 'rendered')
      ),
      stop: jest.fn(() =>
        fixedThunderWebGl2AdapterResult('stopped', 'stopped')
      ),
      reset: jest.fn(() => fixedThunderWebGl2AdapterResult('idle', 'reset')),
      emergencyStop: jest.fn(() =>
        fixedThunderWebGl2AdapterResult('stopped', 'emergency-stopped')
      ),
      dispose: jest.fn(() => {
        if (options.thunderDisposeThrows) {
          throw new Error('private thunder disposal failure')
        }
      }),
    } satisfies ThunderWebGl2AdapterSurface
    thunderSurfaces.push(surface)
    return surface
  })

  return {
    acquireSnapshots,
    controller,
    createFireSurface,
    createThunderSurface,
    fireSurfaces,
    pool,
    thunderSurfaces,
  }
}

const FIRE_BATCH: Readonly<FireP027SpawnBatch> = Object.freeze({
  start: 0,
  count: 1,
  generationBase: 1,
  logicalUpdate: 1,
  dtSeconds: 1 / 60,
})

function exerciseFire(surface: FireP027Surface): void {
  surface.step(FIRE_BATCH, 1, FIRE_P027_DEFAULT_CONTROLS)
  surface.draw(FIRE_P027_DEFAULT_CONTROLS)
}

function exerciseThunder(surface: ThunderWebGl2AdapterSurface): void {
  surface.configure(mapThunderParametersToWebGl2AdapterConfig({}))
  surface.start({ nowMs: 0 })
  surface.renderFrame({ nowMs: 0 })
}
