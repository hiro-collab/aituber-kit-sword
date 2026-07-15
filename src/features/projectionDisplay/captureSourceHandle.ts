export const PROJECTION_STAGE_CAPTURE_HANDLE_SCHEMA =
  'sword.projection-stage.capture-source.v1'
export const PROJECTION_STAGE_CAPTURE_HANDLE_ROLE =
  'projection-visual-stage-output'
export const PROJECTION_STAGE_CAPTURE_HANDLE_VERSION = 1
export const PROJECTION_STAGE_CAPTURE_READY_MESSAGE =
  'projection_stage_capture_source_ready'
export const PROJECTION_STAGE_CAPTURE_READY_VERSION = 1

export type ProjectionStageCaptureHandleStatus =
  | 'registered'
  | 'inactive'
  | 'owner_origin_invalid'
  | 'referrer_mismatch'
  | 'not_top_level'
  | 'insecure_context'
  | 'opener_unavailable'
  | 'unsupported'
  | 'registration_failed'
  | 'announcement_failed'
  | 'clear_failed'

export type ProjectionStageCaptureHandleCleanup =
  | 'cleared'
  | 'already_cleared'
  | 'not_registered'
  | 'clear_failed'

type CaptureHandleConfig = {
  exposeOrigin: boolean
  handle: string
  permittedOrigins: string[]
}

type CaptureHandleMediaDevices = {
  setCaptureHandleConfig?: (config?: CaptureHandleConfig) => void
}

type RandomSource = {
  randomUUID: () => string
}

type CaptureSourceOpener = {
  postMessage: (
    message: { type: string; version: number; ref: string },
    targetOrigin: string
  ) => void
}

export type ProjectionStageCaptureHandleSession = object

type ProjectionStageCaptureHandleSessionState = {
  identity?: ReturnType<typeof createOpaqueHandle>
  ownerOrigin?: string
  announced: boolean
}

const captureHandleSessionStates = new WeakMap<
  ProjectionStageCaptureHandleSession,
  ProjectionStageCaptureHandleSessionState
>()

export function createProjectionStageCaptureHandleSession(): ProjectionStageCaptureHandleSession {
  const session = Object.freeze({})
  captureHandleSessionStates.set(session, { announced: false })
  return session
}

export type ProjectionStageCaptureHandleRegistration = {
  status: ProjectionStageCaptureHandleStatus
  dispose: () => ProjectionStageCaptureHandleCleanup
}

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]'])

export function resolveProjectionCaptureOwnerOrigin(
  value: string | undefined
): string | undefined {
  const trimmed = value?.trim()
  if (!trimmed || trimmed.length > 200) return undefined

  try {
    const parsed = new URL(trimmed)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return undefined
    }
    if (!LOOPBACK_HOSTS.has(parsed.hostname)) return undefined
    if (parsed.username || parsed.password) return undefined
    if (parsed.pathname !== '/' || parsed.search || parsed.hash)
      return undefined
    return parsed.origin
  } catch {
    return undefined
  }
}

function resolveReferrerOrigin(value: string | undefined): string | undefined {
  if (!value) return undefined
  try {
    return new URL(value).origin
  } catch {
    return undefined
  }
}

function createOpaqueHandle(randomSource: RandomSource): {
  handle: string
  ref: string
} {
  const ref = randomSource.randomUUID().toLowerCase()
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      ref
    )
  ) {
    throw new Error('invalid_random_uuid')
  }
  return {
    handle: JSON.stringify({
      role: PROJECTION_STAGE_CAPTURE_HANDLE_ROLE,
      version: PROJECTION_STAGE_CAPTURE_HANDLE_VERSION,
      ref,
    }),
    ref,
  }
}

export function registerProjectionStageCaptureHandle(options: {
  enabled: boolean
  ownerOrigin?: string
  mediaDevices?: CaptureHandleMediaDevices
  randomSource?: RandomSource
  isTopLevel?: boolean
  isSecureContext?: boolean
  referrer?: string
  opener?: CaptureSourceOpener | null
  session?: ProjectionStageCaptureHandleSession
}): ProjectionStageCaptureHandleRegistration {
  const noOp = () => 'not_registered' as const
  if (!options.enabled) return { status: 'inactive', dispose: noOp }

  const ownerOrigin = resolveProjectionCaptureOwnerOrigin(options.ownerOrigin)
  if (!ownerOrigin) {
    return { status: 'owner_origin_invalid', dispose: noOp }
  }
  if (options.isTopLevel !== true) {
    return { status: 'not_top_level', dispose: noOp }
  }
  if (options.isSecureContext !== true) {
    return { status: 'insecure_context', dispose: noOp }
  }
  if (resolveReferrerOrigin(options.referrer) !== ownerOrigin) {
    return { status: 'referrer_mismatch', dispose: noOp }
  }
  if (!options.opener || typeof options.opener.postMessage !== 'function') {
    return { status: 'opener_unavailable', dispose: noOp }
  }

  const mediaDevices =
    options.mediaDevices ??
    (typeof navigator === 'object'
      ? (navigator.mediaDevices as CaptureHandleMediaDevices)
      : undefined)
  const setCaptureHandleConfig = mediaDevices?.setCaptureHandleConfig
  if (typeof setCaptureHandleConfig !== 'function') {
    return { status: 'unsupported', dispose: noOp }
  }

  const randomSource =
    options.randomSource ??
    (typeof crypto === 'object' ? (crypto as RandomSource) : undefined)
  if (!randomSource) {
    return { status: 'registration_failed', dispose: noOp }
  }

  const session = options.session ?? createProjectionStageCaptureHandleSession()
  const sessionState = captureHandleSessionStates.get(session)
  if (!sessionState) {
    return { status: 'registration_failed', dispose: noOp }
  }
  if (
    sessionState.ownerOrigin !== undefined &&
    sessionState.ownerOrigin !== ownerOrigin
  ) {
    return { status: 'registration_failed', dispose: noOp }
  }
  sessionState.ownerOrigin = ownerOrigin

  let identity: ReturnType<typeof createOpaqueHandle>
  try {
    identity = sessionState.identity ?? createOpaqueHandle(randomSource)
    sessionState.identity = identity
    setCaptureHandleConfig.call(mediaDevices, {
      exposeOrigin: true,
      handle: identity.handle,
      permittedOrigins: [ownerOrigin],
    })
  } catch {
    return { status: 'registration_failed', dispose: noOp }
  }

  if (!sessionState.announced) {
    try {
      options.opener.postMessage(
        {
          type: PROJECTION_STAGE_CAPTURE_READY_MESSAGE,
          version: PROJECTION_STAGE_CAPTURE_READY_VERSION,
          ref: identity.ref,
        },
        ownerOrigin
      )
      sessionState.announced = true
    } catch {
      try {
        setCaptureHandleConfig.call(mediaDevices)
        return { status: 'announcement_failed', dispose: noOp }
      } catch {
        return { status: 'clear_failed', dispose: () => 'clear_failed' }
      }
    }
  }

  let cleanupOutcome: 'cleared' | 'clear_failed' | undefined
  return {
    status: 'registered',
    dispose: () => {
      if (cleanupOutcome === 'cleared') return 'already_cleared'
      if (cleanupOutcome === 'clear_failed') return 'clear_failed'
      try {
        setCaptureHandleConfig.call(mediaDevices)
        cleanupOutcome = 'cleared'
        return 'cleared'
      } catch {
        cleanupOutcome = 'clear_failed'
        return 'clear_failed'
      }
    },
  }
}
