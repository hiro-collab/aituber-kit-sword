import { act, render } from '@testing-library/react'
import { createElement } from 'react'

import homeStore from '@/features/stores/home'
import { DEFAULT_SPEECH_BUBBLE_PRESENTATION } from '@/features/projectionVisualBubble/presentation'
import {
  DEFAULT_FLUID_FIRE_RELAY_PARAMETERS,
  DEFAULT_PROJECTION_EFFECTS_SETTINGS,
} from '@/features/projectionEffects/settings'
import projectionDisplayStore from '@/features/stores/projectionDisplay'
import settingsStore from '@/features/stores/settings'
import {
  applyPassiveDisplayState,
  isFreshRemoteProjectionDisplayState,
  ProjectionVisualDisplayStateBridge,
  readOperatorDisplayState,
  type RemoteProjectionDisplayState,
} from '@/components/projectionVisualDisplayStateBridge'

describe('ProjectionVisualDisplayStateBridge camera FOV synchronization', () => {
  const originalFetch = global.fetch
  const originalCameraHorizontalFov =
    settingsStore.getState().cameraHorizontalFov
  const originalLightingIntensity = settingsStore.getState().lightingIntensity
  const originalProjectionEffects = settingsStore.getState().projectionEffects
  const originalFixedCharacterPosition =
    settingsStore.getState().fixedCharacterPosition
  const originalSpeechBubblePresentation =
    settingsStore.getState().speechBubblePresentation

  afterEach(() => {
    const viewer = homeStore.getState().viewer as unknown as {
      _settingsUnsubscribe?: () => void
    }
    viewer._settingsUnsubscribe?.()
    viewer._settingsUnsubscribe = undefined
    settingsStore.setState({
      cameraHorizontalFov: originalCameraHorizontalFov,
      lightingIntensity: originalLightingIntensity,
      projectionEffects: originalProjectionEffects,
      fixedCharacterPosition: originalFixedCharacterPosition,
      speechBubblePresentation: originalSpeechBubblePresentation,
    })
    homeStore.setState({ isSpeaking: false })
    projectionDisplayStore.setState({ speechOutputActive: false })
    global.fetch = originalFetch
    jest.useRealTimers()
    jest.restoreAllMocks()
  })

  it('publishes the operator-owned camera FOV in the bounded display state', () => {
    settingsStore.setState({ cameraHorizontalFov: 45 })

    expect(readOperatorDisplayState().settings.cameraHorizontalFov).toBe(45)
  })

  it('publishes and applies one bounded operator-owned projection effect contract', () => {
    const next = {
      selectedEffect: 'fluidFireRelay' as const,
      fluidFireRelay: {
        ...DEFAULT_FLUID_FIRE_RELAY_PARAMETERS,
        temperatureGain: 1.3,
      },
    }
    settingsStore.setState({ projectionEffects: next })

    expect(readOperatorDisplayState().settings.projectionEffects).toEqual(next)

    settingsStore.setState({
      projectionEffects: { ...DEFAULT_PROJECTION_EFFECTS_SETTINGS },
    })
    applyPassiveDisplayState({ settings: { projectionEffects: next } })
    expect(settingsStore.getState().projectionEffects).toEqual(next)
  })

  it('fails closed for an extra-key remote projection effect contract', () => {
    settingsStore.setState({
      projectionEffects: { ...DEFAULT_PROJECTION_EFFECTS_SETTINGS },
    })
    applyPassiveDisplayState({
      settings: {
        projectionEffects: {
          ...DEFAULT_PROJECTION_EFFECTS_SETTINGS,
          privateShader: 'raw',
        },
      },
    } as unknown as RemoteProjectionDisplayState)

    expect(settingsStore.getState().projectionEffects).toEqual(
      DEFAULT_PROJECTION_EFFECTS_SETTINGS
    )
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

  it('uses the viewer subscription once for remote lighting and position', () => {
    const viewer = homeStore.getState().viewer
    settingsStore.setState({
      lightingIntensity: 1,
      fixedCharacterPosition: false,
    })
    const updateLightingIntensity = jest.spyOn(
      viewer,
      'updateLightingIntensity'
    )
    const restoreCameraPosition = jest.spyOn(viewer, 'restoreCameraPosition')
    ;(
      viewer as unknown as { subscribeToSettings: () => void }
    ).subscribeToSettings()

    applyPassiveDisplayState({
      settings: {
        lightingIntensity: 1.5,
        characterPosition: { x: 0, y: 0, z: 0, scale: 1 },
      },
    })

    expect(updateLightingIntensity).toHaveBeenCalledTimes(1)
    expect(updateLightingIntensity).toHaveBeenCalledWith(1.5)
    expect(restoreCameraPosition).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['numeric string', '1.5'],
    ['object', { value: 1.5 }],
    ['null', null],
    ['not finite', Number.POSITIVE_INFINITY],
    ['zero', 0],
    ['below minimum', 0.09],
    ['above maximum', 3.01],
  ])(
    'fails closed for an invalid remote lighting value: %s',
    (_label, value) => {
      const viewer = homeStore.getState().viewer
      settingsStore.setState({ lightingIntensity: 1 })
      const updateLightingIntensity = jest.spyOn(
        viewer,
        'updateLightingIntensity'
      )
      ;(
        viewer as unknown as { subscribeToSettings: () => void }
      ).subscribeToSettings()

      applyPassiveDisplayState({
        settings: { lightingIntensity: value },
      } as unknown as RemoteProjectionDisplayState)

      expect(settingsStore.getState().lightingIntensity).toBe(1)
      expect(updateLightingIntensity).not.toHaveBeenCalled()
    }
  )

  it('publishes and applies bounded bubble settings and the speech lifecycle class', () => {
    const next = {
      ...DEFAULT_SPEECH_BUBBLE_PRESENTATION,
      fontSizePx: 28,
      timingMode: 'speech-synchronized' as const,
    }
    settingsStore.setState({ speechBubblePresentation: next })
    homeStore.setState({ isSpeaking: true })

    expect(readOperatorDisplayState()).toMatchObject({
      speechOutputActive: true,
      settings: { speechBubblePresentation: next },
    })

    applyPassiveDisplayState({
      speechOutputActive: true,
      settings: { speechBubblePresentation: next },
    })
    expect(settingsStore.getState().speechBubblePresentation).toEqual(next)
    expect(projectionDisplayStore.getState().speechOutputActive).toBe(true)
  })

  it('fails closed for incomplete remote bubble settings', () => {
    settingsStore.setState({
      speechBubblePresentation: { ...DEFAULT_SPEECH_BUBBLE_PRESENTATION },
    })
    applyPassiveDisplayState({
      settings: {
        speechBubblePresentation: { fontSizePx: 30 },
      },
    } as unknown as RemoteProjectionDisplayState)

    expect(settingsStore.getState().speechBubblePresentation).toEqual(
      DEFAULT_SPEECH_BUBBLE_PRESENTATION
    )
  })

  it('retries an unchanged operator payload after a failed POST', async () => {
    jest.useFakeTimers()
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce({ ok: true })
    global.fetch = fetchMock as unknown as typeof fetch
    const view = render(
      createElement(ProjectionVisualDisplayStateBridge, { mode: 'operator' })
    )

    await act(async () => undefined)
    act(() => jest.advanceTimersByTime(500))
    await act(async () => undefined)

    expect(fetchMock).toHaveBeenCalledTimes(2)
    view.unmount()
    jest.useRealTimers()
  })

  it('fails stale passive state closed and clears transient speech output', async () => {
    projectionDisplayStore.setState({ speechOutputActive: true })
    const updatedAt = new Date(Date.now() - 10000).toISOString()
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ageMs: 10000,
        state: {
          sequence: 1,
          updatedAt,
          speechOutputActive: true,
          settings: {},
        },
      }),
    }) as unknown as typeof fetch

    const view = render(
      createElement(ProjectionVisualDisplayStateBridge, { mode: 'passive' })
    )
    await act(async () => undefined)

    expect(projectionDisplayStore.getState().speechOutputActive).toBe(false)
    view.unmount()
  })

  it('does not apply a late passive response after unmount', async () => {
    let resolveFetch: ((value: unknown) => void) | undefined
    const pending = new Promise((resolve) => {
      resolveFetch = resolve
    })
    global.fetch = jest.fn().mockReturnValue(pending) as unknown as typeof fetch
    projectionDisplayStore.setState({ speechOutputActive: false, sequence: 0 })
    const view = render(
      createElement(ProjectionVisualDisplayStateBridge, { mode: 'passive' })
    )

    view.unmount()
    resolveFetch?.({
      ok: true,
      json: async () => ({
        ageMs: 0,
        state: {
          sequence: 3,
          updatedAt: new Date().toISOString(),
          speechOutputActive: true,
          settings: {},
        },
      }),
    })
    await act(async () => undefined)

    expect(projectionDisplayStore.getState()).toMatchObject({
      speechOutputActive: false,
      sequence: 0,
    })
  })

  it('accepts only bounded current sequence and freshness metadata', () => {
    const now = Date.now()
    expect(
      isFreshRemoteProjectionDisplayState(
        {
          ageMs: 100,
          state: { sequence: 2, updatedAt: new Date(now - 100).toISOString() },
        },
        now
      )
    ).toBe(true)
    expect(
      isFreshRemoteProjectionDisplayState(
        {
          ageMs: 6000,
          state: { sequence: 2, updatedAt: new Date(now - 6000).toISOString() },
        },
        now
      )
    ).toBe(false)
  })
})
