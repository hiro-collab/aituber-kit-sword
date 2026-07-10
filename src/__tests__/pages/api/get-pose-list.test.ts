/**
 * @jest-environment node
 */

const mockIsRestrictedMode = jest.fn(() => true)
jest.mock('@/utils/restrictedMode', () => ({
  isRestrictedMode: () => mockIsRestrictedMode(),
}))

import type { NextApiRequest, NextApiResponse } from 'next'
import assetManifest from '@/constants/assetManifest.json'
import handler from '@/pages/api/get-pose-list'

function createMockReq(
  overrides: Partial<NextApiRequest> = {}
): NextApiRequest {
  return {
    method: 'GET',
    headers: {},
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

describe('/api/get-pose-list', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockIsRestrictedMode.mockReturnValue(true)
  })

  it('returns every generated manifest pose exactly once in restricted mode', async () => {
    const req = createMockReq()
    const res = createMockRes()

    await handler(req, res)

    expect(res._status).toBe(200)
    expect(res._json).toEqual(assetManifest.poses)
    expect(Array.isArray(res._json)).toBe(true)

    const poses = res._json as Array<{ name: string; path: string }>
    expect(poses).toHaveLength(assetManifest.poses.length)
    expect(new Set(poses.map((pose) => pose.path)).size).toBe(poses.length)
    expect(new Set(poses.map((pose) => pose.name)).size).toBe(poses.length)
    for (const pose of poses) {
      expect(pose).toEqual({
        name: expect.any(String),
        path: expect.stringMatching(/^\/poses\/[^/]+\.json$/),
      })
      expect(pose.path).toBe(`/poses/${pose.name}.json`)
    }
  })

  it('returns 405 for non-GET requests', async () => {
    const req = createMockReq({ method: 'POST' })
    const res = createMockRes()

    await handler(req, res)

    expect(res._status).toBe(405)
    expect(res._json).toEqual({ error: 'Method not allowed' })
  })
})
