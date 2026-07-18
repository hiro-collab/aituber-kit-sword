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
import type {
  FireParticleDrawConfig,
  FireParticleSurface,
} from '../plugins/fire/renderer'
import type {
  ThunderBallFrame,
  ThunderBallSurface,
} from '../plugins/thunderBall/renderer'

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
    firstFire.draw([], {} as FireParticleDrawConfig)
    expect(fixture.pool.snapshot()).toEqual(
      expect.objectContaining({
        generation: 1,
        activeBackend: 'webgl2',
        activeLeaseCount: 1,
      })
    )
    firstFire.clear()
    firstFire.dispose()

    thunder.draw({} as ThunderBallFrame)
    expect(fixture.acquireSnapshots[1]).toEqual(
      expect.objectContaining({
        activeLeaseCount: 0,
        releaseCount: 1,
      })
    )
    expect(fixture.pool.snapshot()).toEqual(
      expect.objectContaining({
        generation: 2,
        activeBackend: 'canvas2d',
        activeLeaseCount: 1,
      })
    )
    thunder.dispose()

    const secondFire = pooled.createFireSurface()
    secondFire.draw([], {} as FireParticleDrawConfig)
    expect(fixture.pool.snapshot()).toEqual(
      expect.objectContaining({
        generation: 3,
        activeBackend: 'webgl2',
        activeLeaseCount: 1,
        releaseCount: 2,
      })
    )
    expect(() => firstFire.draw([], {} as FireParticleDrawConfig)).toThrow(
      FireThunderPooledSurfaceError
    )
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
    fire.draw([], {} as FireParticleDrawConfig)

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
    expect(() => thunder.draw({} as ThunderBallFrame)).toThrow(
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
})

function createFixture(options: { fireDisposeThrows?: boolean } = {}) {
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
  const fireSurfaces: FireParticleSurface[] = []
  const thunderSurfaces: ThunderBallSurface[] = []
  const createFireSurface = jest.fn(() => {
    const surface = {
      draw: jest.fn(),
      clear: jest.fn(),
      dispose: jest.fn(() => {
        if (options.fireDisposeThrows) {
          throw new Error('private fire disposal failure')
        }
      }),
    } satisfies FireParticleSurface
    fireSurfaces.push(surface)
    return surface
  })
  const createThunderSurface = jest.fn(() => {
    const surface = {
      draw: jest.fn(),
      clear: jest.fn(),
      dispose: jest.fn(),
    } satisfies ThunderBallSurface
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
