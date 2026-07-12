/**
 * @jest-environment node
 */

jest.mock('fs', () => ({
  mkdirSync: jest.fn(),
  appendFileSync: jest.fn(),
  existsSync: jest.fn(),
}))

import type { NextApiRequest, NextApiResponse } from 'next'
import path from 'path'
import { createAcceptedPreparedSampleSpeechEnvelope } from '@/utils/preparedSampleBrowserStt'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

function createMockReq(
  overrides: Partial<NextApiRequest> = {}
): NextApiRequest {
  return {
    method: 'POST',
    body: {},
    query: {},
    ...overrides,
  } as NextApiRequest
}

function createMockRes() {
  const res = {
    _status: 200,
    _json: null as unknown,
    _headers: {} as Record<string, string>,
    _chunks: [] as Uint8Array[],
    _ended: false,
    status(code: number) {
      res._status = code
      return res
    },
    json(data: unknown) {
      res._json = data
      return res
    },
    setHeader(key: string, value: string) {
      res._headers[key] = value
      return res
    },
    flushHeaders: jest.fn(),
    write(chunk: Uint8Array) {
      res._chunks.push(chunk)
      return true
    },
    end() {
      res._ended = true
      return res
    },
  }
  return res as unknown as NextApiResponse & {
    _status: number
    _json: unknown
    _headers: Record<string, string>
    _chunks: Uint8Array[]
    _ended: boolean
  }
}

const canonicalConversationAttemptRef =
  'm4.prepared_sample_attempt:0123456789abcdef0123456789abcdef'
const coreMotionEventId = 'evt_0123456789abcdef0123456789abcdef'
const coreMotionTimestamp = '2026-07-13T01:02:04.000Z'

function createCoreMotionRequestedEvent(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  const data = {
    schema_version: 'motion_stimulus.v0',
    motion_event_id: 'mot_evt_prepared_sample_001',
    stimulus_id: 'mot_stim_prepared_sample_expression',
    stimulus_instance_id: 'mot_inst_prepared_sample_001',
    source_class: 'user_command',
    source_family: 'user_or_operator_command',
    source_origin: 'thought_core',
    requested_at: coreMotionTimestamp,
    kind: 'expression',
    request_mode: 'apply',
    phase: 'queued',
    lifecycle_state: 'queued',
    safe_visible_state: 'requested',
    target_model_type: 'vrm',
    requirements: {
      required_tracks: ['expression'],
      provider_detail: 'SECRET_UNPROJECTED_NESTED_VALUE',
    },
    trace: {
      event_id: coreMotionEventId,
      turn_id: 'prepared_sample_browser_stt_0123456789abcdef0123456789abcdef',
      selection_id: 'mot_sel_prepared_sample_001',
      runtime_result_id: 'mot_res_prepared_sample_pending_001',
      motion_event_id: 'mot_evt_prepared_sample_001',
      stimulus_id: 'mot_stim_prepared_sample_expression',
      stimulus_instance_id: 'mot_inst_prepared_sample_001',
    },
    redaction: {
      redaction_status: 'summary_only',
    },
  }
  const overrideData = isRecord(overrides.data) ? overrides.data : {}
  return {
    type: 'motion.requested',
    event_id: coreMotionEventId,
    timestamp: coreMotionTimestamp,
    turn_id: 'prepared_sample_browser_stt_0123456789abcdef0123456789abcdef',
    session_id: 'prepared_sample_browser_stt_operator',
    seq: 1,
    source: 'thought-core',
    conversation_attempt_ref: canonicalConversationAttemptRef,
    ...overrides,
    data: { ...data, ...overrideData },
  }
}

async function readByteStream(
  stream: ReadableStream<Uint8Array> | null
): Promise<Uint8Array[]> {
  if (!stream) return []
  const chunks: Uint8Array[] = []
  const reader = stream.getReader()
  while (true) {
    const { done, value } = await reader.read()
    if (done) return chunks
    chunks.push(value)
  }
}

describe('/api/thoughtCoreChat', () => {
  const originalEnv = process.env
  let originalFetch: typeof global.fetch

  beforeEach(() => {
    jest.resetModules()
    jest.clearAllMocks()
    process.env = { ...originalEnv }
    delete process.env.THOUGHT_CORE_BASE_URL
    delete process.env.NEXT_PUBLIC_THOUGHT_CORE_BASE_URL
    delete process.env.THOUGHT_CORE_SESSION_ID
    delete process.env.THOUGHT_CORE_LOCALE
    delete process.env.HOME_CONTROL_STACK_STATE_DIR

    originalFetch = global.fetch
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue({ events: [] }),
    }) as any
  })

  afterEach(() => {
    process.env = originalEnv
    global.fetch = originalFetch
  })

  it('uses the server configured Thought Core URL instead of a request URL', async () => {
    process.env.THOUGHT_CORE_BASE_URL = 'http://127.0.0.1:18787'
    const handler = require('@/pages/api/thoughtCoreChat').default
    const res = createMockRes()

    await handler(
      createMockReq({
        body: {
          query: '電気つけて',
          url: 'http://evil.example.test:18787',
          sessionId: 'living',
          stream: false,
        },
      }),
      res
    )

    expect(res._status).toBe(200)
    expect(global.fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:18787/turn',
      expect.objectContaining({
        body: expect.stringContaining('"text":"電気つけて"'),
        headers: expect.objectContaining({
          Accept: 'application/json',
        }),
      })
    )
  })

  it('rejects non-loopback request URLs', async () => {
    const handler = require('@/pages/api/thoughtCoreChat').default
    const res = createMockRes()

    await handler(
      createMockReq({
        body: {
          query: 'hello',
          url: 'https://evil.example.test',
          stream: false,
        },
      }),
      res
    )

    expect(res._status).toBe(400)
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it.each([
    ['undefined', undefined],
    ['empty', ''],
    ['whitespace', '   '],
    ['number', 123],
    ['object', { text: 'hello' }],
    ['array', ['hello']],
  ])('rejects malformed query payload: %s', async (_label, query) => {
    const handler = require('@/pages/api/thoughtCoreChat').default
    const res = createMockRes()

    await handler(
      createMockReq({
        body: {
          query,
          stream: false,
        },
      }),
      res
    )

    expect(res._status).toBe(400)
    expect(res._json).toEqual({
      error: 'Thought Core query is empty',
      errorCode: 'AIInvalidProperty',
    })
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it.each([
    ['ftp protocol', 'ftp://127.0.0.1:18787'],
    ['credentials', 'http://user:pass@127.0.0.1:18787'],
    ['private network', 'http://192.168.0.2:18787'],
    ['public host', 'https://example.com'],
    ['invalid URL', 'http://[::1'],
  ])('rejects unsafe Thought Core URL: %s', async (_label, url) => {
    const handler = require('@/pages/api/thoughtCoreChat').default
    const res = createMockRes()

    await handler(
      createMockReq({
        body: {
          query: 'hello',
          url,
          stream: false,
        },
      }),
      res
    )

    expect(res._status).toBe(400)
    expect(res._json).toEqual({
      error: 'Thought Core Invalid URL',
      errorCode: 'AIInvalidProperty',
    })
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('ignores non-object contextRefs when building Thought Core payload', async () => {
    const handler = require('@/pages/api/thoughtCoreChat').default
    const res = createMockRes()

    await handler(
      createMockReq({
        body: {
          query: 'hello',
          contextRefs: ['not', 'an', 'object'],
          stream: false,
        },
      }),
      res
    )

    expect(res._status).toBe(200)
    const fetchCall = (global.fetch as jest.Mock).mock.calls[0]
    const body = JSON.parse(fetchCall[1].body)
    expect(body.context_refs).toEqual({
      source: 'aituber-kit',
      route: 'projection-visual',
    })
  })

  it('forwards one exact accepted candidate/private turn and records only the validated motion envelope ref', async () => {
    const stateDir = path.resolve('C:/tmp/home-control-stack-live')
    process.env.HOME_CONTROL_STACK_STATE_DIR = stateDir
    const envelope = createAcceptedPreparedSampleSpeechEnvelope({
      conversationAttemptRef: canonicalConversationAttemptRef,
      selectedSampleId: 'voice.local_sample_001',
      recognizedText: 'SECRET_PRIVATE_PREPARED_SPEECH',
      generatedAt: '2026-07-13T01:02:03.000Z',
    })
    const encoder = new TextEncoder()
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify(createCoreMotionRequestedEvent())}\n\n`
          )
        )
        controller.close()
      },
    })
    global.fetch = jest.fn().mockResolvedValue(
      new Response(body, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      })
    ) as any
    const handler = require('@/pages/api/thoughtCoreChat').default
    const mockedFs = jest.requireMock('fs') as {
      appendFileSync: jest.Mock
    }
    const res = createMockRes()

    await handler(
      createMockReq({
        body: {
          ...envelope,
          stream: true,
          contextRefs: {
            conversation_attempt_ref:
              'm4.prepared_sample_attempt:fedcba9876543210fedcba9876543210',
            arbitrary_payload: 'SECRET_ARBITRARY_CONTEXT',
          },
        },
      }),
      res
    )

    expect(res._status).toBe(200)
    expect(res._chunks).toEqual([])
    expect(global.fetch).toHaveBeenCalledTimes(1)
    const coreBody = JSON.parse(
      (global.fetch as jest.Mock).mock.calls[0][1].body
    )
    expect(coreBody).toEqual(envelope)
    const traceLines = mockedFs.appendFileSync.mock.calls
      .filter(([filePath]) =>
        String(filePath).endsWith('thought-core-chat-events.jsonl')
      )
      .map(([, line]) => JSON.parse(String(line)))
    const completed = traceLines.find(
      (event) => event.event === 'stream_completed'
    )
    expect(completed.notable_events).toEqual([
      expect.objectContaining({
        type: 'motion.requested',
        event_id: coreMotionEventId,
        timestamp: coreMotionTimestamp,
        conversation_attempt_ref: canonicalConversationAttemptRef,
        summary: {
          schema_version: 'motion_stimulus.v0',
          motion_event_id: 'mot_evt_prepared_sample_001',
          stimulus_id: 'mot_stim_prepared_sample_expression',
          stimulus_instance_id: 'mot_inst_prepared_sample_001',
          phase: 'queued',
          lifecycle_state: 'queued',
          safe_visible_state: 'requested',
          requested_at: coreMotionTimestamp,
          trace: { event_id: coreMotionEventId },
        },
      }),
    ])
    const serializedTrace = JSON.stringify(traceLines)
    expect(serializedTrace).not.toContain('SECRET_PRIVATE_PREPARED_SPEECH')
    expect(serializedTrace).not.toContain('SECRET_UNPROJECTED_NESTED_VALUE')
    expect(serializedTrace).not.toContain('SECRET_ARBITRARY_CONTEXT')
    expect(serializedTrace).not.toContain(
      'm4.prepared_sample_attempt:fedcba9876543210fedcba9876543210'
    )
  })

  it.each([
    ['missing', undefined],
    ['malformed', 'raw-private-marker'],
    ['path-like', 'C:\\private\\attempt.wav'],
    ['oversized', `m4.prepared_sample_attempt:${'0'.repeat(33)}`],
    ['changed', 'm4.prepared_sample_attempt:fedcba9876543210fedcba9876543210'],
  ])(
    'rejects a %s accepted-speech ref with a fixed non-echoing error',
    async (_label, replacementRef) => {
      const envelope = createAcceptedPreparedSampleSpeechEnvelope({
        conversationAttemptRef:
          'm4.prepared_sample_attempt:0123456789abcdef0123456789abcdef',
        selectedSampleId: 'voice.local_sample_001',
        recognizedText: 'SECRET_PRIVATE_PREPARED_SPEECH',
        generatedAt: '2026-07-13T01:02:03.000Z',
      }) as any
      if (replacementRef === undefined) {
        delete envelope.private_turn.context_refs.conversation_attempt_ref
      } else {
        envelope.private_turn.context_refs.conversation_attempt_ref =
          replacementRef
      }
      const handler = require('@/pages/api/thoughtCoreChat').default
      const res = createMockRes()

      await handler(createMockReq({ body: envelope }), res)

      expect(res._status).toBe(400)
      expect(res._json).toEqual({
        error: 'Accepted prepared-sample speech envelope is invalid',
        errorCode: 'AIInvalidProperty',
      })
      expect(JSON.stringify(res._json)).not.toContain(String(replacementRef))
      expect(global.fetch).not.toHaveBeenCalled()
    }
  )

  it('normalizes an accepted-route upstream HTTP body in trace, console, and API response', async () => {
    const envelope = createAcceptedPreparedSampleSpeechEnvelope({
      conversationAttemptRef: canonicalConversationAttemptRef,
      selectedSampleId: 'voice.local_sample_001',
      recognizedText: 'SECRET_PRIVATE_PREPARED_SPEECH',
      generatedAt: '2026-07-13T01:02:03.000Z',
    })
    global.fetch = jest.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          detail: 'SECRET_PROVIDER_HTTP_BODY_C:\\private\\provider.json',
        }),
        {
          status: 502,
          statusText: 'SECRET_PROVIDER_STATUS_TEXT',
          headers: { 'content-type': 'application/json' },
        }
      )
    ) as any
    const consoleError = jest
      .spyOn(console, 'error')
      .mockImplementation(() => {})
    const handler = require('@/pages/api/thoughtCoreChat').default
    const res = createMockRes()

    await handler(createMockReq({ body: { ...envelope, stream: true } }), res)

    expect(res._status).toBe(502)
    expect(res._json).toEqual({
      error: 'Accepted private Thought Core upstream request failed',
      errorCode: 'AIAPIError',
      detail: 'accepted_private_upstream_http_error',
    })
    const mockedFs = jest.requireMock('fs') as {
      appendFileSync: jest.Mock
    }
    const serialized = JSON.stringify({
      response: res._json,
      console: consoleError.mock.calls,
      traces: mockedFs.appendFileSync.mock.calls,
    })
    expect(serialized).toContain('accepted_private_upstream_http_error')
    expect(serialized).not.toContain('SECRET_PROVIDER_HTTP_BODY')
    expect(serialized).not.toContain('SECRET_PROVIDER_STATUS_TEXT')
    expect(serialized).not.toContain('private\\provider.json')
    consoleError.mockRestore()
  })

  it('normalizes an accepted-route thrown exception in trace, console, and API response', async () => {
    const envelope = createAcceptedPreparedSampleSpeechEnvelope({
      conversationAttemptRef: canonicalConversationAttemptRef,
      selectedSampleId: 'voice.local_sample_001',
      recognizedText: 'SECRET_PRIVATE_PREPARED_SPEECH',
      generatedAt: '2026-07-13T01:02:03.000Z',
    })
    global.fetch = jest
      .fn()
      .mockRejectedValue(
        new Error('SECRET_THROWN_PROVIDER_PATH_C:\\private\\provider.json')
      ) as any
    const consoleError = jest
      .spyOn(console, 'error')
      .mockImplementation(() => {})
    const handler = require('@/pages/api/thoughtCoreChat').default
    const res = createMockRes()

    await handler(createMockReq({ body: { ...envelope, stream: true } }), res)

    expect(res._status).toBe(500)
    expect(res._json).toEqual({
      error: 'Accepted private Thought Core upstream exception',
      errorCode: 'AIAPIError',
      detail: 'accepted_private_upstream_exception',
    })
    const mockedFs = jest.requireMock('fs') as {
      appendFileSync: jest.Mock
    }
    const serialized = JSON.stringify({
      response: res._json,
      console: consoleError.mock.calls,
      traces: mockedFs.appendFileSync.mock.calls,
    })
    expect(serialized).toContain('accepted_private_upstream_exception')
    expect(serialized).not.toContain('SECRET_THROWN_PROVIDER_PATH')
    expect(serialized).not.toContain('private\\provider.json')
    consoleError.mockRestore()
  })

  it('normalizes accepted-route stream errors before trace or client publication', async () => {
    const {
      createTracedThoughtCoreStream,
    } = require('@/pages/api/thoughtCoreChat')
    const upstream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(
          new Error('SECRET_STREAM_PROVIDER_PATH_C:\\private\\stream.json')
        )
      },
    })
    const traced = createTracedThoughtCoreStream(upstream, {
      query: 'accepted_prepared_sample_private_turn',
      startedAt: Date.now(),
      turnId: 'prepared_sample_browser_stt_0123456789abcdef0123456789abcdef',
      sessionId: 'prepared_sample_browser_stt_operator',
      privateAcceptedSpeechRoute: true,
      expectedConversationAttemptRef: canonicalConversationAttemptRef,
    })

    await expect(readByteStream(traced)).rejects.toThrow(
      'accepted_private_stream_error'
    )
    const mockedFs = jest.requireMock('fs') as {
      appendFileSync: jest.Mock
    }
    const serialized = JSON.stringify(mockedFs.appendFileSync.mock.calls)
    expect(serialized).toContain('accepted_private_stream_error')
    expect(serialized).not.toContain('SECRET_STREAM_PROVIDER_PATH')
    expect(serialized).not.toContain('private\\stream.json')
  })

  it('passes only the fixed accepted-route stream error to the API console boundary', async () => {
    const envelope = createAcceptedPreparedSampleSpeechEnvelope({
      conversationAttemptRef: canonicalConversationAttemptRef,
      selectedSampleId: 'voice.local_sample_001',
      recognizedText: 'SECRET_PRIVATE_PREPARED_SPEECH',
      generatedAt: '2026-07-13T01:02:03.000Z',
    })
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(
          new Error('SECRET_PIPE_PROVIDER_PATH_C:\\private\\pipe.json')
        )
      },
    })
    global.fetch = jest.fn().mockResolvedValue(
      new Response(body, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      })
    ) as any
    const consoleError = jest
      .spyOn(console, 'error')
      .mockImplementation(() => {})
    const handler = require('@/pages/api/thoughtCoreChat').default
    const res = createMockRes()

    await handler(createMockReq({ body: { ...envelope, stream: true } }), res)

    expect(res._status).toBe(200)
    expect(res._chunks).toEqual([])
    expect(res._ended).toBe(true)
    const mockedFs = jest.requireMock('fs') as {
      appendFileSync: jest.Mock
    }
    const serialized = JSON.stringify({
      console: consoleError.mock.calls,
      traces: mockedFs.appendFileSync.mock.calls,
    })
    expect(serialized).toContain('accepted_private_stream_error')
    expect(serialized).not.toContain('SECRET_PIPE_PROVIDER_PATH')
    expect(serialized).not.toContain('private\\pipe.json')
    consoleError.mockRestore()
  })

  it('normalizes accepted-route cancellation before trace or upstream publication', async () => {
    const {
      createTracedThoughtCoreStream,
    } = require('@/pages/api/thoughtCoreChat')
    const upstreamCancel = jest.fn()
    const upstream = new ReadableStream<Uint8Array>({
      cancel: upstreamCancel,
    })
    const traced = createTracedThoughtCoreStream(upstream, {
      query: 'accepted_prepared_sample_private_turn',
      startedAt: Date.now(),
      turnId: 'prepared_sample_browser_stt_0123456789abcdef0123456789abcdef',
      sessionId: 'prepared_sample_browser_stt_operator',
      privateAcceptedSpeechRoute: true,
      expectedConversationAttemptRef: canonicalConversationAttemptRef,
    })

    await traced?.cancel(
      new Error('SECRET_CANCEL_PROVIDER_PATH_C:\\private\\cancel.json')
    )

    expect(upstreamCancel).toHaveBeenCalledWith(
      'accepted_private_stream_cancelled'
    )
    const mockedFs = jest.requireMock('fs') as {
      appendFileSync: jest.Mock
    }
    const serialized = JSON.stringify(mockedFs.appendFileSync.mock.calls)
    expect(serialized).toContain('accepted_private_stream_cancelled')
    expect(serialized).not.toContain('SECRET_CANCEL_PROVIDER_PATH')
    expect(serialized).not.toContain('private\\cancel.json')
  })

  it.each([
    [
      'missing ref',
      (event: Record<string, unknown>) => {
        delete event.conversation_attempt_ref
      },
      undefined,
    ],
    [
      'malformed ref',
      (event: Record<string, unknown>) => {
        event.conversation_attempt_ref = 'raw-private-marker'
      },
      'raw-private-marker',
    ],
    [
      'changed ref',
      (event: Record<string, unknown>) => {
        event.conversation_attempt_ref =
          'm4.prepared_sample_attempt:fedcba9876543210fedcba9876543210'
      },
      'fedcba9876543210fedcba9876543210',
    ],
    [
      'invalid top event id',
      (event: Record<string, unknown>) => {
        event.event_id = 'C:\\private\\event.json'
      },
      'C:\\private\\event.json',
    ],
    [
      'invalid top timestamp',
      (event: Record<string, unknown>) => {
        event.timestamp = 'SECRET_PRIVATE_TIMESTAMP'
      },
      'SECRET_PRIVATE_TIMESTAMP',
    ],
    [
      'deep projected field',
      (event: Record<string, unknown>) => {
        ;(event.data as Record<string, unknown>).motion_event_id = {
          nested: { provider_detail: 'SECRET_DEEP_PROVIDER_DETAIL' },
        }
      },
      'SECRET_DEEP_PROVIDER_DETAIL',
    ],
    [
      'oversized projected field',
      (event: Record<string, unknown>) => {
        ;(event.data as Record<string, unknown>).stimulus_id =
          `mot_${'x'.repeat(256)}`
      },
      'x'.repeat(256),
    ],
    [
      'private marker under a projected field',
      (event: Record<string, unknown>) => {
        ;(event.data as Record<string, unknown>).stimulus_instance_id =
          'mot_inst_private_provider_001'
      },
      'mot_inst_private_provider_001',
    ],
    [
      'deep extra trace field',
      (event: Record<string, unknown>) => {
        const data = event.data as Record<string, unknown>
        data.trace = {
          ...(data.trace as Record<string, unknown>),
          provider_detail: {
            nested: 'SECRET_TRACE_NESTING',
          },
        }
      },
      'SECRET_TRACE_NESTING',
    ],
  ])(
    'rejects %s without publishing the rejected value',
    async (_label, mutate, forbiddenValue) => {
      const {
        createTracedThoughtCoreStream,
      } = require('@/pages/api/thoughtCoreChat')
      const event = createCoreMotionRequestedEvent()
      mutate(event)
      const encoder = new TextEncoder()
      const upstream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(event)}\n\n`)
          )
          controller.close()
        },
      })
      const traced = createTracedThoughtCoreStream(upstream, {
        query: 'accepted_prepared_sample_private_turn',
        startedAt: Date.now(),
        turnId: 'prepared_sample_browser_stt_0123456789abcdef0123456789abcdef',
        sessionId: 'prepared_sample_browser_stt_operator',
        privateAcceptedSpeechRoute: true,
        expectedConversationAttemptRef: canonicalConversationAttemptRef,
      })

      await expect(readByteStream(traced)).resolves.toEqual([])

      const mockedFs = jest.requireMock('fs') as {
        appendFileSync: jest.Mock
      }
      const traceLines = mockedFs.appendFileSync.mock.calls
        .filter(([filePath]) =>
          String(filePath).endsWith('thought-core-chat-events.jsonl')
        )
        .map(([, line]) => JSON.parse(String(line)))
      const completed = traceLines.find(
        (entry) => entry.event === 'stream_completed'
      )
      expect(completed).toMatchObject({
        notable_event_count: 0,
      })
      expect(completed).not.toHaveProperty('notable_events')
      if (forbiddenValue) {
        expect(JSON.stringify(traceLines)).not.toContain(forbiddenValue)
      }
    }
  )

  it('writes Thought Core trace logs under HOME_CONTROL_STACK_STATE_DIR', async () => {
    const stateDir = path.resolve('C:/tmp/home-control-stack-live')
    process.env.HOME_CONTROL_STACK_STATE_DIR = stateDir
    const handler = require('@/pages/api/thoughtCoreChat').default
    const mockedFs = jest.requireMock('fs') as {
      appendFileSync: jest.Mock
    }
    const res = createMockRes()

    await handler(
      createMockReq({
        body: {
          query: 'hello',
          turnId: 'turn_trace_001',
          sessionId: 'session-trace',
          stream: false,
        },
      }),
      res
    )

    const writtenPaths = mockedFs.appendFileSync.mock.calls.map(([filePath]) =>
      String(filePath)
    )

    expect(res._status).toBe(200)
    expect(writtenPaths).toContain(
      path.join(stateDir, 'thought-core-chat-events.jsonl')
    )
    expect(writtenPaths).toContain(
      path.join(stateDir, 'conversation-log.jsonl')
    )

    const traceEvents = mockedFs.appendFileSync.mock.calls
      .filter(([filePath]) =>
        String(filePath).endsWith('thought-core-chat-events.jsonl')
      )
      .map(([, line]) => JSON.parse(String(line)))
    expect(traceEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: 'request_started',
          turn_id: 'turn_trace_001',
          session_id: 'session-trace',
        }),
        expect.objectContaining({
          event: 'request_succeeded',
          turn_id: 'turn_trace_001',
          session_id: 'session-trace',
        }),
      ])
    )
  })

  it('persists redacted notable Thought Core stream events', async () => {
    const stateDir = path.resolve('C:/tmp/home-control-stack-live')
    process.env.HOME_CONTROL_STACK_STATE_DIR = stateDir
    const handler = require('@/pages/api/thoughtCoreChat').default
    const mockedFs = jest.requireMock('fs') as {
      appendFileSync: jest.Mock
    }
    const res = createMockRes()
    const encoder = new TextEncoder()
    const eventLines = [
      {
        type: 'input.understood',
        event_id: 'event-input',
        turn_id: 'turn_stream_001',
        session_id: 'session-stream',
        seq: 1,
        data: {
          input_kind: 'general',
          is_command: false,
          raw_text: 'SECRET_RAW_SPEECH',
          confirmation_token: 'SECRET_TOKEN',
        },
      },
      {
        type: 'action.reviewed',
        event_id: 'event-action-reviewed',
        turn_id: 'turn_stream_001',
        session_id: 'session-stream',
        seq: 2,
        data: {
          action_id: 'act_001',
          status: 'rejected',
          reason: 'not_explicit_command',
          target: 'light.living_room',
          password: 'SECRET_PASSWORD',
        },
      },
      {
        type: 'tool.result',
        event_id: 'event-tool-result',
        turn_id: 'turn_stream_001',
        session_id: 'session-stream',
        seq: 3,
        data: {
          tool_name: 'home.preview',
          call_id: 'call_001',
          status: 'skipped',
          action_id: 'act_001',
          executed: false,
          access_token: 'SECRET_ACCESS_TOKEN',
        },
      },
      createCoreMotionRequestedEvent({
        turn_id: 'turn_stream_001',
        session_id: 'session-stream',
        seq: 4,
        data: {
          raw_prompt: 'SECRET_RAW_MOTION_PROMPT',
          provider_payload: 'SECRET_PROVIDER_PAYLOAD',
          private_path: 'SECRET_PRIVATE_PATH',
        },
      }),
      {
        type: 'assistant.speech_delta',
        event_id: 'event-answer',
        turn_id: 'turn_stream_001',
        session_id: 'session-stream',
        seq: 5,
        data: {
          delta: 'hello',
          conversation_attempt_ref:
            'm4.prepared_sample_attempt:0123456789abcdef0123456789abcdef',
        },
      },
    ]
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const eventLine of eventLines) {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(eventLine)}\n\n`)
          )
        }
        controller.close()
      },
    })

    global.fetch = jest.fn().mockResolvedValue(
      new Response(body, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      })
    ) as any

    await handler(
      createMockReq({
        body: {
          query: 'hello',
          turnId: 'turn_stream_001',
          sessionId: 'session-stream',
          stream: true,
        },
      }),
      res
    )

    expect(res._status).toBe(200)
    expect(res._ended).toBe(true)

    const traceEvents = mockedFs.appendFileSync.mock.calls
      .filter(([filePath]) =>
        String(filePath).endsWith('thought-core-chat-events.jsonl')
      )
      .map(([, line]) => JSON.parse(String(line)))
    const completedEvent = traceEvents.find(
      (event) => event.event === 'stream_completed'
    )

    expect(completedEvent).toEqual(
      expect.objectContaining({
        turn_id: 'turn_stream_001',
        session_id: 'session-stream',
        notable_event_count: 4,
        final_event_id: 'event-answer',
        final_event_seq: 5,
        last_notable_action_event_id: 'event-tool-result',
      })
    )
    expect(completedEvent.notable_events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'input.understood',
          event_id: 'event-input',
          seq: 1,
          summary: expect.objectContaining({
            input_kind: 'general',
            is_command: false,
          }),
        }),
        expect.objectContaining({
          type: 'action.reviewed',
          event_id: 'event-action-reviewed',
          summary: expect.objectContaining({
            action_id: 'act_001',
            status: 'rejected',
            reason: 'not_explicit_command',
            target: 'light.living_room',
          }),
        }),
        expect.objectContaining({
          type: 'tool.result',
          event_id: 'event-tool-result',
          summary: expect.objectContaining({
            tool_name: 'home.preview',
            call_id: 'call_001',
            status: 'skipped',
            action_id: 'act_001',
            executed: false,
          }),
        }),
        expect.objectContaining({
          type: 'motion.requested',
          event_id: coreMotionEventId,
          timestamp: coreMotionTimestamp,
          conversation_attempt_ref: canonicalConversationAttemptRef,
          summary: {
            schema_version: 'motion_stimulus.v0',
            motion_event_id: 'mot_evt_prepared_sample_001',
            stimulus_id: 'mot_stim_prepared_sample_expression',
            stimulus_instance_id: 'mot_inst_prepared_sample_001',
            phase: 'queued',
            lifecycle_state: 'queued',
            safe_visible_state: 'requested',
            requested_at: coreMotionTimestamp,
            trace: { event_id: coreMotionEventId },
          },
        }),
      ])
    )
    const motionEvent = completedEvent.notable_events.find(
      (event: { type?: string }) => event.type === 'motion.requested'
    )
    expect(motionEvent).toHaveProperty(
      'conversation_attempt_ref',
      canonicalConversationAttemptRef
    )
    expect(JSON.stringify(motionEvent)).not.toContain('is_home_action')
    expect(JSON.stringify(motionEvent)).not.toContain('entity_id')
    expect(JSON.stringify(motionEvent)).not.toContain('home_control_route')
    expect(JSON.stringify(motionEvent)).not.toContain(
      'contains_home_control_route'
    )
    const completedLine = JSON.stringify(completedEvent)
    expect(completedLine).not.toContain('SECRET_RAW_SPEECH')
    expect(completedLine).not.toContain('SECRET_TOKEN')
    expect(completedLine).not.toContain('SECRET_PASSWORD')
    expect(completedLine).not.toContain('SECRET_ACCESS_TOKEN')
    expect(completedLine).not.toContain('SECRET_RAW_MOTION_PROMPT')
    expect(completedLine).not.toContain('SECRET_PROVIDER_PAYLOAD')
    expect(completedLine).not.toContain('SECRET_PRIVATE_PATH')
    expect(completedLine).not.toContain('SECRET_UNPROJECTED_NESTED_VALUE')
  })
})
