import type {
  ProjectionEffectFrameContext,
  ProjectionEffectRenderer,
  ProjectionEffectStopContext,
} from '../../../rendererPlugin'
import { ThunderBallRenderer, type ThunderBallSurface } from '../renderer'
import {
  THUNDER_WEBGL2_MAX_DRAIN_MS,
  THUNDER_WEBGL2_GPU_FAILURE_STAGE_ATTRIBUTE,
  THUNDER_WEBGL2_PASS_GRAPH,
  type ThunderWebGl2EngineFrame,
  type ThunderWebGl2EngineResult,
  type ThunderWebGl2GpuFailureStage,
  ThunderWebGl2RendererResult,
  ThunderWebGl2RendererState,
} from './contracts'
import { ThunderBallWebGl2Engine } from './engine'
import {
  ThunderBallWebGl2Renderer,
  type ThunderWebGl2EngineBoundary,
  ThunderWebGl2FrameOptions,
  ThunderWebGl2StartOptions,
  ThunderWebGl2StopOptions,
} from './renderer'

export interface ThunderWebGl2AdapterConfig {
  bloomGain: number
  centerX: number
  centerY: number
  internalResolutionScale: number
  lineWidth: number
  masterIntensity: number
  orbRadius: number
  postProcessing: boolean
  publicParameters: Readonly<Record<string, unknown>>
  reducedMotion: boolean
  topologySeed: number
  updateRateHz: number
  wrinkleStrength: number
}

export interface ThunderWebGl2AdapterSurface {
  configure(config: Readonly<ThunderWebGl2AdapterConfig>): void
  start(
    options?: Readonly<ThunderWebGl2StartOptions>
  ): ThunderWebGl2RendererResult
  renderFrame(
    options: Readonly<ThunderWebGl2FrameOptions>
  ): ThunderWebGl2RendererResult
  stop(
    options?: Readonly<ThunderWebGl2StopOptions>
  ): ThunderWebGl2RendererResult
  reset(): ThunderWebGl2RendererResult
  emergencyStop(): ThunderWebGl2RendererResult
  dispose(): void
}

export type ThunderWebGl2AdapterSurfaceInput =
  | ThunderWebGl2AdapterSurface
  | ThunderBallSurface

export interface ThunderWebGl2AdapterOptions {
  surface: ThunderWebGl2AdapterSurface
  waitFrame?: (durationMs: number, signal?: AbortSignal) => Promise<void>
}

export interface ThunderWebGl2AdapterSnapshot {
  cleanupComplete: boolean
  configured: boolean
  disposed: boolean
  frameCount: number
  lastConfig: Readonly<ThunderWebGl2AdapterConfig> | null
  quarantined: boolean
  started: boolean
}

const DEFAULT_ORB_RADIUS = 0.42
const DEFAULT_LINE_WIDTH = 4
const DEFAULT_MASTER_INTENSITY = 0.82
const DEFAULT_BLOOM_GAIN = 0.65
const DEFAULT_WRINKLE_STRENGTH = 0.08
const MAX_DRAIN_PRESENTATIONS = 6
const DRAIN_WAIT_GRACE_MS = 50
const MAX_CANVAS_SIZE = 8192

export class ThunderWebGl2AdapterError extends Error {
  readonly code = 'thunder-webgl2-adapter-failed'

  constructor() {
    super('thunder WebGL2 adapter operation failed')
    this.name = 'ThunderWebGl2AdapterError'
  }
}

export class ThunderBallWebGl2Adapter implements ProjectionEffectRenderer {
  private readonly surface: ThunderWebGl2AdapterSurface
  private readonly waitFrame: NonNullable<
    ThunderWebGl2AdapterOptions['waitFrame']
  >
  private started = false
  private disposed = false
  private cleanupComplete = false
  private quarantined = false
  private configured = false
  private lastNowMs = 0
  private lastRenderedAtMs: number | null = null
  private frameCount = 0
  private lastConfig: Readonly<ThunderWebGl2AdapterConfig> | null = null

  constructor(options: Readonly<ThunderWebGl2AdapterOptions>) {
    this.surface = options.surface
    this.waitFrame = options.waitFrame ?? waitForTimer
  }

  render(context: Readonly<ProjectionEffectFrameContext>): void {
    if (this.disposed || context.signal?.aborted) return
    this.assertAvailable()
    const nowMs = monotonicTime(context.nowMs, this.lastNowMs)
    this.lastNowMs = nowMs
    const config = mapThunderParametersToWebGl2AdapterConfig(context.parameters)
    try {
      this.surface.configure(config)
      this.configured = true
      this.lastConfig = config
      if (!this.started) {
        const started = this.surface.start({
          nowMs,
          seed: config.topologySeed,
          reducedMotion: config.reducedMotion,
        })
        this.requireRendererState(started, 'running')
        this.started = true
        this.lastRenderedAtMs = null
      }
      const minimumFrameIntervalMs = 1000 / config.updateRateHz
      if (
        this.lastRenderedAtMs !== null &&
        nowMs - this.lastRenderedAtMs < minimumFrameIntervalMs
      ) {
        return
      }
      const rendered = this.surface.renderFrame({
        nowMs,
        reducedMotion: config.reducedMotion,
      })
      this.requireRendererState(rendered, 'running')
      this.lastRenderedAtMs = nowMs
      this.frameCount += 1
    } catch {
      this.failClosed()
    }
  }

  async stop(context: Readonly<ProjectionEffectStopContext>): Promise<void> {
    if (this.disposed || !this.started) return
    this.assertAvailable()
    try {
      if (context.mode === 'immediate' || context.fadeMs === 0) {
        const stopped = this.surface.emergencyStop()
        this.requireRendererState(stopped, 'stopped')
        this.started = false
        return
      }

      const fadeMs = clamp(
        finiteOr(context.fadeMs, 0),
        0,
        THUNDER_WEBGL2_MAX_DRAIN_MS
      )
      const drainStartMs = this.lastNowMs
      let stopped = this.surface.stop({ nowMs: drainStartMs, fadeMs })
      this.requireRendererState(stopped, 'draining', 'stopped')
      const stepDurationMs = fadeMs / MAX_DRAIN_PRESENTATIONS
      for (
        let step = 1;
        step <= MAX_DRAIN_PRESENTATIONS &&
        stopped.state === 'draining' &&
        !context.signal?.aborted;
        step += 1
      ) {
        await waitForBoundedFrame(
          this.waitFrame,
          stepDurationMs,
          context.signal
        )
        this.lastNowMs = monotonicTime(
          drainStartMs + stepDurationMs * step,
          this.lastNowMs
        )
        stopped = this.surface.renderFrame({ nowMs: this.lastNowMs })
        this.requireRendererState(stopped, 'draining', 'stopped')
      }
      if (context.signal?.aborted && stopped.state === 'draining') {
        stopped = this.surface.emergencyStop()
      }
      this.requireRendererState(stopped, 'stopped')
      this.started = false
    } catch {
      this.failClosed()
    }
  }

  reset(): void {
    if (this.disposed) return
    this.assertAvailable()
    try {
      const reset = this.surface.reset()
      this.requireRendererState(reset, 'idle')
      this.started = false
      this.lastRenderedAtMs = null
      this.frameCount = 0
    } catch {
      this.failClosed()
    }
  }

  dispose(): void {
    if (this.cleanupComplete) return
    try {
      this.surface.dispose()
      this.cleanupComplete = true
      this.disposed = true
      this.started = false
      this.lastRenderedAtMs = null
    } catch {
      this.quarantined = true
      throw new ThunderWebGl2AdapterError()
    }
  }

  snapshot(): Readonly<ThunderWebGl2AdapterSnapshot> {
    return Object.freeze({
      cleanupComplete: this.cleanupComplete,
      configured: this.configured,
      disposed: this.disposed,
      frameCount: this.frameCount,
      lastConfig: this.lastConfig,
      quarantined: this.quarantined,
      started: this.started,
    })
  }

  private requireRendererState(
    result: Readonly<ThunderWebGl2RendererResult>,
    ...allowedStates: readonly ThunderWebGl2RendererState[]
  ): void {
    if (!allowedStates.includes(result.state) || result.failure !== null) {
      throw new ThunderWebGl2AdapterError()
    }
  }

  private assertAvailable(): void {
    if (this.quarantined) throw new ThunderWebGl2AdapterError()
  }

  private failClosed(): never {
    this.quarantined = true
    throw new ThunderWebGl2AdapterError()
  }
}

export function fixedThunderWebGl2AdapterResult(
  state: ThunderWebGl2RendererState,
  status: ThunderWebGl2RendererResult['status'] = 'stopped'
): ThunderWebGl2RendererResult {
  return Object.freeze({ status, state, failure: null })
}

export function mapThunderParametersToWebGl2AdapterConfig(
  parameters: Readonly<Record<string, unknown>>
): Readonly<ThunderWebGl2AdapterConfig> {
  const reducedMotion = parameters.reducedMotion === true
  const centerX = numberParameter(parameters, 'centerX', 0, -1, 1)
  const centerY = numberParameter(parameters, 'centerY', 0, -1, 1)
  const seed = integerParameter(parameters, 'seed', 0, 0, 2_147_483_647)
  const orbRadius = numberParameter(
    parameters,
    'orbRadius',
    DEFAULT_ORB_RADIUS,
    0.08,
    1
  )
  const anchorCount = integerParameter(parameters, 'anchorCount', 24, 4, 64)
  const sparkBudget = integerParameter(parameters, 'sparkBudget', 21, 4, 128)
  const emissionRate = numberParameter(parameters, 'emissionRate', 8, 1, 30)
  const lifetimeMs = numberParameter(parameters, 'lifetimeMs', 1400, 300, 4000)
  const segmentCount = integerParameter(parameters, 'segmentCount', 20, 2, 48)
  const orbitSpeed = numberParameter(parameters, 'orbitSpeed', 0.7, 0, 3)
  const wrinkleStrength = numberParameter(
    parameters,
    'wrinkleStrength',
    DEFAULT_WRINKLE_STRENGTH,
    0,
    0.4
  )
  const requestedLineWidth = numberParameter(
    parameters,
    'lineWidth',
    DEFAULT_LINE_WIDTH,
    1,
    16
  )
  const requestedMasterIntensity = numberParameter(
    parameters,
    'masterIntensity',
    DEFAULT_MASTER_INTENSITY,
    0,
    1
  )
  const requestedBloomGain = numberParameter(
    parameters,
    'bloomGain',
    DEFAULT_BLOOM_GAIN,
    0,
    2
  )
  const internalResolutionScale = numberParameter(
    parameters,
    'internalResolutionScale',
    0.75,
    0.25,
    1
  )
  const updateRateHz = numberParameter(parameters, 'updateRateHz', 60, 15, 60)
  const postProcessing = parameters.postProcessing !== false && !reducedMotion
  const lineWidth = reducedMotion
    ? Math.min(3, requestedLineWidth)
    : requestedLineWidth
  const masterIntensity = reducedMotion
    ? Math.min(0.72, requestedMasterIntensity)
    : requestedMasterIntensity
  const bloomGain = reducedMotion
    ? Math.min(0.35, requestedBloomGain)
    : requestedBloomGain
  const visualTopologySeed = mixParameterSeed(
    centerX,
    centerY,
    orbRadius,
    anchorCount,
    sparkBudget,
    emissionRate,
    lifetimeMs,
    segmentCount,
    orbitSpeed,
    wrinkleStrength,
    lineWidth,
    masterIntensity,
    bloomGain,
    internalResolutionScale,
    updateRateHz,
    postProcessing ? 1 : 0,
    reducedMotion ? 1 : 0
  )
  const topologySeed =
    seed === 0 ? visualTopologySeed : mixParameterSeed(visualTopologySeed, seed)

  return Object.freeze({
    bloomGain,
    centerX,
    centerY,
    internalResolutionScale,
    lineWidth,
    masterIntensity,
    orbRadius,
    postProcessing,
    publicParameters: Object.freeze({ ...parameters }),
    reducedMotion,
    topologySeed,
    updateRateHz,
    wrinkleStrength,
  })
}

export function createThunderBallWebGl2CanvasSurface(
  canvas: HTMLCanvasElement
): ThunderWebGl2AdapterSurface {
  return new ThunderBallWebGl2CanvasSurface(canvas)
}

export function normalizeThunderWebGl2AdapterSurface(
  surface: ThunderWebGl2AdapterSurfaceInput,
  waitFrame?: (durationMs: number, signal?: AbortSignal) => Promise<void>
): ThunderWebGl2AdapterSurface {
  return isThunderWebGl2AdapterSurface(surface)
    ? surface
    : new LegacyThunderAdapterSurface(surface, waitFrame)
}

function isThunderWebGl2AdapterSurface(
  surface: ThunderWebGl2AdapterSurfaceInput
): surface is ThunderWebGl2AdapterSurface {
  const candidate = surface as Partial<ThunderWebGl2AdapterSurface>
  return (
    typeof candidate.configure === 'function' &&
    typeof candidate.start === 'function' &&
    typeof candidate.renderFrame === 'function' &&
    typeof candidate.emergencyStop === 'function'
  )
}

function normalizeFailureStage(
  stage: ThunderWebGl2GpuFailureStage | undefined
): ThunderWebGl2GpuFailureStage {
  switch (stage) {
    case 'preflight':
    case 'raw':
    case 'blur':
    case 'bloom':
    case 'temporal':
    case 'presentation':
    case 'context-lost':
      return stage
    default:
      return 'none'
  }
}

class ThunderBallWebGl2CanvasSurface implements ThunderWebGl2AdapterSurface {
  private renderer: ThunderBallWebGl2Renderer | null = null
  private mappedEngine: MappedThunderWebGl2EngineBoundary | null = null
  private config = mapThunderParametersToWebGl2AdapterConfig({})
  private disposed = false

  constructor(private readonly canvas: HTMLCanvasElement) {}

  configure(config: Readonly<ThunderWebGl2AdapterConfig>): void {
    if (this.disposed) throw new ThunderWebGl2AdapterError()
    this.config = config
    this.mappedEngine?.configure(config)
  }

  start(
    options: Readonly<ThunderWebGl2StartOptions> = {}
  ): ThunderWebGl2RendererResult {
    const renderer = this.ensureRenderer()
    const result = renderer.start(options)
    this.publishFailureStage(
      renderer,
      result.state === 'running' && result.failure === null
    )
    return result
  }

  renderFrame(
    options: Readonly<ThunderWebGl2FrameOptions>
  ): ThunderWebGl2RendererResult {
    const renderer = this.ensureRenderer()
    const { width, height, projectionAspect } = this.syncCanvasSize()
    const result = renderer.renderFrame({
      ...options,
      width,
      height,
      projectionAspect,
      centerX: this.config.centerX,
      centerY: this.config.centerY,
      radiusScale: this.config.orbRadius / DEFAULT_ORB_RADIUS,
      widthScale: this.config.lineWidth / DEFAULT_LINE_WIDTH,
      wrinkleScale:
        this.config.wrinkleStrength / Math.max(DEFAULT_WRINKLE_STRENGTH, 1e-6),
    })
    this.publishFailureStage(renderer)
    return result
  }

  stop(
    options: Readonly<ThunderWebGl2StopOptions> = {}
  ): ThunderWebGl2RendererResult {
    const result =
      this.renderer?.stop(options) ?? fixedThunderWebGl2AdapterResult('stopped')
    this.publishFailureStage(this.renderer)
    return result
  }

  reset(): ThunderWebGl2RendererResult {
    const result =
      this.renderer?.reset() ?? fixedThunderWebGl2AdapterResult('idle', 'reset')
    this.publishFailureStage(this.renderer)
    return result
  }

  emergencyStop(): ThunderWebGl2RendererResult {
    const result =
      this.renderer?.emergencyStop() ??
      fixedThunderWebGl2AdapterResult('stopped', 'emergency-stopped')
    this.publishFailureStage(this.renderer)
    return result
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    const result = this.renderer?.dispose()
    this.publishFailureStage(this.renderer)
    if (result && result.state !== 'disposed') {
      this.disposed = false
      throw new ThunderWebGl2AdapterError()
    }
  }

  private ensureRenderer(): ThunderBallWebGl2Renderer {
    if (this.disposed) throw new ThunderWebGl2AdapterError()
    if (this.renderer) return this.renderer
    const { width, height } = this.syncCanvasSize()
    const gl = this.canvas.getContext('webgl2', {
      alpha: true,
      antialias: true,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
    })
    const engine = new ThunderBallWebGl2Engine({ gl, width, height })
    this.mappedEngine = new MappedThunderWebGl2EngineBoundary(
      engine,
      this.config
    )
    this.renderer = new ThunderBallWebGl2Renderer({
      engine: this.mappedEngine,
      seed: this.config.topologySeed,
      reducedMotion: this.config.reducedMotion,
    })
    return this.renderer
  }

  private syncCanvasSize(): {
    width: number
    height: number
    projectionAspect: number
  } {
    const cssWidth = Math.max(1, this.canvas.clientWidth || this.canvas.width)
    const cssHeight = Math.max(
      1,
      this.canvas.clientHeight || this.canvas.height
    )
    const width = Math.min(
      MAX_CANVAS_SIZE,
      Math.max(1, Math.round(cssWidth * this.config.internalResolutionScale))
    )
    const height = Math.min(
      MAX_CANVAS_SIZE,
      Math.max(1, Math.round(cssHeight * this.config.internalResolutionScale))
    )
    if (this.canvas.width !== width) this.canvas.width = width
    if (this.canvas.height !== height) this.canvas.height = height
    return {
      width,
      height,
      projectionAspect: cssWidth / Math.max(1, cssHeight),
    }
  }

  private publishFailureStage(
    renderer: ThunderBallWebGl2Renderer | null,
    allowClear = false
  ): void {
    if (!renderer) return
    const stage = normalizeFailureStage(renderer.snapshot().engine.failureStage)
    if (stage === 'none' && !allowClear) return
    try {
      this.canvas.setAttribute(
        THUNDER_WEBGL2_GPU_FAILURE_STAGE_ATTRIBUTE,
        stage
      )
    } catch {
      // The diagnostic surface must never widen renderer failure authority.
    }
  }
}

class MappedThunderWebGl2EngineBoundary implements ThunderWebGl2EngineBoundary {
  private config: Readonly<ThunderWebGl2AdapterConfig>

  constructor(
    private readonly engine: ThunderBallWebGl2Engine,
    config: Readonly<ThunderWebGl2AdapterConfig>
  ) {
    this.config = config
  }

  configure(config: Readonly<ThunderWebGl2AdapterConfig>): void {
    this.config = config
  }

  render(frame: Readonly<ThunderWebGl2EngineFrame>): ThunderWebGl2EngineResult {
    return this.engine.render(mapThunderWebGl2EngineFrame(frame, this.config))
  }

  resize(width: number, height: number): ThunderWebGl2EngineResult {
    return this.engine.resize(width, height)
  }

  reset(): ThunderWebGl2EngineResult {
    return this.engine.reset()
  }

  clear(): ThunderWebGl2EngineResult {
    return this.engine.clear()
  }

  dispose(): ThunderWebGl2EngineResult {
    return this.engine.dispose()
  }

  audit() {
    return this.engine.audit()
  }
}

class LegacyThunderAdapterSurface implements ThunderWebGl2AdapterSurface {
  private readonly renderer: ThunderBallRenderer
  private config = mapThunderParametersToWebGl2AdapterConfig({})
  private state: ThunderWebGl2RendererState = 'idle'
  private lastNowMs = 0
  private disposed = false

  constructor(
    surface: ThunderBallSurface,
    waitFrame?: (durationMs: number, signal?: AbortSignal) => Promise<void>
  ) {
    this.renderer = new ThunderBallRenderer({
      surface,
      waitFrame: waitFrame
        ? (durationMs) => waitFrame(durationMs)
        : async () => {},
    })
  }

  configure(config: Readonly<ThunderWebGl2AdapterConfig>): void {
    this.config = config
  }

  start(): ThunderWebGl2RendererResult {
    this.state = 'running'
    return fixedThunderWebGl2AdapterResult('running', 'started')
  }

  renderFrame(
    options: Readonly<ThunderWebGl2FrameOptions>
  ): ThunderWebGl2RendererResult {
    const nowMs = monotonicTime(options.nowMs, this.lastNowMs)
    this.renderer.render({
      nowMs,
      deltaMs: nowMs - this.lastNowMs,
      parameters: this.config.publicParameters,
    })
    this.lastNowMs = nowMs
    return fixedThunderWebGl2AdapterResult(this.state, 'rendered')
  }

  stop(): ThunderWebGl2RendererResult {
    this.renderer.reset()
    this.state = 'stopped'
    return fixedThunderWebGl2AdapterResult('stopped')
  }

  reset(): ThunderWebGl2RendererResult {
    this.renderer.reset()
    this.state = 'idle'
    return fixedThunderWebGl2AdapterResult('idle', 'reset')
  }

  emergencyStop(): ThunderWebGl2RendererResult {
    this.renderer.reset()
    this.state = 'stopped'
    return fixedThunderWebGl2AdapterResult('stopped', 'emergency-stopped')
  }

  dispose(): void {
    if (this.disposed) return
    this.renderer.dispose()
    this.disposed = true
    this.state = 'disposed'
  }
}

export function mapThunderWebGl2EngineFrame(
  frame: Readonly<ThunderWebGl2EngineFrame>,
  config: Readonly<ThunderWebGl2AdapterConfig>
): ThunderWebGl2EngineFrame {
  const bloomScale = config.bloomGain / Math.max(DEFAULT_BLOOM_GAIN, 1e-6)
  const intensityScale = config.masterIntensity / DEFAULT_MASTER_INTENSITY
  const sourceInput =
    frame.sources ??
    frame.ribbons.flatMap((ribbon) => {
      const source = ribbon[0]?.sourceBirth
      return source ? [source] : []
    })
  return Object.freeze({
    ribbons: frame.ribbons,
    sources: Object.freeze(
      sourceInput.map((source) =>
        Object.freeze({
          ...source,
          energy: clamp(source.energy * config.masterIntensity, 0, 1),
        })
      )
    ),
    passGraph: THUNDER_WEBGL2_PASS_GRAPH,
    tone: Object.freeze({
      ...frame.tone,
      coreLuminance: frame.tone.coreLuminance * intensityScale,
      haloLuminance: config.postProcessing ? frame.tone.haloLuminance : 0,
      bloomGain: config.postProcessing ? frame.tone.bloomGain * bloomScale : 0,
      exposure: clamp(frame.tone.exposure, 0, 2),
      gamma: clamp(frame.tone.gamma, 0.6, 1.4),
      feedback:
        config.postProcessing && config.masterIntensity > 0
          ? frame.tone.feedback
          : 0,
      glowLevel: config.postProcessing ? frame.tone.glowLevel : 0,
      rampLevel: config.postProcessing ? frame.tone.rampLevel : 0,
    }),
  })
}

function numberParameter(
  parameters: Readonly<Record<string, unknown>>,
  id: string,
  fallback: number,
  minimum: number,
  maximum: number
): number {
  const value = parameters[id]
  return clamp(
    typeof value === 'number' && Number.isFinite(value) ? value : fallback,
    minimum,
    maximum
  )
}

function integerParameter(
  parameters: Readonly<Record<string, unknown>>,
  id: string,
  fallback: number,
  minimum: number,
  maximum: number
): number {
  return Math.round(numberParameter(parameters, id, fallback, minimum, maximum))
}

function mixParameterSeed(...values: readonly number[]): number {
  let seed = 0x811c9dc5
  for (const value of values) {
    seed = Math.imul(seed ^ Math.round(value * 1000), 0x01000193)
  }
  return (seed ^ (seed >>> 16)) >>> 0
}

function monotonicTime(value: number, previous: number): number {
  return Math.max(previous, Math.max(0, finiteOr(value, previous)))
}

function finiteOr(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function clamp(value: number, minimum: number, maximum: number): number {
  const finite = Number.isFinite(value) ? value : minimum
  return Math.min(maximum, Math.max(minimum, finite))
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
  waitFrame: NonNullable<ThunderWebGl2AdapterOptions['waitFrame']>,
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
