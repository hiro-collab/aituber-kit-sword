import type {
  ProjectionEffectCompositorController,
  ProjectionEffectCompositorOperationStatus,
} from './projectionEffectCompositor'
import type {
  ProjectionEffectSurfaceBackend,
  ProjectionEffectSurfaceLease,
} from './projectionEffectSurfacePool'
import { FIRE_EFFECT_ID } from '../plugins/fire/definition'
import type {
  FireParticle,
  FireParticleDrawConfig,
  FireParticleSurface,
} from '../plugins/fire/renderer'
import { THUNDER_BALL_EFFECT_ID } from '../plugins/thunderBall/definition'
import type {
  ThunderBallFrame,
  ThunderBallSurface,
} from '../plugins/thunderBall/renderer'

export type FireThunderPooledSurfaceStatus = 'completed' | 'cleanup-unproved'

export interface FireThunderPooledSurfacesSnapshot {
  generation: number
  activeSurfaceCount: 0 | 1
  cleanupUnproved: boolean
  staleOperationCount: number
}

export interface FireThunderPooledSurfacesOptions {
  compositor: ProjectionEffectCompositorController
  createFireSurface(canvas: HTMLCanvasElement): FireParticleSurface
  createThunderSurface(canvas: HTMLCanvasElement): ThunderBallSurface
}

interface OwnedPooledSurface<
  Backend extends ProjectionEffectSurfaceBackend,
  Surface,
> {
  generation: number
  lease: ProjectionEffectSurfaceLease<Backend>
  surface: Surface
}

const MAX_LEDGER_COUNT = 1_000_000

export class FireThunderPooledSurfaceError extends Error {
  readonly code = 'fire-thunder-pooled-surface-failed'

  constructor() {
    super('fire and thunder pooled surface operation failed')
    this.name = 'FireThunderPooledSurfaceError'
  }
}

export class FireThunderPooledSurfaces {
  private generationValue = 0
  private activeSurface: PooledSurfaceSession<
    ProjectionEffectSurfaceBackend,
    unknown
  > | null = null
  private cleanupUnprovedValue = false
  private staleOperationCountValue = 0

  constructor(private readonly options: FireThunderPooledSurfacesOptions) {}

  createFireSurface(): FireParticleSurface {
    return new PooledFireSurface(this, this.options.createFireSurface)
  }

  createThunderSurface(): ThunderBallSurface {
    return new PooledThunderSurface(this, this.options.createThunderSurface)
  }

  disposeActive(): FireThunderPooledSurfaceStatus {
    if (!this.activeSurface) {
      return this.cleanupUnprovedValue ? 'cleanup-unproved' : 'completed'
    }
    try {
      this.activeSurface.dispose()
    } catch {
      this.cleanupUnprovedValue = true
      return 'cleanup-unproved'
    }
    return this.cleanupUnprovedValue ? 'cleanup-unproved' : 'completed'
  }

  snapshot(): Readonly<FireThunderPooledSurfacesSnapshot> {
    return Object.freeze({
      generation: this.generationValue,
      activeSurfaceCount: this.activeSurface ? 1 : 0,
      cleanupUnproved: this.cleanupUnprovedValue,
      staleOperationCount: this.staleOperationCountValue,
    })
  }

  acquire<Backend extends ProjectionEffectSurfaceBackend, Surface>(
    owner: PooledSurfaceSession<Backend, Surface>,
    backend: Backend,
    effectId: typeof FIRE_EFFECT_ID | typeof THUNDER_BALL_EFFECT_ID,
    createSurface: (canvas: HTMLCanvasElement) => Surface
  ): OwnedPooledSurface<Backend, Surface> {
    if (this.cleanupUnprovedValue || this.activeSurface) {
      throw new FireThunderPooledSurfaceError()
    }
    this.generationValue = incrementBounded(this.generationValue)
    const generation = this.generationValue
    const acquired = this.options.compositor.acquireSurface({
      backend,
      effectId,
      sessionId: `lab.surface.${generation}`,
    })
    if (acquired.status !== 'completed' || !acquired.lease) {
      throw new FireThunderPooledSurfaceError()
    }

    let surface: Surface | null = null
    const initialized = acquired.lease.draw(({ canvas }) => {
      surface = createSurface(canvas)
    })
    if (initialized.status !== 'completed' || surface === null) {
      acquired.lease.finish('cleanup-unproved')
      this.cleanupUnprovedValue = true
      throw new FireThunderPooledSurfaceError()
    }
    this.activeSurface = owner as PooledSurfaceSession<
      ProjectionEffectSurfaceBackend,
      unknown
    >
    return {
      generation,
      lease: acquired.lease,
      surface,
    }
  }

  complete(
    owner: PooledSurfaceSession<ProjectionEffectSurfaceBackend, unknown>,
    generation: number
  ): void {
    if (this.activeSurface === owner && this.generationValue === generation) {
      this.activeSurface = null
    }
  }

  markCleanupUnproved(): void {
    this.cleanupUnprovedValue = true
  }

  markStaleOperation(): void {
    this.staleOperationCountValue = incrementBounded(
      this.staleOperationCountValue
    )
  }
}

abstract class PooledSurfaceSession<
  Backend extends ProjectionEffectSurfaceBackend,
  Surface,
> {
  private owned: OwnedPooledSurface<Backend, Surface> | null = null
  private disposed = false

  constructor(
    private readonly surfaces: FireThunderPooledSurfaces,
    private readonly backend: Backend,
    private readonly effectId:
      | typeof FIRE_EFFECT_ID
      | typeof THUNDER_BALL_EFFECT_ID,
    private readonly createSurface: (canvas: HTMLCanvasElement) => Surface
  ) {}

  protected drawWithSurface(operation: (surface: Surface) => void): void {
    if (this.disposed) {
      this.rejectDisposedOperation()
    }
    const owned = this.ensureOwned()
    const result = owned.lease.draw(() => operation(owned.surface))
    if (result.status === 'completed') return
    this.failOwnedOperation(owned, result.status)
  }

  clear(): void {
    if (!this.owned) {
      if (this.disposed) throw new FireThunderPooledSurfaceError()
      return
    }
    const result = this.owned.lease.clear()
    if (result.status === 'completed' || result.status === 'already-clear') {
      return
    }
    this.failOwnedOperation(this.owned, result.status)
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    const owned = this.owned
    if (!owned) return

    const disposed = owned.lease.draw(() => {
      const surface = owned.surface as { dispose(): void }
      surface.dispose()
    })
    if (disposed.status !== 'completed') {
      owned.lease.finish('cleanup-unproved')
      this.surfaces.markCleanupUnproved()
      throw new FireThunderPooledSurfaceError()
    }
    const finished = owned.lease.finish('cleanup-proved')
    if (finished.status !== 'completed') {
      this.surfaces.markCleanupUnproved()
      throw new FireThunderPooledSurfaceError()
    }
    this.surfaces.complete(
      this as PooledSurfaceSession<ProjectionEffectSurfaceBackend, unknown>,
      owned.generation
    )
  }

  private ensureOwned(): OwnedPooledSurface<Backend, Surface> {
    if (this.owned) return this.owned
    this.owned = this.surfaces.acquire(
      this,
      this.backend,
      this.effectId,
      this.createSurface
    )
    return this.owned
  }

  private rejectDisposedOperation(): never {
    if (this.owned) {
      const stale = this.owned.lease.draw(() => {})
      if (stale.status === 'stale-lease-rejected') {
        this.surfaces.markStaleOperation()
      }
    }
    throw new FireThunderPooledSurfaceError()
  }

  private failOwnedOperation(
    owned: OwnedPooledSurface<Backend, Surface>,
    status: string
  ): never {
    if (status === 'stale-lease-rejected') {
      this.surfaces.markStaleOperation()
    } else {
      owned.lease.finish('cleanup-unproved')
      this.surfaces.markCleanupUnproved()
    }
    throw new FireThunderPooledSurfaceError()
  }
}

class PooledFireSurface
  extends PooledSurfaceSession<'webgl2', FireParticleSurface>
  implements FireParticleSurface
{
  constructor(
    surfaces: FireThunderPooledSurfaces,
    createSurface: (canvas: HTMLCanvasElement) => FireParticleSurface
  ) {
    super(surfaces, 'webgl2', FIRE_EFFECT_ID, createSurface)
  }

  draw(
    particles: readonly Readonly<FireParticle>[],
    config: Readonly<FireParticleDrawConfig>
  ): void {
    this.drawWithSurface((surface) => surface.draw(particles, config))
  }
}

class PooledThunderSurface
  extends PooledSurfaceSession<'canvas2d', ThunderBallSurface>
  implements ThunderBallSurface
{
  constructor(
    surfaces: FireThunderPooledSurfaces,
    createSurface: (canvas: HTMLCanvasElement) => ThunderBallSurface
  ) {
    super(surfaces, 'canvas2d', THUNDER_BALL_EFFECT_ID, createSurface)
  }

  draw(frame: Readonly<ThunderBallFrame>): void {
    this.drawWithSurface((surface) => surface.draw(frame))
  }
}

export function compositorOperationCompleted(
  status: ProjectionEffectCompositorOperationStatus
): boolean {
  return status === 'completed' || status === 'already-running'
}

function incrementBounded(value: number): number {
  return Math.min(MAX_LEDGER_COUNT, value + 1)
}
