import type { NextApiRequest, NextApiResponse } from 'next'

import { enforceLocalApiRequest } from '@/utils/localApiSecurity'

export const config = {
  api: { bodyParser: { sizeLimit: '8kb' } },
}

const SAFE_TOKEN = /^[A-Za-z0-9_.:+-]{1,180}$/
const PROFILE_FIELDS = {
  dispatch_intent_recorded: {
    phase: 'dispatching',
    outcome_class: 'none',
    submission_class: 'not_submitted',
    receipt_class: 'none',
    cleanup_class: 'not_required',
    proof_layer: 'intent',
    verification_class: 'intent_recorded',
  },
  send_attempt_started_outcome_unknown: {
    phase: 'dispatching',
    outcome_class: 'outcome_unknown',
    submission_class: 'may_have_submitted',
    receipt_class: 'none',
    cleanup_class: 'unproved',
    proof_layer: 'transport_submission',
    verification_class: 'unverified',
  },
  submission_ack_needs_feedback: {
    phase: 'observing',
    outcome_class: 'needs_feedback',
    submission_class: 'submitted',
    receipt_class: 'submission_ack',
    cleanup_class: 'not_required',
    proof_layer: 'transport_submission',
    verification_class: 'submission_ack',
  },
  dispatch_rejected_before_send: {
    phase: 'terminal',
    outcome_class: 'failed',
    submission_class: 'not_submitted',
    receipt_class: 'none',
    cleanup_class: 'not_required',
    proof_layer: 'transport_submission',
    verification_class: 'correlated_failure',
  },
} as const

const COMPONENTS = {
  display: 'aituber_message_store',
  tts: 'aituber_tts_synthesis',
} as const

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const exactKeys = (value: Record<string, unknown>, expected: string[]) =>
  Object.keys(value).sort().join('\n') === expected.slice().sort().join('\n')
const safeToken = (value: unknown): value is string =>
  typeof value === 'string' && SAFE_TOKEN.test(value)

const isStrictNumericLoopbackIpv4 = (hostname: string): boolean => {
  const octets = hostname.split('.')
  return (
    octets.length === 4 &&
    octets.every((octet) => /^\d{1,3}$/.test(octet)) &&
    octets.every((octet) => Number(octet) >= 0 && Number(octet) <= 255) &&
    Number(octets[0]) === 127
  )
}

const isStrictLoopbackTarget = (raw: string, value: URL): boolean => {
  const authority = raw.match(
    /^http:\/\/(\[[^\]]+\]|[^\/:?#]+)(?::\d+)?(?:\/|$)/
  )
  const rawHostname = authority?.[1]
  if (!rawHostname) return false
  if (rawHostname === 'localhost') return value.hostname === 'localhost'
  if (rawHostname === '[::1]' || rawHostname === '::1') {
    return value.hostname === '[::1]' || value.hostname === '::1'
  }
  return (
    isStrictNumericLoopbackIpv4(rawHostname) &&
    isStrictNumericLoopbackIpv4(value.hostname)
  )
}

const upstreamUrl = (): string | null => {
  const raw = process.env.THOUGHT_CORE_CLOSED_LOOP_FEEDBACK_URL
  if (!raw) return null
  try {
    const value = new URL(raw)
    if (
      value.protocol !== 'http:' ||
      !isStrictLoopbackTarget(raw, value) ||
      value.username ||
      value.password ||
      value.pathname !== '/feedback/closed-loop' ||
      value.search ||
      value.hash
    ) {
      return null
    }
    return value.toString()
  } catch {
    return null
  }
}

const readCandidate = (body: unknown): Record<string, unknown> | null => {
  if (!isRecord(body) || !isRecord(body.details)) return null
  const eventKind = body.event_kind
  const hasParent = eventKind === 'output.feedback'
  if (
    (eventKind !== 'output.dispatch_intent' &&
      eventKind !== 'output.feedback') ||
    !exactKeys(body, [
      'event_kind',
      'session_id',
      'turn_id',
      'assistant_message_id',
      ...(hasParent ? ['causal_parent_event_id'] : []),
      'details',
    ]) ||
    !exactKeys(body.details, ['profile_name', 'output_channel', 'component']) ||
    !safeToken(body.session_id) ||
    !safeToken(body.turn_id) ||
    !safeToken(body.assistant_message_id) ||
    (hasParent && !safeToken(body.causal_parent_event_id))
  ) {
    return null
  }
  const channel = body.details.output_channel
  const profileName = body.details.profile_name
  if (
    (channel !== 'display' && channel !== 'tts') ||
    body.details.component !== COMPONENTS[channel] ||
    typeof profileName !== 'string' ||
    !(profileName in PROFILE_FIELDS) ||
    (eventKind === 'output.dispatch_intent' &&
      profileName !== 'dispatch_intent_recorded') ||
    (eventKind === 'output.feedback' &&
      profileName === 'dispatch_intent_recorded')
  ) {
    return null
  }
  return {
    event_kind: eventKind,
    session_id: body.session_id,
    turn_id: body.turn_id,
    assistant_message_id: body.assistant_message_id,
    ...(hasParent
      ? { causal_parent_event_id: body.causal_parent_event_id }
      : {}),
    details: {
      ...PROFILE_FIELDS[profileName as keyof typeof PROFILE_FIELDS],
      output_channel: channel,
      component: COMPONENTS[channel],
    },
  }
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (!enforceLocalApiRequest(req, res, { feature: 'closedLoopFeedback' })) {
    return
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res
      .status(405)
      .json({ ok: false, result_class: 'method_not_allowed' })
  }
  if (process.env.THOUGHT_CORE_CLOSED_LOOP_FEEDBACK_V1_ENABLED !== '1') {
    return res.status(409).json({
      ok: false,
      result_class: 'closed_loop_feedback_disabled',
    })
  }
  const target = upstreamUrl()
  const candidate = readCandidate(req.body)
  if (!target || !candidate) {
    return res.status(400).json({
      ok: false,
      result_class: 'closed_loop_feedback_request_invalid',
    })
  }
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 5_000)
  try {
    const upstream = await fetch(target, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(candidate),
      signal: controller.signal,
    })
    const value = (await upstream.json().catch(() => null)) as {
      event_id?: unknown
    } | null
    const eventId = value?.event_id
    if (!upstream.ok || !safeToken(eventId)) {
      return res.status(502).json({
        ok: false,
        result_class: 'closed_loop_feedback_upstream_failed',
      })
    }
    return res.status(200).json({ ok: true, event_id: eventId })
  } catch {
    return res.status(503).json({
      ok: false,
      result_class: 'closed_loop_feedback_upstream_unavailable',
    })
  } finally {
    clearTimeout(timeout)
  }
}
