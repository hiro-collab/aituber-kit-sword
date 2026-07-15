/**
 * @jest-environment node
 */

const mockAxiosPost = jest.fn()
const mockIsAxiosError = jest.fn((_error: unknown) => false)
const mockEnforceLocalApiRequest = jest.fn((..._args: unknown[]) => true)

jest.mock('axios', () => ({
  post: (...args: unknown[]) => mockAxiosPost(...args),
  isAxiosError: (error: unknown) => mockIsAxiosError(error),
}))

jest.mock('@/utils/localApiSecurity', () => ({
  enforceLocalApiRequest: (...args: unknown[]) =>
    mockEnforceLocalApiRequest(...args),
}))

import type { NextApiRequest, NextApiResponse } from 'next'
import handler from '@/pages/api/tts-aivis-cloud-api'

type HeaderValue = string | number | readonly string[]

function createMockReq(): NextApiRequest {
  return {
    method: 'POST',
    body: {
      text: 'こんにちは',
      modelUuid: '12345678-1234-1234-1234-123456789abc',
      apiKey: 'aivis_12345678901234',
      styleId: 3,
      speed: 1.2,
      pitch: 0.1,
      emotionalIntensity: 1.1,
      tempoDynamics: 0.9,
      prePhonemeLength: 0.2,
      postPhonemeLength: 0.3,
      outputFormat: 'wav',
    },
  } as NextApiRequest
}

function createMockRes() {
  const res = {
    _status: 200,
    _json: null as unknown,
    _headers: {} as Record<string, HeaderValue>,
    _ended: undefined as Buffer | undefined,
    status(code: number) {
      res._status = code
      return res
    },
    json(data: unknown) {
      res._json = data
      return res
    },
    setHeader(key: string, value: HeaderValue) {
      res._headers[key] = value
      return res
    },
    end(data: Buffer) {
      res._ended = data
      return res
    },
  }

  return res as unknown as NextApiResponse & {
    _status: number
    _json: unknown
    _headers: Record<string, HeaderValue>
    _ended: Buffer | undefined
  }
}

describe('/api/tts-aivis-cloud-api', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockIsAxiosError.mockReturnValue(false)
    mockEnforceLocalApiRequest.mockReturnValue(true)
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('preserves valid response headers and the current request/audio contract', async () => {
    const audio = new Uint8Array([1, 2, 3])
    mockAxiosPost.mockResolvedValue({
      data: audio,
      headers: {
        'content-type': 'audio/wav',
        'x-aivis-character-count': 5,
        'x-aivis-credits-remaining': '10',
      },
    })
    const req = createMockReq()
    const res = createMockRes()

    await handler(req, res)

    expect(mockEnforceLocalApiRequest).toHaveBeenCalledWith(req, res, {
      feature: 'tts-aivis-cloud-api',
    })
    expect(mockAxiosPost).toHaveBeenCalledWith(
      'https://api.aivis-project.com/v1/tts/synthesize',
      {
        model_uuid: '12345678-1234-1234-1234-123456789abc',
        text: 'こんにちは',
        use_ssml: true,
        speaking_rate: 1.2,
        pitch: 0.1,
        emotional_intensity: 1.1,
        tempo_dynamics_scale: 0.9,
        pre_phoneme_length: 0.2,
        post_phoneme_length: 0.3,
        output_format: 'wav',
        output_sampling_rate: 44100,
        output_audio_channels: 'mono',
        style_id: 3,
      },
      {
        headers: {
          Authorization: 'Bearer aivis_12345678901234',
          'Content-Type': 'application/json',
        },
        responseType: 'arraybuffer',
        timeout: 60000,
      }
    )
    expect(res._headers).toEqual({
      'Content-Type': 'audio/wav',
      'X-Aivis-Character-Count': 5,
      'X-Aivis-Credits-Remaining': '10',
    })
    expect(res._ended).toEqual(Buffer.from(audio))
  })

  it.each([
    ['CRLF', 'audio/mpeg\r\nX-Leak: yes'],
    ['control character', 'audio/\u0000mpeg'],
    ['number', 1],
    ['array', ['audio/mpeg']],
  ])(
    'uses the content fallback for an invalid %s value',
    async (_name, value) => {
      mockAxiosPost.mockResolvedValue({
        data: new Uint8Array(),
        headers: {
          'content-type': value,
        },
      })
      const res = createMockRes()

      await handler(createMockReq(), res)

      expect(res._headers).toEqual({ 'Content-Type': 'audio/mpeg' })
    }
  )

  it('uses the content fallback and omits missing optional headers', async () => {
    mockAxiosPost.mockResolvedValue({
      data: new Uint8Array(),
      headers: {
        'content-type': undefined,
        'x-aivis-character-count': null,
      },
    })
    const res = createMockRes()

    await handler(createMockReq(), res)

    expect(res._headers).toEqual({ 'Content-Type': 'audio/mpeg' })
  })

  it.each([
    ['array', ['1']],
    ['empty string', ''],
    ['CRLF', '1\r\nX-Leak: yes'],
    ['negative number', -1],
    ['decimal number', 1.5],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['overlong digits', '1'.repeat(21)],
  ])('omits an invalid %s count value', async (_name, value) => {
    mockAxiosPost.mockResolvedValue({
      data: new Uint8Array(),
      headers: {
        'content-type': 'audio/mpeg',
        'x-aivis-character-count': value,
      },
    })
    const res = createMockRes()

    await handler(createMockReq(), res)

    expect(res._headers).toEqual({ 'Content-Type': 'audio/mpeg' })
  })

  it('omits an object count value without invoking its toString', async () => {
    const toString = jest.fn(() => '5')
    mockAxiosPost.mockResolvedValue({
      data: new Uint8Array(),
      headers: {
        'content-type': 'audio/mpeg',
        'x-aivis-character-count': { toString },
      },
    })
    const res = createMockRes()

    await handler(createMockReq(), res)

    expect(res._headers).toEqual({ 'Content-Type': 'audio/mpeg' })
    expect(toString).not.toHaveBeenCalled()
  })

  it('does not call the provider when the local request guard rejects', async () => {
    mockEnforceLocalApiRequest.mockReturnValue(false)

    await handler(createMockReq(), createMockRes())

    expect(mockAxiosPost).not.toHaveBeenCalled()
  })

  it.each([
    [401, 'Invalid API key'],
    [402, 'Insufficient credits'],
    [404, 'Model not found'],
    [422, 'Invalid request parameters'],
    [429, 'Rate limit exceeded'],
  ])(
    'keeps the fixed provider message for status %i',
    async (status, message) => {
      jest.spyOn(console, 'error').mockImplementation(() => {})
      mockIsAxiosError.mockReturnValue(true)
      mockAxiosPost.mockRejectedValue({ response: { status } })
      const res = createMockRes()

      await handler(createMockReq(), res)

      expect(res._status).toBe(status)
      expect(res._json).toEqual({ error: message })
    }
  )

  it('returns a fixed provider error without logging or returning private fields', async () => {
    const privateMarker = 'PRIVATE_MARKER_DO_NOT_ECHO'
    const authorization = 'Bearer secret-provider-token'
    const consoleError = jest
      .spyOn(console, 'error')
      .mockImplementation(() => {})
    mockIsAxiosError.mockReturnValue(true)
    mockAxiosPost.mockRejectedValue({
      message: privateMarker,
      stack: `stack ${privateMarker}`,
      config: { headers: { Authorization: authorization } },
      request: { text: privateMarker },
      response: {
        status: 418,
        headers: { Authorization: authorization },
        data: { detail: privateMarker },
      },
    })
    const res = createMockRes()

    await handler(createMockReq(), res)

    expect(res._status).toBe(418)
    expect(res._json).toEqual({ error: 'Aivis provider error' })
    const publicResult = JSON.stringify({
      console: consoleError.mock.calls,
      response: res._json,
    })
    expect(publicResult).not.toContain(privateMarker)
    expect(publicResult).not.toContain(authorization)
  })

  it('returns a fixed 502 response for an invalid provider status', async () => {
    const consoleError = jest
      .spyOn(console, 'error')
      .mockImplementation(() => {})
    mockIsAxiosError.mockReturnValue(true)
    mockAxiosPost.mockRejectedValue({
      response: { status: '401', data: { detail: 'private' } },
    })
    const res = createMockRes()

    await handler(createMockReq(), res)

    expect(res._status).toBe(502)
    expect(res._json).toEqual({ error: 'Aivis provider unavailable' })
    expect(consoleError).toHaveBeenCalledWith(
      'AIVIS_CLOUD_TTS_PROVIDER_ERROR',
      'provider_status_unavailable'
    )
  })

  it('returns a fixed 500 response for a non-Axios error', async () => {
    const consoleError = jest
      .spyOn(console, 'error')
      .mockImplementation(() => {})
    mockAxiosPost.mockRejectedValue(new Error('private failure'))
    const res = createMockRes()

    await handler(createMockReq(), res)

    expect(res._status).toBe(500)
    expect(res._json).toEqual({ error: 'Internal Server Error' })
    expect(consoleError).toHaveBeenCalledWith('AIVIS_CLOUD_TTS_INTERNAL_ERROR')
  })
})
