import { classifyReviewProofMessage } from '@/utils/reviewProofMessage'

export const SPEECH_OUTPUT_PARITY_SCHEMA_VERSION =
  'projection_visual_speech_output_parity.v0'

export const SYSTEM_SPEECH_LIFECYCLE_SCHEMA_VERSION =
  'ait_system_speech_lifecycle.v0'
export const SYSTEM_SPEECH_SESSION_ID_PATTERN =
  /^system-speech-session:sss_[a-f0-9]{32}$/
export const PLAYBACK_EVENT_REF_PATTERN = /^playback-event:pe_[a-f0-9]{32}$/
export const SYSTEM_SPEECH_COOLDOWN_MS = 500

export type SystemSpeechLifecycleLease = {
  system_speech_session_id: string
  speech_session_generation: number
  playback_event_ref: string
}

export type SystemSpeechLifecycleState =
  | 'handoff_accepted'
  | 'cooldown'
  | 'released'

export type SystemSpeechLifecycleSummary = SystemSpeechLifecycleLease & {
  schema_version: typeof SYSTEM_SPEECH_LIFECYCLE_SCHEMA_VERSION
  lifecycle_state: SystemSpeechLifecycleState
  queue_handoff_status: 'accepted'
  queue_completion_status: 'pending' | 'callback_observed'
  playback_observation_status: 'not_observed'
  suppression_status: 'active' | 'released'
  cooldown_status: 'clear' | 'active' | 'elapsed'
  cooldown_ms: number
  compare_and_release_required: true
  may_start_user_turn: false
  turn_adoption_authority: false
  raw_text_published: false
  text_hash_published: false
  provider_payload_published: false
  path_published: false
  url_published: false
  raw_audio_published: false
  device_identity_published: false
  private_data_published: false
}

type SystemSpeechLifecycleControllerOptions = {
  publish?: (summary: SystemSpeechLifecycleSummary) => void
  createOpaqueHex?: () => string
  cooldownMs?: number
  setTimer?: (
    callback: () => void,
    delayMs: number
  ) => ReturnType<typeof setTimeout>
  clearTimer?: (timer: ReturnType<typeof setTimeout>) => void
}

type ActiveSystemSpeechLifecycle = {
  lease: SystemSpeechLifecycleLease
  state: 'handoff_accepted' | 'cooldown'
  timer: ReturnType<typeof setTimeout> | null
}

const createOpaqueHex = (): string => {
  if (!globalThis.crypto?.getRandomValues) {
    throw new Error('secure_random_unavailable')
  }
  const bytes = new Uint8Array(16)
  globalThis.crypto.getRandomValues(bytes)
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join(
    ''
  )
}

const sameSystemSpeechLease = (
  left: SystemSpeechLifecycleLease,
  right: SystemSpeechLifecycleLease
): boolean =>
  left.system_speech_session_id === right.system_speech_session_id &&
  left.speech_session_generation === right.speech_session_generation &&
  left.playback_event_ref === right.playback_event_ref

const buildSystemSpeechLifecycleSummary = (
  lease: SystemSpeechLifecycleLease,
  lifecycleState: SystemSpeechLifecycleState,
  cooldownMs: number
): SystemSpeechLifecycleSummary => ({
  schema_version: SYSTEM_SPEECH_LIFECYCLE_SCHEMA_VERSION,
  system_speech_session_id: lease.system_speech_session_id,
  speech_session_generation: lease.speech_session_generation,
  playback_event_ref: lease.playback_event_ref,
  lifecycle_state: lifecycleState,
  queue_handoff_status: 'accepted',
  queue_completion_status:
    lifecycleState === 'handoff_accepted' ? 'pending' : 'callback_observed',
  playback_observation_status: 'not_observed',
  suppression_status: lifecycleState === 'released' ? 'released' : 'active',
  cooldown_status:
    lifecycleState === 'cooldown'
      ? 'active'
      : lifecycleState === 'released'
        ? 'elapsed'
        : 'clear',
  cooldown_ms: cooldownMs,
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

const sanitizeSystemSpeechLifecycleSummary = (
  value: unknown
): SystemSpeechLifecycleSummary | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  if (record.schema_version !== SYSTEM_SPEECH_LIFECYCLE_SCHEMA_VERSION) {
    return null
  }
  if (
    typeof record.system_speech_session_id !== 'string' ||
    !SYSTEM_SPEECH_SESSION_ID_PATTERN.test(record.system_speech_session_id) ||
    typeof record.playback_event_ref !== 'string' ||
    !PLAYBACK_EVENT_REF_PATTERN.test(record.playback_event_ref) ||
    !Number.isSafeInteger(record.speech_session_generation) ||
    Number(record.speech_session_generation) < 1 ||
    (record.lifecycle_state !== 'handoff_accepted' &&
      record.lifecycle_state !== 'cooldown' &&
      record.lifecycle_state !== 'released') ||
    !Number.isSafeInteger(record.cooldown_ms) ||
    Number(record.cooldown_ms) < 0 ||
    Number(record.cooldown_ms) > 2000
  ) {
    return null
  }
  return buildSystemSpeechLifecycleSummary(
    {
      system_speech_session_id: record.system_speech_session_id,
      speech_session_generation: Number(record.speech_session_generation),
      playback_event_ref: record.playback_event_ref,
    },
    record.lifecycle_state,
    Number(record.cooldown_ms)
  )
}

export const writeWindowSystemSpeechLifecycleSummary = (value: unknown) => {
  if (typeof window === 'undefined') return
  const summary = sanitizeSystemSpeechLifecycleSummary(value)
  if (!summary) return
  ;(
    window as unknown as {
      __swordAgentSystemSpeechLifecycleV0?: SystemSpeechLifecycleSummary
    }
  ).__swordAgentSystemSpeechLifecycleV0 = summary
  window.dispatchEvent(
    new CustomEvent('swordAgentSystemSpeechLifecycleV0', { detail: summary })
  )
}

export const createSystemSpeechLifecycleController = (
  options: SystemSpeechLifecycleControllerOptions = {}
) => {
  const publish = options.publish ?? writeWindowSystemSpeechLifecycleSummary
  const makeOpaqueHex = options.createOpaqueHex ?? createOpaqueHex
  const cooldownMs = Math.max(
    0,
    Math.min(2000, Math.floor(options.cooldownMs ?? SYSTEM_SPEECH_COOLDOWN_MS))
  )
  const setTimer =
    options.setTimer ??
    ((callback: () => void, delayMs: number) => setTimeout(callback, delayMs))
  const clearTimer =
    options.clearTimer ??
    ((timer: ReturnType<typeof setTimeout>) => clearTimeout(timer))
  let generation = 0
  const pending = new Map<number, SystemSpeechLifecycleLease>()
  let active: ActiveSystemSpeechLifecycle | null = null

  const prepareQueueHandoff = (): SystemSpeechLifecycleLease => {
    generation += 1
    const sessionHex = makeOpaqueHex()
    const playbackHex = makeOpaqueHex()
    if (!/^[a-f0-9]{32}$/.test(sessionHex)) {
      throw new Error('invalid_system_speech_session_entropy')
    }
    if (!/^[a-f0-9]{32}$/.test(playbackHex)) {
      throw new Error('invalid_playback_event_entropy')
    }
    const controllerOwnedLease = {
      system_speech_session_id: `system-speech-session:sss_${sessionHex}`,
      speech_session_generation: generation,
      playback_event_ref: `playback-event:pe_${playbackHex}`,
    }
    pending.set(generation, controllerOwnedLease)
    return {
      system_speech_session_id: controllerOwnedLease.system_speech_session_id,
      speech_session_generation: controllerOwnedLease.speech_session_generation,
      playback_event_ref: controllerOwnedLease.playback_event_ref,
    }
  }

  const commitQueueHandoff = (lease: SystemSpeechLifecycleLease): boolean => {
    const prepared = pending.get(lease.speech_session_generation)
    if (!prepared || !sameSystemSpeechLease(prepared, lease)) return false
    pending.delete(lease.speech_session_generation)
    if (active?.timer) clearTimer(active.timer)
    const controllerOwnedLease = {
      system_speech_session_id: prepared.system_speech_session_id,
      speech_session_generation: prepared.speech_session_generation,
      playback_event_ref: prepared.playback_event_ref,
    }
    active = {
      lease: controllerOwnedLease,
      state: 'handoff_accepted',
      timer: null,
    }
    publish(
      buildSystemSpeechLifecycleSummary(
        controllerOwnedLease,
        'handoff_accepted',
        cooldownMs
      )
    )
    return true
  }

  const releaseAfterCooldown = (lease: SystemSpeechLifecycleLease): boolean => {
    if (
      !active ||
      active.state !== 'cooldown' ||
      !sameSystemSpeechLease(active.lease, lease)
    ) {
      return false
    }
    const controllerOwnedLease = active.lease
    active = null
    publish(
      buildSystemSpeechLifecycleSummary(
        controllerOwnedLease,
        'released',
        cooldownMs
      )
    )
    return true
  }

  const completeQueueHandoff = (lease: SystemSpeechLifecycleLease): boolean => {
    if (
      !active ||
      active.state !== 'handoff_accepted' ||
      !sameSystemSpeechLease(active.lease, lease)
    ) {
      return false
    }
    const controllerOwnedLease = active.lease
    active.state = 'cooldown'
    publish(
      buildSystemSpeechLifecycleSummary(
        controllerOwnedLease,
        'cooldown',
        cooldownMs
      )
    )
    active.timer = setTimer(() => {
      releaseAfterCooldown(controllerOwnedLease)
    }, cooldownMs)
    return true
  }

  const rollbackQueueHandoff = (lease: SystemSpeechLifecycleLease): boolean => {
    const prepared = pending.get(lease.speech_session_generation)
    if (prepared && sameSystemSpeechLease(prepared, lease)) {
      pending.delete(lease.speech_session_generation)
      return true
    }
    if (!active || !sameSystemSpeechLease(active.lease, lease)) return false
    if (active.timer) clearTimer(active.timer)
    active = null
    return true
  }

  return {
    prepareQueueHandoff,
    commitQueueHandoff,
    completeQueueHandoff,
    rollbackQueueHandoff,
    releaseAfterCooldown,
  }
}

export type SpeechOutputSurface =
  | 'projection_visual_intended_text'
  | 'projection_visual_assistant_bubble'
  | 'tts_talk_message'
  | 'stt_self_output_observation'

export type SpeechOutputTextRoleClass =
  | 'intended_text'
  | 'bubble_text'
  | 'tts_provider_input_text'
  | 'heard_text_not_collected_or_not_authorized'

export type SpeechOutputTextScopeClass =
  | 'full_message'
  | 'compacted_full_text'
  | 'current_visible_page'
  | 'tts_provider_input'
  | 'not_collected_or_not_authorized'
  | 'scope_unknown'

export type SpeechOutputSummary = {
  schema_version: typeof SPEECH_OUTPUT_PARITY_SCHEMA_VERSION
  surface: SpeechOutputSurface
  source_field: string
  text_role_class: SpeechOutputTextRoleClass
  text_scope_class: SpeechOutputTextScopeClass
  message_id: string | null
  turn_id: string | null
  conversation_attempt_ref: string | null
  text_hash: string
  text_length: number
  meaning_class: string
  raw_text_published: false
  raw_audio_published: false
  provider_payload_published: false
  private_data_published: false
}

export type SpeechOutputDisplayState = {
  schema_version: typeof SPEECH_OUTPUT_PARITY_SCHEMA_VERSION
  source_field: string
  message_id: string | null
  turn_id: string | null
  conversation_attempt_ref: string | null
  display_message: string
  raw_text_local_only: true
  raw_text_published: false
  raw_audio_published: false
  provider_payload_published: false
  private_data_published: false
}

export type SpeechOutputParityStatus =
  | 'same_text_same_message'
  | 'same_text_same_message_attempt_ref_unavailable'
  | 'same_text_same_message_attempt_ref_mismatch'
  | 'same_text_message_id_unavailable'
  | 'same_message_text_scope_mismatch'
  | 'text_match_message_id_mismatch'
  | 'text_mismatch'
  | 'tts_summary_unavailable'

export type SpeechOutputParitySummary = {
  schema_version: typeof SPEECH_OUTPUT_PARITY_SCHEMA_VERSION
  intended: SpeechOutputSummary | null
  bubble: SpeechOutputSummary
  tts: SpeechOutputSummary | null
  parity_status: SpeechOutputParityStatus
  bubble_text_scope_class: SpeechOutputTextScopeClass
  tts_provider_input_text_class:
    | 'tts_provider_input_text_present'
    | 'tts_provider_input_text_unavailable'
  heard_text_class: 'not_collected_or_not_authorized'
  message_id_match: boolean
  conversation_attempt_ref: string | null
  conversation_attempt_ref_class: 'match' | 'unavailable' | 'mismatch'
  conversation_attempt_ref_match: boolean
  text_hash_match: boolean
  raw_text_published: false
  raw_audio_published: false
  provider_payload_published: false
  private_data_published: false
}

export type SelfOutputSpeechObservationSummary = {
  schema_version: typeof SPEECH_OUTPUT_PARITY_SCHEMA_VERSION
  route: 'self_output_observation'
  speaker_role: 'system_self_output'
  may_start_user_turn: false
  turn_adoption_authority: false
  transcript_surface: 'stt_self_output_observation'
  transcript_text_hash: string
  transcript_text_length: number
  transcript_meaning_class: string
  confidence_class: 'high' | 'medium' | 'low' | 'unknown'
  observed_alignment:
    | 'heard_matches_bubble_and_tts'
    | 'heard_matches_tts_bubble_mismatch'
    | 'heard_matches_bubble_tts_mismatch'
    | 'heard_mismatch_or_low_confidence'
    | 'tts_summary_unavailable'
  text_hash_matches_bubble: boolean
  text_hash_matches_tts: boolean
  message_id: string | null
  turn_id: string | null
  conversation_attempt_ref: string | null
  raw_text_published: false
  raw_audio_published: false
  provider_payload_published: false
  private_data_published: false
}

const SAFE_IDENTIFIER_PATTERN = /^[a-zA-Z0-9._:-]{1,128}$/
export const CONVERSATION_ATTEMPT_REF_PATTERN =
  /^m4\.prepared_sample_attempt:[a-f0-9]{32}$/
const MAX_LOCAL_DISPLAY_MESSAGE_CHARS = 1600

export const safeSpeechOutputIdentifier = (value: unknown): string | null => {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return SAFE_IDENTIFIER_PATTERN.test(trimmed) ? trimmed : null
}

export const hashSpeechOutputText = (value: string): string => {
  let hash = 0x811c9dc5
  for (const char of value) {
    hash ^= char.codePointAt(0) ?? 0
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

export const safeConversationAttemptRef = (value: unknown): string | null => {
  return typeof value === 'string' &&
    CONVERSATION_ATTEMPT_REF_PATTERN.test(value)
    ? value
    : null
}

export const resolveSpeechOutputDisplayConversationAttemptRef = (args: {
  displayMessageId?: string | null
  sourceMessageId?: string | null
  conversationAttemptRef?: string | null
}): string | null => {
  const displayMessageId = safeSpeechOutputIdentifier(args.displayMessageId)
  const sourceMessageId = safeSpeechOutputIdentifier(args.sourceMessageId)
  const conversationAttemptRef = safeConversationAttemptRef(
    args.conversationAttemptRef
  )
  return displayMessageId &&
    sourceMessageId &&
    displayMessageId === sourceMessageId &&
    conversationAttemptRef
    ? conversationAttemptRef
    : null
}

const defaultSpeechOutputTextRoleClass = (
  surface: SpeechOutputSurface
): SpeechOutputTextRoleClass => {
  if (surface === 'projection_visual_intended_text') return 'intended_text'
  if (surface === 'projection_visual_assistant_bubble') return 'bubble_text'
  if (surface === 'tts_talk_message') return 'tts_provider_input_text'
  return 'heard_text_not_collected_or_not_authorized'
}

const defaultSpeechOutputTextScopeClass = (
  surface: SpeechOutputSurface
): SpeechOutputTextScopeClass => {
  if (surface === 'projection_visual_intended_text')
    return 'compacted_full_text'
  if (surface === 'projection_visual_assistant_bubble') {
    return 'current_visible_page'
  }
  if (surface === 'tts_talk_message') return 'tts_provider_input'
  return 'not_collected_or_not_authorized'
}

export const buildSpeechOutputSummary = (args: {
  surface: SpeechOutputSurface
  sourceField: string
  message: string
  messageId?: string | null
  turnId?: string | null
  conversationAttemptRef?: string | null
  textRoleClass?: SpeechOutputTextRoleClass
  textScopeClass?: SpeechOutputTextScopeClass
}): SpeechOutputSummary => {
  const normalizedText = args.message.replace(/\s+/g, ' ').trim()
  return {
    schema_version: SPEECH_OUTPUT_PARITY_SCHEMA_VERSION,
    surface: args.surface,
    source_field: args.sourceField,
    text_role_class:
      args.textRoleClass ?? defaultSpeechOutputTextRoleClass(args.surface),
    text_scope_class:
      args.textScopeClass ?? defaultSpeechOutputTextScopeClass(args.surface),
    message_id: safeSpeechOutputIdentifier(args.messageId),
    turn_id: safeSpeechOutputIdentifier(args.turnId),
    conversation_attempt_ref: safeConversationAttemptRef(
      args.conversationAttemptRef
    ),
    text_hash: hashSpeechOutputText(normalizedText),
    text_length: Array.from(normalizedText).length,
    meaning_class: classifyReviewProofMessage(normalizedText),
    raw_text_published: false,
    raw_audio_published: false,
    provider_payload_published: false,
    private_data_published: false,
  }
}

export const buildSpeechOutputDisplayState = (args: {
  sourceField: string
  message: string
  messageId?: string | null
  turnId?: string | null
  conversationAttemptRef?: string | null
}): SpeechOutputDisplayState => {
  const displayMessage = args.message
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_LOCAL_DISPLAY_MESSAGE_CHARS)
  return {
    schema_version: SPEECH_OUTPUT_PARITY_SCHEMA_VERSION,
    source_field: args.sourceField,
    message_id: safeSpeechOutputIdentifier(args.messageId),
    turn_id: safeSpeechOutputIdentifier(args.turnId),
    conversation_attempt_ref: safeConversationAttemptRef(
      args.conversationAttemptRef
    ),
    display_message: displayMessage,
    raw_text_local_only: true,
    raw_text_published: false,
    raw_audio_published: false,
    provider_payload_published: false,
    private_data_published: false,
  }
}

export const compareSpeechOutputSummaries = (
  bubble: SpeechOutputSummary,
  tts: SpeechOutputSummary | null,
  args: { intended?: SpeechOutputSummary | null } = {}
): SpeechOutputParitySummary => {
  const textHashMatch =
    Boolean(tts) &&
    bubble.text_hash === tts?.text_hash &&
    bubble.text_length === tts.text_length
  const messageIdMatch =
    Boolean(tts?.message_id) &&
    Boolean(bubble.message_id) &&
    bubble.message_id === tts?.message_id
  const matchingConversationAttemptRefs =
    Boolean(tts?.conversation_attempt_ref) &&
    Boolean(bubble.conversation_attempt_ref) &&
    bubble.conversation_attempt_ref === tts?.conversation_attempt_ref
  const conversationAttemptRefMatch =
    messageIdMatch && matchingConversationAttemptRefs
  const conversationAttemptRefClass: SpeechOutputParitySummary['conversation_attempt_ref_class'] =
    !messageIdMatch ||
    !bubble.conversation_attempt_ref ||
    !tts?.conversation_attempt_ref
      ? 'unavailable'
      : matchingConversationAttemptRefs
        ? 'match'
        : 'mismatch'
  const parityStatus: SpeechOutputParityStatus = !tts
    ? 'tts_summary_unavailable'
    : textHashMatch && messageIdMatch && conversationAttemptRefMatch
      ? 'same_text_same_message'
      : textHashMatch &&
          messageIdMatch &&
          conversationAttemptRefClass === 'unavailable'
        ? 'same_text_same_message_attempt_ref_unavailable'
        : textHashMatch && messageIdMatch
          ? 'same_text_same_message_attempt_ref_mismatch'
          : messageIdMatch
            ? 'same_message_text_scope_mismatch'
            : textHashMatch && (!bubble.message_id || !tts.message_id)
              ? 'same_text_message_id_unavailable'
              : textHashMatch
                ? 'text_match_message_id_mismatch'
                : 'text_mismatch'

  return {
    schema_version: SPEECH_OUTPUT_PARITY_SCHEMA_VERSION,
    intended: args.intended ?? null,
    bubble,
    tts,
    parity_status: parityStatus,
    bubble_text_scope_class: bubble.text_scope_class,
    tts_provider_input_text_class: tts
      ? 'tts_provider_input_text_present'
      : 'tts_provider_input_text_unavailable',
    heard_text_class: 'not_collected_or_not_authorized',
    message_id_match: messageIdMatch,
    conversation_attempt_ref: conversationAttemptRefMatch
      ? bubble.conversation_attempt_ref
      : null,
    conversation_attempt_ref_class: conversationAttemptRefClass,
    conversation_attempt_ref_match: conversationAttemptRefMatch,
    text_hash_match: textHashMatch,
    raw_text_published: false,
    raw_audio_published: false,
    provider_payload_published: false,
    private_data_published: false,
  }
}

export const buildSelfOutputSpeechObservationSummary = (args: {
  transcript: string
  confidence?: number | null
  bubble: SpeechOutputSummary
  tts: SpeechOutputSummary | null
  messageId?: string | null
  turnId?: string | null
  conversationAttemptRef?: string | null
}): SelfOutputSpeechObservationSummary => {
  const transcript = buildSpeechOutputSummary({
    surface: 'stt_self_output_observation',
    sourceField: 'self_output_stt_transcript.local',
    message: args.transcript,
    messageId: args.messageId,
    turnId: args.turnId,
  })
  const highEnoughConfidence =
    typeof args.confidence !== 'number' || args.confidence >= 0.6
  const textHashMatchesBubble =
    transcript.text_hash === args.bubble.text_hash &&
    transcript.text_length === args.bubble.text_length
  const textHashMatchesTts =
    Boolean(args.tts) &&
    transcript.text_hash === args.tts?.text_hash &&
    transcript.text_length === args.tts.text_length
  const confidenceClass =
    typeof args.confidence !== 'number'
      ? 'unknown'
      : args.confidence >= 0.8
        ? 'high'
        : args.confidence >= 0.6
          ? 'medium'
          : 'low'
  const observedAlignment: SelfOutputSpeechObservationSummary['observed_alignment'] =
    !args.tts
      ? 'tts_summary_unavailable'
      : !highEnoughConfidence
        ? 'heard_mismatch_or_low_confidence'
        : textHashMatchesBubble && textHashMatchesTts
          ? 'heard_matches_bubble_and_tts'
          : textHashMatchesTts
            ? 'heard_matches_tts_bubble_mismatch'
            : textHashMatchesBubble
              ? 'heard_matches_bubble_tts_mismatch'
              : 'heard_mismatch_or_low_confidence'

  return {
    schema_version: SPEECH_OUTPUT_PARITY_SCHEMA_VERSION,
    route: 'self_output_observation',
    speaker_role: 'system_self_output',
    may_start_user_turn: false,
    turn_adoption_authority: false,
    transcript_surface: 'stt_self_output_observation',
    transcript_text_hash: transcript.text_hash,
    transcript_text_length: transcript.text_length,
    transcript_meaning_class: transcript.meaning_class,
    confidence_class: confidenceClass,
    observed_alignment: observedAlignment,
    text_hash_matches_bubble: textHashMatchesBubble,
    text_hash_matches_tts: textHashMatchesTts,
    message_id: safeSpeechOutputIdentifier(args.messageId),
    turn_id: safeSpeechOutputIdentifier(args.turnId),
    conversation_attempt_ref: safeConversationAttemptRef(
      args.conversationAttemptRef
    ),
    raw_text_published: false,
    raw_audio_published: false,
    provider_payload_published: false,
    private_data_published: false,
  }
}

export const readWindowSpeechOutputSummary = (): SpeechOutputSummary | null => {
  if (typeof window === 'undefined') return null
  const value = (
    window as unknown as {
      __projectionVisualSpeechOutputSummaryV0?: SpeechOutputSummary
    }
  ).__projectionVisualSpeechOutputSummaryV0
  return sanitizeSpeechOutputSummary(value)
}

export const readWindowSpeechOutputDisplayState =
  (): SpeechOutputDisplayState | null => {
    if (typeof window === 'undefined') return null
    const value = (
      window as unknown as {
        __projectionVisualSpeechOutputDisplayStateV0?: SpeechOutputDisplayState
      }
    ).__projectionVisualSpeechOutputDisplayStateV0
    return sanitizeSpeechOutputDisplayState(value)
  }

export const writeWindowSpeechOutputSummary = (
  summary: SpeechOutputSummary
) => {
  if (typeof window === 'undefined') return
  ;(
    window as unknown as {
      __projectionVisualSpeechOutputSummaryV0?: SpeechOutputSummary
    }
  ).__projectionVisualSpeechOutputSummaryV0 = summary
  window.dispatchEvent(
    new CustomEvent('projectionVisualSpeechOutputSummaryV0', {
      detail: summary,
    })
  )
}

export const writeWindowSpeechOutputDisplayState = (
  state: SpeechOutputDisplayState
) => {
  if (typeof window === 'undefined') return
  ;(
    window as unknown as {
      __projectionVisualSpeechOutputDisplayStateV0?: SpeechOutputDisplayState
    }
  ).__projectionVisualSpeechOutputDisplayStateV0 = state
  window.dispatchEvent(
    new CustomEvent('projectionVisualSpeechOutputDisplayStateV0', {
      detail: state,
    })
  )
}

export const writeWindowSpeechOutputParitySummary = (
  summary: SpeechOutputParitySummary
) => {
  if (typeof window === 'undefined') return
  ;(
    window as unknown as {
      __projectionVisualSpeechOutputParityV0?: SpeechOutputParitySummary
    }
  ).__projectionVisualSpeechOutputParityV0 = summary
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

export const sanitizeSpeechOutputSummary = (
  value: unknown
): SpeechOutputSummary | null => {
  if (!isRecord(value)) return null
  if (value.schema_version !== SPEECH_OUTPUT_PARITY_SCHEMA_VERSION) return null
  if (
    value.surface !== 'projection_visual_assistant_bubble' &&
    value.surface !== 'projection_visual_intended_text' &&
    value.surface !== 'tts_talk_message' &&
    value.surface !== 'stt_self_output_observation'
  ) {
    return null
  }
  const sourceField =
    typeof value.source_field === 'string'
      ? value.source_field.slice(0, 96)
      : ''
  const textHash =
    typeof value.text_hash === 'string' && /^[a-f0-9]{8}$/.test(value.text_hash)
      ? value.text_hash
      : '00000000'
  const textLength =
    typeof value.text_length === 'number' && Number.isFinite(value.text_length)
      ? Math.max(0, Math.min(1600, Math.floor(value.text_length)))
      : 0
  const meaningClass =
    typeof value.meaning_class === 'string'
      ? value.meaning_class.slice(0, 96)
      : 'normal_conversation_fallback'
  const textRoleClass =
    value.text_role_class === 'intended_text' ||
    value.text_role_class === 'bubble_text' ||
    value.text_role_class === 'tts_provider_input_text' ||
    value.text_role_class === 'heard_text_not_collected_or_not_authorized'
      ? value.text_role_class
      : defaultSpeechOutputTextRoleClass(value.surface)
  const textScopeClass =
    value.text_scope_class === 'full_message' ||
    value.text_scope_class === 'compacted_full_text' ||
    value.text_scope_class === 'current_visible_page' ||
    value.text_scope_class === 'tts_provider_input' ||
    value.text_scope_class === 'not_collected_or_not_authorized' ||
    value.text_scope_class === 'scope_unknown'
      ? value.text_scope_class
      : defaultSpeechOutputTextScopeClass(value.surface)

  return {
    schema_version: SPEECH_OUTPUT_PARITY_SCHEMA_VERSION,
    surface: value.surface,
    source_field: sourceField,
    text_role_class: textRoleClass,
    text_scope_class: textScopeClass,
    message_id: safeSpeechOutputIdentifier(value.message_id),
    turn_id: safeSpeechOutputIdentifier(value.turn_id),
    conversation_attempt_ref: safeConversationAttemptRef(
      value.conversation_attempt_ref
    ),
    text_hash: textHash,
    text_length: textLength,
    meaning_class: meaningClass,
    raw_text_published: false,
    raw_audio_published: false,
    provider_payload_published: false,
    private_data_published: false,
  }
}

export const sanitizeSpeechOutputDisplayState = (
  value: unknown
): SpeechOutputDisplayState | null => {
  if (!isRecord(value)) return null
  if (value.schema_version !== SPEECH_OUTPUT_PARITY_SCHEMA_VERSION) return null
  const displayMessage =
    typeof value.display_message === 'string'
      ? value.display_message
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, MAX_LOCAL_DISPLAY_MESSAGE_CHARS)
      : ''
  if (!displayMessage) return null
  const sourceField =
    typeof value.source_field === 'string'
      ? value.source_field.slice(0, 96)
      : ''
  return {
    schema_version: SPEECH_OUTPUT_PARITY_SCHEMA_VERSION,
    source_field: sourceField,
    message_id: safeSpeechOutputIdentifier(value.message_id),
    turn_id: safeSpeechOutputIdentifier(value.turn_id),
    conversation_attempt_ref: safeConversationAttemptRef(
      value.conversation_attempt_ref
    ),
    display_message: displayMessage,
    raw_text_local_only: true,
    raw_text_published: false,
    raw_audio_published: false,
    provider_payload_published: false,
    private_data_published: false,
  }
}
