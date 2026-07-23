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
  FireP027Controls,
  FireP027OriginPoint,
  FireP027SpawnBatch,
  FireP027Surface,
  FireP027SurfaceAudit,
} from '../plugins/fire/p027/contracts'
import { THUNDER_BALL_EFFECT_ID } from '../plugins/thunderBall/definition'
import type {
  ThunderWebGl2AdapterConfig,
  ThunderWebGl2AdapterSurface,
} from '../plugins/thunderBall/webgl2/adapter'
import type {
  ThunderWebGl2FrameOptions,
  ThunderWebGl2StartOptions,
  ThunderWebGl2StopOptions,
} from '../plugins/thunderBall/webgl2/renderer'

export type FireThunderPooledSurfaceStatus = 'completed' | 'cleanup-unproved'

export interface FireThunderPooledSurfacesSnapshot {
  generation: number
  activeSurfaceCount: 0 | 1
  cleanupUnproved: boolean
  staleOperationCount: number
}

export interface FireThunderPooledSurfacesOptions {
  compositor: ProjectionEffectCompositorController
  createFireSurface(canvas: HTMLCanvasElement): FireP027Surface
  createThunderSurface(canvas: HTMLCanvasElement): ThunderWebGl2AdapterSurface
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

  createFireSurface(): FireP027Surface {
    return new PooledP027FireSurface(this, this.options.createFireSurface)
  }

  createThunderSurface(): ThunderWebGl2AdapterSurface {
    return new PooledThunderWebGl2Surface(
      this,
      this.options.createThunderSurface
    )
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

  quarantineActive(): FireThunderPooledSurfaceStatus {
    this.cleanupUnprovedValue = true
    this.activeSurface?.quarantine()
    return 'cleanup-unproved'
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
  private quarantined = false
  private cleanupComplete = false

  constructor(
    private readonly surfaces: FireThunderPooledSurfaces,
    private readonly backend: Backend,
    private readonly effectId:
      | typeof FIRE_EFFECT_ID
      | typeof THUNDER_BALL_EFFECT_ID,
    private readonly createSurface: (canvas: HTMLCanvasElement) => Surface
  ) {}

  protected drawWithSurface(operation: (surface: Surface) => void): void {
    this.readWithSurface(operation)
  }

  protected readWithSurface<Result>(
    operation: (surface: Surface) => Result
  ): Result {
    if (this.quarantined) this.rejectDisposedOperation()
    const owned = this.ensureOwned()
    let value: Result | undefined
    const result = owned.lease.draw(() => {
      value = operation(owned.surface)
    })
    if (result.status === 'completed') return value as Result
    this.failOwnedOperation(owned, result.status)
  }

  clear(): void {
    if (!this.owned) {
      if (this.quarantined) throw new FireThunderPooledSurfaceError()
      return
    }
    const result = this.owned.lease.clear()
    if (result.status === 'completed' || result.status === 'already-clear') {
      return
    }
    this.failOwnedOperation(this.owned, result.status)
  }

  dispose(): void {
    if (this.cleanupComplete) return
    this.quarantined = true
    const owned = this.owned
    if (!owned) {
      this.cleanupComplete = true
      return
    }

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
    this.cleanupComplete = true
  }

  quarantine(): void {
    if (this.cleanupComplete) return
    this.quarantined = true
    this.surfaces.markCleanupUnproved()
    this.owned?.lease.finish('cleanup-unproved')
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

class PooledP027FireSurface
  extends PooledSurfaceSession<'webgl2', FireP027Surface>
  implements FireP027Surface
{
  constructor(
    surfaces: FireThunderPooledSurfaces,
    createSurface: (canvas: HTMLCanvasElement) => FireP027Surface
  ) {
    super(surfaces, 'webgl2', FIRE_EFFECT_ID, createSurface)
  }

  step(
    batch: Readonly<FireP027SpawnBatch>,
    rawGate: number,
    controls: Readonly<FireP027Controls>
  ): void {
    this.drawWithSurface((surface) => surface.step(batch, rawGate, controls))
  }

  draw(controls: Readonly<FireP027Controls>): void {
    this.drawWithSurface((surface) => surface.draw(controls))
  }

  setOrigins(points: readonly Readonly<FireP027OriginPoint>[]): void {
    this.drawWithSurface((surface) => surface.setOrigins(points))
  }

  reset(): void {
    this.drawWithSurface((surface) => surface.reset())
  }

  override clear(): void {
    this.drawWithSurface((surface) => surface.clear())
  }

  audit(): Readonly<FireP027SurfaceAudit> {
    return this.readWithSurface((surface) => {
      const audit = surface.audit?.()
      if (!audit) throw new FireThunderPooledSurfaceError()
      return audit
    })
  }
}

class PooledThunderWebGl2Surface
  extends PooledSurfaceSession<'webgl2', ThunderWebGl2AdapterSurface>
  implements ThunderWebGl2AdapterSurface
{
  constructor(
    surfaces: FireThunderPooledSurfaces,
    createSurface: (canvas: HTMLCanvasElement) => ThunderWebGl2AdapterSurface
  ) {
    super(surfaces, 'webgl2', THUNDER_BALL_EFFECT_ID, createSurface)
  }

  configure(config: Readonly<ThunderWebGl2AdapterConfig>): void {
    this.drawWithSurface((surface) => surface.configure(config))
  }

  start(options?: Readonly<ThunderWebGl2StartOptions>) {
    return this.readWithSurface((surface) => surface.start(options))
  }

  renderFrame(options: Readonly<ThunderWebGl2FrameOptions>) {
    return this.readWithSurface((surface) => surface.renderFrame(options))
  }

  stop(options?: Readonly<ThunderWebGl2StopOptions>) {
    return this.readWithSurface((surface) => surface.stop(options))
  }

  reset() {
    return this.readWithSurface((surface) => surface.reset())
  }

  emergencyStop() {
    return this.readWithSurface((surface) => surface.emergencyStop())
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
