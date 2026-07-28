/** @jest-environment node */

import type { NextApiRequest, NextApiResponse } from 'next'
import handler from '@/pages/api/closed-loop-feedback'

const request = (body: unknown): NextApiRequest =>
  ({
    method: 'POST',
    body,
    query: {},
    headers: { host: '127.0.0.1:3000' },
    socket: { remoteAddress: '127.0.0.1' },
  }) as NextApiRequest

const response = () => {
  const value = {
    statusCode: 200,
    body: undefined as unknown,
    headers: {} as Record<string, string>,
    status(code: number) {
      value.statusCode = code
      return value
    },
    json(body: unknown) {
      value.body = body
      return value
    },
    setHeader(name: string, headerValue: string) {
      value.headers[name] = headerValue
      return value
    },
  }
  return value as unknown as NextApiResponse & typeof value
}

const validBody = {
  event_kind: 'output.feedback',
  session_id: 'session_1',
  turn_id: 'turn_1',
  assistant_message_id: 'msg_1',
  causal_parent_event_id: 'evt_send',
  details: {
    profile_name: 'submission_ack_needs_feedback',
    output_channel: 'tts',
    component: 'aituber_tts_synthesis',
  },
}

describe('closed-loop feedback proxy', () => {
  const originalFetch = global.fetch
  const originalEnabled =
    process.env.THOUGHT_CORE_CLOSED_LOOP_FEEDBACK_V1_ENABLED
  const originalUrl = process.env.THOUGHT_CORE_CLOSED_LOOP_FEEDBACK_URL

  beforeEach(() => {
    process.env.THOUGHT_CORE_CLOSED_LOOP_FEEDBACK_V1_ENABLED = '1'
    process.env.THOUGHT_CORE_CLOSED_LOOP_FEEDBACK_URL =
      'http://127.0.0.1:18886/feedback/closed-loop'
  })

  afterEach(() => {
    global.fetch = originalFetch
    if (originalEnabled === undefined) {
      delete process.env.THOUGHT_CORE_CLOSED_LOOP_FEEDBACK_V1_ENABLED
    } else {
      process.env.THOUGHT_CORE_CLOSED_LOOP_FEEDBACK_V1_ENABLED = originalEnabled
    }
    if (originalUrl === undefined) {
      delete process.env.THOUGHT_CORE_CLOSED_LOOP_FEEDBACK_URL
    } else {
      process.env.THOUGHT_CORE_CLOSED_LOOP_FEEDBACK_URL = originalUrl
    }
  })

  it('forwards only the fixed loopback candidate and returns only event identity', async () => {
    global.fetch = jest.fn(
      async () =>
        new Response(
          JSON.stringify({
            ok: true,
            event_id: 'evt_ack',
            journal_entry_id: 'journal_private_not_forwarded',
            ingest_offset: 9,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
    ) as typeof fetch
    const res = response()

    await handler(request(validBody), res)

    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ ok: true, event_id: 'evt_ack' })
    const [target, init] = (global.fetch as jest.Mock).mock.calls[0]
    expect(target).toBe('http://127.0.0.1:18886/feedback/closed-loop')
    const forwarded = JSON.parse(String(init.body))
    expect(forwarded.details).toEqual(
      expect.objectContaining({
        outcome_class: 'needs_feedback',
        component: 'aituber_tts_synthesis',
      })
    )
    expect(JSON.stringify(forwarded)).not.toMatch(
      /raw|prompt|transcript|audio|secret|path|url/i
    )
  })

  it.each([
    'http://127.255.0.254:18886/feedback/closed-loop',
    'http://localhost:18886/feedback/closed-loop',
    'http://[::1]:18886/feedback/closed-loop',
  ])('accepts only an explicit strict loopback host: %s', async (target) => {
    process.env.THOUGHT_CORE_CLOSED_LOOP_FEEDBACK_URL = target
    global.fetch = jest.fn(
      async () =>
        new Response(JSON.stringify({ ok: true, event_id: 'evt_loopback' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
    ) as typeof fetch
    const res = response()

    await handler(request(validBody), res)

    expect(res.statusCode).toBe(200)
    expect(global.fetch).toHaveBeenCalledTimes(1)
    expect((global.fetch as jest.Mock).mock.calls[0][0]).toBe(
      new URL(target).toString()
    )
  })

  it.each([
    'http://127.example.invalid:18886/feedback/closed-loop',
    'http://127.0.0.1.example.invalid:18886/feedback/closed-loop',
    'http://127.0.0:18886/feedback/closed-loop',
    'http://127.0.0.999:18886/feedback/closed-loop',
  ])('rejects DNS-prefix or malformed numeric lookalikes before fetch: %s', async (target) => {
    process.env.THOUGHT_CORE_CLOSED_LOOP_FEEDBACK_URL = target
    global.fetch = jest.fn() as typeof fetch
    const res = response()

    await handler(request(validBody), res)

    expect(res.statusCode).toBe(400)
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('rejects a non-loopback target before fetch', async () => {
    process.env.THOUGHT_CORE_CLOSED_LOOP_FEEDBACK_URL =
      'https://example.invalid/feedback/closed-loop'
    global.fetch = jest.fn() as typeof fetch
    const res = response()
    await handler(request(validBody), res)
    expect(res.statusCode).toBe(400)
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('rejects private or unexpected body fields before fetch', async () => {
    global.fetch = jest.fn() as typeof fetch
    const res = response()
    await handler(request({ ...validBody, raw_payload: 'SECRET' }), res)
    expect(res.statusCode).toBe(400)
    expect(global.fetch).not.toHaveBeenCalled()
    expect(JSON.stringify(res.body)).not.toContain('SECRET')
  })
})
