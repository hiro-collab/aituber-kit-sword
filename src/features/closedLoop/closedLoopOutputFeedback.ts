export type ClosedLoopOutputChannel = 'display' | 'tts'

export type ClosedLoopOutputCorrelation = {
  sessionId: string
  turnId: string
  assistantMessageId: string
}

export type ClosedLoopOutputBarrier = ClosedLoopOutputCorrelation & {
  channel: ClosedLoopOutputChannel
  component: 'aituber_message_store' | 'aituber_tts_synthesis'
  sendEventId: string
}

export type ClosedLoopOutputOnceState = {
  correlation?: ClosedLoopOutputCorrelation
  channel?: ClosedLoopOutputChannel
  barrierPromise?: Promise<ClosedLoopOutputBarrier | null>
  terminalKind?: 'acknowledged' | 'rejected'
  terminalPromise?: Promise<void>
  outcome?: 'acknowledged' | 'rejected' | 'failed'
}

type EventKind = 'output.dispatch_intent' | 'output.feedback'
type ProfileName =
  | 'dispatch_intent_recorded'
  | 'send_attempt_started_outcome_unknown'
  | 'submission_ack_needs_feedback'
  | 'dispatch_rejected_before_send'

const SAFE_TOKEN = /^[A-Za-z0-9_.:+-]{1,180}$/
const OUTPUT_COMPONENTS = {
  display: 'aituber_message_store',
  tts: 'aituber_tts_synthesis',
} as const

const fail = (): never => {
  throw new Error('closed_loop_output_feedback_failed')
}

const safeToken = (value: unknown): string | null =>
  typeof value === 'string' && SAFE_TOKEN.test(value) ? value : null

export const closedLoopOutputFeedbackEnabled = (): boolean =>
  process.env.NEXT_PUBLIC_THOUGHT_CORE_CLOSED_LOOP_FEEDBACK_V1_ENABLED === '1'

const postEvent = async (
  eventKind: EventKind,
  correlation: ClosedLoopOutputCorrelation,
  channel: ClosedLoopOutputChannel,
  profileName: ProfileName,
  causalParentEventId?: string
): Promise<string> => {
  const sessionId = safeToken(correlation.sessionId)
  const turnId = safeToken(correlation.turnId)
  const assistantMessageId = safeToken(correlation.assistantMessageId)
  const causalParent = causalParentEventId
    ? safeToken(causalParentEventId)
    : null
  if (
    !sessionId ||
    !turnId ||
    !assistantMessageId ||
    (causalParentEventId && !causalParent)
  ) {
    return fail()
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 5_000)
  try {
    const response = await fetch('/api/closed-loop-feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        event_kind: eventKind,
        session_id: sessionId,
        turn_id: turnId,
        assistant_message_id: assistantMessageId,
        ...(causalParent ? { causal_parent_event_id: causalParent } : {}),
        details: {
          profile_name: profileName,
          output_channel: channel,
          component: OUTPUT_COMPONENTS[channel],
        },
      }),
    })
    if (!response.ok) return fail()
    const value = (await response.json().catch(() => null)) as {
      ok?: unknown
      event_id?: unknown
    } | null
    const eventId = safeToken(value?.event_id)
    if (value?.ok !== true || !eventId) return fail()
    return eventId
  } catch {
    return fail()
  } finally {
    clearTimeout(timeout)
  }
}

export const beginClosedLoopOutput = async (
  correlation: ClosedLoopOutputCorrelation,
  channel: ClosedLoopOutputChannel
): Promise<ClosedLoopOutputBarrier | null> => {
  if (!closedLoopOutputFeedbackEnabled()) return null
  const component = OUTPUT_COMPONENTS[channel]
  const intentEventId = await postEvent(
    'output.dispatch_intent',
    correlation,
    channel,
    'dispatch_intent_recorded'
  )
  const sendEventId = await postEvent(
    'output.feedback',
    correlation,
    channel,
    'send_attempt_started_outcome_unknown',
    intentEventId
  )
  return { ...correlation, channel, component, sendEventId }
}

export const acknowledgeClosedLoopOutput = async (
  barrier: ClosedLoopOutputBarrier | null
): Promise<void> => {
  if (!barrier) return
  await postEvent(
    'output.feedback',
    barrier,
    barrier.channel,
    'submission_ack_needs_feedback',
    barrier.sendEventId
  )
}

export const rejectClosedLoopOutput = async (
  barrier: ClosedLoopOutputBarrier | null
): Promise<void> => {
  if (!barrier) return
  await postEvent(
    'output.feedback',
    barrier,
    barrier.channel,
    'dispatch_rejected_before_send',
    barrier.sendEventId
  )
}

export const createClosedLoopOutputOnceState =
  (): ClosedLoopOutputOnceState => ({})

const sameCorrelation = (
  left: ClosedLoopOutputCorrelation,
  right: ClosedLoopOutputCorrelation
): boolean =>
  left.sessionId === right.sessionId &&
  left.turnId === right.turnId &&
  left.assistantMessageId === right.assistantMessageId

export const beginClosedLoopOutputOnce = async (
  state: ClosedLoopOutputOnceState,
  correlation: ClosedLoopOutputCorrelation,
  channel: ClosedLoopOutputChannel
): Promise<ClosedLoopOutputBarrier | null> => {
  if (!closedLoopOutputFeedbackEnabled()) return null
  if (
    (state.correlation && !sameCorrelation(state.correlation, correlation)) ||
    (state.channel && state.channel !== channel) ||
    state.outcome === 'rejected' ||
    state.outcome === 'failed'
  ) {
    return fail()
  }
  if (!state.barrierPromise) {
    state.correlation = { ...correlation }
    state.channel = channel
    state.barrierPromise = beginClosedLoopOutput(correlation, channel).catch(
      (error) => {
        state.outcome = 'failed'
        throw error
      }
    )
  }
  return state.barrierPromise
}

export const acknowledgeClosedLoopOutputOnce = async (
  state: ClosedLoopOutputOnceState,
  barrier: ClosedLoopOutputBarrier | null
): Promise<void> => {
  if (!barrier) return
  if (state.terminalKind) {
    if (state.terminalKind !== 'acknowledged' || !state.terminalPromise) {
      return fail()
    }
    return state.terminalPromise
  }
  if (state.outcome === 'rejected' || state.outcome === 'failed') return fail()
  state.terminalKind = 'acknowledged'
  state.terminalPromise = acknowledgeClosedLoopOutput(barrier)
    .then(() => {
      state.outcome = 'acknowledged'
    })
    .catch((error) => {
      state.outcome = 'failed'
      throw error
    })
  return state.terminalPromise
}

export const rejectClosedLoopOutputOnce = async (
  state: ClosedLoopOutputOnceState,
  barrier: ClosedLoopOutputBarrier | null
): Promise<void> => {
  if (!barrier) return
  if (state.terminalKind) {
    if (state.terminalKind !== 'rejected' || !state.terminalPromise) {
      return fail()
    }
    return state.terminalPromise
  }
  if (state.outcome === 'acknowledged' || state.outcome === 'failed') return fail()
  state.terminalKind = 'rejected'
  state.terminalPromise = rejectClosedLoopOutput(barrier)
    .then(() => {
      state.outcome = 'rejected'
    })
    .catch((error) => {
      state.outcome = 'failed'
      throw error
    })
  return state.terminalPromise
}
