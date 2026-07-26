import type {
  ProjectionEffectFrameContext,
  ProjectionEffectRenderer,
  ProjectionEffectRendererPlugin,
  ProjectionEffectStopContext,
} from '../../../rendererPlugin'
import { fireEffectDefinition } from '../definition'
import {
  FIRE_P027_DEFAULT_CONTROLS,
  FIRE_P027_FIXED_DT_SECONDS,
  FIRE_P027_SOURCE_ORACLE_PROFILE,
  FIRE_P027_SOURCE_POST_OFF_FRAME,
  type FireP027Controls,
  type FireP027Surface,
  type FireP027SurfaceAudit,
} from './contracts'
import { FireP027Scheduler, type FireP027SchedulerSnapshot } from './scheduler'
import { generateFireP027FallbackOrigins } from './webglEngine'

export interface FireP027RendererSnapshot {
  controls: Readonly<FireP027Controls>
  disposed: boolean
  frameCount: number
  lastStopMode: ProjectionEffectStopContext['mode'] | null
  scheduler: Readonly<FireP027SchedulerSnapshot>
  surface: Readonly<FireP027SurfaceAudit> | null
}

export interface FireP027RendererOptions {
  surface: FireP027Surface
  waitFrame?: (durationMs: number, signal?: AbortSignal) => Promise<void>
  onFrame?: (snapshot: Readonly<FireP027RendererSnapshot>) => void
}

export interface FireP027PluginOptions {
  createSurface(): FireP027Surface
  waitFrame?: FireP027RendererOptions['waitFrame']
  onFrame?: FireP027RendererOptions['onFrame']
}

const MAX_DRAIN_STEPS = 300
const MAX_DRAIN_PRESENTATIONS = 6
const DRAIN_WAIT_GRACE_MS = 50

export class FireP027Renderer implements ProjectionEffectRenderer {
  private readonly surface: FireP027Surface
  private readonly scheduler = new FireP027Scheduler()
  private readonly waitFrame: NonNullable<FireP027RendererOptions['waitFrame']>
  private readonly onFrame?: FireP027RendererOptions['onFrame']
  private controls: FireP027Controls = { ...FIRE_P027_DEFAULT_CONTROLS }
  private originSignature: string | null = null
  private disposed = false
  private frameCount = 0
  private lastStopMode: ProjectionEffectStopContext['mode'] | null = null

  constructor(options: FireP027RendererOptions) {
    this.surface = options.surface
    this.waitFrame = options.waitFrame ?? waitForTimer
    this.onFrame = options.onFrame
  }

  render(context: ProjectionEffectFrameContext): void {
    if (this.disposed || context.signal?.aborted) return
    this.controls = mapFireParametersToP027Controls(context.parameters)
    this.syncFallbackOrigins()
    const steps = this.scheduler.consumeWallTime(context.deltaMs / 1000)
    for (let index = 0; index < steps; index += 1) {
      const batch = this.scheduler.nextBatch(this.controls.birthPerSecond, 1)
      this.surface.step(batch, 1, this.controls)
    }
    this.surface.draw(this.controls)
    this.frameCount += 1
    this.onFrame?.(this.snapshot())
  }

  async stop(context: ProjectionEffectStopContext): Promise<void> {
    if (this.disposed) return
    this.lastStopMode = context.mode
    this.scheduler.stop()

    if (context.mode === 'immediate' || context.fadeMs === 0) {
      this.surface.clear()
      this.onFrame?.(this.snapshot())
      return
    }

    let failure: unknown = null
    try {
      const drainSteps = Math.min(
        MAX_DRAIN_STEPS,
        Math.max(
          FIRE_P027_SOURCE_POST_OFF_FRAME + 1,
          Math.ceil(
            (this.controls.lifeSeconds + this.controls.lifeVarianceSeconds) /
              FIRE_P027_FIXED_DT_SECONDS
          ) + 1
        )
      )
      const presentationStride = Math.max(
        1,
        Math.ceil(drainSteps / MAX_DRAIN_PRESENTATIONS)
      )
      const presentationCount = Math.max(
        1,
        Math.ceil(drainSteps / presentationStride)
      )

      for (let step = 0; step < drainSteps; step += 1) {
        if (this.disposed || context.signal?.aborted) break
        const batch = this.scheduler.nextBatch(0, 0)
        this.surface.step(batch, 0, this.controls)
        if ((step + 1) % presentationStride === 0 || step + 1 === drainSteps) {
          this.surface.draw(this.controls)
          await waitForBoundedFrame(
            this.waitFrame,
            context.fadeMs / presentationCount,
            context.signal
          )
        }
      }
    } catch (error) {
      failure = error
    }

    try {
      if (!this.disposed) this.surface.clear()
    } catch (error) {
      failure ??= error
    }
    this.onFrame?.(this.snapshot())
    if (failure !== null) throw failure
  }

  reset(): void {
    if (this.disposed) return
    this.scheduler.reset()
    this.surface.reset()
    this.originSignature = null
    this.frameCount = 0
    this.lastStopMode = null
    this.onFrame?.(this.snapshot())
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.scheduler.stop()
    this.surface.dispose()
    this.onFrame?.(this.snapshot())
  }

  snapshot(): Readonly<FireP027RendererSnapshot> {
    return Object.freeze({
      controls: Object.freeze({ ...this.controls }),
      disposed: this.disposed,
      frameCount: this.frameCount,
      lastStopMode: this.lastStopMode,
      scheduler: this.scheduler.snapshot(),
      surface: this.surface.audit?.() ?? null,
    })
  }

  private syncFallbackOrigins(): void {
    const signature = [
      this.controls.originSeed,
      this.controls.originRadiusX,
      this.controls.originRadiusY,
      this.controls.originRadiusZ,
      this.controls.originCenterX,
      this.controls.originCenterY,
      this.controls.originCenterZ,
    ].join(':')
    if (signature === this.originSignature) return
    this.surface.setOrigins(generateFireP027FallbackOrigins(this.controls))
    this.originSignature = signature
  }
}

export function createFireP027Plugin(
  options: FireP027PluginOptions
): ProjectionEffectRendererPlugin {
  return {
    definition: fireEffectDefinition,
    createRenderer: () =>
      new FireP027Renderer({
        surface: options.createSurface(),
        waitFrame: options.waitFrame,
        onFrame: options.onFrame,
      }),
  }
}

export function mapFireParametersToP027Controls(
  parameters: Readonly<Record<string, unknown>>
): FireP027Controls {
  const temperature = clamp(
    numberParameter(parameters, 'temperature', 0.78),
    0,
    1
  )
  const masterIntensity = clamp(
    numberParameter(parameters, 'masterIntensity', 0.92),
    0,
    1
  )
  const bloomGain = clamp(numberParameter(parameters, 'bloomGain', 0.64), 0, 2)
  const postProcessing = parameters.postProcessing !== false
  const active = masterIntensity > 0
  const normalizedStrength = active
    ? clamp((masterIntensity - 0.35) / 0.65, 0, 1)
    : 0
  const emissionGain = clamp(
    active
      ? (0.58 + normalizedStrength * 0.62) *
          (postProcessing ? 1 + bloomGain * 0.14 : 1)
      : 0,
    0,
    2
  )
  const coverageGain = clamp(
    active
      ? 0.72 +
          normalizedStrength * 0.22 +
          (postProcessing ? bloomGain * 0.01 : 0)
      : 0,
    0,
    1
  )
  const seed = integerParameter(parameters, 'seed', 0, 0, 2_147_483_647)
  const originSeed = seed === 0 ? 0 : deriveP027Seed(seed, 0x6d2b79f5)
  const particleSeed = seed === 0 ? 1 : deriveP027Seed(seed, 0x1b873593)

  return {
    birthPerSecond: active ? FIRE_P027_SOURCE_ORACLE_PROFILE.birthPerSecond : 0,
    lifeSeconds: FIRE_P027_SOURCE_ORACLE_PROFILE.lifeSeconds,
    spriteWidthCssPx: FIRE_P027_DEFAULT_CONTROLS.spriteWidthCssPx,
    spriteHeightCssPx: FIRE_P027_DEFAULT_CONTROLS.spriteHeightCssPx,
    spriteWidthOrtho: FIRE_P027_SOURCE_ORACLE_PROFILE.spriteWidthOrtho,
    spriteHeightOrtho: FIRE_P027_SOURCE_ORACLE_PROFILE.spriteHeightOrtho,
    resolutionScale: clamp(
      numberParameter(parameters, 'internalResolutionScale', 0.75),
      0.25,
      1
    ),
    inputLagSeconds: FIRE_P027_SOURCE_ORACLE_PROFILE.sizeLagSeconds,
    originSeed,
    originRadiusX: FIRE_P027_DEFAULT_CONTROLS.originRadiusX,
    originRadiusY: FIRE_P027_DEFAULT_CONTROLS.originRadiusY,
    originRadiusZ: FIRE_P027_DEFAULT_CONTROLS.originRadiusZ,
    originCenterX:
      clamp(numberParameter(parameters, 'emitterX', 0), -1, 1) * 0.5,
    originCenterY:
      clamp(numberParameter(parameters, 'emitterY', -0.82), -1, 1) * 0.28,
    originCenterZ: 0,
    forceX: 0,
    forceY: 4,
    forceZ: 0,
    windX: 0,
    windY: 3,
    windZ: 0,
    turbulenceX: 6,
    turbulenceY: 6,
    turbulenceZ: 6,
    turbulencePeriod: 0.01,
    particleSeed,
    lifeVarianceSeconds: 0,
    jitterBirths: false,
    useMass: false,
    mass: 1,
    useDrag: false,
    drag: 1,
    alphaSpeed: 0,
    tintR: emissionGain * (0.96 + temperature * 0.12),
    tintG: emissionGain * (0.62 + temperature * 0.35),
    tintB: emissionGain * (0.08 + temperature * 0.18),
    tintA: coverageGain,
  }
}

function numberParameter(
  parameters: Readonly<Record<string, unknown>>,
  id: string,
  fallback: number
): number {
  const value = parameters[id]
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function integerParameter(
  parameters: Readonly<Record<string, unknown>>,
  id: string,
  fallback: number,
  minimum: number,
  maximum: number
): number {
  return Math.round(
    clamp(numberParameter(parameters, id, fallback), minimum, maximum)
  )
}

function deriveP027Seed(seed: number, salt: number): number {
  let mixed = Math.imul(seed ^ salt, 0x85ebca6b)
  mixed = Math.imul(mixed ^ (mixed >>> 13), 0xc2b2ae35)
  return ((mixed ^ (mixed >>> 16)) >>> 0) % 10001
}

function waitForTimer(durationMs: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', finish)
      resolve()
    }
    const timer = setTimeout(finish, Math.max(0, durationMs))
    if (signal?.aborted) finish()
    else signal?.addEventListener('abort', finish, { once: true })
  })
}

function waitForBoundedFrame(
  waitFrame: NonNullable<FireP027RendererOptions['waitFrame']>,
  durationMs: number,
  signal?: AbortSignal
): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (error?: unknown) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      signal?.removeEventListener('abort', abort)
      if (error === undefined) resolve()
      else reject(error)
    }
    const abort = () => finish()
    const timeout = setTimeout(
      () => finish(),
      Math.max(1, durationMs + DRAIN_WAIT_GRACE_MS)
    )
    if (signal?.aborted) {
      finish()
      return
    }
    signal?.addEventListener('abort', abort, { once: true })
    Promise.resolve()
      .then(() => waitFrame(durationMs, signal))
      .then(
        () => finish(),
        (error) => finish(error)
      )
  })
}

function clamp(value: number, minimum: number, maximum: number): number {
  const finite = Number.isFinite(value) ? value : minimum
  return Math.min(maximum, Math.max(minimum, finite))
}
