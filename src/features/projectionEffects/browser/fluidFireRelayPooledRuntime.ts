import {
  resetAvatarLightingContribution,
  publishAvatarLightingContribution,
  type AvatarLightingContribution,
} from '../avatarLighting'
import { fluidFireRelayDefinition } from '../plugins/fluidFireRelay/definition'
import {
  FluidFireRelayRenderer,
  type FluidFireRelayFrameObserver,
  type FluidFireRelayRendererSnapshot,
} from '../plugins/fluidFireRelay/renderer'
import { ProjectionEffectRegistry } from '../registry'
import type {
  ProjectionEffectFrameContext,
  ProjectionEffectRenderResult,
  ProjectionEffectSession,
} from '../rendererPlugin'
import type { FluidFireRelayParameters } from '../settings'
import type {
  ProjectionEffectCompositorController,
  ProjectionEffectCompositorOperationStatus,
} from './projectionEffectCompositor'
import type {
  ProjectionEffectSurfaceDrawTarget,
  ProjectionEffectSurfaceLease,
} from './projectionEffectSurfacePool'

const EFFECT_ID = fluidFireRelayDefinition.id
const MAX_FRAME_DELTA_MS = 100
const MAX_LEDGER_COUNT = 1_000_000

export type FluidFireRelayPooledRuntimeState =
  | 'idle'
  | 'starting'
  | 'running'
  | 'terminating'
  | 'quarantined'
  | 'disposed'

export type FluidFireRelayPooledRuntimeStatus =
  | 'completed'
  | 'already-running'
  | 'already-stopped'
  | 'surface-busy'
  | 'surface-unavailable'
  | 'start-failed'
  | 'cleanup-unproved'
  | 'runtime-quarantined'
  | 'runtime-disposed'

export interface FluidFireRelayPooledRuntimeSnapshot {
  state: FluidFireRelayPooledRuntimeState
  generation: number
  activeSessionCount: 0 | 1
  activeLeaseCount: 0 | 1
  frameCount: number
  staleFrameRejectionCount: number
  cleanupUnproved: boolean
}

export interface FluidFireRelayPooledRuntimeOptions {
  compositor: ProjectionEffectCompositorController
  getParameters(): FluidFireRelayParameters
  drawFrame(
    target: Readonly<ProjectionEffectSurfaceDrawTarget<'canvas2d'>>,
    snapshot: Readonly<FluidFireRelayRendererSnapshot>,
    frameContext: ProjectionEffectFrameContext
  ): Readonly<AvatarLightingContribution>
  onStatusChange?(status: string): void
  createSession?(observer: FluidFireRelayFrameObserver): ProjectionEffectSession
}

export function createFluidFireRelayPooledRuntime(
  options: FluidFireRelayPooledRuntimeOptions
): FluidFireRelayPooledRuntime {
  return new FluidFireRelayPooledRuntime(options)
}

export class FluidFireRelayPooledRuntime {
  private stateValue: FluidFireRelayPooledRuntimeState = 'idle'
  private generationValue = 0
  private frameCountValue = 0
  private staleFrameRejectionCountValue = 0
  private cleanupUnprovedValue = false
  private previousFrameMs: number | null = null
  private acceptingFrames = false
  private frameLoopOwned = false
  private frameFailurePending = false
  private session: ProjectionEffectSession | null = null
  private lease: ProjectionEffectSurfaceLease<'canvas2d'> | null = null
  private terminationPromise: Promise<FluidFireRelayPooledRuntimeStatus> | null =
    null

  constructor(private readonly options: FluidFireRelayPooledRuntimeOptions) {}

  async start(): Promise<FluidFireRelayPooledRuntimeStatus> {
    if (this.stateValue === 'disposed') return 'runtime-disposed'
    if (this.cleanupUnprovedValue || this.stateValue === 'quarantined') {
      return 'runtime-quarantined'
    }
    if (
      this.stateValue === 'starting' ||
      this.stateValue === 'running' ||
      this.stateValue === 'terminating'
    ) {
      return 'already-running'
    }

    this.stateValue = 'starting'
    this.generationValue = incrementBounded(this.generationValue)
    const generation = this.generationValue
    const acquired = this.options.compositor.acquireSurface({
      backend: 'canvas2d',
      effectId: EFFECT_ID,
      sessionId: `fluid.relay.${generation}`,
    })
    if (acquired.status !== 'completed' || !acquired.lease) {
      if (
        acquired.status === 'cleanup-unproved' ||
        acquired.status === 'compositor-quarantined'
      ) {
        this.latchCleanupUnproved()
        return 'runtime-quarantined'
      }
      this.stateValue = 'idle'
      return acquired.status === 'busy' ? 'surface-busy' : 'surface-unavailable'
    }
    this.lease = acquired.lease

    try {
      this.session = (
        this.options.createSession ?? createFluidFireRelaySession
      )((snapshot, frameContext) => {
        this.drawObservedFrame(generation, snapshot, frameContext)
      })
    } catch {
      return this.cleanupAfterStartFailure()
    }

    let started: ProjectionEffectRenderResult
    try {
      started = await this.session.start()
    } catch {
      return this.cleanupAfterStartFailure()
    }
    if (started.status !== 'started' || generation !== this.generationValue) {
      return this.cleanupAfterStartFailure()
    }

    this.previousFrameMs = null
    this.acceptingFrames = true
    this.stateValue = 'running'
    const loopStatus = this.options.compositor.startFrameLoop(
      async ({ nowMs }) => {
        await this.renderFrame(generation, nowMs)
      }
    )
    if (loopStatus !== 'completed') {
      return this.cleanupAfterStartFailure(loopStatus)
    }
    this.frameLoopOwned = true
    this.publishStatus(started.status)
    return 'completed'
  }

  stop(): Promise<FluidFireRelayPooledRuntimeStatus> {
    return this.terminateActive(false)
  }

  reset(): Promise<FluidFireRelayPooledRuntimeStatus> {
    return this.terminateActive(false)
  }

  dispose(): Promise<FluidFireRelayPooledRuntimeStatus> {
    return this.terminateActive(true)
  }

  snapshot(): Readonly<FluidFireRelayPooledRuntimeSnapshot> {
    return Object.freeze({
      state: this.stateValue,
      generation: this.generationValue,
      activeSessionCount: this.session ? 1 : 0,
      activeLeaseCount: this.lease ? 1 : 0,
      frameCount: this.frameCountValue,
      staleFrameRejectionCount: this.staleFrameRejectionCountValue,
      cleanupUnproved: this.cleanupUnprovedValue,
    })
  }

  private async renderFrame(generation: number, nowMs: number): Promise<void> {
    const session = this.session
    if (
      !session ||
      !this.acceptingFrames ||
      this.stateValue !== 'running' ||
      generation !== this.generationValue
    ) {
      this.staleFrameRejectionCountValue = incrementBounded(
        this.staleFrameRejectionCountValue
      )
      return
    }
    const deltaMs = Math.min(
      MAX_FRAME_DELTA_MS,
      Math.max(
        0,
        this.previousFrameMs === null ? 16 : nowMs - this.previousFrameMs
      )
    )
    this.previousFrameMs = nowMs
    let result: ProjectionEffectRenderResult
    try {
      result = await session.update({
        nowMs,
        deltaMs,
        parameters: this.options.getParameters(),
      })
    } catch {
      await this.terminateFrameFailure(generation)
      return
    }
    if (this.frameFailurePending || result.status !== 'rendered') {
      await this.terminateFrameFailure(generation)
      return
    }
    if (
      generation !== this.generationValue ||
      !this.acceptingFrames ||
      this.stateValue !== 'running'
    ) {
      this.staleFrameRejectionCountValue = incrementBounded(
        this.staleFrameRejectionCountValue
      )
      return
    }
    this.publishStatus(result.status)
  }

  private drawObservedFrame(
    generation: number,
    snapshot: Readonly<FluidFireRelayRendererSnapshot>,
    frameContext: ProjectionEffectFrameContext
  ): void {
    const lease = this.lease
    if (
      !lease ||
      !this.acceptingFrames ||
      this.stateValue !== 'running' ||
      generation !== this.generationValue
    ) {
      this.staleFrameRejectionCountValue = incrementBounded(
        this.staleFrameRejectionCountValue
      )
      return
    }
    const drawn = lease.draw((target) => {
      const lighting = this.options.drawFrame(target, snapshot, frameContext)
      publishAvatarLightingContribution(lighting)
    })
    if (drawn.status !== 'completed') {
      this.frameFailurePending = true
      this.acceptingFrames = false
      resetAvatarLightingContribution()
      throw new Error('fluid relay pooled draw failed')
    }
    this.frameCountValue = incrementBounded(this.frameCountValue)
  }

  private terminateActive(
    disposeRuntime: boolean,
    forceCleanupUnproved = false
  ): Promise<FluidFireRelayPooledRuntimeStatus> {
    if (this.terminationPromise) return this.terminationPromise
    if (!this.session && !this.lease) {
      resetAvatarLightingContribution()
      if (disposeRuntime) this.stateValue = 'disposed'
      return Promise.resolve(
        this.cleanupUnprovedValue ? 'runtime-quarantined' : 'already-stopped'
      )
    }

    this.acceptingFrames = false
    this.generationValue = incrementBounded(this.generationValue)
    this.stateValue = 'terminating'
    const loopStatus = this.frameLoopOwned
      ? this.options.compositor.stopFrameLoop()
      : 'already-stopped'
    this.frameLoopOwned = false
    resetAvatarLightingContribution()
    const session = this.session
    const lease = this.lease

    this.terminationPromise = (async () => {
      let cleanupProved =
        !forceCleanupUnproved && compositorStopCompleted(loopStatus)
      if (session) {
        try {
          const terminated = await session.terminate()
          cleanupProved =
            cleanupProved &&
            (terminated.status === 'disposed' ||
              terminated.status === 'ignored-disposed')
        } catch {
          cleanupProved = false
        }
      }

      if (lease) {
        if (cleanupProved) {
          const cleared = lease.clear()
          cleanupProved =
            cleared.status === 'completed' || cleared.status === 'already-clear'
        }
        const finished = lease.finish(
          cleanupProved ? 'cleanup-proved' : 'cleanup-unproved'
        )
        cleanupProved = cleanupProved && finished.status === 'completed'
      }

      this.session = null
      this.previousFrameMs = null
      this.frameFailurePending = false
      if (!cleanupProved) {
        this.latchCleanupUnproved()
        return 'cleanup-unproved'
      }
      this.lease = null
      this.stateValue = disposeRuntime ? 'disposed' : 'idle'
      this.publishStatus(disposeRuntime ? 'disposed' : 'stopped')
      return 'completed'
    })().finally(() => {
      this.terminationPromise = null
    })
    return this.terminationPromise
  }

  private async cleanupAfterStartFailure(
    loopStatus?: ProjectionEffectCompositorOperationStatus
  ): Promise<FluidFireRelayPooledRuntimeStatus> {
    const cleanup = await this.terminateActive(
      false,
      loopStatus === 'browser-boundary-failed' ||
        loopStatus === 'compositor-quarantined' ||
        loopStatus === 'cleanup-unproved'
    )
    if (cleanup === 'cleanup-unproved' || cleanup === 'runtime-quarantined') {
      return cleanup
    }
    return 'start-failed'
  }

  private async terminateFrameFailure(generation: number): Promise<void> {
    if (
      generation !== this.generationValue &&
      this.terminationPromise === null
    ) {
      this.staleFrameRejectionCountValue = incrementBounded(
        this.staleFrameRejectionCountValue
      )
      return
    }
    this.frameFailurePending = false
    await this.terminateActive(false, true)
  }

  private latchCleanupUnproved(): void {
    this.cleanupUnprovedValue = true
    this.acceptingFrames = false
    this.stateValue = 'quarantined'
    resetAvatarLightingContribution()
  }

  private publishStatus(status: string): void {
    try {
      this.options.onStatusChange?.(status)
    } catch {
      // Status publication is observational and never receives cleanup authority.
    }
  }
}

function createFluidFireRelaySession(
  observer: FluidFireRelayFrameObserver
): ProjectionEffectSession {
  const registry = new ProjectionEffectRegistry()
  registry.register({
    definition: fluidFireRelayDefinition,
    createRenderer: () => new FluidFireRelayRenderer(observer),
  })
  return registry.createSession(EFFECT_ID)
}

function compositorStopCompleted(
  status: ProjectionEffectCompositorOperationStatus
): boolean {
  return status === 'completed' || status === 'already-stopped'
}

function incrementBounded(value: number): number {
  return Math.min(MAX_LEDGER_COUNT, value + 1)
}
