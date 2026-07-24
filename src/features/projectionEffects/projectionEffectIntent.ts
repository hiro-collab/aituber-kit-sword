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
const DELIVERY_PROBE_TIMEOUT_MS = 250
const DELIVERY_INGRESS_TIMEOUT_MS = 250
const DELIVERY_EXECUTION_TIMEOUT_MS = 1_500
const MAX_DELIVERY_ATTEMPTS = 2
const MAX_DELIVERY_INBOX = 16

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

export type ProjectionEffectDeliveryResult =
  | ProjectionEffectExecutionReceipt
  | Readonly<{
      schemaVersion: 1
      eventId: string | null
      status: 'rejected'
      resultClass:
        | 'intent_invalid'
        | 'transport_unavailable'
        | 'receiver_unavailable'
        | 'delivery_unconfirmed'
        | 'delivery_aborted'
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
  signal?: AbortSignal
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

type ProjectionEffectProbeEnvelope = Readonly<{
  schemaVersion: 1
  kind: 'probe'
  origin: string
  eventId: string
}>

type ProjectionEffectReadyEnvelope = Readonly<{
  schemaVersion: 1
  kind: 'ready'
  origin: string
  eventId: string
}>

type ProjectionEffectIngressAckEnvelope = Readonly<{
  schemaVersion: 1
  kind: 'intent_ack'
  origin: string
  eventId: string
  fingerprint: string
}>

type ProjectionEffectDeliveryMessage =
  | ProjectionEffectReadyEnvelope
  | ProjectionEffectIngressAckEnvelope
  | ProjectionEffectReceiptEnvelope

type ActiveProjectionEffectReceiver = Readonly<{
  token: symbol
  publishReceipt: (receipt: ProjectionEffectExecutionReceipt) => boolean
}>

let activeProjectionEffectReceiver: ActiveProjectionEffectReceiver | null = null

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

export async function deliverProjectionEffectIntent(
  value: unknown,
  options: ProjectionEffectIntentTransportOptions = {}
): Promise<ProjectionEffectDeliveryResult> {
  const intent = readProjectionEffectIntent(value)
  if (!intent) return deliveryFailure(null, 'intent_invalid')
  const pageWindow = currentWindow()
  if (!pageWindow) {
    return deliveryFailure(intent.eventId, 'transport_unavailable')
  }
  let channel: BroadcastChannelLike | null = null
  try {
    channel = createChannel(options)
  } catch {
    return deliveryFailure(intent.eventId, 'transport_unavailable')
  }
  if (!channel) {
    return deliveryFailure(intent.eventId, 'transport_unavailable')
  }
  const deliveryChannel = channel

  const origin = pageWindow.location.origin
  const fingerprint = fingerprintIntent(intent)
  const inbox: ProjectionEffectDeliveryMessage[] = []
  let disposed = false
  let aborted = false
  let wake: (() => void) | null = null
  let channelListenerRegistrationAttempted = false
  let abortListenerRegistrationAttempted = false
  let teardownUnproved = false
  const receiveChannel = (event: MessageEvent) => {
    if (disposed) return
    const message = readDeliveryMessage(event.data, origin, intent.eventId)
    if (!message || inbox.length >= MAX_DELIVERY_INBOX) return
    inbox.push(message)
    wake?.()
  }
  const abort = () => {
    aborted = true
    wake?.()
  }

  const waitFor = async (
    predicate: (message: ProjectionEffectDeliveryMessage) => boolean,
    timeoutMs: number
  ): Promise<ProjectionEffectDeliveryMessage | null> => {
    const take = () => {
      const index = inbox.findIndex(predicate)
      return index < 0 ? null : (inbox.splice(index, 1)[0] ?? null)
    }
    const existing = take()
    if (existing || aborted) return existing
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, timeoutMs)
      wake = () => {
        clearTimeout(timer)
        resolve()
      }
    })
    wake = null
    return take()
  }

  const execute = async (): Promise<ProjectionEffectDeliveryResult> => {
    if (options.signal?.aborted) {
      aborted = true
      return deliveryFailure(intent.eventId, 'delivery_aborted')
    }
    try {
      let ready = false
      const probe: ProjectionEffectProbeEnvelope = Object.freeze({
        schemaVersion: 1,
        kind: 'probe',
        origin,
        eventId: intent.eventId,
      })
      for (
        let attempt = 0;
        attempt < MAX_DELIVERY_ATTEMPTS && !ready && !aborted;
        attempt += 1
      ) {
        deliveryChannel.postMessage(probe)
        ready = Boolean(
          await waitFor(
            (message) =>
              message.kind === 'ready' && message.eventId === intent.eventId,
            DELIVERY_PROBE_TIMEOUT_MS
          )
        )
      }
      if (aborted) return deliveryFailure(intent.eventId, 'delivery_aborted')
      if (!ready) {
        return deliveryFailure(intent.eventId, 'receiver_unavailable')
      }

      const envelope: ProjectionEffectIntentEnvelope = Object.freeze({
        schemaVersion: 1,
        kind: 'intent',
        origin,
        intent,
      })
      let ingressConfirmed = false
      for (
        let attempt = 0;
        attempt < MAX_DELIVERY_ATTEMPTS && !ingressConfirmed && !aborted;
        attempt += 1
      ) {
        if (attempt === 0) {
          pageWindow.dispatchEvent(
            new CustomEvent(PROJECTION_EFFECT_INTENT_WINDOW_EVENT, {
              detail: intent,
            })
          )
        }
        deliveryChannel.postMessage(envelope)
        ingressConfirmed = Boolean(
          await waitFor(
            (message) =>
              message.kind === 'intent_ack' &&
              message.eventId === intent.eventId &&
              message.fingerprint === fingerprint,
            DELIVERY_INGRESS_TIMEOUT_MS
          )
        )
      }
      if (aborted) return deliveryFailure(intent.eventId, 'delivery_aborted')
      if (!ingressConfirmed) {
        return deliveryFailure(intent.eventId, 'delivery_unconfirmed')
      }

      const execution = await waitFor(
        (message) =>
          message.kind === 'receipt' &&
          message.receipt.eventId === intent.eventId,
        DELIVERY_EXECUTION_TIMEOUT_MS
      )
      if (aborted) return deliveryFailure(intent.eventId, 'delivery_aborted')
      return execution?.kind === 'receipt'
        ? execution.receipt
        : deliveryFailure(intent.eventId, 'delivery_unconfirmed')
    } catch {
      return deliveryFailure(
        intent.eventId,
        aborted ? 'delivery_aborted' : 'delivery_unconfirmed'
      )
    }
  }

  let result: ProjectionEffectDeliveryResult = deliveryFailure(
    intent.eventId,
    'delivery_unconfirmed'
  )
  try {
    channelListenerRegistrationAttempted = true
    channel.addEventListener('message', receiveChannel)
    abortListenerRegistrationAttempted = Boolean(options.signal)
    options.signal?.addEventListener('abort', abort, { once: true })
    result = await execute()
  } catch {
    result = deliveryFailure(intent.eventId, 'delivery_unconfirmed')
  } finally {
    disposed = true
    wake = null
    if (abortListenerRegistrationAttempted) {
      try {
        options.signal?.removeEventListener('abort', abort)
      } catch {
        teardownUnproved = true
      }
    }
    if (channelListenerRegistrationAttempted) {
      try {
        channel.removeEventListener('message', receiveChannel)
      } catch {
        teardownUnproved = true
      }
    }
    try {
      channel.close()
    } catch {
      teardownUnproved = true
    }
    inbox.length = 0
  }
  return teardownUnproved
    ? deliveryFailure(intent.eventId, 'delivery_unconfirmed')
    : result
}

export function publishProjectionEffectExecutionReceipt(
  value: ProjectionEffectExecutionReceipt,
  options: ProjectionEffectIntentTransportOptions = {}
): boolean {
  const receipt = readProjectionEffectExecutionReceipt(value)
  const pageWindow = currentWindow()
  const receiver = activeProjectionEffectReceiver
  void options
  if (!receipt || !pageWindow || !receiver) return false
  try {
    return receiver.publishReceipt(receipt)
  } catch {
    return false
  }
}

export function subscribeProjectionEffectIntents(
  receive: (intent: ProjectionEffectIntent) => void,
  options: ProjectionEffectIntentTransportOptions = {}
): () => void {
  const pageWindow = currentWindow()
  if (!pageWindow) return () => undefined
  if (activeProjectionEffectReceiver) return () => undefined
  const receiverToken = Symbol('projection-effect-receiver')
  activeProjectionEffectReceiver = Object.freeze({
    token: receiverToken,
    publishReceipt: () => false,
  })
  const now = options.now ?? Date.now
  const seen = new Map<string, { fingerprint: string; seenAt: number }>()
  let disposed = false
  let channel: BroadcastChannelLike | null = null
  let windowListenerRegistrationAttempted = false
  let channelListenerRegistrationAttempted = false
  let cleanupAttempted = false
  let receiveWindow: (event: Event) => void
  let receiveChannel: (event: MessageEvent) => void

  const cleanup = () => {
    if (cleanupAttempted) return
    cleanupAttempted = true
    disposed = true
    if (activeProjectionEffectReceiver?.token === receiverToken) {
      activeProjectionEffectReceiver = null
    }
    if (windowListenerRegistrationAttempted) {
      try {
        pageWindow.removeEventListener(
          PROJECTION_EFFECT_INTENT_WINDOW_EVENT,
          receiveWindow
        )
      } catch {
        // A disposed handler is inert even if the platform cannot remove it.
      }
    }
    if (channelListenerRegistrationAttempted && channel) {
      try {
        channel.removeEventListener('message', receiveChannel)
      } catch {
        // Remaining channel handlers are guarded by disposed.
      }
    }
    if (channel) {
      try {
        channel.close()
      } catch {
        // Teardown never exposes native or private platform details.
      }
    }
    channel = null
    seen.clear()
  }

  const publishReceipt = (
    receipt: ProjectionEffectExecutionReceipt
  ): boolean => {
    if (
      disposed ||
      cleanupAttempted ||
      activeProjectionEffectReceiver?.token !== receiverToken
    ) {
      return false
    }
    const envelope: ProjectionEffectReceiptEnvelope = Object.freeze({
      schemaVersion: 1,
      kind: 'receipt',
      origin: pageWindow.location.origin,
      receipt,
    })
    let peerPublished = false
    if (channel) {
      try {
        channel.postMessage(envelope)
        peerPublished = true
      } catch {
        cleanup()
        return false
      }
    }
    try {
      pageWindow.dispatchEvent(
        new CustomEvent(PROJECTION_EFFECT_RECEIPT_WINDOW_EVENT, {
          detail: receipt,
        })
      )
    } catch {
      if (!peerPublished) {
        cleanup()
        return false
      }
      // The receiver-owned peer receipt is already valid and authoritative.
    }
    return true
  }

  const acknowledge = (
    intent: ProjectionEffectIntent,
    fingerprint: string
  ): boolean => {
    if (disposed || !channel) return false
    const envelope: ProjectionEffectIngressAckEnvelope = Object.freeze({
      schemaVersion: 1,
      kind: 'intent_ack',
      origin: pageWindow.location.origin,
      eventId: intent.eventId,
      fingerprint,
    })
    try {
      channel.postMessage(envelope)
      return true
    } catch {
      cleanup()
      return false
    }
  }
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
      if (previous.fingerprint === fingerprint && channel) {
        acknowledge(intent, fingerprint)
      }
      return
    }
    // Never evict a live reservation: that would make a still-live event ID
    // replayable before its authoritative TTL expires.
    if (seen.size >= MAX_SEEN_INTENTS) return
    seen.set(intent.eventId, { fingerprint, seenAt: timestamp })
    const requiresAcknowledgement = channel !== null
    if (requiresAcknowledgement && !acknowledge(intent, fingerprint)) {
      seen.delete(intent.eventId)
      return
    }
    if (disposed) return
    receive(intent)
  }
  receiveWindow = (event: Event) => {
    if (disposed) return
    if (event instanceof CustomEvent) accept(event.detail)
  }
  receiveChannel = (event: MessageEvent) => {
    if (disposed) return
    const probe = readProbeEnvelope(event.data, pageWindow.location.origin)
    if (probe && channel) {
      try {
        channel.postMessage(
          Object.freeze({
            schemaVersion: 1,
            kind: 'ready',
            origin: pageWindow.location.origin,
            eventId: probe.eventId,
          }) satisfies ProjectionEffectReadyEnvelope
        )
      } catch {
        cleanup()
      }
      return
    }
    const envelope = readIntentEnvelope(event.data, pageWindow.location.origin)
    if (envelope) accept(envelope.intent)
  }
  try {
    channel = createChannel(options)
    windowListenerRegistrationAttempted = true
    pageWindow.addEventListener(
      PROJECTION_EFFECT_INTENT_WINDOW_EVENT,
      receiveWindow
    )
    if (channel) {
      channelListenerRegistrationAttempted = true
      channel.addEventListener('message', receiveChannel)
    }
    if (!disposed) {
      activeProjectionEffectReceiver = Object.freeze({
        token: receiverToken,
        publishReceipt,
      })
    }
  } catch {
    cleanup()
  }
  return cleanup
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

function readProbeEnvelope(
  value: unknown,
  expectedOrigin: string
): ProjectionEffectProbeEnvelope | null {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ['schemaVersion', 'kind', 'origin', 'eventId']) ||
    value.schemaVersion !== 1 ||
    value.kind !== 'probe' ||
    value.origin !== expectedOrigin ||
    typeof value.eventId !== 'string' ||
    !CORE_EVENT_ID.test(value.eventId)
  ) {
    return null
  }
  return Object.freeze({
    schemaVersion: 1,
    kind: 'probe',
    origin: expectedOrigin,
    eventId: value.eventId,
  })
}

function readDeliveryMessage(
  value: unknown,
  expectedOrigin: string,
  expectedEventId: string
): ProjectionEffectDeliveryMessage | null {
  if (!isRecord(value) || value.origin !== expectedOrigin) return null
  if (
    value.kind === 'ready' &&
    hasExactKeys(value, ['schemaVersion', 'kind', 'origin', 'eventId']) &&
    value.schemaVersion === 1 &&
    value.eventId === expectedEventId
  ) {
    return Object.freeze({
      schemaVersion: 1,
      kind: 'ready',
      origin: expectedOrigin,
      eventId: expectedEventId,
    })
  }
  if (
    value.kind === 'intent_ack' &&
    hasExactKeys(value, [
      'schemaVersion',
      'kind',
      'origin',
      'eventId',
      'fingerprint',
    ]) &&
    value.schemaVersion === 1 &&
    value.eventId === expectedEventId &&
    typeof value.fingerprint === 'string'
  ) {
    return Object.freeze({
      schemaVersion: 1,
      kind: 'intent_ack',
      origin: expectedOrigin,
      eventId: expectedEventId,
      fingerprint: value.fingerprint,
    })
  }
  if (
    value.kind === 'receipt' &&
    hasExactKeys(value, ['schemaVersion', 'kind', 'origin', 'receipt']) &&
    value.schemaVersion === 1
  ) {
    const receipt = readProjectionEffectExecutionReceipt(value.receipt)
    if (!receipt || receipt.eventId !== expectedEventId) return null
    return Object.freeze({
      schemaVersion: 1,
      kind: 'receipt',
      origin: expectedOrigin,
      receipt,
    })
  }
  return null
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

function deliveryFailure(
  eventId: string | null,
  resultClass:
    | 'intent_invalid'
    | 'transport_unavailable'
    | 'receiver_unavailable'
    | 'delivery_unconfirmed'
    | 'delivery_aborted'
): ProjectionEffectDeliveryResult {
  return Object.freeze({
    schemaVersion: 1,
    eventId,
    status: 'rejected',
    resultClass,
  })
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
