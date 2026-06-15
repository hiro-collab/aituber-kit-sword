import { NextApiRequest, NextApiResponse } from 'next'
import { pipeResponse } from '@/utils/pipeResponse'
import fs from 'fs'
import path from 'path'
import { enforceLocalApiRequest } from '@/utils/localApiSecurity'

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
const MOTION_HOME_CONTROL_TRACE_KEYS = new Set([
  'action',
  'action_id',
  'action_type',
  'appliance',
  'appliance_id',
  'contains_home_control_route',
  'entity_id',
  'ha_entity_id',
  'home_action',
  'home_control',
  'home_control_route',
  'is_home_action',
  'target',
])
const RAW_TEXT_KEYS =
  /(?:^|_)(?:answer|content|delta|message|prompt|query|raw|speech|text|transcript|utterance)(?:_|$)/i
const SENSITIVE_TRACE_KEYS =
  /(?:authorization|credential|password|secret|token|api[_-]?key|confirmation)/i

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

function omitMotionHomeControlTraceKeys(
  value: Record<string, unknown>
): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, nestedValue] of Object.entries(value)) {
    if (MOTION_HOME_CONTROL_TRACE_KEYS.has(key)) continue
    if (
      nestedValue &&
      typeof nestedValue === 'object' &&
      !Array.isArray(nestedValue)
    ) {
      const nested = omitMotionHomeControlTraceKeys(
        nestedValue as Record<string, unknown>
      )
      if (Object.keys(nested).length > 0) {
        result[key] = nested
      }
      continue
    }
    result[key] = nestedValue
  }
  return result
}

function buildNotableThoughtCoreEvent(
  eventType: string,
  data: Record<string, unknown>
): Record<string, unknown> | null {
  if (!NOTABLE_THOUGHT_CORE_EVENTS.has(eventType)) return null
  const payload =
    data?.data && typeof data.data === 'object'
      ? (data.data as Record<string, unknown>)
      : {}
  const rawSummary = toSafeTraceObject(payload)
  const summary =
    eventType === MOTION_REQUESTED_EVENT_TYPE
      ? omitMotionHomeControlTraceKeys(rawSummary)
      : rawSummary
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
      pathExists(path.join(current, 'sword-control-plane')) ||
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

function createTracedThoughtCoreStream(
  body: ReadableStream<Uint8Array> | null,
  context: {
    query: unknown
    startedAt: number
    turnId?: string
    sessionId?: string
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
      answer_preview: answerPreview,
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
    if (finalAnswer) {
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
        const eventType = typeof data?.type === 'string' ? data.type : 'unknown'
        eventCounts[eventType] = (eventCounts[eventType] || 0) + 1
        if (typeof data?.event_id === 'string' && data.event_id) {
          finalEventId = data.event_id
        }
        if (typeof data?.seq === 'number') {
          finalEventSeq = data.seq
        }
        if (typeof data?.turn_id === 'string' && data.turn_id) {
          streamTurnId = data.turn_id
        }

        const notableEvent = buildNotableThoughtCoreEvent(
          eventType,
          data as Record<string, unknown>
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
          answerPreview = truncate(`${answerPreview}${answer}`, 160)
          if (!firstAnswerLogged) {
            firstAnswerLogged = true
            appendThoughtCoreTrace('stream_first_answer', {
              latency_ms: Date.now() - context.startedAt,
              query,
              ...traceContext(),
              thought_core_event: eventType,
              answer_preview: truncate(answer, 80),
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
          controller.enqueue(value)
        }
      } catch (error) {
        logCompletion('stream_exception', {
          detail: error instanceof Error ? error.message : String(error),
        })
        controller.error(error)
        reader.releaseLock()
      }
    },
    cancel(reason) {
      logCompletion('stream_cancelled', {
        detail: reason instanceof Error ? reason.message : String(reason ?? ''),
      })
      return reader.cancel(reason)
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

  const { query, url, sessionId, turnId, locale, contextRefs, stream } =
    req.body
  const startedAt = Date.now()
  const text = typeof query === 'string' ? query.trim() : ''
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
    appendThoughtCoreTrace('config_error', {
      detail: error instanceof Error ? error.message : String(error),
      query: truncate(text, 180),
    })
    return res.status(400).json({
      error: 'Thought Core Invalid URL',
      errorCode: 'AIInvalidProperty',
    })
  }

  const requestSessionId =
    typeof sessionId === 'string' && sessionId.trim()
      ? sessionId.trim()
      : process.env.THOUGHT_CORE_SESSION_ID || 'aituber-kit'
  const requestLocale =
    typeof locale === 'string' && locale.trim()
      ? locale.trim()
      : process.env.THOUGHT_CORE_LOCALE || 'ja-JP'
  const requestContextRefs: Record<string, unknown> =
    contextRefs &&
    typeof contextRefs === 'object' &&
    !Array.isArray(contextRefs)
      ? (contextRefs as Record<string, unknown>)
      : {}

  const payload = {
    text,
    turn_id: buildTurnId(turnId),
    session_id: requestSessionId,
    locale: requestLocale,
    context_refs: {
      source: 'aituber-kit',
      route: 'projection-visual',
      ...requestContextRefs,
    },
  }
  const shouldStream = stream !== false

  appendConversationLog('user', text, {
    source: 'aituber-kit',
    route: 'projection-visual',
    turn_id: payload.turn_id,
    session_id: requestSessionId,
    issue_id:
      typeof requestContextRefs.issue_id === 'string'
        ? requestContextRefs.issue_id
        : typeof requestContextRefs.issueId === 'string'
          ? requestContextRefs.issueId
          : null,
  })
  appendThoughtCoreTrace('request_started', {
    query: truncate(text, 180),
    turn_id: payload.turn_id,
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
      const detail = await readThoughtCoreErrorDetail(response)
      appendThoughtCoreTrace('request_failed', {
        status: response.status,
        status_text: response.statusText,
        detail,
        latency_ms: Date.now() - startedAt,
        query: truncate(text, 180),
        turn_id: payload.turn_id,
        session_id: requestSessionId,
      })
      console.error('Thought Core API request failed:', {
        status: response.status,
        statusText: response.statusText,
        url: baseUrl,
        detail,
      })

      return res.status(response.status).json({
        error: 'Thought Core API request failed',
        errorCode: 'AIAPIError',
        detail,
      })
    }

    if (shouldStream) {
      appendThoughtCoreTrace('stream_opened', {
        status: response.status,
        latency_ms: Date.now() - startedAt,
        query: truncate(text, 180),
        turn_id: payload.turn_id,
        session_id: requestSessionId,
      })
      const streamResponse = new Response(
        createTracedThoughtCoreStream(response.body, {
          query: text,
          startedAt,
          turnId: payload.turn_id,
          sessionId: requestSessionId,
        }),
        {
          headers: { 'Content-Type': 'text/event-stream' },
        }
      )
      return pipeResponse(streamResponse, res)
    }

    const data = await response.json()
    appendConversationLog('assistant', extractResponseText(data), {
      source: 'thought-core',
      route: 'projection-visual',
      event: 'request_succeeded',
      turn_id: payload.turn_id,
      session_id: requestSessionId,
      latency_ms: Date.now() - startedAt,
    })
    appendThoughtCoreTrace('request_succeeded', {
      status: response.status,
      latency_ms: Date.now() - startedAt,
      query: truncate(text, 180),
      turn_id: payload.turn_id,
      session_id: requestSessionId,
    })
    return res.status(200).json(data)
  } catch (error) {
    appendThoughtCoreTrace('request_exception', {
      detail: error instanceof Error ? error.message : String(error),
      latency_ms: Date.now() - startedAt,
      query: truncate(text, 180),
      turn_id: payload.turn_id,
      session_id: requestSessionId,
    })
    console.error('Error in Thought Core API call:', error)
    return res.status(500).json({
      error: 'Thought Core Internal Server Error',
      errorCode: 'AIAPIError',
      detail: error instanceof Error ? error.message : String(error),
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
