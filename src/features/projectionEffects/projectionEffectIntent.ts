import {
  CONTROL_PROJECTION_PERFORMANCE_PLAN_SCHEMA_SHA256,
  readProjectionPerformancePlan,
  type ProjectionPerformancePlan,
} from './projectionPerformancePlan'

export const PROJECTION_EFFECT_INTENT_UPSTREAM_EVENT =
  'projection.effect.requested'
export const PROJECTION_EFFECT_INTENT_LEGACY_EVENT = 'projection_effect.intent'
export const PROJECTION_EFFECT_INTENT_PRESENTATION_EVENT =
  'accepted.presentation.projection_effect_intent'
export const PROJECTION_EFFECT_INTENT_WINDOW_EVENT =
  'sword:projection-effect-intent-v1'
export const PROJECTION_EFFECT_RECEIPT_WINDOW_EVENT =
  'sword:projection-effect-receipt-v1'
export const PROJECTION_EFFECT_INTENT_CHANNEL =
  'sword.projection-effect-intent.v1'

const THOUGHT_EVENT_SCHEMA_VERSION = 'thought-core.event.v0'
const THOUGHT_EVENT_SOURCE = 'thought-core'
const CORE_EVENT_ID = /^evt_[0-9a-f]{32}$/
const SAFE_TURN_OR_SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
const MAX_SEEN_INTENTS = 256
const SEEN_INTENT_TTL_MS = 5 * 60 * 1000

export type ProjectionEffectStartIntent = Readonly<{
  schemaVersion: 1
  eventId: string
  turnId: string
  action: 'start'
  effectId: 'fire' | 'thunderBall'
}>

export type ProjectionEffectTerminalIntent = Readonly<{
  schemaVersion: 1
  eventId: string
  turnId: string
  action: 'stop' | 'reset'
}>

export type ProjectionEffectPlannedStartIntent = Readonly<{
  schemaVersion: 2
  eventId: string
  turnId: string
  action: 'start'
  plan: ProjectionPerformancePlan
}>

export type ProjectionEffectIntent =
  | ProjectionEffectStartIntent
  | ProjectionEffectTerminalIntent
  | ProjectionEffectPlannedStartIntent

export type ProjectionEffectExecutionReceipt = Readonly<{
  schemaVersion: 1
  eventId: string
  status: 'completed' | 'rejected' | 'cleanup_unproved'
  resultClass:
    | 'started'
    | 'stopped'
    | 'reset'
    | 'host_rejected'
    | 'host_unavailable'
    | 'queue_capacity_exceeded'
    | 'cleanup_unproved'
    | 'cleanup_unproved_sticky'
}>

export type ProjectionEffectPublicationReceipt = Readonly<{
  schemaVersion: 1
  eventId: string | null
  status: 'published' | 'rejected'
  resultClass: 'published' | 'intent_invalid' | 'transport_unavailable'
}>

type BroadcastChannelLike = {
  postMessage(value: unknown): void
  addEventListener(
    type: 'message',
    listener: (event: MessageEvent) => void
  ): void
  removeEventListener(
    type: 'message',
    listener: (event: MessageEvent) => void
  ): void
  close(): void
}

export type ProjectionEffectIntentTransportOptions = Readonly<{
  now?: () => number
  createBroadcastChannel?: (name: string) => BroadcastChannelLike
}>

export type ProjectionEffectRequestedEventContext = Readonly<{
  expectedTurnId: string
  expectedSessionId: string
  expectedPerformancePlanSchemaSha256?: string
}>

type ProjectionEffectIntentEnvelope = Readonly<{
  schemaVersion: 1
  kind: 'intent'
  origin: string
  intent: ProjectionEffectIntent
}>

type ProjectionEffectReceiptEnvelope = Readonly<{
  schemaVersion: 1
  kind: 'receipt'
  origin: string
  receipt: ProjectionEffectExecutionReceipt
}>

export function readProjectionEffectRequestedEvent(
  value: unknown,
  context: ProjectionEffectRequestedEventContext
): ProjectionEffectIntent | null {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      'schema_version',
      'event_id',
      'turn_id',
      'session_id',
      'seq',
      'timestamp',
      'source',
      'type',
      'data',
    ]) ||
    value.schema_version !== THOUGHT_EVENT_SCHEMA_VERSION ||
    value.type !== PROJECTION_EFFECT_INTENT_UPSTREAM_EVENT ||
    value.source !== THOUGHT_EVENT_SOURCE ||
    typeof value.event_id !== 'string' ||
    !CORE_EVENT_ID.test(value.event_id) ||
    typeof value.turn_id !== 'string' ||
    !SAFE_TURN_OR_SESSION_ID.test(value.turn_id) ||
    value.turn_id !== context.expectedTurnId ||
    typeof value.session_id !== 'string' ||
    !SAFE_TURN_OR_SESSION_ID.test(value.session_id) ||
    value.session_id !== context.expectedSessionId ||
    !Number.isInteger(value.seq) ||
    (value.seq as number) < 1 ||
    typeof value.timestamp !== 'string' ||
    value.timestamp.length < 20 ||
    value.timestamp.length > 40
  ) {
    return null
  }
  return projectCanonicalIntent(
    value.data,
    value.event_id,
    value.turn_id,
    value.session_id,
    context.expectedPerformancePlanSchemaSha256
  )
}

export function readProjectionEffectIntent(
  value: unknown
): ProjectionEffectIntent | null {
  if (!isRecord(value)) return null
  const action = value.action
  const eventId = value.eventId
  const turnId = value.turnId
  if (
    typeof eventId !== 'string' ||
    !CORE_EVENT_ID.test(eventId) ||
    typeof turnId !== 'string' ||
    !SAFE_TURN_OR_SESSION_ID.test(turnId)
  ) {
    return null
  }
  if (value.schemaVersion === 1 && action === 'start') {
    if (
      !hasExactKeys(value, [
        'schemaVersion',
        'eventId',
        'turnId',
        'action',
        'effectId',
      ]) ||
      (value.effectId !== 'fire' && value.effectId !== 'thunderBall')
    ) {
      return null
    }
    return Object.freeze({
      schemaVersion: 1,
      eventId,
      turnId,
      action,
      effectId: value.effectId,
    })
  }
  if (value.schemaVersion === 1 && (action === 'stop' || action === 'reset')) {
    if (
      !hasExactKeys(value, ['schemaVersion', 'eventId', 'turnId', 'action'])
    ) {
      return null
    }
    return Object.freeze({ schemaVersion: 1, eventId, turnId, action })
  }
  if (
    value.schemaVersion === 2 &&
    action === 'start' &&
    hasExactKeys(value, [
      'schemaVersion',
      'eventId',
      'turnId',
      'action',
      'plan',
    ])
  ) {
    const plan = readProjectionPerformancePlan(value.plan)
    if (!plan) return null
    return Object.freeze({
      schemaVersion: 2,
      eventId,
      turnId,
      action: 'start',
      plan,
    })
  }
  return null
}

export function publishProjectionEffectIntent(
  value: unknown,
  options: ProjectionEffectIntentTransportOptions = {}
): ProjectionEffectPublicationReceipt {
  const intent = readProjectionEffectIntent(value)
  if (!intent) {
    return Object.freeze({
      schemaVersion: 1,
      eventId: null,
      status: 'rejected',
      resultClass: 'intent_invalid',
    })
  }
  const pageWindow = currentWindow()
  if (!pageWindow) {
    return Object.freeze({
      schemaVersion: 1,
      eventId: intent.eventId,
      status: 'rejected',
      resultClass: 'transport_unavailable',
    })
  }
  pageWindow.dispatchEvent(
    new CustomEvent(PROJECTION_EFFECT_INTENT_WINDOW_EVENT, { detail: intent })
  )
  const channel = createChannel(options)
  if (channel) {
    const envelope: ProjectionEffectIntentEnvelope = Object.freeze({
      schemaVersion: 1,
      kind: 'intent',
      origin: pageWindow.location.origin,
      intent,
    })
    channel.postMessage(envelope)
    channel.close()
  }
  return Object.freeze({
    schemaVersion: 1,
    eventId: intent.eventId,
    status: 'published',
    resultClass: 'published',
  })
}

export function publishProjectionEffectExecutionReceipt(
  value: ProjectionEffectExecutionReceipt,
  options: ProjectionEffectIntentTransportOptions = {}
): boolean {
  const receipt = readProjectionEffectExecutionReceipt(value)
  const pageWindow = currentWindow()
  if (!receipt || !pageWindow) return false
  pageWindow.dispatchEvent(
    new CustomEvent(PROJECTION_EFFECT_RECEIPT_WINDOW_EVENT, { detail: receipt })
  )
  const channel = createChannel(options)
  if (channel) {
    const envelope: ProjectionEffectReceiptEnvelope = Object.freeze({
      schemaVersion: 1,
      kind: 'receipt',
      origin: pageWindow.location.origin,
      receipt,
    })
    channel.postMessage(envelope)
    channel.close()
  }
  return true
}

export function subscribeProjectionEffectIntents(
  receive: (intent: ProjectionEffectIntent) => void,
  options: ProjectionEffectIntentTransportOptions = {}
): () => void {
  const pageWindow = currentWindow()
  if (!pageWindow) return () => undefined
  const now = options.now ?? Date.now
  const seen = new Map<string, { fingerprint: string; seenAt: number }>()
  let disposed = false
  const accept = (value: unknown) => {
    if (disposed) return
    const intent = readProjectionEffectIntent(value)
    if (!intent) return
    const timestamp = now()
    for (const [id, entry] of seen) {
      if (timestamp - entry.seenAt > SEEN_INTENT_TTL_MS) seen.delete(id)
    }
    const fingerprint = fingerprintIntent(intent)
    const previous = seen.get(intent.eventId)
    if (previous) {
      // Same event is delivered by both transports. A changed payload under the
      // same authoritative event ID is a collision and is also rejected.
      return
    }
    // Never evict a live reservation: that would make a still-live event ID
    // replayable before its authoritative TTL expires.
    if (seen.size >= MAX_SEEN_INTENTS) return
    seen.set(intent.eventId, { fingerprint, seenAt: timestamp })
    receive(intent)
  }
  const receiveWindow = (event: Event) => {
    if (event instanceof CustomEvent) accept(event.detail)
  }
  const receiveChannel = (event: MessageEvent) => {
    const envelope = readIntentEnvelope(event.data, pageWindow.location.origin)
    if (envelope) accept(envelope.intent)
  }
  const channel = createChannel(options)
  pageWindow.addEventListener(
    PROJECTION_EFFECT_INTENT_WINDOW_EVENT,
    receiveWindow
  )
  channel?.addEventListener('message', receiveChannel)
  return () => {
    if (disposed) return
    disposed = true
    pageWindow.removeEventListener(
      PROJECTION_EFFECT_INTENT_WINDOW_EVENT,
      receiveWindow
    )
    channel?.removeEventListener('message', receiveChannel)
    channel?.close()
    seen.clear()
  }
}

function projectCanonicalIntent(
  value: unknown,
  eventId: string,
  turnId: string,
  sessionId: string,
  expectedPerformancePlanSchemaSha256?: string
): ProjectionEffectIntent | null {
  if (!isRecord(value)) return null
  if (value.schemaVersion === 1 && value.action === 'start') {
    if (
      !hasExactKeys(value, ['schemaVersion', 'action', 'effectId']) ||
      (value.effectId !== 'fire' && value.effectId !== 'thunderBall')
    ) {
      return null
    }
    return Object.freeze({
      schemaVersion: 1,
      eventId,
      turnId,
      action: 'start',
      effectId: value.effectId,
    })
  }
  if (
    value.schemaVersion === 1 &&
    (value.action === 'stop' || value.action === 'reset')
  ) {
    if (!hasExactKeys(value, ['schemaVersion', 'action'])) return null
    return Object.freeze({
      schemaVersion: 1,
      eventId,
      turnId,
      action: value.action,
    })
  }
  if (
    value.schemaVersion === 2 &&
    value.action === 'start' &&
    hasExactKeys(value, ['schemaVersion', 'action', 'plan'])
  ) {
    const plan = readProjectionPerformancePlan(value.plan, {
      expectedSchemaSha256: expectedPerformancePlanSchemaSha256,
    })
    if (
      !plan ||
      expectedPerformancePlanSchemaSha256 !==
        CONTROL_PROJECTION_PERFORMANCE_PLAN_SCHEMA_SHA256 ||
      plan.sessionId !== sessionId
    ) {
      return null
    }
    return Object.freeze({
      schemaVersion: 2,
      eventId,
      turnId,
      action: 'start',
      plan,
    })
  }
  return null
}

function readProjectionEffectExecutionReceipt(
  value: unknown
): ProjectionEffectExecutionReceipt | null {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      'schemaVersion',
      'eventId',
      'status',
      'resultClass',
    ]) ||
    value.schemaVersion !== 1 ||
    typeof value.eventId !== 'string' ||
    !CORE_EVENT_ID.test(value.eventId) ||
    (value.status !== 'completed' &&
      value.status !== 'rejected' &&
      value.status !== 'cleanup_unproved') ||
    (value.resultClass !== 'started' &&
      value.resultClass !== 'stopped' &&
      value.resultClass !== 'reset' &&
      value.resultClass !== 'host_rejected' &&
      value.resultClass !== 'host_unavailable' &&
      value.resultClass !== 'queue_capacity_exceeded' &&
      value.resultClass !== 'cleanup_unproved' &&
      value.resultClass !== 'cleanup_unproved_sticky')
  ) {
    return null
  }
  return Object.freeze({
    schemaVersion: 1,
    eventId: value.eventId,
    status: value.status,
    resultClass: value.resultClass,
  })
}

function readIntentEnvelope(
  value: unknown,
  expectedOrigin: string
): ProjectionEffectIntentEnvelope | null {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ['schemaVersion', 'kind', 'origin', 'intent']) ||
    value.schemaVersion !== 1 ||
    value.kind !== 'intent' ||
    value.origin !== expectedOrigin
  ) {
    return null
  }
  const intent = readProjectionEffectIntent(value.intent)
  return intent
    ? Object.freeze({
        schemaVersion: 1,
        kind: 'intent',
        origin: expectedOrigin,
        intent,
      })
    : null
}

function fingerprintIntent(intent: ProjectionEffectIntent): string {
  if (intent.schemaVersion === 2) {
    return `${intent.turnId}\u0000${intent.action}\u0000${JSON.stringify(
      intent.plan
    )}`
  }
  return intent.action === 'start'
    ? `${intent.turnId}\u0000${intent.action}\u0000${intent.effectId}`
    : `${intent.turnId}\u0000${intent.action}`
}

function createChannel(
  options: ProjectionEffectIntentTransportOptions
): BroadcastChannelLike | null {
  if (options.createBroadcastChannel) {
    return options.createBroadcastChannel(PROJECTION_EFFECT_INTENT_CHANNEL)
  }
  if (typeof globalThis.BroadcastChannel === 'undefined') return null
  return new globalThis.BroadcastChannel(PROJECTION_EFFECT_INTENT_CHANNEL)
}

function currentWindow(): Window | null {
  return typeof globalThis.window === 'undefined' ? null : globalThis.window
}

function hasExactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false
  }
  try {
    const prototype = Object.getPrototypeOf(value)
    return prototype === Object.prototype || prototype === null
  } catch {
    return false
  }
}
