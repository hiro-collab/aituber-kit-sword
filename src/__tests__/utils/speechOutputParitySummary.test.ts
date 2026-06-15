import {
  buildSpeechOutputSummary,
  compareSpeechOutputSummaries,
  sanitizeSpeechOutputSummary,
} from '@/utils/speechOutputParitySummary'

describe('speechOutputParitySummary', () => {
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

    expect(parity.parity_status).toBe('same_text_same_message')
    expect(parity.message_id_match).toBe(true)
    expect(parity.text_hash_match).toBe(true)
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

  it('sanitizes unsafe ids and malformed hashes from passive display state', () => {
    const summary = sanitizeSpeechOutputSummary({
      schema_version: 'projection_visual_speech_output_parity.v0',
      surface: 'tts_talk_message',
      source_field: 'Talk.message',
      message_id: 'C:\\private\\message.txt',
      turn_id: 'turn-safe',
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
        text_hash: '00000000',
        text_length: 1600,
        raw_text_published: false,
        raw_audio_published: false,
        provider_payload_published: false,
        private_data_published: false,
      })
    )
  })
})
