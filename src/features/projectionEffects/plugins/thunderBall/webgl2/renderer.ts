import {
  THUNDER_WEBGL2_MAX_DRAIN_MS,
  type ThunderWebGl2EngineAudit,
  type ThunderWebGl2EngineFrame,
  type ThunderWebGl2EngineResult,
  type ThunderWebGl2FailureClass,
  type ThunderWebGl2RendererResult,
  type ThunderWebGl2RendererSnapshot,
  type ThunderWebGl2RendererState,
  type ThunderWebGl2Topology,
} from './contracts'
import { ThunderBallWebGl2Engine } from './engine'
import {
  createThunderWebGl2Topology,
  resolveThunderWebGl2Tone,
} from './topology'

export interface ThunderWebGl2EngineBoundary {
  render(frame: Readonly<ThunderWebGl2EngineFrame>): ThunderWebGl2EngineResult
  resize(width: number, height: number): ThunderWebGl2EngineResult
  reset(): ThunderWebGl2EngineResult
  clear(): ThunderWebGl2EngineResult
  dispose(): ThunderWebGl2EngineResult
  audit(): Readonly<ThunderWebGl2EngineAudit>
}

export interface ThunderWebGl2StartOptions {
  nowMs?: number
  seed?: number
  reducedMotion?: boolean
}

export interface ThunderWebGl2FrameOptions {
  nowMs: number
  width?: number
  height?: number
  projectionAspect?: number
  reducedMotion?: boolean
  centerX?: number
  centerY?: number
  radiusScale?: number
  widthScale?: number
  wrinkleScale?: number
}

export interface ThunderWebGl2StopOptions {
  nowMs?: number
  fadeMs?: number
}

export interface ThunderWebGl2PauseOptions {
  nowMs?: number
}

export interface ThunderWebGl2RendererOptions {
  engine: ThunderWebGl2EngineBoundary
  seed?: number
  reducedMotion?: boolean
}

export class ThunderBallWebGl2Renderer {
  private readonly engine: ThunderWebGl2EngineBoundary
  private stateValue: ThunderWebGl2RendererState = 'idle'
  private failureValue: ThunderWebGl2FailureClass | null = null
  private seedValue: number
  private reducedMotionValue: boolean
  private birthsEnabledValue = false
  private topologyValue: ThunderWebGl2Topology | null = null
  private drainDeadlineValue: number | null = null
  private lastNowMs = 0
  private pausedAtMs: number | null = null
  private pausedDurationMs = 0
  private terminalRequested = false

  constructor(options: Readonly<ThunderWebGl2RendererOptions>) {
    this.engine = options.engine
    this.seedValue = integerOr(options.seed, 1)
    this.reducedMotionValue = options.reducedMotion === true
    this.adoptEngineState()
  }

  start(
    options: Readonly<ThunderWebGl2StartOptions> = {}
  ): ThunderWebGl2RendererResult {
    if (this.terminalRequested || this.stateValue === 'disposed') {
      return this.result('disposed')
    }
    if (!this.engineReady()) return this.blocked()
    this.seedValue = integerOr(options.seed, this.seedValue)
    this.reducedMotionValue = options.reducedMotion ?? this.reducedMotionValue
    this.lastNowMs = monotonicTime(options.nowMs, this.lastNowMs)
    this.birthsEnabledValue = true
    this.topologyValue = null
    this.drainDeadlineValue = null
    this.pausedAtMs = null
    this.pausedDurationMs = 0
    this.stateValue = 'running'
    this.failureValue = null
    return this.result('started')
  }

  renderFrame(
    options: Readonly<ThunderWebGl2FrameOptions>
  ): ThunderWebGl2RendererResult {
    if (
      this.terminalRequested ||
      this.stateValue === 'disposed' ||
      this.stateValue === 'quarantined'
    ) {
      return this.blocked()
    }
    if (this.stateValue === 'paused') {
      this.lastNowMs = monotonicTime(options.nowMs, this.lastNowMs)
      return this.result('paused')
    }
    if (this.stateValue !== 'running' && this.stateValue !== 'draining') {
      return this.result('stopped')
    }
    const nowMs = monotonicTime(options.nowMs, this.lastNowMs)
    this.lastNowMs = nowMs
    const simulationNowMs = Math.max(0, nowMs - this.pausedDurationMs)
    if (typeof options.reducedMotion === 'boolean') {
      this.reducedMotionValue = options.reducedMotion
    }
    if (
      typeof options.width === 'number' &&
      typeof options.height === 'number'
    ) {
      const audit = this.engine.audit()
      const width = boundedSize(options.width)
      const height = boundedSize(options.height)
      if (audit.width !== width || audit.height !== height) {
        const resized = this.engine.resize(width, height)
        if (resized.state !== 'ready') return this.quarantineFrom(resized)
      }
    }

    if (this.stateValue === 'running' && this.birthsEnabledValue) {
      const width = boundedSize(options.width ?? this.engine.audit().width)
      const height = boundedSize(options.height ?? this.engine.audit().height)
      const projectionAspect = clamp(
        finiteOr(options.projectionAspect, width / Math.max(1, height)),
        0.25,
        4
      )
      const nextTopology = createThunderWebGl2Topology({
        seed: this.seedValue,
        nowMs: simulationNowMs,
        reducedMotion: this.reducedMotionValue,
        center: {
          x: finiteOr(options.centerX, 0),
          y: finiteOr(options.centerY, 0),
        },
        radius: 0.4 * clamp(finiteOr(options.radiusScale, 1), 0.1, 4),
        aspect: projectionAspect,
        retainedSources: this.topologyValue?.sources,
        widthScale: clamp(finiteOr(options.widthScale, 1), 0.1, 4),
        wrinkleScale: clamp(finiteOr(options.wrinkleScale, 1), 0, 4),
      })
      if (nextTopology.epoch !== this.topologyValue?.epoch) {
        this.topologyValue = nextTopology
      }
    }

    const liveConnections = (this.topologyValue?.connections ?? []).filter(
      (connection) => connection.bornAtMs + connection.lifeMs > simulationNowMs
    )
    if (this.stateValue === 'draining') {
      const deadlineReached =
        this.drainDeadlineValue !== null && nowMs >= this.drainDeadlineValue
      if (deadlineReached || liveConnections.length === 0) {
        const cleared = this.engine.clear()
        this.topologyValue = null
        this.drainDeadlineValue = null
        this.stateValue = cleared.state === 'ready' ? 'stopped' : 'quarantined'
        this.failureValue = cleared.failure
        return this.result(
          this.stateValue === 'stopped' ? 'stopped' : 'blocked'
        )
      }
    }

    const baseTone = resolveThunderWebGl2Tone(this.reducedMotionValue)
    const rendered = this.engine.render({
      ribbons: liveConnections.map((connection) => connection.ribbon),
      sources: liveConnections.map((connection) => connection.source),
      tone: baseTone,
    })
    if (rendered.state !== 'ready') return this.quarantineFrom(rendered)
    return this.result(this.stateValue === 'draining' ? 'draining' : 'rendered')
  }

  pause(
    options: Readonly<ThunderWebGl2PauseOptions> = {}
  ): ThunderWebGl2RendererResult {
    if (
      this.terminalRequested ||
      this.stateValue === 'disposed' ||
      this.stateValue === 'quarantined'
    ) {
      return this.blocked()
    }
    if (this.stateValue === 'paused') return this.result('paused')
    if (this.stateValue !== 'running') return this.result('blocked')
    const nowMs = monotonicTime(options.nowMs, this.lastNowMs)
    this.lastNowMs = nowMs
    this.pausedAtMs = nowMs
    this.birthsEnabledValue = false
    this.stateValue = 'paused'
    return this.result('paused')
  }

  resume(
    options: Readonly<ThunderWebGl2PauseOptions> = {}
  ): ThunderWebGl2RendererResult {
    if (
      this.terminalRequested ||
      this.stateValue === 'disposed' ||
      this.stateValue === 'quarantined'
    ) {
      return this.blocked()
    }
    if (this.stateValue !== 'paused' || this.pausedAtMs === null) {
      return this.result('blocked')
    }
    const nowMs = monotonicTime(options.nowMs, this.lastNowMs)
    this.pausedDurationMs += Math.max(0, nowMs - this.pausedAtMs)
    this.lastNowMs = nowMs
    this.pausedAtMs = null
    this.birthsEnabledValue = true
    this.stateValue = 'running'
    return this.result('resumed')
  }

  stop(
    options: Readonly<ThunderWebGl2StopOptions> = {}
  ): ThunderWebGl2RendererResult {
    if (
      this.terminalRequested ||
      this.stateValue === 'disposed' ||
      this.stateValue === 'quarantined'
    ) {
      return this.blocked()
    }
    if (
      this.stateValue !== 'running' &&
      this.stateValue !== 'paused' &&
      this.stateValue !== 'draining'
    ) {
      this.birthsEnabledValue = false
      return this.result('stopped')
    }
    const nowMs = monotonicTime(options.nowMs, this.lastNowMs)
    this.lastNowMs = nowMs
    if (this.pausedAtMs !== null) {
      this.pausedDurationMs += Math.max(0, nowMs - this.pausedAtMs)
      this.pausedAtMs = null
    }
    this.birthsEnabledValue = false
    const fadeMs = clamp(
      finiteOr(options.fadeMs, THUNDER_WEBGL2_MAX_DRAIN_MS),
      0,
      THUNDER_WEBGL2_MAX_DRAIN_MS
    )
    this.drainDeadlineValue = nowMs + fadeMs
    if (fadeMs === 0 || (this.topologyValue?.connections.length ?? 0) === 0) {
      const cleared = this.engine.clear()
      this.topologyValue = null
      this.drainDeadlineValue = null
      this.stateValue = cleared.state === 'ready' ? 'stopped' : 'quarantined'
      this.failureValue = cleared.failure
      return this.result(this.stateValue === 'stopped' ? 'stopped' : 'blocked')
    }
    this.stateValue = 'draining'
    return this.result('draining')
  }

  reset(): ThunderWebGl2RendererResult {
    if (this.terminalRequested || this.stateValue === 'disposed') {
      return this.result('disposed')
    }
    const reset = this.engine.reset()
    this.topologyValue = null
    this.birthsEnabledValue = false
    this.drainDeadlineValue = null
    this.lastNowMs = 0
    this.pausedAtMs = null
    this.pausedDurationMs = 0
    this.stateValue = reset.state === 'ready' ? 'idle' : 'quarantined'
    this.failureValue = reset.failure
    return this.result(this.stateValue === 'idle' ? 'reset' : 'blocked')
  }

  emergencyStop(): ThunderWebGl2RendererResult {
    if (this.terminalRequested || this.stateValue === 'disposed') {
      return this.result('disposed')
    }
    this.birthsEnabledValue = false
    this.topologyValue = null
    this.drainDeadlineValue = null
    this.pausedAtMs = null
    this.pausedDurationMs = 0
    const cleared = this.engine.reset()
    this.stateValue = cleared.state === 'ready' ? 'stopped' : 'quarantined'
    this.failureValue = cleared.failure
    return this.result(
      this.stateValue === 'stopped' ? 'emergency-stopped' : 'blocked'
    )
  }

  dispose(): ThunderWebGl2RendererResult {
    if (this.terminalRequested && this.stateValue === 'disposed') {
      return this.result('disposed')
    }
    this.terminalRequested = true
    this.birthsEnabledValue = false
    this.topologyValue = null
    this.drainDeadlineValue = null
    this.pausedAtMs = null
    this.pausedDurationMs = 0
    const disposed = this.engine.dispose()
    this.stateValue = disposed.state === 'disposed' ? 'disposed' : 'quarantined'
    this.failureValue = disposed.failure
    return this.result(this.stateValue === 'disposed' ? 'disposed' : 'blocked')
  }

  snapshot(): Readonly<ThunderWebGl2RendererSnapshot> {
    return Object.freeze({
      state: this.stateValue,
      failure: this.failureValue,
      seed: this.seedValue,
      reducedMotion: this.reducedMotionValue,
      birthsEnabled: this.birthsEnabledValue,
      topologyEpoch: this.topologyValue?.epoch ?? null,
      connectionCount: this.topologyValue?.connections.length ?? 0,
      drainDeadlineMs: this.drainDeadlineValue,
      pausedAtMs: this.pausedAtMs,
      engine: this.engine.audit(),
    })
  }

  topologySnapshot(): Readonly<ThunderWebGl2Topology> | null {
    return this.topologyValue
  }

  private adoptEngineState(): void {
    const audit = this.engine.audit()
    if (audit.state === 'ready') return
    this.stateValue = audit.state === 'disposed' ? 'disposed' : 'quarantined'
    this.failureValue = audit.failure
    this.terminalRequested = audit.state === 'disposed'
  }

  private engineReady(): boolean {
    const audit = this.engine.audit()
    if (audit.state === 'ready' && audit.failure === null) return true
    this.stateValue = audit.state === 'disposed' ? 'disposed' : 'quarantined'
    this.failureValue = audit.failure
    return false
  }

  private quarantineFrom(
    engineResult: Readonly<ThunderWebGl2EngineResult>
  ): ThunderWebGl2RendererResult {
    this.birthsEnabledValue = false
    this.pausedAtMs = null
    this.stateValue =
      engineResult.state === 'disposed' ? 'disposed' : 'quarantined'
    this.failureValue = engineResult.failure
    return this.result('blocked')
  }

  private blocked(): ThunderWebGl2RendererResult {
    if (this.stateValue === 'disposed') return this.result('disposed')
    return this.result('blocked')
  }

  private result(
    status: ThunderWebGl2RendererResult['status']
  ): ThunderWebGl2RendererResult {
    return Object.freeze({
      status,
      state: this.stateValue,
      failure: this.failureValue,
    })
  }
}

export function createThunderBallWebGl2Renderer(
  engine: ThunderBallWebGl2Engine,
  options: Omit<ThunderWebGl2RendererOptions, 'engine'> = {}
): ThunderBallWebGl2Renderer {
  return new ThunderBallWebGl2Renderer({ ...options, engine })
}

function monotonicTime(value: number | undefined, previous: number): number {
  return Math.max(previous, Math.max(0, finiteOr(value, previous)))
}

function boundedSize(value: number): number {
  return Math.min(8192, Math.max(1, Math.round(finiteOr(value, 1))))
}

function integerOr(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.round(value)
    : fallback
}

function finiteOr(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}
