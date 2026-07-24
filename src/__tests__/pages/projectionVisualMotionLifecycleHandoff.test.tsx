import { render, screen, waitFor } from '@testing-library/react'

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
  }: {
    onDanceLifecycleAcceptanceReady: (value: typeof predicate) => void
  }) {
    const { useEffect } = require('react') as typeof import('react')
    useEffect(
      () => onDanceLifecycleAcceptanceReady(predicate),
      [onDanceLifecycleAcceptanceReady]
    )
    return <div data-testid="mock-projection-vrm-viewer" />
  },
}))
jest.mock(
  '@/features/projectionEffects/browser/avatarFireThunderLabOverlay',
  () => ({
    AvatarFireThunderEffectLayer: ({
      intentReceiverEnabled,
    }: {
      intentReceiverEnabled?: boolean
    }) => (
      <div
        data-intent-receiver-enabled={String(intentReceiverEnabled)}
        data-testid="mock-projection-fire-thunder-effect-layer"
      >
        <canvas data-testid="mock-projection-webgl2-effect-canvas" />
        <canvas data-testid="mock-projection-canvas2d-effect-canvas" />
      </div>
    ),
  })
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
    bridgePredicate = undefined
    mockProjectionVisualQueryState = passiveProjectionVisualQueryState
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

    render(<ProjectionVisual />)

    const avatar = screen.getByTestId('mock-projection-vrm-viewer')
    const effect = screen.getByTestId(
      'mock-projection-fire-thunder-effect-layer'
    )
    const bubble = screen.getByTestId('mock-projection-assistant-bubble')

    expect(screen.getAllByTestId('mock-projection-vrm-viewer')).toHaveLength(1)
    expect(
      screen.getAllByTestId('mock-projection-fire-thunder-effect-layer')
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

  it('enables the effect receiver only for stage-output mode', () => {
    mockProjectionVisualQueryState = {
      ...passiveProjectionVisualQueryState,
      isPassiveMode: false,
      isStageOutputMode: true,
      projectionVisualMode: 'stage-output',
    }
    const stageOutput = render(<ProjectionVisual />)
    expect(
      screen.getByTestId('mock-projection-fire-thunder-effect-layer')
    ).toHaveAttribute('data-intent-receiver-enabled', 'true')
    stageOutput.unmount()

    mockProjectionVisualQueryState = passiveProjectionVisualQueryState
    const passive = render(<ProjectionVisual />)
    expect(
      screen.getByTestId('mock-projection-fire-thunder-effect-layer')
    ).toHaveAttribute('data-intent-receiver-enabled', 'false')
    passive.unmount()

    mockProjectionVisualQueryState = {
      ...passiveProjectionVisualQueryState,
      isPassiveMode: false,
      isDisplayOnlyMode: false,
      projectionVisualMode: 'operator',
    }
    render(<ProjectionVisual />)
    expect(
      screen.getByTestId('mock-projection-fire-thunder-effect-layer')
    ).toHaveAttribute('data-intent-receiver-enabled', 'false')
  })
})
