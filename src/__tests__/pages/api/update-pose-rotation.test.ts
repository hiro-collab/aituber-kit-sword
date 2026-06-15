/**
 * @jest-environment node
 */

const mockReadFile = jest.fn()
const mockWriteFile = jest.fn()

jest.mock('fs/promises', () => ({
  readFile: (...args: unknown[]) => mockReadFile(...args),
  writeFile: (...args: unknown[]) => mockWriteFile(...args),
}))

const mockIsDemoMode = jest.fn(() => false)
jest.mock('@/utils/restrictedMode', () => ({
  isRestrictedMode: () => mockIsDemoMode(),
  createRestrictedModeErrorResponse: (feature: string) => ({
    error: 'feature_disabled_in_restricted_mode',
    message: `The feature "${feature}" is disabled in restricted mode.`,
  }),
}))

import { createMocks } from 'node-mocks-http'
import type { NextApiRequest, NextApiResponse } from 'next'
import handler from '@/pages/api/update-pose-rotation'

describe('/api/update-pose-rotation', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockIsDemoMode.mockReturnValue(false)
    mockReadFile.mockResolvedValue(JSON.stringify({ name: 'pose' }))
    mockWriteFile.mockResolvedValue(undefined)
    jest.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('updates pose JSON under public/poses', async () => {
    const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
      method: 'POST',
      body: {
        jsonPath: '/poses/listening.json',
        angleDeg: 12.5,
      },
    })

    await handler(req, res)

    expect(res._getStatusCode()).toBe(200)
    expect(mockWriteFile).toHaveBeenCalledWith(
      expect.stringContaining('listening.json'),
      JSON.stringify({ name: 'pose', yRotationOffsetDeg: 12.5 }, null, 2)
    )
  })

  it('rejects JSON paths outside the poses directory', async () => {
    const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
      method: 'POST',
      body: {
        jsonPath: '/speakers.json',
        angleDeg: 12.5,
      },
    })

    await handler(req, res)

    expect(res._getStatusCode()).toBe(400)
    expect(JSON.parse(res._getData())).toEqual({ error: 'Invalid pose path' })
    expect(mockWriteFile).not.toHaveBeenCalled()
  })

  it('rejects traversal inside pose JSON paths', async () => {
    const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
      method: 'POST',
      body: {
        jsonPath: '/poses/../../package.json',
        angleDeg: 12.5,
      },
    })

    await handler(req, res)

    expect(res._getStatusCode()).toBe(400)
    expect(mockWriteFile).not.toHaveBeenCalled()
  })
})
