/**
 * @jest-environment node
 */

jest.mock('fs', () => ({
  mkdirSync: jest.fn(),
  appendFileSync: jest.fn(),
}))

import type { NextApiRequest, NextApiResponse } from 'next'

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
    status(code: number) {
      res._status = code
      return res
    },
    json(data: unknown) {
      res._json = data
      return res
    },
  }
  return res as unknown as NextApiResponse & {
    _status: number
    _json: unknown
  }
}

describe('/api/difyChat', () => {
  const originalEnv = process.env
  let originalFetch: typeof global.fetch

  beforeEach(() => {
    jest.resetModules()
    jest.clearAllMocks()
    process.env = { ...originalEnv }
    delete process.env.DIFY_URL
    delete process.env.DIFY_API_URL
    delete process.env.DIFY_ALLOWED_URLS
    delete process.env.DIFY_KEY
    delete process.env.DIFY_API_KEY

    originalFetch = global.fetch
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue({ answer: 'ok' }),
    }) as any
  })

  afterEach(() => {
    process.env = originalEnv
    global.fetch = originalFetch
  })

  it('uses the server configured Dify URL instead of a request URL', async () => {
    process.env.DIFY_API_KEY = 'server-key'
    process.env.DIFY_URL = 'http://127.0.0.1:8080/v1'
    const handler = require('@/pages/api/difyChat').default
    const res = createMockRes()

    await handler(
      createMockReq({
        body: {
          query: 'hello',
          apiKey: 'stale-browser-key',
          url: 'https://evil.example.test/v1',
          stream: false,
        },
      }),
      res
    )

    expect(res._status).toBe(200)
    expect(global.fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:8080/v1/chat-messages',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer server-key',
        }),
      })
    )
  })

  it('rejects request URLs unless they are explicitly allowlisted', async () => {
    process.env.DIFY_API_KEY = 'server-key'
    const handler = require('@/pages/api/difyChat').default
    const res = createMockRes()

    await handler(
      createMockReq({
        body: {
          query: 'hello',
          url: 'https://evil.example.test/v1',
          stream: false,
        },
      }),
      res
    )

    expect(res._status).toBe(400)
    expect(global.fetch).not.toHaveBeenCalled()
  })
})
