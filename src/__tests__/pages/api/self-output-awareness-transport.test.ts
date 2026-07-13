/**
 * @jest-environment node
 */

import type { NextApiRequest, NextApiResponse } from 'next'

const lifecycle = (
  lifecycleState: 'handoff_accepted' | 'cooldown' | 'released',
  generation = 1
) => ({
  schema_version: 'ait_system_speech_lifecycle.v0',
  system_speech_session_id:
    'system-speech-session:sss_11111111111111111111111111111111',
  speech_session_generation: generation,
  playback_event_ref: 'playback-event:pe_22222222222222222222222222222222',
  lifecycle_state: lifecycleState,
  queue_handoff_status: 'accepted',
  queue_completion_status:
    lifecycleState === 'handoff_accepted' ? 'pending' : 'callback_observed',
  playback_observation_status: 'not_observed',
  suppression_status: lifecycleState === 'released' ? 'released' : 'active',
  cooldown_status:
    lifecycleState === 'handoff_accepted'
      ? 'clear'
      : lifecycleState === 'cooldown'
        ? 'active'
        : 'elapsed',
  cooldown_ms: 500,
  compare_and_release_required: true,
  may_start_user_turn: false,
  turn_adoption_authority: false,
  raw_text_published: false,
  text_hash_published: false,
  provider_payload_published: false,
  path_published: false,
  url_published: false,
  raw_audio_published: false,
  device_identity_published: false,
  private_data_published: false,
})

const envelope = (
  lifecycleState: 'handoff_accepted' | 'cooldown' | 'released',
  generation = 1
) => ({
  schema_version: 'ait_system_speech_lifecycle_transport.v0',
  lifecycle: lifecycle(lifecycleState, generation),
  client_timestamp_wall: '2026-07-13T07:30:00.000Z',
  client_timestamp_monotonic: 123.5,
  client_performance_now: 123.5,
  raw_private_publication_flags: false,
})

const createMockReq = (
  overrides: Partial<NextApiRequest> = {}
): NextApiRequest =>
  ({
    method: 'GET',
    body: {},
    query: {},
    headers: { host: '127.0.0.1:3000' },
    socket: { remoteAddress: '127.0.0.1' },
    ...overrides,
  }) as NextApiRequest

const createMockRes = () => {
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

const post = (handler: Function, body: unknown, origin?: string) => {
  const res = createMockRes()
  handler(
    createMockReq({
      method: 'POST',
      body,
      headers: {
        host: '127.0.0.1:3000',
        ...(origin === undefined ? {} : { origin }),
      },
    }),
    res
  )
  return res
}

describe('/api/self-output-awareness-transport', () => {
  beforeEach(() => {
    jest.resetModules()
    delete process.env.ALLOW_REMOTE_LOCAL_APIS
    delete process.env.LOCAL_API_REQUIRE_TOKEN
    delete process.env.LOCAL_API_REMOTE_TOKEN
    delete process.env.AITUBER_LOCAL_API_TOKEN
  })

  it('stores one exact ordered lifecycle and exposes only bounded state', () => {
    const handler =
      require('@/pages/api/self-output-awareness-transport').default
    const origin = 'http://127.0.0.1:3000'

    expect(post(handler, envelope('handoff_accepted'), origin)._status).toBe(
      202
    )
    expect(post(handler, envelope('cooldown'), origin)._status).toBe(202)
    expect(post(handler, envelope('released'), origin)._status).toBe(202)

    const getRes = createMockRes()
    handler(createMockReq(), getRes)
    expect(getRes._status).toBe(200)
    expect(getRes._json).toEqual({
      ok: true,
      result_class: 'lifecycle_transport_current',
      transport: {
        ...envelope('released'),
        transition_ordinal: 3,
      },
      raw_private_publication_flags: false,
    })
    expect(JSON.stringify(getRes._json)).not.toContain('transcript')
    expect(JSON.stringify(getRes._json)).not.toContain(
      'provider payload marker'
    )
    expect(JSON.stringify(getRes._json)).not.toContain('C:\\')
  })

  it('deduplicates an exact state without advancing the ordinal', () => {
    const handler =
      require('@/pages/api/self-output-awareness-transport').default
    const origin = 'http://localhost:3000'
    expect(post(handler, envelope('handoff_accepted'), origin)._status).toBe(
      202
    )
    const duplicate = post(handler, envelope('handoff_accepted'), origin)
    expect(duplicate._status).toBe(200)
    expect(duplicate._json).toEqual({
      ok: true,
      result_class: 'lifecycle_transport_duplicate',
      transition_ordinal: 1,
      raw_private_publication_flags: false,
    })
  })

  it.each([
    ['missing origin', undefined],
    ['cross origin', 'https://example.invalid'],
    ['null origin', 'null'],
  ])('rejects an unowned browser lifecycle source: %s', (_label, origin) => {
    const handler =
      require('@/pages/api/self-output-awareness-transport').default
    const res = post(handler, envelope('handoff_accepted'), origin)
    expect(res._status).toBe(403)
    expect(res._json).toEqual(
      origin === undefined
        ? {
            ok: false,
            result_class: 'explicit_same_origin_required',
            raw_private_publication_flags: false,
          }
        : expect.objectContaining({
            error: 'Forbidden',
            errorCode: 'UntrustedOrigin',
          })
    )
    expect(JSON.stringify(res._json)).not.toContain('private transcript marker')
  })

  it('rejects malformed, extra-field and authority-shaped payloads without echo', () => {
    const handler =
      require('@/pages/api/self-output-awareness-transport').default
    const origin = 'http://127.0.0.1:3000'
    const adversarial = {
      ...envelope('handoff_accepted'),
      transcript: 'private transcript marker',
      lifecycle: {
        ...lifecycle('handoff_accepted'),
        may_start_user_turn: true,
        turn_adoption_authority: true,
        path: 'C:\\private\\audio.wav',
      },
    }
    const res = post(handler, adversarial, origin)
    expect(res._status).toBe(400)
    const serialized = JSON.stringify(res._json)
    expect(serialized).not.toContain('private transcript marker')
    expect(serialized).not.toContain('audio.wav')
  })

  it('rejects out-of-order, stale and incompatible lease transitions', () => {
    const handler =
      require('@/pages/api/self-output-awareness-transport').default
    const origin = 'http://127.0.0.1:3000'

    expect(post(handler, envelope('cooldown'), origin)._status).toBe(409)
    expect(post(handler, envelope('handoff_accepted', 2), origin)._status).toBe(
      202
    )
    expect(post(handler, envelope('cooldown', 2), origin)._status).toBe(202)
    expect(post(handler, envelope('handoff_accepted', 1), origin)._status).toBe(
      409
    )

    const mismatched = envelope('released', 2)
    mismatched.lifecycle.playback_event_ref =
      'playback-event:pe_ffffffffffffffffffffffffffffffff'
    expect(post(handler, mismatched, origin)._status).toBe(409)
  })

  it('rejects unsupported methods with a fixed non-echoing class', () => {
    const handler =
      require('@/pages/api/self-output-awareness-transport').default
    const res = createMockRes()
    handler(createMockReq({ method: 'PUT' }), res)
    expect(res._status).toBe(405)
    expect(res._headers.Allow).toBe('GET, POST')
    expect(res._json).toEqual({
      ok: false,
      result_class: 'method_not_allowed',
      raw_private_publication_flags: false,
    })
  })
})
