// THREE.js とその依存関係のモック
jest.mock('three', () => ({
  Object3D: class {},
  AnimationMixer: class {},
  AudioContext: class {},
}))

jest.mock('three/examples/jsm/loaders/GLTFLoader.js', () => ({
  GLTFLoader: class {
    register() {}
    loadAsync() {
      return Promise.resolve({ userData: { vrm: {} } })
    }
  },
}))

jest.mock('@pixiv/three-vrm', () => ({
  VRM: class {},
  VRMUtils: { rotateVRM0: jest.fn(), deepDispose: jest.fn() },
  VRMExpressionPresetName: {},
  VRMLoaderPlugin: class {},
}))

import settingsStore from '../../../features/stores/settings'
import toastStore from '../../../features/stores/toast'
import i18next from 'i18next'

// preprocessMessage と handleTTSError だけを直接インポート
import {
  preprocessMessage,
  handleTTSError,
  resolveSpeechOutputMessage,
  speakCharacter,
  writeSynthesizedSpeechOutputSummary,
} from '../../../features/messages/speakCharacter'
import { SpeakQueue } from '../../../features/messages/speakQueue'
import {
  buildSpeechOutputSummary,
  compareSpeechOutputSummaries,
} from '@/utils/speechOutputParitySummary'

jest.mock('../../../features/stores/settings', () => ({
  getState: jest.fn(),
}))

jest.mock('../../../features/stores/toast', () => ({
  getState: jest.fn(),
}))

jest.mock('i18next', () => ({
  t: jest.fn((key, options) => {
    if (key === 'Errors.TTSServiceError') {
      return `TTS Service Error: ${options.serviceName} - ${options.message}`
    }
    if (key === 'Errors.UnexpectedError') {
      return 'Unexpected Error'
    }
    return key
  }),
}))

// homeStore のモック
jest.mock('../../../features/stores/home', () => ({
  getState: jest.fn(),
  setState: jest.fn(),
}))

describe('speakCharacter', () => {
  describe('preprocessMessage', () => {
    beforeEach(() => {
      jest.clearAllMocks()

      const mockSettings = {
        changeEnglishToJapanese: false,
        selectLanguage: 'en',
      }

      ;(settingsStore.getState as jest.Mock).mockReturnValue(mockSettings)
    })

    it('空の文字列の場合はnullを返す', () => {
      expect(preprocessMessage('', settingsStore.getState())).toBeNull()
    })

    it('空白のみの文字列の場合はnullを返す', () => {
      expect(preprocessMessage('   ', settingsStore.getState())).toBeNull()
    })

    it('前後の空白を削除する', () => {
      expect(preprocessMessage('  テスト  ', settingsStore.getState())).toBe(
        'テスト'
      )
    })

    it('絵文字を削除する', () => {
      expect(preprocessMessage('テスト😊', settingsStore.getState())).toBe(
        'テスト'
      )
      expect(preprocessMessage('😊テスト😊', settingsStore.getState())).toBe(
        'テスト'
      )
      expect(preprocessMessage('テ😊ス😊ト', settingsStore.getState())).toBe(
        'テスト'
      )
    })

    it('記号のみの場合はnullを返す', () => {
      expect(preprocessMessage('!!!', settingsStore.getState())).toBeNull()
      expect(preprocessMessage('...', settingsStore.getState())).toBeNull()
      expect(preprocessMessage('???', settingsStore.getState())).toBeNull()
      expect(preprocessMessage('!?.,', settingsStore.getState())).toBeNull()
      expect(preprocessMessage('(){}[]', settingsStore.getState())).toBeNull()
    })

    it('記号と文字が混在する場合は処理して返す', () => {
      expect(preprocessMessage('テスト!', settingsStore.getState())).toBe(
        'テスト!'
      )
      expect(preprocessMessage('!テスト', settingsStore.getState())).toBe(
        '!テスト'
      )
    })

    it('英語から日本語への変換が無効の場合は元のテキストを返す', () => {
      const text = 'Hello world'
      expect(preprocessMessage(text, settingsStore.getState())).toBe(text)
    })

    it('英語から日本語への変換が有効で言語が日本語の場合は元のテキストを返す（後で非同期処理される）', () => {
      const mockSettings = {
        changeEnglishToJapanese: true,
        selectLanguage: 'ja',
      }
      ;(settingsStore.getState as jest.Mock).mockReturnValue(mockSettings)

      const text = 'Hello world'
      expect(preprocessMessage(text, settingsStore.getState())).toBe(text)
    })

    it('英語から日本語への変換が有効でも言語が日本語でない場合は元のテキストを返す', () => {
      const mockSettings = {
        changeEnglishToJapanese: true,
        selectLanguage: 'en',
      }
      ;(settingsStore.getState as jest.Mock).mockReturnValue(mockSettings)

      const text = 'Hello world'
      expect(preprocessMessage(text, settingsStore.getState())).toBe(text)
    })

    it('英語が含まれていない場合は変換設定に関わらず元のテキストを返す', () => {
      const mockSettings = {
        changeEnglishToJapanese: true,
        selectLanguage: 'ja',
      }
      ;(settingsStore.getState as jest.Mock).mockReturnValue(mockSettings)

      const text = 'こんにちは'
      expect(preprocessMessage(text, settingsStore.getState())).toBe(text)
    })
  })

  describe('handleTTSError', () => {
    const mockAddToast = jest.fn()

    beforeEach(() => {
      jest.clearAllMocks()
      ;(toastStore.getState as jest.Mock).mockReturnValue({
        addToast: mockAddToast,
      })
    })

    it('Errorオブジェクトのエラーを適切に処理する', () => {
      const error = new Error('Test error message')
      const serviceName = 'voicevox'

      handleTTSError(error, serviceName)

      expect(i18next.t).toHaveBeenCalledWith('Errors.TTSServiceError', {
        serviceName,
        message: 'Test error message',
      })

      expect(mockAddToast).toHaveBeenCalledWith({
        message: 'TTS Service Error: voicevox - Test error message',
        type: 'error',
        duration: 5000,
        tag: 'tts-error',
      })
    })

    it('文字列のエラーを適切に処理する', () => {
      const error = 'String error message'
      const serviceName = 'elevenlabs'

      handleTTSError(error, serviceName)

      expect(i18next.t).toHaveBeenCalledWith('Errors.TTSServiceError', {
        serviceName,
        message: 'String error message',
      })

      expect(mockAddToast).toHaveBeenCalledWith({
        message: 'TTS Service Error: elevenlabs - String error message',
        type: 'error',
        duration: 5000,
        tag: 'tts-error',
      })
    })

    it('不明なエラー型を適切に処理する', () => {
      const error = { unknown: 'error' }
      const serviceName = 'openai'

      handleTTSError(error, serviceName)

      expect(i18next.t).toHaveBeenCalledWith('Errors.UnexpectedError')
      expect(i18next.t).toHaveBeenCalledWith('Errors.TTSServiceError', {
        serviceName,
        message: 'Unexpected Error',
      })

      expect(mockAddToast).toHaveBeenCalledWith({
        message: 'TTS Service Error: openai - Unexpected Error',
        type: 'error',
        duration: 5000,
        tag: 'tts-error',
      })
    })
  })

  describe('writeSynthesizedSpeechOutputSummary', () => {
    beforeEach(() => {
      delete (window as any).__projectionVisualSpeechOutputSummaryV0
    })

    it('uses the operator-visible display message as the canonical synthesized speech text', () => {
      const talk = {
        emotion: 'neutral' as const,
        message: '古い内部文です',
        displayMessage: '吹き出しと音声で共有する文です',
        sourceMessageId: 'assistant-message-1',
        sourceTurnId: 'turn-1',
        sourceConversationAttemptRef:
          'm4.prepared_sample_attempt:0123456789abcdef0123456789abcdef',
      }
      expect(resolveSpeechOutputMessage(talk)).toBe(
        '吹き出しと音声で共有する文です'
      )

      writeSynthesizedSpeechOutputSummary(talk)

      const ttsSummary = (window as any).__projectionVisualSpeechOutputSummaryV0
      const displayState = (window as any)
        .__projectionVisualSpeechOutputDisplayStateV0
      const bubbleSummary = buildSpeechOutputSummary({
        surface: 'projection_visual_assistant_bubble',
        sourceField: 'speechOutputDisplayState.display_message',
        message: '吹き出しと音声で共有する文です',
        messageId: 'assistant-message-1',
        turnId: 'turn-1',
        conversationAttemptRef:
          'm4.prepared_sample_attempt:0123456789abcdef0123456789abcdef',
        textRoleClass: 'bubble_text',
        textScopeClass: 'compacted_full_text',
      })
      const internalMessageSummary = buildSpeechOutputSummary({
        surface: 'tts_talk_message',
        sourceField: 'Talk.message',
        message: '古い内部文です',
        messageId: 'assistant-message-1',
        turnId: 'turn-1',
      })
      const parity = compareSpeechOutputSummaries(bubbleSummary, ttsSummary)

      expect(ttsSummary).toEqual(
        expect.objectContaining({
          schema_version: 'projection_visual_speech_output_parity.v0',
          surface: 'tts_talk_message',
          source_field: 'Talk.displayMessage.spoken',
          text_role_class: 'tts_provider_input_text',
          text_scope_class: 'tts_provider_input',
          message_id: 'assistant-message-1',
          turn_id: 'turn-1',
          conversation_attempt_ref:
            'm4.prepared_sample_attempt:0123456789abcdef0123456789abcdef',
          text_length: Array.from('吹き出しと音声で共有する文です').length,
          raw_text_published: false,
          raw_audio_published: false,
          provider_payload_published: false,
          private_data_published: false,
        })
      )
      expect(displayState).toEqual(
        expect.objectContaining({
          schema_version: 'projection_visual_speech_output_parity.v0',
          source_field: 'Talk.displayMessage.spoken',
          message_id: 'assistant-message-1',
          turn_id: 'turn-1',
          conversation_attempt_ref:
            'm4.prepared_sample_attempt:0123456789abcdef0123456789abcdef',
          display_message: '吹き出しと音声で共有する文です',
          raw_text_local_only: true,
          raw_text_published: false,
        })
      )
      expect(ttsSummary).not.toHaveProperty('text')
      expect(ttsSummary.text_hash).not.toBe(internalMessageSummary.text_hash)
      expect(parity.parity_status).toBe('same_text_same_message')
      expect(parity.text_hash_match).toBe(true)
      expect(parity.tts_provider_input_text_class).toBe(
        'tts_provider_input_text_present'
      )
      expect(parity.heard_text_class).toBe('not_collected_or_not_authorized')
    })
  })

  describe('system speech queue handoff', () => {
    let syntheticNow = Date.now() + 1_000_000

    beforeEach(() => {
      jest.clearAllMocks()
      delete (window as any).__swordAgentSystemSpeechLifecycleV0
      jest.spyOn(Date, 'now').mockImplementation(() => {
        syntheticNow += 2000
        return syntheticNow
      })
      ;(settingsStore.getState as jest.Mock).mockReturnValue({
        audioMode: false,
        changeEnglishToJapanese: false,
        selectLanguage: 'ja',
        selectVoice: 'voicevox',
      })
    })

    afterEach(() => {
      jest.restoreAllMocks()
    })

    it('creates no lifecycle for a pre-handoff empty input', () => {
      const onComplete = jest.fn()

      speakCharacter(
        'no-handoff-session',
        { emotion: 'neutral', message: '' },
        undefined,
        onComplete
      )

      expect(onComplete).toHaveBeenCalledTimes(1)
      expect(
        (window as any).__swordAgentSystemSpeechLifecycleV0
      ).toBeUndefined()
    })

    it('publishes accepted handoff, guarded cooldown, and release for a successful nonempty buffer', async () => {
      const queue = SpeakQueue.getInstance()
      const originalAddTask = queue.addTask
      const onComplete = jest.fn()
      const summaries: Array<Record<string, unknown>> = []
      const lifecycleListener = (event: Event) => {
        summaries.push((event as CustomEvent<Record<string, unknown>>).detail)
      }
      let cooldownCallback: (() => void) | null = null
      let cooldownDelay: number | undefined
      const originalSetTimeout = global.setTimeout
      jest.spyOn(global, 'setTimeout').mockImplementation(((
        callback: (...args: unknown[]) => void,
        delay?: number,
        ...args: unknown[]
      ) => {
        if (delay === 500) {
          cooldownDelay = delay
          cooldownCallback = () => callback(...args)
          return 500 as unknown as ReturnType<typeof setTimeout>
        }
        return originalSetTimeout(callback, delay, ...args)
      }) as typeof setTimeout)
      queue.addTask = jest.fn((task) => {
        task.onComplete?.()
        task.onComplete?.()
        return Promise.resolve()
      }) as typeof queue.addTask
      window.addEventListener(
        'swordAgentSystemSpeechLifecycleV0',
        lifecycleListener
      )

      try {
        speakCharacter(
          'successful-handoff-session',
          {
            emotion: 'neutral',
            message: '',
            buffer: new ArrayBuffer(8),
          },
          undefined,
          onComplete
        )
        for (let index = 0; index < 10; index += 1) {
          await Promise.resolve()
        }

        expect(queue.addTask).toHaveBeenCalledTimes(1)
        expect(onComplete).toHaveBeenCalledTimes(1)
        expect(cooldownDelay).toBe(500)
        expect(summaries.map((summary) => summary.lifecycle_state)).toEqual([
          'handoff_accepted',
          'cooldown',
        ])
        expect(
          summaries.every(
            (summary) =>
              summary.playback_observation_status === 'not_observed' &&
              summary.may_start_user_turn === false &&
              summary.turn_adoption_authority === false
          )
        ).toBe(true)
        expect(summaries[1]).toEqual(
          expect.objectContaining({
            system_speech_session_id: summaries[0].system_speech_session_id,
            speech_session_generation: summaries[0].speech_session_generation,
            playback_event_ref: summaries[0].playback_event_ref,
            queue_completion_status: 'callback_observed',
            cooldown_status: 'active',
          })
        )

        expect(cooldownCallback).not.toBeNull()
        if (cooldownCallback === null) {
          throw new Error('cooldown_callback_not_captured')
        }
        ;(cooldownCallback as () => void)()
        expect(summaries.map((summary) => summary.lifecycle_state)).toEqual([
          'handoff_accepted',
          'cooldown',
          'released',
        ])
        expect(summaries[2]).toEqual(
          expect.objectContaining({
            system_speech_session_id: summaries[0].system_speech_session_id,
            speech_session_generation: summaries[0].speech_session_generation,
            playback_event_ref: summaries[0].playback_event_ref,
            playback_observation_status: 'not_observed',
            suppression_status: 'released',
            cooldown_status: 'elapsed',
          })
        )
      } finally {
        window.removeEventListener(
          'swordAgentSystemSpeechLifecycleV0',
          lifecycleListener
        )
        queue.addTask = originalAddTask
      }
    })

    it('rolls back a synchronous addTask failure without publishing a session', async () => {
      const queue = SpeakQueue.getInstance()
      const originalAddTask = queue.addTask
      const onComplete = jest.fn()
      queue.addTask = jest.fn(() => {
        throw new Error('fixed_test_failure')
      }) as typeof queue.addTask

      try {
        speakCharacter(
          'sync-failure-session',
          {
            emotion: 'neutral',
            message: '',
            buffer: new ArrayBuffer(8),
          },
          undefined,
          onComplete
        )
        for (let index = 0; index < 10; index += 1) {
          await Promise.resolve()
        }

        expect(queue.addTask).toHaveBeenCalledTimes(1)
        expect(onComplete).toHaveBeenCalledTimes(1)
        expect(
          (window as any).__swordAgentSystemSpeechLifecycleV0
        ).toBeUndefined()
      } finally {
        queue.addTask = originalAddTask
      }
    })
  })
})
