import { NextApiRequest, NextApiResponse } from 'next'
import { pipeResponse } from '@/utils/pipeResponse'
import fs from 'fs'
import path from 'path'
import { enforceLocalApiRequest } from '@/utils/localApiSecurity'
import {
  createAcceptedPreparedSampleSpeechEnvelope,
  type AcceptedPreparedSampleSpeechEnvelope,
} from '@/utils/preparedSampleBrowserStt'
import { safeConversationAttemptRef } from '@/utils/speechOutputParitySummary'

const DEFAULT_THOUGHT_CORE_BASE_URL = 'http://127.0.0.1:18888'

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
  host === '127.0.0.1' ||
  host === '::1' ||
  host.startsWith('127.')

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
  const decoder = new TextDecoder('utf-8')
  const eventCounts: Record<string, number> = {}
  let buffer = ''
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

  const processText = (text: string) => {
    buffer += text
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''

    for (const rawLine of lines) {
      const line = rawLine.trim()
      if (!line.startsWith('data:')) continue

      const jsonText = line.slice(5).trim()
      if (!jsonText) continue

      try {
        const data = JSON.parse(jsonText)
        const rawEventType =
          typeof data?.type === 'string' ? data.type : 'unknown'
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
        eventCounts.unparseable = (eventCounts.unparseable || 0) + 1
      }
    }
  }

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) {
            if (buffer) {
              processText('\n')
            }
            logCompletion('stream_completed')
            controller.close()
            reader.releaseLock()
            return
          }

          if (value) {
            processText(decoder.decode(value, { stream: true }))
          }
          if (!context.privateAcceptedSpeechRoute && value) {
            controller.enqueue(value)
            return
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
