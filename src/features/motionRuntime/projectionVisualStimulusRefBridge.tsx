import { useEffect, useRef } from 'react'

import {
  MOTION_STIMULUS_RECEIVER_EVENT,
  type MotionStimulusReceiverResult,
} from './motionStimulusReceiver'
import {
  clearProjectionVisualControlledChromeObservationDomSummary,
  CONTROLLED_CHROME_OBSERVATION_PRETRIGGER_MS,
  CONTROLLED_CHROME_OBSERVATION_SAMPLE_INTERVAL_MS,
  CONTROLLED_CHROME_OBSERVATION_TOTAL_MS,
  ProjectionVisualControlledChromeObservationSession,
  publishProjectionVisualControlledChromeObservationDomSummary,
} from './projectionVisualControlledChromeObservation'
import {
  buildProjectionVisualRuntimeDomSummaryAttributes,
  createProjectionVisualMotionStimulusFromRef,
  PROJECTION_VISUAL_RUNTIME_DOM_SUMMARY_ATTRIBUTE_NAMES,
  PROJECTION_VISUAL_STIMULUS_DISPATCH_ADAPTER_GLOBAL,
  PROJECTION_VISUAL_STIMULUS_DISPATCH_ADAPTER_SCHEMA_VERSION,
  readTraceString,
  safeStimulusString,
  type ProjectionVisualStimulusDispatchAdapterState,
  type ProjectionVisualStimulusDispatchTimeline,
  type ProjectionVisualStimulusRef,
} from './projectionVisualStimulusTransport'

const DISPATCH_READY_RETRY_INTERVAL_MS = 100
const DISPATCH_READY_TIMEOUT_MS = 15_000

export function ProjectionVisualStimulusRefBridge({
  enabled,
  stimulusRef,
}: {
  enabled: boolean
  stimulusRef?: ProjectionVisualStimulusRef
}) {
  const dispatchedKeyRef = useRef<string | null>(null)

  useEffect(() => {
    if (!enabled || !stimulusRef || typeof window === 'undefined') return

    const dispatchKey = `${stimulusRef}:${window.location.href}`
    if (dispatchedKeyRef.current === dispatchKey) return

    let cancelled = false
    let retryTimer: number | undefined
    let dispatchTimer: number | undefined
    let observationTimer: number | undefined
    let observationCompleteTimer: number | undefined
    let observationFrame: number | undefined
    let observationFrameRequestedAtMs: number | undefined
    let observationSession:
      | ProjectionVisualControlledChromeObservationSession
      | undefined
    let latestState: ProjectionVisualStimulusDispatchAdapterState | undefined
    let dispatchTimeline: ProjectionVisualStimulusDispatchTimeline = {
      capture_started_at_ms: 0,
      motion_requested_at_ms: CONTROLLED_CHROME_OBSERVATION_PRETRIGGER_MS,
    }
    const startedAtMs = Date.now()

    const publishState = (
      state: ProjectionVisualStimulusDispatchAdapterState
    ) => {
      latestState = state
      ;(
        window as typeof window & {
          [PROJECTION_VISUAL_STIMULUS_DISPATCH_ADAPTER_GLOBAL]?: ProjectionVisualStimulusDispatchAdapterState
        }
      )[PROJECTION_VISUAL_STIMULUS_DISPATCH_ADAPTER_GLOBAL] = state
      publishRuntimeSummaryDomAttributes(state)
      publishControlledChromeObservationSummary(state, observationSession)
    }

    const attemptDispatch = () => {
      if (cancelled) return

      if (!isProjectionVisualVrmReady()) {
        const elapsedMs = Date.now() - startedAtMs
        if (elapsedMs >= DISPATCH_READY_TIMEOUT_MS) {
          publishState({
            schema_version:
              PROJECTION_VISUAL_STIMULUS_DISPATCH_ADAPTER_SCHEMA_VERSION,
            transport: 'projection_visual_safe_query_ref',
            stimulus_ref: stimulusRef,
            status: 'timeout',
            reason_code: 'vrm_runtime_not_ready_for_safe_ref_dispatch',
            dispatch_timeline: dispatchTimeline,
          })
          return
        }
        publishState({
          schema_version:
            PROJECTION_VISUAL_STIMULUS_DISPATCH_ADAPTER_SCHEMA_VERSION,
          transport: 'projection_visual_safe_query_ref',
          stimulus_ref: stimulusRef,
          status: 'waiting_for_vrm',
          reason_code: 'waiting_for_vrm_runtime_ready',
          dispatch_timeline: dispatchTimeline,
        })
        retryTimer = window.setTimeout(
          attemptDispatch,
          DISPATCH_READY_RETRY_INTERVAL_MS
        )
        return
      }

      const root = document.querySelector<HTMLElement>(
        '[data-projection-visual-mode]'
      )
      if (!root) {
        publishState({
          schema_version:
            PROJECTION_VISUAL_STIMULUS_DISPATCH_ADAPTER_SCHEMA_VERSION,
          transport: 'projection_visual_safe_query_ref',
          stimulus_ref: stimulusRef,
          status: 'unavailable',
          reason_code: 'projection_visual_root_not_available',
          dispatch_timeline: dispatchTimeline,
        })
        return
      }

      observationSession =
        new ProjectionVisualControlledChromeObservationSession({
          stimulusRef,
          root,
        })
      observationSession.recordSample({
        postRenderAnchorSource: 'record_sample_call',
      })
      const sampleObservation = () => {
        if (observationFrame) {
          const elapsedMs = observationSession?.elapsedMs()
          if (
            typeof elapsedMs === 'number' &&
            typeof observationFrameRequestedAtMs === 'number' &&
            elapsedMs - observationFrameRequestedAtMs >=
              CONTROLLED_CHROME_OBSERVATION_SAMPLE_INTERVAL_MS
          ) {
            observationFrameRequestedAtMs = elapsedMs
            observationSession?.recordSample({
              postRenderAnchorSource: 'record_sample_call',
            })
            if (latestState && observationSession) {
              publishControlledChromeObservationSummary(
                latestState,
                observationSession
              )
            }
          }
          return
        }
        const runSample = () => {
          observationFrame = undefined
          observationFrameRequestedAtMs = undefined
          observationSession?.recordSample({
            postRenderAnchorSource: 'request_animation_frame',
          })
          if (latestState && observationSession) {
            publishControlledChromeObservationSummary(
              latestState,
              observationSession
            )
          }
        }
        if (typeof window.requestAnimationFrame === 'function') {
          observationFrameRequestedAtMs = observationSession?.elapsedMs()
          observationFrame = window.requestAnimationFrame(runSample)
        } else {
          runSample()
        }
      }
      sampleObservation()
      observationTimer = window.setInterval(
        sampleObservation,
        CONTROLLED_CHROME_OBSERVATION_SAMPLE_INTERVAL_MS
      )
      observationCompleteTimer = window.setTimeout(() => {
        observationSession?.complete()
        if (observationTimer) window.clearInterval(observationTimer)
        observationTimer = undefined
        if (latestState && observationSession) {
          publishControlledChromeObservationSummary(
            latestState,
            observationSession
          )
        }
      }, CONTROLLED_CHROME_OBSERVATION_TOTAL_MS)

      const stimulus = createProjectionVisualMotionStimulusFromRef(stimulusRef)
      const dispatchStimulus = () => {
        if (cancelled) return

        const resultHandler = (event: Event) => {
          const result =
            event instanceof CustomEvent
              ? (event.detail as MotionStimulusReceiverResult | undefined)
              : undefined
          dispatchTimeline = {
            ...dispatchTimeline,
            result_event_observed_at_ms:
              observationSession?.elapsedMs() ??
              dispatchTimeline.stimulus_dispatched_at_ms,
          }
          publishState({
            schema_version:
              PROJECTION_VISUAL_STIMULUS_DISPATCH_ADAPTER_SCHEMA_VERSION,
            transport: 'projection_visual_safe_query_ref',
            stimulus_ref: stimulusRef,
            status: 'dispatched',
            reason_code: 'motion_stimulus_result_observed',
            motion_event_id: safeStimulusString(stimulus.motion_event_id),
            stimulus_id: safeStimulusString(stimulus.stimulus_id),
            stimulus_instance_id: safeStimulusString(
              stimulus.stimulus_instance_id
            ),
            runtime_result_id:
              result?.runtime_result_id ??
              readTraceString(stimulus, 'runtime_result_id'),
            driver_result_id:
              result?.driver_result_id ??
              readTraceString(stimulus, 'driver_result_id'),
            dispatch_timeline: dispatchTimeline,
            result: result
              ? {
                  accepted: result.accepted,
                  status: result.status,
                  reason_code: result.reason_code,
                  safe_visible_state: result.safe_visible_state,
                  motion_event_id: result.motion_event_id,
                  stimulus_id: result.stimulus_id,
                  stimulus_instance_id: result.stimulus_instance_id,
                  runtime_result_id: result.runtime_result_id,
                  driver_result_id: result.driver_result_id,
                  multi_stimulus_group_id: result.multi_stimulus_group_id,
                }
              : undefined,
          })
        }

        window.addEventListener(
          'projection-visual-motion-stimulus-result',
          resultHandler,
          { once: true }
        )
        dispatchTimeline = {
          ...dispatchTimeline,
          stimulus_dispatched_at_ms:
            observationSession?.elapsedMs() ??
            CONTROLLED_CHROME_OBSERVATION_PRETRIGGER_MS,
        }
        window.dispatchEvent(
          new CustomEvent(MOTION_STIMULUS_RECEIVER_EVENT, {
            detail: stimulus,
          })
        )
        dispatchedKeyRef.current = dispatchKey
        publishState({
          schema_version:
            PROJECTION_VISUAL_STIMULUS_DISPATCH_ADAPTER_SCHEMA_VERSION,
          transport: 'projection_visual_safe_query_ref',
          stimulus_ref: stimulusRef,
          status: 'dispatched',
          reason_code: 'motion_stimulus_dispatched',
          motion_event_id: safeStimulusString(stimulus.motion_event_id),
          stimulus_id: safeStimulusString(stimulus.stimulus_id),
          stimulus_instance_id: safeStimulusString(
            stimulus.stimulus_instance_id
          ),
          runtime_result_id: readTraceString(stimulus, 'runtime_result_id'),
          driver_result_id: readTraceString(stimulus, 'driver_result_id'),
          dispatch_timeline: dispatchTimeline,
        })
      }

      dispatchTimer = window.setTimeout(
        dispatchStimulus,
        CONTROLLED_CHROME_OBSERVATION_PRETRIGGER_MS
      )
      publishState({
        schema_version:
          PROJECTION_VISUAL_STIMULUS_DISPATCH_ADAPTER_SCHEMA_VERSION,
        transport: 'projection_visual_safe_query_ref',
        stimulus_ref: stimulusRef,
        status: 'waiting_for_vrm',
        reason_code: 'collecting_pretrigger_controlled_chrome_observation',
        motion_event_id: safeStimulusString(stimulus.motion_event_id),
        stimulus_id: safeStimulusString(stimulus.stimulus_id),
        stimulus_instance_id: safeStimulusString(stimulus.stimulus_instance_id),
        runtime_result_id: readTraceString(stimulus, 'runtime_result_id'),
        driver_result_id: readTraceString(stimulus, 'driver_result_id'),
        dispatch_timeline: dispatchTimeline,
      })
    }

    attemptDispatch()

    return () => {
      cancelled = true
      if (retryTimer) window.clearTimeout(retryTimer)
      if (dispatchTimer) window.clearTimeout(dispatchTimer)
      if (observationTimer) window.clearInterval(observationTimer)
      if (observationCompleteTimer)
        window.clearTimeout(observationCompleteTimer)
      if (observationFrame) window.cancelAnimationFrame(observationFrame)
      const root = document.querySelector<HTMLElement>(
        '[data-projection-visual-mode]'
      )
      if (root) clearProjectionVisualControlledChromeObservationDomSummary(root)
    }
  }, [enabled, stimulusRef])

  return null
}

function isProjectionVisualVrmReady(): boolean {
  const projectionWindow = window as typeof window & {
    __projectionVisualMotionRuntimeDebugSnapshot?: {
      vrmReady?: unknown
      sceneVisible?: unknown
    }
  }
  const snapshot = projectionWindow.__projectionVisualMotionRuntimeDebugSnapshot
  return snapshot?.vrmReady === true && snapshot.sceneVisible === true
}

function publishRuntimeSummaryDomAttributes(
  state: ProjectionVisualStimulusDispatchAdapterState
) {
  const root = document.querySelector<HTMLElement>(
    '[data-projection-visual-mode]'
  )
  if (!root) return

  for (const attributeName of PROJECTION_VISUAL_RUNTIME_DOM_SUMMARY_ATTRIBUTE_NAMES) {
    root.removeAttribute(attributeName)
  }

  const attributes = buildProjectionVisualRuntimeDomSummaryAttributes(state)
  for (const [attributeName, value] of Object.entries(attributes)) {
    root.setAttribute(attributeName, value)
  }
}

function publishControlledChromeObservationSummary(
  state: ProjectionVisualStimulusDispatchAdapterState,
  observationSession:
    | ProjectionVisualControlledChromeObservationSession
    | undefined
) {
  if (!observationSession) return
  const root = document.querySelector<HTMLElement>(
    '[data-projection-visual-mode]'
  )
  if (!root) return
  publishProjectionVisualControlledChromeObservationDomSummary(
    root,
    observationSession.buildSummary(
      state,
      readControlledChromeRuntimeDiagnostics()
    )
  )
}

function readControlledChromeRuntimeDiagnostics() {
  const projectionWindow = window as typeof window & {
    __projectionVisualMotionRuntimeDebugSnapshot?: unknown
    __projectionVisualInPageDiagnosticsV0?: unknown
  }
  return {
    motionRuntimeDebugSnapshot:
      projectionWindow.__projectionVisualMotionRuntimeDebugSnapshot,
    inPageDiagnostics: projectionWindow.__projectionVisualInPageDiagnosticsV0,
  }
}
