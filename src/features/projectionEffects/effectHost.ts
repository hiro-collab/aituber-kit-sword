import type { ProjectionEffectDefinition } from './canonical/types'
import { validateProjectionEffectParameterValues } from './canonical/validation'
import {
  MAX_PROJECTION_EFFECT_PARAMETERS,
  validateProjectionEffectCommand,
  type ProjectionEffectCommand,
  type ProjectionEffectStartCommand,
  type ProjectionEffectStopMode,
  type ProjectionEffectUpdateCommand,
} from './effectCommand'
import { ProjectionEffectRegistry } from './registry'
import type {
  ProjectionEffectRenderStatus,
  ProjectionEffectSession,
} from './rendererPlugin'
import {
  snapshotProjectionEffectSfxCue,
  validateProjectionEffectSfxCue,
  type ProjectionEffectSfxCue,
  type ProjectionEffectSfxPlayer,
  type ProjectionEffectSfxStatus,
} from './sfxContract'

export interface ProjectionEffectQualityPolicy {
  particleBudget: number
  internalResolutionScale: number
  updateRateHz: number
  postProcessing: boolean
}

export interface ProjectionEffectRuntimeCapabilities {
  webgl2Available: boolean
  audioOutputAvailable: boolean
  sfxAssetsAvailable: boolean
  selfObservationAvailable: boolean
}

export type ProjectionEffectReadinessWarning =
  | 'renderer-unavailable'
  | 'webgl2-unavailable'
  | 'audio-output-unavailable'
  | 'sfx-assets-unavailable'
  | 'self-observation-unavailable'

export interface ProjectionEffectReadiness {
  status: 'ready' | 'degraded'
  effectReady: boolean
  warnings: readonly ProjectionEffectReadinessWarning[]
}

export type ProjectionEffectHostStatus =
  | 'started'
  | 'updated'
  | 'frame-rendered'
  | 'frame-skipped'
  | 'stopped'
  | 'emergency-stopped'
  | 'reset'
  | 'blocked-not-ready'
  | 'blocked-emergency-stop'
  | 'rejected'
  | 'no-active-effect'
  | 'effect-mismatch'
  | 'unknown-effect'
  | 'blocked-terminal-cleanup'
  | 'stop-failed'
  | 'visual-failed'

export type ProjectionEffectPartialReason =
  | 'tts-timeout'
  | 'sfx-unavailable'
  | 'sfx-prepare-failed'
  | 'sfx-prepare-cleanup-failed'
  | 'sfx-start-failed'
  | 'sfx-start-cleanup-failed'
  | 'sfx-stop-failed'
  | 'visual-stop-failed'
  | 'visual-dispose-failed'
  | 'self-adjustment-unavailable'

export interface ProjectionEffectHostResult {
  status: ProjectionEffectHostStatus
  commandId: string | null
  activeEffectId: string | null
  replacedEffectId: string | null
  visualStatus: ProjectionEffectRenderStatus | null
  sfxStatus: ProjectionEffectSfxStatus | null
  fadeMs: number
  partialReasons: readonly ProjectionEffectPartialReason[]
  validationErrorCount: number
}

export interface ProjectionEffectHostOptions {
  registry: ProjectionEffectRegistry
  capabilities: ProjectionEffectRuntimeCapabilities
  qualityPolicy?: Partial<ProjectionEffectQualityPolicy>
  sfxPlayer?: ProjectionEffectSfxPlayer
  sfxCues?: readonly ProjectionEffectSfxCue[]
  nowMs?: () => number
  normalFadeMs?: number
  defaultLifetimeMs?: number
  effectLifetimeMs?: Readonly<Record<string, number>>
  scheduler?: ProjectionEffectHostScheduler
}

export interface ProjectionEffectHostScheduler {
  schedule(callback: () => void, delayMs: number): unknown
  cancel(handle: unknown): void
}

export interface ProjectionEffectFrameParameters {
  effectId: string
  parameters: Readonly<Record<string, unknown>>
}

interface ActiveProjectionEffect {
  effectId: string
  session: ProjectionEffectSession
  parameters: Readonly<Record<string, unknown>>
  sfx: OwnedProjectionEffectSfx | null
  lastFrameMs: number
  terminalBlocked: boolean
}

interface PendingProjectionEffectTerminal {
  session: ProjectionEffectSession
  sfx: OwnedProjectionEffectSfx | null
}

interface OwnedProjectionEffectSfx {
  cue: ProjectionEffectSfxCue
  controller: AbortController
  startedConfirmed: boolean
  terminationPromise: Promise<void> | null
  terminalConfirmed: boolean
}

interface StopOutcome {
  visualStatus: ProjectionEffectRenderStatus
  sfxStatus: ProjectionEffectSfxStatus | null
  partialReasons: ProjectionEffectPartialReason[]
  terminal: boolean
}

interface SfxStartOutcome {
  status: ProjectionEffectSfxStatus | null
  startedConfirmed: boolean
  ownershipSafe: boolean
}

interface SfxStopOutcome {
  status: ProjectionEffectSfxStatus | null
  terminal: boolean
}

const SFX_PREPARE_TIMEOUT_MS = 1_000
const SFX_START_TIMEOUT_MS = 1_000
const SFX_REJECT_CLEANUP_TIMEOUT_MS = 250
const SFX_STOP_TIMEOUT_MS = 1_000
const VISUAL_STOP_TIMEOUT_MS = 1_500
const VISUAL_DISPOSE_TIMEOUT_MS = 750
const MIN_EFFECT_LIFETIME_MS = 500
const MAX_EFFECT_LIFETIME_MS = 30_000
const SAFE_ID = /^[a-z][a-zA-Z0-9._-]{0,63}$/
const FRAME_QUALITY_PARAMETER_IDS = new Set([
  'particleBudget',
  'internalResolutionScale',
  'updateRateHz',
  'postProcessing',
  'reducedMotion',
])

export const DEFAULT_PROJECTION_EFFECT_LIFETIME_MS = 8_000

export const DEFAULT_PROJECTION_EFFECT_QUALITY_POLICY: ProjectionEffectQualityPolicy =
  Object.freeze({
    particleBudget: 1800,
    internalResolutionScale: 0.75,
    updateRateHz: 60,
    postProcessing: true,
  })

export class ProjectionEffectHost {
  private readonly registry: ProjectionEffectRegistry
  private readonly capabilities: ProjectionEffectRuntimeCapabilities
  private readonly sfxPlayer?: ProjectionEffectSfxPlayer
  private readonly sfxCues = new Map<string, ProjectionEffectSfxCue>()
  private readonly nowMs: () => number
  private readonly normalFadeMs: number
  private readonly defaultLifetimeMs: number
  private readonly effectLifetimeMs = new Map<string, number>()
  private readonly scheduler: ProjectionEffectHostScheduler
  private readonly emergencyLatches = new Set<string>()
  private operationTail: Promise<void> = Promise.resolve()
  private active: ActiveProjectionEffect | null = null
  private pendingTerminal: PendingProjectionEffectTerminal | null = null
  private lifetimeTimer: {
    handle: unknown
    generation: number
    effectId: string
    session: ProjectionEffectSession
  } | null = null
  private lifetimeGeneration = 0
  private qualityPolicyValue: ProjectionEffectQualityPolicy

  constructor(options: ProjectionEffectHostOptions) {
    this.registry = options.registry
    this.capabilities = { ...options.capabilities }
    this.sfxPlayer = options.sfxPlayer
    this.nowMs = options.nowMs ?? monotonicNow
    this.normalFadeMs = boundedFadeMs(options.normalFadeMs ?? 180)
    this.defaultLifetimeMs = boundedLifetimeMs(
      options.defaultLifetimeMs ?? DEFAULT_PROJECTION_EFFECT_LIFETIME_MS
    )
    this.scheduler = options.scheduler ?? DEFAULT_PROJECTION_EFFECT_SCHEDULER
    for (const [effectId, lifetimeMs] of Object.entries(
      options.effectLifetimeMs ?? {}
    )) {
      this.effectLifetimeMs.set(effectId, boundedLifetimeMs(lifetimeMs))
    }
    this.qualityPolicyValue = normalizeProjectionEffectQualityPolicy(
      options.qualityPolicy
    )
    for (const cue of options.sfxCues ?? []) {
      if (validateProjectionEffectSfxCue(cue).length > 0) {
        throw new Error('invalid projection effect SFX cue')
      }
      const ownedCue = snapshotProjectionEffectSfxCue(cue)
      if (this.sfxCues.has(ownedCue.effectId)) {
        throw new Error('projection effect SFX cue is already owned')
      }
      this.sfxCues.set(ownedCue.effectId, ownedCue)
    }
  }

  get activeEffectId(): string | null {
    return this.active?.effectId ?? null
  }

  get qualityPolicy(): ProjectionEffectQualityPolicy {
    return { ...this.qualityPolicyValue }
  }

  updateQualityPolicy(
    policy: Partial<ProjectionEffectQualityPolicy>
  ): ProjectionEffectQualityPolicy {
    this.qualityPolicyValue = normalizeProjectionEffectQualityPolicy({
      ...this.qualityPolicyValue,
      ...policy,
    })
    return this.qualityPolicy
  }

  readiness(effectId: string): ProjectionEffectReadiness {
    const warnings: ProjectionEffectReadinessWarning[] = []
    if (!this.registry.has(effectId)) warnings.push('renderer-unavailable')
    if (!this.capabilities.webgl2Available) warnings.push('webgl2-unavailable')
    if (!this.capabilities.audioOutputAvailable) {
      warnings.push('audio-output-unavailable')
    }
    if (!this.capabilities.sfxAssetsAvailable) {
      warnings.push('sfx-assets-unavailable')
    }
    if (!this.capabilities.selfObservationAvailable) {
      warnings.push('self-observation-unavailable')
    }
    return {
      status: warnings.length === 0 ? 'ready' : 'degraded',
      effectReady: warnings.length === 0,
      warnings,
    }
  }

  dispatch(input: unknown): Promise<ProjectionEffectHostResult> {
    const validation = validateProjectionEffectCommand(input)
    if (!validation.ok) {
      return Promise.resolve(
        this.result('rejected', null, {
          validationErrorCount: validation.errors.length,
        })
      )
    }
    return this.enqueue(() => this.dispatchValidated(validation.value))
  }

  renderFrame(input?: unknown): Promise<ProjectionEffectHostResult> {
    const frameParameters = validateFrameParameters(input)
    if (!frameParameters.ok) {
      return Promise.resolve(
        this.result('rejected', null, {
          validationErrorCount: frameParameters.errorCount,
        })
      )
    }
    return this.enqueue(async () => {
      const active = this.active
      if (!active) return this.result('no-active-effect', null)
      if (active.terminalBlocked) {
        return this.result('blocked-terminal-cleanup', null)
      }
      if (
        frameParameters.value &&
        active.effectId !== frameParameters.value.effectId
      ) {
        return this.result('effect-mismatch', null)
      }
      if (frameParameters.value) {
        const overrideErrors = validateFrameParameterOverrides(
          active.session.definition,
          frameParameters.value.parameters
        )
        if (overrideErrors.length > 0) {
          return this.result('rejected', null, {
            validationErrorCount: overrideErrors.length,
          })
        }
      }
      const frameNowMs = this.nowMs()
      const deltaMs = Math.max(
        0,
        Math.min(1_000, frameNowMs - active.lastFrameMs)
      )
      if (deltaMs + 0.5 < 1000 / this.qualityPolicyValue.updateRateHz) {
        return this.result('frame-skipped', null)
      }
      const mergedParameters = mergeFrameParameters(
        active.parameters,
        frameParameters.value?.parameters
      )
      const parameters = resolveProjectionEffectParameters(
        active.session.definition,
        mergedParameters,
        this.qualityPolicyValue
      )
      const parameterErrors = validateRuntimeParameterValues(
        active.session.definition,
        parameters
      )
      if (parameterErrors.length > 0) {
        return this.result('rejected', null, {
          validationErrorCount: parameterErrors.length,
        })
      }
      const visualResult = await active.session.update({
        nowMs: frameNowMs,
        deltaMs,
        parameters,
      })
      if (visualResult.status !== 'rendered') {
        await this.stopActive('emergency')
        return this.result('visual-failed', null, {
          visualStatus: visualResult.status,
        })
      }
      if (this.active === active) {
        active.parameters = parameters
        active.lastFrameMs = frameNowMs
      }
      return this.result('frame-rendered', null, {
        visualStatus: visualResult.status,
      })
    })
  }

  private dispatchValidated(
    command: ProjectionEffectCommand
  ): Promise<ProjectionEffectHostResult> {
    if (command.action === 'start') return this.start(command)
    if (command.action === 'update') return this.update(command)
    if (command.action === 'stop') {
      return this.stop(command.commandId, command.effectId, command.mode)
    }
    return this.reset(command.commandId, command.effectId)
  }

  private async start(
    command: ProjectionEffectStartCommand
  ): Promise<ProjectionEffectHostResult> {
    if (this.pendingTerminal && !(await this.tryFinalizePendingTerminal())) {
      return this.result('blocked-terminal-cleanup', command.commandId)
    }
    const readiness = this.readiness(command.effectId)
    if (
      readiness.warnings.includes('renderer-unavailable') ||
      readiness.warnings.includes('webgl2-unavailable')
    ) {
      return this.result('blocked-not-ready', command.commandId)
    }
    if (this.emergencyLatches.has(command.effectId)) {
      return this.result('blocked-emergency-stop', command.commandId)
    }
    if (this.active?.terminalBlocked) {
      const terminal = await this.tryFinalizeQuarantinedActive()
      if (!terminal) {
        return this.result('blocked-terminal-cleanup', command.commandId)
      }
    }

    let session: ProjectionEffectSession
    try {
      session = this.registry.createSession(command.effectId)
    } catch {
      return this.result('visual-failed', command.commandId)
    }
    const parameters = resolveProjectionEffectParameters(
      session.definition,
      command.parameters,
      this.qualityPolicyValue
    )
    const parameterErrors = validateRuntimeParameterValues(
      session.definition,
      parameters
    )
    if (parameterErrors.length > 0) {
      const terminal = await this.terminateFreshSession(session)
      if (!terminal) {
        this.pendingTerminal = { session, sfx: null }
        return this.result('blocked-terminal-cleanup', command.commandId, {
          visualStatus: 'dispose-failed',
          partialReasons: ['visual-dispose-failed'],
        })
      }
      return this.result('rejected', command.commandId, {
        validationErrorCount: parameterErrors.length,
      })
    }

    let replacedEffectId: string | null = null
    const partialReasons: ProjectionEffectPartialReason[] = []
    if (this.active) {
      replacedEffectId = this.active.effectId
      const replaced = await this.stopActive('normal')
      partialReasons.push(...replaced.partialReasons)
      if (!replaced.terminal) {
        const freshTerminal = await this.terminateFreshSession(session)
        if (!freshTerminal) {
          this.pendingTerminal = { session, sfx: null }
          partialReasons.push('visual-dispose-failed')
        }
        return this.result('blocked-terminal-cleanup', command.commandId, {
          replacedEffectId,
          visualStatus: replaced.visualStatus,
          sfxStatus: replaced.sfxStatus,
          partialReasons,
        })
      }
    }

    const cue = this.sfxCues.get(command.effectId) ?? null
    let sfxStatus: ProjectionEffectSfxStatus | null = null
    let sfxPrepared = false
    const sfx: OwnedProjectionEffectSfx | null = this.canStartSfx(cue)
      ? {
          cue,
          controller: new AbortController(),
          startedConfirmed: false,
          terminationPromise: null,
          terminalConfirmed: false,
        }
      : null
    if (!sfx) {
      sfxStatus = 'unavailable'
      partialReasons.push('sfx-unavailable')
    } else {
      const prepared = await settleWithin(
        () => this.sfxPlayer?.prepare(sfx.cue, sfx.controller.signal),
        SFX_PREPARE_TIMEOUT_MS
      )
      if (prepared.ok) {
        sfxPrepared = true
      } else {
        sfx.controller.abort()
        sfxStatus = 'prepare-failed'
        partialReasons.push('sfx-prepare-failed')
        const cleaned = await this.terminateSfxWithin(
          sfx,
          SFX_REJECT_CLEANUP_TIMEOUT_MS
        )
        if (!cleaned) partialReasons.push('sfx-prepare-cleanup-failed')
      }
    }

    const startResult = await session.start()
    if (startResult.status !== 'started') {
      sfx?.controller.abort()
      if (sfx && (sfxPrepared || !sfx.terminalConfirmed)) {
        const cleaned = await this.terminateSfxWithin(
          sfx,
          SFX_REJECT_CLEANUP_TIMEOUT_MS
        )
        if (!cleaned) {
          partialReasons.push('sfx-prepare-cleanup-failed')
        }
      }
      const visualTerminal = await this.terminateFreshSession(session)
      const terminal = visualTerminal && (sfx?.terminalConfirmed ?? true)
      if (!terminal) this.pendingTerminal = { session, sfx }
      return this.result(
        terminal ? 'visual-failed' : 'blocked-terminal-cleanup',
        command.commandId,
        {
          replacedEffectId,
          visualStatus: visualTerminal ? startResult.status : 'dispose-failed',
          sfxStatus,
          partialReasons: [
            ...partialReasons,
            ...(!visualTerminal ? (['visual-dispose-failed'] as const) : []),
          ],
        }
      )
    }

    const frameNowMs = this.nowMs()
    this.active = {
      effectId: command.effectId,
      session,
      parameters,
      sfx,
      lastFrameMs: frameNowMs,
      terminalBlocked: false,
    }
    const visualPromise = session.update({
      nowMs: frameNowMs,
      deltaMs: 1000 / this.qualityPolicyValue.updateRateHz,
      parameters,
    })
    const sfxPromise = sfxPrepared
      ? this.startSfx(sfx as OwnedProjectionEffectSfx)
      : Promise.resolve<SfxStartOutcome>({
          status: sfxStatus,
          startedConfirmed: false,
          ownershipSafe: sfx?.terminalConfirmed ?? true,
        })
    const [visualResult, sfxStartOutcome] = await Promise.all([
      visualPromise,
      sfxPromise,
    ])
    sfxStatus = sfxStartOutcome.status
    if (this.active?.session === session && this.active.sfx) {
      this.active.sfx.startedConfirmed = sfxStartOutcome.startedConfirmed
    }
    if (
      sfxStatus === 'start-failed-cleaned' ||
      sfxStatus === 'start-failed-cleanup-failed'
    ) {
      partialReasons.push('sfx-start-failed')
    }
    if (sfxStatus === 'start-failed-cleanup-failed') {
      partialReasons.push('sfx-start-cleanup-failed')
    }
    if (!sfxStartOutcome.ownershipSafe) {
      const stopped = await this.stopActive('emergency')
      return this.result('blocked-terminal-cleanup', command.commandId, {
        replacedEffectId,
        visualStatus: stopped.visualStatus,
        sfxStatus: stopped.sfxStatus,
        partialReasons: [...partialReasons, ...stopped.partialReasons],
      })
    }
    if (visualResult.status !== 'rendered') {
      await this.stopActive('emergency')
      return this.result('visual-failed', command.commandId, {
        replacedEffectId,
        visualStatus: visualResult.status,
        sfxStatus,
        partialReasons,
      })
    }

    if (command.speechCompletion === 'timeout') {
      partialReasons.push('tts-timeout')
    }
    if (!this.capabilities.selfObservationAvailable) {
      partialReasons.push('self-adjustment-unavailable')
    }
    this.scheduleFiniteStop(command.effectId, session, command.durationMs)
    return this.result('started', command.commandId, {
      replacedEffectId,
      visualStatus: visualResult.status,
      sfxStatus,
      partialReasons,
    })
  }

  private async update(
    command: ProjectionEffectUpdateCommand
  ): Promise<ProjectionEffectHostResult> {
    if (!this.active) {
      return this.result('no-active-effect', command.commandId)
    }
    if (this.active.terminalBlocked) {
      return this.result('blocked-terminal-cleanup', command.commandId)
    }
    if (this.active.effectId !== command.effectId) {
      return this.result('effect-mismatch', command.commandId)
    }
    const parameters = resolveProjectionEffectParameters(
      this.active.session.definition,
      { ...this.active.parameters, ...command.parameters },
      this.qualityPolicyValue
    )
    const parameterErrors = validateRuntimeParameterValues(
      this.active.session.definition,
      parameters
    )
    if (parameterErrors.length > 0) {
      return this.result('rejected', command.commandId, {
        validationErrorCount: parameterErrors.length,
      })
    }
    const frameNowMs = this.nowMs()
    const visualResult = await this.active.session.update({
      nowMs: frameNowMs,
      deltaMs: Math.max(
        0,
        Math.min(1_000, frameNowMs - this.active.lastFrameMs)
      ),
      parameters,
    })
    if (visualResult.status !== 'rendered') {
      await this.stopActive('emergency')
      return this.result('visual-failed', command.commandId, {
        visualStatus: visualResult.status,
      })
    }
    this.active = { ...this.active, parameters, lastFrameMs: frameNowMs }
    return this.result('updated', command.commandId, {
      visualStatus: visualResult.status,
    })
  }

  private async stop(
    commandId: string,
    effectId: string,
    mode: ProjectionEffectStopMode
  ): Promise<ProjectionEffectHostResult> {
    if (!this.registry.has(effectId)) {
      return this.result('unknown-effect', commandId)
    }
    if (mode === 'emergency') this.emergencyLatches.add(effectId)
    if (!this.active) {
      return this.result(
        mode === 'emergency' ? 'emergency-stopped' : 'no-active-effect',
        commandId
      )
    }
    if (this.active.effectId !== effectId) {
      return this.result('effect-mismatch', commandId)
    }

    const stopped = await this.stopActive(mode)
    const visualCleanupFailed = stopped.partialReasons.some(
      (reason) =>
        reason === 'visual-stop-failed' || reason === 'visual-dispose-failed'
    )
    return this.result(
      visualCleanupFailed || !stopped.terminal
        ? 'stop-failed'
        : mode === 'emergency'
          ? 'emergency-stopped'
          : 'stopped',
      commandId,
      {
        visualStatus: stopped.visualStatus,
        sfxStatus: stopped.sfxStatus,
        fadeMs: mode === 'normal' ? this.normalFadeMs : 0,
        partialReasons: stopped.partialReasons,
      }
    )
  }

  private async reset(
    commandId: string,
    effectId: string
  ): Promise<ProjectionEffectHostResult> {
    if (!this.registry.has(effectId)) {
      return this.result('unknown-effect', commandId)
    }

    const pending = this.pendingTerminal
    if (
      pending?.session.definition.id === effectId &&
      !(await this.tryFinalizePendingTerminal())
    ) {
      return this.result('blocked-terminal-cleanup', commandId, {
        visualStatus: 'dispose-failed',
        partialReasons: ['visual-dispose-failed'],
      })
    }

    let sfxStatus: ProjectionEffectSfxStatus | null = null
    if (this.active?.effectId === effectId) {
      const stopped = await this.stopActive('emergency')
      sfxStatus = stopped.sfxStatus
      if (!stopped.terminal) {
        return this.result('blocked-terminal-cleanup', commandId, {
          visualStatus: stopped.visualStatus,
          sfxStatus: stopped.sfxStatus,
          partialReasons: stopped.partialReasons,
        })
      }
      if (
        stopped.partialReasons.includes('visual-stop-failed') ||
        stopped.partialReasons.includes('visual-dispose-failed') ||
        stopped.partialReasons.includes('sfx-stop-failed')
      ) {
        return this.result('stop-failed', commandId, {
          visualStatus: stopped.visualStatus,
          sfxStatus: stopped.sfxStatus,
          partialReasons: stopped.partialReasons,
        })
      }
    }

    this.emergencyLatches.delete(effectId)
    return this.result('reset', commandId, {
      visualStatus: 'reset',
      sfxStatus,
    })
  }

  private async stopActive(
    mode: ProjectionEffectStopMode
  ): Promise<StopOutcome> {
    const active = this.active
    if (active) this.cancelFiniteStop(active.session)
    if (!active) {
      return {
        visualStatus: 'stopped',
        sfxStatus: null,
        partialReasons: [],
        terminal: true,
      }
    }
    if (active.terminalBlocked) {
      const [visualTerminal, sfxOutcome] = await Promise.all([
        this.terminateFreshSession(active.session),
        this.stopSfx(active.sfx, 'emergency', 0),
      ])
      const terminal = visualTerminal && sfxOutcome.terminal
      if (terminal && this.active === active) this.active = null
      return {
        visualStatus: visualTerminal ? 'disposed' : 'dispose-failed',
        sfxStatus: sfxOutcome.status,
        partialReasons: [
          ...(!visualTerminal ? (['visual-dispose-failed'] as const) : []),
          ...(sfxOutcome.status === 'stop-failed'
            ? (['sfx-stop-failed'] as const)
            : []),
        ],
        terminal,
      }
    }
    const fadeMs = mode === 'normal' ? this.normalFadeMs : 0
    const [visualSettled, sfxOutcome] = await Promise.all([
      settleWithin(
        () =>
          active.session.stop({
            mode: mode === 'normal' ? 'fade' : 'immediate',
            fadeMs,
          }),
        VISUAL_STOP_TIMEOUT_MS
      ),
      this.stopSfx(active.sfx, mode, fadeMs),
    ])
    const sfxStatus = sfxOutcome.status
    let visualStatus: ProjectionEffectRenderStatus = visualSettled.ok
      ? visualSettled.value.status
      : 'stop-failed'
    const partialReasons: ProjectionEffectPartialReason[] = []
    if (visualStatus === 'stop-failed') {
      partialReasons.push('visual-stop-failed')
    }
    if (sfxStatus === 'stop-failed') partialReasons.push('sfx-stop-failed')
    let visualTerminal = false
    const stopFailed = visualStatus === 'stop-failed'
    const disposed = await settleWithin(
      () =>
        stopFailed ? active.session.terminate() : active.session.dispose(),
      VISUAL_DISPOSE_TIMEOUT_MS
    )
    if (
      disposed.ok &&
      (disposed.value.status === 'disposed' ||
        disposed.value.status === 'ignored-disposed')
    ) {
      visualTerminal = true
    } else {
      const terminated = await settleWithin(
        () => active.session.terminate(),
        VISUAL_DISPOSE_TIMEOUT_MS
      )
      visualTerminal =
        terminated.ok &&
        (terminated.value.status === 'disposed' ||
          terminated.value.status === 'ignored-disposed')
    }
    if (!visualTerminal || (!stopFailed && !disposed.ok)) {
      visualStatus = 'dispose-failed'
      partialReasons.push('visual-dispose-failed')
    }
    const terminal = visualTerminal && sfxOutcome.terminal
    if (terminal) {
      if (this.active === active) this.active = null
    } else {
      active.terminalBlocked = true
    }
    return {
      visualStatus,
      sfxStatus,
      partialReasons,
      terminal,
    }
  }

  private async terminateFreshSession(
    session: ProjectionEffectSession
  ): Promise<boolean> {
    const terminated = await settleWithin(
      () => session.terminate(),
      VISUAL_DISPOSE_TIMEOUT_MS
    )
    return Boolean(
      terminated.ok &&
      (terminated.value.status === 'disposed' ||
        terminated.value.status === 'ignored-disposed')
    )
  }

  private async tryFinalizePendingTerminal(): Promise<boolean> {
    const pending = this.pendingTerminal
    if (!pending) return true
    const [visualTerminal, sfxOutcome] = await Promise.all([
      this.terminateFreshSession(pending.session),
      this.stopSfx(pending.sfx, 'emergency', 0),
    ])
    const terminal = visualTerminal && sfxOutcome.terminal
    if (terminal && this.pendingTerminal === pending) {
      this.pendingTerminal = null
    }
    return terminal
  }

  private async tryFinalizeQuarantinedActive(): Promise<boolean> {
    const active = this.active
    if (!active?.terminalBlocked) return true
    const [visualTerminal, sfxOutcome] = await Promise.all([
      this.terminateFreshSession(active.session),
      this.stopSfx(active.sfx, 'emergency', 0),
    ])
    const terminal = visualTerminal && sfxOutcome.terminal
    if (terminal && this.active === active) this.active = null
    return terminal
  }

  private canStartSfx(
    cue: ProjectionEffectSfxCue | null
  ): cue is ProjectionEffectSfxCue {
    return Boolean(
      cue &&
      this.sfxPlayer &&
      this.capabilities.audioOutputAvailable &&
      this.capabilities.sfxAssetsAvailable
    )
  }

  private async startSfx(
    sfx: OwnedProjectionEffectSfx
  ): Promise<SfxStartOutcome> {
    const started = await settleWithin(
      () => this.sfxPlayer?.start(sfx.cue, sfx.controller.signal),
      SFX_START_TIMEOUT_MS
    )
    if (started.ok) {
      sfx.startedConfirmed = true
      return {
        status: 'started',
        startedConfirmed: true,
        ownershipSafe: true,
      }
    }
    sfx.controller.abort()
    const cleaned = await this.terminateSfxWithin(
      sfx,
      SFX_REJECT_CLEANUP_TIMEOUT_MS
    )
    return cleaned
      ? {
          status: 'start-failed-cleaned',
          startedConfirmed: false,
          ownershipSafe: true,
        }
      : {
          status: 'start-failed-cleanup-failed',
          startedConfirmed: false,
          ownershipSafe: false,
        }
  }

  private async stopSfx(
    sfx: OwnedProjectionEffectSfx | null,
    mode: ProjectionEffectStopMode,
    fadeMs: number
  ): Promise<SfxStopOutcome> {
    if (!sfx) return { status: null, terminal: true }
    if (sfx.terminalConfirmed) {
      return { status: 'stopped', terminal: true }
    }
    sfx.controller.abort()
    let graceful = true
    if (mode === 'normal' && sfx.startedConfirmed) {
      graceful = await completesWithin(
        () => this.sfxPlayer?.fadeOut(sfx.cue, fadeMs),
        SFX_STOP_TIMEOUT_MS
      )
    }
    const terminal = await this.terminateSfxWithin(sfx, SFX_STOP_TIMEOUT_MS)
    return {
      status: graceful && terminal ? 'stopped' : 'stop-failed',
      terminal,
    }
  }

  private async terminateSfxWithin(
    sfx: OwnedProjectionEffectSfx,
    timeoutMs: number
  ): Promise<boolean> {
    if (sfx.terminalConfirmed) return true
    sfx.terminationPromise ??= Promise.resolve().then(() =>
      this.sfxPlayer?.terminate(sfx.cue)
    )
    const terminal = await completesWithin(
      () => sfx.terminationPromise as Promise<void>,
      timeoutMs
    )
    if (terminal) sfx.terminalConfirmed = true
    return terminal
  }

  private scheduleFiniteStop(
    effectId: string,
    session: ProjectionEffectSession,
    durationMs?: number
  ): void {
    this.cancelFiniteStop()
    const generation = this.lifetimeGeneration
    const lifetimeMs =
      durationMs ??
      this.effectLifetimeMs.get(effectId) ??
      this.defaultLifetimeMs
    const handle = this.scheduler.schedule(() => {
      void this.enqueue(async () => {
        const timer = this.lifetimeTimer
        if (
          !timer ||
          timer.generation !== generation ||
          timer.effectId !== effectId ||
          timer.session !== session
        ) {
          return
        }
        this.lifetimeTimer = null
        if (
          this.active?.effectId !== effectId ||
          this.active.session !== session
        ) {
          return
        }
        await this.stopActive('normal')
      })
    }, lifetimeMs)
    this.lifetimeTimer = { handle, generation, effectId, session }
  }

  private cancelFiniteStop(session?: ProjectionEffectSession): void {
    const timer = this.lifetimeTimer
    if (!timer || (session && timer.session !== session)) return
    this.lifetimeTimer = null
    this.lifetimeGeneration += 1
    this.scheduler.cancel(timer.handle)
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operationTail.then(operation)
    this.operationTail = result.then(
      () => undefined,
      () => undefined
    )
    return result
  }

  private result(
    status: ProjectionEffectHostStatus,
    commandId: string | null,
    overrides: Partial<ProjectionEffectHostResult> = {}
  ): ProjectionEffectHostResult {
    return {
      status,
      commandId,
      activeEffectId: this.activeEffectId,
      replacedEffectId: null,
      visualStatus: null,
      sfxStatus: null,
      fadeMs: 0,
      partialReasons: [],
      validationErrorCount: 0,
      ...overrides,
    }
  }
}

export function normalizeProjectionEffectQualityPolicy(
  input: Partial<ProjectionEffectQualityPolicy> = {}
): ProjectionEffectQualityPolicy {
  return {
    particleBudget: Math.round(
      clamp(finiteOr(input.particleBudget, 1800), 64, 12000)
    ),
    internalResolutionScale: clamp(
      finiteOr(input.internalResolutionScale, 0.75),
      0.25,
      1
    ),
    updateRateHz: Math.round(clamp(finiteOr(input.updateRateHz, 60), 15, 60)),
    postProcessing:
      typeof input.postProcessing === 'boolean' ? input.postProcessing : true,
  }
}

function resolveProjectionEffectParameters(
  definition: ProjectionEffectDefinition,
  input: Readonly<Record<string, unknown>>,
  quality: ProjectionEffectQualityPolicy
): Readonly<Record<string, unknown>> {
  const parameters: Record<string, unknown> = Object.create(null)
  for (const parameter of definition.parameters) {
    parameters[parameter.id] = parameter.defaultValue
  }
  for (const [parameterId, value] of Object.entries(input)) {
    parameters[parameterId] = value
  }
  assignIfDeclared(
    definition,
    parameters,
    'particleBudget',
    quality.particleBudget
  )
  assignIfDeclared(
    definition,
    parameters,
    'internalResolutionScale',
    quality.internalResolutionScale
  )
  assignIfDeclared(definition, parameters, 'updateRateHz', quality.updateRateHz)
  assignIfDeclared(
    definition,
    parameters,
    'postProcessing',
    quality.postProcessing
  )
  return Object.freeze(parameters)
}

function validateRuntimeParameterValues(
  definition: ProjectionEffectDefinition,
  parameters: Readonly<Record<string, unknown>>
): readonly string[] {
  const errors = [
    ...validateProjectionEffectParameterValues(
      definition.parameters,
      parameters
    ),
  ]
  if (
    definition.parameters.some((parameter) => parameter.id === 'seed') &&
    (typeof parameters.seed !== 'number' ||
      !Number.isInteger(parameters.seed) ||
      parameters.seed < 0 ||
      parameters.seed > 2_147_483_647)
  ) {
    errors.push('parameter.seed must be a bounded integer')
  }
  return errors
}

function validateFrameParameterOverrides(
  definition: ProjectionEffectDefinition,
  parameters: Readonly<Record<string, unknown>>
): readonly string[] {
  const definitions = new Map(
    definition.parameters.map((parameter) => [parameter.id, parameter])
  )
  for (const [parameterId, value] of Object.entries(parameters)) {
    if (parameterId === 'seed') {
      return ['parameter.seed is start-only']
    }
    const parameter = definitions.get(parameterId)
    if (!parameter) return ['parameter.undeclared is not allowed']
    if (
      parameter.kind === 'number' &&
      (typeof value !== 'number' ||
        !Number.isFinite(value) ||
        value < parameter.minimum ||
        value > parameter.maximum ||
        (parameterId === 'seed' && !Number.isInteger(value)))
    ) {
      return [`parameter.${parameterId} is out of range`]
    }
    if (parameter.kind === 'boolean' && typeof value !== 'boolean') {
      return [`parameter.${parameterId} must be boolean`]
    }
    if (
      parameter.kind === 'enum' &&
      (typeof value !== 'string' || !parameter.values.includes(value))
    ) {
      return [`parameter.${parameterId} is unsupported`]
    }
  }
  return []
}

function validateFrameParameters(
  input: unknown
):
  | { ok: true; value: ProjectionEffectFrameParameters | null }
  | { ok: false; errorCount: number } {
  if (input === undefined) return { ok: true, value: null }
  if (
    !isPlainEnumerableDataRecord(input) ||
    !hasExactEnumerableKeys(input, ['effectId', 'parameters']) ||
    typeof input.effectId !== 'string' ||
    !SAFE_ID.test(input.effectId) ||
    !isPlainEnumerableDataRecord(input.parameters)
  ) {
    return { ok: false, errorCount: 1 }
  }
  const entries = Object.entries(input.parameters)
  if (entries.length > MAX_PROJECTION_EFFECT_PARAMETERS) {
    return { ok: false, errorCount: 1 }
  }
  const snapshot: Record<string, unknown> = Object.create(null)
  for (const [parameterId, value] of entries) {
    if (
      !SAFE_ID.test(parameterId) ||
      ((typeof value !== 'number' || !Number.isFinite(value)) &&
        typeof value !== 'boolean' &&
        (typeof value !== 'string' || !SAFE_ID.test(value)))
    ) {
      return { ok: false, errorCount: 1 }
    }
    snapshot[parameterId] = value
  }
  return {
    ok: true,
    value: Object.freeze({
      effectId: input.effectId,
      parameters: Object.freeze(snapshot),
    }),
  }
}

function mergeFrameParameters(
  active: Readonly<Record<string, unknown>>,
  frame: Readonly<Record<string, unknown>> | undefined
): Readonly<Record<string, unknown>> {
  if (!frame) return active
  const merged: Record<string, unknown> = Object.create(null)
  for (const [parameterId, value] of Object.entries(active)) {
    merged[parameterId] = value
  }
  for (const [parameterId, value] of Object.entries(frame)) {
    if (!FRAME_QUALITY_PARAMETER_IDS.has(parameterId)) {
      merged[parameterId] = value
    }
  }
  return Object.freeze(merged)
}

function hasExactEnumerableKeys(
  input: Record<string, unknown>,
  expected: readonly string[]
): boolean {
  const keys = Object.keys(input)
  return (
    keys.length === expected.length &&
    expected.every((key) =>
      Object.prototype.propertyIsEnumerable.call(input, key)
    )
  )
}

function isPlainEnumerableDataRecord(
  input: unknown
): input is Record<string, unknown> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return false
  }
  try {
    const prototype = Object.getPrototypeOf(input)
    if (prototype !== Object.prototype && prototype !== null) return false
    return Reflect.ownKeys(input).every((key) => {
      if (typeof key !== 'string') return false
      const descriptor = Object.getOwnPropertyDescriptor(input, key)
      return Boolean(descriptor?.enumerable && 'value' in descriptor)
    })
  } catch {
    return false
  }
}

function assignIfDeclared(
  definition: ProjectionEffectDefinition,
  parameters: Record<string, unknown>,
  parameterId: string,
  value: unknown
): void {
  if (definition.parameters.some((parameter) => parameter.id === parameterId)) {
    parameters[parameterId] = value
  }
}

function boundedFadeMs(value: number): number {
  return Math.round(clamp(finiteOr(value, 180), 80, 600))
}

function boundedLifetimeMs(value: number): number {
  return Math.round(
    clamp(
      finiteOr(value, DEFAULT_PROJECTION_EFFECT_LIFETIME_MS),
      MIN_EFFECT_LIFETIME_MS,
      MAX_EFFECT_LIFETIME_MS
    )
  )
}

function finiteOr(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}

function monotonicNow(): number {
  return typeof performance === 'object' &&
    typeof performance.now === 'function'
    ? performance.now()
    : Date.now()
}

const DEFAULT_PROJECTION_EFFECT_SCHEDULER: ProjectionEffectHostScheduler = {
  schedule: (callback, delayMs) => {
    const handle = setTimeout(callback, delayMs)
    if (
      typeof handle === 'object' &&
      handle !== null &&
      'unref' in handle &&
      typeof handle.unref === 'function'
    ) {
      handle.unref()
    }
    return handle
  },
  cancel: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
}

function completesWithin(
  operation: () => Promise<void> | void | undefined,
  timeoutMs: number
): Promise<boolean> {
  return settleWithin(operation, timeoutMs).then((result) => result.ok)
}

function settleWithin<T>(
  operation: () => Promise<T> | T,
  timeoutMs: number
): Promise<{ ok: true; value: T } | { ok: false }> {
  return new Promise((resolve) => {
    let settled = false
    const finish = (result: { ok: true; value: T } | { ok: false }) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(result)
    }
    const timer = setTimeout(() => finish({ ok: false }), timeoutMs)
    Promise.resolve()
      .then(operation)
      .then(
        (value) => finish({ ok: true, value }),
        () => finish({ ok: false })
      )
  })
}
