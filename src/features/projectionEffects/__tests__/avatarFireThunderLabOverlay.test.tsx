import { createRef } from 'react'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import {
  AVATAR_CAST_VISUAL_PARAMETER_OVERRIDES,
  AvatarFireThunderLabOverlay,
  MAX_PENDING_PROJECTION_EFFECT_INTENTS,
  type AvatarFireThunderLabOverlayProps,
} from '../browser/avatarFireThunderLabOverlay'
import type {
  FireThunderLabCanvasLayerProps,
  FireThunderLabController,
} from '../browser/fireThunderLabCanvasLayer'
import {
  PROJECTION_EFFECT_RECEIPT_WINDOW_EVENT,
  publishProjectionEffectIntent,
} from '../projectionEffectIntent'

const hostResult = (
  status: string,
  partialReasons: readonly string[] = []
) => ({
  status,
  commandId: 'projection-effect-conversation',
  activeEffectId: status === 'started' ? 'fire' : null,
  replacedEffectId: null,
  visualStatus: null,
  sfxStatus: null,
  fadeMs: 0,
  partialReasons,
  validationErrorCount: 0,
})

const mockLabController = {
  emergencyStop: jest.fn().mockResolvedValue(null),
  reset: jest.fn().mockResolvedValue(null),
  start: jest.fn().mockResolvedValue(null),
  stop: jest.fn().mockResolvedValue(null),
}

jest.mock('@/components/vrmViewer', () => ({
  __esModule: true,
  default: function MockVrmViewer() {
    return <canvas data-testid="mock-vrm-viewer-canvas" />
  },
}))

jest.mock('../browser/fireThunderLabCanvasLayer', () => {
  const React = jest.requireActual('react') as typeof import('react')

  return {
    FireThunderLabCanvasLayer: React.forwardRef(
      (
        props: FireThunderLabCanvasLayerProps,
        ref: import('react').ForwardedRef<FireThunderLabController>
      ) => {
        React.useImperativeHandle(ref, () => mockLabController)
        return (
          <div
            data-reduced-motion={String(props.reducedMotion)}
            data-fire-emitter-x={props.visualParameterOverrides?.fire?.emitterX}
            data-fire-emitter-y={props.visualParameterOverrides?.fire?.emitterY}
            data-fire-point-size={
              props.visualParameterOverrides?.fire?.pointSize
            }
            data-thunder-center-x={
              props.visualParameterOverrides?.thunderBall?.centerX
            }
            data-thunder-center-y={
              props.visualParameterOverrides?.thunderBall?.centerY
            }
            data-thunder-line-width={
              props.visualParameterOverrides?.thunderBall?.lineWidth
            }
            data-thunder-orb-radius={
              props.visualParameterOverrides?.thunderBall?.orbRadius
            }
            data-testid="fire-thunder-lab-layer"
          >
            <canvas
              data-effect-surface-backend="webgl2"
              data-testid="projection-effect-webgl2-canvas"
            />
            <canvas
              data-effect-surface-backend="canvas2d"
              data-testid="projection-effect-canvas2d-canvas"
            />
          </div>
        )
      }
    ),
  }
})

describe('AvatarFireThunderLabOverlay', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockLabController.emergencyStop.mockResolvedValue(
      hostResult('emergency-stopped')
    )
    mockLabController.reset.mockResolvedValue(hostResult('reset'))
    mockLabController.start.mockResolvedValue(hostResult('started'))
    mockLabController.stop.mockResolvedValue(hostResult('stopped'))
  })

  it('layers one avatar below one pooled Fire Thunder effect layer', () => {
    const { container } = render(<AvatarFireThunderLabOverlay />)

    const avatarLayer = screen.getByTestId('avatar-fire-thunder-avatar-layer')
    const effectLayer = screen.getByTestId('avatar-fire-thunder-effect-layer')

    expect(avatarLayer).toHaveClass('z-0')
    expect(effectLayer).toHaveClass('z-10', 'pointer-events-none')
    expect(effectLayer).toHaveAttribute(
      'data-projection-anchor-contract',
      'fixed-stage-relative'
    )
    const labLayer = screen.getByTestId('fire-thunder-lab-layer')
    expect(labLayer).toHaveAttribute(
      'data-fire-emitter-x',
      String(AVATAR_CAST_VISUAL_PARAMETER_OVERRIDES.fire.emitterX)
    )
    expect(labLayer).toHaveAttribute(
      'data-fire-emitter-y',
      String(AVATAR_CAST_VISUAL_PARAMETER_OVERRIDES.fire.emitterY)
    )
    expect(labLayer).toHaveAttribute(
      'data-fire-point-size',
      String(AVATAR_CAST_VISUAL_PARAMETER_OVERRIDES.fire.pointSize)
    )
    expect(labLayer).toHaveAttribute(
      'data-thunder-center-x',
      String(AVATAR_CAST_VISUAL_PARAMETER_OVERRIDES.thunderBall.centerX)
    )
    expect(labLayer).toHaveAttribute(
      'data-thunder-center-y',
      String(AVATAR_CAST_VISUAL_PARAMETER_OVERRIDES.thunderBall.centerY)
    )
    expect(labLayer).toHaveAttribute(
      'data-thunder-line-width',
      String(AVATAR_CAST_VISUAL_PARAMETER_OVERRIDES.thunderBall.lineWidth)
    )
    expect(labLayer).toHaveAttribute(
      'data-thunder-orb-radius',
      String(AVATAR_CAST_VISUAL_PARAMETER_OVERRIDES.thunderBall.orbRadius)
    )
    expect(
      within(avatarLayer).getAllByTestId('mock-vrm-viewer-canvas')
    ).toHaveLength(1)
    expect(
      within(effectLayer).getAllByTestId('fire-thunder-lab-layer')
    ).toHaveLength(1)
    expect(effectLayer.querySelectorAll('canvas')).toHaveLength(2)
    expect(container.querySelectorAll('canvas')).toHaveLength(3)
  })

  it('forwards the existing controller and reduced-motion contract', async () => {
    const controllerRef = createRef<FireThunderLabController>()
    render(
      <AvatarFireThunderLabOverlay ref={controllerRef} reducedMotion={true} />
    )

    expect(screen.getByTestId('fire-thunder-lab-layer')).toHaveAttribute(
      'data-reduced-motion',
      'true'
    )
    await expect(controllerRef.current?.start('fire')).resolves.toEqual(
      expect.objectContaining({ status: 'started' })
    )
    await expect(controllerRef.current?.stop()).resolves.toEqual(
      expect.objectContaining({ status: 'stopped' })
    )
    await expect(controllerRef.current?.reset()).resolves.toEqual(
      expect.objectContaining({ status: 'reset' })
    )
    await expect(controllerRef.current?.emergencyStop()).resolves.toEqual(
      expect.objectContaining({ status: 'emergency-stopped' })
    )
  })

  it('unmounts without creating overlay-owned timers or animation frames', () => {
    const requestFrame = jest.spyOn(window, 'requestAnimationFrame')
    const setTimer = jest.spyOn(window, 'setTimeout')

    const { unmount } = render(<AvatarFireThunderLabOverlay />)
    unmount()

    expect(requestFrame).not.toHaveBeenCalled()
    expect(setTimer).not.toHaveBeenCalled()

    requestFrame.mockRestore()
    setTimer.mockRestore()
  })

  it('serializes enabled conversation start, stop, and reset intents', async () => {
    let resolveStart!: () => void
    mockLabController.start.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveStart = () => resolve(hostResult('started'))
        })
    )
    render(<AvatarFireThunderLabOverlay intentReceiverEnabled={true} />)

    act(() => {
      publishProjectionEffectIntent({
        action: 'start',
        effectId: 'fire',
        eventId: 'evt_00000000000000000000000000000001',
        turnId: 'turn-avatar-001',
        schemaVersion: 1,
      })
      publishProjectionEffectIntent({
        action: 'stop',
        eventId: 'evt_00000000000000000000000000000002',
        turnId: 'turn-avatar-001',
        schemaVersion: 1,
      })
      publishProjectionEffectIntent({
        action: 'reset',
        eventId: 'evt_00000000000000000000000000000003',
        turnId: 'turn-avatar-001',
        schemaVersion: 1,
      })
    })

    await waitFor(() =>
      expect(mockLabController.start).toHaveBeenCalledWith('fire')
    )
    expect(mockLabController.stop).not.toHaveBeenCalled()
    expect(mockLabController.reset).not.toHaveBeenCalled()

    await act(async () => {
      resolveStart()
      await Promise.resolve()
    })

    await waitFor(() => expect(mockLabController.stop).toHaveBeenCalledTimes(1))
    await waitFor(() =>
      expect(mockLabController.reset).toHaveBeenCalledTimes(1)
    )
    expect(mockLabController.emergencyStop).not.toHaveBeenCalled()
  })

  it('deduplicates intents and ignores disabled or unmounted receivers', async () => {
    const enabled = render(
      <AvatarFireThunderLabOverlay intentReceiverEnabled={true} />
    )
    const duplicate = {
      action: 'start' as const,
      effectId: 'thunderBall' as const,
      eventId: 'evt_00000000000000000000000000000004',
      turnId: 'turn-avatar-duplicate',
      schemaVersion: 1 as const,
    }

    act(() => {
      publishProjectionEffectIntent(duplicate)
      publishProjectionEffectIntent(duplicate)
      publishProjectionEffectIntent({
        schemaVersion: 1,
        eventId: duplicate.eventId,
        turnId: duplicate.turnId,
        action: 'reset',
      })
    })
    await waitFor(() =>
      expect(mockLabController.start).toHaveBeenCalledTimes(1)
    )

    enabled.unmount()
    mockLabController.start.mockClear()
    render(<AvatarFireThunderLabOverlay intentReceiverEnabled={false} />)
    act(() => {
      publishProjectionEffectIntent({
        ...duplicate,
        eventId: 'evt_00000000000000000000000000000005',
      })
    })
    await act(async () => {
      await Promise.resolve()
    })
    expect(mockLabController.start).not.toHaveBeenCalled()
  })

  it('rejects new and replayed live IDs at cap, then accepts after expiry', async () => {
    const now = jest.spyOn(Date, 'now').mockReturnValue(1_000)
    try {
      render(<AvatarFireThunderLabOverlay intentReceiverEnabled={true} />)
      const resetIntent = (index: number) => ({
        schemaVersion: 1 as const,
        eventId: `evt_${index.toString(16).padStart(32, '0')}`,
        turnId: 'turn-avatar-bounded-reservation',
        action: 'reset' as const,
      })

      for (let index = 0; index < 256; index += 1) {
        await act(async () => {
          publishProjectionEffectIntent(resetIntent(index))
          await Promise.resolve()
        })
        expect(mockLabController.reset).toHaveBeenCalledTimes(index + 1)
      }

      await act(async () => {
        publishProjectionEffectIntent(resetIntent(256))
        await Promise.resolve()
      })
      expect(mockLabController.reset).toHaveBeenCalledTimes(256)

      await act(async () => {
        publishProjectionEffectIntent(resetIntent(0))
        await Promise.resolve()
      })
      expect(mockLabController.reset).toHaveBeenCalledTimes(256)

      now.mockReturnValue(1_000 + 5 * 60 * 1_000 + 1)
      act(() => publishProjectionEffectIntent(resetIntent(0)))
      await waitFor(() =>
        expect(mockLabController.reset).toHaveBeenCalledTimes(257)
      )
    } finally {
      now.mockRestore()
    }
  })

  it('does not enqueue beyond the independent pending Host limit', async () => {
    const receipts: unknown[] = []
    const readReceipt = (event: Event) => {
      if (event instanceof CustomEvent) receipts.push(event.detail)
    }
    window.addEventListener(PROJECTION_EFFECT_RECEIPT_WINDOW_EVENT, readReceipt)
    let resolveFirst!: () => void
    mockLabController.reset.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirst = () => resolve(hostResult('reset'))
        })
    )
    render(<AvatarFireThunderLabOverlay intentReceiverEnabled={true} />)

    act(() => {
      for (
        let index = 0;
        index < MAX_PENDING_PROJECTION_EFFECT_INTENTS + 1;
        index += 1
      ) {
        publishProjectionEffectIntent({
          schemaVersion: 1,
          eventId: `evt_${(1_000 + index).toString(16).padStart(32, '0')}`,
          turnId: 'turn-avatar-pending-cap',
          action: 'reset',
        })
      }
    })
    await waitFor(() =>
      expect(mockLabController.reset).toHaveBeenCalledTimes(1)
    )
    expect(receipts).toContainEqual({
      schemaVersion: 1,
      eventId: `evt_${(1_000 + MAX_PENDING_PROJECTION_EFFECT_INTENTS)
        .toString(16)
        .padStart(32, '0')}`,
      status: 'rejected',
      resultClass: 'queue_capacity_exceeded',
    })

    await act(async () => {
      resolveFirst()
      await Promise.resolve()
    })
    await waitFor(() =>
      expect(mockLabController.reset).toHaveBeenCalledTimes(
        MAX_PENDING_PROJECTION_EFFECT_INTENTS
      )
    )
    expect(mockLabController.reset).toHaveBeenCalledTimes(
      MAX_PENDING_PROJECTION_EFFECT_INTENTS
    )

    const freshEventId = 'evt_00000000000000000000000000002000'
    act(() => {
      publishProjectionEffectIntent({
        schemaVersion: 1,
        eventId: freshEventId,
        turnId: 'turn-avatar-pending-cap-released',
        action: 'reset',
      })
    })
    await waitFor(() =>
      expect(mockLabController.reset).toHaveBeenCalledTimes(
        MAX_PENDING_PROJECTION_EFFECT_INTENTS + 1
      )
    )
    expect(receipts).not.toContainEqual({
      schemaVersion: 1,
      eventId: freshEventId,
      status: 'rejected',
      resultClass: 'queue_capacity_exceeded',
    })
    window.removeEventListener(
      PROJECTION_EFFECT_RECEIPT_WINDOW_EVENT,
      readReceipt
    )
  })

  it('does not retry a throwing Host call and keeps cleanup uncertainty sticky', async () => {
    const receipts: unknown[] = []
    const readReceipt = (event: Event) => {
      if (event instanceof CustomEvent) receipts.push(event.detail)
    }
    window.addEventListener(PROJECTION_EFFECT_RECEIPT_WINDOW_EVENT, readReceipt)
    mockLabController.start.mockRejectedValueOnce(new Error('private failure'))
    render(<AvatarFireThunderLabOverlay intentReceiverEnabled={true} />)

    act(() => {
      publishProjectionEffectIntent({
        schemaVersion: 1,
        eventId: 'evt_00000000000000000000000000000006',
        turnId: 'turn-avatar-throw',
        action: 'start',
        effectId: 'fire',
      })
      publishProjectionEffectIntent({
        schemaVersion: 1,
        eventId: 'evt_00000000000000000000000000000007',
        turnId: 'turn-avatar-throw',
        action: 'stop',
      })
    })

    await waitFor(() => expect(receipts).toHaveLength(2))
    expect(mockLabController.start).toHaveBeenCalledTimes(1)
    expect(mockLabController.stop).not.toHaveBeenCalled()
    expect(receipts).toEqual([
      {
        schemaVersion: 1,
        eventId: 'evt_00000000000000000000000000000006',
        status: 'cleanup_unproved',
        resultClass: 'cleanup_unproved',
      },
      {
        schemaVersion: 1,
        eventId: 'evt_00000000000000000000000000000007',
        status: 'cleanup_unproved',
        resultClass: 'cleanup_unproved_sticky',
      },
    ])
    expect(mockLabController.emergencyStop).not.toHaveBeenCalled()
    window.removeEventListener(
      PROJECTION_EFFECT_RECEIPT_WINDOW_EVENT,
      readReceipt
    )
  })

  it('does not execute a queued command after unmount', async () => {
    let resolveStart!: () => void
    mockLabController.start.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveStart = () => resolve(hostResult('started'))
        })
    )
    const mounted = render(
      <AvatarFireThunderLabOverlay intentReceiverEnabled={true} />
    )
    act(() => {
      publishProjectionEffectIntent({
        schemaVersion: 1,
        eventId: 'evt_00000000000000000000000000000008',
        turnId: 'turn-avatar-unmount',
        action: 'start',
        effectId: 'fire',
      })
      publishProjectionEffectIntent({
        schemaVersion: 1,
        eventId: 'evt_00000000000000000000000000000009',
        turnId: 'turn-avatar-unmount',
        action: 'reset',
      })
    })
    await waitFor(() =>
      expect(mockLabController.start).toHaveBeenCalledTimes(1)
    )
    mounted.unmount()
    await act(async () => {
      resolveStart()
      await Promise.resolve()
    })
    expect(mockLabController.reset).not.toHaveBeenCalled()
    expect(mockLabController.emergencyStop).not.toHaveBeenCalled()
  })
})
