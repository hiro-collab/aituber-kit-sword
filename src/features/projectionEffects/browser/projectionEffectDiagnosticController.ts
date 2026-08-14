import {
  deliverProjectionEffectIntent,
  projectionEffectDeliverySucceeded,
  type ProjectionEffectDeliveryResult,
  type ProjectionEffectIntent,
} from '../projectionEffectIntent'
import { FIRE_EFFECT_ID } from '../plugins/fire/definition'
import { THUNDER_BALL_EFFECT_ID } from '../plugins/thunderBall/definition'

const DIAGNOSTIC_TURN_ID = 'operator_projection_effect_diagnostic_v1'
const EVENT_ID_PATTERN = /^evt_[0-9a-f]{32}$/

export type ProjectionEffectDiagnosticAction =
  | 'fire_start'
  | 'thunder_start'
  | 'stop'
  | 'reset'

export type ProjectionEffectDiagnosticResult = Readonly<{
  event_id: string | null
  status: ProjectionEffectDeliveryResult['status']
  result_class: ProjectionEffectDeliveryResult['resultClass']
}>

type ProjectionEffectDiagnosticDeliver = (
  intent: ProjectionEffectIntent
) => Promise<ProjectionEffectDeliveryResult>

type ProjectionEffectDiagnosticControllerDependencies = Readonly<{
  createEventId?: () => string
  deliver?: ProjectionEffectDiagnosticDeliver
}>

export type ProjectionEffectDiagnosticController = Readonly<{
  execute: (
    action: ProjectionEffectDiagnosticAction
  ) => Promise<ProjectionEffectDiagnosticResult>
}>

const createEventId = (): string => {
  if (!globalThis.crypto?.getRandomValues) {
    throw new Error('secure_random_unavailable')
  }
  const bytes = new Uint8Array(16)
  globalThis.crypto.getRandomValues(bytes)
  return `evt_${Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, '0')
  ).join('')}`
}

const createIntent = (
  action: ProjectionEffectDiagnosticAction,
  eventId: string
): ProjectionEffectIntent => {
  if (action === 'fire_start' || action === 'thunder_start') {
    return Object.freeze({
      schemaVersion: 1,
      eventId,
      turnId: DIAGNOSTIC_TURN_ID,
      action: 'start',
      effectId:
        action === 'fire_start' ? FIRE_EFFECT_ID : THUNDER_BALL_EFFECT_ID,
    })
  }
  return Object.freeze({
    schemaVersion: 1,
    eventId,
    turnId: DIAGNOSTIC_TURN_ID,
    action,
  })
}

const rejectedResult = (
  eventId: string | null,
  resultClass: ProjectionEffectDiagnosticResult['result_class']
): ProjectionEffectDiagnosticResult =>
  Object.freeze({
    event_id: eventId,
    status: 'rejected',
    result_class: resultClass,
  })

const projectCorrelatedResult = (
  intent: ProjectionEffectIntent,
  delivery: ProjectionEffectDeliveryResult
): ProjectionEffectDiagnosticResult => {
  if (
    delivery.eventId !== intent.eventId ||
    (delivery.status === 'completed' &&
      !projectionEffectDeliverySucceeded(intent, delivery))
  ) {
    return rejectedResult(intent.eventId, 'delivery_unconfirmed')
  }
  return Object.freeze({
    event_id: intent.eventId,
    status: delivery.status,
    result_class: delivery.resultClass,
  })
}

export const createProjectionEffectDiagnosticController = (
  dependencies: ProjectionEffectDiagnosticControllerDependencies = {}
): ProjectionEffectDiagnosticController => {
  const nextEventId = dependencies.createEventId ?? createEventId
  const deliver =
    dependencies.deliver ??
    ((intent: ProjectionEffectIntent) => deliverProjectionEffectIntent(intent))
  let requestInFlight = false

  return Object.freeze({
    execute: async (
      action: ProjectionEffectDiagnosticAction
    ): Promise<ProjectionEffectDiagnosticResult> => {
      if (requestInFlight) {
        return rejectedResult(null, 'delivery_unconfirmed')
      }
      requestInFlight = true
      let eventId: string | null = null
      try {
        eventId = nextEventId()
        if (!EVENT_ID_PATTERN.test(eventId)) {
          return rejectedResult(null, 'intent_invalid')
        }
        const intent = createIntent(action, eventId)
        const delivery = await deliver(intent)
        return projectCorrelatedResult(intent, delivery)
      } catch {
        return rejectedResult(eventId, 'delivery_unconfirmed')
      } finally {
        requestInFlight = false
      }
    },
  })
}
