type TrustedUrlOptions = {
  allowPath?: boolean
  allowedUrlsEnv?: string
  allowedRemoteHosts?: string[]
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])

export function isLoopbackHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase()
  return LOOPBACK_HOSTS.has(normalized) || normalized.startsWith('127.')
}

export function normalizeHttpUrl(
  value: string,
  options: { allowPath?: boolean } = {}
): string | null {
  try {
    const url = new URL(value.trim())
    if (!['http:', 'https:'].includes(url.protocol)) return null
    if (url.username || url.password) return null
    if (!options.allowPath && (url.pathname !== '/' || url.search)) return null
    url.hash = ''
    if (!options.allowPath) {
      url.pathname = ''
      url.search = ''
    }
    return url.toString().replace(/\/$/, '')
  } catch {
    return null
  }
}

export function getTrustedRequestUrl(
  value: string | null | undefined,
  options: TrustedUrlOptions = {}
): string | null {
  if (!value?.trim()) return null

  const normalized = normalizeHttpUrl(value, { allowPath: options.allowPath })
  if (!normalized) return null

  const url = new URL(normalized)
  if (isLoopbackHost(url.hostname)) return normalized
  if (
    options.allowedRemoteHosts?.includes(url.hostname) &&
    url.protocol === 'https:'
  ) {
    return normalized
  }
  if (isUrlExplicitlyAllowed(normalized, options.allowedUrlsEnv)) {
    return normalized
  }

  return null
}

export function resolveTrustedServiceUrl({
  requestUrl,
  envUrl,
  fallbackUrl,
  allowedUrlsEnv,
  allowPath = false,
}: {
  requestUrl?: string | null
  envUrl?: string | null
  fallbackUrl: string
  allowedUrlsEnv?: string
  allowPath?: boolean
}): string | null {
  if (envUrl?.trim()) {
    return normalizeHttpUrl(envUrl, { allowPath })
  }

  if (requestUrl?.trim()) {
    return getTrustedRequestUrl(requestUrl, { allowedUrlsEnv, allowPath })
  }

  return normalizeHttpUrl(fallbackUrl, { allowPath })
}

export function isUrlExplicitlyAllowed(
  normalizedUrl: string,
  allowedUrlsEnv: string | undefined
): boolean {
  if (!allowedUrlsEnv) return false

  return allowedUrlsEnv
    .split(/[,\s]+/)
    .map((value) => normalizeHttpUrl(value, { allowPath: true }))
    .filter((value): value is string => Boolean(value))
    .some((allowedUrl) => allowedUrl === normalizedUrl)
}
