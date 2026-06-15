import { render, waitFor } from '@testing-library/react'

import {
  MOTION_STIMULUS_RECEIVER_EVENT,
  MOTION_STIMULUS_RECEIVER_RESULT_EVENT,
  type MotionStimulusReceiverResult,
} from '../motionStimulusReceiver'
import { PROJECTION_VISUAL_CONTROLLED_CHROME_OBSERVATION_JSON_SCRIPT_ID } from '../projectionVisualControlledChromeObservation'
import { ProjectionVisualStimulusRefBridge } from '../projectionVisualStimulusRefBridge'

describe('ProjectionVisualStimulusRefBridge DOM runtime summary', () => {
  beforeEach(() => {
    document.body.innerHTML = [
      '<div',
      ' class="projection-visual"',
      ' data-projection-visual-mode="passive"',
      ' data-projection-visual-test-mode="self-mirror-baseline"',
      ' data-projection-visual-stimulus-ref="voice.dance_please"',
      '></div>',
    ].join('')
    ;(window as any).__projectionVisualMotionRuntimeDebugSnapshot = {
      vrmReady: true,
      sceneVisible: true,
      session: {
        instances: [
          {
            groupKey: 'dance.sequence',
            phase: 'active',
          },
        ],
      },
      poseFrame: {
        humanoidRotationBoneNames: ['hips'],
        humanoidTranslationBoneNames: [],
      },
    }
    ;(window as any).__projectionVisualInPageDiagnosticsV0 = {
      schema_version: 'projection_visual_in_page_diagnostics.v0',
      frame_seq: 12,
      frame_timestamp_mono_ms: 450.5,
      driver_frame_anchor: {
        frame_seq: 12,
        frame_timestamp_mono_ms: 450.5,
        reason_code: 'motion_pose_frame_observed',
        safe_visible_state: 'motion_started',
      },
      expression_value_summary: {
        expression_weight_applied: false,
        channel_names: [],
        frame_applied_count: 0,
      },
    }
  })

  afterEach(() => {
    delete (window as any).__projectionVisualMotionRuntimeDebugSnapshot
    delete (window as any).__projectionVisualInPageDiagnosticsV0
    delete (window as any).__projectionVisualStimulusDispatchAdapterV0
  })

  it('mirrors accepted runtime result refs to controlled-Chrome-readable root data attributes', async () => {
    const root = document.querySelector<HTMLElement>(
      '[data-projection-visual-mode]'
    ) as HTMLElement
    const receivedStimuli: Array<Record<string, unknown>> = []
    const receiver = (event: Event) => {
      const stimulus =
        event instanceof CustomEvent
          ? (event.detail as Record<string, unknown>)
          : {}
      receivedStimuli.push(stimulus)
      const result: MotionStimulusReceiverResult = {
        source_kind: 'thought_core_motion_stimulus_v0',
        debug_playback: false,
        accepted: true,
        status: 'started',
        reason_code: 'motion_runtime_vrma_started',
        safe_visible_state: 'motion_started',
        motion_event_id: stimulus.motion_event_id as string,
        stimulus_id: stimulus.stimulus_id as string,
        stimulus_instance_id: stimulus.stimulus_instance_id as string,
        runtime_result_id: 'mot_res_controlled_chrome_dance_actual_1',
        lifecycle_trace: [],
      }
      setTimeout(() => {
        window.dispatchEvent(
          new CustomEvent(MOTION_STIMULUS_RECEIVER_RESULT_EVENT, {
            detail: result,
          })
        )
      }, 0)
    }
    window.addEventListener(MOTION_STIMULUS_RECEIVER_EVENT, receiver)

    render(
      <ProjectionVisualStimulusRefBridge
        enabled
        stimulusRef="voice.dance_please"
      />
    )

    await waitFor(() => {
      expect(root).toHaveAttribute(
        'data-projection-visual-runtime-summary-result-status',
        'started'
      )
    })
    expect(receivedStimuli).toHaveLength(1)
    expect(root).toHaveAttribute(
      'data-projection-visual-runtime-summary-v0',
      'projection_visual_runtime_result_dom_summary.v0'
    )
    expect(root).toHaveAttribute(
      'data-projection-visual-runtime-summary-stimulus-ref',
      'voice.dance_please'
    )
    expect(root).toHaveAttribute(
      'data-projection-visual-runtime-summary-adapter-status',
      'dispatched'
    )
    expect(root).toHaveAttribute(
      'data-projection-visual-runtime-summary-adapter-reason-code',
      'motion_stimulus_result_observed'
    )
    expect(root).toHaveAttribute(
      'data-projection-visual-runtime-summary-runtime-result-id',
      'mot_res_controlled_chrome_dance_actual_1'
    )
    expect(root).toHaveAttribute(
      'data-projection-visual-runtime-summary-result-accepted',
      'true'
    )
    expect(root).toHaveAttribute(
      'data-projection-visual-runtime-summary-safe-visible-state',
      'motion_started'
    )
    expect(root).toHaveAttribute(
      'data-projection-visual-runtime-summary-raw-media-published',
      'false'
    )
    expect(root).toHaveAttribute(
      'data-projection-visual-runtime-summary-provider-payload-published',
      'false'
    )
    const adapterState = (window as any)
      .__projectionVisualStimulusDispatchAdapterV0
    expect(adapterState.dispatch_timeline).toEqual(
      expect.objectContaining({
        capture_started_at_ms: 0,
        motion_requested_at_ms: 300,
        stimulus_dispatched_at_ms: expect.any(Number),
        result_event_observed_at_ms: expect.any(Number),
      })
    )
    const script = document.getElementById(
      PROJECTION_VISUAL_CONTROLLED_CHROME_OBSERVATION_JSON_SCRIPT_ID
    ) as HTMLScriptElement
    const observationSummary = JSON.parse(script.textContent ?? '{}')
    expect(observationSummary.event_timeline).toEqual(
      expect.objectContaining({
        result_event_observed_at_ms: expect.any(Number),
        runtime_started_at_ms: expect.any(Number),
      })
    )
    expect(observationSummary.frame_applied_anchor).toEqual(
      expect.objectContaining({
        source: 'projection_visual_in_page_diagnostics.v0',
        dance_active_instance_count: 1,
        pose_frame_observed: true,
      })
    )
    expect(observationSummary.canvas_readback_summary).toEqual(
      expect.objectContaining({
        readback_status: 'unavailable',
      })
    )
    expect(JSON.stringify(observationSummary)).not.toContain(
      'provider_payload_raw'
    )
    expect(JSON.stringify(observationSummary)).not.toContain('entity_id')

    window.removeEventListener(MOTION_STIMULUS_RECEIVER_EVENT, receiver)
  })

  it('publishes waiting state to DOM while VRM runtime readiness is still false', async () => {
    ;(window as any).__projectionVisualMotionRuntimeDebugSnapshot = {
      vrmReady: false,
      sceneVisible: true,
    }
    const root = document.querySelector<HTMLElement>(
      '[data-projection-visual-mode]'
    ) as HTMLElement

    render(
      <ProjectionVisualStimulusRefBridge
        enabled
        stimulusRef="voice.smile_please"
      />
    )

    await waitFor(() => {
      expect(root).toHaveAttribute(
        'data-projection-visual-runtime-summary-adapter-status',
        'waiting_for_vrm'
      )
    })
    expect(root).toHaveAttribute(
      'data-projection-visual-runtime-summary-stimulus-ref',
      'voice.smile_please'
    )
    expect(root).toHaveAttribute(
      'data-projection-visual-runtime-summary-adapter-reason-code',
      'waiting_for_vrm_runtime_ready'
    )
    expect(root).not.toHaveAttribute(
      'data-projection-visual-runtime-summary-result-accepted'
    )
  })
})
