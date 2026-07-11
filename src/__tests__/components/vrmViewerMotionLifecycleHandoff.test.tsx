import { render, waitFor } from '@testing-library/react'

import VrmViewer from '@/components/vrmViewer'

const predicate = jest.fn(() => true)
const viewer = {
  isReady: true,
  setup: jest.fn(),
  loadVrm: jest.fn().mockResolvedValue(undefined),
  setMotionRuntimeAssetPath: jest.fn(),
  getDanceLifecycleAcceptancePredicate: jest.fn(() => predicate),
  receiveMotionStimulus: jest.fn(),
}

jest.mock('@/features/stores/home', () => ({
  __esModule: true,
  default: { getState: () => ({ viewer }) },
}))

jest.mock('@/features/stores/settings', () => {
  const state = {
    selectedVrmPath: '/vrm/test.vrm',
    poseAdjustMode: false,
  }
  const store = (selector: (value: typeof state) => unknown) => selector(state)
  store.getState = () => state
  return { __esModule: true, default: store }
})

jest.mock('@/components/poseTestButton', () => ({
  __esModule: true,
  default: () => null,
}))

describe('VrmViewer dance lifecycle handoff', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    viewer.loadVrm.mockResolvedValue(undefined)
  })

  it('hands the exact viewer-owned predicate to its page-local owner and clears it on unmount', async () => {
    const onDanceLifecycleAcceptanceReady = jest.fn()
    const { unmount } = render(
      <VrmViewer
        onDanceLifecycleAcceptanceReady={onDanceLifecycleAcceptanceReady}
      />
    )

    await waitFor(() =>
      expect(onDanceLifecycleAcceptanceReady).toHaveBeenCalledWith(predicate)
    )
    expect(viewer.getDanceLifecycleAcceptancePredicate).toHaveBeenCalledTimes(1)

    unmount()
    expect(onDanceLifecycleAcceptanceReady).toHaveBeenLastCalledWith(undefined)
  })
})
