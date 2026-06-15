import { classifyReviewProofMessage } from '@/utils/reviewProofMessage'

export const SPEECH_OUTPUT_PARITY_SCHEMA_VERSION =
  'projection_visual_speech_output_parity.v0'

export type SpeechOutputSurface =
  | 'projection_visual_assistant_bubble'
  | 'tts_talk_message'

export type SpeechOutputSummary = {
  schema_version: typeof SPEECH_OUTPUT_PARITY_SCHEMA_VERSION
  surface: SpeechOutputSurface
  source_field: string
  message_id: string | null
  turn_id: string | null
  text_hash: string
  text_length: number
  meaning_class: string
  raw_text_published: false
  raw_audio_published: false
  provider_payload_published: false
  private_data_published: false
}

export type SpeechOutputParityStatus =
  | 'same_text_same_message'
  | 'same_text_message_id_unavailable'
  | 'text_match_message_id_mismatch'
  | 'text_mismatch'
  | 'tts_summary_unavailable'

export type SpeechOutputParitySummary = {
  schema_version: typeof SPEECH_OUTPUT_PARITY_SCHEMA_VERSION
  bubble: SpeechOutputSummary
  tts: SpeechOutputSummary | null
  parity_status: SpeechOutputParityStatus
  message_id_match: boolean
  text_hash_match: boolean
  raw_text_published: false
  raw_audio_published: false
  provider_payload_published: false
  private_data_published: false
}

const SAFE_IDENTIFIER_PATTERN = /^[a-zA-Z0-9._:-]{1,128}$/

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

export const buildSpeechOutputSummary = (args: {
  surface: SpeechOutputSurface
  sourceField: string
  message: string
  messageId?: string | null
  turnId?: string | null
}): SpeechOutputSummary => {
  const normalizedText = args.message.replace(/\s+/g, ' ').trim()
  return {
    schema_version: SPEECH_OUTPUT_PARITY_SCHEMA_VERSION,
    surface: args.surface,
    source_field: args.sourceField,
    message_id: safeSpeechOutputIdentifier(args.messageId),
    turn_id: safeSpeechOutputIdentifier(args.turnId),
    text_hash: hashSpeechOutputText(normalizedText),
    text_length: Array.from(normalizedText).length,
    meaning_class: classifyReviewProofMessage(normalizedText),
    raw_text_published: false,
    raw_audio_published: false,
    provider_payload_published: false,
    private_data_published: false,
  }
}

export const compareSpeechOutputSummaries = (
  bubble: SpeechOutputSummary,
  tts: SpeechOutputSummary | null
): SpeechOutputParitySummary => {
  const textHashMatch =
    Boolean(tts) &&
    bubble.text_hash === tts?.text_hash &&
    bubble.text_length === tts.text_length
  const messageIdMatch =
    Boolean(tts?.message_id) &&
    Boolean(bubble.message_id) &&
    bubble.message_id === tts?.message_id
  const parityStatus: SpeechOutputParityStatus = !tts
    ? 'tts_summary_unavailable'
    : textHashMatch && messageIdMatch
      ? 'same_text_same_message'
      : textHashMatch && (!bubble.message_id || !tts.message_id)
        ? 'same_text_message_id_unavailable'
        : textHashMatch
          ? 'text_match_message_id_mismatch'
          : 'text_mismatch'

  return {
    schema_version: SPEECH_OUTPUT_PARITY_SCHEMA_VERSION,
    bubble,
    tts,
    parity_status: parityStatus,
    message_id_match: messageIdMatch,
    text_hash_match: textHashMatch,
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
    value.surface !== 'tts_talk_message'
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

  return {
    schema_version: SPEECH_OUTPUT_PARITY_SCHEMA_VERSION,
    surface: value.surface,
    source_field: sourceField,
    message_id: safeSpeechOutputIdentifier(value.message_id),
    turn_id: safeSpeechOutputIdentifier(value.turn_id),
    text_hash: textHash,
    text_length: textLength,
    meaning_class: meaningClass,
    raw_text_published: false,
    raw_audio_published: false,
    provider_payload_published: false,
    private_data_published: false,
  }
}
