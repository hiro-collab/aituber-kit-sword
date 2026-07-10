import {
  CONVERSATION_ATTEMPT_REF_PATTERN,
  buildSelfOutputSpeechObservationSummary,
  buildSpeechOutputSummary,
  compareSpeechOutputSummaries,
  resolveSpeechOutputDisplayConversationAttemptRef,
  safeConversationAttemptRef,
  sanitizeSpeechOutputSummary,
} from '@/utils/speechOutputParitySummary'
import { existsSync, readFileSync, statSync } from 'fs'

const SHARED_VECTOR_FILE = 'm4_cross_repo_attempt_vectors.v0.json'
const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const readSharedVectors = () => {
  const fixturePath = process.env.SWORD_M4_SHARED_VECTOR_PATH
  if (!fixturePath) return null
  if (!fixturePath.endsWith(SHARED_VECTOR_FILE) || !existsSync(fixturePath)) {
    throw new Error(
      'configured M4 shared vector fixture is missing or unexpected'
    )
  }
  const size = statSync(fixturePath).size
  if (size < 1 || size > 64 * 1024) {
    throw new Error('configured M4 shared vector fixture has an invalid size')
  }
  let value: unknown
  try {
    value = JSON.parse(readFileSync(fixturePath, 'utf8'))
  } catch {
    throw new Error('configured M4 shared vector fixture is malformed')
  }
  if (
    !isRecord(value) ||
    value.schema_version !== 'm4_cross_repo_attempt_vectors.v0' ||
    typeof value.canonical_conversation_attempt_ref !== 'string' ||
    !isRecord(value.invalid_conversation_attempt_refs) ||
    Object.keys(value.invalid_conversation_attempt_refs).length !== 7 ||
    !Object.values(value.invalid_conversation_attempt_refs).every(
      (ref) => typeof ref === 'string'
    ) ||
    !isRecord(value.ait_source_vectors) ||
    !isRecord(value.assistant_event)
  ) {
    throw new Error('configured M4 shared vector fixture has an invalid shape')
  }
  return {
    canonicalConversationAttemptRef: value.canonical_conversation_attempt_ref,
    invalidConversationAttemptRefs: Object.values(
      value.invalid_conversation_attempt_refs
    ) as string[],
    sourceVectors: value.ait_source_vectors,
    injectedAssistantRef: isRecord(value.assistant_event.data)
      ? value.assistant_event.data.conversation_attempt_ref
      : null,
  }
}

const sharedVectors = readSharedVectors()

const conversationAttemptRef =
  sharedVectors?.canonicalConversationAttemptRef ??
  'm4.prepared_sample_attempt:0123456789abcdef0123456789abcdef'
const otherConversationAttemptRef =
  'm4.prepared_sample_attempt:fedcba9876543210fedcba9876543210'
const invalidConversationAttemptRefs =
  sharedVectors?.invalidConversationAttemptRefs ?? ['not-a-canonical-ref']

describe('speechOutputParitySummary', () => {
  it('keeps the canonical ref regex exact', () => {
    expect(CONVERSATION_ATTEMPT_REF_PATTERN.source).toBe(
      '^m4\\.prepared_sample_attempt:[a-f0-9]{32}$'
    )
  })

  it('compares bubble and TTS summaries without publishing raw text', () => {
    const bubble = buildSpeechOutputSummary({
      surface: 'projection_visual_assistant_bubble',
      sourceField: 'homeStore.chatLog.latestAssistantMessage',
      message: 'こんにちは。',
      messageId: 'assistant-message-1',
      turnId: 'turn-1',
    })
    const tts = buildSpeechOutputSummary({
      surface: 'tts_talk_message',
      sourceField: 'Talk.message',
      message: 'こんにちは。',
      messageId: 'assistant-message-1',
      turnId: 'turn-1',
    })

    const parity = compareSpeechOutputSummaries(bubble, tts)

    expect(parity.parity_status).toBe(
      'same_text_same_message_attempt_ref_unavailable'
    )
    expect(parity.message_id_match).toBe(true)
    expect(parity.conversation_attempt_ref_class).toBe('unavailable')
    expect(parity.text_hash_match).toBe(true)
    expect(parity.bubble_text_scope_class).toBe('current_visible_page')
    expect(parity.tts_provider_input_text_class).toBe(
      'tts_provider_input_text_present'
    )
    expect(parity.heard_text_class).toBe('not_collected_or_not_authorized')
    expect(bubble).not.toHaveProperty('text')
    expect(tts).not.toHaveProperty('text')
    expect(parity.raw_text_published).toBe(false)
    expect(parity.raw_audio_published).toBe(false)
  })

  it('classifies text match with a stale or mismatched message id', () => {
    const bubble = buildSpeechOutputSummary({
      surface: 'projection_visual_assistant_bubble',
      sourceField: 'homeStore.chatLog.latestAssistantMessage',
      message: '同じ文です。',
      messageId: 'assistant-message-current',
      turnId: 'turn-current',
    })
    const tts = buildSpeechOutputSummary({
      surface: 'tts_talk_message',
      sourceField: 'Talk.message',
      message: '同じ文です。',
      messageId: 'assistant-message-previous',
      turnId: 'turn-previous',
    })

    const parity = compareSpeechOutputSummaries(bubble, tts)

    expect(parity.parity_status).toBe('text_match_message_id_mismatch')
    expect(parity.message_id_match).toBe(false)
    expect(parity.text_hash_match).toBe(true)
  })

  it('distinguishes matching, missing, and mismatched conversation attempt refs', () => {
    const bubble = buildSpeechOutputSummary({
      surface: 'projection_visual_assistant_bubble',
      sourceField: 'homeStore.chatLog.latestAssistantMessage',
      message: '同じ文です。',
      messageId: 'assistant-message-current',
      conversationAttemptRef,
    })
    const matchingTts = buildSpeechOutputSummary({
      surface: 'tts_talk_message',
      sourceField: 'Talk.message',
      message: '同じ文です。',
      messageId: 'assistant-message-current',
      conversationAttemptRef,
    })
    const missingTts = buildSpeechOutputSummary({
      surface: 'tts_talk_message',
      sourceField: 'Talk.message',
      message: '同じ文です。',
      messageId: 'assistant-message-current',
    })
    const mismatchedTts = buildSpeechOutputSummary({
      surface: 'tts_talk_message',
      sourceField: 'Talk.message',
      message: '同じ文です。',
      messageId: 'assistant-message-current',
      conversationAttemptRef: otherConversationAttemptRef,
    })

    expect(compareSpeechOutputSummaries(bubble, matchingTts)).toEqual(
      expect.objectContaining({
        parity_status: 'same_text_same_message',
        conversation_attempt_ref: conversationAttemptRef,
        conversation_attempt_ref_class: 'match',
      })
    )
    expect(compareSpeechOutputSummaries(bubble, missingTts)).toEqual(
      expect.objectContaining({
        parity_status: 'same_text_same_message_attempt_ref_unavailable',
        conversation_attempt_ref: null,
        conversation_attempt_ref_class: 'unavailable',
      })
    )
    expect(compareSpeechOutputSummaries(bubble, mismatchedTts)).toEqual(
      expect.objectContaining({
        parity_status: 'same_text_same_message_attempt_ref_mismatch',
        conversation_attempt_ref: null,
        conversation_attempt_ref_class: 'mismatch',
      })
    )
  })

  it.each(invalidConversationAttemptRefs)(
    'omits a non-canonical conversation attempt ref: %s',
    (invalidRef) => {
      expect(safeConversationAttemptRef(invalidRef)).toBeNull()
      expect(
        buildSpeechOutputSummary({
          surface: 'tts_talk_message',
          sourceField: 'Talk.message',
          message: 'text',
          messageId: 'assistant-message-1',
          conversationAttemptRef: invalidRef,
        }).conversation_attempt_ref
      ).toBeNull()
    }
  )

  it('preserves canonical refs and binds each display surface to its exact source', () => {
    expect(safeConversationAttemptRef(conversationAttemptRef)).toBe(
      conversationAttemptRef
    )

    const chatRef = resolveSpeechOutputDisplayConversationAttemptRef({
      displayMessageId: 'chat-message-1',
      sourceMessageId: 'chat-message-1',
      conversationAttemptRef,
    })
    const passiveRef = resolveSpeechOutputDisplayConversationAttemptRef({
      displayMessageId: 'passive-message-1',
      sourceMessageId: 'passive-message-1',
      conversationAttemptRef: otherConversationAttemptRef,
    })
    const operatorRef = resolveSpeechOutputDisplayConversationAttemptRef({
      displayMessageId: 'operator-message-1',
      sourceMessageId: 'operator-message-1',
      conversationAttemptRef,
    })

    expect(chatRef).toBe(conversationAttemptRef)
    expect(passiveRef).toBe(otherConversationAttemptRef)
    expect(operatorRef).toBe(conversationAttemptRef)
    expect(passiveRef).not.toBe(chatRef)
  })

  it.each([
    {
      displayMessageId: null,
      sourceMessageId: 'message-1',
      conversationAttemptRef,
    },
    {
      displayMessageId: 'message-1',
      sourceMessageId: null,
      conversationAttemptRef,
    },
    {
      displayMessageId: 'message-1',
      sourceMessageId: 'message-2',
      conversationAttemptRef,
    },
    {
      displayMessageId: 'message-1',
      sourceMessageId: 'message-1',
      conversationAttemptRef: 'm4.attempt-001',
    },
  ])(
    'leaves a display ref unavailable without a matching canonical source',
    (input) => {
      expect(resolveSpeechOutputDisplayConversationAttemptRef(input)).toBeNull()
    }
  )

  it('treats message-id mismatch as unavailable and differing valid refs as mismatch', () => {
    const bubble = buildSpeechOutputSummary({
      surface: 'projection_visual_assistant_bubble',
      sourceField: 'speechOutputDisplayState.display_message',
      message: 'same text',
      messageId: 'message-1',
      conversationAttemptRef,
    })
    const mismatchedMessageId = buildSpeechOutputSummary({
      surface: 'tts_talk_message',
      sourceField: 'Talk.displayMessage.spoken',
      message: 'same text',
      messageId: 'message-2',
      conversationAttemptRef: otherConversationAttemptRef,
    })
    const mismatchedRef = buildSpeechOutputSummary({
      surface: 'tts_talk_message',
      sourceField: 'Talk.displayMessage.spoken',
      message: 'same text',
      messageId: 'message-1',
      conversationAttemptRef: otherConversationAttemptRef,
    })

    expect(
      compareSpeechOutputSummaries(bubble, mismatchedMessageId)
        .conversation_attempt_ref_class
    ).toBe('unavailable')
    expect(
      compareSpeechOutputSummaries(bubble, mismatchedRef)
        .conversation_attempt_ref_class
    ).toBe('mismatch')
  })

  it('classifies same-message bubble/TTS text scope mismatch without exact same-text claim', () => {
    const intended = buildSpeechOutputSummary({
      surface: 'projection_visual_intended_text',
      sourceField: 'speechOutputDisplayState.display_message',
      message: '最初のページです。次のページです。',
      messageId: 'assistant-message-current',
      turnId: 'turn-current',
      textRoleClass: 'intended_text',
      textScopeClass: 'compacted_full_text',
    })
    const bubble = buildSpeechOutputSummary({
      surface: 'projection_visual_assistant_bubble',
      sourceField: 'speechOutputDisplayState.display_message',
      message: '最初のページです。',
      messageId: 'assistant-message-current',
      turnId: 'turn-current',
      textRoleClass: 'bubble_text',
      textScopeClass: 'current_visible_page',
    })
    const tts = buildSpeechOutputSummary({
      surface: 'tts_talk_message',
      sourceField: 'Talk.displayMessage.spoken',
      message: '最初のページです。次のページです。',
      messageId: 'assistant-message-current',
      turnId: 'turn-current',
      textRoleClass: 'tts_provider_input_text',
      textScopeClass: 'tts_provider_input',
    })

    const parity = compareSpeechOutputSummaries(bubble, tts, { intended })

    expect(parity.intended).toEqual(intended)
    expect(parity.parity_status).toBe('same_message_text_scope_mismatch')
    expect(parity.message_id_match).toBe(true)
    expect(parity.text_hash_match).toBe(false)
    expect(parity.bubble_text_scope_class).toBe('current_visible_page')
    expect(parity.tts_provider_input_text_class).toBe(
      'tts_provider_input_text_present'
    )
    expect(parity.heard_text_class).toBe('not_collected_or_not_authorized')
    expect(parity.raw_text_published).toBe(false)
  })

  it('sanitizes unsafe ids and malformed hashes from passive display state', () => {
    const summary = sanitizeSpeechOutputSummary({
      schema_version: 'projection_visual_speech_output_parity.v0',
      surface: 'tts_talk_message',
      source_field: 'Talk.message',
      text_role_class: 'tts_provider_input_text',
      text_scope_class: 'tts_provider_input',
      message_id: 'C:\\private\\message.txt',
      turn_id: 'turn-safe',
      conversation_attempt_ref: 'raw-private-marker',
      text_hash: 'not-a-hash',
      text_length: 99999,
      meaning_class: 'command_accepted_unconfirmed',
      raw_text_published: true,
      raw_audio_published: true,
      provider_payload_published: true,
      private_data_published: true,
    })

    expect(summary).toEqual(
      expect.objectContaining({
        message_id: null,
        turn_id: 'turn-safe',
        conversation_attempt_ref: null,
        text_role_class: 'tts_provider_input_text',
        text_scope_class: 'tts_provider_input',
        text_hash: '00000000',
        text_length: 1600,
        raw_text_published: false,
        raw_audio_published: false,
        provider_payload_published: false,
        private_data_published: false,
      })
    )
  })

  it('strips the shared fixture injected assistant ref instead of retaining it', () => {
    const injectedRef =
      sharedVectors?.injectedAssistantRef ?? 'injected:not_authoritative'
    expect(
      sanitizeSpeechOutputSummary({
        schema_version: 'projection_visual_speech_output_parity.v0',
        surface: 'tts_talk_message',
        source_field: 'Talk.message',
        text_hash: '00000000',
        text_length: 0,
        meaning_class: 'normal_conversation_fallback',
        conversation_attempt_ref: injectedRef,
      })?.conversation_attempt_ref
    ).toBeNull()
  })

  it('classifies self-output STT as non-user-turn evidence for bubble/TTS drift', () => {
    const bubble = buildSpeechOutputSummary({
      surface: 'projection_visual_assistant_bubble',
      sourceField: 'homeStore.chatLog.latestAssistantMessage',
      message: '吹き出しだけに出ている文です。',
      messageId: 'assistant-message-1',
      turnId: 'turn-1',
      conversationAttemptRef,
    })
    const tts = buildSpeechOutputSummary({
      surface: 'tts_talk_message',
      sourceField: 'Talk.message.synthesized',
      message: 'VOICEVOXで実際に喋った文です。',
      messageId: 'assistant-message-1',
      turnId: 'turn-1',
    })

    const observation = buildSelfOutputSpeechObservationSummary({
      transcript: 'VOICEVOXで実際に喋った文です。',
      confidence: 0.92,
      bubble,
      tts,
      messageId: 'assistant-message-1',
      turnId: 'turn-1',
      conversationAttemptRef,
    })

    expect(observation).toEqual(
      expect.objectContaining({
        route: 'self_output_observation',
        speaker_role: 'system_self_output',
        may_start_user_turn: false,
        turn_adoption_authority: false,
        transcript_surface: 'stt_self_output_observation',
        observed_alignment: 'heard_matches_tts_bubble_mismatch',
        text_hash_matches_tts: true,
        text_hash_matches_bubble: false,
        raw_text_published: false,
        raw_audio_published: false,
        provider_payload_published: false,
        private_data_published: false,
        conversation_attempt_ref: conversationAttemptRef,
      })
    )
    expect(observation).not.toHaveProperty('transcript')
    expect(observation).not.toHaveProperty('text')
  })
})
