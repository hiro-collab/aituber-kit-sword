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
  writeSynthesizedSpeechOutputSummary,
} from '../../../features/messages/speakCharacter'
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
      }
      expect(resolveSpeechOutputMessage(talk)).toBe(
        '吹き出しと音声で共有する文です'
      )

      writeSynthesizedSpeechOutputSummary(talk)

      const ttsSummary = (window as any)
        .__projectionVisualSpeechOutputSummaryV0
      const displayState = (window as any)
        .__projectionVisualSpeechOutputDisplayStateV0
      const bubbleSummary = buildSpeechOutputSummary({
        surface: 'projection_visual_assistant_bubble',
        sourceField: 'speechOutputDisplayState.display_message',
        message: '吹き出しと音声で共有する文です',
        messageId: 'assistant-message-1',
        turnId: 'turn-1',
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
})
