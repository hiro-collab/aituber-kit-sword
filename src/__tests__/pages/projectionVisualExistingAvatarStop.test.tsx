import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { Form } from '@/components/form'

type QueryState = {
  isPassiveMode: boolean
  isStageOutputMode: boolean
  isDisplayOnlyMode: boolean
  projectionVisualMode: 'operator' | 'passive' | 'stage-output'
  projectionVisualTestMode: undefined
  motionStimulusAssetPath: undefined
  projectionVisualStimulusRef: undefined
  shouldReceiveDisplayState: boolean
  shouldRenderHud: boolean
}

const operatorState: QueryState = {
  isPassiveMode: false,
  isStageOutputMode: false,
  isDisplayOnlyMode: false,
  projectionVisualMode: 'operator',
  projectionVisualTestMode: undefined,
  motionStimulusAssetPath: undefined,
  projectionVisualStimulusRef: undefined,
  shouldReceiveDisplayState: false,
  shouldRenderHud: true,
}

const passiveState: QueryState = {
  ...operatorState,
  isPassiveMode: true,
  isDisplayOnlyMode: true,
  projectionVisualMode: 'passive',
  shouldRenderHud: false,
}

const stageState: QueryState = {
  ...passiveState,
  isPassiveMode: false,
  isStageOutputMode: true,
  projectionVisualMode: 'stage-output',
  shouldReceiveDisplayState: true,
}

let mockQueryState = operatorState
let mockIsOwner = true
let mockCapturedInputProps:
  | {
      onChatProcessStart: (text: string) => void
      onStopRequested?: () => void
    }
  | undefined
let mockCapturedMessageInputProps: { onClickStopButton: () => void } | undefined
const mockDefaultSend = jest.fn()
const mockSpeechStop = jest.fn()

jest.mock('next/router', () => ({
  useRouter: () => ({ isReady: true, query: {}, asPath: '/projection-visual' }),
}))
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (value: string) => value }),
}))
jest.mock('@/features/stores/home', () => {
  const state = {
    modalImage: null,
    webcamStatus: false,
    captureStatus: false,
    chatProcessingCount: 0,
    isSpeaking: false,
    chatProcessing: false,
    viewer: { model: null },
  }
  const store = (selector: (value: typeof state) => unknown) => selector(state)
  store.setState = jest.fn()
  store.getState = () => state
  return { __esModule: true, default: store }
})
jest.mock('@/features/stores/settings', () => {
  const state = {
    slideMode: false,
    multiModalMode: 'never',
    selectAIService: 'thought-core',
    selectAIModel: '',
    enableMultiModal: false,
    customModel: '',
    messageReceiverEnabled: false,
    modelType: 'vrm',
    characterPreset1: '',
    characterPreset2: '',
    characterPreset3: '',
    characterPreset4: '',
    characterPreset5: '',
    projectionEffects: undefined,
    continuousMicListeningMode: false,
    speechRecognitionMode: 'browser',
    whisperTranscriptionModel: 'whisper-1',
    realtimeAPIMode: false,
    poseConfigs: [],
    listeningPoseEnabled: false,
    listeningPoseId: '',
  }
  const store = (selector: (value: typeof state) => unknown) => selector(state)
  store.setState = jest.fn()
  store.getState = () => state
  return { __esModule: true, default: store }
})
jest.mock('@/features/stores/menu', () => {
  const state = { slideVisible: false }
  return {
    __esModule: true,
    default: (selector: (value: typeof state) => unknown) => selector(state),
  }
})
jest.mock('@/features/stores/slide', () => {
  const state = { isPlaying: false }
  return {
    __esModule: true,
    default: (selector: (value: typeof state) => unknown) => selector(state),
  }
})
jest.mock('@/features/stores/toast', () => ({
  __esModule: true,
  default: { getState: () => ({ addToast: jest.fn() }) },
}))
jest.mock('@/features/stores/projectionDisplay', () => ({
  __esModule: true,
  default: (selector: (value: { speechOutputActive: boolean }) => unknown) =>
    selector({ speechOutputActive: false }),
}))
jest.mock('@/features/chat/handlers', () => ({
  handleSendChatFn: () => mockDefaultSend,
  presentAcceptedPreparedSampleAssistantResponse: jest.fn(),
}))
jest.mock('@/features/constants/aiModels', () => ({
  isMultiModalAvailable: () => false,
}))
jest.mock('@/features/presets/usePresetLoader', () => ({
  usePresetLoader: jest.fn(),
}))
jest.mock('@/hooks/useLive2DEnabled', () => ({
  useLive2DEnabled: () => ({ isLive2DEnabled: false }),
}))
jest.mock('@/features/browserControl/useBrowserControlOwner', () => ({
  useBrowserControlOwner: () => ({
    isOwner: mockIsOwner,
    owner: mockIsOwner ? { label: 'Projection Visual' } : { label: 'Other' },
    takeControl: jest.fn(),
  }),
}))
jest.mock('@/utils/projectionVisualQuery', () => ({
  PROJECTION_VISUAL_PRESENTATION_ORDER: [
    'background-input',
    'avatar',
    'effects',
    'speech-hud',
  ],
  readProjectionVisualQueryFromPath: () => ({}),
  resolveProjectionVisualQueryState: () => mockQueryState,
}))
jest.mock('@/components/messageInputContainer', () => ({
  MessageInputContainer: (props: {
    onChatProcessStart: (text: string) => void
    onStopRequested?: () => void
  }) => {
    mockCapturedInputProps = props
    return (
      <div data-testid="mock-message-input-container">
        <button
          type="button"
          onClick={() => props.onChatProcessStart('owner text')}
        >
          Mock Send
        </button>
        <button type="button" onClick={() => props.onStopRequested?.()}>
          Mock Stop
        </button>
      </div>
    )
  },
}))
jest.mock('@/components/messageInput', () => ({
  MessageInput: (props: { onClickStopButton: () => void }) => {
    mockCapturedMessageInputProps = props
    return <div data-testid="real-container-message-input" />
  },
}))
jest.mock('@/hooks/useVoiceRecognition', () => ({
  useVoiceRecognition: () => ({
    userMessage: '',
    isListening: false,
    silenceTimeoutRemaining: 0,
    handleInputChange: jest.fn(),
    handleSendMessage: jest.fn(),
    toggleListening: jest.fn(),
    handleStopSpeaking: mockSpeechStop,
    startListening: jest.fn(),
    stopListening: jest.fn(),
    checkRecognitionActive: () => false,
  }),
}))
jest.mock('@/features/gestureVoice/gestureVoiceControls', () => ({
  registerGestureVoiceControls: () => () => undefined,
}))
jest.mock('@/features/gestureVoice/listeningPoseDiagnostic', () => ({
  publishProjectionVisualListeningPoseDiagnostic: jest.fn(),
}))
jest.mock('@/components/presetQuestionButtons', () => ({
  PresetQuestionButtons: () => null,
}))
jest.mock('@/components/slideText', () => ({ SlideText: () => null }))
jest.mock('@/components/meta', () => ({ Meta: () => null }))
jest.mock('@/components/messageReceiver', () => ({
  __esModule: true,
  default: () => null,
}))
jest.mock('@/components/modalImage', () => ({
  __esModule: true,
  default: () => null,
}))
jest.mock('@/components/vrmViewer', () => ({
  __esModule: true,
  default: () => <div data-testid="existing-avatar" />,
}))
jest.mock('@/components/live2DViewer', () => ({
  __esModule: true,
  default: () => null,
}))
jest.mock('@/components/pngTuberViewer', () => ({
  __esModule: true,
  default: () => null,
}))
jest.mock('@/components/toasts', () => ({ Toasts: () => null }))
jest.mock('@/components/websocketManager', () => ({
  WebSocketManager: () => null,
}))
jest.mock('@/components/characterPresetMenu', () => ({
  __esModule: true,
  default: () => null,
}))
jest.mock('@/components/ImageOverlay', () => ({
  __esModule: true,
  default: () => null,
}))
jest.mock('@/components/presenceManager', () => ({
  __esModule: true,
  default: () => null,
}))
jest.mock('@/components/gestureVoiceBridge', () => ({
  __esModule: true,
  default: () => null,
}))
jest.mock('@/features/kiosk/kioskOverlay', () => ({ KioskOverlay: () => null }))
jest.mock('@/components/youtubeManager', () => ({ YoutubeManager: () => null }))
jest.mock('@/components/memoryServiceInitializer', () => ({
  MemoryServiceInitializer: () => null,
}))
jest.mock('@/components/projectionVisualHud', () => ({
  ProjectionVisualHud: () => <div data-testid="existing-hud" />,
}))
jest.mock('@/components/projectionVisualDisplayStateBridge', () => ({
  ProjectionVisualDisplayStateBridge: () => null,
}))
jest.mock('@/components/projectionVisualCalibrationPanel', () => ({
  ProjectionVisualCalibrationPanel: () => null,
}))
jest.mock('@/components/browserControlNotice', () => ({
  BrowserControlNotice: () => <div data-testid="control-notice" />,
}))
jest.mock('@/components/projectionVisualAssistantBubble', () => ({
  ProjectionVisualAssistantBubble: ({ variant }: { variant: string }) => (
    <div data-testid="normal-assistant-bubble" data-variant={variant} />
  ),
}))
jest.mock('@/features/motionRuntime/projectionVisualStimulusRefBridge', () => ({
  ProjectionVisualStimulusRefBridge: () => null,
}))
jest.mock('@/features/chat/thoughtCoreChat', () => ({
  registerAcceptedPreparedSamplePresentationOwner: () => ({
    openOperator: () => false,
    dispose: jest.fn(),
  }),
  requestAcceptedPreparedSamplePresentation: jest.fn(),
}))
jest.mock(
  '@/features/projectionEffects/browser/fluidFireRelayCanvasLayer',
  () => ({
    resolveProjectionEffectSelection: () => null,
  })
)
jest.mock(
  '@/features/projectionEffects/browser/avatarFireThunderLabOverlay',
  () => ({
    AvatarFireThunderEffectLayer: () => (
      <div data-testid="existing-effect-layer" />
    ),
  })
)
jest.mock('@/features/projectionEffects/settings', () => ({
  resolveProjectionEffectsSettings: () => ({ selectedEffect: 'none' }),
}))
jest.mock('@/features/projectionDisplay/captureSourceHandle', () => ({
  createProjectionStageCaptureHandleSession: () => ({ id: 'capture' }),
  registerProjectionStageCaptureHandle: () => ({
    status: 'inactive',
    dispose: () => 'inactive',
  }),
}))
jest.mock('@/lib/i18n', () => ({}))

import ProjectionVisual from '@/pages/projection-visual'

const deferred = <T,>() => {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

const validResponse = (
  init: RequestInit | undefined,
  id: string,
  text: string
) => {
  const request = JSON.parse(String(init?.body))
  return {
    ok: true,
    json: async () => ({
      sessionId: request.sessionId,
      turnId: request.turnId,
      assistantMessageId: id,
      response: text,
    }),
  } as Response
}

describe('ProjectionVisual existing-avatar transient Stop integration', () => {
  const originalFetch = global.fetch

  beforeEach(() => {
    mockQueryState = operatorState
    mockIsOwner = true
    mockCapturedInputProps = undefined
    mockCapturedMessageInputProps = undefined
    jest.clearAllMocks()
  })

  afterEach(() => {
    global.fetch = originalFetch
    jest.restoreAllMocks()
  })

  it('keeps the existing avatar, Form, and speech HUD while rendering exactly one validated strict response', async () => {
    global.fetch = jest.fn(async (_url, init) =>
      validResponse(init, 'assistant_owner_001', 'owner-specific response')
    ) as typeof fetch

    const { container } = render(<ProjectionVisual />)
    fireEvent.click(await screen.findByRole('button', { name: 'Mock Send' }))
    await screen.findByText('owner-specific response')

    expect(screen.getByTestId('existing-avatar')).toBeInTheDocument()
    expect(
      screen.getByTestId('mock-message-input-container')
    ).toBeInTheDocument()
    expect(
      screen.getByTestId('projection-visual-speech-hud-layer')
    ).toBeInTheDocument()
    expect(screen.getByTestId('existing-hud')).toBeInTheDocument()
    expect(screen.queryByTestId('normal-assistant-bubble')).toBeNull()
    expect(screen.getAllByLabelText('アシスタントの会話内容')).toHaveLength(1)
    expect(global.fetch).toHaveBeenCalledTimes(1)
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0]
    const body = JSON.parse(init.body)
    expect(url).toBe('/api/thoughtCoreChat/')
    expect(init.method).toBe('POST')
    expect(init.headers).toEqual({
      'Content-Type': 'application/json',
      'X-Sword-AIT-Request-Mode': 'minimal-transient-text-v1',
    })
    expect(init.signal).toBeInstanceOf(AbortSignal)
    expect(Object.keys(body).sort()).toEqual(['query', 'sessionId', 'turnId'])
    expect(body.query).toBe('owner text')
    expect(body.sessionId).toMatch(/^ait_session_/)
    expect(body.turnId).toMatch(/^ait_turn_/)
    expect(
      container.querySelectorAll('[data-assistant-message-id]')
    ).toHaveLength(1)
  })

  it.each([
    ['passive', passiveState, true],
    ['stage-output', stageState, true],
    ['non-owner operator', operatorState, false],
  ])('does not own transient requests in %s mode', (_label, state, isOwner) => {
    mockQueryState = state
    mockIsOwner = isOwner
    global.fetch = jest.fn() as typeof fetch

    render(<ProjectionVisual />)

    expect(screen.getByTestId('existing-avatar')).toBeInTheDocument()
    expect(screen.getByTestId('normal-assistant-bubble')).toHaveAttribute(
      'data-variant',
      state.projectionVisualMode === 'stage-output'
        ? 'stage-output'
        : state.projectionVisualMode === 'passive'
          ? 'passive'
          : 'operator'
    )
    expect(screen.queryByLabelText('アシスタントの会話内容')).toBeNull()
    expect(global.fetch).not.toHaveBeenCalled()
    if (state.isDisplayOnlyMode) {
      expect(screen.queryByTestId('mock-message-input-container')).toBeNull()
    } else {
      expect(screen.getByTestId('control-notice')).toBeInTheDocument()
    }
  })

  it('dedupes an active submit, fences its late completion, and isolates a fresh second turn', async () => {
    const first = deferred<Response>()
    const second = deferred<Response>()
    const abort = jest.spyOn(AbortController.prototype, 'abort')
    global.fetch = jest
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise) as typeof fetch
    const { container } = render(<ProjectionVisual />)

    fireEvent.click(screen.getByRole('button', { name: 'Mock Send' }))
    fireEvent.click(screen.getByRole('button', { name: 'Mock Send' }))
    expect(global.fetch).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Mock Stop' }))
    fireEvent.click(screen.getByRole('button', { name: 'Mock Stop' }))
    expect(abort).toHaveBeenCalledTimes(1)
    expect(container.firstElementChild).toHaveAttribute(
      'data-presentation-cleanup',
      'presentation_cleanup_complete'
    )

    fireEvent.click(screen.getByRole('button', { name: 'Mock Send' }))
    expect(global.fetch).toHaveBeenCalledTimes(2)
    const firstInit = (global.fetch as jest.Mock).mock.calls[0][1]
    const secondInit = (global.fetch as jest.Mock).mock.calls[1][1]
    const firstBody = JSON.parse(firstInit.body)
    const secondBody = JSON.parse(secondInit.body)
    expect(secondBody.sessionId).not.toBe(firstBody.sessionId)
    expect(secondBody.turnId).not.toBe(firstBody.turnId)

    await act(async () =>
      second.resolve(
        validResponse(secondInit, 'assistant_turn_002', 'second turn')
      )
    )
    expect(await screen.findByText('second turn')).toBeInTheDocument()
    await act(async () =>
      first.resolve(
        validResponse(firstInit, 'assistant_late_001', 'late first')
      )
    )
    expect(screen.queryByText('late first')).toBeNull()
    expect(screen.getByText('second turn')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('fences fetch-complete/json-pending and late rejection after Stop', async () => {
    const json = deferred<Record<string, string>>()
    const lateReject = deferred<Response>()
    const abort = jest.spyOn(AbortController.prototype, 'abort')
    global.fetch = jest
      .fn()
      .mockImplementationOnce(async (_url, init) => {
        const body = JSON.parse(String(init?.body))
        return {
          ok: true,
          json: jest.fn(() => json.promise),
          body,
        } as unknown as Response
      })
      .mockReturnValueOnce(lateReject.promise) as typeof fetch
    const { container } = render(<ProjectionVisual />)

    fireEvent.click(screen.getByRole('button', { name: 'Mock Send' }))
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1))
    const firstBody = JSON.parse(
      (global.fetch as jest.Mock).mock.calls[0][1].body
    )
    fireEvent.click(screen.getByRole('button', { name: 'Mock Stop' }))
    await act(async () =>
      json.resolve({
        sessionId: firstBody.sessionId,
        turnId: firstBody.turnId,
        assistantMessageId: 'assistant_json_late',
        response: 'late json',
      })
    )
    expect(screen.queryByText('late json')).toBeNull()
    expect(container.firstElementChild).toHaveAttribute(
      'data-presentation-cleanup',
      'presentation_cleanup_complete'
    )

    fireEvent.click(screen.getByRole('button', { name: 'Mock Send' }))
    fireEvent.click(screen.getByRole('button', { name: 'Mock Stop' }))
    await act(async () =>
      lateReject.reject(new Error('late fixed-class reject'))
    )
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByLabelText('アシスタントの会話内容')).toBeNull()
    expect(abort).toHaveBeenCalledTimes(2)
  })

  it('removes only its exact assistant identity and reports unknown while exact residue remains', async () => {
    global.fetch = jest.fn(async (_url, init) =>
      validResponse(init, 'assistant_owned_001', 'visible response')
    ) as typeof fetch
    const { container } = render(<ProjectionVisual />)
    fireEvent.click(screen.getByRole('button', { name: 'Mock Send' }))
    await screen.findByText('visible response')
    const root = container.firstElementChild as HTMLElement
    const unrelated = document.createElement('aside')
    unrelated.dataset.assistantMessageId = 'assistant_unrelated_001'
    const residue = document.createElement('aside')
    residue.dataset.assistantMessageId = 'assistant_owned_001'
    root.append(unrelated, residue)

    fireEvent.click(screen.getByRole('button', { name: 'Mock Stop' }))

    expect(screen.queryByText('visible response')).toBeNull()
    expect(unrelated).toBeInTheDocument()
    expect(residue).toBeInTheDocument()
    expect(root).toHaveAttribute(
      'data-presentation-cleanup',
      'presentation_cleanup_unknown'
    )
  })

  it.each([
    ['owner loss', operatorState, false],
    ['passive transition', passiveState, true],
    ['stage transition', stageState, true],
  ])(
    'clears a visible owned response before abort on %s and never revives it',
    async (_label, nextState, nextOwner) => {
      const abort = jest.spyOn(AbortController.prototype, 'abort')
      global.fetch = jest.fn(async (_url, init) =>
        validResponse(init, 'assistant_transition_001', 'transition response')
      ) as typeof fetch
      const view = render(<ProjectionVisual />)
      fireEvent.click(screen.getByRole('button', { name: 'Mock Send' }))
      await screen.findByText('transition response')
      const unrelated = document.createElement('aside')
      unrelated.dataset.assistantMessageId = 'assistant_unrelated_transition'
      view.container.firstElementChild?.append(unrelated)

      mockQueryState = nextState
      mockIsOwner = nextOwner
      view.rerender(<ProjectionVisual />)

      expect(screen.queryByText('transition response')).toBeNull()
      expect(screen.getByTestId('normal-assistant-bubble')).toBeInTheDocument()
      expect(unrelated).toBeInTheDocument()
      expect(abort).toHaveBeenCalledTimes(1)
      mockQueryState = operatorState
      mockIsOwner = true
      view.rerender(<ProjectionVisual />)
      expect(screen.queryByText('transition response')).toBeNull()
      expect(screen.queryByRole('alert')).toBeNull()
      expect(screen.queryByTestId('normal-assistant-bubble')).toBeNull()
    }
  )

  it.each([
    ['owner loss', operatorState, false],
    ['passive transition', passiveState, true],
    ['stage transition', stageState, true],
  ])(
    'aborts and fences an in-flight request on %s',
    async (_label, nextState, nextOwner) => {
      const pending = deferred<Response>()
      const abort = jest.spyOn(AbortController.prototype, 'abort')
      global.fetch = jest.fn(() => pending.promise) as typeof fetch
      const view = render(<ProjectionVisual />)
      fireEvent.click(screen.getByRole('button', { name: 'Mock Send' }))
      const init = (global.fetch as jest.Mock).mock.calls[0][1]

      mockQueryState = nextState
      mockIsOwner = nextOwner
      view.rerender(<ProjectionVisual />)
      expect(abort).toHaveBeenCalledTimes(1)
      await act(async () =>
        pending.resolve(
          validResponse(init, 'assistant_late_transition', 'late transition')
        )
      )
      expect(screen.queryByText('late transition')).toBeNull()
      expect(screen.queryByRole('alert')).toBeNull()

      mockQueryState = operatorState
      mockIsOwner = true
      view.rerender(<ProjectionVisual />)
      expect(screen.queryByText('late transition')).toBeNull()
      expect(screen.queryByRole('alert')).toBeNull()
    }
  )

  it('aborts an active request exactly once on unmount and fences its late resolve', async () => {
    const pending = deferred<Response>()
    const abort = jest.spyOn(AbortController.prototype, 'abort')
    global.fetch = jest.fn(() => pending.promise) as typeof fetch
    const view = render(<ProjectionVisual />)
    fireEvent.click(screen.getByRole('button', { name: 'Mock Send' }))
    const init = (global.fetch as jest.Mock).mock.calls[0][1]
    view.unmount()
    expect(abort).toHaveBeenCalledTimes(1)
    await act(async () =>
      pending.resolve(
        validResponse(init, 'assistant_unmounted', 'unmounted late')
      )
    )
    expect(screen.queryByText('unmounted late')).toBeNull()
  })

  it.each([
    ['non-OK', () => ({ ok: false, json: async () => ({}) }) as Response],
    [
      'invalid identity',
      (init: RequestInit | undefined) => {
        const response = validResponse(
          init,
          'invalid identity',
          'invalid response'
        )
        return response
      },
    ],
    [
      'wrong session',
      (init: RequestInit | undefined) => {
        const response = validResponse(
          init,
          'assistant_wrong_session',
          'invalid response'
        )
        return {
          ...response,
          json: async () => ({
            ...(await response.json()),
            sessionId: 'wrong_session',
          }),
        } as Response
      },
    ],
    [
      'wrong turn',
      (init: RequestInit | undefined) => {
        const response = validResponse(
          init,
          'assistant_wrong_turn',
          'invalid response'
        )
        return {
          ...response,
          json: async () => ({
            ...(await response.json()),
            turnId: 'wrong_turn',
          }),
        } as Response
      },
    ],
    [
      'extra response key',
      (init: RequestInit | undefined) => {
        const request = JSON.parse(String(init?.body))
        return {
          ok: true,
          json: async () => ({
            sessionId: request.sessionId,
            turnId: request.turnId,
            assistantMessageId: 'assistant_extra_key',
            response: 'invalid response',
            extra: true,
          }),
        } as Response
      },
    ],
  ])(
    'uses only the fixed failure surface for %s',
    async (_label, makeResponse) => {
      global.fetch = jest.fn(async (_url, init) =>
        makeResponse(init)
      ) as typeof fetch
      render(<ProjectionVisual />)
      fireEvent.click(screen.getByRole('button', { name: 'Mock Send' }))
      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Request failed'
      )
      expect(screen.queryByLabelText('アシスタントの会話内容')).toBeNull()
      expect(screen.queryByText('invalid response')).toBeNull()
    }
  )

  it('keeps Form defaults and composes transient then speech Stop even when transient throws', () => {
    render(<Form />)
    expect(mockCapturedInputProps?.onStopRequested).toBeUndefined()
    act(() => mockCapturedInputProps?.onChatProcessStart('default text'))
    expect(mockDefaultSend).toHaveBeenCalledTimes(1)
    expect(mockDefaultSend).toHaveBeenCalledWith('default text')

    const order: string[] = []
    mockSpeechStop.mockImplementation(() => order.push('speech'))
    const RealMessageInputContainer = (
      jest.requireActual(
        '@/components/messageInputContainer'
      ) as typeof import('@/components/messageInputContainer')
    ).MessageInputContainer
    const first = render(
      <RealMessageInputContainer
        onChatProcessStart={jest.fn()}
        onStopRequested={() => order.push('transient')}
      />
    )
    act(() => mockCapturedMessageInputProps?.onClickStopButton())
    expect(order).toEqual(['transient', 'speech'])
    first.unmount()

    order.length = 0
    render(
      <RealMessageInputContainer
        onChatProcessStart={jest.fn()}
        onStopRequested={() => {
          order.push('transient')
          throw new Error('fixed transient stop failure')
        }}
      />
    )
    expect(() => mockCapturedMessageInputProps?.onClickStopButton()).toThrow(
      'fixed transient stop failure'
    )
    expect(order).toEqual(['transient', 'speech'])

    order.length = 0
    render(<RealMessageInputContainer onChatProcessStart={jest.fn()} />)
    act(() => mockCapturedMessageInputProps?.onClickStopButton())
    expect(order).toEqual(['speech'])
  })
})
