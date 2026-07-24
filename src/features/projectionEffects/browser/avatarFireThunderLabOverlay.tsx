import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import VrmViewer from '@/components/vrmViewer'
import type { ProjectionEffectHostResult } from '../effectHost'
import {
  publishProjectionEffectExecutionReceipt,
  subscribeProjectionEffectIntents,
  type ProjectionEffectExecutionReceipt,
  type ProjectionEffectIntent,
} from '../projectionEffectIntent'
import {
  FireThunderLabCanvasLayer,
  type FireThunderLabCanvasLayerProps,
  type FireThunderLabController,
  type FireThunderLabPlannedStartResult,
  type FireThunderLabVisualParameterOverrides,
} from './fireThunderLabCanvasLayer'
import { ProjectionPerformancePlanLedger } from './projectionPerformancePlanExecutor'

export const AVATAR_CAST_VISUAL_PARAMETER_OVERRIDES = {
  fire: {
    emitterX: 0.3,
    emitterY: -0.25,
    pointSize: 46,
  },
  thunderBall: {
    centerX: 0.28,
    centerY: -0.06,
    lineWidth: 3.8,
    orbRadius: 0.32,
  },
} as const satisfies Readonly<FireThunderLabVisualParameterOverrides>

// Keeps one in-flight Host call plus a short serial tail bounded. The transport
// dedupe cap is separate and must not be used as execution-queue capacity.
export const MAX_PENDING_PROJECTION_EFFECT_INTENTS = 16

export type AvatarFireThunderLabOverlayProps = Pick<
  FireThunderLabCanvasLayerProps,
  'onStatusChange' | 'reducedMotion'
> & {
  intentReceiverEnabled?: boolean
}

export const AvatarFireThunderLabOverlay = forwardRef<
  FireThunderLabController,
  AvatarFireThunderLabOverlayProps
>(function AvatarFireThunderLabOverlay(
  { intentReceiverEnabled = false, onStatusChange, reducedMotion = false },
  forwardedRef
) {
  const controllerRef = useRef<FireThunderLabController | null>(null)
  const performancePlanLedgerRef = useRef(new ProjectionPerformancePlanLedger())

  useImperativeHandle(
    forwardedRef,
    () => ({
      async emergencyStop() {
        const result = (await controllerRef.current?.emergencyStop()) ?? null
        return result
      },
      async reset() {
        const result = (await controllerRef.current?.reset()) ?? null
        return result
      },
      async start(effectId) {
        return (await controllerRef.current?.start(effectId)) ?? null
      },
      async startPlan(plan) {
        return (
          (await controllerRef.current?.startPlan?.(plan)) ?? {
            status: 'rejected',
            hostResult: null,
          }
        )
      },
      async stop() {
        return (await controllerRef.current?.stop()) ?? null
      },
    }),
    []
  )

  useEffect(() => {
    if (!intentReceiverEnabled) return

    let active = true
    let cleanupUnproved = false
    let pendingIntentCount = 0
    let queue: Promise<void> = Promise.resolve()
    const dispose = subscribeProjectionEffectIntents((intent) => {
      // The subscriber reserves each event ID synchronously in its bounded
      // TTL/cap map before invoking this callback, so duplicate transports
      // cannot race into the Host lifecycle queue.
      if (intent.schemaVersion === 2) {
        const reservation = performancePlanLedgerRef.current.reserve(
          intent.plan
        )
        if (reservation.status !== 'reserved') {
          publishProjectionEffectExecutionReceipt(
            executionReceipt(intent.eventId, 'rejected', 'host_rejected')
          )
          return
        }
      }
      if (pendingIntentCount >= MAX_PENDING_PROJECTION_EFFECT_INTENTS) {
        publishProjectionEffectExecutionReceipt(
          executionReceipt(
            intent.eventId,
            'rejected',
            'queue_capacity_exceeded'
          )
        )
        return
      }
      pendingIntentCount += 1
      queue = queue
        .then(async () => {
          try {
            if (!active) return
            if (cleanupUnproved) {
              publishProjectionEffectExecutionReceipt(
                executionReceipt(
                  intent.eventId,
                  'cleanup_unproved',
                  'cleanup_unproved_sticky'
                )
              )
              return
            }
            const controller = controllerRef.current
            if (!controller) {
              publishProjectionEffectExecutionReceipt(
                executionReceipt(intent.eventId, 'rejected', 'host_unavailable')
              )
              return
            }

            try {
              const result = await dispatchIntent(controller, intent)
              if (!active) return
              const receipt = receiptFromHostResult(intent, result)
              if (receipt.status === 'cleanup_unproved') cleanupUnproved = true
              publishProjectionEffectExecutionReceipt(receipt)
            } catch {
              if (!active) return
              cleanupUnproved = true
              publishProjectionEffectExecutionReceipt(
                executionReceipt(
                  intent.eventId,
                  'cleanup_unproved',
                  'cleanup_unproved'
                )
              )
            }
          } finally {
            pendingIntentCount -= 1
          }
        })
        .catch(() => {
          // The command body converts every owned failure to a fixed receipt.
          // Keep the queue alive without retrying an already reserved command.
        })
    })

    return () => {
      active = false
      dispose()
      performancePlanLedgerRef.current.clear()
    }
  }, [intentReceiverEnabled])

  return (
    <div
      className="pointer-events-none absolute inset-0 isolate"
      data-testid="avatar-fire-thunder-overlay"
    >
      <div
        className="absolute inset-0 z-0"
        data-testid="avatar-fire-thunder-avatar-layer"
      >
        <VrmViewer />
      </div>
      <div
        className="pointer-events-none absolute inset-0 z-10"
        data-testid="avatar-fire-thunder-effect-layer"
        data-projection-anchor-contract="fixed-stage-relative"
      >
        <FireThunderLabCanvasLayer
          ref={controllerRef}
          onStatusChange={onStatusChange}
          visualParameterOverrides={AVATAR_CAST_VISUAL_PARAMETER_OVERRIDES}
          reducedMotion={reducedMotion}
        />
      </div>
    </div>
  )
})

AvatarFireThunderLabOverlay.displayName = 'AvatarFireThunderLabOverlay'

async function dispatchIntent(
  controller: FireThunderLabController,
  intent: ProjectionEffectIntent
): Promise<
  ProjectionEffectHostResult | FireThunderLabPlannedStartResult | null
> {
  if (intent.schemaVersion === 2) {
    return controller.startPlan ? controller.startPlan(intent.plan) : null
  }
  if (intent.action === 'start') return controller.start(intent.effectId)
  if (intent.action === 'stop') return controller.stop()
  return controller.reset()
}

function receiptFromHostResult(
  intent: ProjectionEffectIntent,
  result: ProjectionEffectHostResult | FireThunderLabPlannedStartResult | null
): ProjectionEffectExecutionReceipt {
  if (!result) {
    return executionReceipt(intent.eventId, 'rejected', 'host_unavailable')
  }
  if ('hostResult' in result) {
    if (result.status === 'accepted') {
      return executionReceipt(intent.eventId, 'completed', 'started')
    }
    if (result.status === 'cleanup_unproved') {
      return executionReceipt(
        intent.eventId,
        'cleanup_unproved',
        'cleanup_unproved'
      )
    }
    return executionReceipt(intent.eventId, 'rejected', 'host_rejected')
  }
  const cleanupUnproved =
    result.status === 'blocked-terminal-cleanup' ||
    result.status === 'stop-failed' ||
    result.status === 'visual-failed' ||
    result.partialReasons.some(
      (reason) =>
        reason === 'sfx-prepare-cleanup-failed' ||
        reason === 'sfx-start-cleanup-failed' ||
        reason === 'visual-stop-failed' ||
        reason === 'visual-dispose-failed'
    )
  if (cleanupUnproved) {
    return executionReceipt(
      intent.eventId,
      'cleanup_unproved',
      'cleanup_unproved'
    )
  }
  if (intent.action === 'start' && result.status === 'started') {
    return executionReceipt(intent.eventId, 'completed', 'started')
  }
  if (
    intent.action === 'stop' &&
    (result.status === 'stopped' || result.status === 'no-active-effect')
  ) {
    return executionReceipt(intent.eventId, 'completed', 'stopped')
  }
  if (
    intent.action === 'reset' &&
    (result.status === 'reset' || result.status === 'no-active-effect')
  ) {
    return executionReceipt(intent.eventId, 'completed', 'reset')
  }
  return executionReceipt(intent.eventId, 'rejected', 'host_rejected')
}

function executionReceipt(
  eventId: string,
  status: ProjectionEffectExecutionReceipt['status'],
  resultClass: ProjectionEffectExecutionReceipt['resultClass']
): ProjectionEffectExecutionReceipt {
  return Object.freeze({ schemaVersion: 1, eventId, status, resultClass })
}
