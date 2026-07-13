import {
  CONVERSATION_ATTEMPT_REF_PATTERN,
  PLAYBACK_EVENT_REF_PATTERN,
  SYSTEM_SPEECH_LIFECYCLE_TRANSPORT_MAX_RETAINED,
  SYSTEM_SPEECH_LIFECYCLE_TRANSPORT_REQUEST_DEADLINE_MS,
  SYSTEM_SPEECH_SESSION_ID_PATTERN,
  buildSelfOutputSpeechObservationSummary,
  buildSpeechOutputSummary,
  compareSpeechOutputSummaries,
  createSystemSpeechLifecycleController,
  createSystemSpeechLifecycleTransportPublisher,
  resolveSpeechOutputDisplayConversationAttemptRef,
  safeConversationAttemptRef,
  sanitizeSpeechOutputSummary,
  waitForSystemSpeechLifecycleTransportIdle,
  writeWindowSystemSpeechLifecycleSummary,
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

  describe('system speech lifecycle', () => {
    const exactLifecycleKeys = [
      'schema_version',
      'system_speech_session_id',
      'speech_session_generation',
      'playback_event_ref',
      'lifecycle_state',
      'queue_handoff_status',
      'queue_completion_status',
      'playback_observation_status',
      'suppression_status',
      'cooldown_status',
      'cooldown_ms',
      'compare_and_release_required',
      'may_start_user_turn',
      'turn_adoption_authority',
      'raw_text_published',
      'text_hash_published',
      'provider_payload_published',
      'path_published',
      'url_published',
      'raw_audio_published',
      'device_identity_published',
      'private_data_published',
    ].sort()
    const hexValues = [
      '11111111111111111111111111111111',
      '22222222222222222222222222222222',
      '33333333333333333333333333333333',
      '44444444444444444444444444444444',
      '55555555555555555555555555555555',
      '66666666666666666666666666666666',
    ]

    it('publishes only an allowlisted handoff fact after commit', () => {
      const publish = jest.fn()
      const createOpaqueHex = jest
        .fn()
        .mockReturnValueOnce(hexValues[0])
        .mockReturnValueOnce(hexValues[1])
      const controller = createSystemSpeechLifecycleController({
        publish,
        createOpaqueHex,
      })

      const lease = controller.prepareQueueHandoff()

      expect(publish).not.toHaveBeenCalled()
      expect(
        SYSTEM_SPEECH_SESSION_ID_PATTERN.test(lease.system_speech_session_id)
      ).toBe(true)
      expect(PLAYBACK_EVENT_REF_PATTERN.test(lease.playback_event_ref)).toBe(
        true
      )
      expect(controller.commitQueueHandoff(lease)).toBe(true)

      const summary = publish.mock.calls[0][0]
      expect(summary).toEqual({
        schema_version: 'ait_system_speech_lifecycle.v0',
        system_speech_session_id:
          'system-speech-session:sss_11111111111111111111111111111111',
        speech_session_generation: 1,
        playback_event_ref:
          'playback-event:pe_22222222222222222222222222222222',
        lifecycle_state: 'handoff_accepted',
        queue_handoff_status: 'accepted',
        queue_completion_status: 'pending',
        playback_observation_status: 'not_observed',
        suppression_status: 'active',
        cooldown_status: 'clear',
        cooldown_ms: 500,
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
      expect(summary).not.toHaveProperty('text')
      expect(summary).not.toHaveProperty('text_hash')
      expect(summary).not.toHaveProperty('provider')
      expect(summary).not.toHaveProperty('path')
      expect(summary).not.toHaveProperty('url')
      expect(summary).not.toHaveProperty('audio')
      expect(summary).not.toHaveProperty('device')
      expect(Object.keys(summary).sort()).toEqual(exactLifecycleKeys)
    })

    it('keeps generations monotonic and completion/cooldown compare guarded', () => {
      const publish = jest.fn()
      const timerCallbacks: Array<() => void> = []
      const clearTimer = jest.fn()
      const createOpaqueHex = jest.fn()
      hexValues.forEach((value) => createOpaqueHex.mockReturnValueOnce(value))
      const controller = createSystemSpeechLifecycleController({
        publish,
        createOpaqueHex,
        setTimer: (callback) => {
          timerCallbacks.push(callback)
          return timerCallbacks.length as unknown as ReturnType<
            typeof setTimeout
          >
        },
        clearTimer,
      })
      const first = controller.prepareQueueHandoff()
      const adversarialFirst = {
        ...first,
        text: 'private text',
        text_hash: 'private hash',
        provider: { secret: true },
        path: 'C:\\private\\speech.wav',
        url: 'https://private.invalid/audio',
        audio: new Uint8Array([1, 2, 3]),
        device: 'private-device',
        private: { marker: 'must-not-leak' },
        may_start_user_turn: true,
        turn_adoption_authority: true,
      }
      expect(controller.commitQueueHandoff(adversarialFirst)).toBe(true)
      expect(controller.completeQueueHandoff(adversarialFirst)).toBe(true)
      expect(controller.completeQueueHandoff(adversarialFirst)).toBe(false)
      expect(
        publish.mock.calls.map(([summary]) => summary.lifecycle_state)
      ).toEqual(['handoff_accepted', 'cooldown'])

      const second = controller.prepareQueueHandoff()
      expect(second.speech_session_generation).toBe(2)
      expect(controller.commitQueueHandoff(second)).toBe(true)
      expect(clearTimer).toHaveBeenCalledTimes(1)

      timerCallbacks[0]()
      expect(publish.mock.calls.at(-1)?.[0]).toEqual(
        expect.objectContaining({
          speech_session_generation: 2,
          lifecycle_state: 'handoff_accepted',
          suppression_status: 'active',
        })
      )
      expect(controller.completeQueueHandoff(first)).toBe(false)
      expect(controller.rollbackQueueHandoff(first)).toBe(false)
      expect(controller.completeQueueHandoff(second)).toBe(true)

      timerCallbacks[1]()
      expect(publish.mock.calls.at(-1)?.[0]).toEqual(
        expect.objectContaining({
          system_speech_session_id: second.system_speech_session_id,
          speech_session_generation: 2,
          playback_event_ref: second.playback_event_ref,
          lifecycle_state: 'released',
          queue_completion_status: 'callback_observed',
          playback_observation_status: 'not_observed',
          suppression_status: 'released',
          cooldown_status: 'elapsed',
        })
      )
      publish.mock.calls.forEach(([summary]) => {
        expect(Object.keys(summary).sort()).toEqual(exactLifecycleKeys)
        expect(summary).toEqual(
          expect.objectContaining({
            playback_observation_status: 'not_observed',
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
        )
        expect(summary).not.toHaveProperty('text')
        expect(summary).not.toHaveProperty('text_hash')
        expect(summary).not.toHaveProperty('provider')
        expect(summary).not.toHaveProperty('path')
        expect(summary).not.toHaveProperty('url')
        expect(summary).not.toHaveProperty('audio')
        expect(summary).not.toHaveProperty('device')
        expect(summary).not.toHaveProperty('private')
      })
    })

    it('releases an active adversarial cloned lease without leaking injected fields', () => {
      const publish = jest.fn()
      let cooldownCallback: (() => void) | null = null
      const createOpaqueHex = jest
        .fn()
        .mockReturnValueOnce(hexValues[0])
        .mockReturnValueOnce(hexValues[1])
      const controller = createSystemSpeechLifecycleController({
        publish,
        createOpaqueHex,
        setTimer: (callback) => {
          cooldownCallback = callback
          return 1 as unknown as ReturnType<typeof setTimeout>
        },
      })
      const lease = controller.prepareQueueHandoff()
      const adversarialLease = {
        ...lease,
        text: 'release-private-text',
        text_hash: 'release-private-hash',
        provider: { marker: 'release-provider-marker' },
        path: 'C:\\release-private\\speech.wav',
        url: 'https://release-private.invalid/audio',
        audio: new Uint8Array([4, 5, 6]),
        device: 'release-private-device',
        private: { marker: 'release-private-marker' },
        may_start_user_turn: true,
        turn_adoption_authority: true,
      }

      expect(controller.commitQueueHandoff(adversarialLease)).toBe(true)
      expect(controller.completeQueueHandoff(adversarialLease)).toBe(true)
      expect(cooldownCallback).not.toBeNull()
      if (cooldownCallback === null) {
        throw new Error('adversarial_cooldown_callback_not_captured')
      }
      ;(cooldownCallback as () => void)()

      expect(
        publish.mock.calls.map(([summary]) => summary.lifecycle_state)
      ).toEqual(['handoff_accepted', 'cooldown', 'released'])
      const released = publish.mock.calls[2][0]
      expect(Object.keys(released).sort()).toEqual(exactLifecycleKeys)
      expect(released).toEqual(
        expect.objectContaining({
          system_speech_session_id: lease.system_speech_session_id,
          speech_session_generation: lease.speech_session_generation,
          playback_event_ref: lease.playback_event_ref,
          lifecycle_state: 'released',
          playback_observation_status: 'not_observed',
          may_start_user_turn: false,
          turn_adoption_authority: false,
          suppression_status: 'released',
          cooldown_status: 'elapsed',
        })
      )
      const serialized = JSON.stringify(released)
      expect(serialized).not.toContain('release-private')
      expect(serialized).not.toContain('release-provider-marker')
      expect(serialized).not.toContain('release-private-marker')
    })

    it('rolls back only an exact pending or active generation', () => {
      const publish = jest.fn()
      const createOpaqueHex = jest.fn()
      hexValues.forEach((value) => createOpaqueHex.mockReturnValueOnce(value))
      const controller = createSystemSpeechLifecycleController({
        publish,
        createOpaqueHex,
      })
      const first = controller.prepareQueueHandoff()
      const mismatched = {
        ...first,
        playback_event_ref:
          'playback-event:pe_ffffffffffffffffffffffffffffffff',
      }

      expect(controller.rollbackQueueHandoff(mismatched)).toBe(false)
      expect(controller.rollbackQueueHandoff(first)).toBe(true)
      expect(controller.commitQueueHandoff(first)).toBe(false)
      expect(publish).not.toHaveBeenCalled()
    })

    it('converges an active-handoff rollback through cooldown and release', () => {
      const publish = jest.fn()
      const timers: Array<() => void> = []
      const controller = createSystemSpeechLifecycleController({
        publish,
        createOpaqueHex: jest
          .fn()
          .mockReturnValueOnce(hexValues[0])
          .mockReturnValueOnce(hexValues[1]),
        setTimer: (callback) => {
          timers.push(callback)
          return timers.length as unknown as ReturnType<typeof setTimeout>
        },
      })
      const lease = controller.prepareQueueHandoff()

      expect(controller.commitQueueHandoff(lease)).toBe(true)
      expect(controller.rollbackQueueHandoff(lease)).toBe(true)
      expect(
        publish.mock.calls.map(([summary]) => summary.lifecycle_state)
      ).toEqual(['handoff_accepted', 'cooldown'])
      expect(timers).toHaveLength(1)
      timers[0]()
      expect(
        publish.mock.calls.map(([summary]) => summary.lifecycle_state)
      ).toEqual(['handoff_accepted', 'cooldown', 'released'])
    })

    it('retains one release after a cooldown rollback', () => {
      const publish = jest.fn()
      const timers: Array<() => void> = []
      const clearTimer = jest.fn()
      const controller = createSystemSpeechLifecycleController({
        publish,
        createOpaqueHex: jest
          .fn()
          .mockReturnValueOnce(hexValues[0])
          .mockReturnValueOnce(hexValues[1]),
        setTimer: (callback) => {
          timers.push(callback)
          return timers.length as unknown as ReturnType<typeof setTimeout>
        },
        clearTimer,
      })
      const lease = controller.prepareQueueHandoff()

      expect(controller.commitQueueHandoff(lease)).toBe(true)
      expect(controller.completeQueueHandoff(lease)).toBe(true)
      expect(controller.rollbackQueueHandoff(lease)).toBe(true)
      expect(clearTimer).not.toHaveBeenCalled()
      timers[0]()
      timers[0]()
      expect(
        publish.mock.calls.map(([summary]) => summary.lifecycle_state)
      ).toEqual(['handoff_accepted', 'cooldown', 'released'])
    })

    it('prevents a stale rollback timer from releasing a newer generation', () => {
      const publish = jest.fn()
      const timers: Array<() => void> = []
      const createOpaqueHex = jest.fn()
      hexValues.forEach((value) => createOpaqueHex.mockReturnValueOnce(value))
      const controller = createSystemSpeechLifecycleController({
        publish,
        createOpaqueHex,
        setTimer: (callback) => {
          timers.push(callback)
          return timers.length as unknown as ReturnType<typeof setTimeout>
        },
      })
      const first = controller.prepareQueueHandoff()
      expect(controller.commitQueueHandoff(first)).toBe(true)
      expect(controller.rollbackQueueHandoff(first)).toBe(true)
      const second = controller.prepareQueueHandoff()
      expect(controller.commitQueueHandoff(second)).toBe(true)

      timers[0]()
      expect(controller.completeQueueHandoff(second)).toBe(true)
      timers[1]()
      expect(
        publish.mock.calls.map(([summary]) => [
          summary.speech_session_generation,
          summary.lifecycle_state,
        ])
      ).toEqual([
        [1, 'handoff_accepted'],
        [1, 'cooldown'],
        [2, 'handoff_accepted'],
        [2, 'cooldown'],
        [2, 'released'],
      ])
    })

    it('sanitizes direct window publication to the exact lifecycle allowlist', () => {
      delete (window as any).__swordAgentSystemSpeechLifecycleV0
      writeWindowSystemSpeechLifecycleSummary({
        schema_version: 'ait_system_speech_lifecycle.v0',
        system_speech_session_id:
          'system-speech-session:sss_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        speech_session_generation: 7,
        playback_event_ref:
          'playback-event:pe_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        lifecycle_state: 'cooldown',
        cooldown_ms: 500,
        text: 'private text',
        text_hash: 'private hash',
        provider: { secret: true },
        path: 'C:\\private\\speech.wav',
        url: 'https://private.invalid/audio',
        audio: new Uint8Array([1, 2, 3]),
        device: 'private-device',
        private: { marker: 'must-not-leak' },
        may_start_user_turn: true,
        turn_adoption_authority: true,
      })

      const published = (window as any).__swordAgentSystemSpeechLifecycleV0
      expect(Object.keys(published).sort()).toEqual(exactLifecycleKeys)
      expect(published).toEqual(
        expect.objectContaining({
          lifecycle_state: 'cooldown',
          queue_completion_status: 'callback_observed',
          playback_observation_status: 'not_observed',
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
      )
      const serialized = JSON.stringify(published)
      expect(serialized).not.toContain('private text')
      expect(serialized).not.toContain('private hash')
      expect(serialized).not.toContain('private.invalid')
      expect(serialized).not.toContain('private-device')
      expect(serialized).not.toContain('must-not-leak')
    })

    it('invokes the real same-origin POST before dispatching the page event', async () => {
      const originalFetch = globalThis.fetch
      const fetchImpl = jest.fn().mockResolvedValue({ ok: true })
      const observedAtDispatch: number[] = []
      const listener = () =>
        observedAtDispatch.push(fetchImpl.mock.calls.length)
      Object.defineProperty(globalThis, 'fetch', {
        configurable: true,
        writable: true,
        value: fetchImpl,
      })
      window.addEventListener('swordAgentSystemSpeechLifecycleV0', listener)

      try {
        writeWindowSystemSpeechLifecycleSummary({
          schema_version: 'ait_system_speech_lifecycle.v0',
          system_speech_session_id:
            'system-speech-session:sss_cccccccccccccccccccccccccccccccc',
          speech_session_generation: 8,
          playback_event_ref:
            'playback-event:pe_dddddddddddddddddddddddddddddddd',
          lifecycle_state: 'handoff_accepted',
          cooldown_ms: 500,
        })

        expect(fetchImpl).toHaveBeenCalledTimes(1)
        expect(observedAtDispatch).toEqual([1])
        const [path, init] = fetchImpl.mock.calls[0]
        expect(path).toBe('/api/self-output-awareness-transport')
        expect(init).toEqual(
          expect.objectContaining({
            method: 'POST',
            credentials: 'same-origin',
            cache: 'no-store',
            keepalive: true,
          })
        )
        expect(JSON.parse(String(init.body)).lifecycle.lifecycle_state).toBe(
          'handoff_accepted'
        )
        await waitForSystemSpeechLifecycleTransportIdle()
      } finally {
        window.removeEventListener(
          'swordAgentSystemSpeechLifecycleV0',
          listener
        )
        Object.defineProperty(globalThis, 'fetch', {
          configurable: true,
          writable: true,
          value: originalFetch,
        })
      }
    })

    it('serializes same-origin lifecycle transport without blocking page publication', async () => {
      let resolveFirst: ((value: Pick<Response, 'ok'>) => void) | null = null
      const fetchImpl = jest
        .fn<Promise<Pick<Response, 'ok'>>, [string, RequestInit]>()
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              resolveFirst = resolve
            })
        )
        .mockResolvedValue({ ok: true })
      const publisher = createSystemSpeechLifecycleTransportPublisher({
        fetchImpl,
        nowWall: () => '2026-07-13T07:30:00.000Z',
        nowMonotonic: () => 123.5,
      })
      const controller = createSystemSpeechLifecycleController({
        publish: publisher.publish,
        createOpaqueHex: jest
          .fn()
          .mockReturnValueOnce(hexValues[0])
          .mockReturnValueOnce(hexValues[1]),
        setTimer: () => 1 as unknown as ReturnType<typeof setTimeout>,
      })
      const lease = controller.prepareQueueHandoff()

      expect(controller.commitQueueHandoff(lease)).toBe(true)
      expect(fetchImpl).toHaveBeenCalledTimes(1)
      expect(controller.completeQueueHandoff(lease)).toBe(true)
      expect(fetchImpl).toHaveBeenCalledTimes(1)

      if (!resolveFirst) throw new Error('first transport request was not held')
      ;(resolveFirst as (value: Pick<Response, 'ok'>) => void)({ ok: true })
      await publisher.drain()
      expect(fetchImpl).toHaveBeenCalledTimes(2)

      const [path, init] = fetchImpl.mock.calls[0]
      expect(path).toBe('/api/self-output-awareness-transport')
      expect(init).toEqual(
        expect.objectContaining({
          method: 'POST',
          credentials: 'same-origin',
          cache: 'no-store',
          keepalive: true,
        })
      )
      const body = JSON.parse(String(init.body))
      expect(body).toEqual(
        expect.objectContaining({
          schema_version: 'ait_system_speech_lifecycle_transport.v0',
          client_timestamp_wall: '2026-07-13T07:30:00.000Z',
          client_timestamp_monotonic: 123.5,
          client_performance_now: 123.5,
          raw_private_publication_flags: false,
          lifecycle: expect.objectContaining({
            lifecycle_state: 'handoff_accepted',
            may_start_user_turn: false,
            turn_adoption_authority: false,
          }),
        })
      )
      const serializedBody = JSON.stringify(body)
      expect(serializedBody).not.toContain('private transcript marker')
      expect(serializedBody).not.toContain('audio.wav')
      expect(serializedBody).not.toContain('must-not-leak')
      expect(
        JSON.parse(String(fetchImpl.mock.calls[1][1].body)).lifecycle
          .lifecycle_state
      ).toBe('cooldown')
    })

    it('continues the serialized transport after one fixed request failure', async () => {
      const fetchImpl = jest
        .fn<Promise<Pick<Response, 'ok'>>, [string, RequestInit]>()
        .mockRejectedValueOnce(new Error('private transport failure'))
        .mockResolvedValue({ ok: true })
      const publisher = createSystemSpeechLifecycleTransportPublisher({
        fetchImpl,
        nowWall: () => '2026-07-13T07:30:00.000Z',
        nowMonotonic: () => 456,
      })

      publisher.publish({
        schema_version: 'ait_system_speech_lifecycle.v0',
        system_speech_session_id:
          'system-speech-session:sss_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        speech_session_generation: 1,
        playback_event_ref:
          'playback-event:pe_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        lifecycle_state: 'handoff_accepted',
        cooldown_ms: 500,
      })
      publisher.publish({
        schema_version: 'ait_system_speech_lifecycle.v0',
        system_speech_session_id:
          'system-speech-session:sss_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        speech_session_generation: 1,
        playback_event_ref:
          'playback-event:pe_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        lifecycle_state: 'cooldown',
        cooldown_ms: 500,
      })
      publisher.publish({
        schema_version: 'ait_system_speech_lifecycle.v0',
        system_speech_session_id:
          'system-speech-session:sss_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        speech_session_generation: 1,
        playback_event_ref:
          'playback-event:pe_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        lifecycle_state: 'released',
        cooldown_ms: 500,
      })

      await expect(publisher.drain()).resolves.toBeUndefined()
      expect(fetchImpl).toHaveBeenCalledTimes(3)
      expect(publisher.getBoundedStatus().request_failure_count).toBe(1)
    })

    it('counts a non-ok lifecycle POST without exposing response content', async () => {
      const fetchImpl = jest
        .fn<Promise<Pick<Response, 'ok'>>, [string, RequestInit]>()
        .mockResolvedValueOnce({ ok: false })
      const publisher = createSystemSpeechLifecycleTransportPublisher({
        fetchImpl,
        nowWall: () => '2026-07-13T07:30:00.000Z',
        nowMonotonic: () => 457,
      })

      publisher.publish({
        schema_version: 'ait_system_speech_lifecycle.v0',
        system_speech_session_id:
          'system-speech-session:sss_eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
        speech_session_generation: 1,
        playback_event_ref:
          'playback-event:pe_ffffffffffffffffffffffffffffffff',
        lifecycle_state: 'handoff_accepted',
        cooldown_ms: 500,
      })

      await publisher.drain()
      expect(fetchImpl).toHaveBeenCalledTimes(1)
      expect(publisher.getBoundedStatus()).toEqual({
        retained_count: 0,
        queued_count: 0,
        reserved_future_count: 2,
        request_timeout_count: 0,
        request_failure_count: 1,
        overflow_count: 0,
        transition_rejected_count: 0,
      })
      expect(JSON.stringify(publisher.getBoundedStatus())).not.toContain(
        'private'
      )
    })

    it('preserves accepted lifecycle convergence under bounded overload', async () => {
      jest.useFakeTimers()
      try {
        const observedStates: Array<[number, string]> = []
        const fetchImpl = jest.fn(
          (_path: string, init: RequestInit): Promise<Pick<Response, 'ok'>> => {
            const body = JSON.parse(String(init.body))
            observedStates.push([
              body.lifecycle.speech_session_generation,
              body.lifecycle.lifecycle_state,
            ])
            if (observedStates.length === 1) {
              return new Promise((_resolve, reject) => {
                init.signal?.addEventListener('abort', () =>
                  reject(new Error('private timeout marker'))
                )
              })
            }
            return Promise.resolve({ ok: true })
          }
        )
        const publisher = createSystemSpeechLifecycleTransportPublisher({
          fetchImpl,
          nowWall: () => '2026-07-13T07:30:00.000Z',
          nowMonotonic: () => 789,
        })
        const publishState = (
          generation: number,
          lifecycleState: 'handoff_accepted' | 'cooldown' | 'released'
        ) =>
          publisher.publish({
            schema_version: 'ait_system_speech_lifecycle.v0',
            system_speech_session_id: `system-speech-session:sss_${generation
              .toString(16)
              .padStart(32, '0')}`,
            speech_session_generation: generation,
            playback_event_ref: `playback-event:pe_${generation
              .toString(16)
              .padStart(32, 'f')}`,
            lifecycle_state: lifecycleState,
            cooldown_ms: 500,
          })
        const publishGeneration = (generation: number) => {
          publishState(generation, 'handoff_accepted')
          publishState(generation, 'cooldown')
          publishState(generation, 'released')
        }

        for (let generation = 1; generation <= 6; generation += 1) {
          publishState(generation, 'handoff_accepted')
        }
        publishState(7, 'handoff_accepted')
        publishState(6, 'cooldown')
        publishState(6, 'released')
        publishState(7, 'cooldown')
        publishState(7, 'released')
        await Promise.resolve()
        expect(fetchImpl).toHaveBeenCalledTimes(1)
        const overloadedStatus = publisher.getBoundedStatus()
        expect(
          overloadedStatus.retained_count +
            overloadedStatus.reserved_future_count
        ).toBeLessThanOrEqual(SYSTEM_SPEECH_LIFECYCLE_TRANSPORT_MAX_RETAINED)
        expect(overloadedStatus).toEqual({
          retained_count: 8,
          queued_count: 7,
          reserved_future_count: 0,
          request_timeout_count: 0,
          request_failure_count: 0,
          overflow_count: 1,
          transition_rejected_count: 2,
        })

        jest.advanceTimersByTime(
          SYSTEM_SPEECH_LIFECYCLE_TRANSPORT_REQUEST_DEADLINE_MS
        )
        await publisher.drain()
        expect(observedStates).toEqual([
          [1, 'handoff_accepted'],
          [2, 'handoff_accepted'],
          [3, 'handoff_accepted'],
          [4, 'handoff_accepted'],
          [5, 'handoff_accepted'],
          [6, 'handoff_accepted'],
          [6, 'cooldown'],
          [6, 'released'],
        ])
        expect(
          observedStates.filter(
            ([generation, state]) => generation === 6 && state === 'released'
          )
        ).toHaveLength(1)
        expect(publisher.getBoundedStatus()).toEqual({
          retained_count: 0,
          queued_count: 0,
          reserved_future_count: 0,
          request_timeout_count: 1,
          request_failure_count: 1,
          overflow_count: 1,
          transition_rejected_count: 2,
        })

        publishGeneration(99)
        await publisher.drain()
        expect(observedStates.slice(-3)).toEqual([
          [99, 'handoff_accepted'],
          [99, 'cooldown'],
          [99, 'released'],
        ])
        expect(JSON.stringify(publisher.getBoundedStatus())).not.toContain(
          'private timeout marker'
        )
      } finally {
        jest.useRealTimers()
      }
    })
  })
})
