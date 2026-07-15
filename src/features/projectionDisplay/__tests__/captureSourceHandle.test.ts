import fs from 'node:fs'
import path from 'node:path'
import {
  PROJECTION_STAGE_CAPTURE_HANDLE_ROLE,
  PROJECTION_STAGE_CAPTURE_HANDLE_VERSION,
  registerProjectionStageCaptureHandle,
  resolveProjectionCaptureOwnerOrigin,
} from '../captureSourceHandle'

const fixedRandom = {
  randomUUID: () => '00112233-4455-4677-8899-aabbccddeeff',
}

describe('projection stage capture source handle', () => {
  it('accepts only exact loopback origins without credentials or path data', () => {
    expect(resolveProjectionCaptureOwnerOrigin('http://127.0.0.1:9001')).toBe(
      'http://127.0.0.1:9001'
    )
    expect(resolveProjectionCaptureOwnerOrigin('https://localhost:9443/')).toBe(
      'https://localhost:9443'
    )
    expect(
      resolveProjectionCaptureOwnerOrigin('https://example.com')
    ).toBeUndefined()
    expect(
      resolveProjectionCaptureOwnerOrigin('http://127.0.0.1:9001/private')
    ).toBeUndefined()
    expect(
      resolveProjectionCaptureOwnerOrigin('http://user@127.0.0.1:9001')
    ).toBeUndefined()
    expect(
      resolveProjectionCaptureOwnerOrigin('http://127.0.0.1:9001/?token=x')
    ).toBeUndefined()
  })

  it('registers one opaque canonical handle for the exact owner origin', () => {
    const calls: Array<unknown> = []
    const registration = registerProjectionStageCaptureHandle({
      enabled: true,
      ownerOrigin: 'http://127.0.0.1:9001',
      mediaDevices: {
        setCaptureHandleConfig(config) {
          calls.push(config)
        },
      },
      randomSource: fixedRandom,
      isTopLevel: true,
      isSecureContext: true,
      referrer: 'http://127.0.0.1:9001/operator',
    })

    expect(registration.status).toBe('registered')
    expect(calls).toHaveLength(1)
    expect(calls[0]).toEqual({
      exposeOrigin: true,
      handle: JSON.stringify({
        role: PROJECTION_STAGE_CAPTURE_HANDLE_ROLE,
        version: PROJECTION_STAGE_CAPTURE_HANDLE_VERSION,
        ref: '00112233-4455-4677-8899-aabbccddeeff',
      }),
      permittedOrigins: ['http://127.0.0.1:9001'],
    })
    expect(JSON.stringify({ status: registration.status })).not.toContain(
      '127.0.0.1'
    )
  })

  it('clears the browser registration exactly once without publishing the handle', () => {
    const calls: Array<unknown> = []
    const registration = registerProjectionStageCaptureHandle({
      enabled: true,
      ownerOrigin: 'http://localhost:9001',
      mediaDevices: {
        setCaptureHandleConfig(config) {
          calls.push(config)
        },
      },
      randomSource: fixedRandom,
      isTopLevel: true,
      isSecureContext: true,
      referrer: 'http://localhost:9001/',
    })

    expect(registration.dispose()).toBe('cleared')
    expect(registration.dispose()).toBe('already_cleared')
    expect(calls).toHaveLength(2)
    expect(calls[1]).toBeUndefined()
    expect(Object.keys(registration).sort()).toEqual(['dispose', 'status'])
  })

  it.each([
    ['inactive', { enabled: false }],
    [
      'owner_origin_invalid',
      { enabled: true, ownerOrigin: 'https://example.com' },
    ],
    [
      'not_top_level',
      {
        enabled: true,
        ownerOrigin: 'http://127.0.0.1:9001',
        isTopLevel: false,
        isSecureContext: true,
        referrer: 'http://127.0.0.1:9001/',
      },
    ],
    [
      'not_top_level',
      {
        enabled: true,
        ownerOrigin: 'http://127.0.0.1:9001',
        isSecureContext: true,
        referrer: 'http://127.0.0.1:9001/',
      },
    ],
    [
      'insecure_context',
      {
        enabled: true,
        ownerOrigin: 'http://127.0.0.1:9001',
        isTopLevel: true,
        isSecureContext: false,
        referrer: 'http://127.0.0.1:9001/',
      },
    ],
    [
      'insecure_context',
      {
        enabled: true,
        ownerOrigin: 'http://127.0.0.1:9001',
        isTopLevel: true,
        referrer: 'http://127.0.0.1:9001/',
      },
    ],
    [
      'referrer_mismatch',
      {
        enabled: true,
        ownerOrigin: 'http://127.0.0.1:9001',
        isTopLevel: true,
        isSecureContext: true,
        referrer: 'http://localhost:9001/',
      },
    ],
    [
      'unsupported',
      {
        enabled: true,
        ownerOrigin: 'http://127.0.0.1:9001',
        isTopLevel: true,
        isSecureContext: true,
        referrer: 'http://127.0.0.1:9001/',
        mediaDevices: {},
      },
    ],
  ])('fails closed as %s', (expected, input) => {
    const registration = registerProjectionStageCaptureHandle({
      mediaDevices: {},
      randomSource: fixedRandom,
      ...input,
    })
    expect(registration.status).toBe(expected)
  })

  it('maps registration exceptions to one fixed class', () => {
    const registration = registerProjectionStageCaptureHandle({
      enabled: true,
      ownerOrigin: 'http://127.0.0.1:9001',
      mediaDevices: {
        setCaptureHandleConfig() {
          throw new Error('raw browser detail')
        },
      },
      randomSource: fixedRandom,
      isTopLevel: true,
      isSecureContext: true,
      referrer: 'http://127.0.0.1:9001/',
    })
    expect(registration.status).toBe('registration_failed')
    expect(JSON.stringify(registration)).not.toContain('raw browser detail')
  })

  it('reports a fixed clear failure without falsely claiming inactive', () => {
    let callCount = 0
    const registration = registerProjectionStageCaptureHandle({
      enabled: true,
      ownerOrigin: 'http://127.0.0.1:9001',
      mediaDevices: {
        setCaptureHandleConfig() {
          callCount += 1
          if (callCount > 1) throw new Error('raw cleanup detail')
        },
      },
      randomSource: fixedRandom,
      isTopLevel: true,
      isSecureContext: true,
      referrer: 'http://127.0.0.1:9001/',
    })

    expect(registration.dispose()).toBe('clear_failed')
    expect(registration.dispose()).toBe('clear_failed')
    expect(callCount).toBe(2)
    expect(JSON.stringify(registration)).not.toContain('raw cleanup detail')
  })

  it('wires only stage-output to the page and exposes a fixed status class', () => {
    const pageSource = fs.readFileSync(
      path.resolve(process.cwd(), 'src/pages/projection-visual.tsx'),
      'utf8'
    )
    expect(pageSource).toContain('registerProjectionStageCaptureHandle')
    expect(pageSource).toContain('enabled: isStageOutputMode')
    expect(pageSource).toContain('data-projection-capture-handle-status=')
    expect(pageSource).toContain("cleanup === 'clear_failed'")
    expect(pageSource).toContain('captureHandleClearFailedRef.current = true')
    expect(pageSource).toContain('if (captureHandleClearFailedRef.current)')
    expect(pageSource).not.toContain('data-projection-capture-handle-ref=')
  })
})
