import {
  readProjectionPerformancePlan,
  type ProjectionPerformancePlan,
  type ProjectionPerformancePlanPosition,
} from '../projectionPerformancePlan'

export const MAX_PROJECTION_PERFORMANCE_PLAN_LEDGER_ENTRIES = 256
export const PROJECTION_PERFORMANCE_PLAN_LEDGER_TTL_MS = 5 * 60 * 1000

export type ProjectionPerformancePlanReservationStatus =
  | 'reserved'
  | 'duplicate'
  | 'collision'
  | 'stale'
  | 'expired'
  | 'session-mismatch'
  | 'capacity'
  | 'invalid'

export type ProjectionPerformancePlanReservation = Readonly<{
  status: ProjectionPerformancePlanReservationStatus
  plan: ProjectionPerformancePlan | null
}>

export type ProjectionPerformancePlanFrame = Readonly<{
  effectId: ProjectionPerformancePlan['effectId']
  parameters: Readonly<Record<string, number>>
}>

type PlanLedgerEntry = Readonly<{
  revision: number
  fingerprint: string
  expiresAtMs: number
}>

type PlanState = Readonly<{
  position: ProjectionPerformancePlanPosition
  strength: number
}>

type ActivePlan = {
  plan: ProjectionPerformancePlan
  startedAtMs: number | null
}

export class ProjectionPerformancePlanLedger {
  private readonly entries = new Map<string, PlanLedgerEntry>()
  private sessionId: string | null = null

  reserve(
    value: unknown,
    nowMs = Date.now()
  ): ProjectionPerformancePlanReservation {
    if (!Number.isFinite(nowMs) || nowMs < 0) {
      return reservation('invalid')
    }
    const plan = readProjectionPerformancePlan(value)
    if (!plan) return reservation('invalid')

    if (this.sessionId !== null && this.sessionId !== plan.sessionId) {
      return reservation('session-mismatch')
    }
    const key = ledgerKey(plan)
    const existing = this.entries.get(key)
    if (existing && existing.expiresAtMs <= nowMs) {
      return reservation('expired')
    }
    if (existing) {
      const fingerprint = fingerprintPlan(plan)
      if (plan.revision < existing.revision) return reservation('stale')
      if (plan.revision === existing.revision) {
        return reservation(
          fingerprint === existing.fingerprint ? 'duplicate' : 'collision'
        )
      }
    }

    if (
      !existing &&
      this.entries.size >= MAX_PROJECTION_PERFORMANCE_PLAN_LEDGER_ENTRIES
    ) {
      return reservation('capacity')
    }

    this.sessionId ??= plan.sessionId
    this.entries.set(
      key,
      Object.freeze({
        revision: plan.revision,
        fingerprint: fingerprintPlan(plan),
        expiresAtMs: nowMs + PROJECTION_PERFORMANCE_PLAN_LEDGER_TTL_MS,
      })
    )
    return reservation('reserved', plan)
  }

  clear(): void {
    this.entries.clear()
    this.sessionId = null
  }
}

export class ProjectionPerformancePlanExecutor {
  private active: ActivePlan | null = null

  activate(value: unknown): ProjectionPerformancePlanFrame | null {
    if (this.active) return null
    const plan = readProjectionPerformancePlan(value)
    if (!plan) return null
    this.active = { plan, startedAtMs: null }
    return frameForState(plan.effectId, initialPlanState(plan))
  }

  anchor(nowMs: number): boolean {
    if (!this.active || !Number.isFinite(nowMs) || nowMs < 0) return false
    if (this.active.startedAtMs === null) this.active.startedAtMs = nowMs
    return true
  }

  frame(nowMs: number): ProjectionPerformancePlanFrame | null {
    if (!this.active || !Number.isFinite(nowMs) || nowMs < 0) return null
    this.active.startedAtMs ??= nowMs
    const elapsedMs = Math.max(0, nowMs - this.active.startedAtMs)
    return frameForState(
      this.active.plan.effectId,
      interpolatePlanState(this.active.plan, elapsedMs)
    )
  }

  clear(): void {
    this.active = null
  }

  get activeEffectId(): ProjectionPerformancePlan['effectId'] | null {
    return this.active?.plan.effectId ?? null
  }
}

function initialPlanState(plan: ProjectionPerformancePlan): PlanState {
  const first = plan.keyframes[0]
  return first?.atMs === 0
    ? Object.freeze({ position: first.position, strength: first.strength })
    : Object.freeze({ position: plan.position, strength: plan.strength })
}

function interpolatePlanState(
  plan: ProjectionPerformancePlan,
  elapsedMs: number
): PlanState {
  let previousAtMs = 0
  let previous = initialPlanState(plan)
  for (const keyframe of plan.keyframes) {
    if (keyframe.atMs === 0) continue
    if (elapsedMs < keyframe.atMs) {
      const span = keyframe.atMs - previousAtMs
      const progress =
        span === 0 ? 1 : clamp01((elapsedMs - previousAtMs) / span)
      return Object.freeze({
        position: Object.freeze({
          x: lerp(previous.position.x, keyframe.position.x, progress),
          y: lerp(previous.position.y, keyframe.position.y, progress),
        }),
        strength: lerp(previous.strength, keyframe.strength, progress),
      })
    }
    previousAtMs = keyframe.atMs
    previous = Object.freeze({
      position: keyframe.position,
      strength: keyframe.strength,
    })
  }
  return previous
}

function frameForState(
  effectId: ProjectionPerformancePlan['effectId'],
  state: PlanState
): ProjectionPerformancePlanFrame {
  const strength = smoothStrength(state.strength)
  const masterIntensity = round(0.35 + strength * 0.65)
  if (effectId === 'fire') {
    return Object.freeze({
      effectId,
      parameters: Object.freeze({
        emitterX: state.position.x,
        emitterY: state.position.y,
        masterIntensity,
        pointSize: round(24 + strength * 72),
      }),
    })
  }
  return Object.freeze({
    effectId,
    parameters: Object.freeze({
      centerX: state.position.x,
      centerY: state.position.y,
      masterIntensity,
      orbRadius: round(0.18 + strength * 0.42),
      lineWidth: round(2 + strength * 4),
    }),
  })
}

function smoothStrength(value: number): number {
  const bounded = clamp01(value)
  return bounded * bounded * (3 - 2 * bounded)
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function lerp(start: number, end: number, progress: number): number {
  return round(start + (end - start) * progress)
}

function round(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000
}

function ledgerKey(plan: ProjectionPerformancePlan): string {
  return `${plan.sessionId}\u0000${plan.planId}`
}

function fingerprintPlan(plan: ProjectionPerformancePlan): string {
  return JSON.stringify(plan)
}

function reservation(
  status: ProjectionPerformancePlanReservationStatus,
  plan: ProjectionPerformancePlan | null = null
): ProjectionPerformancePlanReservation {
  return Object.freeze({ status, plan })
}
