export type ProjectionEffectSurfaceBackend = 'webgl2' | 'canvas2d'

export type ProjectionEffectSurfacePoolState =
  | 'ready'
  | 'leased'
  | 'cleanup-unproved'
  | 'disposed'

export type ProjectionEffectSurfaceOperationStatus =
  | 'completed'
  | 'already-clear'
  | 'busy'
  | 'cleanup-unproved'
  | 'invalid-request'
  | 'pool-disposed'
  | 'stale-lease-rejected'
  | 'surface-unavailable'
  | 'operation-failed'

export interface ProjectionEffectSurfaceOperationResult {
  status: ProjectionEffectSurfaceOperationStatus
}

export interface ProjectionEffectSurfaceRequest<
  Backend extends ProjectionEffectSurfaceBackend =
    ProjectionEffectSurfaceBackend,
> {
  backend: Backend
  effectId: string
  sessionId: string
}

export interface ProjectionEffectSurfaceContextMap {
  webgl2: WebGL2RenderingContext
  canvas2d: CanvasRenderingContext2D
}

export interface ProjectionEffectSurfaceDrawTarget<
  Backend extends ProjectionEffectSurfaceBackend,
> {
  canvas: HTMLCanvasElement
  context: ProjectionEffectSurfaceContextMap[Backend]
}

export interface ProjectionEffectSurfaceLease<
  Backend extends ProjectionEffectSurfaceBackend =
    ProjectionEffectSurfaceBackend,
> {
  readonly backend: Backend
  readonly effectId: string
  readonly sessionId: string
  readonly generation: number
  draw(
    operation: (
      target: Readonly<ProjectionEffectSurfaceDrawTarget<Backend>>
    ) => void
  ): ProjectionEffectSurfaceOperationResult
  clear(): ProjectionEffectSurfaceOperationResult
  finish(
    outcome: 'cleanup-proved' | 'cleanup-unproved'
  ): ProjectionEffectSurfaceOperationResult
}

export interface ProjectionEffectSurfaceAcquireResult<
  Backend extends ProjectionEffectSurfaceBackend,
> {
  status: ProjectionEffectSurfaceOperationStatus
  lease: ProjectionEffectSurfaceLease<Backend> | null
}

export interface ProjectionEffectSurfacePoolSnapshot {
  state: ProjectionEffectSurfacePoolState
  canvasCount: 2
  activeLeaseCount: 0 | 1
  activeBackend: ProjectionEffectSurfaceBackend | null
  activeOwnerPresent: boolean
  activeSessionPresent: boolean
  activeGeneration: number | null
  generation: number
  acquireCount: number
  releaseCount: number
  drawCount: number
  clearCount: number
  staleRejectionCount: number
  busyRejectionCount: number
  unavailableCount: number
  cleanupAttemptCount: number
  cleanupUnprovedCount: number
  disposeCount: number
}

export interface ProjectionEffectSurfacePoolOptions {
  webgl2Canvas: HTMLCanvasElement
  canvas2dCanvas: HTMLCanvasElement
}

interface ActiveSurfaceLease<
  Backend extends ProjectionEffectSurfaceBackend =
    ProjectionEffectSurfaceBackend,
> {
  token: symbol
  backend: Backend
  effectId: string
  sessionId: string
  generation: number
  canvas: HTMLCanvasElement
  context: ProjectionEffectSurfaceContextMap[Backend]
  dirty: boolean
}

const MAX_LEDGER_COUNT = 1_000_000
const MAX_CLEANUP_ATTEMPTS_PER_LEASE = 2
const MAX_OWNER_ID_LENGTH = 128
const OWNER_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/

export class ProjectionEffectSurfacePool {
  private readonly webgl2Canvas: HTMLCanvasElement
  private readonly canvas2dCanvas: HTMLCanvasElement
  private webgl2Context: WebGL2RenderingContext | null = null
  private canvas2dContext: CanvasRenderingContext2D | null = null
  private stateValue: ProjectionEffectSurfacePoolState = 'ready'
  private active: ActiveSurfaceLease | null = null
  private generationValue = 0
  private acquireCountValue = 0
  private releaseCountValue = 0
  private drawCountValue = 0
  private clearCountValue = 0
  private staleRejectionCountValue = 0
  private busyRejectionCountValue = 0
  private unavailableCountValue = 0
  private cleanupAttemptCountValue = 0
  private cleanupAttemptsForActiveLease = 0
  private cleanupUnprovedCountValue = 0
  private disposeCountValue = 0

  constructor(options: ProjectionEffectSurfacePoolOptions) {
    if (options.webgl2Canvas === options.canvas2dCanvas) {
      throw new Error('projection effect surfaces require distinct canvases')
    }
    this.webgl2Canvas = options.webgl2Canvas
    this.canvas2dCanvas = options.canvas2dCanvas
  }

  acquire<Backend extends ProjectionEffectSurfaceBackend>(
    request: ProjectionEffectSurfaceRequest<Backend>
  ): ProjectionEffectSurfaceAcquireResult<Backend> {
    if (!isValidRequest(request)) {
      return { status: 'invalid-request', lease: null }
    }
    if (this.stateValue === 'disposed') {
      return { status: 'pool-disposed', lease: null }
    }
    if (this.stateValue === 'cleanup-unproved') {
      return { status: 'cleanup-unproved', lease: null }
    }
    if (this.active) {
      this.busyRejectionCountValue = incrementBounded(
        this.busyRejectionCountValue
      )
      return { status: 'busy', lease: null }
    }

    const target = this.resolveTarget(request.backend)
    if (!target) {
      this.unavailableCountValue = incrementBounded(this.unavailableCountValue)
      return { status: 'surface-unavailable', lease: null }
    }

    this.generationValue = incrementBounded(this.generationValue)
    const active: ActiveSurfaceLease<Backend> = {
      token: Symbol('projection-effect-surface-lease'),
      backend: request.backend,
      effectId: request.effectId,
      sessionId: request.sessionId,
      generation: this.generationValue,
      canvas: target.canvas,
      context: target.context,
      dirty: false,
    }
    this.active = active
    this.stateValue = 'leased'
    this.cleanupAttemptsForActiveLease = 0
    this.acquireCountValue = incrementBounded(this.acquireCountValue)

    return {
      status: 'completed',
      lease: this.createLease(active),
    }
  }

  dispose(): ProjectionEffectSurfaceOperationResult {
    this.disposeCountValue = incrementBounded(this.disposeCountValue)
    if (this.stateValue === 'disposed') return { status: 'completed' }
    if (this.stateValue === 'cleanup-unproved') {
      return { status: 'cleanup-unproved' }
    }

    if (this.active) {
      const cleanup = this.cleanupActive(this.active)
      if (cleanup.status !== 'completed') return cleanup
      this.releaseActive(this.active)
    }
    this.stateValue = 'disposed'
    return { status: 'completed' }
  }

  snapshot(): ProjectionEffectSurfacePoolSnapshot {
    return Object.freeze({
      state: this.stateValue,
      canvasCount: 2,
      activeLeaseCount: this.active ? 1 : 0,
      activeBackend: this.active?.backend ?? null,
      activeOwnerPresent: Boolean(this.active),
      activeSessionPresent: Boolean(this.active),
      activeGeneration: this.active?.generation ?? null,
      generation: this.generationValue,
      acquireCount: this.acquireCountValue,
      releaseCount: this.releaseCountValue,
      drawCount: this.drawCountValue,
      clearCount: this.clearCountValue,
      staleRejectionCount: this.staleRejectionCountValue,
      busyRejectionCount: this.busyRejectionCountValue,
      unavailableCount: this.unavailableCountValue,
      cleanupAttemptCount: this.cleanupAttemptCountValue,
      cleanupUnprovedCount: this.cleanupUnprovedCountValue,
      disposeCount: this.disposeCountValue,
    })
  }

  private createLease<Backend extends ProjectionEffectSurfaceBackend>(
    active: ActiveSurfaceLease<Backend>
  ): ProjectionEffectSurfaceLease<Backend> {
    return Object.freeze({
      backend: active.backend,
      effectId: active.effectId,
      sessionId: active.sessionId,
      generation: active.generation,
      draw: (operation) => this.draw(active, operation),
      clear: () => this.clear(active),
      finish: (outcome) => this.finish(active, outcome),
    })
  }

  private draw<Backend extends ProjectionEffectSurfaceBackend>(
    active: ActiveSurfaceLease<Backend>,
    operation: (
      target: Readonly<ProjectionEffectSurfaceDrawTarget<Backend>>
    ) => void
  ): ProjectionEffectSurfaceOperationResult {
    const current = this.currentLeaseStatus(active)
    if (current) return current
    active.dirty = true
    try {
      operation({ canvas: active.canvas, context: active.context })
      this.drawCountValue = incrementBounded(this.drawCountValue)
      return { status: 'completed' }
    } catch {
      return { status: 'operation-failed' }
    }
  }

  private clear(
    active: ActiveSurfaceLease
  ): ProjectionEffectSurfaceOperationResult {
    const current = this.currentLeaseStatus(active)
    if (current) return current
    if (!active.dirty) return { status: 'already-clear' }
    return this.clearActive(active)
  }

  private finish(
    active: ActiveSurfaceLease,
    outcome: 'cleanup-proved' | 'cleanup-unproved'
  ): ProjectionEffectSurfaceOperationResult {
    const current = this.currentLeaseStatus(active)
    if (current) return current
    if (outcome === 'cleanup-unproved') {
      this.markCleanupUnproved(false)
      return { status: 'cleanup-unproved' }
    }

    const cleanup = this.cleanupActive(active)
    if (cleanup.status !== 'completed') return cleanup
    this.releaseActive(active)
    return { status: 'completed' }
  }

  private cleanupActive(
    active: ActiveSurfaceLease
  ): ProjectionEffectSurfaceOperationResult {
    if (this.cleanupAttemptsForActiveLease >= MAX_CLEANUP_ATTEMPTS_PER_LEASE) {
      this.stateValue = 'cleanup-unproved'
      return { status: 'cleanup-unproved' }
    }
    this.cleanupAttemptsForActiveLease += 1
    this.cleanupAttemptCountValue = incrementBounded(
      this.cleanupAttemptCountValue
    )
    if (!active.dirty) return { status: 'completed' }
    return this.clearActive(active, true)
  }

  private clearActive(
    active: ActiveSurfaceLease,
    cleanupAttemptAlreadyCounted = false
  ): ProjectionEffectSurfaceOperationResult {
    try {
      if (active.backend === 'webgl2') {
        const context = active.context as WebGL2RenderingContext
        context.clearColor(0, 0, 0, 0)
        context.clear(context.COLOR_BUFFER_BIT)
      } else {
        const context = active.context as CanvasRenderingContext2D
        context.setTransform(1, 0, 0, 1, 0, 0)
        context.clearRect(0, 0, active.canvas.width, active.canvas.height)
      }
      active.dirty = false
      this.clearCountValue = incrementBounded(this.clearCountValue)
      return { status: 'completed' }
    } catch {
      this.markCleanupUnproved(cleanupAttemptAlreadyCounted)
      return { status: 'cleanup-unproved' }
    }
  }

  private releaseActive(active: ActiveSurfaceLease): void {
    if (this.active?.token !== active.token) return
    this.active = null
    this.cleanupAttemptsForActiveLease = 0
    this.releaseCountValue = incrementBounded(this.releaseCountValue)
    this.stateValue = 'ready'
  }

  private markCleanupUnproved(cleanupAttemptAlreadyCounted: boolean): void {
    if (!cleanupAttemptAlreadyCounted) {
      this.cleanupAttemptsForActiveLease = Math.min(
        MAX_CLEANUP_ATTEMPTS_PER_LEASE,
        this.cleanupAttemptsForActiveLease + 1
      )
      this.cleanupAttemptCountValue = incrementBounded(
        this.cleanupAttemptCountValue
      )
    }
    this.cleanupUnprovedCountValue = incrementBounded(
      this.cleanupUnprovedCountValue
    )
    this.stateValue = 'cleanup-unproved'
  }

  private currentLeaseStatus(
    active: ActiveSurfaceLease
  ): ProjectionEffectSurfaceOperationResult | null {
    if (this.active?.token !== active.token) {
      this.staleRejectionCountValue = incrementBounded(
        this.staleRejectionCountValue
      )
      return { status: 'stale-lease-rejected' }
    }
    if (this.stateValue === 'cleanup-unproved') {
      return { status: 'cleanup-unproved' }
    }
    if (this.stateValue !== 'leased') {
      this.staleRejectionCountValue = incrementBounded(
        this.staleRejectionCountValue
      )
      return { status: 'stale-lease-rejected' }
    }
    return null
  }

  private resolveTarget<Backend extends ProjectionEffectSurfaceBackend>(
    backend: Backend
  ): ProjectionEffectSurfaceDrawTarget<Backend> | null {
    try {
      if (backend === 'webgl2') {
        const context =
          this.webgl2Context ??
          this.webgl2Canvas.getContext('webgl2', {
            alpha: true,
            antialias: false,
            premultipliedAlpha: false,
          })
        if (!context) return null
        this.webgl2Context = context
        return {
          canvas: this.webgl2Canvas,
          context,
        } as ProjectionEffectSurfaceDrawTarget<Backend>
      }

      const context =
        this.canvas2dContext ?? this.canvas2dCanvas.getContext('2d')
      if (!context) return null
      this.canvas2dContext = context
      return {
        canvas: this.canvas2dCanvas,
        context,
      } as ProjectionEffectSurfaceDrawTarget<Backend>
    } catch {
      return null
    }
  }
}

function isValidRequest(
  request: unknown
): request is ProjectionEffectSurfaceRequest {
  if (typeof request !== 'object' || request === null) return false
  const candidate = request as Partial<ProjectionEffectSurfaceRequest>
  return (
    isProjectionEffectSurfaceBackend(candidate.backend) &&
    isValidOwnerId(candidate.effectId) &&
    isValidOwnerId(candidate.sessionId)
  )
}

function isProjectionEffectSurfaceBackend(
  value: unknown
): value is ProjectionEffectSurfaceBackend {
  return value === 'webgl2' || value === 'canvas2d'
}

function isValidOwnerId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_OWNER_ID_LENGTH &&
    OWNER_ID_PATTERN.test(value)
  )
}

function incrementBounded(value: number): number {
  return Math.min(MAX_LEDGER_COUNT, value + 1)
}
