import { getAIChatResponseStream } from '../../../features/chat/aiChatFactory'
import { getVercelAIChatResponseStream } from '../../../features/chat/vercelAIChat'
import { getThoughtCoreChatResponseStream } from '../../../features/chat/thoughtCoreChat'
import { getOpenAIAudioChatResponseStream } from '../../../features/chat/openAIAudioChat'
import settingsStore from '../../../features/stores/settings'
import { Message } from '../../../features/messages/messages'
import { aiServiceOptions } from '../../../components/settings/modelProvider/utils/aiServiceConfigs'

jest.mock('../../../features/chat/vercelAIChat', () => ({
  getVercelAIChatResponseStream: jest.fn(),
}))

jest.mock('../../../features/chat/thoughtCoreChat', () => ({
  getThoughtCoreChatResponseStream: jest.fn(),
}))

jest.mock('../../../features/chat/openAIAudioChat', () => ({
  getOpenAIAudioChatResponseStream: jest.fn(),
}))

jest.mock('../../../features/stores/settings', () => ({
  getState: jest.fn(),
}))

describe('aiChatFactory current provider matrix', () => {
  const vercelServices = aiServiceOptions
    .map(({ value }) => value)
    .filter((service) => service !== 'thought-core')
  const testMessages: Message[] = [
    { role: 'user', content: 'hello', timestamp: '2023-01-01T00:00:00Z' },
  ]

  const createMockStream = () =>
    new ReadableStream<string>({
      start(controller) {
        controller.enqueue('test response')
        controller.close()
      },
    })

  beforeEach(() => {
    jest.clearAllMocks()
  })

  it.each(vercelServices)(
    'routes %s through the generic Vercel dispatcher',
    async (service) => {
      const onResponseMetadata = jest.fn()
      const mockStream = createMockStream()
      ;(getVercelAIChatResponseStream as jest.Mock).mockResolvedValue(
        mockStream
      )
      ;(settingsStore.getState as jest.Mock).mockReturnValue({
        selectAIService: service,
        audioMode: false,
      })

      const result = await getAIChatResponseStream(
        testMessages,
        onResponseMetadata
      )

      expect(getVercelAIChatResponseStream).toHaveBeenCalledTimes(1)
      expect(getVercelAIChatResponseStream).toHaveBeenCalledWith(testMessages)
      expect(getThoughtCoreChatResponseStream).not.toHaveBeenCalled()
      expect(getOpenAIAudioChatResponseStream).not.toHaveBeenCalled()
      expect(onResponseMetadata).not.toHaveBeenCalled()
      expect(result).toBe(mockStream)
    }
  )

  it.each([
    ['without metadata callback', undefined],
    ['with metadata callback', jest.fn()],
  ])('routes Thought Core %s', async (_label, onResponseMetadata) => {
    const mockStream = createMockStream()
    ;(getThoughtCoreChatResponseStream as jest.Mock).mockResolvedValue(
      mockStream
    )
    ;(settingsStore.getState as jest.Mock).mockReturnValue({
      selectAIService: 'thought-core',
      audioMode: false,
      thoughtCoreUrl: 'http://127.0.0.1:18787',
      thoughtCoreSessionId: 'living-room',
    })

    const result = await getAIChatResponseStream(
      testMessages,
      onResponseMetadata
    )

    expect(getThoughtCoreChatResponseStream).toHaveBeenCalledTimes(1)
    expect(getThoughtCoreChatResponseStream).toHaveBeenCalledWith(
      testMessages,
      'http://127.0.0.1:18787',
      'living-room',
      ...(onResponseMetadata ? [onResponseMetadata] : [])
    )
    expect(getVercelAIChatResponseStream).not.toHaveBeenCalled()
    expect(getOpenAIAudioChatResponseStream).not.toHaveBeenCalled()
    expect(result).toBe(mockStream)
  })

  it('overrides generic OpenAI routing only when audio mode is enabled', async () => {
    const mockStream = createMockStream()
    ;(getOpenAIAudioChatResponseStream as jest.Mock).mockResolvedValue(
      mockStream
    )
    ;(settingsStore.getState as jest.Mock).mockReturnValue({
      selectAIService: 'openai',
      audioMode: true,
    })

    const result = await getAIChatResponseStream(testMessages)

    expect(getOpenAIAudioChatResponseStream).toHaveBeenCalledWith(testMessages)
    expect(getVercelAIChatResponseStream).not.toHaveBeenCalled()
    expect(getThoughtCoreChatResponseStream).not.toHaveBeenCalled()
    expect(result).toBe(mockStream)
  })

  it.each(['unsupported-service', 'dify'])(
    'rejects unsupported runtime value %s without dispatching',
    async (service) => {
      ;(settingsStore.getState as jest.Mock).mockReturnValue({
        selectAIService: service,
        audioMode: false,
      })

      await expect(getAIChatResponseStream(testMessages)).rejects.toThrow(
        `Unsupported AI service: ${service}`
      )
      expect(getVercelAIChatResponseStream).not.toHaveBeenCalled()
      expect(getThoughtCoreChatResponseStream).not.toHaveBeenCalled()
      expect(getOpenAIAudioChatResponseStream).not.toHaveBeenCalled()
    }
  )
})
