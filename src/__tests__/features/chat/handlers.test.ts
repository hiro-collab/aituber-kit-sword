import {
  handleSendChatFn,
  handleReceiveTextFromWsFn,
  presentAcceptedPreparedSampleAssistantResponse,
  processAIResponse,
  resolveDirectSendAssistantSpeechLink,
  speakMessageHandler,
} from '../../../features/chat/handlers'
import { getAIChatResponseStream } from '../../../features/chat/aiChatFactory'
import { speakCharacter } from '../../../features/messages/speakCharacter'
import { SpeakQueue } from '../../../features/messages/speakQueue'
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

jest.mock('../../../features/messages/speakQueue', () => ({
  SpeakQueue: { stopAll: jest.fn() },
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

  it('presents one private-route assistant bubble through configured VOICEVOX without a user message', async () => {
    let chatProcessingCount = 0
    const upsertMessage = jest.fn()
    ;(settingsStore.getState as jest.Mock).mockReturnValue({
      selectVoice: 'voicevox',
    })
    ;(homeStore.getState as jest.Mock).mockImplementation(() => ({
      chatProcessingCount,
      upsertMessage,
      incrementChatProcessingCount: () => {
        chatProcessingCount += 1
      },
      decrementChatProcessingCount: () => {
        chatProcessingCount -= 1
      },
    }))
    ;(speakCharacter as jest.Mock).mockImplementationOnce(
      (_sessionId, _talk, onStart, onComplete) => {
        onStart?.()
        onComplete?.()
      }
    )

    await presentAcceptedPreparedSampleAssistantResponse(
      {
        conversationAttemptRef:
          'm4.prepared_sample_attempt:0123456789abcdef0123456789abcdef',
        assistantSpeech: '統合された返答です。',
      },
      {
        signal: new AbortController().signal,
        deadlineMs: 75_000,
      }
    )

    expect(upsertMessage).toHaveBeenCalledTimes(2)
    expect(upsertMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({
        role: 'assistant',
        content: '統合された返答です。',
        conversationAttemptRef:
          'm4.prepared_sample_attempt:0123456789abcdef0123456789abcdef',
      })
    )
    expect(upsertMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ role: 'user' })
    )
    expect(speakCharacter).toHaveBeenCalledTimes(1)
    expect((speakCharacter as jest.Mock).mock.calls[0][1]).toEqual(
      expect.objectContaining({
        message: '統合された返答です。',
        sourceConversationAttemptRef:
          'm4.prepared_sample_attempt:0123456789abcdef0123456789abcdef',
      })
    )
  })

  it('rejects the stale 30-second presentation deadline before publishing', async () => {
    ;(settingsStore.getState as jest.Mock).mockReturnValue({
      selectVoice: 'voicevox',
    })

    await expect(
      presentAcceptedPreparedSampleAssistantResponse(
        {
          conversationAttemptRef:
            'm4.prepared_sample_attempt:0123456789abcdef0123456789abcdef',
          assistantSpeech: '公開されない返答です。',
        },
        { signal: new AbortController().signal, deadlineMs: 30_000 }
      )
    ).rejects.toThrow('accepted_prepared_sample_presentation_failed')

    expect(homeStore.setState).not.toHaveBeenCalled()
    expect(speakCharacter).not.toHaveBeenCalled()
  })

  it('aborts the route-owned presentation without late completion', async () => {
    let chatProcessingCount = 0
    const upsertMessage = jest.fn()
    ;(settingsStore.getState as jest.Mock).mockReturnValue({
      selectVoice: 'voicevox',
    })
    ;(homeStore.getState as jest.Mock).mockImplementation(() => ({
      chatProcessingCount,
      upsertMessage,
      incrementChatProcessingCount: () => {
        chatProcessingCount += 1
      },
      decrementChatProcessingCount: () => {
        chatProcessingCount -= 1
      },
    }))
    ;(speakCharacter as jest.Mock).mockImplementationOnce(
      (_sessionId, _talk, onStart) => onStart?.()
    )
    const controller = new AbortController()
    const presentation = presentAcceptedPreparedSampleAssistantResponse(
      {
        conversationAttemptRef:
          'm4.prepared_sample_attempt:0123456789abcdef0123456789abcdef',
        assistantSpeech: '中断される返答です。',
      },
      { signal: controller.signal, deadlineMs: 75_000 }
    )
    controller.abort()

    await expect(presentation).rejects.toThrow(
      'accepted_prepared_sample_presentation_failed'
    )
    expect(SpeakQueue.stopAll).toHaveBeenCalledTimes(1)
    expect(homeStore.setState).toHaveBeenCalledWith(expect.any(Function))
  })

  it.each(['punctuation_only', 'synchronous_speaker_throw'])(
    'rolls back route-owned bubble for presenter failure %s',
    async (failureClass) => {
      const upsertMessage = jest.fn()
      ;(settingsStore.getState as jest.Mock).mockReturnValue({
        selectVoice: 'voicevox',
      })
      ;(homeStore.getState as jest.Mock).mockReturnValue({
        chatProcessingCount: 0,
        upsertMessage,
        incrementChatProcessingCount: jest.fn(),
        decrementChatProcessingCount: jest.fn(),
      })
      if (failureClass === 'synchronous_speaker_throw') {
        ;(speakCharacter as jest.Mock).mockImplementationOnce(() => {
          throw new Error('PRIVATE_SPEAKER_DETAIL')
        })
      }
      await expect(
        presentAcceptedPreparedSampleAssistantResponse(
          {
            conversationAttemptRef:
              'm4.prepared_sample_attempt:0123456789abcdef0123456789abcdef',
            assistantSpeech:
              failureClass === 'punctuation_only' ? '!!!' : '通常の返答です。',
          },
          {
            signal: new AbortController().signal,
            deadlineMs: 75_000,
          }
        )
      ).rejects.toThrow('accepted_prepared_sample_presentation_failed')
      expect(SpeakQueue.stopAll).toHaveBeenCalledTimes(1)
      const rollbackCall = (homeStore.setState as jest.Mock).mock.calls.find(
        ([value]) => typeof value === 'function'
      )
      expect(rollbackCall).toBeDefined()
      const rolledBack = rollbackCall[0]({
        chatLog: [
          { id: 'unrelated', role: 'assistant', content: 'keep' },
          {
            id: upsertMessage.mock.calls[0][0].id,
            role: 'assistant',
            content: 'remove',
          },
        ],
      })
      expect(rolledBack.chatLog).toEqual([
        { id: 'unrelated', role: 'assistant', content: 'keep' },
      ])
    }
  )

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
        ]),
        expect.any(Function)
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
    it('preserves validated Thought Core response identity for bubble and TTS', async () => {
      const mockUpsertMessage = jest.fn()
      ;(settingsStore.getState as jest.Mock).mockReturnValue({
        poseConfigs: [],
      })
      ;(homeStore.getState as jest.Mock).mockReturnValue({
        upsertMessage: mockUpsertMessage,
      })

      await speakMessageHandler('一文目です。二文目です。', {
        turnId: 'turn-live-1',
        messageId: 'evt-live-1',
        responseSource: 'thought_core_assistant_message',
      })

      expect(mockUpsertMessage).toHaveBeenLastCalledWith(
        expect.objectContaining({
          id: 'evt-live-1',
          role: 'assistant',
          content: '一文目です。 二文目です。',
          turnId: 'turn-live-1',
        })
      )
      expect(speakCharacter).toHaveBeenCalledTimes(2)
      for (const expectedText of ['一文目です。', '二文目です。']) {
        expect(speakCharacter).toHaveBeenCalledWith(
          expect.any(String),
          expect.objectContaining({
            sourceMessageId: 'evt-live-1',
            sourceTurnId: 'turn-live-1',
            displayMessage: expectedText,
          }),
          expect.any(Function),
          expect.any(Function)
        )
      }
      const assistantUpserts = mockUpsertMessage.mock.calls
        .map(([message]) => message)
        .filter((message) => message.role === 'assistant')
      expect(assistantUpserts.length).toBeGreaterThan(1)
      expect(
        assistantUpserts.every(
          (message) =>
            message.id === 'evt-live-1' && message.turnId === 'turn-live-1'
        )
      ).toBe(true)
      expect((window as any).__projectionVisualSpeechOutputSummaryV0).toEqual(
        expect.objectContaining({
          message_id: 'evt-live-1',
          turn_id: 'turn-live-1',
          raw_text_published: false,
          private_data_published: false,
        })
      )
    })

    it('does not accept caller-shaped direct-send correlation authority', () => {
      expect(
        resolveDirectSendAssistantSpeechLink({
          turnId: 'turn-live-1',
          messageId: 'evt-live-1',
          responseSource: 'caller_claim',
        })
      ).toEqual({})
      expect(
        resolveDirectSendAssistantSpeechLink({
          turnId: 'private/raw',
          messageId: 'evt-live-1',
          responseSource: 'thought_core_assistant_message',
        })
      ).toEqual({})
    })

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

    it('associates the response attempt ref with the canonical assistant message and Talk', async () => {
      const mockUpsertMessage = jest.fn()
      const stream = new ReadableStream<string>({
        start(controller) {
          controller.enqueue('応答します。')
          controller.close()
        },
      })
      ;(settingsStore.getState as jest.Mock).mockReturnValue({
        thinkingPoseEnabled: false,
        modelType: 'live2d',
      })
      ;(homeStore.getState as jest.Mock).mockReturnValue({
        upsertMessage: mockUpsertMessage,
        viewer: {},
      })
      ;(getAIChatResponseStream as jest.Mock).mockImplementation(
        async (_messages, onResponseMetadata) => {
          onResponseMetadata?.({
            conversationAttemptRef:
              'm4.prepared_sample_attempt:0123456789abcdef0123456789abcdef',
          })
          return stream
        }
      )

      await processAIResponse([{ role: 'user', content: 'こんにちは' }])

      expect(mockUpsertMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          role: 'assistant',
          content: '応答します。',
          conversationAttemptRef:
            'm4.prepared_sample_attempt:0123456789abcdef0123456789abcdef',
        })
      )
      expect(speakCharacter).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          sourceConversationAttemptRef:
            'm4.prepared_sample_attempt:0123456789abcdef0123456789abcdef',
        }),
        expect.any(Function),
        expect.any(Function)
      )
    })

    it('stores one canonical tuple before one display acknowledgement across buffered chunks and shares one TTS state', async () => {
      const originalFetch = global.fetch
      const originalEnabled =
        process.env.NEXT_PUBLIC_THOUGHT_CORE_CLOSED_LOOP_FEEDBACK_V1_ENABLED
      process.env.NEXT_PUBLIC_THOUGHT_CORE_CLOSED_LOOP_FEEDBACK_V1_ENABLED = '1'
      global.fetch = jest.fn(async () => ({
        ok: true,
        json: async () => ({ ok: true, event_id: 'evt_display_ack' }),
      })) as unknown as typeof fetch
      let chatLog: Array<Record<string, unknown>> = []
      const mockUpsertMessage = jest.fn((message: Record<string, unknown>) => {
        const index = chatLog.findIndex((item) => item.id === message.id)
        if (index >= 0) {
          chatLog[index] = { ...chatLog[index], ...message }
        } else {
          chatLog.push({
            id: message.id,
            role: message.role,
            content: message.content,
          })
        }
      })
      const stream = new ReadableStream<string>({
        start(controller) {
          controller.enqueue('閉ループ応答です。')
          controller.enqueue('続きです。')
          controller.close()
        },
      })
      ;(settingsStore.getState as jest.Mock).mockReturnValue({
        thinkingPoseEnabled: false,
        modelType: 'live2d',
      })
      ;(homeStore.getState as jest.Mock).mockImplementation(() => ({
        upsertMessage: mockUpsertMessage,
        viewer: {},
        chatLog,
      }))
      ;(getAIChatResponseStream as jest.Mock).mockImplementation(
        async (_messages, onResponseMetadata) => {
          onResponseMetadata?.({
            sessionId: 'session_canonical_001',
            turnId: 'turn_canonical_001',
            assistantMessageId: 'msg_canonical_001',
            displayBarrier: {
              sessionId: 'session_canonical_001',
              turnId: 'turn_canonical_001',
              assistantMessageId: 'msg_canonical_001',
              channel: 'display',
              component: 'aituber_message_store',
              sendEventId: 'evt_display_send',
            },
          })
          onResponseMetadata?.({
            sessionId: 'session_canonical_001',
            turnId: 'turn_canonical_001',
            assistantMessageId: 'msg_canonical_001',
          })
          return stream
        }
      )

      try {
        await processAIResponse([{ role: 'user', content: 'こんにちは' }])
        expect(global.fetch).toHaveBeenCalledTimes(1)
        expect(chatLog[0]).toEqual(
          expect.objectContaining({
            id: 'msg_canonical_001',
            role: 'assistant',
            content: '閉ループ応答です。続きです。',
            sessionId: 'session_canonical_001',
            turnId: 'turn_canonical_001',
          })
        )
        expect(speakCharacter).toHaveBeenCalledTimes(2)
        expect(speakCharacter).toHaveBeenCalledWith(
          expect.any(String),
          expect.objectContaining({
            sourceMessageId: 'msg_canonical_001',
            sourceSessionId: 'session_canonical_001',
            sourceTurnId: 'turn_canonical_001',
          }),
          expect.any(Function),
          expect.any(Function)
        )
        const firstTtsState = (speakCharacter as jest.Mock).mock.calls[0][1]
          .closedLoopTtsFeedbackState
        const secondTtsState = (speakCharacter as jest.Mock).mock.calls[1][1]
          .closedLoopTtsFeedbackState
        expect(firstTtsState).toBeDefined()
        expect(secondTtsState).toBe(firstTtsState)
      } finally {
        global.fetch = originalFetch
        if (originalEnabled === undefined) {
          delete process.env
            .NEXT_PUBLIC_THOUGHT_CORE_CLOSED_LOOP_FEEDBACK_V1_ENABLED
        } else {
          process.env.NEXT_PUBLIC_THOUGHT_CORE_CLOSED_LOOP_FEEDBACK_V1_ENABLED =
            originalEnabled
        }
      }
    })

    it.each([
      ['sessionId', 'session_changed_002'],
      ['turnId', 'turn_changed_002'],
      ['assistantMessageId', 'msg_changed_002'],
    ] as const)(
      'rejects a buffered metadata item whose canonical %s changes before appending it',
      async (changedField, changedValue) => {
        const originalFetch = global.fetch
        const originalEnabled =
          process.env.NEXT_PUBLIC_THOUGHT_CORE_CLOSED_LOOP_FEEDBACK_V1_ENABLED
        process.env.NEXT_PUBLIC_THOUGHT_CORE_CLOSED_LOOP_FEEDBACK_V1_ENABLED =
          '1'
        global.fetch = jest.fn(async () => ({
          ok: true,
          json: async () => ({ ok: true, event_id: 'evt_display_ack' }),
        })) as unknown as typeof fetch
        let chatLog: Array<Record<string, unknown>> = []
        const mockUpsertMessage = jest.fn(
          (message: Record<string, unknown>) => {
            const index = chatLog.findIndex((item) => item.id === message.id)
            if (index >= 0) {
              chatLog[index] = { ...chatLog[index], ...message }
            } else {
              chatLog.push({ ...message })
            }
          }
        )
        const stream = new ReadableStream<string>({
          start(controller) {
            controller.enqueue('最初です。')
            controller.enqueue('追加してはいけません。')
            controller.close()
          },
        })
        ;(settingsStore.getState as jest.Mock).mockReturnValue({
          thinkingPoseEnabled: false,
          modelType: 'live2d',
        })
        ;(homeStore.getState as jest.Mock).mockImplementation(() => ({
          upsertMessage: mockUpsertMessage,
          viewer: {},
          chatLog,
        }))
        ;(getAIChatResponseStream as jest.Mock).mockImplementation(
          async (_messages, onResponseMetadata) => {
            onResponseMetadata?.({
              sessionId: 'session_canonical_001',
              turnId: 'turn_canonical_001',
              assistantMessageId: 'msg_canonical_001',
              displayBarrier: {
                sessionId: 'session_canonical_001',
                turnId: 'turn_canonical_001',
                assistantMessageId: 'msg_canonical_001',
                channel: 'display',
                component: 'aituber_message_store',
                sendEventId: 'evt_display_send',
              },
            })
            onResponseMetadata?.({
              sessionId:
                changedField === 'sessionId'
                  ? changedValue
                  : 'session_canonical_001',
              turnId:
                changedField === 'turnId' ? changedValue : 'turn_canonical_001',
              assistantMessageId:
                changedField === 'assistantMessageId'
                  ? changedValue
                  : 'msg_canonical_001',
            })
            return stream
          }
        )

        try {
          await processAIResponse([{ role: 'user', content: 'こんにちは' }])
          const assistant = chatLog.find(
            (message) => message.id === 'msg_canonical_001'
          )
          expect(assistant?.content).toBe('最初です。')
          expect(global.fetch).toHaveBeenCalledTimes(1)
          expect(speakCharacter).toHaveBeenCalledTimes(1)
        } finally {
          global.fetch = originalFetch
          if (originalEnabled === undefined) {
            delete process.env
              .NEXT_PUBLIC_THOUGHT_CORE_CLOSED_LOOP_FEEDBACK_V1_ENABLED
          } else {
            process.env.NEXT_PUBLIC_THOUGHT_CORE_CLOSED_LOOP_FEEDBACK_V1_ENABLED =
              originalEnabled
          }
        }
      }
    )
  })
})
