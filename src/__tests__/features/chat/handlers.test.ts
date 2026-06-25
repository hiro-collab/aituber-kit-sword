import {
  handleSendChatFn,
  handleReceiveTextFromWsFn,
  processAIResponse,
  speakMessageHandler,
} from '../../../features/chat/handlers'
import { getAIChatResponseStream } from '../../../features/chat/aiChatFactory'
import { speakCharacter } from '../../../features/messages/speakCharacter'
import homeStore from '../../../features/stores/home'
import settingsStore from '../../../features/stores/settings'
import slideStore from '../../../features/stores/slide'
import webSocketStore from '../../../features/stores/websocketStore'
import toastStore from '../../../features/stores/toast'
import i18next from 'i18next'
import { Message } from '../../../features/messages/messages'

jest.mock('../../../features/chat/aiChatFactory', () => ({
  getAIChatResponseStream: jest.fn(),
}))

jest.mock('../../../features/messages/speakCharacter', () => ({
  speakCharacter: jest.fn(),
}))

jest.mock('../../../components/slides', () => ({
  goToSlide: jest.fn(),
}))

jest.mock('../../../features/stores/home', () => ({
  getState: jest.fn(),
  setState: jest.fn(),
  upsertMessage: jest.fn(),
}))

jest.mock('../../../features/stores/settings', () => ({
  getState: jest.fn(),
}))

jest.mock('../../../features/stores/slide', () => ({
  getState: jest.fn(),
}))

jest.mock('../../../features/stores/websocketStore', () => ({
  getState: jest.fn(),
}))

jest.mock('../../../features/stores/toast', () => ({
  getState: jest.fn(),
}))

jest.mock('i18next', () => ({
  t: jest.fn((key) => key),
}))

describe('handlers', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    delete (window as any).__projectionVisualSpeechOutputSummaryV0
    delete (window as any).__projectionVisualSpeechOutputParityV0
  })

  describe('handleSendChatFn', () => {
    it('メッセージが空の場合は処理を行わない', async () => {
      const handleSendChat = handleSendChatFn()
      await handleSendChat(null as unknown as string)

      expect(homeStore.setState).not.toHaveBeenCalled()
    })

    it('externalLinkageModeがtrueの場合、WebSocketを使用してメッセージを送信する', async () => {
      const mockWebSocket = {
        readyState: WebSocket.OPEN,
        send: jest.fn(),
      }
      const mockWsManager = {
        websocket: mockWebSocket,
      }
      ;(webSocketStore.getState as jest.Mock).mockReturnValue({
        wsManager: mockWsManager,
      })
      ;(settingsStore.getState as jest.Mock).mockReturnValue({
        externalLinkageMode: true,
      })
      ;(homeStore.getState as jest.Mock).mockReturnValue({
        chatLog: [],
        modalImage: '',
        upsertMessage: jest.fn(),
      })

      const handleSendChat = handleSendChatFn()
      await handleSendChat('テストメッセージ')

      expect(homeStore.setState).toHaveBeenCalledWith({ chatProcessing: true })
      expect(mockWebSocket.send).toHaveBeenCalledWith(
        JSON.stringify({ content: 'テストメッセージ', type: 'chat' })
      )
      expect((homeStore.getState() as any).upsertMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          role: 'user',
          content: 'テストメッセージ',
        })
      )
    })

    it('externalLinkageModeがtrueで画像がある場合、WebSocketペイロードにimageを含める', async () => {
      const mockWebSocket = {
        readyState: WebSocket.OPEN,
        send: jest.fn(),
      }
      const mockWsManager = {
        websocket: mockWebSocket,
      }
      ;(webSocketStore.getState as jest.Mock).mockReturnValue({
        wsManager: mockWsManager,
      })
      ;(settingsStore.getState as jest.Mock).mockReturnValue({
        externalLinkageMode: true,
      })
      const mockUpsertMessage = jest.fn()
      ;(homeStore.getState as jest.Mock).mockReturnValue({
        chatLog: [],
        modalImage: 'data:image/png;base64,iVBORw0KGgo=',
        upsertMessage: mockUpsertMessage,
      })

      const handleSendChat = handleSendChatFn()
      await handleSendChat('画像付きメッセージ')

      expect(mockWebSocket.send).toHaveBeenCalledWith(
        JSON.stringify({
          content: '画像付きメッセージ',
          type: 'chat',
          image: 'data:image/png;base64,iVBORw0KGgo=',
        })
      )
      expect(mockUpsertMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          role: 'user',
          content: [
            { type: 'text', text: '画像付きメッセージ' },
            { type: 'image', image: 'data:image/png;base64,iVBORw0KGgo=' },
          ],
        })
      )
      expect(homeStore.setState).toHaveBeenCalledWith({ modalImage: '' })
    })

    it('externalLinkageModeがtrueだがWebSocketが接続されていない場合、エラーを表示する', async () => {
      const mockAddToast = jest.fn()
      const mockWebSocket = {
        readyState: WebSocket.CLOSED,
      }
      const mockWsManager = {
        websocket: mockWebSocket,
      }
      ;(webSocketStore.getState as jest.Mock).mockReturnValue({
        wsManager: mockWsManager,
      })
      ;(settingsStore.getState as jest.Mock).mockReturnValue({
        externalLinkageMode: true,
      })
      ;(toastStore.getState as jest.Mock).mockReturnValue({
        addToast: mockAddToast,
      })

      const handleSendChat = handleSendChatFn()
      await handleSendChat('テストメッセージ')

      expect(homeStore.setState).toHaveBeenCalledWith({ chatProcessing: true })
      expect(mockAddToast).toHaveBeenCalledWith({
        message: 'NotConnectedToExternalAssistant',
        type: 'error',
        tag: 'not-connected-to-external-assistant',
      })
      expect(homeStore.setState).toHaveBeenCalledWith({
        chatProcessing: false,
      })
    })

    it('通常モードの場合、AIチャットレスポンスを処理する', async () => {
      const mockChatLog: Message[] = []
      const mockReader = {
        read: jest
          .fn()
          .mockResolvedValueOnce({ value: 'テスト応答', done: false })
          .mockResolvedValueOnce({ value: undefined, done: true }),
        releaseLock: jest.fn(),
      }
      const mockStream = {
        getReader: jest.fn().mockReturnValue(mockReader),
      } as unknown as ReadableStream<string>
      ;(getAIChatResponseStream as jest.Mock).mockResolvedValue(mockStream)
      const mockHomeStore = {
        chatLog: mockChatLog,
        chatProcessing: false,
        modalImage: '',
        setState: jest.fn(),
        upsertMessage: jest.fn((newMessage: Message) => {
          const existingIndex = mockChatLog.findIndex(
            (msg) =>
              msg.audio?.id === newMessage.audio?.id &&
              newMessage.audio?.id !== undefined
          )
          if (existingIndex !== -1) {
            mockChatLog[existingIndex] = {
              ...mockChatLog[existingIndex],
              ...newMessage,
            }
          } else {
            mockChatLog.push({ content: '', ...newMessage })
          }
        }),
      }
      ;(homeStore.getState as jest.Mock).mockReturnValue(mockHomeStore)
      ;(settingsStore.getState as jest.Mock).mockReturnValue({
        externalLinkageMode: false,
        realtimeAPIMode: false,
        slideMode: false,
        systemPrompt: 'テストプロンプト',
        includeTimestampInUserMessage: false,
        poseConfigs: [],
      })

      const handleSendChat = handleSendChatFn()
      await handleSendChat('テストメッセージ')

      expect(homeStore.setState).toHaveBeenCalledWith({ chatProcessing: true })
      expect(mockHomeStore.upsertMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          role: 'user',
          content: 'テストメッセージ',
        })
      )
      expect(getAIChatResponseStream).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            role: 'system',
            content: 'テストプロンプト',
          }),
        ])
      )
    })
  })

  describe('handleReceiveTextFromWsFn', () => {
    it('画像付きメッセージを受信した場合、マルチモーダル形式で格納する', async () => {
      const mockUpsertMessage = jest.fn()
      const mockWsManager = {
        textBlockStarted: false,
        setTextBlockStarted: jest.fn(),
      }
      ;(settingsStore.getState as jest.Mock).mockReturnValue({
        externalLinkageMode: true,
      })
      ;(homeStore.getState as jest.Mock).mockReturnValue({
        chatLog: [],
        upsertMessage: mockUpsertMessage,
      })
      ;(webSocketStore.getState as jest.Mock).mockReturnValue({
        wsManager: mockWsManager,
      })

      const handleReceiveTextFromWs = handleReceiveTextFromWsFn()
      await handleReceiveTextFromWs(
        'テスト応答',
        'assistant',
        'happy',
        undefined,
        'data:image/png;base64,iVBORw0KGgo='
      )

      expect(mockUpsertMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          role: 'assistant',
          content: [
            { type: 'text', text: 'テスト応答' },
            { type: 'image', image: 'data:image/png;base64,iVBORw0KGgo=' },
          ],
        })
      )
    })

    it('画像なしメッセージを受信した場合、テキストのみで格納する', async () => {
      const mockUpsertMessage = jest.fn()
      const mockWsManager = {
        textBlockStarted: false,
        setTextBlockStarted: jest.fn(),
      }
      ;(settingsStore.getState as jest.Mock).mockReturnValue({
        externalLinkageMode: true,
      })
      ;(homeStore.getState as jest.Mock).mockReturnValue({
        chatLog: [],
        upsertMessage: mockUpsertMessage,
      })
      ;(webSocketStore.getState as jest.Mock).mockReturnValue({
        wsManager: mockWsManager,
      })

      const handleReceiveTextFromWs = handleReceiveTextFromWsFn()
      await handleReceiveTextFromWs('テスト応答', 'assistant', 'neutral')

      expect(mockUpsertMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          id: expect.any(String),
          role: 'assistant',
          content: 'テスト応答',
        })
      )
      const assistantMessageId = mockUpsertMessage.mock.calls[0][0].id
      expect(speakCharacter).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          message: 'テスト応答',
          sourceMessageId: assistantMessageId,
          sourceTurnId: expect.any(String),
          displayMessage: 'テスト応答',
        }),
        expect.any(Function),
        expect.any(Function)
      )
    })

    it('ストリーミング追記時にマルチモーダルコンテンツの画像を保持する', async () => {
      const mockUpsertMessage = jest.fn()
      const mockWsManager = {
        textBlockStarted: true,
        setTextBlockStarted: jest.fn(),
      }
      ;(settingsStore.getState as jest.Mock).mockReturnValue({
        externalLinkageMode: true,
      })
      ;(homeStore.getState as jest.Mock).mockReturnValue({
        chatLog: [
          {
            id: 'msg-1',
            role: 'assistant',
            content: [
              { type: 'text', text: '最初のチャンク' },
              { type: 'image', image: 'data:image/png;base64,abc123' },
            ],
          },
        ],
        upsertMessage: mockUpsertMessage,
      })
      ;(webSocketStore.getState as jest.Mock).mockReturnValue({
        wsManager: mockWsManager,
      })

      const handleReceiveTextFromWs = handleReceiveTextFromWsFn()
      await handleReceiveTextFromWs('追加テキスト', 'assistant', 'happy')

      expect(mockUpsertMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'msg-1',
          role: 'assistant',
          content: [
            { type: 'text', text: '最初のチャンク追加テキスト' },
            { type: 'image', image: 'data:image/png;base64,abc123' },
          ],
        })
      )
    })
  })

  describe('speakMessageHandler', () => {
    it('裸のモーションタグを感情ではなくモーションとして扱う', async () => {
      const mockUpsertMessage = jest.fn()
      ;(settingsStore.getState as jest.Mock).mockReturnValue({
        poseConfigs: [{ id: 'bow', json: '/poses/bow.json' }],
      })
      ;(homeStore.getState as jest.Mock).mockReturnValue({
        upsertMessage: mockUpsertMessage,
      })

      await speakMessageHandler(
        '[neutral]おっ、またお辞儀か！[bow]はい、どうぞ！'
      )

      expect(speakCharacter).toHaveBeenNthCalledWith(
        1,
        expect.any(String),
        expect.objectContaining({
          message: 'おっ、またお辞儀か！',
          emotion: 'neutral',
          sourceMessageId: expect.any(String),
          sourceTurnId: expect.any(String),
          displayMessage: 'おっ、またお辞儀か！',
        }),
        expect.any(Function),
        expect.any(Function)
      )
      expect(speakCharacter).toHaveBeenNthCalledWith(
        2,
        expect.any(String),
        expect.objectContaining({
          message: 'はい、どうぞ！',
          emotion: 'neutral',
          motion: 'bow',
          sourceMessageId: expect.any(String),
          sourceTurnId: expect.any(String),
          displayMessage: 'はい、どうぞ！',
        }),
        expect.any(Function),
        expect.any(Function)
      )
      const assistantMessageId = mockUpsertMessage.mock.calls.find(
        ([message]) => message.role === 'assistant'
      )?.[0].id
      expect(assistantMessageId).toEqual(expect.any(String))
      expect(speakCharacter).toHaveBeenNthCalledWith(
        1,
        expect.any(String),
        expect.objectContaining({
          sourceMessageId: assistantMessageId,
        }),
        expect.any(Function),
        expect.any(Function)
      )
      expect(mockUpsertMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          role: 'assistant',
          content: expect.not.stringContaining('[bow]'),
        })
      )
    })

    it('proof-ceiling action messages use the same compact text for bubble display and TTS', async () => {
      const mockUpsertMessage = jest.fn()
      ;(settingsStore.getState as jest.Mock).mockReturnValue({
        poseConfigs: [],
      })
      ;(homeStore.getState as jest.Mock).mockReturnValue({
        upsertMessage: mockUpsertMessage,
      })

      await speakMessageHandler(
        'execute_succeeded command submitted external observation physical state。'
      )

      const compactText =
        'コマンドは送信済みです。実際に変わったかは未確認です。目視または別センサーで確認してください。'

      expect(speakCharacter).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          message: compactText,
          displayMessage: compactText,
          sourceMessageId: expect.any(String),
          sourceTurnId: expect.any(String),
        }),
        expect.any(Function),
        expect.any(Function)
      )
      expect((window as any).__projectionVisualSpeechOutputSummaryV0).toEqual(
        expect.objectContaining({
          schema_version: 'projection_visual_speech_output_parity.v0',
          surface: 'tts_talk_message',
          source_field: 'Talk.message',
          text_length: Array.from(compactText).length,
          meaning_class: 'command_accepted_unconfirmed',
          raw_text_published: false,
          raw_audio_published: false,
          provider_payload_published: false,
          private_data_published: false,
        })
      )
    })

    it.each([
      'light_off execute_succeeded command submitted external observation physical state。',
      'light_on execute_succeeded command submitted external observation physical state。',
    ])(
      'light action response stays identical for speech bubble display and TTS: %s',
      async (actionMessage) => {
        const mockUpsertMessage = jest.fn()
        ;(settingsStore.getState as jest.Mock).mockReturnValue({
          poseConfigs: [],
        })
        ;(homeStore.getState as jest.Mock).mockReturnValue({
          upsertMessage: mockUpsertMessage,
        })

        await speakMessageHandler(actionMessage)

        const compactText =
          'コマンドは送信済みです。実際に変わったかは未確認です。目視または別センサーで確認してください。'

        expect(speakCharacter).toHaveBeenCalledWith(
          expect.any(String),
          expect.objectContaining({
            message: compactText,
            displayMessage: compactText,
            sourceMessageId: expect.any(String),
            sourceTurnId: expect.any(String),
          }),
          expect.any(Function),
          expect.any(Function)
        )
        expect((window as any).__projectionVisualSpeechOutputSummaryV0).toEqual(
          expect.objectContaining({
            surface: 'tts_talk_message',
            source_field: 'Talk.message',
            meaning_class: 'command_accepted_unconfirmed',
            text_length: Array.from(compactText).length,
            raw_text_published: false,
          })
        )
      }
    )
  })

  describe('processAIResponse', () => {
    it('AIレスポンスストリームがnullの場合、処理を終了する', async () => {
      ;(getAIChatResponseStream as jest.Mock).mockResolvedValue(null)

      await processAIResponse([])

      expect(homeStore.setState).toHaveBeenCalledWith({ chatProcessing: false })
      expect(speakCharacter).not.toHaveBeenCalled()
    })
  })
})
