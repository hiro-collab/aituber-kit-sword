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
    payload_ref: 'motion.thought_core.expression_visible.v0',
    track_mask: {
      scope: 'face_head',
      channels: ['expression_weight'],
    },
    requirements: {
      required_tracks: ['expression'],
      expression_profile_ref: 'motion.runtime.vrm_expression_weights.v0',
      expected_visible_change: 'face_expression',
      expected_roi: 'avatar_face_head',
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
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({
              type: 'assistant.speech_delta',
              data: {
                delta: '統合された返答',
                conversation_attempt_ref: canonicalConversationAttemptRef,
                provider_payload: 'SECRET_PROVIDER_FIELD',
              },
            })}\n\n`
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
    const projected = new TextDecoder().decode(
      Uint8Array.from(res._chunks.flatMap((chunk) => [...chunk]))
    )
    const projectedEvents = projected
      .trim()
      .split('\n\n')
      .map((line) => JSON.parse(line.replace(/^data:\s*/, '')))
    expect(projectedEvents.map((event) => event.type)).toEqual([
      'accepted.presentation.motion',
      'accepted.presentation.assistant_delta',
      'accepted.presentation.completed',
    ])
    expect(projectedEvents).toHaveLength(3)
    expect(Object.keys(projectedEvents[0].data).sort()).toEqual([
      'conversation_attempt_ref',
      'event',
    ])
    expect(projectedEvents[0].data.conversation_attempt_ref).toBe(
      canonicalConversationAttemptRef
    )
    expect(projectedEvents[0].data.event.type).toBe('motion.requested')
    expect(Object.keys(projectedEvents[1].data).sort()).toEqual([
      'conversation_attempt_ref',
      'delta',
    ])
    expect(projectedEvents[2]).toEqual({
      type: 'accepted.presentation.completed',
      data: { conversation_attempt_ref: canonicalConversationAttemptRef },
    })
    expect(projected).toContain(canonicalConversationAttemptRef)
    expect(projected).toContain('統合された返答')
    expect(projected).not.toContain('SECRET_PROVIDER_FIELD')
    expect(projected).not.toContain('SECRET_UNPROJECTED_NESTED_VALUE')
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
            encoder.encode(
              `data: ${JSON.stringify({
                type: 'assistant.speech_delta',
                data: {
                  delta: '安全な返答',
                  conversation_attempt_ref: canonicalConversationAttemptRef,
                },
              })}\n\n`
            )
          )
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

      const chunks = await readByteStream(traced)
      const projected = new TextDecoder().decode(
        Uint8Array.from(chunks.flatMap((chunk) => [...chunk]))
      )
      expect(projected).toContain('accepted.presentation.assistant_delta')
      expect(projected).not.toContain('accepted.presentation.motion')
      expect(projected).not.toContain('accepted.presentation.completed')

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

  it('suppresses success terminal for duplicate projected motion', async () => {
    const {
      createTracedThoughtCoreStream,
    } = require('@/pages/api/thoughtCoreChat')
    const encoder = new TextEncoder()
    const motion = createCoreMotionRequestedEvent()
    const assistant = {
      type: 'assistant.speech_delta',
      data: {
        delta: '安全な返答',
        conversation_attempt_ref: canonicalConversationAttemptRef,
        arbitrary_payload: 'SECRET_ARBITRARY_FIELD',
      },
    }
    const upstream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const event of [assistant, motion, motion]) {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(event)}\n\n`)
          )
        }
        controller.close()
      },
    })
    const traced = createTracedThoughtCoreStream(upstream, {
      query: 'accepted_prepared_sample_private_turn',
      startedAt: Date.now(),
      privateAcceptedSpeechRoute: true,
      expectedConversationAttemptRef: canonicalConversationAttemptRef,
    })
    const chunks = await readByteStream(traced)
    const serialized = new TextDecoder().decode(
      Uint8Array.from(chunks.flatMap((chunk) => [...chunk]))
    )
    expect(serialized.match(/accepted\.presentation\.motion/g)).toHaveLength(1)
    expect(serialized).toContain('accepted.presentation.assistant_delta')
    expect(serialized).not.toContain('accepted.presentation.completed')
    expect(serialized).not.toContain('SECRET_ARBITRARY_FIELD')
  })

  it('suppresses success terminal after malformed private SSE without echo', async () => {
    const {
      createTracedThoughtCoreStream,
    } = require('@/pages/api/thoughtCoreChat')
    const encoder = new TextEncoder()
    const malformed = 'SECRET_MALFORMED_PRIVATE_{'
    const upstream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({
              type: 'assistant.speech_delta',
              data: {
                delta: '安全な返答',
                conversation_attempt_ref: canonicalConversationAttemptRef,
              },
            })}\n\n`
          )
        )
        controller.enqueue(encoder.encode(`data: ${malformed}\n\n`))
        controller.close()
      },
    })
    const traced = createTracedThoughtCoreStream(upstream, {
      query: 'accepted_prepared_sample_private_turn',
      startedAt: Date.now(),
      privateAcceptedSpeechRoute: true,
      expectedConversationAttemptRef: canonicalConversationAttemptRef,
    })
    const chunks = await readByteStream(traced)
    const projected = new TextDecoder().decode(
      Uint8Array.from(chunks.flatMap((chunk) => [...chunk]))
    )
    expect(projected).toContain('accepted.presentation.assistant_delta')
    expect(projected).not.toContain('accepted.presentation.completed')
    expect(projected).not.toContain(malformed)
    const mockedFs = jest.requireMock('fs') as { appendFileSync: jest.Mock }
    const serializedTrace = JSON.stringify(mockedFs.appendFileSync.mock.calls)
    expect(serializedTrace).not.toContain(malformed)
  })

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

describe('/api/thoughtCoreChat minimal transient text', () => {
  const originalFetch = global.fetch
  const originalEnv = process.env
  const sessionId = 'ait_session_001'
  const turnId = 'ait_turn_001'
  const assistantMessageId = 'assistant_001'
  const mode = 'minimal-transient-text-v1'
  const event = (type: string, data: Record<string, unknown> = {}) => ({
    type, session_id: sessionId, turn_id: turnId,
    provider_ref: 'PRIVATE_PROVIDER_REF', data,
  })
  const canonical = (delta = true) => [
    event('agentic.decision', {
      status: 'accepted', semantic_authority: 'agentic_provider', capability_present: false,
    }),
    ...(delta ? [event('assistant.speech_delta', {
      assistant_message_id: assistantMessageId, delta: 'safe response',
    })] : []),
    event('assistant.message', {
      assistant_message_id: assistantMessageId,
      display: 'safe response', raw: 'PRIVATE_RAW_SENTINEL',
    }),
    event('turn.completed', {
      status: 'response', semantic_authority: 'agentic_provider', capability_executed: false,
    }),
  ]
  const readerFor = (parts: string[]) => {
    const chunks = parts.map((part) => new TextEncoder().encode(part))
    let index = 0
    const read = jest.fn(async () => index < chunks.length
      ? { done: false, value: chunks[index++] }
      : { done: true, value: undefined })
    const cancel = jest.fn(async () => undefined)
    const releaseLock = jest.fn()
    return {
      upstream: { ok: true, status: 200, body: {
        getReader: () => ({ read, cancel, releaseLock }),
      } }, read, cancel, releaseLock,
    }
  }
  const responseFor = (events: unknown[]) => readerFor([
    events.map((value) => `data: ${JSON.stringify(value)}\n\n`).join(''),
  ])
  const run = async (
    body: Record<string, unknown>,
    header: string | string[] | undefined,
    upstream: unknown = responseFor(canonical()).upstream
  ) => {
    global.fetch = jest.fn().mockResolvedValue(upstream) as any
    const handler = require('@/pages/api/thoughtCoreChat').default
    const currentFs = jest.requireMock('fs') as {
      mkdirSync: jest.Mock
      appendFileSync: jest.Mock
    }
    const res = createMockRes()
    await handler(createMockReq({ body, headers: header === undefined
      ? {} : { 'x-sword-ait-request-mode': header } }), res)
    expect(currentFs.mkdirSync).not.toHaveBeenCalled()
    expect(currentFs.appendFileSync).not.toHaveBeenCalled()
    return res
  }
  const body = () => ({ query: 'operator text', sessionId, turnId })

  beforeEach(() => {
    process.env = { ...originalEnv }
    delete process.env.THOUGHT_CORE_BASE_URL
    delete process.env.NEXT_PUBLIC_THOUGHT_CORE_BASE_URL
    jest.resetModules()
    jest.clearAllMocks()
  })
  afterEach(() => {
    global.fetch = originalFetch
    process.env = originalEnv
    jest.restoreAllMocks()
  })

  it.each([true, false])('returns the exact DTO with optional delta=%s', async (delta) => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    const stream = responseFor(canonical(delta))
    const res = await run(body(), mode, stream.upstream)
    expect(res._status).toBe(200)
    expect(res._json).toEqual({ sessionId, turnId, assistantMessageId, response: 'safe response' })
    expect(JSON.stringify(res._json)).not.toMatch(/PRIVATE|provider_ref|raw/)
    expect(JSON.stringify(consoleSpy.mock.calls)).not.toMatch(/PRIVATE/)
    expect(stream.releaseLock).toHaveBeenCalledTimes(1)
    expect(stream.cancel).not.toHaveBeenCalled()
    expect(global.fetch).toHaveBeenCalledTimes(1)
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0]
    expect(url).toBe('http://127.0.0.1:18888/turn?stream=true')
    expect(init).toEqual(expect.objectContaining({ method: 'POST', redirect: 'manual',
      headers: { Accept: 'text/event-stream', 'Content-Type': 'application/json' } }))
    expect(JSON.parse(init.body)).toEqual({
      text: 'operator text', session_id: sessionId, turn_id: turnId,
      locale: 'ja-JP', context_refs: { source: 'aituber-kit', route: 'projection-visual' },
    })
  })

  it.each([
    ['missing mode', undefined, body()],
    ['wrong mode', 'wrong', body()],
    ['duplicate mode', [mode, mode], body()],
    ['extra key', mode, { ...body(), url: 'http://private/' }],
    ['missing key', mode, { query: 'operator text', sessionId }],
  ])('rejects %s before dispatch', async (_label, header, requestBody) => {
    const res = await run(requestBody, header)
    expect(res._status).toBe(400)
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('rejects a 127-prefixed hostname before private query dispatch', async () => {
    process.env.THOUGHT_CORE_BASE_URL = 'http://127.attacker.example:18888'
    const res = await run({ ...body(), query: 'PRIVATE_QUERY_SENTINEL' }, mode)
    expect(res._status).toBe(502)
    expect(res._json).toEqual({ error: 'minimal_text_request_failed' })
    expect(JSON.stringify(res._json)).not.toContain('PRIVATE_QUERY_SENTINEL')
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('accepts a bracketed IPv6 loopback minimal route', async () => {
    process.env.THOUGHT_CORE_BASE_URL = 'http://[::1]:18888'
    const stream = responseFor(canonical(false))
    const res = await run(body(), mode, stream.upstream)
    expect(res._status).toBe(200)
    expect(res._json).toEqual({ sessionId, turnId, assistantMessageId, response: 'safe response' })
    expect(global.fetch).toHaveBeenCalledTimes(1)
    expect((global.fetch as jest.Mock).mock.calls[0][0]).toBe('http://[::1]:18888/turn?stream=true')
  })

  it.each([307, 308])('rejects redirect %s before reading its body', async (status) => {
    const bodyRead = jest.fn()
    const res = await run(body(), mode, { ok: false, status,
      get body() { bodyRead(); throw new Error('PRIVATE_REDIRECT_BODY') } })
    expect(res._status).toBe(502)
    expect(res._json).toEqual({ error: 'minimal_text_request_failed' })
    expect(bodyRead).not.toHaveBeenCalled()
    expect(global.fetch).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['nonterminal', () => canonical().slice(0, -1)],
    ['duplicate', () => [...canonical(), canonical()[3]]],
    ['out of order', () => canonical().slice().reverse()],
    ['action', () => [event('action.proposed'), ...canonical()]],
    ['wrong identity', () => canonical().map((value, index) =>
      index === 2 ? { ...value, turn_id: 'ait_turn_wrong' } : value)],
    ['overflow display', () => canonical(false).map((value, index) =>
      index === 1 ? { ...value, data: { ...value.data, display: 'x'.repeat(8001) } } : value)],
  ] as const)('fails closed on semantic %s with fetch1', async (_label, events) => {
    const res = await run(body(), mode, responseFor(events()).upstream)
    expect(res._status).toBe(502)
    expect(res._json).toEqual({ error: 'minimal_text_request_failed' })
    expect(global.fetch).toHaveBeenCalledTimes(1)
  })

  it('stops at the first raw byte above 65,536 and releases the reader', async () => {
    const stream = readerFor([' '.repeat(65_536), 'x', 'PRIVATE_LATER_CHUNK'])
    const res = await run(body(), mode, stream.upstream)
    expect(res._status).toBe(502)
    expect(res._json).toEqual({ error: 'minimal_text_request_failed' })
    expect(stream.read).toHaveBeenCalledTimes(2)
    expect(stream.cancel).toHaveBeenCalledTimes(1)
    expect(stream.releaseLock).toHaveBeenCalledTimes(1)
  })

  it('rejects duplicate JSON keys and preserves the existing local security gate', async () => {
    const duplicate = '{"type":"agentic.decision","type":"assistant.message","session_id":"ait_session_001","turn_id":"ait_turn_001","data":{}}'
    const res = await run(body(), mode, readerFor([`data: ${duplicate}\n\n`]).upstream)
    expect(res._status).toBe(502)

    process.env.LOCAL_API_REQUIRE_TOKEN = 'true'
    process.env.LOCAL_API_REMOTE_TOKEN = 'expected-token'
    jest.resetModules()
    global.fetch = jest.fn() as any
    const handler = require('@/pages/api/thoughtCoreChat').default
    const currentFs = jest.requireMock('fs') as {
      mkdirSync: jest.Mock
      appendFileSync: jest.Mock
    }
    for (const headers of [
      { origin: 'https://evil.example', host: '127.0.0.1:3000', 'x-api-token': 'expected-token' },
      { origin: 'http://127.0.0.1:3000', host: '127.0.0.1:3000', 'x-api-token': 'forged' },
    ]) {
      const blocked = createMockRes()
      await handler(createMockReq({ body: body(), headers: {
        ...headers, 'x-sword-ait-request-mode': mode,
      } }), blocked)
      expect([401, 403]).toContain(blocked._status)
    }
    expect(global.fetch).not.toHaveBeenCalled()
    expect(currentFs.mkdirSync).not.toHaveBeenCalled()
    expect(currentFs.appendFileSync).not.toHaveBeenCalled()
  })
})

describe('projection effect intent SSE projection', () => {
  const turnId = 'turn_projection_phase1'
  const sessionId = 'session_projection_phase1'
  const eventId = 'evt_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
  const canonicalEvent = (data: Record<string, unknown>) => ({
    schema_version: 'thought-core.event.v0',
    event_id: eventId,
    turn_id: turnId,
    session_id: sessionId,
    seq: 3,
    timestamp: '2026-07-23T00:00:00.000Z',
    source: 'thought-core',
    type: 'projection.effect.requested',
    data,
  })
  const performancePlan = (overrides: Record<string, unknown> = {}) => ({
    schemaVersion: 1,
    planId: 'planv1_0123456789abcdef0123456789abcdef',
    sessionId,
    revision: 1,
    action: 'start',
    effectId: 'fire',
    position: { x: 0.65, y: 0.55 },
    strength: 0.3,
    durationMs: 3_000,
    seed: 42,
    keyframes: [
      {
        atMs: 0,
        position: { x: 0.65, y: 0.55 },
        strength: 0.3,
      },
    ],
    ...overrides,
  })

  it('projects one canonical fixed DTO and suppresses the raw event', async () => {
    const {
      createTracedThoughtCoreStream,
    } = require('@/pages/api/thoughtCoreChat')
    const encoder = new TextEncoder()
    const upstream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify(
              canonicalEvent({
                schemaVersion: 1,
                action: 'start',
                effectId: 'fire',
              })
            )}\n\n`
          )
        )
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({
              type: 'assistant.speech_delta',
              data: {
                delta: '炎を出します。',
                conversation_attempt_ref: canonicalConversationAttemptRef,
              },
            })}\n\n`
          )
        )
        controller.close()
      },
    })
    const traced = createTracedThoughtCoreStream(upstream, {
      query: 'accepted_prepared_sample_private_turn',
      startedAt: Date.now(),
      turnId,
      sessionId,
      privateAcceptedSpeechRoute: true,
      expectedConversationAttemptRef: canonicalConversationAttemptRef,
    })
    const projected = new TextDecoder().decode(
      Uint8Array.from(
        (await readByteStream(traced)).flatMap((chunk) => [...chunk])
      )
    )
    const events = projected
      .trim()
      .split('\n\n')
      .map((line) => JSON.parse(line.replace(/^data:\s*/, '')))
    expect(events[0]).toEqual({
      type: 'accepted.presentation.projection_effect_intent',
      data: {
        conversation_attempt_ref: canonicalConversationAttemptRef,
        intent: {
          schemaVersion: 1,
          eventId,
          turnId,
          action: 'start',
          effectId: 'fire',
        },
      },
    })
    expect(projected).not.toContain('projection.effect.requested')
    expect(projected).not.toContain('session_projection_phase1')
    expect(projected).not.toContain('raw_phrase')
    expect(projected).not.toContain('parameters')
    expect(projected).not.toContain('code')
  })

  const runProjectionChunks = async (
    chunks: readonly Uint8Array[],
    privateAcceptedSpeechRoute = false
  ): Promise<string> => {
    const {
      createTracedThoughtCoreStream,
    } = require('@/pages/api/thoughtCoreChat')
    const upstream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk)
        controller.close()
      },
    })
    const traced = createTracedThoughtCoreStream(upstream, {
      query: 'safe query',
      startedAt: Date.now(),
      turnId,
      sessionId,
      privateAcceptedSpeechRoute,
      expectedConversationAttemptRef: privateAcceptedSpeechRoute
        ? canonicalConversationAttemptRef
        : undefined,
    })
    return new TextDecoder().decode(
      Uint8Array.from(
        (await readByteStream(traced)).flatMap((chunk) => [...chunk])
      )
    )
  }

  const runProjectionWire = async (
    projectionWireRecords: string[]
  ): Promise<string> => {
    const encoder = new TextEncoder()
    const safeEvent = JSON.stringify({
      type: 'assistant.speech_delta',
      data: { delta: 'safe speech' },
    })
    return runProjectionChunks([
      encoder.encode(
        `${projectionWireRecords
          .map((record) => `data: ${record}\n\n`)
          .join('')}data: ${safeEvent}\n\n`
      ),
    ])
  }

  const projectedIntents = (output: string): unknown[] =>
    output
      .trim()
      .split('\n\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line.replace(/^data:\s*/, '')))
      .filter(
        (event) =>
          event?.type === 'accepted.presentation.projection_effect_intent'
      )

  it.each([
    ['static Fire', performancePlan()],
    [
      'static Thunder',
      performancePlan({
        planId: 'planv1_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        effectId: 'thunderBall',
        position: { x: 0, y: 0.3 },
        strength: 0.25,
        durationMs: 5_000,
        seed: 2_147_483_647,
        keyframes: [{ atMs: 0, position: { x: 0, y: 0.3 }, strength: 0.25 }],
      }),
    ],
    [
      'two-keyframe movement',
      performancePlan({
        planId: 'planv1_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        position: { x: -0.65, y: -0.55 },
        strength: 0.5,
        durationMs: 4_000,
        keyframes: [
          { atMs: 0, position: { x: -0.65, y: -0.55 }, strength: 0.5 },
          { atMs: 4_000, position: { x: 0.65, y: 0.55 }, strength: 0.5 },
        ],
      }),
    ],
  ])('projects one exact text-free v2 DTO for %s', async (_label, plan) => {
    const output = await runProjectionWire([
      JSON.stringify(
        canonicalEvent({
          schemaVersion: 2,
          action: 'start',
          plan,
        })
      ),
    ])
    expect(projectedIntents(output)).toEqual([
      {
        type: 'accepted.presentation.projection_effect_intent',
        data: {
          intent: {
            schemaVersion: 2,
            eventId,
            turnId,
            action: 'start',
            plan,
          },
        },
      },
    ])
    expect(output).toContain('safe speech')
    expect(output).not.toContain('projection.effect.requested')
    expect(output).not.toContain('raw_prompt')
    expect(output).not.toContain('PRIVATE_PLAN_MARKER')
  })

  it.each([
    [
      'escaped type key',
      String.raw`{"schema_version":"thought-core.event.v0","event_id":"evt_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","turn_id":"turn_projection_phase1","session_id":"session_projection_phase1","seq":3,"timestamp":"2026-07-23T00:00:00.000Z","source":"thought-core","ty\u0070e":"projection.effect.requested","data":{"schemaVersion":1,"action":"start","effectId":"fire"}}`,
    ],
    [
      'escaped canonical type value',
      String.raw`{"schema_version":"thought-core.event.v0","event_id":"evt_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","turn_id":"turn_projection_phase1","session_id":"session_projection_phase1","seq":3,"timestamp":"2026-07-23T00:00:00.000Z","source":"thought-core","type":"projection.\u0065ffect.requested","data":{"schemaVersion":1,"action":"start","effectId":"fire"}}`,
    ],
  ])(
    'projects one fixed DTO for a valid canonical %s',
    async (_label, wire) => {
      const output = await runProjectionWire([wire])
      expect(projectedIntents(output)).toEqual([
        {
          type: 'accepted.presentation.projection_effect_intent',
          data: {
            intent: {
              schemaVersion: 1,
              eventId,
              turnId,
              action: 'start',
              effectId: 'fire',
            },
          },
        },
      ])
      expect(output).toContain('safe speech')
      expect(output).not.toContain('projection.effect.requested')
    }
  )

  it.each([
    [
      'canonical reordered type-last',
      String.raw`{"data":{"schemaVersion":1,"action":"reset","raw_prompt":"SECRET_CANONICAL_WIRE"},"source":"thought-core","timestamp":"2026-07-23T00:00:00.000Z","seq":3,"session_id":"session_projection_phase1","turn_id":"turn_projection_phase1","event_id":"evt_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","schema_version":"thought-core.event.v0","type":"projection.effect.requested"}`,
      'SECRET_CANONICAL_WIRE',
    ],
    [
      'legacy escaped key and value reordered type-last',
      String.raw`{"data":{"schemaVersion":1,"action":"reset","raw_prompt":"SECRET_LEGACY_WIRE"},"source":"thought-core","timestamp":"2026-07-23T00:00:00.000Z","seq":3,"session_id":"session_projection_phase1","turn_id":"turn_projection_phase1","event_id":"evt_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","schema_version":"thought-core.event.v0","ty\u0070e":"projection_effect.\u0069ntent"}`,
      'SECRET_LEGACY_WIRE',
    ],
    [
      'malformed projection-looking JSON',
      String.raw`{"type":"projection.effect.requested","data":{"raw_prompt":"SECRET_MALFORMED_WIRE"}`,
      'SECRET_MALFORMED_WIRE',
    ],
  ])(
    'suppresses %s without raw or private echo while later safe SSE survives',
    async (_label, wire, sentinel) => {
      const output = await runProjectionWire([wire])
      expect(projectedIntents(output)).toHaveLength(0)
      expect(output).toContain('assistant.speech_delta')
      expect(output).toContain('safe speech')
      expect(output).not.toContain('projection.effect.requested')
      expect(output).not.toContain('projection_effect.intent')
      expect(output).not.toContain(sentinel)
    }
  )

  it.each([
    [
      'legacy',
      {
        ...canonicalEvent({ schemaVersion: 1, action: 'reset' }),
        type: 'projection_effect.intent',
      },
    ],
    [
      'private field',
      canonicalEvent({
        schemaVersion: 1,
        action: 'reset',
        raw_prompt: 'SECRET_PROJECTION_PROMPT',
      }),
    ],
    [
      'Phase2 action',
      canonicalEvent({ schemaVersion: 1, action: 'update', effectId: 'fire' }),
    ],
    [
      'turn mismatch',
      {
        ...canonicalEvent({ schemaVersion: 1, action: 'reset' }),
        turn_id: 'other_turn',
      },
    ],
    [
      'v2 plan session mismatch',
      canonicalEvent({
        schemaVersion: 2,
        action: 'start',
        plan: performancePlan({ sessionId: 'other_session' }),
      }),
    ],
    [
      'v2 duplicated effect id',
      canonicalEvent({
        schemaVersion: 2,
        action: 'start',
        effectId: 'fire',
        plan: performancePlan(),
      }),
    ],
    [
      'v2 stop',
      canonicalEvent({
        schemaVersion: 2,
        action: 'stop',
        plan: performancePlan(),
      }),
    ],
    [
      'v2 reset',
      canonicalEvent({
        schemaVersion: 2,
        action: 'reset',
        plan: performancePlan(),
      }),
    ],
    [
      'v2 update',
      canonicalEvent({
        schemaVersion: 2,
        action: 'update',
        plan: performancePlan(),
      }),
    ],
    [
      'v2 replace',
      canonicalEvent({
        schemaVersion: 2,
        action: 'start',
        plan: { ...performancePlan(), replace: true },
      }),
    ],
    [
      'v2 Emergency',
      canonicalEvent({
        schemaVersion: 2,
        action: 'start',
        plan: { ...performancePlan(), emergency: true },
      }),
    ],
    [
      'v2 private plan field',
      canonicalEvent({
        schemaVersion: 2,
        action: 'start',
        plan: {
          ...performancePlan(),
          raw_prompt: 'SECRET_PROJECTION_PROMPT',
        },
      }),
    ],
    [
      'v2 nonmonotonic keyframes',
      canonicalEvent({
        schemaVersion: 2,
        action: 'start',
        plan: performancePlan({
          keyframes: [
            { atMs: 100, position: { x: 0, y: 0 }, strength: 0.5 },
            { atMs: 50, position: { x: 0, y: 0 }, strength: 0.5 },
          ],
        }),
      }),
    ],
  ])(
    'suppresses %s projection input without forwarding raw SSE',
    async (_label, projectionEvent) => {
      const {
        createTracedThoughtCoreStream,
      } = require('@/pages/api/thoughtCoreChat')
      const encoder = new TextEncoder()
      const raw = `data: ${JSON.stringify(projectionEvent)}\n\ndata: ${JSON.stringify(
        {
          type: 'assistant.speech_delta',
          data: { delta: 'safe speech' },
        }
      )}\n\n`
      const upstream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode(raw))
          controller.close()
        },
      })
      const traced = createTracedThoughtCoreStream(upstream, {
        query: 'safe query',
        startedAt: Date.now(),
        turnId,
        sessionId,
      })
      const output = new TextDecoder().decode(
        Uint8Array.from(
          (await readByteStream(traced)).flatMap((chunk) => [...chunk])
        )
      )
      expect(output).toContain('assistant.speech_delta')
      expect(output).toContain('safe speech')
      expect(output).not.toContain('projection.effect.requested')
      expect(output).not.toContain('projection_effect.intent')
      expect(output).not.toContain('SECRET_PROJECTION_PROMPT')
      expect(output).not.toContain(
        'accepted.presentation.projection_effect_intent'
      )
    }
  )

  it('accepts an exact-maximum valid v2 line and rejects max+1 before JSON.parse', async () => {
    const {
      MAX_THOUGHT_CORE_SSE_LINE_UTF8_BYTES,
    } = require('@/pages/api/thoughtCoreChat')
    const encoder = new TextEncoder()
    const safeLine = `data: ${JSON.stringify({
      type: 'assistant.speech_delta',
      data: { delta: 'safe speech' },
    })}\n\n`
    const v2LinePrefix = `data: ${JSON.stringify(
      canonicalEvent({
        schemaVersion: 2,
        action: 'start',
        plan: performancePlan(),
      })
    )}`
    const prefixBytes = encoder.encode(v2LinePrefix).byteLength
    expect(prefixBytes).toBeLessThan(MAX_THOUGHT_CORE_SSE_LINE_UTF8_BYTES)

    const exactLine =
      v2LinePrefix +
      ' '.repeat(MAX_THOUGHT_CORE_SSE_LINE_UTF8_BYTES - prefixBytes)
    expect(encoder.encode(exactLine)).toHaveLength(
      MAX_THOUGHT_CORE_SSE_LINE_UTF8_BYTES
    )
    const exactOutput = await runProjectionChunks([
      encoder.encode(`${exactLine}\n\n${safeLine}`),
    ])
    expect(projectedIntents(exactOutput)).toHaveLength(1)
    expect(exactOutput).toContain('safe speech')

    const oversizedLine = `${exactLine} `
    const parseSpy = jest.spyOn(JSON, 'parse')
    let oversizedOutput = ''
    try {
      oversizedOutput = await runProjectionChunks([
        encoder.encode(`${oversizedLine}\n\n${safeLine}`),
      ])
      expect(parseSpy).toHaveBeenCalledTimes(1)
    } finally {
      parseSpy.mockRestore()
    }
    expect(projectedIntents(oversizedOutput)).toHaveLength(0)
    expect(oversizedOutput).toContain('safe speech')
    expect(oversizedOutput).not.toContain('projection.effect.requested')
  })

  it('discards a split oversized private line until newline and resumes with the next bounded line', async () => {
    const {
      MAX_THOUGHT_CORE_SSE_LINE_UTF8_BYTES,
    } = require('@/pages/api/thoughtCoreChat')
    const encoder = new TextEncoder()
    const prefix =
      'data: {"type":"projection.effect.requested","data":{"raw_prompt":"SECRET_SPLIT_OVERSIZE","padding":"'
    const chunks = [
      encoder.encode(prefix),
      ...Array.from({ length: 17 }, () =>
        encoder.encode(
          'x'.repeat(Math.ceil(MAX_THOUGHT_CORE_SSE_LINE_UTF8_BYTES / 16))
        )
      ),
      encoder.encode(
        `"}}\n\ndata: ${JSON.stringify({
          type: 'assistant.speech_delta',
          data: { delta: 'safe after oversized line' },
        })}\n\n`
      ),
    ]
    const parseSpy = jest.spyOn(JSON, 'parse')
    let output = ''
    try {
      output = await runProjectionChunks(chunks)
      expect(parseSpy).toHaveBeenCalledTimes(1)
    } finally {
      parseSpy.mockRestore()
    }
    expect(output).toContain('safe after oversized line')
    expect(output).not.toContain('SECRET_SPLIT_OVERSIZE')
    expect(output).not.toContain('projection.effect.requested')
    expect(projectedIntents(output)).toHaveLength(0)
    expect(
      JSON.stringify(require('fs').appendFileSync.mock.calls)
    ).not.toContain('SECRET_SPLIT_OVERSIZE')
  })

  it.each([
    [
      'top-level type downgrade',
      String.raw`{"type":"projection.effect.requested","data":{"raw_prompt":"SECRET_DUPLICATE_TYPE"},"ty\u0070e":"assistant.speech_delta"}`,
      'SECRET_DUPLICATE_TYPE',
    ],
    [
      'top-level data replacement',
      String.raw`{"type":"projection.effect.requested","data":{"raw_prompt":"SECRET_DUPLICATE_DATA"},"d\u0061ta":{"schemaVersion":1,"action":"reset"}}`,
      'SECRET_DUPLICATE_DATA',
    ],
    [
      'nested plan escaped-equivalent key',
      JSON.stringify(
        canonicalEvent({
          schemaVersion: 2,
          action: 'start',
          plan: performancePlan(),
        })
      ).replace(
        '"planId":"planv1_0123456789abcdef0123456789abcdef"',
        String.raw`"planId":"SECRET_DUPLICATE_PLAN","pl\u0061nId":"planv1_0123456789abcdef0123456789abcdef"`
      ),
      'SECRET_DUPLICATE_PLAN',
    ],
    [
      'otherwise nonprojection data replacement',
      String.raw`{"type":"assistant.speech_delta","data":{"delta":"SECRET_DUPLICATE_NONPROJECTION"},"d\u0061ta":{"delta":"unsafe downgrade"}}`,
      'SECRET_DUPLICATE_NONPROJECTION',
    ],
  ])(
    'suppresses duplicate JSON property in %s and resumes at the next safe line',
    async (_label, duplicateWire, sentinel) => {
      const output = await runProjectionWire([duplicateWire])
      expect(output).toContain('safe speech')
      expect(output).not.toContain(sentinel)
      expect(output).not.toContain('projection.effect.requested')
      expect(projectedIntents(output)).toHaveLength(0)
      expect(
        JSON.stringify(require('fs').appendFileSync.mock.calls)
      ).not.toContain(sentinel)
    }
  )

  it('keeps private accepted presentation invalid after a duplicate-key line', async () => {
    const encoder = new TextEncoder()
    const duplicateWire = String.raw`{"type":"projection.effect.requested","data":{"raw_prompt":"SECRET_PRIVATE_DUPLICATE"},"ty\u0070e":"assistant.speech_delta"}`
    const safeAssistant = JSON.stringify({
      type: 'assistant.speech_delta',
      data: {
        delta: 'safe accepted speech',
        conversation_attempt_ref: canonicalConversationAttemptRef,
      },
    })
    const output = await runProjectionChunks(
      [encoder.encode(`data: ${duplicateWire}\n\ndata: ${safeAssistant}\n\n`)],
      true
    )
    expect(output).toContain('safe accepted speech')
    expect(output).not.toContain('SECRET_PRIVATE_DUPLICATE')
    expect(output).not.toContain('accepted.presentation.completed')
    expect(output).not.toContain(
      'accepted.presentation.projection_effect_intent'
    )
  })
})
