import fs from 'node:fs'
import path from 'node:path'
import {
  PROJECTION_STAGE_CAPTURE_HANDLE_ROLE,
  PROJECTION_STAGE_CAPTURE_HANDLE_VERSION,
  PROJECTION_STAGE_CAPTURE_READY_MESSAGE,
  PROJECTION_STAGE_CAPTURE_READY_VERSION,
  createProjectionStageCaptureHandleSession,
  registerProjectionStageCaptureHandle,
  resolveProjectionCaptureOwnerOrigin,
} from '../captureSourceHandle'

const fixedRandom = {
  randomUUID: () => '00112233-4455-4677-8899-aabbccddeeff',
}
const fixedOpener = { postMessage: jest.fn() }

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
    const postMessage = jest.fn()
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
      opener: { postMessage },
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
    expect(postMessage).toHaveBeenCalledWith(
      {
        type: PROJECTION_STAGE_CAPTURE_READY_MESSAGE,
        version: PROJECTION_STAGE_CAPTURE_READY_VERSION,
        ref: '00112233-4455-4677-8899-aabbccddeeff',
      },
      'http://127.0.0.1:9001'
    )
  })

  it('keeps one page-lifetime ref and one announcement across strict-effect re-entry', () => {
    const events: Array<{ kind: string; value?: unknown }> = []
    let randomCallCount = 0
    const session = createProjectionStageCaptureHandleSession()
    const mediaDevices = {
      setCaptureHandleConfig(config?: unknown) {
        events.push({ kind: config ? 'registered' : 'cleared', value: config })
      },
    }
    const opener = {
      postMessage(message: unknown) {
        events.push({ kind: 'announced', value: message })
      },
    }
    const options = {
      enabled: true,
      ownerOrigin: 'http://127.0.0.1:9001',
      mediaDevices,
      randomSource: {
        randomUUID() {
          randomCallCount += 1
          return randomCallCount === 1
            ? '00112233-4455-4677-8899-aabbccddeeff'
            : '10112233-4455-4677-8899-aabbccddeeff'
        },
      },
      isTopLevel: true,
      isSecureContext: true,
      referrer: 'http://127.0.0.1:9001/',
      opener,
      session,
    }

    const first = registerProjectionStageCaptureHandle(options)
    expect(first.status).toBe('registered')
    expect(first.dispose()).toBe('cleared')
    const second = registerProjectionStageCaptureHandle(options)
    expect(second.status).toBe('registered')

    const registered = events.filter((event) => event.kind === 'registered')
    const announced = events.filter((event) => event.kind === 'announced')
    expect(randomCallCount).toBe(1)
    expect(registered).toHaveLength(2)
    expect(registered[0].value).toEqual(registered[1].value)
    expect(announced).toHaveLength(1)
    expect(events.map((event) => event.kind)).toEqual([
      'registered',
      'announced',
      'cleared',
      'registered',
    ])
    expect(second.dispose()).toBe('cleared')
  })

  it('does not reuse one page-lifetime identity for a different owner origin', () => {
    const calls: Array<unknown> = []
    const session = createProjectionStageCaptureHandleSession()
    const common = {
      enabled: true,
      mediaDevices: {
        setCaptureHandleConfig: (config?: unknown) => calls.push(config),
      },
      randomSource: fixedRandom,
      isTopLevel: true,
      isSecureContext: true,
      opener: fixedOpener,
      session,
    }
    const first = registerProjectionStageCaptureHandle({
      ...common,
      ownerOrigin: 'http://127.0.0.1:9001',
      referrer: 'http://127.0.0.1:9001/',
    })
    expect(first.status).toBe('registered')
    expect(first.dispose()).toBe('cleared')

    const changedOwner = registerProjectionStageCaptureHandle({
      ...common,
      ownerOrigin: 'http://127.0.0.1:9002',
      referrer: 'http://127.0.0.1:9002/',
    })
    expect(changedOwner.status).toBe('registration_failed')
    expect(calls).toHaveLength(2)
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
      opener: fixedOpener,
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
        opener: fixedOpener,
      },
    ],
    [
      'not_top_level',
      {
        enabled: true,
        ownerOrigin: 'http://127.0.0.1:9001',
        isSecureContext: true,
        referrer: 'http://127.0.0.1:9001/',
        opener: fixedOpener,
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
        opener: fixedOpener,
      },
    ],
    [
      'insecure_context',
      {
        enabled: true,
        ownerOrigin: 'http://127.0.0.1:9001',
        isTopLevel: true,
        referrer: 'http://127.0.0.1:9001/',
        opener: fixedOpener,
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
        opener: fixedOpener,
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
        opener: fixedOpener,
      },
    ],
  ])('fails closed as %s', (expected, input) => {
    const registration = registerProjectionStageCaptureHandle({
      mediaDevices: {},
      randomSource: fixedRandom,
      opener: fixedOpener,
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
      opener: fixedOpener,
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
      opener: fixedOpener,
    })

    expect(registration.dispose()).toBe('clear_failed')
    expect(registration.dispose()).toBe('clear_failed')
    expect(callCount).toBe(2)
    expect(JSON.stringify(registration)).not.toContain('raw cleanup detail')
  })

  it('requires an owned opener before registering', () => {
    const calls: Array<unknown> = []
    const registration = registerProjectionStageCaptureHandle({
      enabled: true,
      ownerOrigin: 'http://127.0.0.1:9001',
      mediaDevices: { setCaptureHandleConfig: (config) => calls.push(config) },
      randomSource: fixedRandom,
      isTopLevel: true,
      isSecureContext: true,
      referrer: 'http://127.0.0.1:9001/',
      opener: null,
    })
    expect(registration.status).toBe('opener_unavailable')
    expect(calls).toHaveLength(0)
  })

  it('clears a registered handle when the exact-owner announcement fails', () => {
    const calls: Array<unknown> = []
    const registration = registerProjectionStageCaptureHandle({
      enabled: true,
      ownerOrigin: 'http://127.0.0.1:9001',
      mediaDevices: { setCaptureHandleConfig: (config) => calls.push(config) },
      randomSource: fixedRandom,
      isTopLevel: true,
      isSecureContext: true,
      referrer: 'http://127.0.0.1:9001/',
      opener: {
        postMessage() {
          throw new Error('raw announcement failure')
        },
      },
    })
    expect(registration.status).toBe('announcement_failed')
    expect(calls).toHaveLength(2)
    expect(calls[1]).toBeUndefined()
    expect(JSON.stringify(registration)).not.toContain(
      'raw announcement failure'
    )
  })

  it('latches clear failure when announcement rollback cannot revoke the handle', () => {
    let configCallCount = 0
    const registration = registerProjectionStageCaptureHandle({
      enabled: true,
      ownerOrigin: 'http://127.0.0.1:9001',
      mediaDevices: {
        setCaptureHandleConfig() {
          configCallCount += 1
          if (configCallCount > 1) throw new Error('raw rollback failure')
        },
      },
      randomSource: fixedRandom,
      isTopLevel: true,
      isSecureContext: true,
      referrer: 'http://127.0.0.1:9001/',
      opener: {
        postMessage() {
          throw new Error('raw announcement failure')
        },
      },
    })
    expect(registration.status).toBe('clear_failed')
    expect(registration.dispose()).toBe('clear_failed')
    expect(configCallCount).toBe(2)
    expect(JSON.stringify(registration)).not.toMatch(
      /raw rollback|raw announcement/
    )
  })

  it('wires only stage-output to the page and exposes a fixed status class', () => {
    const pageSource = fs.readFileSync(
      path.resolve(process.cwd(), 'src/pages/projection-visual.tsx'),
      'utf8'
    )
    expect(pageSource).toContain('registerProjectionStageCaptureHandle')
    expect(pageSource).toContain('createProjectionStageCaptureHandleSession')
    expect(pageSource).toContain('session: captureHandleSession')
    expect(pageSource).toContain('enabled: isStageOutputMode')
    expect(pageSource).toContain('data-projection-capture-handle-status=')
    expect(pageSource).toContain("cleanup === 'clear_failed'")
    expect(pageSource).toContain('captureHandleClearFailedRef.current = true')
    expect(pageSource).toContain('if (captureHandleClearFailedRef.current)')
    expect(pageSource).toContain('opener:')
    expect(pageSource).not.toContain('data-projection-capture-handle-ref=')
  })
})
