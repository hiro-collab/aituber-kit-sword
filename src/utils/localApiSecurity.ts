import { timingSafeEqual } from 'crypto'
import type { NextApiRequest, NextApiResponse } from 'next'
import { isLoopbackHost } from './serverUrlSecurity'

type HeaderValue = string | string[] | undefined

type LocalApiGuardOptions = {
  feature: string
}

const envFlag = (name: string) => process.env[name] === 'true'

function firstHeader(value: HeaderValue): string {
  return Array.isArray(value) ? value[0] || '' : value || ''
}

function remoteLocalApiAllowed(): boolean {
  return envFlag('ALLOW_REMOTE_LOCAL_APIS')
}

function trustProxyHeaders(): boolean {
  return envFlag('LOCAL_API_TRUST_PROXY_HEADERS')
}

function localApiTokenRequired(): boolean {
  return envFlag('LOCAL_API_REQUIRE_TOKEN')
}

function remoteApiToken(): string {
  return (
    process.env.LOCAL_API_REMOTE_TOKEN ||
    process.env.AITUBER_LOCAL_API_TOKEN ||
    ''
  ).trim()
}

function normalizeIpAddress(value: string): string {
  const trimmed = value.trim().toLowerCase()
  if (trimmed.startsWith('::ffff:')) {
    return trimmed.slice('::ffff:'.length)
  }
  return trimmed
}

function getClientAddress(req: NextApiRequest): string {
  const forwardedFor = trustProxyHeaders()
    ? firstHeader(req.headers?.['x-forwarded-for'])
    : ''
  if (forwardedFor) {
    const forwardedAddress = normalizeIpAddress(forwardedFor.split(',')[0] || '')
    if (forwardedAddress) return forwardedAddress
  }
  return normalizeIpAddress(req.socket?.remoteAddress || '')
}

function extractRequestToken(req: NextApiRequest): string {
  const direct = firstHeader(req.headers?.['x-api-token']).trim()
  if (direct) return direct

  const authorization = firstHeader(req.headers?.authorization).trim()
  const [scheme, ...rest] = authorization.split(/\s+/)
  if (scheme?.toLowerCase() !== 'bearer') return ''
  return rest.join(' ').trim()
}

function tokenMatches(actual: string, expected: string): boolean {
  if (!actual || !expected) return false
  const actualBuffer = Buffer.from(actual)
  const expectedBuffer = Buffer.from(expected)
  return (
    actualBuffer.length === expectedBuffer.length &&
    timingSafeEqual(actualBuffer, expectedBuffer)
  )
}

export function isLoopbackAddress(value: string): boolean {
  const address = normalizeIpAddress(value)
  return (
    address === '' ||
    address === '::1' ||
    address === 'localhost' ||
    address === '127.0.0.1' ||
    address.startsWith('127.')
  )
}

function parseHostHeader(hostHeader: string): URL | null {
  if (!hostHeader) return null
  try {
    return new URL(`http://${hostHeader}`)
  } catch {
    return null
  }
}

export function isTrustedRequestOrigin(req: NextApiRequest): boolean {
  const originHeader = firstHeader(req.headers?.origin)
  if (!originHeader) return true
  if (originHeader === 'null') return false

  try {
    const origin = new URL(originHeader)
    if (!['http:', 'https:'].includes(origin.protocol)) return false

    const host = parseHostHeader(firstHeader(req.headers?.host))
    if (!host) {
      return isLoopbackHost(origin.hostname)
    }

    if (origin.host === host.host) return true
    return (
      isLoopbackHost(origin.hostname) &&
      isLoopbackHost(host.hostname) &&
      origin.port === host.port
    )
  } catch {
    return false
  }
}

export function enforceLocalApiRequest(
  req: NextApiRequest,
  res: NextApiResponse,
  { feature }: LocalApiGuardOptions
): boolean {
  const localRequest = isLoopbackAddress(getClientAddress(req))
  if (!remoteLocalApiAllowed() && !localRequest) {
    res.status(403).json({
      error: 'Forbidden',
      errorCode: 'LocalAccessRequired',
      message: `${feature} accepts local requests only.`,
    })
    return false
  }

  const tokenRequired =
    localApiTokenRequired() || (!localRequest && remoteLocalApiAllowed())
  if (tokenRequired) {
    const expectedToken = remoteApiToken()
    if (!expectedToken) {
      res.status(403).json({
        error: 'Forbidden',
        errorCode: 'RemoteTokenRequired',
        message: `${feature} requires LOCAL_API_REMOTE_TOKEN or AITUBER_LOCAL_API_TOKEN before remote access is allowed.`,
      })
      return false
    }
    if (!tokenMatches(extractRequestToken(req), expectedToken)) {
      res.status(401).json({
        error: 'Unauthorized',
        errorCode: 'InvalidApiToken',
        message: `${feature} rejected an invalid API token.`,
      })
      return false
    }
  }

  if (!isTrustedRequestOrigin(req)) {
    res.status(403).json({
      error: 'Forbidden',
      errorCode: 'UntrustedOrigin',
      message: `${feature} rejected an untrusted browser origin.`,
    })
    return false
  }

  return true
}
