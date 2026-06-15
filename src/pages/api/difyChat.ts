import { NextApiRequest, NextApiResponse } from 'next'
import { pipeResponse } from '@/utils/pipeResponse'
import fs from 'fs'
import path from 'path'
import { enforceLocalApiRequest } from '@/utils/localApiSecurity'

const truncate = (value: string, maxLength = 1200) =>
  value.length > maxLength ? `${value.slice(0, maxLength)}...` : value

const getWorkspaceRoot = () =>
  process.env.HOME_CONTROL_WORKSPACE_ROOT ||
  path.resolve(
    process.cwd(),
    process.cwd().endsWith('aituber-kit') ? '..' : '.'
  )

const DIFY_TRACE_FILE = path.join(
  getWorkspaceRoot(),
  '.cache',
  'home-control-stack',
  'dify-chat-events.jsonl'
)

const isLoopbackHost = (host: string) =>
  host === 'localhost' ||
  host === '127.0.0.1' ||
  host === '::1' ||
  host.startsWith('127.')

function appendDifyTrace(event: string, payload: Record<string, unknown> = {}) {
  try {
    fs.mkdirSync(path.dirname(DIFY_TRACE_FILE), { recursive: true })
    fs.appendFileSync(
      DIFY_TRACE_FILE,
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

function createTracedDifyStream(
  body: ReadableStream<Uint8Array> | null,
  context: { query: unknown; startedAt: number }
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
  let firstAnswerLogged = false
  let completedLogged = false

  const query = truncate(String(context.query ?? ''), 180)
  const logCompletion = (
    event: string,
    extra: Record<string, unknown> = {}
  ) => {
    if (completedLogged) return
    completedLogged = true
    appendDifyTrace(event, {
      latency_ms: Date.now() - context.startedAt,
      query,
      event_counts: eventCounts,
      answer_chars: answerChars,
      answer_preview: answerPreview,
      ...extra,
    })
  }

  const processText = (text: string) => {
    buffer += text
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''

    for (const rawLine of lines) {
      const line = rawLine.trim()
      if (!line.startsWith('data:')) continue

      const jsonText = line.slice(5).trim()
      if (!jsonText || jsonText === '[DONE]') continue

      try {
        const data = JSON.parse(jsonText)
        const difyEvent =
          typeof data?.event === 'string' ? data.event : 'unknown'
        eventCounts[difyEvent] = (eventCounts[difyEvent] || 0) + 1

        if (typeof data?.answer === 'string' && data.answer.length > 0) {
          answerChars += data.answer.length
          answerPreview = truncate(`${answerPreview}${data.answer}`, 160)
          if (!firstAnswerLogged) {
            firstAnswerLogged = true
            appendDifyTrace('stream_first_answer', {
              latency_ms: Date.now() - context.startedAt,
              query,
              dify_event: difyEvent,
              answer_preview: truncate(data.answer, 80),
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

async function readDifyErrorDetail(response: Response): Promise<string> {
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

function cleanDifyUrl(url: string): string {
  const trimmedUrl = url.trim().replace(/\/$/, '')
  return trimmedUrl.endsWith('/chat-messages')
    ? trimmedUrl
    : `${trimmedUrl}/chat-messages`
}

function validateDifyUrl(url: string): string {
  const cleaned = cleanDifyUrl(url)
  const parsed = new URL(cleaned)

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Dify URL must be an HTTP(S) URL')
  }
  if (parsed.username || parsed.password) {
    throw new Error('Dify URL must not include credentials')
  }
  if (parsed.protocol === 'http:' && !isLoopbackHost(parsed.hostname)) {
    throw new Error('Dify HTTP URL is only allowed for loopback hosts')
  }

  return cleaned
}

function getAllowedRequestUrl(requestUrl: unknown): string {
  const candidate = typeof requestUrl === 'string' ? requestUrl.trim() : ''
  if (!candidate) {
    return ''
  }

  const allowedUrls = (process.env.DIFY_ALLOWED_URLS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)

  if (allowedUrls.length === 0) {
    return ''
  }

  const cleanedCandidate = validateDifyUrl(candidate)
  const allowed = allowedUrls.some((allowedUrl) => {
    try {
      return validateDifyUrl(allowedUrl) === cleanedCandidate
    } catch {
      return false
    }
  })

  return allowed ? cleanedCandidate : ''
}

function resolveDifyUrl(requestUrl: unknown): string {
  const serverUrl = process.env.DIFY_API_URL || process.env.DIFY_URL || ''
  if (serverUrl.trim()) {
    return validateDifyUrl(serverUrl)
  }
  return getAllowedRequestUrl(requestUrl)
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return res.status(405).json({
      error: 'DifyMethod Not Allowed',
      errorCode: 'MethodNotAllowed',
    })
  }
  if (!enforceLocalApiRequest(req, res, { feature: 'difyChat' })) {
    return
  }

  const { query, apiKey, url, conversationId, stream } = req.body
  const startedAt = Date.now()

  const difyKey = process.env.DIFY_KEY || process.env.DIFY_API_KEY || apiKey
  if (!difyKey) {
    appendDifyTrace('config_error', {
      detail: 'Dify API key is empty',
      query: truncate(String(query ?? ''), 180),
    })
    return res
      .status(400)
      .json({ error: 'Dify Empty API Key', errorCode: 'EmptyAPIKey' })
  }
  let difyUrl = ''
  try {
    difyUrl = resolveDifyUrl(url)
  } catch (error) {
    appendDifyTrace('config_error', {
      detail: error instanceof Error ? error.message : String(error),
      query: truncate(String(query ?? ''), 180),
    })
    return res.status(400).json({
      error: 'Dify Invalid URL',
      errorCode: 'AIInvalidProperty',
    })
  }

  if (!difyUrl) {
    appendDifyTrace('config_error', {
      detail: 'Dify URL is empty or not allowed',
      query: truncate(String(query ?? ''), 180),
    })
    return res.status(400).json({
      error: 'Dify Empty URL',
      errorCode: 'AIInvalidProperty',
    })
  }

  const headers = {
    Authorization: `Bearer ${difyKey}`,
    'Content-Type': 'application/json',
  }
  const body = JSON.stringify({
    inputs: {},
    query: query,
    response_mode: stream ? 'streaming' : 'blocking',
    conversation_id: conversationId,
    user: 'aituber-kit',
    files: [],
  })

  appendDifyTrace('request_started', {
    query: truncate(String(query ?? ''), 180),
    response_mode: stream ? 'streaming' : 'blocking',
    conversation_id_present: Boolean(conversationId),
    dify_url: difyUrl.replace(
      /^http:\/\/localhost(?=:|\/|$)/,
      'http://127.0.0.1'
    ),
  })

  try {
    const response = await fetch(difyUrl, {
      method: 'POST',
      headers: headers,
      body: body,
    })

    if (!response.ok) {
      const detail = await readDifyErrorDetail(response)
      appendDifyTrace('request_failed', {
        status: response.status,
        status_text: response.statusText,
        detail,
        latency_ms: Date.now() - startedAt,
        query: truncate(String(query ?? ''), 180),
      })
      console.error('Dify API request failed:', {
        status: response.status,
        statusText: response.statusText,
        url: difyUrl,
        detail,
      })

      return res.status(response.status).json({
        error: 'Dify API request failed',
        errorCode: 'AIAPIError',
        detail,
      })
    }

    if (stream) {
      appendDifyTrace('stream_opened', {
        status: response.status,
        latency_ms: Date.now() - startedAt,
        query: truncate(String(query ?? ''), 180),
      })
      const streamResponse = new Response(
        createTracedDifyStream(response.body, { query, startedAt }),
        {
          headers: { 'Content-Type': 'text/event-stream' },
        }
      )
      return pipeResponse(streamResponse, res)
    } else {
      const data = await response.json()
      appendDifyTrace('request_succeeded', {
        status: response.status,
        latency_ms: Date.now() - startedAt,
        query: truncate(String(query ?? ''), 180),
        answer_length:
          typeof data?.answer === 'string' ? data.answer.length : undefined,
      })
      return res.status(200).json(data)
    }
  } catch (error) {
    appendDifyTrace('request_exception', {
      detail: error instanceof Error ? error.message : String(error),
      latency_ms: Date.now() - startedAt,
      query: truncate(String(query ?? ''), 180),
    })
    console.error('Error in Dify API call:', error)
    return res.status(500).json({
      error: 'Dify Internal Server Error',
      errorCode: 'AIAPIError',
      detail: error instanceof Error ? error.message : String(error),
    })
  }
}
