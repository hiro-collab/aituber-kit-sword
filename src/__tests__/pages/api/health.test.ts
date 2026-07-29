/** @jest-environment node */

import type { NextApiRequest, NextApiResponse } from 'next'
import handler from '@/pages/api/health'

const request = (method: string): NextApiRequest =>
  ({ method, query: {}, headers: {}, socket: {} }) as NextApiRequest

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

describe('launcher health endpoint', () => {
  it('returns only the fixed AIT service identity for GET', () => {
    const res = response()

    handler(request('GET'), res)

    expect(res.statusCode).toBe(200)
    expect(res.headers['Cache-Control']).toBe('no-store')
    expect(res.body).toEqual({
      schema_version: 'aituber_health.v1',
      ok: true,
      status: 'ready',
      service_id: 'aituber_kit',
    })
    expect(JSON.stringify(res.body)).not.toMatch(/path|token|secret|command/i)
  })

  it('fails closed for other methods without exposing request data', () => {
    const res = response()

    handler(request('POST'), res)

    expect(res.statusCode).toBe(405)
    expect(res.headers.Allow).toBe('GET')
    expect(res.body).toEqual({
      schema_version: 'aituber_health.v1',
      ok: false,
      status: 'method_not_allowed',
      service_id: 'aituber_kit',
    })
  })
})
