import {
  getTrustedRequestUrl,
  normalizeHttpUrl,
  resolveTrustedServiceUrl,
} from '@/utils/serverUrlSecurity'

describe('serverUrlSecurity', () => {
  it('normalizes basic http URLs', () => {
    expect(normalizeHttpUrl('http://127.0.0.1:50021/')).toBe(
      'http://127.0.0.1:50021'
    )
  })

  it('rejects credentials in URLs', () => {
    expect(normalizeHttpUrl('http://user:pass@127.0.0.1:50021')).toBeNull()
  })

  it('allows loopback request URLs', () => {
    expect(getTrustedRequestUrl('http://localhost:50021')).toBe(
      'http://localhost:50021'
    )
  })

  it('rejects remote request URLs unless allowlisted', () => {
    expect(getTrustedRequestUrl('http://example.com:50021')).toBeNull()
    expect(
      getTrustedRequestUrl('http://example.com:50021', {
        allowedUrlsEnv: 'http://example.com:50021',
      })
    ).toBe('http://example.com:50021')
  })

  it('prefers trusted environment URLs over request URLs', () => {
    expect(
      resolveTrustedServiceUrl({
        requestUrl: 'http://attacker.example:50021',
        envUrl: 'http://voicevox.example:50021',
        fallbackUrl: 'http://localhost:50021',
      })
    ).toBe('http://voicevox.example:50021')
  })
})
