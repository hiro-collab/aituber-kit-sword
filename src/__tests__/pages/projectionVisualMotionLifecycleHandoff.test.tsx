import { render, waitFor } from '@testing-library/react'

let bridgePredicate:
  | ((candidate: { candidateState: 'active' }) => boolean)
  | undefined
const predicate = jest.fn(() => true)

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
  resolveProjectionVisualQueryState: () => ({
    isPassiveMode: false,
    isStageOutputMode: false,
    isDisplayOnlyMode: true,
    projectionVisualMode: 'passive',
    shouldReceiveDisplayState: false,
    shouldRenderHud: false,
  }),
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
    return null
  },
}))
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
jest.mock('@/components/projectionVisualDisplayStateBridge', () => ({
  ProjectionVisualDisplayStateBridge: () => null,
}))
jest.mock('@/components/projectionVisualAssistantBubble', () => ({
  ProjectionVisualAssistantBubble: () => null,
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
  it('passes the VrmViewer-owned predicate to the bridge without replacing it', async () => {
    render(<ProjectionVisual />)

    await waitFor(() => expect(bridgePredicate).toBe(predicate))
    expect(bridgePredicate?.({ candidateState: 'active' })).toBe(true)
  })
})
