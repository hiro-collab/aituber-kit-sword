import { createRef } from 'react'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import {
  AVATAR_CAST_VISUAL_PARAMETER_OVERRIDES,
  AvatarFireThunderEffectLayer,
  AvatarFireThunderLabOverlay,
  MAX_PENDING_PROJECTION_EFFECT_INTENTS,
} from '../browser/avatarFireThunderLabOverlay'
import type {
  FireThunderLabCanvasLayerProps,
  FireThunderLabController,
} from '../browser/fireThunderLabCanvasLayer'
import {
  PROJECTION_EFFECT_INTENT_CHANNEL,
  PROJECTION_EFFECT_RECEIPT_WINDOW_EVENT,
  publishProjectionEffectIntent,
} from '../projectionEffectIntent'
import type { ProjectionPerformancePlan } from '../projectionPerformancePlan'
import type { ProjectionEffectHostResult } from '../effectHost'

const originalBroadcastChannel = globalThis.BroadcastChannel
const testBroadcastChannels = new Set<TestBroadcastChannel>()
let mockLayerOnStatusChange:
  | FireThunderLabCanvasLayerProps['onStatusChange']
  | undefined

class TestBroadcastChannel {
  readonly name: string
  private readonly listeners = new Set<(event: MessageEvent) => void>()
  private closed = false

  constructor(name: string) {
    this.name = name
    testBroadcastChannels.add(this)
  }

  postMessage(value: unknown) {
    if (this.closed) return
    for (const peer of testBroadcastChannels) {
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
    testBroadcastChannels.delete(this)
  }
}

const hostResult = (
  status: ProjectionEffectHostResult['status'],
  partialReasons: ProjectionEffectHostResult['partialReasons'] = []
): ProjectionEffectHostResult => ({
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
  startPlan: jest.fn().mockResolvedValue(null),
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
        mockLayerOnStatusChange = props.onStatusChange
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
    Object.defineProperty(globalThis, 'BroadcastChannel', {
      configurable: true,
      value: TestBroadcastChannel,
      writable: true,
    })
    testBroadcastChannels.clear()
    jest.clearAllMocks()
    mockLayerOnStatusChange = undefined
    mockLabController.emergencyStop.mockResolvedValue(
      hostResult('emergency-stopped')
    )
    mockLabController.reset.mockResolvedValue(hostResult('reset'))
    mockLabController.start.mockResolvedValue(hostResult('started'))
    mockLabController.startPlan.mockResolvedValue({
      status: 'accepted',
      hostResult: hostResult('started'),
    })
    mockLabController.stop.mockResolvedValue(hostResult('stopped'))
  })

  afterEach(() => {
    for (const channel of [...testBroadcastChannels]) channel.close()
  })

  afterAll(() => {
    Object.defineProperty(globalThis, 'BroadcastChannel', {
      configurable: true,
      value: originalBroadcastChannel,
      writable: true,
    })
  })

  it('layers one avatar below one pooled Fire Thunder effect layer', () => {
    const { container } = render(<AvatarFireThunderLabOverlay />)

    const avatarLayer = screen.getByTestId('avatar-fire-thunder-avatar-layer')
    const effectLayer = screen.getByTestId('avatar-fire-thunder-effect-layer')

    expect(avatarLayer).toHaveClass('z-0')
    expect(effectLayer).toHaveClass('z-10', 'pointer-events-none')
    expect(effectLayer).toHaveAttribute(
      'data-projection-effect-host-role',
      'manual'
    )
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

  it('exposes the two-canvas effect surface without mounting another avatar', () => {
    const { container } = render(<AvatarFireThunderEffectLayer />)

    expect(
      screen.queryByTestId('avatar-fire-thunder-avatar-layer')
    ).not.toBeInTheDocument()
    expect(
      screen.queryByTestId('mock-vrm-viewer-canvas')
    ).not.toBeInTheDocument()
    expect(
      screen.getAllByTestId('avatar-fire-thunder-effect-layer')
    ).toHaveLength(1)
    expect(container.querySelectorAll('canvas')).toHaveLength(2)
  })

  it('forwards the existing controller and reduced-motion contract', async () => {
    const controllerRef = createRef<FireThunderLabController>()
    render(
      <AvatarFireThunderEffectLayer ref={controllerRef} reducedMotion={true} />
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

    const { unmount } = render(<AvatarFireThunderEffectLayer />)
    unmount()

    expect(requestFrame).not.toHaveBeenCalled()
    expect(setTimer).not.toHaveBeenCalled()

    requestFrame.mockRestore()
    setTimer.mockRestore()
  })

  it('reports cross-tab readiness and the fixed started Host result', async () => {
    const receiverStates: string[] = []
    const hostStates: string[] = []
    render(
      <AvatarFireThunderEffectLayer
        intentRole="authoritative-host"
        onHostStateChange={(state) => hostStates.push(state)}
        onIntentReceiverStateChange={(state) => receiverStates.push(state)}
      />
    )

    await waitFor(() =>
      expect(
        screen.getByTestId('avatar-fire-thunder-effect-layer')
      ).toHaveAttribute('data-projection-effect-receiver-state', 'ready')
    )
    expect(receiverStates).toEqual(['ready'])
    expect(hostStates).toEqual([])

    act(() => {
      publishProjectionEffectIntent({
        action: 'start',
        effectId: 'fire',
        eventId: 'evt_00000000000000000000000000000030',
        turnId: 'turn-avatar-ready',
        schemaVersion: 1,
      })
    })

    await waitFor(() =>
      expect(
        screen.getByTestId('avatar-fire-thunder-effect-layer')
      ).toHaveAttribute('data-projection-effect-host-state', 'started')
    )
    expect(mockLabController.start).toHaveBeenCalledTimes(1)
    expect(hostStates).toEqual(['started'])
  })

  it.each([
    ['no-active-effect', 'stopped'],
    ['stopped', 'stopped'],
    ['visual-failed', 'host-rejected'],
    ['blocked-terminal-cleanup', 'cleanup-unproved'],
    ['emergency-stopped', 'stopped'],
  ] as const)(
    'maps a child started result followed by %s to fixed Host state %s',
    (terminalStatus, expectedState) => {
      const hostStates: string[] = []
      const externalStatuses: ProjectionEffectHostResult[] = []
      render(
        <AvatarFireThunderEffectLayer
          onHostStateChange={(state) => hostStates.push(state)}
          onStatusChange={(result) => externalStatuses.push(result)}
        />
      )

      const started = hostResult('started')
      const terminal = hostResult(terminalStatus)
      act(() => mockLayerOnStatusChange?.(started))
      expect(
        screen.getByTestId('avatar-fire-thunder-effect-layer')
      ).toHaveAttribute('data-projection-effect-host-state', 'started')

      act(() => mockLayerOnStatusChange?.(terminal))
      expect(
        screen.getByTestId('avatar-fire-thunder-effect-layer')
      ).toHaveAttribute('data-projection-effect-host-state', expectedState)
      expect(hostStates).toEqual(['idle', 'started', expectedState])
      expect(externalStatuses).toEqual([started, terminal])
    }
  )

  it('reports cleanup-unproved when visual failure retains active ownership', () => {
    const hostStates: string[] = []
    const externalStatuses: ProjectionEffectHostResult[] = []
    render(
      <AvatarFireThunderEffectLayer
        onHostStateChange={(state) => hostStates.push(state)}
        onStatusChange={(result) => externalStatuses.push(result)}
      />
    )

    const started = hostResult('started')
    const retainedVisualFailure = {
      ...hostResult('visual-failed'),
      activeEffectId: 'fire',
    } satisfies ProjectionEffectHostResult
    act(() => mockLayerOnStatusChange?.(started))
    act(() => mockLayerOnStatusChange?.(retainedVisualFailure))

    expect(
      screen.getByTestId('avatar-fire-thunder-effect-layer')
    ).toHaveAttribute('data-projection-effect-host-state', 'cleanup-unproved')
    expect(hostStates).toEqual(['idle', 'started', 'cleanup-unproved'])
    expect(externalStatuses).toEqual([started, retainedVisualFailure])
    expect(
      screen.getByTestId('avatar-fire-thunder-effect-layer').outerHTML
    ).not.toContain('projection-effect-conversation')
  })

  it('deduplicates child and accepted-receipt started transitions while publishing one receipt', async () => {
    const hostStates: string[] = []
    const receipts: unknown[] = []
    const childStatuses: ProjectionEffectHostResult[] = []
    let resolveStart!: (result: ProjectionEffectHostResult) => void
    mockLabController.start.mockImplementationOnce(
      () =>
        new Promise<ProjectionEffectHostResult>((resolve) => {
          resolveStart = resolve
        })
    )
    const readReceipt = (event: Event) => {
      if (event instanceof CustomEvent) receipts.push(event.detail)
    }
    window.addEventListener(PROJECTION_EFFECT_RECEIPT_WINDOW_EVENT, readReceipt)
    render(
      <AvatarFireThunderEffectLayer
        intentRole="authoritative-host"
        onHostStateChange={(state) => hostStates.push(state)}
        onStatusChange={(result) => childStatuses.push(result)}
      />
    )

    act(() => {
      publishProjectionEffectIntent({
        action: 'start',
        effectId: 'fire',
        eventId: 'evt_00000000000000000000000000000035',
        turnId: 'turn-avatar-start-dedupe',
        schemaVersion: 1,
      })
    })
    await waitFor(() =>
      expect(mockLabController.start).toHaveBeenCalledTimes(1)
    )

    const started = hostResult('started')
    act(() => mockLayerOnStatusChange?.(started))
    expect(hostStates).toEqual(['started'])

    await act(async () => {
      resolveStart(started)
      await Promise.resolve()
    })
    await waitFor(() => expect(receipts).toHaveLength(1))
    expect(hostStates).toEqual(['started'])
    expect(childStatuses).toEqual([started])
    expect(receipts).toEqual([
      {
        schemaVersion: 1,
        eventId: 'evt_00000000000000000000000000000035',
        status: 'completed',
        resultClass: 'started',
      },
    ])
    window.removeEventListener(
      PROJECTION_EFFECT_RECEIPT_WINDOW_EVENT,
      readReceipt
    )
  })

  it('reports a fixed unavailable Host result without false started state', async () => {
    const hostStates: string[] = []
    mockLabController.start.mockResolvedValueOnce(null)
    render(
      <AvatarFireThunderEffectLayer
        intentRole="authoritative-host"
        onHostStateChange={(state) => hostStates.push(state)}
      />
    )

    act(() => {
      publishProjectionEffectIntent({
        action: 'start',
        effectId: 'fire',
        eventId: 'evt_00000000000000000000000000000033',
        turnId: 'turn-avatar-host-unavailable',
        schemaVersion: 1,
      })
    })

    await waitFor(() =>
      expect(
        screen.getByTestId('avatar-fire-thunder-effect-layer')
      ).toHaveAttribute('data-projection-effect-host-state', 'host-unavailable')
    )
    expect(hostStates).toEqual(['host-unavailable'])
    expect(hostStates).not.toContain('started')
  })

  it('does not latch cleanup uncertainty after a cleared visual failure receipt', async () => {
    const receipts: unknown[] = []
    const hostStates: string[] = []
    const readReceipt = (event: Event) => {
      if (event instanceof CustomEvent) receipts.push(event.detail)
    }
    window.addEventListener(PROJECTION_EFFECT_RECEIPT_WINDOW_EVENT, readReceipt)
    mockLabController.start
      .mockResolvedValueOnce(hostResult('visual-failed'))
      .mockResolvedValueOnce(hostResult('started'))
    render(
      <AvatarFireThunderEffectLayer
        intentRole="authoritative-host"
        onHostStateChange={(state) => hostStates.push(state)}
      />
    )

    act(() => {
      publishProjectionEffectIntent({
        action: 'start',
        effectId: 'fire',
        eventId: 'evt_00000000000000000000000000000036',
        turnId: 'turn-avatar-cleared-visual-failure',
        schemaVersion: 1,
      })
    })
    await waitFor(() => expect(receipts).toHaveLength(1))
    act(() => {
      publishProjectionEffectIntent({
        action: 'start',
        effectId: 'fire',
        eventId: 'evt_00000000000000000000000000000037',
        turnId: 'turn-avatar-after-cleared-visual-failure',
        schemaVersion: 1,
      })
    })
    await waitFor(() => expect(receipts).toHaveLength(2))

    expect(mockLabController.start).toHaveBeenCalledTimes(2)
    expect(hostStates).toEqual(['host-rejected', 'started'])
    expect(receipts).toEqual([
      {
        schemaVersion: 1,
        eventId: 'evt_00000000000000000000000000000036',
        status: 'rejected',
        resultClass: 'host_rejected',
      },
      {
        schemaVersion: 1,
        eventId: 'evt_00000000000000000000000000000037',
        status: 'completed',
        resultClass: 'started',
      },
    ])
    window.removeEventListener(
      PROJECTION_EFFECT_RECEIPT_WINDOW_EVENT,
      readReceipt
    )
  })

  it('latches cleanup uncertainty after a retained visual failure receipt', async () => {
    const receipts: unknown[] = []
    const hostStates: string[] = []
    const readReceipt = (event: Event) => {
      if (event instanceof CustomEvent) receipts.push(event.detail)
    }
    window.addEventListener(PROJECTION_EFFECT_RECEIPT_WINDOW_EVENT, readReceipt)
    mockLabController.start.mockResolvedValueOnce({
      ...hostResult('visual-failed'),
      activeEffectId: 'fire',
    })
    render(
      <AvatarFireThunderEffectLayer
        intentRole="authoritative-host"
        onHostStateChange={(state) => hostStates.push(state)}
      />
    )

    act(() => {
      publishProjectionEffectIntent({
        action: 'start',
        effectId: 'fire',
        eventId: 'evt_00000000000000000000000000000038',
        turnId: 'turn-avatar-retained-visual-failure',
        schemaVersion: 1,
      })
    })
    await waitFor(() => expect(receipts).toHaveLength(1))
    act(() => {
      publishProjectionEffectIntent({
        action: 'start',
        effectId: 'fire',
        eventId: 'evt_00000000000000000000000000000039',
        turnId: 'turn-avatar-after-retained-visual-failure',
        schemaVersion: 1,
      })
    })
    await waitFor(() => expect(receipts).toHaveLength(2))

    expect(mockLabController.start).toHaveBeenCalledTimes(1)
    expect(hostStates).toEqual(['cleanup-unproved', 'cleanup-unproved'])
    expect(receipts).toEqual([
      {
        schemaVersion: 1,
        eventId: 'evt_00000000000000000000000000000038',
        status: 'cleanup_unproved',
        resultClass: 'cleanup_unproved',
      },
      {
        schemaVersion: 1,
        eventId: 'evt_00000000000000000000000000000039',
        status: 'cleanup_unproved',
        resultClass: 'cleanup_unproved_sticky',
      },
    ])
    window.removeEventListener(
      PROJECTION_EFFECT_RECEIPT_WINDOW_EVENT,
      readReceipt
    )
  })

  it('fails closed when cross-tab delivery is unavailable', async () => {
    Object.defineProperty(globalThis, 'BroadcastChannel', {
      configurable: true,
      value: undefined,
      writable: true,
    })
    const receiverStates: string[] = []
    render(
      <AvatarFireThunderEffectLayer
        intentRole="authoritative-host"
        onIntentReceiverStateChange={(state) => receiverStates.push(state)}
      />
    )

    await waitFor(() =>
      expect(
        screen.getByTestId('avatar-fire-thunder-effect-layer')
      ).toHaveAttribute(
        'data-projection-effect-receiver-state',
        'cross-tab-unavailable'
      )
    )
    act(() => {
      window.dispatchEvent(
        new CustomEvent('sword:projection-effect-intent-v1', {
          detail: {
            action: 'start',
            effectId: 'fire',
            eventId: 'evt_00000000000000000000000000000031',
            turnId: 'turn-avatar-no-channel',
            schemaVersion: 1,
          },
        })
      )
    })
    await act(async () => {
      await Promise.resolve()
    })

    expect(receiverStates).toEqual(['cross-tab-unavailable'])
    expect(mockLabController.start).not.toHaveBeenCalled()
  })

  it('reports a receiver conflict without taking over the active receiver', async () => {
    const primaryStates: string[] = []
    const conflictStates: string[] = []
    render(
      <>
        <AvatarFireThunderEffectLayer
          intentRole="authoritative-host"
          onIntentReceiverStateChange={(state) => primaryStates.push(state)}
        />
        <AvatarFireThunderEffectLayer
          intentRole="authoritative-host"
          onIntentReceiverStateChange={(state) => conflictStates.push(state)}
        />
      </>
    )

    await waitFor(() => expect(primaryStates).toContain('ready'))
    await waitFor(() => expect(conflictStates).toContain('receiver-conflict'))
    act(() => {
      publishProjectionEffectIntent({
        action: 'start',
        effectId: 'thunderBall',
        eventId: 'evt_00000000000000000000000000000032',
        turnId: 'turn-avatar-conflict',
        schemaVersion: 1,
      })
    })
    await waitFor(() =>
      expect(mockLabController.start).toHaveBeenCalledTimes(1)
    )
    expect(primaryStates).toEqual(['ready'])
    expect(conflictStates).toEqual(['receiver-conflict'])
  })

  it('renders a completed Stage intent as an operator mirror without publishing a receipt', async () => {
    const mirrorStates: string[] = []
    const receiptSpy = jest.fn()
    window.addEventListener(PROJECTION_EFFECT_RECEIPT_WINDOW_EVENT, receiptSpy)
    const view = render(
      <AvatarFireThunderEffectLayer
        intentRole="receipt-mirror"
        onIntentMirrorStateChange={(state) => mirrorStates.push(state)}
      />
    )
    const peer = new TestBroadcastChannel(PROJECTION_EFFECT_INTENT_CHANNEL)
    const intent = {
      schemaVersion: 1,
      eventId: 'evt_00000000000000000000000000000044',
      turnId: 'turn-avatar-mirror',
      action: 'start',
      effectId: 'fire',
    } as const

    act(() => {
      peer.postMessage({
        schemaVersion: 1,
        kind: 'intent',
        origin: window.location.origin,
        intent,
      })
    })
    expect(mockLabController.start).not.toHaveBeenCalled()

    act(() => {
      peer.postMessage({
        schemaVersion: 1,
        kind: 'receipt',
        origin: window.location.origin,
        receipt: {
          schemaVersion: 1,
          eventId: intent.eventId,
          status: 'completed',
          resultClass: 'started',
        },
      })
    })

    await waitFor(() =>
      expect(mockLabController.start).toHaveBeenCalledWith('fire')
    )
    expect(receiptSpy).not.toHaveBeenCalled()
    expect(mirrorStates).toEqual(['mirror-ready'])
    view.unmount()
    expect(mirrorStates).toEqual(['mirror-ready', 'disposed'])
    peer.close()
    window.removeEventListener(
      PROJECTION_EFFECT_RECEIPT_WINDOW_EVENT,
      receiptSpy
    )
  })

  it('serializes enabled conversation start, stop, and reset intents', async () => {
    let resolveStart!: () => void
    mockLabController.start.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveStart = () => resolve(hostResult('started'))
        })
    )
    render(<AvatarFireThunderEffectLayer intentRole="authoritative-host" />)

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
      <AvatarFireThunderEffectLayer intentRole="authoritative-host" />
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
    render(<AvatarFireThunderEffectLayer intentRole="manual" />)
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

  it('does not make a manual surface a production intent receiver', async () => {
    render(<AvatarFireThunderEffectLayer intentRole="manual" />)

    const layer = screen.getByTestId('avatar-fire-thunder-effect-layer')
    expect(layer).toHaveAttribute('data-projection-effect-host-role', 'manual')
    expect(layer).toHaveAttribute(
      'data-projection-effect-receiver-state',
      'inactive'
    )

    act(() => {
      publishProjectionEffectIntent({
        schemaVersion: 1,
        eventId: 'evt_00000000000000000000000000000044',
        turnId: 'turn-manual-surface',
        action: 'start',
        effectId: 'fire',
      })
    })
    await act(async () => {
      await Promise.resolve()
    })
    expect(mockLabController.start).not.toHaveBeenCalled()
  })

  it('reserves planned revisions before the queue and rejects duplicate, collision, and session mismatch', async () => {
    let resolvePlan!: () => void
    mockLabController.startPlan.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolvePlan = () =>
            resolve({
              status: 'accepted',
              hostResult: hostResult('started'),
            })
        })
    )
    render(<AvatarFireThunderEffectLayer intentRole="authoritative-host" />)
    const acceptedPlan = performancePlan()

    act(() => {
      publishProjectionEffectIntent({
        schemaVersion: 2,
        eventId: 'evt_00000000000000000000000000000020',
        turnId: 'turn-avatar-plan',
        action: 'start',
        plan: acceptedPlan,
      })
      publishProjectionEffectIntent({
        schemaVersion: 2,
        eventId: 'evt_00000000000000000000000000000021',
        turnId: 'turn-avatar-plan',
        action: 'start',
        plan: acceptedPlan,
      })
      publishProjectionEffectIntent({
        schemaVersion: 2,
        eventId: 'evt_00000000000000000000000000000022',
        turnId: 'turn-avatar-plan',
        action: 'start',
        plan: performancePlan({ strength: 0.75 }),
      })
      publishProjectionEffectIntent({
        schemaVersion: 2,
        eventId: 'evt_00000000000000000000000000000023',
        turnId: 'turn-avatar-plan',
        action: 'start',
        plan: performancePlan({ sessionId: 'session-other' }),
      })
    })

    await waitFor(() =>
      expect(mockLabController.startPlan).toHaveBeenCalledTimes(1)
    )
    expect(mockLabController.start).not.toHaveBeenCalled()
    await act(async () => {
      resolvePlan()
      await Promise.resolve()
    })
    expect(mockLabController.startPlan).toHaveBeenCalledWith(acceptedPlan)
  })

  it('publishes a fixed rejection for a busy planned start without retrying', async () => {
    const receipts: unknown[] = []
    const hostStates: string[] = []
    const readReceipt = (event: Event) => {
      if (event instanceof CustomEvent) receipts.push(event.detail)
    }
    window.addEventListener(PROJECTION_EFFECT_RECEIPT_WINDOW_EVENT, readReceipt)
    mockLabController.startPlan.mockResolvedValueOnce({
      status: 'busy',
      hostResult: null,
    })
    render(
      <AvatarFireThunderEffectLayer
        intentRole="authoritative-host"
        onHostStateChange={(state) => hostStates.push(state)}
      />
    )

    act(() => {
      publishProjectionEffectIntent({
        schemaVersion: 2,
        eventId: 'evt_00000000000000000000000000000024',
        turnId: 'turn-avatar-plan-busy',
        action: 'start',
        plan: performancePlan(),
      })
    })
    await waitFor(() => expect(receipts).toHaveLength(1))
    expect(mockLabController.startPlan).toHaveBeenCalledTimes(1)
    expect(mockLabController.start).not.toHaveBeenCalled()
    expect(hostStates).toEqual(['host-rejected'])
    expect(receipts).toEqual([
      {
        schemaVersion: 1,
        eventId: 'evt_00000000000000000000000000000024',
        status: 'rejected',
        resultClass: 'host_rejected',
      },
    ])
    window.removeEventListener(
      PROJECTION_EFFECT_RECEIPT_WINDOW_EVENT,
      readReceipt
    )
  })

  it('rejects new and replayed live IDs at cap, then accepts after expiry', async () => {
    const now = jest.spyOn(Date, 'now').mockReturnValue(1_000)
    try {
      render(<AvatarFireThunderEffectLayer intentRole="authoritative-host" />)
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
    render(<AvatarFireThunderEffectLayer intentRole="authoritative-host" />)

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
    const hostStates: string[] = []
    const readReceipt = (event: Event) => {
      if (event instanceof CustomEvent) receipts.push(event.detail)
    }
    window.addEventListener(PROJECTION_EFFECT_RECEIPT_WINDOW_EVENT, readReceipt)
    mockLabController.start.mockRejectedValueOnce(new Error('private failure'))
    render(
      <AvatarFireThunderEffectLayer
        intentRole="authoritative-host"
        onHostStateChange={(state) => hostStates.push(state)}
      />
    )

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
    expect(hostStates).toEqual(['cleanup-unproved', 'cleanup-unproved'])
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
      <AvatarFireThunderEffectLayer intentRole="authoritative-host" />
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

function performancePlan(
  overrides: Partial<ProjectionPerformancePlan> = {}
): ProjectionPerformancePlan {
  return {
    schemaVersion: 1,
    planId: 'plan-avatar-overlay',
    sessionId: 'session-avatar-overlay',
    revision: 1,
    action: 'start',
    effectId: 'fire',
    position: { x: 0.3, y: -0.25 },
    strength: 0.5,
    durationMs: 3_000,
    seed: 7,
    keyframes: [
      {
        atMs: 0,
        position: { x: 0.3, y: -0.25 },
        strength: 0.5,
      },
    ],
    ...overrides,
  }
}
