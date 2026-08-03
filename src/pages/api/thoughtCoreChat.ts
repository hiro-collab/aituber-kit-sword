import { NextApiRequest, NextApiResponse } from 'next'
import { pipeResponse } from '@/utils/pipeResponse'
import fs from 'fs'
import { isIP } from 'net'
import path from 'path'
import { enforceLocalApiRequest } from '@/utils/localApiSecurity'
import {
  createAcceptedPreparedSampleSpeechEnvelope,
  type AcceptedPreparedSampleSpeechEnvelope,
} from '@/utils/preparedSampleBrowserStt'
import { safeConversationAttemptRef } from '@/utils/speechOutputParitySummary'
import {
  PROJECTION_EFFECT_INTENT_LEGACY_EVENT,
  PROJECTION_EFFECT_INTENT_PRESENTATION_EVENT,
  PROJECTION_EFFECT_INTENT_UPSTREAM_EVENT,
  readProjectionEffectRequestedEvent,
} from '@/features/projectionEffects/projectionEffectIntent'
import { CONTROL_PROJECTION_PERFORMANCE_PLAN_SCHEMA_SHA256 } from '@/features/projectionEffects/projectionPerformancePlan'

const DEFAULT_THOUGHT_CORE_BASE_URL = 'http://127.0.0.1:18888'
export const MAX_THOUGHT_CORE_SSE_LINE_UTF8_BYTES = 16 * 1024
const MAX_JSON_DUPLICATE_SCAN_DEPTH = 64

const truncate = (value: string, maxLength = 1200) =>
  value.length > maxLength ? `${value.slice(0, maxLength)}...` : value

const NOTABLE_THOUGHT_CORE_EVENTS = new Set([
  'input.understood',
  'action.proposed',
  'action.review_pending',
  'action.reviewed',
  'action.retrying',
  'feedback.requested',
  'motion.requested',
  'tool.started',
  'tool.result',
  'observation.received',
  'turn.completed',
])

const SAFE_TRACE_KEYS = new Set([
  'action',
  'action_id',
  'action_source',
  'action_type',
  'boundary_source',
  'call_id',
  'code',
  'confidence',
  'entity_id',
  'error_code',
  'executed',
  'expected_state',
  'input_kind',
  'intent',
  'intent_kind',
  'is_command',
  'is_home_action',
  'issue_id',
  'kind',
  'lifecycle_state',
  'motion_event_id',
  'payload_ref',
  'phase',
  'reason',
  'redaction',
  'request_id',
  'request_mode',
  'requested_at',
  'requirements',
  'runtime_result_id',
  'safe_visible_state',
  'schema_version',
  'scope',
  'source',
  'source_class',
  'source_origin',
  'state',
  'status',
  'stimulus_id',
  'stimulus_instance_id',
  'target',
  'target_model_type',
  'tool',
  'tool_name',
  'trace',
  'track_mask',
  'turn_id',
  'visible_motion',
])
const MOTION_REQUESTED_EVENT_TYPE = 'motion.requested'
const CORE_EVENT_ID_PATTERN = /^evt_[0-9a-f]{32}$/
const BOUNDED_MOTION_IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
const PRIVATE_MOTION_IDENTIFIER_MARKER =
  /(?:^|[._:-])(?:raw|private|provider|secret|token|credential|password|authorization|path|file|media|audio|video)(?:$|[._:-])/i
const CORE_MOTION_TRACE_KEYS = new Set([
  'event_id',
  'turn_id',
  'selection_id',
  'runtime_result_id',
  'motion_event_id',
  'stimulus_id',
  'stimulus_instance_id',
])
const MAX_MOTION_NOTABLE_SUMMARY_BYTES = 1_024
const ACCEPTED_PRIVATE_UPSTREAM_HTTP_ERROR =
  'accepted_private_upstream_http_error'
const ACCEPTED_PRIVATE_UPSTREAM_EXCEPTION =
  'accepted_private_upstream_exception'
const ACCEPTED_PRIVATE_STREAM_ERROR = 'accepted_private_stream_error'
const ACCEPTED_PRIVATE_STREAM_CANCELLED = 'accepted_private_stream_cancelled'
const ACCEPTED_PRESENTATION_ASSISTANT_EVENT =
  'accepted.presentation.assistant_delta'
const ACCEPTED_PRESENTATION_MOTION_EVENT = 'accepted.presentation.motion'
const ACCEPTED_PRESENTATION_COMPLETED_EVENT = 'accepted.presentation.completed'
const MAX_ACCEPTED_ASSISTANT_DELTA_LENGTH = 4_000
const RAW_TEXT_KEYS =
  /(?:^|_)(?:answer|content|delta|message|prompt|query|raw|speech|text|transcript|utterance)(?:_|$)/i
const SENSITIVE_TRACE_KEYS =
  /(?:authorization|credential|password|secret|token|api[_-]?key|confirmation)/i

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function hasExactJsonValue(left: unknown, right: unknown): boolean {
  if (left === right) return true
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => hasExactJsonValue(value, right[index]))
    )
  }
  if (!isRecord(left) || !isRecord(right)) return false
  const leftKeys = Object.keys(left)
  const rightKeys = Object.keys(right)
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key) => key in right && hasExactJsonValue(left[key], right[key])
    )
  )
}

function readAcceptedPreparedSampleSpeechEnvelope(
  body: Record<string, unknown>
): AcceptedPreparedSampleSpeechEnvelope | null {
  const candidate = body.accepted_user_speech_candidate
  const privateTurn = body.private_turn
  if (!isRecord(candidate) || !isRecord(privateTurn)) return null
  const recognitionSummary = candidate.recognition_summary
  const contextRefs = privateTurn.context_refs
  if (!isRecord(recognitionSummary) || !isRecord(contextRefs)) return null

  try {
    const normalized = createAcceptedPreparedSampleSpeechEnvelope({
      conversationAttemptRef: String(
        contextRefs.conversation_attempt_ref ?? ''
      ),
      selectedSampleId: String(recognitionSummary.source_label ?? ''),
      recognizedText: String(privateTurn.text ?? ''),
      generatedAt: String(candidate.generated_at ?? ''),
    })
    return hasExactJsonValue(
      normalized.accepted_user_speech_candidate,
      candidate
    ) && hasExactJsonValue(normalized.private_turn, privateTurn)
      ? normalized
      : null
  } catch {
    return null
  }
}

function toSafeTraceValue(value: unknown): unknown {
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    value === null
  ) {
    return typeof value === 'string' ? truncate(value, 180) : value
  }
  if (Array.isArray(value)) {
    const items = value
      .slice(0, 4)
      .map((item) => toSafeTraceObject(item))
      .filter((item) => item && Object.keys(item).length > 0)
    return items.length > 0 ? items : undefined
  }
  if (value && typeof value === 'object') {
    const objectValue = toSafeTraceObject(value)
    return Object.keys(objectValue).length > 0 ? objectValue : undefined
  }
  return undefined
}

function toSafeTraceObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object') return {}
  const result: Record<string, unknown> = {}
  for (const [key, nestedValue] of Object.entries(
    value as Record<string, unknown>
  )) {
    if (SENSITIVE_TRACE_KEYS.test(key) || RAW_TEXT_KEYS.test(key)) continue
    const normalizedKey = key.replace(
      /[A-Z]/g,
      (letter) => `_${letter.toLowerCase()}`
    )
    if (!SAFE_TRACE_KEYS.has(key) && !SAFE_TRACE_KEYS.has(normalizedKey)) {
      continue
    }
    const safeValue = toSafeTraceValue(nestedValue)
    if (safeValue !== undefined) {
      result[normalizedKey] = safeValue
    }
  }
  return result
}

function isCanonicalTimestamp(value: unknown): value is string {
  if (typeof value !== 'string' || value.length !== 24) return false
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value
}

function readBoundedMotionIdentifier(value: unknown): string | null {
  if (
    typeof value !== 'string' ||
    !BOUNDED_MOTION_IDENTIFIER_PATTERN.test(value) ||
    PRIVATE_MOTION_IDENTIFIER_MARKER.test(value)
  ) {
    return null
  }
  return value
}

function projectMotionRequestedNotableEvent(
  data: Record<string, unknown>,
  expectedConversationAttemptRef?: string
): Record<string, unknown> | null {
  const eventId =
    typeof data.event_id === 'string' &&
    CORE_EVENT_ID_PATTERN.test(data.event_id)
      ? data.event_id
      : null
  const timestamp = isCanonicalTimestamp(data.timestamp) ? data.timestamp : null
  const conversationAttemptRef = safeConversationAttemptRef(
    data.conversation_attempt_ref
  )
  const payload = isRecord(data.data) ? data.data : null
  if (
    !eventId ||
    !timestamp ||
    !conversationAttemptRef ||
    (expectedConversationAttemptRef !== undefined &&
      conversationAttemptRef !== expectedConversationAttemptRef) ||
    !payload
  ) {
    return null
  }

  const trace = isRecord(payload.trace) ? payload.trace : null
  if (
    !trace ||
    Object.keys(trace).some((key) => !CORE_MOTION_TRACE_KEYS.has(key))
  ) {
    return null
  }
  for (const [key, value] of Object.entries(trace)) {
    const valid =
      key === 'event_id'
        ? typeof value === 'string' && CORE_EVENT_ID_PATTERN.test(value)
        : readBoundedMotionIdentifier(value) !== null
    if (!valid) return null
  }

  const schemaVersion =
    payload.schema_version === 'motion_stimulus.v0'
      ? payload.schema_version
      : null
  const motionEventId = readBoundedMotionIdentifier(payload.motion_event_id)
  const stimulusId = readBoundedMotionIdentifier(payload.stimulus_id)
  const stimulusInstanceId = readBoundedMotionIdentifier(
    payload.stimulus_instance_id
  )
  const requestedAt = isCanonicalTimestamp(payload.requested_at)
    ? payload.requested_at
    : null
  if (
    !schemaVersion ||
    !motionEventId ||
    !stimulusId ||
    !stimulusInstanceId ||
    payload.phase !== 'queued' ||
    payload.lifecycle_state !== 'queued' ||
    payload.safe_visible_state !== 'requested' ||
    !requestedAt ||
    requestedAt !== timestamp ||
    trace.event_id !== eventId
  ) {
    return null
  }

  const summary = {
    schema_version: schemaVersion,
    motion_event_id: motionEventId,
    stimulus_id: stimulusId,
    stimulus_instance_id: stimulusInstanceId,
    phase: 'queued',
    lifecycle_state: 'queued',
    safe_visible_state: 'requested',
    requested_at: requestedAt,
    trace: { event_id: eventId },
  }
  if (
    Buffer.byteLength(JSON.stringify(summary), 'utf8') >
    MAX_MOTION_NOTABLE_SUMMARY_BYTES
  ) {
    return null
  }

  return {
    type: MOTION_REQUESTED_EVENT_TYPE,
    event_id: eventId,
    timestamp,
    conversation_attempt_ref: conversationAttemptRef,
    summary,
  }
}

function projectPresentationMotionPayload(
  value: unknown
): Record<string, unknown> | null {
  if (!isRecord(value)) return null
  const allowed = new Set([
    'schema_version',
    'motion_event_id',
    'stimulus_id',
    'stimulus_instance_id',
    'source_class',
    'source_origin',
    'requested_at',
    'kind',
    'request_mode',
    'phase',
    'lifecycle_state',
    'safe_visible_state',
    'target_model_type',
    'payload_ref',
    'duration_ms',
    'loop',
    'interrupt_policy',
    'fallback_state',
    'stop_reason',
    'track_mask',
    'requirements',
    'trace',
    'redaction',
  ])
  const nestedKeys: Record<string, Set<string>> = {
    track_mask: new Set(['scope', 'channel', 'channels']),
    requirements: new Set([
      'required_tracks',
      'optional_tracks',
      'compatible_model_types',
      'provenance_required',
      'allow_degraded',
      'allow_fallback',
      'expression_profile_ref',
      'expected_visible_change',
      'expected_roi',
    ]),
    trace: CORE_MOTION_TRACE_KEYS,
    redaction: new Set([
      'redaction_status',
      'redaction_profile',
      'shareability_class',
      'proof_layer',
    ]),
  }
  const projectNested = (
    key: string,
    nested: Record<string, unknown>
  ): Record<string, unknown> | null => {
    const keyAllowlist = nestedKeys[key]
    if (!keyAllowlist) return null
    const result: Record<string, unknown> = {}
    for (const [nestedKey, nestedValue] of Object.entries(nested)) {
      if (!keyAllowlist.has(nestedKey)) continue
      if (typeof nestedValue === 'boolean' || typeof nestedValue === 'number') {
        result[nestedKey] = nestedValue
      } else if (typeof nestedValue === 'string') {
        if (
          nestedValue.length > 256 ||
          PRIVATE_MOTION_IDENTIFIER_MARKER.test(nestedValue) ||
          /(?:https?:\/\/|file:\/\/|[A-Za-z]:[\\/]|\\\\)/.test(nestedValue)
        ) {
          return null
        }
        result[nestedKey] = nestedValue
      } else if (
        Array.isArray(nestedValue) &&
        nestedValue.length <= 32 &&
        nestedValue.every(
          (item) =>
            typeof item === 'string' &&
            BOUNDED_MOTION_IDENTIFIER_PATTERN.test(item) &&
            !PRIVATE_MOTION_IDENTIFIER_MARKER.test(item)
        )
      ) {
        result[nestedKey] = [...nestedValue]
      } else {
        return null
      }
    }
    return Object.keys(result).length > 0 ? result : null
  }
  const projected: Record<string, unknown> = {}
  for (const [key, nested] of Object.entries(value)) {
    if (!allowed.has(key)) continue
    if (typeof nested === 'string') {
      if (
        nested.length > 256 ||
        PRIVATE_MOTION_IDENTIFIER_MARKER.test(nested) ||
        /(?:https?:\/\/|file:\/\/|[A-Za-z]:[\\/]|\\\\)/.test(nested)
      ) {
        return null
      }
      projected[key] = nested
    } else if (
      typeof nested === 'number' ||
      typeof nested === 'boolean' ||
      nested === null
    ) {
      projected[key] = nested
    } else if (Array.isArray(nested)) {
      if (
        nested.length > 32 ||
        !nested.every(
          (item) =>
            typeof item === 'string' &&
            BOUNDED_MOTION_IDENTIFIER_PATTERN.test(item) &&
            !PRIVATE_MOTION_IDENTIFIER_MARKER.test(item)
        )
      ) {
        return null
      }
      projected[key] = [...nested]
    } else if (isRecord(nested)) {
      const safe = projectNested(key, nested)
      if (!safe) return null
      projected[key] = safe
    } else {
      return null
    }
  }
  return projected
}

function projectAcceptedPresentationEvent(
  eventType: string,
  data: Record<string, unknown>,
  expectedConversationAttemptRef?: string,
  expectedTurnId?: string,
  expectedSessionId?: string
): Record<string, unknown> | null {
  if (eventType === PROJECTION_EFFECT_INTENT_UPSTREAM_EVENT) {
    return projectProjectionEffectIntentEvent(
      data,
      expectedConversationAttemptRef,
      expectedTurnId,
      expectedSessionId
    )
  }
  const assistantPayload = isRecord(data.data) ? data.data : null
  const candidateConversationAttemptRef =
    eventType === 'assistant.speech_delta'
      ? assistantPayload?.conversation_attempt_ref
      : data.conversation_attempt_ref
  const conversationAttemptRef = safeConversationAttemptRef(
    candidateConversationAttemptRef
  )
  if (
    !expectedConversationAttemptRef ||
    !conversationAttemptRef ||
    conversationAttemptRef !== expectedConversationAttemptRef
  ) {
    return null
  }
  if (eventType === 'assistant.speech_delta') {
    const delta = assistantPayload?.delta
    if (
      typeof delta !== 'string' ||
      !delta ||
      delta.length > MAX_ACCEPTED_ASSISTANT_DELTA_LENGTH
    ) {
      return null
    }
    return {
      type: ACCEPTED_PRESENTATION_ASSISTANT_EVENT,
      data: {
        conversation_attempt_ref: conversationAttemptRef,
        delta,
      },
    }
  }
  if (eventType === MOTION_REQUESTED_EVENT_TYPE) {
    const notable = projectMotionRequestedNotableEvent(
      data,
      expectedConversationAttemptRef
    )
    const payload = projectPresentationMotionPayload(data.data)
    if (!notable || !payload) return null
    return {
      type: ACCEPTED_PRESENTATION_MOTION_EVENT,
      data: {
        conversation_attempt_ref: conversationAttemptRef,
        event: { type: MOTION_REQUESTED_EVENT_TYPE, data: payload },
      },
    }
  }
  return null
}

function projectProjectionEffectIntentEvent(
  data: Record<string, unknown>,
  expectedConversationAttemptRef?: string,
  expectedTurnId?: string,
  expectedSessionId?: string
): Record<string, unknown> | null {
  if (!expectedTurnId || !expectedSessionId) return null
  const intent = readProjectionEffectRequestedEvent(data, {
    expectedTurnId,
    expectedSessionId,
    expectedPerformancePlanSchemaSha256:
      CONTROL_PROJECTION_PERFORMANCE_PLAN_SCHEMA_SHA256,
  })
  const conversationAttemptRef = expectedConversationAttemptRef
    ? safeConversationAttemptRef(expectedConversationAttemptRef)
    : null
  if (
    !intent ||
    (expectedConversationAttemptRef !== undefined &&
      conversationAttemptRef !== expectedConversationAttemptRef)
  ) {
    return null
  }
  return {
    type: PROJECTION_EFFECT_INTENT_PRESENTATION_EVENT,
    data: {
      ...(conversationAttemptRef
        ? { conversation_attempt_ref: conversationAttemptRef }
        : {}),
      intent,
    },
  }
}

function buildNotableThoughtCoreEvent(
  eventType: string,
  data: Record<string, unknown>,
  expectedConversationAttemptRef?: string
): Record<string, unknown> | null {
  if (!NOTABLE_THOUGHT_CORE_EVENTS.has(eventType)) return null
  if (eventType === MOTION_REQUESTED_EVENT_TYPE) {
    return projectMotionRequestedNotableEvent(
      data,
      expectedConversationAttemptRef
    )
  }
  const payload =
    data?.data && typeof data.data === 'object'
      ? (data.data as Record<string, unknown>)
      : {}
  const summary = toSafeTraceObject(payload)
  const notableEvent: Record<string, unknown> = {
    type: eventType,
  }
  for (const key of [
    'event_id',
    'turn_id',
    'session_id',
    'seq',
    'source',
    'timestamp',
  ]) {
    const value = data[key]
    if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    ) {
      notableEvent[key] = value
    }
  }
  if (Object.keys(summary).length > 0) {
    notableEvent.summary = summary
  }
  return notableEvent
}

const pathExists = (targetPath: string) =>
  typeof fs.existsSync === 'function' && fs.existsSync(targetPath)

const getWorkspaceRoot = () => {
  if (process.env.HOME_CONTROL_WORKSPACE_ROOT) {
    return process.env.HOME_CONTROL_WORKSPACE_ROOT
  }

  let current = process.cwd()
  for (let depth = 0; depth < 8; depth += 1) {
    if (
      pathExists(path.join(current, 'control-plane', 'core')) ||
      pathExists(path.join(current, 'organs'))
    ) {
      return current
    }
    const parent = path.dirname(current)
    if (parent === current) break
    current = parent
  }

  return path.resolve(
    process.cwd(),
    process.cwd().endsWith('aituber-kit') ? '..' : '.'
  )
}

const getStackStateDir = () =>
  process.env.HOME_CONTROL_STACK_STATE_DIR
    ? path.resolve(process.env.HOME_CONTROL_STACK_STATE_DIR)
    : path.join(getWorkspaceRoot(), '.cache', 'home-control-stack')

const THOUGHT_CORE_TRACE_FILE = path.join(
  getStackStateDir(),
  'thought-core-chat-events.jsonl'
)
const CONVERSATION_LOG_FILE = path.join(
  getStackStateDir(),
  'conversation-log.jsonl'
)

const isLoopbackHost = (host: string) =>
  host === 'localhost' ||
  host === '::1' ||
  host === '[::1]' ||
  (isIP(host) === 4 && host.split('.')[0] === '127')

function appendThoughtCoreTrace(
  event: string,
  payload: Record<string, unknown> = {}
) {
  try {
    fs.mkdirSync(path.dirname(THOUGHT_CORE_TRACE_FILE), { recursive: true })
    fs.appendFileSync(
      THOUGHT_CORE_TRACE_FILE,
      `${JSON.stringify({
        timestamp: new Date().toISOString(),
        event,
        ...payload,
      })}\n`,
      'utf8'
    )
  } catch {
    // Diagnostics should never break chat generation.
  }
}

function appendConversationLog(
  role: 'user' | 'assistant' | 'system',
  text: string,
  payload: Record<string, unknown> = {}
) {
  const cleanText = text.trim()
  if (!cleanText) return
  try {
    fs.mkdirSync(path.dirname(CONVERSATION_LOG_FILE), { recursive: true })
    fs.appendFileSync(
      CONVERSATION_LOG_FILE,
      `${JSON.stringify({
        timestamp: new Date().toISOString(),
        role,
        text: truncate(cleanText, 4000),
        ...payload,
      })}\n`,
      'utf8'
    )
  } catch {
    // Review logs are diagnostic only and must never break chat generation.
  }
}

function validateThoughtCoreBaseUrl(url: string): string {
  const trimmed = (url || DEFAULT_THOUGHT_CORE_BASE_URL)
    .trim()
    .replace(/\/+$/, '')
  const parsed = new URL(trimmed)

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Thought Core URL must be an HTTP(S) URL')
  }
  if (parsed.username || parsed.password) {
    throw new Error('Thought Core URL must not include credentials')
  }
  if (!isLoopbackHost(parsed.hostname)) {
    throw new Error('Thought Core URL must be a loopback host')
  }

  return trimmed
}

function resolveThoughtCoreBaseUrl(requestUrl: unknown): string {
  const serverUrl =
    process.env.THOUGHT_CORE_BASE_URL ||
    process.env.NEXT_PUBLIC_THOUGHT_CORE_BASE_URL ||
    ''
  const candidate =
    serverUrl.trim() ||
    (typeof requestUrl === 'string' ? requestUrl.trim() : '') ||
    DEFAULT_THOUGHT_CORE_BASE_URL
  return validateThoughtCoreBaseUrl(candidate)
}

function buildTurnId(value: unknown): string {
  if (typeof value === 'string' && value.trim()) {
    return value.trim()
  }
  return `aituber_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

async function readThoughtCoreErrorDetail(response: Response): Promise<string> {
  const text = await response.text().catch(() => '')
  if (!text) {
    return response.statusText || `HTTP ${response.status}`
  }

  const contentType = response.headers.get('content-type') ?? ''
  if (contentType.includes('application/json')) {
    try {
      const data = JSON.parse(text)
      const message =
        data.message ||
        data.error ||
        data.detail ||
        data.code ||
        JSON.stringify(data)
      return truncate(String(message))
    } catch {
      return truncate(text)
    }
  }

  return truncate(text)
}

type JsonDuplicateScanResult = 'unique' | 'duplicate' | 'invalid'

function scanJsonForDuplicateObjectKeys(text: string): JsonDuplicateScanResult {
  let index = 0

  const skipWhitespace = () => {
    while (index < text.length) {
      const code = text.charCodeAt(index)
      if (code !== 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) {
        break
      }
      index += 1
    }
  }

  const readHexDigit = (code: number): number => {
    if (code >= 0x30 && code <= 0x39) return code - 0x30
    if (code >= 0x41 && code <= 0x46) return code - 0x41 + 10
    if (code >= 0x61 && code <= 0x66) return code - 0x61 + 10
    return -1
  }

  const parseString = (
    collectValue: boolean
  ): { ok: true; value: string } | { ok: false } => {
    if (text.charCodeAt(index) !== 0x22) return { ok: false }
    index += 1
    const value: string[] = []
    while (index < text.length) {
      const code = text.charCodeAt(index)
      index += 1
      if (code === 0x22) {
        return { ok: true, value: collectValue ? value.join('') : '' }
      }
      if (code < 0x20) return { ok: false }
      if (code !== 0x5c) {
        if (collectValue) value.push(String.fromCharCode(code))
        continue
      }
      if (index >= text.length) return { ok: false }
      const escaped = text.charCodeAt(index)
      index += 1
      const simpleEscape =
        escaped === 0x22
          ? '"'
          : escaped === 0x5c
            ? '\\'
            : escaped === 0x2f
              ? '/'
              : escaped === 0x62
                ? '\b'
                : escaped === 0x66
                  ? '\f'
                  : escaped === 0x6e
                    ? '\n'
                    : escaped === 0x72
                      ? '\r'
                      : escaped === 0x74
                        ? '\t'
                        : null
      if (simpleEscape !== null) {
        if (collectValue) value.push(simpleEscape)
        continue
      }
      if (escaped !== 0x75 || index + 4 > text.length) {
        return { ok: false }
      }
      let unicode = 0
      for (let offset = 0; offset < 4; offset += 1) {
        const digit = readHexDigit(text.charCodeAt(index + offset))
        if (digit < 0) return { ok: false }
        unicode = unicode * 16 + digit
      }
      index += 4
      if (collectValue) value.push(String.fromCharCode(unicode))
    }
    return { ok: false }
  }

  const parseNumber = (): boolean => {
    if (text.charCodeAt(index) === 0x2d) index += 1
    if (text.charCodeAt(index) === 0x30) {
      index += 1
    } else {
      const first = text.charCodeAt(index)
      if (first < 0x31 || first > 0x39) return false
      index += 1
      while (index < text.length) {
        const code = text.charCodeAt(index)
        if (code < 0x30 || code > 0x39) break
        index += 1
      }
    }
    if (text.charCodeAt(index) === 0x2e) {
      index += 1
      const firstFraction = text.charCodeAt(index)
      if (firstFraction < 0x30 || firstFraction > 0x39) return false
      while (index < text.length) {
        const code = text.charCodeAt(index)
        if (code < 0x30 || code > 0x39) break
        index += 1
      }
    }
    const exponent = text.charCodeAt(index)
    if (exponent === 0x45 || exponent === 0x65) {
      index += 1
      const sign = text.charCodeAt(index)
      if (sign === 0x2b || sign === 0x2d) index += 1
      const firstExponent = text.charCodeAt(index)
      if (firstExponent < 0x30 || firstExponent > 0x39) return false
      while (index < text.length) {
        const code = text.charCodeAt(index)
        if (code < 0x30 || code > 0x39) break
        index += 1
      }
    }
    return true
  }

  const parseValue = (depth: number): JsonDuplicateScanResult => {
    if (depth > MAX_JSON_DUPLICATE_SCAN_DEPTH) return 'invalid'
    skipWhitespace()
    const code = text.charCodeAt(index)
    if (code === 0x22) {
      return parseString(false).ok ? 'unique' : 'invalid'
    }
    if (code === 0x7b) {
      index += 1
      skipWhitespace()
      const keys = new Set<string>()
      if (text.charCodeAt(index) === 0x7d) {
        index += 1
        return 'unique'
      }
      while (index < text.length) {
        const key = parseString(true)
        if (!key.ok) return 'invalid'
        if (keys.has(key.value)) return 'duplicate'
        keys.add(key.value)
        skipWhitespace()
        if (text.charCodeAt(index) !== 0x3a) return 'invalid'
        index += 1
        const child = parseValue(depth + 1)
        if (child !== 'unique') return child
        skipWhitespace()
        const separator = text.charCodeAt(index)
        if (separator === 0x7d) {
          index += 1
          return 'unique'
        }
        if (separator !== 0x2c) return 'invalid'
        index += 1
        skipWhitespace()
      }
      return 'invalid'
    }
    if (code === 0x5b) {
      index += 1
      skipWhitespace()
      if (text.charCodeAt(index) === 0x5d) {
        index += 1
        return 'unique'
      }
      while (index < text.length) {
        const child = parseValue(depth + 1)
        if (child !== 'unique') return child
        skipWhitespace()
        const separator = text.charCodeAt(index)
        if (separator === 0x5d) {
          index += 1
          return 'unique'
        }
        if (separator !== 0x2c) return 'invalid'
        index += 1
      }
      return 'invalid'
    }
    if (code === 0x2d || (code >= 0x30 && code <= 0x39)) {
      return parseNumber() ? 'unique' : 'invalid'
    }
    for (const literal of ['true', 'false', 'null']) {
      if (text.startsWith(literal, index)) {
        index += literal.length
        return 'unique'
      }
    }
    return 'invalid'
  }

  try {
    const result = parseValue(0)
    if (result !== 'unique') return result
    skipWhitespace()
    return index === text.length ? 'unique' : 'invalid'
  } catch {
    return 'invalid'
  }
}

export function createTracedThoughtCoreStream(
  body: ReadableStream<Uint8Array> | null,
  context: {
    query: unknown
    startedAt: number
    turnId?: string
    sessionId?: string
    privateAcceptedSpeechRoute?: boolean
    expectedConversationAttemptRef?: string
  }
) {
  if (!body) {
    return null
  }

  const reader = body.getReader()
  const lineDecoder = new TextDecoder('utf-8', { fatal: true })
  const encoder = new TextEncoder()
  const eventCounts: Record<string, number> = {}
  const lineBuffer = new Uint8Array(MAX_THOUGHT_CORE_SSE_LINE_UTF8_BYTES)
  let lineBufferLength = 0
  let discardingOversizedLine = false
  let answerChars = 0
  let answerPreview = ''
  let answerText = ''
  let messageText = ''
  let streamTurnId =
    typeof context.turnId === 'string' ? String(context.turnId) : ''
  let finalEventId: string | null = null
  let finalEventSeq: number | null = null
  let lastNotableActionEventId: string | null = null
  const notableEvents: Record<string, unknown>[] = []
  let firstAnswerLogged = false
  let completedLogged = false
  let acceptedPresentationAssistantSeen = false
  let acceptedPresentationMotionSeen = false
  let acceptedProjectionEffectIntentSeen = false
  let acceptedPresentationInvalid = false

  const query = truncate(String(context.query ?? ''), 180)
  const traceContext = () => ({
    turn_id: streamTurnId || context.turnId || null,
    session_id: context.sessionId || null,
  })
  const logCompletion = (
    event: string,
    extra: Record<string, unknown> = {}
  ) => {
    if (completedLogged) return
    completedLogged = true
    appendThoughtCoreTrace(event, {
      latency_ms: Date.now() - context.startedAt,
      query,
      ...traceContext(),
      event_counts: eventCounts,
      answer_chars: answerChars,
      ...(context.privateAcceptedSpeechRoute
        ? {}
        : { answer_preview: answerPreview }),
      notable_event_count: notableEvents.length,
      ...(notableEvents.length > 0 ? { notable_events: notableEvents } : {}),
      ...(finalEventId ? { final_event_id: finalEventId } : {}),
      ...(finalEventSeq !== null ? { final_event_seq: finalEventSeq } : {}),
      ...(lastNotableActionEventId
        ? { last_notable_action_event_id: lastNotableActionEventId }
        : {}),
      ...extra,
    })
    const finalAnswer = answerText.trim() || messageText.trim()
    if (finalAnswer && !context.privateAcceptedSpeechRoute) {
      appendConversationLog('assistant', finalAnswer, {
        source: 'thought-core',
        route: 'projection-visual',
        event,
        turn_id: streamTurnId || context.turnId || null,
        session_id: context.sessionId || null,
        latency_ms: Date.now() - context.startedAt,
        event_counts: eventCounts,
      })
    }
  }

  const markInvalidStreamLine = () => {
    eventCounts.invalid_stream = (eventCounts.invalid_stream || 0) + 1
    if (context.privateAcceptedSpeechRoute) {
      acceptedPresentationInvalid = true
    }
  }

  const processLines = (
    lines: readonly string[]
  ): {
    presentationEvents: Record<string, unknown>[]
    forwardedText: string
  } => {
    const presentationEvents: Record<string, unknown>[] = []
    const forwardedLines: string[] = []

    for (const rawLine of lines) {
      const line = rawLine.trim()
      if (!line.startsWith('data:')) {
        forwardedLines.push(rawLine)
        continue
      }

      const jsonText = line.slice(5).trim()
      if (!jsonText) {
        forwardedLines.push(rawLine)
        continue
      }

      if (scanJsonForDuplicateObjectKeys(jsonText) !== 'unique') {
        markInvalidStreamLine()
        continue
      }

      try {
        const data = JSON.parse(jsonText)
        const rawEventType =
          typeof data?.type === 'string' ? data.type : 'unknown'
        const projectionCandidate =
          rawEventType === PROJECTION_EFFECT_INTENT_UPSTREAM_EVENT ||
          rawEventType === PROJECTION_EFFECT_INTENT_LEGACY_EVENT
        if (!projectionCandidate) forwardedLines.push(rawLine)
        const eventType =
          context.privateAcceptedSpeechRoute &&
          (!/^[a-z][a-z0-9._-]{0,63}$/.test(rawEventType) ||
            PRIVATE_MOTION_IDENTIFIER_MARKER.test(rawEventType))
            ? 'unknown'
            : rawEventType
        eventCounts[eventType] = (eventCounts[eventType] || 0) + 1
        if (
          typeof data?.event_id === 'string' &&
          data.event_id &&
          (!context.privateAcceptedSpeechRoute ||
            CORE_EVENT_ID_PATTERN.test(data.event_id))
        ) {
          finalEventId = data.event_id
        }
        if (typeof data?.seq === 'number') {
          finalEventSeq = data.seq
        }
        if (
          !context.privateAcceptedSpeechRoute &&
          typeof data?.turn_id === 'string' &&
          data.turn_id
        ) {
          streamTurnId = data.turn_id
        }

        const notableEvent =
          context.privateAcceptedSpeechRoute &&
          eventType !== MOTION_REQUESTED_EVENT_TYPE
            ? null
            : buildNotableThoughtCoreEvent(
                eventType,
                data as Record<string, unknown>,
                context.expectedConversationAttemptRef
              )
        if (notableEvent) {
          if (notableEvents.length < 24) {
            notableEvents.push(notableEvent)
          }
          if (
            typeof notableEvent.event_id === 'string' &&
            (eventType.startsWith('action.') ||
              eventType === 'tool.result' ||
              eventType === 'tool.started')
          ) {
            lastNotableActionEventId = notableEvent.event_id
          }
        }

        if (context.privateAcceptedSpeechRoute) {
          const presentationEvent = projectAcceptedPresentationEvent(
            eventType,
            data as Record<string, unknown>,
            context.expectedConversationAttemptRef,
            context.turnId,
            context.sessionId
          )
          if (presentationEvent) {
            if (eventType === 'assistant.speech_delta') {
              acceptedPresentationAssistantSeen = true
              presentationEvents.push(presentationEvent)
            } else if (eventType === MOTION_REQUESTED_EVENT_TYPE) {
              if (acceptedPresentationMotionSeen) {
                acceptedPresentationInvalid = true
              } else {
                acceptedPresentationMotionSeen = true
                presentationEvents.push(presentationEvent)
              }
            } else if (eventType === PROJECTION_EFFECT_INTENT_UPSTREAM_EVENT) {
              if (acceptedProjectionEffectIntentSeen) {
                acceptedPresentationInvalid = true
              } else {
                acceptedProjectionEffectIntentSeen = true
                presentationEvents.push(presentationEvent)
              }
            }
          } else if (
            eventType === 'assistant.speech_delta' ||
            eventType === MOTION_REQUESTED_EVENT_TYPE ||
            eventType === PROJECTION_EFFECT_INTENT_UPSTREAM_EVENT
          ) {
            acceptedPresentationInvalid = true
          }
        } else if (eventType === PROJECTION_EFFECT_INTENT_UPSTREAM_EVENT) {
          const projectionEvent = projectProjectionEffectIntentEvent(
            data as Record<string, unknown>,
            undefined,
            context.turnId,
            context.sessionId
          )
          if (projectionEvent) {
            forwardedLines.push(`data: ${JSON.stringify(projectionEvent)}`)
          }
        }

        const payload =
          data?.data && typeof data.data === 'object' ? data.data : {}
        const answer =
          eventType === 'assistant.speech_delta' &&
          typeof payload.delta === 'string'
            ? payload.delta
            : eventType === 'feedback.requested' &&
                typeof payload.speech === 'string'
              ? payload.speech
              : ''
        if (
          eventType === 'assistant.message' &&
          typeof payload.speech === 'string'
        ) {
          messageText = payload.speech
        }

        if (answer) {
          answerText = `${answerText}${answer}`
          answerChars += answer.length
          if (!context.privateAcceptedSpeechRoute) {
            answerPreview = truncate(`${answerPreview}${answer}`, 160)
          }
          if (!firstAnswerLogged) {
            firstAnswerLogged = true
            appendThoughtCoreTrace('stream_first_answer', {
              latency_ms: Date.now() - context.startedAt,
              query,
              ...traceContext(),
              thought_core_event: eventType,
              ...(context.privateAcceptedSpeechRoute
                ? {}
                : { answer_preview: truncate(answer, 80) }),
            })
          }
        }
      } catch {
        markInvalidStreamLine()
      }
    }
    return {
      presentationEvents,
      forwardedText:
        forwardedLines.length > 0 ? `${forwardedLines.join('\n')}\n` : '',
    }
  }

  const emptyProcessedLines = () => ({
    presentationEvents: [] as Record<string, unknown>[],
    forwardedText: '',
  })

  const processBufferedLine = () => {
    try {
      const rawLine = lineDecoder.decode(
        lineBuffer.subarray(0, lineBufferLength)
      )
      lineBufferLength = 0
      return processLines([rawLine])
    } catch {
      lineBufferLength = 0
      markInvalidStreamLine()
      return emptyProcessedLines()
    }
  }

  const processBytes = (bytes: Uint8Array) => {
    const presentationEvents: Record<string, unknown>[] = []
    let forwardedText = ''
    for (const byte of bytes) {
      if (byte === 0x0a) {
        if (discardingOversizedLine) {
          discardingOversizedLine = false
          lineBufferLength = 0
          continue
        }
        const processed = processBufferedLine()
        presentationEvents.push(...processed.presentationEvents)
        forwardedText += processed.forwardedText
        continue
      }
      if (discardingOversizedLine) continue
      if (lineBufferLength >= MAX_THOUGHT_CORE_SSE_LINE_UTF8_BYTES) {
        discardingOversizedLine = true
        lineBufferLength = 0
        markInvalidStreamLine()
        continue
      }
      lineBuffer[lineBufferLength] = byte
      lineBufferLength += 1
    }
    return { presentationEvents, forwardedText }
  }

  const flushBufferedLine = () => {
    if (discardingOversizedLine) {
      discardingOversizedLine = false
      lineBufferLength = 0
      return emptyProcessedLines()
    }
    return lineBufferLength > 0 ? processBufferedLine() : emptyProcessedLines()
  }

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) {
            if (lineBufferLength > 0 || discardingOversizedLine) {
              const processed = flushBufferedLine()
              if (
                !context.privateAcceptedSpeechRoute &&
                processed.forwardedText
              ) {
                controller.enqueue(encoder.encode(processed.forwardedText))
              }
              for (const event of processed.presentationEvents) {
                controller.enqueue(
                  encoder.encode(`data: ${JSON.stringify(event)}\n\n`)
                )
              }
            }
            if (
              context.privateAcceptedSpeechRoute &&
              context.expectedConversationAttemptRef &&
              acceptedPresentationAssistantSeen &&
              !acceptedPresentationInvalid
            ) {
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({
                    type: ACCEPTED_PRESENTATION_COMPLETED_EVENT,
                    data: {
                      conversation_attempt_ref:
                        context.expectedConversationAttemptRef,
                    },
                  })}\n\n`
                )
              )
            }
            logCompletion('stream_completed')
            controller.close()
            reader.releaseLock()
            return
          }

          if (value) {
            const processed = processBytes(value)
            if (context.privateAcceptedSpeechRoute) {
              for (const event of processed.presentationEvents) {
                controller.enqueue(
                  encoder.encode(`data: ${JSON.stringify(event)}\n\n`)
                )
              }
              if (processed.presentationEvents.length > 0) return
            }
            if (!context.privateAcceptedSpeechRoute) {
              if (processed.forwardedText) {
                controller.enqueue(encoder.encode(processed.forwardedText))
                return
              }
            }
          }
        }
      } catch (error) {
        const detail = context.privateAcceptedSpeechRoute
          ? ACCEPTED_PRIVATE_STREAM_ERROR
          : error instanceof Error
            ? error.message
            : String(error)
        logCompletion('stream_exception', {
          detail,
        })
        controller.error(
          context.privateAcceptedSpeechRoute ? new Error(detail) : error
        )
        reader.releaseLock()
      }
    },
    cancel(reason) {
      const detail = context.privateAcceptedSpeechRoute
        ? ACCEPTED_PRIVATE_STREAM_CANCELLED
        : reason instanceof Error
          ? reason.message
          : String(reason ?? '')
      logCompletion('stream_cancelled', {
        detail,
      })
      return reader.cancel(context.privateAcceptedSpeechRoute ? detail : reason)
    },
  })
}

const MINIMAL_TEXT_MODE = 'minimal-transient-text-v1'
const MINIMAL_TEXT_TOKEN = /^[A-Za-z0-9_.:-]{1,180}$/

async function readMinimalTextResponse(
  body: ReadableStream<Uint8Array> | null,
  sessionId: string,
  turnId: string
) {
  if (!body) throw new Error()
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let byteLength = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      byteLength += value.byteLength
      if (byteLength > 65_536) {
        await reader.cancel().catch(() => undefined)
        throw new Error()
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const bounded = new Uint8Array(byteLength)
  let offset = 0
  for (const chunk of chunks) {
    bounded.set(chunk, offset)
    offset += chunk.byteLength
  }
  const wire = new TextDecoder('utf-8', { fatal: true }).decode(bounded)
  if (!wire) throw new Error()
  const events = wire
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => {
      if (!line.startsWith('data:')) throw new Error()
      const json = line.slice(5).trim()
      if (scanJsonForDuplicateObjectKeys(json) !== 'unique') throw new Error()
      const event = JSON.parse(json)
      if (
        !isRecord(event) ||
        !isRecord(event.data) ||
        event.session_id !== sessionId ||
        event.turn_id !== turnId
      ) {
        throw new Error()
      }
      return event
    })
  const types = events.map((event) => event.type)
  const deltaIndex = types[1] === 'assistant.speech_delta' ? 1 : -1
  if (
    types.length !== (deltaIndex === 1 ? 4 : 3) ||
    types[0] !== 'agentic.decision' ||
    types[deltaIndex === 1 ? 2 : 1] !== 'assistant.message' ||
    types[deltaIndex === 1 ? 3 : 2] !== 'turn.completed'
  ) {
    throw new Error()
  }
  const decision = events[0].data as Record<string, unknown>
  const delta =
    deltaIndex === 1 ? (events[1].data as Record<string, unknown>) : null
  const message = events[deltaIndex === 1 ? 2 : 1].data as Record<
    string,
    unknown
  >
  const completed = events[deltaIndex === 1 ? 3 : 2].data as Record<
    string,
    unknown
  >
  const assistantMessageId = message.assistant_message_id
  const response =
    typeof message.display === 'string' ? message.display.trim() : ''
  if (
    decision.status !== 'accepted' ||
    decision.semantic_authority !== 'agentic_provider' ||
    decision.capability_present !== false ||
    typeof assistantMessageId !== 'string' ||
    !MINIMAL_TEXT_TOKEN.test(assistantMessageId) ||
    !response ||
    response.length > 8_000 ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(response) ||
    (delta &&
      (delta.assistant_message_id !== assistantMessageId ||
        typeof delta.delta !== 'string' ||
        !delta.delta.trim())) ||
    completed.status !== 'response' ||
    completed.semantic_authority !== 'agentic_provider' ||
    completed.capability_executed !== false
  ) {
    throw new Error()
  }
  return { sessionId, turnId, assistantMessageId, response }
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return res.status(405).json({
      error: 'ThoughtCore Method Not Allowed',
      errorCode: 'MethodNotAllowed',
    })
  }
  if (!enforceLocalApiRequest(req, res, { feature: 'thoughtCoreChat' })) {
    return
  }

  const requestBody = isRecord(req.body) ? req.body : {}
  const requestMode = req.headers?.['x-sword-ait-request-mode']
  const requestKeys = Object.keys(requestBody).sort()
  const hasExactMinimalKeys = requestKeys.join(',') === 'query,sessionId,turnId'
  if (requestMode !== undefined || hasExactMinimalKeys) {
    const query =
      typeof requestBody.query === 'string' ? requestBody.query.trim() : ''
    const sessionId = requestBody.sessionId
    const turnId = requestBody.turnId
    if (
      requestMode !== MINIMAL_TEXT_MODE ||
      !hasExactMinimalKeys ||
      !query ||
      query.length > 8_000 ||
      typeof sessionId !== 'string' ||
      !MINIMAL_TEXT_TOKEN.test(sessionId) ||
      typeof turnId !== 'string' ||
      !MINIMAL_TEXT_TOKEN.test(turnId)
    ) {
      return res.status(400).json({ error: 'minimal_text_request_failed' })
    }
    try {
      const upstream = await fetch(
        `${resolveThoughtCoreBaseUrl(undefined)}/turn?stream=true`,
        {
          method: 'POST',
          redirect: 'manual',
          headers: {
            Accept: 'text/event-stream',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            text: query,
            session_id: sessionId,
            turn_id: turnId,
            locale: process.env.THOUGHT_CORE_LOCALE || 'ja-JP',
            context_refs: {
              source: 'aituber-kit',
              route: 'projection-visual',
            },
          }),
        }
      )
      if (upstream.status >= 300 && upstream.status < 400) throw new Error()
      if (!upstream.ok) throw new Error()
      return res
        .status(200)
        .json(await readMinimalTextResponse(upstream.body, sessionId, turnId))
    } catch {
      return res.status(502).json({ error: 'minimal_text_request_failed' })
    }
  }
  const { query, url, sessionId, turnId, locale, contextRefs, stream } =
    requestBody
  const startedAt = Date.now()
  const hasAcceptedSpeechEnvelope =
    'accepted_user_speech_candidate' in requestBody ||
    'private_turn' in requestBody
  const acceptedSpeechEnvelope = hasAcceptedSpeechEnvelope
    ? readAcceptedPreparedSampleSpeechEnvelope(requestBody)
    : null
  if (hasAcceptedSpeechEnvelope && !acceptedSpeechEnvelope) {
    appendThoughtCoreTrace('config_error', {
      detail: 'accepted prepared-sample speech envelope is invalid',
    })
    return res.status(400).json({
      error: 'Accepted prepared-sample speech envelope is invalid',
      errorCode: 'AIInvalidProperty',
    })
  }

  const isAcceptedSpeechRoute = Boolean(acceptedSpeechEnvelope)
  const text = acceptedSpeechEnvelope
    ? acceptedSpeechEnvelope.private_turn.text
    : typeof query === 'string'
      ? query.trim()
      : ''
  if (!text) {
    appendThoughtCoreTrace('config_error', {
      detail: 'query is empty',
    })
    return res.status(400).json({
      error: 'Thought Core query is empty',
      errorCode: 'AIInvalidProperty',
    })
  }

  let baseUrl = ''
  try {
    baseUrl = resolveThoughtCoreBaseUrl(url)
  } catch (error) {
    const detail = isAcceptedSpeechRoute
      ? error instanceof Error &&
        error.message === ACCEPTED_PRIVATE_STREAM_ERROR
        ? ACCEPTED_PRIVATE_STREAM_ERROR
        : ACCEPTED_PRIVATE_UPSTREAM_EXCEPTION
      : error instanceof Error
        ? error.message
        : String(error)
    appendThoughtCoreTrace('config_error', {
      detail,
      ...(isAcceptedSpeechRoute ? {} : { query: truncate(text, 180) }),
    })
    return res.status(400).json({
      error: 'Thought Core Invalid URL',
      errorCode: 'AIInvalidProperty',
    })
  }

  const requestSessionId = acceptedSpeechEnvelope
    ? acceptedSpeechEnvelope.private_turn.session_id
    : typeof sessionId === 'string' && sessionId.trim()
      ? sessionId.trim()
      : process.env.THOUGHT_CORE_SESSION_ID || 'aituber-kit'
  const requestLocale =
    acceptedSpeechEnvelope?.private_turn.locale ??
    (typeof locale === 'string' && locale.trim()
      ? locale.trim()
      : process.env.THOUGHT_CORE_LOCALE || 'ja-JP')
  const requestContextRefs: Record<string, unknown> =
    contextRefs &&
    typeof contextRefs === 'object' &&
    !Array.isArray(contextRefs)
      ? (contextRefs as Record<string, unknown>)
      : {}

  const requestTurnId = acceptedSpeechEnvelope
    ? acceptedSpeechEnvelope.private_turn.turn_id
    : buildTurnId(turnId)
  const payload =
    acceptedSpeechEnvelope ??
    ({
      text,
      turn_id: requestTurnId,
      session_id: requestSessionId,
      locale: requestLocale,
      context_refs: {
        source: 'aituber-kit',
        route: 'projection-visual',
        ...requestContextRefs,
      },
    } as const)
  const shouldStream = isAcceptedSpeechRoute || stream !== false
  const traceQuery = isAcceptedSpeechRoute
    ? 'accepted_prepared_sample_private_turn'
    : truncate(text, 180)

  if (!isAcceptedSpeechRoute) {
    appendConversationLog('user', text, {
      source: 'aituber-kit',
      route: 'projection-visual',
      turn_id: requestTurnId,
      session_id: requestSessionId,
      issue_id:
        typeof requestContextRefs.issue_id === 'string'
          ? requestContextRefs.issue_id
          : typeof requestContextRefs.issueId === 'string'
            ? requestContextRefs.issueId
            : null,
    })
  }
  appendThoughtCoreTrace('request_started', {
    query: traceQuery,
    turn_id: requestTurnId,
    session_id: requestSessionId,
    response_mode: shouldStream ? 'streaming' : 'blocking',
    thought_core_url: baseUrl,
  })

  try {
    const response = await fetch(
      `${baseUrl}/turn${shouldStream ? '?stream=true' : ''}`,
      {
        method: 'POST',
        headers: {
          Accept: shouldStream ? 'text/event-stream' : 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      }
    )

    if (!response.ok) {
      const detail = isAcceptedSpeechRoute
        ? ACCEPTED_PRIVATE_UPSTREAM_HTTP_ERROR
        : await readThoughtCoreErrorDetail(response)
      appendThoughtCoreTrace('request_failed', {
        status: response.status,
        status_text: isAcceptedSpeechRoute
          ? ACCEPTED_PRIVATE_UPSTREAM_HTTP_ERROR
          : response.statusText,
        detail,
        latency_ms: Date.now() - startedAt,
        query: traceQuery,
        turn_id: requestTurnId,
        session_id: requestSessionId,
      })
      console.error(
        'Thought Core API request failed:',
        isAcceptedSpeechRoute
          ? {
              status: response.status,
              errorClass: ACCEPTED_PRIVATE_UPSTREAM_HTTP_ERROR,
            }
          : {
              status: response.status,
              statusText: response.statusText,
              url: baseUrl,
              detail,
            }
      )

      return res.status(response.status).json({
        error: isAcceptedSpeechRoute
          ? 'Accepted private Thought Core upstream request failed'
          : 'Thought Core API request failed',
        errorCode: 'AIAPIError',
        detail,
      })
    }

    if (shouldStream) {
      if (isAcceptedSpeechRoute && !response.body) {
        throw new Error(ACCEPTED_PRIVATE_STREAM_ERROR)
      }
      appendThoughtCoreTrace('stream_opened', {
        status: response.status,
        latency_ms: Date.now() - startedAt,
        query: traceQuery,
        turn_id: requestTurnId,
        session_id: requestSessionId,
      })
      const streamResponse = new Response(
        createTracedThoughtCoreStream(response.body, {
          query: traceQuery,
          startedAt,
          turnId: requestTurnId,
          sessionId: requestSessionId,
          privateAcceptedSpeechRoute: isAcceptedSpeechRoute,
          expectedConversationAttemptRef:
            acceptedSpeechEnvelope?.private_turn.context_refs
              .conversation_attempt_ref,
        }),
        {
          headers: { 'Content-Type': 'text/event-stream' },
        }
      )
      return await pipeResponse(streamResponse, res)
    }

    const data = await response.json()
    if (!isAcceptedSpeechRoute) {
      appendConversationLog('assistant', extractResponseText(data), {
        source: 'thought-core',
        route: 'projection-visual',
        event: 'request_succeeded',
        turn_id: requestTurnId,
        session_id: requestSessionId,
        latency_ms: Date.now() - startedAt,
      })
    }
    appendThoughtCoreTrace('request_succeeded', {
      status: response.status,
      latency_ms: Date.now() - startedAt,
      query: traceQuery,
      turn_id: requestTurnId,
      session_id: requestSessionId,
    })
    return res.status(200).json(data)
  } catch (error) {
    const detail = isAcceptedSpeechRoute
      ? ACCEPTED_PRIVATE_UPSTREAM_EXCEPTION
      : error instanceof Error
        ? error.message
        : String(error)
    appendThoughtCoreTrace('request_exception', {
      detail,
      latency_ms: Date.now() - startedAt,
      query: traceQuery,
      turn_id: requestTurnId,
      session_id: requestSessionId,
    })
    console.error(
      'Error in Thought Core API call:',
      isAcceptedSpeechRoute ? { errorClass: detail } : error
    )
    return res.status(500).json({
      error: isAcceptedSpeechRoute
        ? detail === ACCEPTED_PRIVATE_STREAM_ERROR
          ? 'Accepted private Thought Core stream error'
          : 'Accepted private Thought Core upstream exception'
        : 'Thought Core Internal Server Error',
      errorCode: 'AIAPIError',
      detail,
    })
  }
}

function extractResponseText(data: unknown): string {
  if (!data || typeof data !== 'object') return ''
  const payload = data as Record<string, unknown>
  if (typeof payload.text === 'string') return payload.text
  if (typeof payload.answer === 'string') return payload.answer
  const response = payload.response
  if (response && typeof response === 'object') {
    const responsePayload = response as Record<string, unknown>
    if (typeof responsePayload.text === 'string') return responsePayload.text
    if (typeof responsePayload.answer === 'string')
      return responsePayload.answer
  }
  return ''
}
