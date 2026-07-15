import type { NextApiRequest, NextApiResponse } from 'next'

import { enforceLocalApiRequest } from '@/utils/localApiSecurity'
import {
  SYSTEM_SPEECH_LIFECYCLE_TRANSPORT_SCHEMA_VERSION,
  sanitizeSystemSpeechLifecycleSummary,
  type SystemSpeechLifecycleSummary,
  type SystemSpeechLifecycleTransportEnvelope,
} from '@/utils/speechOutputParitySummary'

type StoredLifecycleTransport = SystemSpeechLifecycleTransportEnvelope & {
  transition_ordinal: number
}

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '8kb',
    },
  },
}

const TRANSPORT_KEYS = [
  'schema_version',
  'lifecycle',
  'client_timestamp_wall',
  'client_timestamp_monotonic',
  'client_performance_now',
  'raw_private_publication_flags',
].sort()

const TRANSITIONS: Record<
  SystemSpeechLifecycleSummary['lifecycle_state'],
  ReadonlySet<SystemSpeechLifecycleSummary['lifecycle_state']>
> = {
  handoff_accepted: new Set(['handoff_accepted', 'cooldown']),
  cooldown: new Set(['cooldown', 'released']),
  released: new Set(['released']),
}

let latestLifecycle: StoredLifecycleTransport | null = null
const lifecycleHistory: StoredLifecycleTransport[] = []
const LIFECYCLE_HISTORY_LIMIT = 16

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const exactKeys = (value: Record<string, unknown>, keys: string[]): boolean =>
  Object.keys(value).sort().join('\n') === keys.join('\n')

const hasExplicitOrigin = (req: NextApiRequest): boolean => {
  const value = req.headers.origin
  return typeof value === 'string' && value.length > 0
}

const readAfterOrdinal = (
  query: NextApiRequest['query']
): { valid: true; value: number | null } | { valid: false } => {
  const keys = Object.keys(query)
  if (keys.length === 0) return { valid: true, value: null }
  if (keys.length !== 1 || keys[0] !== 'after_ordinal') {
    return { valid: false }
  }

  const value = query.after_ordinal
  if (
    typeof value !== 'string' ||
    !/^(?:0|[1-9]\d*)$/.test(value) ||
    value.length > 16
  ) {
    return { valid: false }
  }
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed >= 0
    ? { valid: true, value: parsed }
    : { valid: false }
}

const readTiming = (
  value: Record<string, unknown>
): Pick<
  SystemSpeechLifecycleTransportEnvelope,
  | 'client_timestamp_wall'
  | 'client_timestamp_monotonic'
  | 'client_performance_now'
> | null => {
  const wall = value.client_timestamp_wall
  const monotonic = value.client_timestamp_monotonic
  const performanceNow = value.client_performance_now
  const parsedWall = typeof wall === 'string' ? Date.parse(wall) : NaN
  if (
    typeof wall !== 'string' ||
    wall.length > 27 ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/.test(wall) ||
    !Number.isFinite(parsedWall) ||
    typeof monotonic !== 'number' ||
    !Number.isFinite(monotonic) ||
    monotonic < 0 ||
    monotonic > 1_000_000_000_000 ||
    typeof performanceNow !== 'number' ||
    !Number.isFinite(performanceNow) ||
    performanceNow < 0 ||
    performanceNow > 1_000_000_000_000
  ) {
    return null
  }
  return {
    client_timestamp_wall: wall,
    client_timestamp_monotonic: monotonic,
    client_performance_now: performanceNow,
  }
}

const sameOpaqueLease = (
  left: SystemSpeechLifecycleSummary,
  right: SystemSpeechLifecycleSummary
): boolean =>
  left.system_speech_session_id === right.system_speech_session_id &&
  left.playback_event_ref === right.playback_event_ref

const sameLease = (
  left: SystemSpeechLifecycleSummary,
  right: SystemSpeechLifecycleSummary
): boolean =>
  sameOpaqueLease(left, right) &&
  left.speech_session_generation === right.speech_session_generation

const hasRetainedOpaqueComponent = (
  next: SystemSpeechLifecycleSummary
): boolean =>
  lifecycleHistory.some(
    (stored) =>
      stored.lifecycle.system_speech_session_id ===
        next.system_speech_session_id ||
      stored.lifecycle.playback_event_ref === next.playback_event_ref
  )

const isFreshDifferentLease = (
  previous: StoredLifecycleTransport,
  next: SystemSpeechLifecycleSummary,
  nextClientTimestampWall: string
): boolean =>
  next.lifecycle_state === 'handoff_accepted' &&
  Date.parse(nextClientTimestampWall) >
    Date.parse(previous.client_timestamp_wall) &&
  !hasRetainedOpaqueComponent(next)

const classifyTransition = (
  previous: StoredLifecycleTransport | null,
  next: SystemSpeechLifecycleSummary,
  nextClientTimestampWall: string
): 'accepted' | 'duplicate' | 'rejected' => {
  if (!previous) {
    return next.lifecycle_state === 'handoff_accepted' ? 'accepted' : 'rejected'
  }
  const current = previous.lifecycle
  const currentLeaseMatches = sameLease(current, next)
  if (!currentLeaseMatches) {
    if (hasRetainedOpaqueComponent(next)) {
      return 'rejected'
    }
    if (!isFreshDifferentLease(previous, next, nextClientTimestampWall)) {
      return 'rejected'
    }
    return next.speech_session_generation > current.speech_session_generation ||
      current.lifecycle_state === 'released'
      ? 'accepted'
      : 'rejected'
  }
  if (!TRANSITIONS[current.lifecycle_state].has(next.lifecycle_state)) {
    return 'rejected'
  }
  return next.lifecycle_state === current.lifecycle_state
    ? 'duplicate'
    : 'accepted'
}

const handler = (req: NextApiRequest, res: NextApiResponse) => {
  if (
    !enforceLocalApiRequest(req, res, {
      feature: 'selfOutputAwarenessTransport',
    })
  ) {
    return
  }

  if (req.method === 'GET') {
    const cursor = readAfterOrdinal(req.query)
    if (!cursor.valid) {
      return res.status(400).json({
        ok: false,
        result_class: 'lifecycle_transport_cursor_invalid',
        raw_private_publication_flags: false,
      })
    }
    const afterOrdinal = cursor.value
    const transport =
      afterOrdinal === null
        ? latestLifecycle
        : (lifecycleHistory.find(
            (candidate) => candidate.transition_ordinal > afterOrdinal
          ) ?? null)
    return res.status(200).json({
      ok: true,
      result_class: transport
        ? 'lifecycle_transport_current'
        : 'lifecycle_transport_empty',
      transport,
      raw_private_publication_flags: false,
    })
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST')
    return res.status(405).json({
      ok: false,
      result_class: 'method_not_allowed',
      raw_private_publication_flags: false,
    })
  }

  if (!hasExplicitOrigin(req)) {
    return res.status(403).json({
      ok: false,
      result_class: 'explicit_same_origin_required',
      raw_private_publication_flags: false,
    })
  }

  if (
    !isRecord(req.body) ||
    !exactKeys(req.body, TRANSPORT_KEYS) ||
    req.body.schema_version !==
      SYSTEM_SPEECH_LIFECYCLE_TRANSPORT_SCHEMA_VERSION ||
    req.body.raw_private_publication_flags !== false ||
    !isRecord(req.body.lifecycle)
  ) {
    return res.status(400).json({
      ok: false,
      result_class: 'lifecycle_transport_invalid',
      raw_private_publication_flags: false,
    })
  }

  const lifecycle = sanitizeSystemSpeechLifecycleSummary(req.body.lifecycle)
  const timing = readTiming(req.body)
  if (
    !lifecycle ||
    !timing ||
    Object.keys(req.body.lifecycle).sort().join('\n') !==
      Object.keys(lifecycle).sort().join('\n')
  ) {
    return res.status(400).json({
      ok: false,
      result_class: 'lifecycle_transport_invalid',
      raw_private_publication_flags: false,
    })
  }

  const transition = classifyTransition(
    latestLifecycle,
    lifecycle,
    timing.client_timestamp_wall
  )
  if (transition === 'rejected') {
    return res.status(409).json({
      ok: false,
      result_class: 'lifecycle_transition_rejected',
      raw_private_publication_flags: false,
    })
  }
  if (transition === 'duplicate') {
    return res.status(200).json({
      ok: true,
      result_class: 'lifecycle_transport_duplicate',
      transition_ordinal: latestLifecycle?.transition_ordinal ?? 0,
      raw_private_publication_flags: false,
    })
  }

  const storedLifecycle: StoredLifecycleTransport = {
    schema_version: SYSTEM_SPEECH_LIFECYCLE_TRANSPORT_SCHEMA_VERSION,
    lifecycle,
    ...timing,
    raw_private_publication_flags: false,
    transition_ordinal: (latestLifecycle?.transition_ordinal ?? 0) + 1,
  }
  latestLifecycle = storedLifecycle
  lifecycleHistory.push(storedLifecycle)
  if (lifecycleHistory.length > LIFECYCLE_HISTORY_LIMIT) {
    lifecycleHistory.splice(
      0,
      lifecycleHistory.length - LIFECYCLE_HISTORY_LIMIT
    )
  }
  return res.status(202).json({
    ok: true,
    result_class: 'lifecycle_transport_accepted',
    transition_ordinal: latestLifecycle.transition_ordinal,
    raw_private_publication_flags: false,
  })
}

export default handler
