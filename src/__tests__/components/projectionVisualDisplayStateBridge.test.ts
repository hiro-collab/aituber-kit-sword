import homeStore from '@/features/stores/home'
import settingsStore from '@/features/stores/settings'
import {
  applyPassiveDisplayState,
  readOperatorDisplayState,
  type RemoteProjectionDisplayState,
} from '@/components/projectionVisualDisplayStateBridge'

describe('ProjectionVisualDisplayStateBridge camera FOV synchronization', () => {
  const originalCameraHorizontalFov =
    settingsStore.getState().cameraHorizontalFov

  afterEach(() => {
    const viewer = homeStore.getState().viewer as unknown as {
      _settingsUnsubscribe?: () => void
    }
    viewer._settingsUnsubscribe?.()
    viewer._settingsUnsubscribe = undefined
    settingsStore.setState({ cameraHorizontalFov: originalCameraHorizontalFov })
    jest.restoreAllMocks()
  })

  it('publishes the operator-owned camera FOV in the bounded display state', () => {
    settingsStore.setState({ cameraHorizontalFov: 45 })

    expect(readOperatorDisplayState().settings.cameraHorizontalFov).toBe(45)
  })

  it('applies one valid remote FOV to passive settings and the viewer', () => {
    const viewer = homeStore.getState().viewer
    settingsStore.setState({ cameraHorizontalFov: 35 })
    const updateCameraHorizontalFov = jest.spyOn(
      viewer,
      'updateCameraHorizontalFov'
    )
    ;(
      viewer as unknown as { subscribeToSettings: () => void }
    ).subscribeToSettings()

    applyPassiveDisplayState({
      settings: { cameraHorizontalFov: 30 },
    })

    expect(settingsStore.getState().cameraHorizontalFov).toBe(30)
    expect(updateCameraHorizontalFov).toHaveBeenCalledTimes(1)
    expect(updateCameraHorizontalFov).toHaveBeenCalledWith(30)
  })

  it.each([
    ['numeric string', '45'],
    ['below minimum', 19],
    ['above maximum', 91],
    ['not finite', Number.POSITIVE_INFINITY],
    ['null', null],
    ['object', { value: 45 }],
  ])('fails closed for an invalid remote camera FOV: %s', (_label, value) => {
    const viewer = homeStore.getState().viewer
    settingsStore.setState({ cameraHorizontalFov: 35 })
    const updateCameraHorizontalFov = jest.spyOn(
      viewer,
      'updateCameraHorizontalFov'
    )
    ;(
      viewer as unknown as { subscribeToSettings: () => void }
    ).subscribeToSettings()

    applyPassiveDisplayState({
      settings: { cameraHorizontalFov: value },
    } as unknown as RemoteProjectionDisplayState)

    expect(settingsStore.getState().cameraHorizontalFov).toBe(35)
    expect(updateCameraHorizontalFov).not.toHaveBeenCalled()
  })

  it('does not reapply an unchanged valid remote camera FOV', () => {
    const viewer = homeStore.getState().viewer
    settingsStore.setState({ cameraHorizontalFov: 35 })
    const updateCameraHorizontalFov = jest.spyOn(
      viewer,
      'updateCameraHorizontalFov'
    )
    ;(
      viewer as unknown as { subscribeToSettings: () => void }
    ).subscribeToSettings()

    applyPassiveDisplayState({
      sequence: 2,
      settings: { cameraHorizontalFov: 35 },
    })

    expect(settingsStore.getState().cameraHorizontalFov).toBe(35)
    expect(updateCameraHorizontalFov).not.toHaveBeenCalled()
  })
})
