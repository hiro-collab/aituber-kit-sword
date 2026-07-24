import { act, render, screen, waitFor } from '@testing-library/react'
import { publishProjectionEffectIntent } from '@/features/projectionEffects/projectionEffectIntent'

let bridgePredicate:
  | ((candidate: { candidateState: 'active' }) => boolean)
  | undefined
const predicate = jest.fn(() => true)
const passiveProjectionVisualQueryState = {
  isPassiveMode: true,
  isStageOutputMode: false,
  isDisplayOnlyMode: true,
  projectionVisualMode: 'passive',
  projectionVisualTestMode: undefined,
  motionStimulusAssetPath: undefined,
  projectionVisualStimulusRef: undefined,
  shouldReceiveDisplayState: false,
  shouldRenderHud: false,
}
let mockProjectionVisualQueryState = passiveProjectionVisualQueryState
let mockRemoteSpeechOutputActive = true
const originalBroadcastChannel = globalThis.BroadcastChannel
const pageBroadcastChannels = new Set<PageBroadcastChannel>()
const mockPageLabController = {
  emergencyStop: jest.fn().mockResolvedValue(null),
  reset: jest.fn().mockResolvedValue(null),
  start: jest.fn().mockResolvedValue({
    status: 'started',
    commandId: 'projection-effect-conversation',
    activeEffectId: 'fire',
    replacedEffectId: null,
    visualStatus: null,
    sfxStatus: null,
    fadeMs: 0,
    partialReasons: [],
    validationErrorCount: 0,
  }),
  startPlan: jest.fn().mockResolvedValue(null),
  stop: jest.fn().mockResolvedValue(null),
}

class PageBroadcastChannel {
  readonly name: string
  private readonly listeners = new Set<(event: MessageEvent) => void>()
  private closed = false

  constructor(name: string) {
    this.name = name
    pageBroadcastChannels.add(this)
  }

  postMessage(value: unknown) {
    if (this.closed) return
    for (const peer of pageBroadcastChannels) {
      if (peer === this || peer.closed || peer.name !== this.name) continue
      for (const listener of peer.listeners) {
        listener({ data: value } as MessageEvent)
      }
    }
  }

  addEventListener(_type: 'message', listener: (event: MessageEvent) => void) {
    if (!this.closed) this.listeners.add(listener)
  }

  removeEventListener(
    _type: 'message',
    listener: (event: MessageEvent) => void
  ) {
    this.listeners.delete(listener)
  }

  close() {
    if (this.closed) return
    this.closed = true
    this.listeners.clear()
    pageBroadcastChannels.delete(this)
  }
}

jest.mock('next/router', () => ({
  useRouter: () => ({ isReady: true, query: {}, asPath: '/projection-visual' }),
}))
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (v: string) => v }),
}))
jest.mock('@/features/stores/home', () => ({
  __esModule: true,
  default: { setState: jest.fn() },
}))
jest.mock('@/features/stores/toast', () => ({
  __esModule: true,
  default: { getState: () => ({ addToast: jest.fn() }) },
}))
jest.mock('@/features/stores/settings', () => {
  const state = {
    messageReceiverEnabled: false,
    modelType: 'vrm',
    characterPreset1: '',
    characterPreset2: '',
    characterPreset3: '',
    characterPreset4: '',
    characterPreset5: '',
  }
  const store = (selector: (value: typeof state) => unknown) => selector(state)
  store.setState = jest.fn()
  return { __esModule: true, default: store }
})
jest.mock('@/features/stores/projectionDisplay', () => {
  const store = (
    selector: (value: { speechOutputActive: boolean }) => unknown
  ) => selector({ speechOutputActive: mockRemoteSpeechOutputActive })
  return { __esModule: true, default: store }
})
jest.mock('@/features/presets/usePresetLoader', () => ({
  usePresetLoader: jest.fn(),
}))
jest.mock('@/hooks/useLive2DEnabled', () => ({
  useLive2DEnabled: () => ({ isLive2DEnabled: false }),
}))
jest.mock('@/features/browserControl/useBrowserControlOwner', () => ({
  useBrowserControlOwner: () => ({
    isOwner: false,
    owner: null,
    takeControl: jest.fn(),
  }),
}))
jest.mock('@/utils/projectionVisualQuery', () => ({
  readProjectionVisualQueryFromPath: () => ({}),
  resolveProjectionVisualQueryState: () => mockProjectionVisualQueryState,
}))
jest.mock('@/components/vrmViewer', () => ({
  __esModule: true,
  default: function MockVrmViewer({
    onDanceLifecycleAcceptanceReady,
    remoteSpeechOutputActive,
  }: {
    onDanceLifecycleAcceptanceReady: (value: typeof predicate) => void
    remoteSpeechOutputActive?: boolean
  }) {
    const { useEffect } = require('react') as typeof import('react')
    useEffect(
      () => onDanceLifecycleAcceptanceReady(predicate),
      [onDanceLifecycleAcceptanceReady]
    )
    return (
      <div
        data-testid="mock-projection-vrm-viewer"
        data-remote-speech-active={String(Boolean(remoteSpeechOutputActive))}
      />
    )
  },
}))
jest.mock(
  '@/features/projectionEffects/browser/fireThunderLabCanvasLayer',
  () => {
    const React = jest.requireActual('react') as typeof import('react')
    return {
      FireThunderLabCanvasLayer: React.forwardRef(
        (
          _props: unknown,
          ref: import('react').ForwardedRef<typeof mockPageLabController>
        ) => {
          React.useImperativeHandle(ref, () => mockPageLabController)
          return (
            <div data-testid="fire-thunder-lab-layer">
              <canvas data-testid="projection-effect-webgl2-canvas" />
              <canvas data-testid="projection-effect-canvas2d-canvas" />
            </div>
          )
        }
      ),
    }
  }
)
jest.mock(
  '@/features/projectionEffects/browser/fluidFireRelayCanvasLayer',
  () => ({
    FluidFireRelayCanvasLayer: () => (
      <div data-testid="mock-legacy-fluid-fire-relay" />
    ),
    resolveProjectionEffectSelection: () => null,
  })
)
jest.mock('@/features/motionRuntime/projectionVisualStimulusRefBridge', () => ({
  ProjectionVisualStimulusRefBridge: ({
    acceptDanceLifecycleCandidate,
  }: {
    acceptDanceLifecycleCandidate?: typeof predicate
  }) => {
    bridgePredicate = acceptDanceLifecycleCandidate
    return null
  },
}))

jest.mock('@/components/meta', () => ({ Meta: () => null }))
jest.mock('@/components/form', () => ({ Form: () => null }))
jest.mock('@/components/messageReceiver', () => ({
  __esModule: true,
  default: () => null,
}))
jest.mock('@/components/modalImage', () => ({
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
  GestureVoiceBridge: () => null,
}))
jest.mock('@/features/kiosk/kioskOverlay', () => ({
  KioskOverlay: () => null,
}))
jest.mock('@/components/youtubeManager', () => ({
  YoutubeManager: () => null,
}))
jest.mock('@/components/memoryServiceInitializer', () => ({
  MemoryServiceInitializer: () => null,
}))
jest.mock('@/components/projectionVisualHud', () => ({
  ProjectionVisualHud: () => null,
}))
jest.mock('@/components/projectionVisualDisplayStateBridge', () => ({
  ProjectionVisualDisplayStateBridge: () => null,
}))
jest.mock('@/components/projectionVisualAssistantBubble', () => ({
  ProjectionVisualAssistantBubble: () => (
    <div data-testid="mock-projection-assistant-bubble" />
  ),
}))
jest.mock('@/components/projectionVisualCalibrationPanel', () => ({
  ProjectionVisualCalibrationPanel: () => null,
}))
jest.mock('@/components/browserControlNotice', () => ({
  BrowserControlNotice: () => null,
}))
jest.mock('@/components/live2DViewer', () => ({
  __esModule: true,
  default: () => null,
}))
jest.mock('@/components/pngTuberViewer', () => ({
  __esModule: true,
  default: () => null,
}))
jest.mock('@/lib/i18n', () => ({}))

import ProjectionVisual from '@/pages/projection-visual'

describe('ProjectionVisual dance lifecycle handoff', () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, 'BroadcastChannel', {
      configurable: true,
      value: PageBroadcastChannel,
      writable: true,
    })
    pageBroadcastChannels.clear()
    jest.clearAllMocks()
    bridgePredicate = undefined
    mockRemoteSpeechOutputActive = true
    mockProjectionVisualQueryState = passiveProjectionVisualQueryState
  })

  afterEach(() => {
    for (const channel of [...pageBroadcastChannels]) channel.close()
  })

  afterAll(() => {
    Object.defineProperty(globalThis, 'BroadcastChannel', {
      configurable: true,
      value: originalBroadcastChannel,
      writable: true,
    })
  })

  it('passes the VrmViewer-owned predicate to the bridge without replacing it', async () => {
    render(<ProjectionVisual />)

    await waitFor(() => expect(bridgePredicate).toBe(predicate))
    expect(bridgePredicate?.({ candidateState: 'active' })).toBe(true)
  })

  it('mounts one effect-only layer after the avatar and before the bubble', () => {
    mockProjectionVisualQueryState = {
      ...passiveProjectionVisualQueryState,
      isPassiveMode: false,
      isStageOutputMode: true,
      projectionVisualMode: 'stage-output',
    }

    const { container } = render(<ProjectionVisual />)

    const avatar = screen.getByTestId('mock-projection-vrm-viewer')
    const effect = screen.getByTestId('avatar-fire-thunder-effect-layer')
    const bubble = screen.getByTestId('mock-projection-assistant-bubble')

    expect(screen.getAllByTestId('mock-projection-vrm-viewer')).toHaveLength(1)
    expect(avatar).toHaveAttribute('data-remote-speech-active', 'true')
    expect(container.firstElementChild).toHaveAttribute(
      'data-projection-avatar-speech-motion',
      'active'
    )
    expect(
      screen.getAllByTestId('avatar-fire-thunder-effect-layer')
    ).toHaveLength(1)
    expect(
      screen.queryByTestId('mock-legacy-fluid-fire-relay')
    ).not.toBeInTheDocument()
    expect(effect.querySelectorAll('canvas')).toHaveLength(2)
    expect(
      avatar.compareDocumentPosition(effect) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    expect(
      effect.compareDocumentPosition(bubble) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
  })

  it('exposes fixed receiver and Host states through the real effect boundary', async () => {
    mockProjectionVisualQueryState = {
      ...passiveProjectionVisualQueryState,
      isPassiveMode: false,
      isStageOutputMode: true,
      projectionVisualMode: 'stage-output',
    }
    const eventId = 'evt_00000000000000000000000000000041'
    const turnId = 'turn-projection-stage-status'
    const { container } = render(<ProjectionVisual />)
    const root = container.querySelector('.projection-visual')

    await waitFor(() =>
      expect(root).toHaveAttribute(
        'data-projection-effect-receiver-state',
        'ready'
      )
    )
    expect(root).toHaveAttribute('data-projection-effect-host-state', 'idle')

    act(() => {
      publishProjectionEffectIntent({
        schemaVersion: 1,
        eventId,
        turnId,
        action: 'start',
        effectId: 'fire',
      })
    })

    await waitFor(() =>
      expect(root).toHaveAttribute(
        'data-projection-effect-host-state',
        'started'
      )
    )
    expect(mockPageLabController.start).toHaveBeenCalledTimes(1)
    expect(mockPageLabController.start).toHaveBeenCalledWith('fire')
    expect(root?.outerHTML).not.toContain(eventId)
    expect(root?.outerHTML).not.toContain(turnId)
    expect(root?.outerHTML).not.toContain('炎を')
  })

  it('enables the effect receiver only for stage-output mode', async () => {
    mockProjectionVisualQueryState = {
      ...passiveProjectionVisualQueryState,
      isPassiveMode: false,
      isStageOutputMode: true,
      projectionVisualMode: 'stage-output',
    }
    const stageOutput = render(<ProjectionVisual />)
    await waitFor(() =>
      expect(
        stageOutput.container.querySelector('.projection-visual')
      ).toHaveAttribute('data-projection-effect-receiver-state', 'ready')
    )
    stageOutput.unmount()

    mockProjectionVisualQueryState = passiveProjectionVisualQueryState
    const passive = render(<ProjectionVisual />)
    await waitFor(() =>
      expect(
        passive.container.querySelector('.projection-visual')
      ).toHaveAttribute('data-projection-effect-receiver-state', 'inactive')
    )
    passive.unmount()

    mockProjectionVisualQueryState = {
      ...passiveProjectionVisualQueryState,
      isPassiveMode: false,
      isDisplayOnlyMode: false,
      projectionVisualMode: 'operator',
    }
    const operator = render(<ProjectionVisual />)
    await waitFor(() =>
      expect(
        operator.container.querySelector('.projection-visual')
      ).toHaveAttribute('data-projection-effect-receiver-state', 'inactive')
    )
  })
})
