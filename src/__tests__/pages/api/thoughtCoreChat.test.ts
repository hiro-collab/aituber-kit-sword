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
      {
        type: 'motion.requested',
        event_id: 'event-motion-requested',
        turn_id: 'turn_stream_001',
        session_id: 'session-stream',
        seq: 4,
        data: {
          schema_version: 'motion_stimulus.v0',
          motion_event_id: 'mot_evt_turn_stream_001',
          stimulus_id: 'mot_stim_turn_stream_dance_sequence',
          stimulus_instance_id: 'mot_inst_turn_stream_001',
          source_class: 'user_command',
          source_origin: 'thought_core',
          requested_at: '2026-06-12T06:30:00.000Z',
          kind: 'dance_sequence',
          request_mode: 'play',
          phase: 'requested',
          lifecycle_state: 'request_issued',
          safe_visible_state: 'motion_requested',
          target_model_type: 'vrm',
          payload_ref: 'motion.thought_core.dance_sequence.v0',
          track_mask: { scope: 'full_body' },
          requirements: { visible_motion: true },
          trace: {
            event_id: 'event-motion-requested',
            turn_id: 'turn_stream_001',
            session_id: 'session-stream',
            request_id: 'motion-request-stream',
            runtime_result_id: 'mot_res_turn_stream_pending_001',
            driver_result_id: 'DRIVER_RESULT_SHOULD_NOT_LOG',
          },
          is_home_action: true,
          entity_id: 'light_living_room',
          raw_prompt: 'SECRET_RAW_MOTION_PROMPT',
          provider_payload: 'SECRET_PROVIDER_PAYLOAD',
          private_path: 'SECRET_PRIVATE_PATH',
          redaction: {
            shared_summary_only: true,
            contains_raw_prompt: false,
            contains_raw_transcript: false,
            contains_provider_payload: false,
          },
        },
      },
      {
        type: 'assistant.speech_delta',
        event_id: 'event-answer',
        turn_id: 'turn_stream_001',
        session_id: 'session-stream',
        seq: 5,
        data: { delta: 'hello' },
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
          event_id: 'event-motion-requested',
          summary: expect.objectContaining({
            schema_version: 'motion_stimulus.v0',
            motion_event_id: 'mot_evt_turn_stream_001',
            stimulus_id: 'mot_stim_turn_stream_dance_sequence',
            stimulus_instance_id: 'mot_inst_turn_stream_001',
            kind: 'dance_sequence',
            request_mode: 'play',
            payload_ref: 'motion.thought_core.dance_sequence.v0',
            target_model_type: 'vrm',
            trace: expect.objectContaining({
              runtime_result_id: 'mot_res_turn_stream_pending_001',
            }),
          }),
        }),
      ])
    )
    const motionEvent = completedEvent.notable_events.find(
      (event: { type?: string }) => event.type === 'motion.requested'
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
    expect(completedLine).not.toContain('DRIVER_RESULT_SHOULD_NOT_LOG')
  })
})
