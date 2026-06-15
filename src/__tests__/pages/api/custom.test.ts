/**
 * @jest-environment node
 */

const mockHandleCustomApi = jest.fn()
const mockPipeResponse = jest.fn()

jest.mock('@/lib/api-services/customApi', () => ({
  handleCustomApi: (...args: unknown[]) => mockHandleCustomApi(...args),
}))

jest.mock('@/utils/pipeResponse', () => ({
  pipeResponse: (...args: unknown[]) => mockPipeResponse(...args),
}))

import type { NextApiRequest, NextApiResponse } from 'next'
import handler from '@/pages/api/ai/custom'

const originalEnv = process.env

function createMockReq(
  overrides: Partial<NextApiRequest> = {}
): NextApiRequest {
  return {
    method: 'POST',
    body: {
      messages: [],
      customApiUrl: 'https://api.example.test/chat',
      customApiHeaders: '{}',
      customApiBody: '{}',
      stream: true,
    },
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

describe('/api/ai/custom', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    process.env = { ...originalEnv }
    delete process.env.CUSTOM_API_URL
    delete process.env.CUSTOM_API_HEADERS
    delete process.env.CUSTOM_API_BODY
    delete process.env.CUSTOM_API_ALLOWED_URLS
  })

  afterEach(() => {
    process.env = originalEnv
  })

  it('rejects request URL when server-side headers would be attached without allowlist', async () => {
    process.env.CUSTOM_API_HEADERS = '{"Authorization":"Bearer secret"}'

    const req = createMockReq()
    const res = createMockRes()

    await handler(req, res)

    expect(res._status).toBe(400)
    expect(res._json).toEqual({
      error: 'Invalid or untrusted customApiUrl',
      errorCode: 'CustomAPIInvalidRequest',
    })
    expect(mockHandleCustomApi).not.toHaveBeenCalled()
  })

  it('allows request URL with server-side headers only when allowlisted', async () => {
    process.env.CUSTOM_API_HEADERS = '{"Authorization":"Bearer secret"}'
    process.env.CUSTOM_API_ALLOWED_URLS = 'https://api.example.test/chat'
    mockHandleCustomApi.mockResolvedValue(new Response('ok'))

    const req = createMockReq()
    const res = createMockRes()

    await handler(req, res)

    expect(mockHandleCustomApi).toHaveBeenCalledWith(
      [],
      'https://api.example.test/chat',
      '{"Authorization":"Bearer secret"}',
      '{}',
      true,
      false
    )
    expect(mockPipeResponse).toHaveBeenCalled()
  })
})
