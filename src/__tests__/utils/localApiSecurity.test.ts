/**
 * @jest-environment node
 */

import type { NextApiRequest, NextApiResponse } from 'next'
import {
  enforceLocalApiRequest,
  isLoopbackAddress,
  isTrustedRequestOrigin,
} from '@/utils/localApiSecurity'

function createMockReq(
  overrides: Partial<NextApiRequest> = {}
): NextApiRequest {
  return {
    method: 'POST',
    headers: { host: '127.0.0.1:3000' },
    socket: { remoteAddress: '127.0.0.1' },
    ...overrides,
  } as NextApiRequest
}

function createMockRes(): NextApiResponse & {
  _status: number
  _json: unknown
} {
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

describe('localApiSecurity', () => {
  const originalEnv = process.env

  beforeEach(() => {
    process.env = { ...originalEnv }
    delete process.env.ALLOW_REMOTE_LOCAL_APIS
    delete process.env.LOCAL_API_TRUST_PROXY_HEADERS
    delete process.env.LOCAL_API_REQUIRE_TOKEN
    delete process.env.LOCAL_API_REMOTE_TOKEN
    delete process.env.AITUBER_LOCAL_API_TOKEN
  })

  afterAll(() => {
    process.env = originalEnv
  })

  it.each(['', '127.0.0.1', '127.42.0.1', '::1', '::ffff:127.0.0.1'])(
    'treats %s as loopback',
    (address) => {
      expect(isLoopbackAddress(address)).toBe(true)
    }
  )

  it('rejects non-loopback client addresses', () => {
    const req = createMockReq({
      socket: { remoteAddress: '192.168.1.40' } as any,
    })
    const res = createMockRes()

    expect(enforceLocalApiRequest(req, res, { feature: 'test' })).toBe(false)
    expect(res._status).toBe(403)
    expect(res._json).toEqual(
      expect.objectContaining({ errorCode: 'LocalAccessRequired' })
    )
  })

  it('does not trust spoofed forwarded-for headers by default', () => {
    const req = createMockReq({
      headers: {
        host: '127.0.0.1:3000',
        'x-forwarded-for': '127.0.0.1',
      },
      socket: { remoteAddress: '192.168.1.40' } as any,
    })
    const res = createMockRes()

    expect(enforceLocalApiRequest(req, res, { feature: 'test' })).toBe(false)
    expect(res._status).toBe(403)
    expect(res._json).toEqual(
      expect.objectContaining({ errorCode: 'LocalAccessRequired' })
    )
  })

  it('uses the first forwarded-for address only when proxy headers are trusted', () => {
    process.env.LOCAL_API_TRUST_PROXY_HEADERS = 'true'
    const req = createMockReq({
      headers: {
        host: '127.0.0.1:3000',
        'x-forwarded-for': '127.0.0.1, 192.168.1.40',
      },
      socket: { remoteAddress: '192.168.1.40' } as any,
    })
    const res = createMockRes()

    expect(enforceLocalApiRequest(req, res, { feature: 'test' })).toBe(true)
    expect(res._status).toBe(200)
  })

  it('falls back to socket address when trusted forwarded-for starts blank', () => {
    process.env.LOCAL_API_TRUST_PROXY_HEADERS = 'true'
    const req = createMockReq({
      headers: {
        host: '127.0.0.1:3000',
        'x-forwarded-for': ' , 127.0.0.1',
      },
      socket: { remoteAddress: '192.168.1.40' } as any,
    })
    const res = createMockRes()

    expect(enforceLocalApiRequest(req, res, { feature: 'test' })).toBe(false)
    expect(res._status).toBe(403)
    expect(res._json).toEqual(
      expect.objectContaining({ errorCode: 'LocalAccessRequired' })
    )
  })

  it('allows same-origin loopback browser requests', () => {
    const req = createMockReq({
      headers: {
        host: '127.0.0.1:3000',
        origin: 'http://127.0.0.1:3000',
      },
    })

    expect(isTrustedRequestOrigin(req)).toBe(true)
  })

  it('allows localhost to 127.0.0.1 loopback origin on the same port', () => {
    const req = createMockReq({
      headers: {
        host: '127.0.0.1:3000',
        origin: 'http://localhost:3000',
      },
    })

    expect(isTrustedRequestOrigin(req)).toBe(true)
  })

  it('rejects browser requests from unrelated origins', () => {
    const req = createMockReq({
      headers: {
        host: '127.0.0.1:3000',
        origin: 'https://example.com',
      },
    })
    const res = createMockRes()

    expect(enforceLocalApiRequest(req, res, { feature: 'test' })).toBe(false)
    expect(res._status).toBe(403)
    expect(res._json).toEqual(
      expect.objectContaining({ errorCode: 'UntrustedOrigin' })
    )
  })

  it.each([
    ['null origin', { host: '127.0.0.1:3000', origin: 'null' }],
    ['malformed origin', { host: '127.0.0.1:3000', origin: 'http://[::1' }],
    [
      'unsupported scheme',
      { host: '127.0.0.1:3000', origin: 'chrome-extension://abc' },
    ],
    [
      'loopback port mismatch',
      { host: '127.0.0.1:3000', origin: 'http://127.0.0.1:3001' },
    ],
    [
      'host array first value mismatch',
      {
        host: ['127.0.0.1:3000', '127.0.0.1:3001'],
        origin: 'http://127.0.0.1:3001',
      },
    ],
  ])('rejects malformed or mismatched origin: %s', (_label, headers) => {
    const req = createMockReq({
      headers,
    } as Partial<NextApiRequest>)
    const res = createMockRes()

    expect(enforceLocalApiRequest(req, res, { feature: 'test' })).toBe(false)
    expect(res._status).toBe(403)
    expect(res._json).toEqual(
      expect.objectContaining({ errorCode: 'UntrustedOrigin' })
    )
  })

  it('requires a configured token when remote local APIs are enabled', () => {
    process.env.ALLOW_REMOTE_LOCAL_APIS = 'true'
    const req = createMockReq({
      headers: {
        host: '192.168.1.10:3000',
        origin: 'http://192.168.1.10:3000',
      },
      socket: { remoteAddress: '192.168.1.40' } as any,
    })
    const res = createMockRes()

    expect(enforceLocalApiRequest(req, res, { feature: 'test' })).toBe(false)
    expect(res._status).toBe(403)
    expect(res._json).toEqual(
      expect.objectContaining({ errorCode: 'RemoteTokenRequired' })
    )
  })

  it('rejects invalid remote local API tokens', () => {
    process.env.ALLOW_REMOTE_LOCAL_APIS = 'true'
    process.env.LOCAL_API_REMOTE_TOKEN = 'expected-token'
    const req = createMockReq({
      headers: {
        host: '192.168.1.10:3000',
        origin: 'http://192.168.1.10:3000',
        authorization: 'Bearer wrong-token',
      },
      socket: { remoteAddress: '192.168.1.40' } as any,
    })
    const res = createMockRes()

    expect(enforceLocalApiRequest(req, res, { feature: 'test' })).toBe(false)
    expect(res._status).toBe(401)
    expect(res._json).toEqual(
      expect.objectContaining({ errorCode: 'InvalidApiToken' })
    )
  })

  it('allows remote local API requests with a valid token', () => {
    process.env.ALLOW_REMOTE_LOCAL_APIS = 'true'
    process.env.LOCAL_API_REMOTE_TOKEN = 'expected-token'
    const req = createMockReq({
      headers: {
        host: '192.168.1.10:3000',
        origin: 'http://192.168.1.10:3000',
        'x-api-token': 'expected-token',
      },
      socket: { remoteAddress: '192.168.1.40' } as any,
    })
    const res = createMockRes()

    expect(enforceLocalApiRequest(req, res, { feature: 'test' })).toBe(true)
    expect(res._status).toBe(200)
  })

  it('can require tokens for loopback requests when configured', () => {
    process.env.LOCAL_API_REQUIRE_TOKEN = 'true'
    process.env.LOCAL_API_REMOTE_TOKEN = 'expected-token'
    const req = createMockReq({
      headers: {
        host: '127.0.0.1:3000',
        origin: 'http://127.0.0.1:3000',
        authorization: 'Bearer expected-token',
      },
    })
    const res = createMockRes()

    expect(enforceLocalApiRequest(req, res, { feature: 'test' })).toBe(true)
  })
})
