/**
 * @jest-environment node
 */

jest.mock('fs', () => ({
  existsSync: jest.fn(() => true),
  mkdirSync: jest.fn(),
  promises: {
    copyFile: jest.fn(),
  },
}))

jest.mock('formidable', () => {
  return jest.fn(() => ({
    parse: jest.fn(),
  }))
})

const mockIsDemoMode = jest.fn(() => false)
jest.mock('@/utils/restrictedMode', () => ({
  isRestrictedMode: () => mockIsDemoMode(),
  createRestrictedModeErrorResponse: (feature: string) => ({
    error: 'feature_disabled_in_restricted_mode',
    message: `The feature "${feature}" is disabled in restricted mode.`,
  }),
}))

import type { NextApiRequest, NextApiResponse } from 'next'
import handler from '@/pages/api/upload-vrm-list'

function createMockReq(
  overrides: Partial<NextApiRequest> = {}
): NextApiRequest {
  return {
    method: 'POST',
    body: {},
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

describe('/api/upload-vrm-list', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockIsDemoMode.mockReturnValue(false)
  })

  it('should confine path traversal filenames to the VRM directory', async () => {
    const fs = require('fs')
    const formidable = require('formidable')
    formidable.mockImplementation(() => ({
      parse: jest.fn().mockResolvedValue([
        {},
        {
          file: [
            {
              originalFilename: '../avatar.vrm',
              filepath: '/tmp/upload-123',
            },
          ],
        },
      ]),
    }))

    const req = createMockReq()
    const res = createMockRes()

    await handler(req, res)

    expect(res._status).toBe(200)
    expect((res._json as any).path).toBe('/vrm/avatar.vrm')
    expect(fs.promises.copyFile).toHaveBeenCalledWith(
      '/tmp/upload-123',
      expect.stringMatching(/[\\/]public[\\/]vrm[\\/]avatar\.vrm$/)
    )
  })
})
