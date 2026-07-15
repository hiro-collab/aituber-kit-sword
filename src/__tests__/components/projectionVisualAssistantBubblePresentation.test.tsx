import { act, cleanup, render, screen } from '@testing-library/react'

import { ProjectionVisualAssistantBubble } from '@/components/projectionVisualAssistantBubble'
import {
  DEFAULT_SPEECH_BUBBLE_PRESENTATION,
  type SpeechBubblePresentationSettings,
} from '@/features/projectionVisualBubble/presentation'
import homeStore from '@/features/stores/home'
import settingsStore from '@/features/stores/settings'

const setAssistantMessage = (content: string, id = 'bubble-test-message') => {
  homeStore.setState({
    chatLog: [
      {
        id,
        role: 'assistant',
        content,
      },
    ] as never,
  })
}

describe('ProjectionVisualAssistantBubble presentation', () => {
  const originalFetch = global.fetch
  const originalResizeObserver = global.ResizeObserver
  const originalPresentation = settingsStore.getState().speechBubblePresentation
  const originalChatLog = homeStore.getState().chatLog
  const originalIsSpeaking = homeStore.getState().isSpeaking

  beforeAll(() => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    }) as unknown as typeof fetch
  })

  afterAll(() => {
    global.fetch = originalFetch
  })

  beforeEach(() => {
    jest.useFakeTimers()
    global.ResizeObserver = class ResizeObserverMock {
      static instances: ResizeObserverMock[] = []
      callback: ResizeObserverCallback
      disconnect = jest.fn()
      observe = jest.fn()
      unobserve = jest.fn()

      constructor(callback: ResizeObserverCallback) {
        this.callback = callback
        ResizeObserverMock.instances.push(this)
      }
    } as unknown as typeof ResizeObserver
    settingsStore.setState({
      speechBubblePresentation: { ...DEFAULT_SPEECH_BUBBLE_PRESENTATION },
    })
    homeStore.setState({ isSpeaking: false })
    setAssistantMessage('読みやすい吹き出しです。')
  })

  afterEach(() => {
    cleanup()
    jest.useRealTimers()
    global.ResizeObserver = originalResizeObserver
    settingsStore.setState({ speechBubblePresentation: originalPresentation })
    homeStore.setState({
      chatLog: originalChatLog,
      isSpeaking: originalIsSpeaking,
    })
    jest.restoreAllMocks()
  })

  const usePresentation = (
    patch: Partial<SpeechBubblePresentationSettings>
  ) => {
    settingsStore.setState({
      speechBubblePresentation: {
        ...DEFAULT_SPEECH_BUBBLE_PRESENTATION,
        ...patch,
      },
    })
  }

  it('realizes only typed geometry and exposes safe-area and tail state', () => {
    usePresentation({
      fontSizePx: 30,
      lineHeight: 1.6,
      widthMode: 'fixed',
      widthPercent: 50,
      positionX: 0,
      positionY: 0,
      tailSide: 'left',
    })

    render(<ProjectionVisualAssistantBubble />)
    const bubble = screen.getByLabelText('アシスタントの会話内容')

    expect(bubble).toHaveAttribute('data-tail-side', 'left')
    expect(bubble).toHaveAttribute('data-safe-area-clamped', 'true')
    expect(bubble.getAttribute('style')).toContain('width: min(50vw')
    expect(bubble.getAttribute('style')).toContain(
      '--speech-bubble-font-size: 30px'
    )
    expect(bubble.querySelector('.td-assistant-bubble-tail')).not.toBeNull()
  })

  it('uses one fixed timer, then resets visibility for a rapid replacement', () => {
    usePresentation({
      timingMode: 'fixed-duration',
      minVisibleMs: 1000,
      fixedDurationMs: 1000,
    })
    render(<ProjectionVisualAssistantBubble />)

    act(() => jest.advanceTimersByTime(1000))
    expect(
      screen.queryByLabelText('アシスタントの会話内容')
    ).not.toBeInTheDocument()

    act(() => setAssistantMessage('次の発話です。', 'replacement-message'))
    expect(screen.getByLabelText('アシスタントの会話内容')).toHaveTextContent(
      '次の発話です。'
    )
  })

  it('keeps speech-synchronized text while active and applies one readable post-speech guard', () => {
    usePresentation({
      timingMode: 'speech-synchronized',
      minVisibleMs: 1000,
      postSpeechHoldMs: 2000,
    })
    homeStore.setState({ isSpeaking: true })
    render(<ProjectionVisualAssistantBubble />)

    act(() => jest.advanceTimersByTime(3000))
    expect(screen.getByLabelText('アシスタントの会話内容')).toBeInTheDocument()

    act(() => homeStore.setState({ isSpeaking: false }))
    act(() => jest.advanceTimersByTime(1999))
    expect(screen.getByLabelText('アシスタントの会話内容')).toBeInTheDocument()
    act(() => jest.advanceTimersByTime(1))
    expect(
      screen.queryByLabelText('アシスタントの会話内容')
    ).not.toBeInTheDocument()
  })

  it('mounts and cleans up an empty message without stale pagination setters', () => {
    setAssistantMessage('')
    expect(() => render(<ProjectionVisualAssistantBubble />)).not.toThrow()
    expect(
      screen.queryByLabelText('アシスタントの会話内容')
    ).not.toBeInTheDocument()
  })

  it.each([
    ['width', { widthPercent: 20 }],
    ['font size', { fontSizePx: 36 }],
    ['line height', { lineHeight: 2 }],
  ] as const)('repaginates when %s changes by itself', (_label, patch) => {
    setAssistantMessage('長い文章です。'.repeat(30))
    jest
      .spyOn(HTMLElement.prototype, 'scrollHeight', 'get')
      .mockImplementation(function (this: HTMLElement) {
        const presentation = settingsStore.getState().speechBubblePresentation
        const capacity = Math.max(
          8,
          Math.floor(
            (presentation.widthPercent * 120) /
              (presentation.fontSizePx * presentation.lineHeight)
          )
        )
        return Array.from(this.textContent ?? '').length <= capacity ? 20 : 1000
      })
    render(<ProjectionVisualAssistantBubble />)
    const readVisibleText = () =>
      screen
        .getByLabelText('アシスタントの会話内容')
        .querySelector(
          ':scope > .td-assistant-bubble-text:not(.td-assistant-bubble-text-measure)'
        )?.textContent ?? ''
    const initialText = readVisibleText()

    act(() => {
      usePresentation(patch)
    })

    const changedText = readVisibleText()
    expect(changedText).not.toEqual(initialText)
    expect(Array.from(changedText).length).toBeLessThan(
      Array.from(initialText).length
    )
  })

  it('allows one-line pages when a fixed bubble height cannot fit two lines', () => {
    setAssistantMessage('狭い高さでも内容を隠さず分割する文章です。'.repeat(4))
    usePresentation({
      heightMode: 'fixed',
      heightPercent: 18,
      fontSizePx: 36,
      lineHeight: 2,
    })
    jest
      .spyOn(HTMLElement.prototype, 'scrollHeight', 'get')
      .mockImplementation(function (this: HTMLElement) {
        return Array.from(this.textContent ?? '').length <= 4 ? 70 : 140
      })

    render(<ProjectionVisualAssistantBubble />)

    const bubble = screen.getByLabelText('アシスタントの会話内容')
    const visibleText =
      bubble.querySelector(
        ':scope > .td-assistant-bubble-text:not(.td-assistant-bubble-text-measure)'
      )?.textContent ?? ''
    expect(Array.from(visibleText).length).toBeLessThanOrEqual(4)
    expect(Number(bubble.getAttribute('data-page-count'))).toBeGreaterThan(1)
  })

  it('disconnects pagination and geometry observers when the bubble hides', () => {
    const removeEventListener = jest.spyOn(window, 'removeEventListener')
    usePresentation({
      timingMode: 'fixed-duration',
      minVisibleMs: 1000,
      fixedDurationMs: 1000,
    })
    render(<ProjectionVisualAssistantBubble />)

    act(() => jest.advanceTimersByTime(1000))

    const observerClass = global.ResizeObserver as unknown as {
      instances: Array<{ disconnect: jest.Mock }>
    }
    expect(observerClass.instances.length).toBeGreaterThanOrEqual(2)
    expect(
      observerClass.instances.filter(
        (instance) => instance.disconnect.mock.calls.length > 0
      ).length
    ).toBeGreaterThanOrEqual(2)
    expect(
      removeEventListener.mock.calls.filter(([type]) => type === 'resize')
        .length
    ).toBeGreaterThanOrEqual(2)
  })

  it('treats a partial-to-final text update as one deterministic replacement', () => {
    usePresentation({
      timingMode: 'fixed-duration',
      minVisibleMs: 1000,
      fixedDurationMs: 1000,
    })
    setAssistantMessage('途中', 'stream-message')
    render(<ProjectionVisualAssistantBubble />)

    act(() => jest.advanceTimersByTime(700))
    act(() => setAssistantMessage('途中から確定文へ', 'stream-message'))
    act(() => jest.advanceTimersByTime(500))
    expect(screen.getByLabelText('アシスタントの会話内容')).toHaveTextContent(
      '途中から確定文へ'
    )
    act(() => jest.advanceTimersByTime(500))
    expect(
      screen.queryByLabelText('アシスタントの会話内容')
    ).not.toBeInTheDocument()
  })
})
