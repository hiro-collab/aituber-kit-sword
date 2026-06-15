/**
 * @jest-environment node
 */

import type { NextApiRequest, NextApiResponse } from 'next'

function createMockReq(
  overrides: Partial<NextApiRequest> = {}
): NextApiRequest {
  return {
    method: 'GET',
    body: {},
    query: {},
    headers: { host: '127.0.0.1:18880' },
    ...overrides,
  } as NextApiRequest
}

function createMockRes() {
  const res = {
    _status: 200,
    _json: null as unknown,
    _headers: {} as Record<string, string>,
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
  }
  return res as unknown as NextApiResponse & {
    _status: number
    _json: unknown
    _headers: Record<string, string>
  }
}

describe('/api/projectionDisplayState', () => {
  beforeEach(() => {
    jest.resetModules()
  })

  it('stores only bounded local display state for passive Projection Visual', () => {
    const handler = require('@/pages/api/projectionDisplayState').default
    const postRes = createMockRes()

    handler(
      createMockReq({
        method: 'POST',
        body: {
          assistantMessage: 'a'.repeat(1700),
          assistantMessageId: 'assistant-message-safe-1',
          speechOutputSummary: {
            schema_version: 'projection_visual_speech_output_parity.v0',
            surface: 'tts_talk_message',
            source_field: 'Talk.message',
            message_id: 'assistant-message-safe-1',
            turn_id: 'turn-safe-1',
            text_hash: '1234abcd',
            text_length: 42,
            meaning_class: 'command_accepted_unconfirmed',
            raw_text_published: false,
            raw_audio_published: false,
            provider_payload_published: false,
            private_data_published: false,
          },
          settings: {
            modelType: 'vrm',
            selectedVrmPath: '/vrm/Nutachisan.vrm',
            selectedLive2DPath: '/live2d/model.json',
            selectedPNGTuberPath: '/png/avatar.png',
            characterName: 'n'.repeat(100),
            showCharacterName: true,
            fixedCharacterPosition: false,
            characterPosition: { x: 100, y: -100, z: 2, scale: 99 },
            characterRotation: { x: 1, y: 2, z: 3 },
            lightingIntensity: 99,
          },
        },
      }),
      postRes
    )

    expect(postRes._status).toBe(200)
    const postBody = postRes._json as {
      state: {
        sequence: number
        assistantMessage: string
        assistantMessageId: string | null
        speechOutputSummary: {
          source_field: string
          message_id: string | null
          text_hash: string
          text_length: number
          meaning_class: string
        } | null
        settings: {
          modelType?: string
          characterName?: string
          characterPosition?: { x: number; y: number; z: number; scale: number }
          lightingIntensity?: number
        }
      }
    }
    expect(postBody.state.sequence).toBe(1)
    expect(postBody.state.assistantMessage).toHaveLength(1600)
    expect(postBody.state.assistantMessageId).toBe('assistant-message-safe-1')
    expect(postBody.state.speechOutputSummary).toEqual(
      expect.objectContaining({
        source_field: 'Talk.message',
        message_id: 'assistant-message-safe-1',
        text_hash: '1234abcd',
        text_length: 42,
        meaning_class: 'command_accepted_unconfirmed',
      })
    )
    expect(postBody.state.settings.modelType).toBe('vrm')
    expect(postBody.state.settings.characterName).toHaveLength(80)
    expect(postBody.state.settings.characterPosition).toEqual({
      x: 20,
      y: -20,
      z: 2,
      scale: 10,
    })
    expect(postBody.state.settings.lightingIntensity).toBe(3)

    const getRes = createMockRes()
    handler(createMockReq(), getRes)
    expect(getRes._status).toBe(200)
    expect(
      (getRes._json as { state: { sequence: number } }).state.sequence
    ).toBe(1)
  })

  it('redacts unsafe assistant message ids from the passive display state', () => {
    const handler = require('@/pages/api/projectionDisplayState').default
    const postRes = createMockRes()

    handler(
      createMockReq({
        method: 'POST',
        body: {
          assistantMessage: 'safe display text',
          assistantMessageId: 'C:\\private\\assistant-message.txt',
          settings: {},
        },
      }),
      postRes
    )

    expect(postRes._status).toBe(200)
    expect(
      (postRes._json as { state: { assistantMessageId: string | null } }).state
        .assistantMessageId
    ).toBeNull()
  })

  it('rejects invalid bodies and unsupported methods without mutating state', () => {
    const handler = require('@/pages/api/projectionDisplayState').default

    const invalidPostRes = createMockRes()
    handler(createMockReq({ method: 'POST', body: ['bad'] }), invalidPostRes)
    expect(invalidPostRes._status).toBe(400)
    expect(invalidPostRes._json).toEqual({ ok: false, error: 'invalid_body' })

    const putRes = createMockRes()
    handler(createMockReq({ method: 'PUT' }), putRes)
    expect(putRes._status).toBe(405)
    expect(putRes._headers.Allow).toBe('GET, POST')
  })
})
