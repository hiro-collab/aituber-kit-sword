import settingsStore from '@/features/stores/settings'
import { Message } from '../messages/messages'
import i18next from 'i18next'
import toastStore from '@/features/stores/toast'
import { MOTION_STIMULUS_RECEIVER_EVENT } from '@/features/motionRuntime/motionStimulusReceiver'

type ThoughtCoreErrorCause = {
  errorCode?: string
  detail?: string
}

type JsonRecord = Record<string, unknown>

const THOUGHT_CORE_MOTION_REQUEST_EVENT = 'motion.requested'
const MOTION_STIMULUS_SCHEMA_VERSION = 'motion_stimulus.v0'
const DANCE_SEQUENCE_KIND = 'dance_sequence'
const DANCE_SEQUENCE_REQUEST_MODE = 'play'
const DANCE_SEQUENCE_PAYLOAD_REF = 'motion.thought_core.dance_sequence.v0'
const MOTION_STOP_KIND = 'stop'
const MOTION_STOP_REQUEST_MODE = 'stop'
const MOTION_STOP_PAYLOAD_REF = 'motion.thought_core.stop.v0'
const MOTION_STOP_INTERRUPT_POLICY = 'stop'
const MOTION_STOP_FALLBACK_STATE = 'stop_to_idle'
const MOTION_STOP_REASONS = new Set([
  'user_requested',
  'task_interrupted',
  'timeout_elapsed',
])
const EXPRESSION_VISIBLE_KIND = 'expression'
const EXPRESSION_VISIBLE_REQUEST_MODE = 'apply'
const EXPRESSION_VISIBLE_PAYLOAD_REF =
  'motion.thought_core.expression_visible.v0'
const EXPRESSION_VISIBLE_PROFILE_REF =
  'motion.runtime.vrm_expression_weights.v0'
const EXPRESSION_VISIBLE_CHANGE = 'face_expression'
const EXPRESSION_VISIBLE_ROI = 'avatar_face_head'
const EXPRESSION_VISIBLE_TRACK_SCOPE = 'face_head'
const EXPRESSION_VISIBLE_TRACK_CHANNEL = 'expression_weight'
const VRM_TARGET_MODEL_TYPE = 'vrm'
const SAFE_MOTION_IDENTIFIER = /^[a-zA-Z0-9._:-]{1,128}$/
const UNSAFE_MOTION_FIELD_NAMES = new Set([
  'action',
  'action_id',
  'action_type',
  'appliance',
  'appliance_id',
  'entity_id',
  'ha_entity_id',
  'raw_prompt',
  'prompt',
  'provider_payload',
  'provider_response',
  'raw_transcript',
  'transcript',
  'raw_media',
  'audio',
  'video',
  'screenshot',
  'local_path',
  'private_path',
  'absolute_path',
  'device_route',
  'ha_route',
  'target',
  'url',
])
const HOME_CONTROL_MOTION_MARKER_NAMES = new Set([
  'contains_home_control_route',
  'home_action',
  'home_control',
  'home_control_route',
  'is_home_action',
])
const SENSITIVE_MOTION_FIELD_PATTERN =
  /(?:authorization|credential|password|secret|token|api[_-]?key|confirmation)/i
const UNSAFE_MOTION_STRING_PATTERN =
  /(?:https?:\/\/|file:\/\/|[a-zA-Z]:[\\/]|\\\\)/
const UNSAFE_CORRELATION_ID_PATTERN =
  /(?:raw|private|provider|device|entity|ha_entity|home_control|home|appliance|media|audio|video|transcript|prompt|token|secret|credential|password|authorization|api[_-]?key)/i

function getThoughtCoreErrorCause(error: unknown): ThoughtCoreErrorCause {
  if (!error || typeof error !== 'object' || !('cause' in error)) {
    return {}
  }
  return ((error as { cause?: ThoughtCoreErrorCause }).cause ??
    {}) as ThoughtCoreErrorCause
}

function handleApiError(errorCode: string): string {
  const languageCode = settingsStore.getState().selectLanguage
  i18next.changeLanguage(languageCode)
  return i18next.t(`Errors.${errorCode || 'AIAPIError'}`)
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function safeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function optionalSafeIdentifier(value: unknown): string | undefined {
  const text =
    typeof value === 'number' && Number.isFinite(value)
      ? String(value)
      : safeString(value)
  return text && SAFE_MOTION_IDENTIFIER.test(text) ? text : undefined
}

function optionalSafeCorrelationId(value: unknown): string | undefined {
  const text = optionalSafeIdentifier(value)
  if (!text || UNSAFE_CORRELATION_ID_PATTERN.test(text)) return undefined
  return text
}

function requiredSafeIdentifier(value: unknown): string {
  return optionalSafeIdentifier(value) ?? ''
}

function hasUnsafeMotionField(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasUnsafeMotionField)
  if (typeof value === 'string') {
    return UNSAFE_MOTION_STRING_PATTERN.test(value)
  }
  if (!isRecord(value)) return false

  for (const [key, nestedValue] of Object.entries(value)) {
    const normalizedKey = key.toLowerCase()
    if (
      HOME_CONTROL_MOTION_MARKER_NAMES.has(normalizedKey) &&
      nestedValue !== false &&
      nestedValue !== null &&
      nestedValue !== undefined
    ) {
      return true
    }
    if (
      UNSAFE_MOTION_FIELD_NAMES.has(normalizedKey) ||
      SENSITIVE_MOTION_FIELD_PATTERN.test(key)
    ) {
      return true
    }
    if (hasUnsafeMotionField(nestedValue)) return true
  }
  return false
}

function sanitizeMotionMetadata(value: unknown): JsonRecord {
  if (!isRecord(value)) return {}
  const result: JsonRecord = {}
  for (const [key, nestedValue] of Object.entries(value)) {
    const normalizedKey = key.toLowerCase()
    if (
      UNSAFE_MOTION_FIELD_NAMES.has(normalizedKey) ||
      SENSITIVE_MOTION_FIELD_PATTERN.test(key)
    ) {
      continue
    }
    if (
      typeof nestedValue === 'string' ||
      typeof nestedValue === 'number' ||
      typeof nestedValue === 'boolean' ||
      nestedValue === null
    ) {
      if (
        typeof nestedValue !== 'string' ||
        !UNSAFE_MOTION_STRING_PATTERN.test(nestedValue)
      ) {
        result[key] = nestedValue
      }
      continue
    }
    if (Array.isArray(nestedValue)) {
      const safeItems = nestedValue.filter(
        (item) =>
          (typeof item === 'string' &&
            !UNSAFE_MOTION_STRING_PATTERN.test(item)) ||
          typeof item === 'number' ||
          typeof item === 'boolean'
      )
      if (safeItems.length > 0) {
        result[key] = safeItems
      }
      continue
    }
    if (isRecord(nestedValue)) {
      const safeObject = sanitizeMotionMetadata(nestedValue)
      if (Object.keys(safeObject).length > 0) {
        result[key] = safeObject
      }
    }
  }
  return result
}

function isSafeMotionTrackMaskArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((item) => {
      const text = typeof item === 'string' ? item.trim() : ''
      return Boolean(text && SAFE_MOTION_IDENTIFIER.test(text))
    })
  )
}

function hasSafeMotionTrackMaskShape(value: unknown): boolean {
  return isRecord(value) || isSafeMotionTrackMaskArray(value)
}

function hasSafeExpressionVisibleTrackMask(value: unknown): boolean {
  if (!isRecord(value)) return false
  if (
    safeString(value.scope).toLowerCase() !== EXPRESSION_VISIBLE_TRACK_SCOPE
  ) {
    return false
  }
  const channels = value.channels
  if (Array.isArray(channels)) {
    return (
      channels.length > 0 &&
      channels.every(
        (channel) =>
          safeString(channel).toLowerCase() === EXPRESSION_VISIBLE_TRACK_CHANNEL
      )
    )
  }
  return (
    safeString(value.channel).toLowerCase() === EXPRESSION_VISIBLE_TRACK_CHANNEL
  )
}

function sanitizeMotionTrackMask(value: unknown): JsonRecord | string[] {
  if (isSafeMotionTrackMaskArray(value)) {
    return value.map((item) => item.trim())
  }
  return sanitizeMotionMetadata(value)
}

function buildSafeMotionTrace(
  trace: JsonRecord,
  ids: {
    motionEventId: string
    stimulusId: string
    stimulusInstanceId: string
  },
  options: { includeDriverResultId?: boolean } = {}
): JsonRecord {
  const safeTrace: JsonRecord = {
    motion_event_id: ids.motionEventId,
    stimulus_id: ids.stimulusId,
    stimulus_instance_id: ids.stimulusInstanceId,
  }
  for (const key of [
    'event_id',
    'turn_id',
    'session_id',
    'request_id',
    'attempt_id',
    'runtime_result_id',
  ]) {
    const value = optionalSafeIdentifier(trace[key])
    if (value) {
      safeTrace[key] = value
    }
  }
  const multiStimulusGroupId = optionalSafeCorrelationId(
    trace.multi_stimulus_group_id
  )
  if (multiStimulusGroupId) {
    safeTrace.multi_stimulus_group_id = multiStimulusGroupId
  }
  const attempt = optionalSafeIdentifier(trace.attempt)
  if (attempt && !safeTrace.attempt_id) {
    safeTrace.attempt_id = attempt
  }
  if (options.includeDriverResultId) {
    const driverResultId = optionalSafeIdentifier(trace.driver_result_id)
    if (driverResultId) {
      safeTrace.driver_result_id = driverResultId
    }
  }
  return safeTrace
}

function buildSafeStopMetadata(
  payload: JsonRecord,
  motionProfile: { kind: string }
): JsonRecord {
  if (motionProfile.kind !== MOTION_STOP_KIND) return {}

  const result: JsonRecord = {}
  if (payload.duration_ms === 0) {
    result.duration_ms = 0
  }
  if (payload.loop === false) {
    result.loop = false
  }
  if (safeString(payload.interrupt_policy) === MOTION_STOP_INTERRUPT_POLICY) {
    result.interrupt_policy = MOTION_STOP_INTERRUPT_POLICY
  }
  if (safeString(payload.fallback_state) === MOTION_STOP_FALLBACK_STATE) {
    result.fallback_state = MOTION_STOP_FALLBACK_STATE
  }
  const stopReason = safeString(payload.stop_reason)
  if (MOTION_STOP_REASONS.has(stopReason)) {
    result.stop_reason = stopReason
  }
  return result
}

export function extractThoughtCoreDanceMotionStimulus(
  event: unknown
): JsonRecord | null {
  const stimulus = extractThoughtCoreMotionStimulus(event)
  return stimulus?.kind === DANCE_SEQUENCE_KIND ? stimulus : null
}

export function extractThoughtCoreMotionStimulus(
  event: unknown
): JsonRecord | null {
  if (!isRecord(event) || event.type !== THOUGHT_CORE_MOTION_REQUEST_EVENT) {
    return null
  }
  const payload = event.data
  if (!isRecord(payload) || hasUnsafeMotionField(payload)) {
    return null
  }

  const schemaVersion = safeString(payload.schema_version)
  const kind = safeString(payload.kind).toLowerCase()
  const requestMode = safeString(payload.request_mode).toLowerCase()
  const payloadRef = safeString(payload.payload_ref)
  const targetModelType = safeString(payload.target_model_type).toLowerCase()
  const motionProfile = getSupportedMotionProfile({
    schemaVersion,
    kind,
    requestMode,
    payloadRef,
    targetModelType,
    requirements: payload.requirements,
    trackMask: payload.track_mask,
  })
  if (!motionProfile) return null

  const motionEventId = requiredSafeIdentifier(payload.motion_event_id)
  const stimulusId = requiredSafeIdentifier(payload.stimulus_id)
  const stimulusInstanceId = requiredSafeIdentifier(
    payload.stimulus_instance_id
  )
  const requestedAt = safeString(payload.requested_at)
  const sourceClass = requiredSafeIdentifier(payload.source_class)
  const sourceOrigin = requiredSafeIdentifier(payload.source_origin)
  const phase = requiredSafeIdentifier(payload.phase)
  const lifecycleState = requiredSafeIdentifier(payload.lifecycle_state)
  const safeVisibleState = requiredSafeIdentifier(payload.safe_visible_state)
  if (
    !motionEventId ||
    !stimulusId ||
    !stimulusInstanceId ||
    !requestedAt ||
    !sourceClass ||
    !sourceOrigin ||
    !phase ||
    !lifecycleState ||
    !safeVisibleState ||
    !Number.isFinite(Date.parse(requestedAt)) ||
    !hasSafeMotionTrackMaskShape(payload.track_mask) ||
    !isRecord(payload.requirements) ||
    !isRecord(payload.trace) ||
    !isRecord(payload.redaction)
  ) {
    return null
  }

  return {
    schema_version: MOTION_STIMULUS_SCHEMA_VERSION,
    motion_event_id: motionEventId,
    stimulus_id: stimulusId,
    stimulus_instance_id: stimulusInstanceId,
    source_class: sourceClass,
    source_origin: sourceOrigin,
    requested_at: requestedAt,
    kind: motionProfile.kind,
    request_mode: motionProfile.requestMode,
    phase,
    lifecycle_state: lifecycleState,
    safe_visible_state: safeVisibleState,
    target_model_type: VRM_TARGET_MODEL_TYPE,
    payload_ref: motionProfile.payloadRef,
    ...buildSafeStopMetadata(payload, motionProfile),
    track_mask: sanitizeMotionTrackMask(payload.track_mask),
    requirements: sanitizeMotionMetadata(payload.requirements),
    trace: buildSafeMotionTrace(
      payload.trace,
      {
        motionEventId,
        stimulusId,
        stimulusInstanceId,
      },
      { includeDriverResultId: motionProfile.includeDriverResultId }
    ),
    redaction: sanitizeMotionMetadata(payload.redaction),
  }
}

export function dispatchThoughtCoreMotionStimulus(event: unknown): boolean {
  const stimulus = extractThoughtCoreMotionStimulus(event)
  if (
    !stimulus ||
    typeof window === 'undefined' ||
    typeof window.dispatchEvent !== 'function'
  ) {
    return false
  }

  window.dispatchEvent(
    new CustomEvent(MOTION_STIMULUS_RECEIVER_EVENT, {
      detail: stimulus,
    })
  )
  return true
}

function getSupportedMotionProfile(args: {
  schemaVersion: string
  kind: string
  requestMode: string
  payloadRef: string
  targetModelType: string
  requirements: unknown
  trackMask: unknown
}): {
  kind: string
  requestMode: string
  payloadRef: string
  includeDriverResultId?: boolean
} | null {
  if (
    args.schemaVersion !== MOTION_STIMULUS_SCHEMA_VERSION ||
    args.targetModelType !== VRM_TARGET_MODEL_TYPE
  ) {
    return null
  }
  if (
    args.kind === DANCE_SEQUENCE_KIND &&
    args.requestMode === DANCE_SEQUENCE_REQUEST_MODE &&
    args.payloadRef === DANCE_SEQUENCE_PAYLOAD_REF
  ) {
    return {
      kind: DANCE_SEQUENCE_KIND,
      requestMode: DANCE_SEQUENCE_REQUEST_MODE,
      payloadRef: DANCE_SEQUENCE_PAYLOAD_REF,
    }
  }
  if (
    args.kind === MOTION_STOP_KIND &&
    args.requestMode === MOTION_STOP_REQUEST_MODE &&
    args.payloadRef === MOTION_STOP_PAYLOAD_REF
  ) {
    return {
      kind: MOTION_STOP_KIND,
      requestMode: MOTION_STOP_REQUEST_MODE,
      payloadRef: MOTION_STOP_PAYLOAD_REF,
    }
  }
  if (
    args.kind === EXPRESSION_VISIBLE_KIND &&
    args.requestMode === EXPRESSION_VISIBLE_REQUEST_MODE &&
    args.payloadRef === EXPRESSION_VISIBLE_PAYLOAD_REF &&
    hasExpressionVisibleRequirements(args.requirements) &&
    hasSafeExpressionVisibleTrackMask(args.trackMask)
  ) {
    return {
      kind: EXPRESSION_VISIBLE_KIND,
      requestMode: EXPRESSION_VISIBLE_REQUEST_MODE,
      payloadRef: EXPRESSION_VISIBLE_PAYLOAD_REF,
      includeDriverResultId: true,
    }
  }
  return null
}

function hasExpressionVisibleRequirements(value: unknown): boolean {
  if (!isRecord(value)) return false
  return (
    safeString(value.expression_profile_ref) ===
      EXPRESSION_VISIBLE_PROFILE_REF &&
    safeString(value.expected_visible_change) === EXPRESSION_VISIBLE_CHANGE &&
    safeString(value.expected_roi) === EXPRESSION_VISIBLE_ROI
  )
}

export async function getThoughtCoreChatResponseStream(
  messages: Message[],
  url: string,
  sessionId: string
): Promise<ReadableStream<string>> {
  const response = await fetch('/api/thoughtCoreChat/', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query: messages[messages.length - 1].content,
      url,
      sessionId,
      stream: true,
    }),
  })

  try {
    if (!response.ok) {
      const responseBody = await response.json().catch(() => ({}))
      const errorDetail =
        responseBody.detail || responseBody.error || response.statusText
      throw new Error(
        `API request to Thought Core failed with status ${response.status} and body ${errorDetail}`,
        { cause: { errorCode: responseBody.errorCode, detail: errorDetail } }
      )
    }

    return new ReadableStream({
      async start(controller) {
        let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
        try {
          if (!response.body) {
            throw new Error('API response from Thought Core is empty', {
              cause: { errorCode: 'AIAPIError' },
            })
          }

          reader = response.body.getReader()
          const decoder = new TextDecoder('utf-8')
          let buffer = ''

          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            buffer += decoder.decode(value, { stream: true })

            const lines = buffer.split('\n')
            buffer = lines.pop() || ''

            for (const rawLine of lines) {
              const line = rawLine.trim()
              if (!line.startsWith('data:')) continue

              const jsonStr = line.slice(5).trim()
              if (!jsonStr) continue

              try {
                const event = JSON.parse(jsonStr)
                const eventType =
                  typeof event?.type === 'string' ? event.type : ''
                const data =
                  event?.data && typeof event.data === 'object'
                    ? event.data
                    : {}

                if (eventType === THOUGHT_CORE_MOTION_REQUEST_EVENT) {
                  dispatchThoughtCoreMotionStimulus(event)
                }

                if (
                  eventType === 'assistant.speech_delta' &&
                  typeof data.delta === 'string'
                ) {
                  controller.enqueue(data.delta)
                } else if (
                  eventType === 'feedback.requested' &&
                  typeof data.speech === 'string'
                ) {
                  controller.enqueue(data.speech)
                } else if (eventType === 'turn.error') {
                  throw new Error(
                    typeof data.message === 'string'
                      ? data.message
                      : 'Thought Core turn error'
                  )
                }
              } catch (error) {
                console.error('Error parsing Thought Core SSE:', error)
              }
            }
          }
        } catch (error) {
          console.error('Error fetching Thought Core API response:', error)

          toastStore.getState().addToast({
            message: i18next.t('Errors.AIAPIError'),
            type: 'error',
            tag: 'thought-core-api-error',
          })
        } finally {
          controller.close()
          if (reader) {
            reader.releaseLock()
          }
        }
      },
    })
  } catch (error: any) {
    const cause = getThoughtCoreErrorCause(error)
    const errorCode = cause.errorCode || 'AIAPIError'
    const errorMessage = handleApiError(errorCode)
    const message =
      errorCode === 'AIAPIError' && cause.detail
        ? `${errorMessage}: ${cause.detail}`
        : errorMessage
    toastStore.getState().addToast({
      message,
      type: 'error',
      tag: 'thought-core-api-error',
    })
    throw error
  }
}
