/**
 * @jest-environment jsdom
 */

import {
  buildProjectionVisualControlledChromeObservationDomAttributes,
  ProjectionVisualControlledChromeObservationSession,
  PROJECTION_VISUAL_CONTROLLED_CHROME_OBSERVATION_ATTRIBUTE,
  PROJECTION_VISUAL_CONTROLLED_CHROME_OBSERVATION_JSON_SCRIPT_ID,
  PROJECTION_VISUAL_CONTROLLED_CHROME_OBSERVATION_SCHEMA_VERSION,
  publishProjectionVisualControlledChromeObservationDomSummary,
} from '../projectionVisualControlledChromeObservation'
import type { ProjectionVisualStimulusDispatchAdapterState } from '../projectionVisualStimulusTransport'

type NormalizedRect = { x: number; y: number; w: number; h: number }

function rectsOverlap(left: NormalizedRect, right: NormalizedRect): boolean {
  return (
    left.x < right.x + right.w &&
    left.x + left.w > right.x &&
    left.y < right.y + right.h &&
    left.y + left.h > right.y
  )
}

const resultState: ProjectionVisualStimulusDispatchAdapterState = {
  schema_version: 'projection_visual_stimulus_dispatch_adapter.v0',
  transport: 'projection_visual_safe_query_ref',
  stimulus_ref: 'voice.dance_please',
  status: 'dispatched',
  reason_code: 'motion_stimulus_result_observed',
  motion_event_id: 'mot_evt_controlled_chrome_dance_1',
  stimulus_id: 'mot_stim_controlled_chrome_voice_dance_please',
  stimulus_instance_id: 'mot_inst_controlled_chrome_dance_1',
  runtime_result_id: 'mot_res_controlled_chrome_dance_planned_1',
  dispatch_timeline: {
    capture_started_at_ms: 0,
    motion_requested_at_ms: 300,
    stimulus_dispatched_at_ms: 302.5,
    result_event_observed_at_ms: 336.25,
  },
  result: {
    accepted: true,
    status: 'started',
    reason_code: 'motion_runtime_vrma_started',
    safe_visible_state: 'motion_started',
    motion_event_id: 'mot_evt_controlled_chrome_dance_1',
    stimulus_id: 'mot_stim_controlled_chrome_voice_dance_please',
    stimulus_instance_id: 'mot_inst_controlled_chrome_dance_1',
    runtime_result_id: 'mot_res_controlled_chrome_dance_actual_1',
    multi_stimulus_group_id: 'multi_stimulus_controlled_chrome_1',
  },
}

describe('Projection Visual controlled Chrome observation producer', () => {
  beforeEach(() => {
    jest.restoreAllMocks()
    document.body.innerHTML =
      '<div data-projection-visual-mode="passive"><canvas width="100" height="100"></canvas></div>'
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      value: 1280,
    })
    Object.defineProperty(window, 'innerHeight', {
      configurable: true,
      value: 720,
    })
  })

  it('produces summary-only ROI/window metrics from bounded in-page canvas samples', () => {
    let nowMs = 0
    const root = document.querySelector<HTMLElement>(
      '[data-projection-visual-mode]'
    ) as HTMLElement
    const session = new ProjectionVisualControlledChromeObservationSession({
      stimulusRef: 'voice.dance_please',
      root,
      nowMs: () => nowMs,
      sampleProvider: ({ rois, elapsedMs }) =>
        rois.map((roi) => ({
          roi_id: roi.roi_id,
          source_kind: 'test_sample_provider',
          luma:
            roi.roi_id === 'avatar_full' && elapsedMs >= 300
              ? new Uint8Array([255, 255, 255, 255])
              : new Uint8Array([0, 0, 0, 0]),
        })),
    })

    session.recordSample()
    nowMs = 100
    session.recordSample()
    nowMs = 350
    session.recordSample()
    nowMs = 500
    session.recordSample()
    nowMs = 950
    session.recordSample()
    nowMs = 1250
    session.recordSample()
    session.complete()

    const summary = session.buildSummary(resultState)
    const avatarActiveMetric = summary.roi_window_metrics.find(
      (metric) =>
        metric.roi_id === 'avatar_full' && metric.window_id === 'active'
    )
    const guardActiveMetric = summary.roi_window_metrics.find(
      (metric) =>
        metric.roi_id === 'speech_bubble' && metric.window_id === 'active'
    )

    expect(summary).toEqual(
      expect.objectContaining({
        schema_version: 'self_mirror_controlled_chrome_observation.v0',
        source_kind: 'controlled_chrome_metric_summary',
        producer_status: 'complete',
        scenario_label: 'dance_visible_motion',
        expected_motion: 'broad_avatar_motion',
        raw_frame_included: false,
        raw_screenshot_included: false,
        raw_video_included: false,
        raw_log_included: false,
        provider_payload_included: false,
      })
    )
    expect(summary.target_identity).toEqual(
      expect.objectContaining({
        capture_surface_kind: 'controlled_chrome_extension_tab',
        same_page_or_target: true,
        proof_ceiling: 'controlled_chrome_self_mirror_summary_only',
        target_identity_status: 'page_summary_requires_runner_tab_safe_id',
      })
    )
    expect(summary.rois).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          roi_id: 'avatar_full',
          kind: 'avatar',
          counts_as_avatar_motion: true,
          expected_for_pass: true,
          rect_norm: { x: 0.45, y: 0, w: 0.38, h: 0.98 },
        }),
        expect.objectContaining({
          roi_id: 'speech_bubble',
          kind: 'guard_ui',
          counts_as_avatar_motion: false,
          expected_for_pass: false,
          rect_norm: { x: 0.03, y: 0.05, w: 0.28, h: 0.22 },
        }),
      ])
    )
    const avatarFullRoi = summary.rois.find(
      (roi) => roi.roi_id === 'avatar_full'
    )
    const speechBubbleRoi = summary.rois.find(
      (roi) => roi.roi_id === 'speech_bubble'
    )
    expect(avatarFullRoi?.rect_norm.x).toBeGreaterThan(
      (speechBubbleRoi?.rect_norm.x ?? 0) + (speechBubbleRoi?.rect_norm.w ?? 0)
    )
    expect(
      rectsOverlap(
        avatarFullRoi?.rect_norm as NormalizedRect,
        speechBubbleRoi?.rect_norm as NormalizedRect
      )
    ).toBe(false)
    expect(summary.runtime_join).toEqual(
      expect.objectContaining({
        stimulus_id: 'mot_stim_controlled_chrome_voice_dance_please',
        runtime_result_id: 'mot_res_controlled_chrome_dance_actual_1',
        result_status: 'started',
        result_reason_code: 'motion_runtime_vrma_started',
        result_safe_visible_state: 'motion_started',
      })
    )
    expect(summary.event_timeline).toEqual(
      expect.objectContaining({
        capture_started_at_ms: 0,
        motion_requested_at_ms: 300,
        stimulus_dispatched_at_ms: 302.5,
        result_event_observed_at_ms: 336.25,
        runtime_started_at_ms: 336.25,
      })
    )
    expect(summary.frame_applied_anchor).toEqual(
      expect.objectContaining({
        source: 'not_available',
        dance_active_instance_count: 0,
        pose_frame_observed: false,
      })
    )
    expect(summary.canvas_readback_summary).toEqual(
      expect.objectContaining({
        sample_attempt_count: 6,
        sample_rows_observed: 12,
        sample_source_kinds: ['test_sample_provider'],
        readback_unavailable_count: 0,
        luma_checksum_changed: true,
        readback_status: 'changed',
        readback_strategy: 'custom_sample_provider',
        readback_metric_readiness: 'ready',
        readback_metric_blocker_reason_codes: [],
        post_render_anchor: {
          source: 'record_sample_call',
          status: 'synchronous_sample',
        },
        readback_context_kinds: [],
        static_reason_codes: [],
      })
    )
    expect(summary.roi_window_coverage).toEqual(
      expect.objectContaining({
        expected_roi_window_count: 8,
        observed_roi_window_count: 8,
        missing_roi_window_count: 0,
        missing_window_reason_codes: [],
        active_sample_sufficient: true,
        min_authority_active_sample_count: 2,
        baseline_comparison_kind: 'mixed',
        luma_checksum_changed: true,
      })
    )
    expect(summary.roi_input_diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          roi_id: 'avatar_full',
          input_status: 'sampled_changed',
          sample_count: 6,
          luma_checksum_changed: true,
          diagnostic_reason_codes: ['roi_input_changed'],
        }),
        expect.objectContaining({
          roi_id: 'speech_bubble',
          input_status: 'sampled_static',
          sample_count: 6,
          luma_checksum_changed: false,
          diagnostic_reason_codes: ['roi_input_static'],
        }),
      ])
    )
    expect(summary.dance_avatar_full_readback_diagnostic).toEqual(
      expect.objectContaining({
        schema_version:
          'projection_visual_dance_avatar_full_readback_diagnostic.v0',
        diagnostic_class: 'metric_visible_motion_detected',
        authority_roi_input_status: 'sampled_changed',
        authority_active_sample_count: 2,
        guard_roi_checksum_changed: false,
        readback_metric_readiness: 'ready',
        raw_frame_included: false,
        raw_pixel_included: false,
      })
    )
    expect(summary.authority_roi_mapping_diagnostic).toEqual(
      expect.objectContaining({
        schema_version:
          'projection_visual_dance_authority_roi_mapping_diagnostic.v0',
        mapping_status: 'authority_roi_metric_active',
        decision_hint: 'authority_roi_accepted',
        authority_roi_id: 'avatar_full',
        guard_roi_id: 'speech_bubble',
        guard_roi_support_only: true,
        raw_frame_included: false,
        raw_pixel_included: false,
      })
    )
    expect(avatarActiveMetric?.sample_count).toBeGreaterThan(0)
    expect(avatarActiveMetric?.motion_score).toBeGreaterThan(0.12)
    expect(guardActiveMetric?.motion_score ?? 0).toBeLessThan(0.01)
    expect(JSON.stringify(summary)).not.toContain('http://')
    expect(JSON.stringify(summary)).not.toContain('provider_payload_raw')
    expect(JSON.stringify(summary)).not.toContain('entity_id')
    expect(JSON.stringify(summary)).not.toContain('C:/')
    expect(JSON.stringify(summary)).not.toContain('private_path_marker')
  })

  it('keeps stop-dance safe refs in a neutral idle observation scenario', () => {
    const root = document.querySelector<HTMLElement>(
      '[data-projection-visual-mode]'
    ) as HTMLElement
    const session = new ProjectionVisualControlledChromeObservationSession({
      stimulusRef: 'voice.stop_dance',
      root,
      sampleProvider: ({ rois }) =>
        rois.map((roi) => ({
          roi_id: roi.roi_id,
          source_kind: 'test_sample_provider',
          luma: new Uint8Array([0, 0, 0, 0]),
        })),
    })

    session.recordSample()
    session.complete()
    const summary = session.buildSummary({
      ...resultState,
      stimulus_ref: 'voice.stop_dance',
      motion_event_id: 'mot_evt_controlled_chrome_stop_1',
      stimulus_id: 'mot_stim_controlled_chrome_voice_stop_dance',
      stimulus_instance_id: 'mot_inst_controlled_chrome_stop_1',
      runtime_result_id: 'mot_res_controlled_chrome_stop_planned_1',
      result: {
        accepted: true,
        status: 'completed',
        reason_code: 'motion_stopped',
        safe_visible_state: 'neutral_idle_requested',
        motion_event_id: 'mot_evt_controlled_chrome_stop_1',
        stimulus_id: 'mot_stim_controlled_chrome_voice_stop_dance',
        stimulus_instance_id: 'mot_inst_controlled_chrome_stop_1',
        runtime_result_id: 'mot_res_controlled_chrome_stop_actual_1',
      },
    })

    expect(summary).toEqual(
      expect.objectContaining({
        stimulus_ref: 'voice.stop_dance',
        scenario_label: 'dance_stop_to_idle',
        expected_motion: 'neutral_idle_requested',
        raw_frame_included: false,
      })
    )
    expect(summary.runtime_join).toEqual(
      expect.objectContaining({
        motion_event_id: 'mot_evt_controlled_chrome_stop_1',
        stimulus_id: 'mot_stim_controlled_chrome_voice_stop_dance',
        result_reason_code: 'motion_stopped',
        result_safe_visible_state: 'neutral_idle_requested',
      })
    )
    expect(summary.dance_avatar_full_readback_diagnostic).toBeUndefined()
  })

  it('distinguishes static dance authority ROI from moving guard ROI without raw pixels', () => {
    let nowMs = 0
    const root = document.querySelector<HTMLElement>(
      '[data-projection-visual-mode]'
    ) as HTMLElement
    const session = new ProjectionVisualControlledChromeObservationSession({
      stimulusRef: 'voice.dance_please',
      root,
      nowMs: () => nowMs,
      sampleProvider: ({ rois, elapsedMs }) =>
        rois.map((roi) => ({
          roi_id: roi.roi_id,
          source_kind: 'test_sample_provider',
          luma:
            roi.roi_id === 'speech_bubble' && elapsedMs >= 300
              ? new Uint8Array([20, 80, 140, 200])
              : new Uint8Array([80, 80, 80, 80]),
        })),
    })

    session.recordSample()
    nowMs = 100
    session.recordSample()
    nowMs = 350
    session.recordSample()
    nowMs = 500
    session.recordSample()
    nowMs = 950
    session.recordSample()
    nowMs = 1250
    session.recordSample()
    session.complete()

    const summary = session.buildSummary(resultState, {
      motionRuntimeDebugSnapshot: {
        session: {
          instances: [
            {
              groupKey: 'dance.sequence',
              phase: 'active',
            },
          ],
        },
        poseFrame: {
          humanoidRotationBoneNames: ['hips', 'leftUpperArm'],
          humanoidTranslationBoneNames: ['hips'],
        },
      },
    })
    const attributes =
      buildProjectionVisualControlledChromeObservationDomAttributes(summary)
    const avatarActiveMetric = summary.roi_window_metrics.find(
      (metric) =>
        metric.roi_id === 'avatar_full' && metric.window_id === 'active'
    )
    const guardActiveMetric = summary.roi_window_metrics.find(
      (metric) =>
        metric.roi_id === 'speech_bubble' && metric.window_id === 'active'
    )

    expect(summary.canvas_readback_summary).toEqual(
      expect.objectContaining({
        readback_status: 'changed',
        readback_metric_readiness: 'ready',
      })
    )
    expect(summary.roi_window_coverage).toEqual(
      expect.objectContaining({
        missing_roi_window_count: 0,
        active_sample_sufficient: true,
        min_authority_active_sample_count: 2,
      })
    )
    expect(avatarActiveMetric).toEqual(
      expect.objectContaining({
        sample_count: 2,
        motion_score: 0,
        changed_ratio: 0,
        luma_checksum_changed: false,
      })
    )
    expect(guardActiveMetric?.motion_score ?? 0).toBeGreaterThan(0.12)
    expect(summary.roi_input_diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          roi_id: 'avatar_full',
          input_status: 'sampled_static',
          sample_count: 6,
          luma_min: 80,
          luma_max: 80,
          luma_range: 0,
          unique_luma_checksum_count: 1,
          luma_checksum_changed: false,
        }),
        expect.objectContaining({
          roi_id: 'speech_bubble',
          input_status: 'sampled_changed',
          luma_checksum_changed: true,
        }),
      ])
    )
    expect(summary.dance_avatar_full_readback_diagnostic).toEqual(
      expect.objectContaining({
        diagnostic_class: 'authority_roi_static_guard_changed',
        diagnostic_reason_codes: expect.arrayContaining([
          'authority_roi_input_sampled_static',
          'authority_roi_static_while_guard_roi_changes',
        ]),
        authority_roi_input_status: 'sampled_static',
        authority_active_sample_count: 2,
        authority_active_motion_score: 0,
        authority_active_changed_ratio: 0,
        guard_roi_checksum_changed: true,
        readback_metric_readiness: 'ready',
        pose_frame_observed: true,
        dance_active_instance_count: 1,
      })
    )
    expect(summary.authority_roi_mapping_diagnostic).toEqual(
      expect.objectContaining({
        schema_version:
          'projection_visual_dance_authority_roi_mapping_diagnostic.v0',
        mapping_status: 'authority_roi_unproven_static_region',
        decision_hint: 'alternate_authority_roi_decision_required',
        reason_codes: expect.arrayContaining([
          'authority_roi_input_sampled_static',
          'authority_roi_static_while_guard_roi_changes',
          'guard_roi_support_only_not_authority',
          'pose_frame_active_but_authority_roi_static',
        ]),
        authority_roi_id: 'avatar_full',
        authority_roi_kind: 'avatar',
        authority_roi_input_status: 'sampled_static',
        authority_active_sample_count: 2,
        authority_active_motion_score: 0,
        authority_active_changed_ratio: 0,
        guard_roi_id: 'speech_bubble',
        guard_roi_support_only: true,
        guard_roi_checksum_changed: true,
        pose_frame_observed: true,
        dance_active_instance_count: 1,
        raw_frame_included: false,
        raw_pixel_included: false,
      })
    )
    expect(attributes).toEqual(
      expect.objectContaining({
        'data-projection-visual-controlled-chrome-observation-authority-roi-input-status':
          'sampled_static',
        'data-projection-visual-controlled-chrome-observation-authority-roi-diagnostic-class':
          'authority_roi_static_guard_changed',
        'data-projection-visual-controlled-chrome-observation-authority-roi-sample-count':
          '6',
        'data-projection-visual-controlled-chrome-observation-authority-roi-luma-checksum-changed':
          'false',
        'data-projection-visual-controlled-chrome-observation-guard-roi-luma-checksum-changed':
          'true',
        'data-projection-visual-controlled-chrome-observation-authority-roi-mapping-status':
          'authority_roi_unproven_static_region',
        'data-projection-visual-controlled-chrome-observation-authority-roi-mapping-decision-hint':
          'alternate_authority_roi_decision_required',
        'data-projection-visual-controlled-chrome-observation-guard-roi-support-only':
          'true',
      })
    )
    expect(JSON.stringify(summary)).not.toContain('http://')
    expect(JSON.stringify(summary)).not.toContain('provider_payload_raw')
    expect(JSON.stringify(summary)).not.toContain('entity_id')
    expect(JSON.stringify(summary)).not.toContain('C:/')
    expect(JSON.stringify(summary)).not.toContain('private_path_marker')
  })

  it('diagnoses sparse first-active samples and missing post-active windows', () => {
    let nowMs = 0
    const root = document.querySelector<HTMLElement>(
      '[data-projection-visual-mode]'
    ) as HTMLElement
    const session = new ProjectionVisualControlledChromeObservationSession({
      stimulusRef: 'voice.dance_please',
      root,
      nowMs: () => nowMs,
      sampleProvider: ({ rois }) =>
        rois.map((roi) => ({
          roi_id: roi.roi_id,
          source_kind: 'test_sample_provider',
          luma: new Uint8Array([80, 80, 80, 80]),
        })),
    })

    nowMs = 350
    session.recordSample()
    session.complete()

    const summary = session.buildSummary(resultState)
    const avatarPretriggerMetric = summary.roi_window_metrics.find(
      (metric) =>
        metric.roi_id === 'avatar_full' && metric.window_id === 'pretrigger'
    )
    const avatarActiveMetric = summary.roi_window_metrics.find(
      (metric) =>
        metric.roi_id === 'avatar_full' && metric.window_id === 'active'
    )
    const avatarSettleMetric = summary.roi_window_metrics.find(
      (metric) =>
        metric.roi_id === 'avatar_full' && metric.window_id === 'settle'
    )
    const attributes =
      buildProjectionVisualControlledChromeObservationDomAttributes(summary)

    expect(summary.roi_window_metrics).toHaveLength(8)
    expect(avatarPretriggerMetric).toEqual(
      expect.objectContaining({
        sample_count: 0,
        missing_window_reason_code: 'pretrigger_window_missing',
        baseline_comparison_kind: 'no_sample',
      })
    )
    expect(avatarActiveMetric).toEqual(
      expect.objectContaining({
        sample_count: 1,
        motion_score: 0,
        changed_ratio: 0,
        first_sample_without_baseline_count: 1,
        comparable_sample_count: 0,
        baseline_comparison_kind: 'first_sample_no_previous',
        diagnostic_reason_codes: [
          'active_window_insufficient_samples',
          'first_active_sample_without_baseline',
        ],
      })
    )
    expect(avatarSettleMetric).toEqual(
      expect.objectContaining({
        sample_count: 0,
        missing_window_reason_code: 'settle_window_missing',
      })
    )
    expect(summary.roi_window_coverage).toEqual(
      expect.objectContaining({
        expected_roi_window_count: 8,
        observed_roi_window_count: 2,
        missing_roi_window_count: 6,
        active_sample_sufficient: false,
        min_authority_active_sample_count: 1,
        baseline_comparison_kind: 'first_sample_no_previous',
        first_sample_without_baseline_count: 2,
        comparable_sample_count: 0,
        luma_checksum_changed: false,
      })
    )
    expect(summary.roi_window_coverage.missing_window_reason_codes).toEqual(
      expect.arrayContaining([
        'active_window_insufficient_samples',
        'baseline_comparison_unavailable',
        'pretrigger_window_missing',
        'release_window_missing',
        'settle_window_missing',
      ])
    )
    expect(attributes).toEqual(
      expect.objectContaining({
        'data-projection-visual-controlled-chrome-observation-roi-window-coverage-status':
          'partial',
        'data-projection-visual-controlled-chrome-observation-roi-window-expected-count':
          '8',
        'data-projection-visual-controlled-chrome-observation-roi-window-observed-count':
          '2',
        'data-projection-visual-controlled-chrome-observation-roi-window-active-sample-sufficient':
          'false',
        'data-projection-visual-controlled-chrome-observation-roi-window-min-authority-active-sample-count':
          '1',
        'data-projection-visual-controlled-chrome-observation-roi-window-baseline-comparison-kind':
          'first_sample_no_previous',
        'data-projection-visual-controlled-chrome-observation-roi-window-missing-reason-code':
          'active_window_insufficient_samples',
      })
    )
    expect(JSON.stringify(summary)).not.toContain('http://')
    expect(JSON.stringify(summary)).not.toContain('provider_payload_raw')
    expect(JSON.stringify(summary)).not.toContain('entity_id')
    expect(JSON.stringify(summary)).not.toContain('C:/')
    expect(JSON.stringify(summary)).not.toContain('private_path_marker')
  })

  it('uses a presented-canvas 2D copy for post-render readback when WebGL preserveDrawingBuffer is false', () => {
    let nowMs = 0
    const root = document.querySelector<HTMLElement>(
      '[data-projection-visual-mode]'
    ) as HTMLElement
    const canvas = root.querySelector('canvas') as HTMLCanvasElement
    Object.defineProperty(canvas, 'clientWidth', {
      configurable: true,
      value: 200,
    })
    Object.defineProperty(canvas, 'clientHeight', {
      configurable: true,
      value: 120,
    })
    Object.defineProperty(window, 'devicePixelRatio', {
      configurable: true,
      value: 2,
    })
    const readPixels = jest.fn()
    Object.defineProperty(canvas, 'getContext', {
      configurable: true,
      value: jest.fn((contextId: string) =>
        contextId === 'webgl2'
          ? {
              RGBA: 6408,
              UNSIGNED_BYTE: 5121,
              getContextAttributes: () => ({
                preserveDrawingBuffer: false,
              }),
              readPixels,
            }
          : null
      ),
    })
    const originalCreateElement = document.createElement.bind(document)
    const drawImage = jest.fn()
    const getImageData = jest.fn(
      (_x: number, _y: number, width: number, height: number) => {
        const data = new Uint8ClampedArray(width * height * 4)
        data.fill(getImageData.mock.calls.length > 1 ? 255 : 0)
        return { data }
      }
    )
    jest.spyOn(document, 'createElement').mockImplementation((tagName) => {
      const element = originalCreateElement(tagName)
      if (tagName.toLowerCase() === 'canvas') {
        Object.defineProperty(element, 'getContext', {
          configurable: true,
          value: jest.fn((contextId: string) =>
            contextId === '2d' ? { drawImage, getImageData } : null
          ),
        })
      }
      return element
    })

    const session = new ProjectionVisualControlledChromeObservationSession({
      stimulusRef: 'voice.dance_please',
      root,
      nowMs: () => nowMs,
    })
    session.recordSample({ postRenderAnchorSource: 'request_animation_frame' })
    nowMs = 350
    session.recordSample({ postRenderAnchorSource: 'request_animation_frame' })
    session.complete()

    const summary = session.buildSummary(resultState)
    const attributes =
      buildProjectionVisualControlledChromeObservationDomAttributes(summary)

    expect(readPixels).not.toHaveBeenCalled()
    expect(drawImage).toHaveBeenCalled()
    expect(summary.canvas_readback_summary).toEqual(
      expect.objectContaining({
        sample_source_kinds: ['canvas_presented_2d_copy'],
        readback_context_kinds: ['2d'],
        static_reason_codes: [],
        readback_strategy: 'presented_canvas_2d_copy',
        readback_metric_readiness: 'ready',
        readback_metric_blocker_reason_codes: [],
        post_render_anchor: {
          source: 'request_animation_frame',
          status: 'post_render_sample_scheduled',
        },
        latest_canvas_buffer_width: 100,
        latest_canvas_buffer_height: 100,
        latest_canvas_client_width: 200,
        latest_canvas_client_height: 120,
        latest_device_pixel_ratio: 2,
        readback_status: 'changed',
      })
    )
    expect(attributes).toEqual(
      expect.objectContaining({
        'data-projection-visual-controlled-chrome-observation-canvas-readback-context-kind':
          '2d',
        'data-projection-visual-controlled-chrome-observation-canvas-readback-strategy':
          'presented_canvas_2d_copy',
        'data-projection-visual-controlled-chrome-observation-canvas-readback-metric-readiness':
          'ready',
        'data-projection-visual-controlled-chrome-observation-post-render-anchor-source':
          'request_animation_frame',
        'data-projection-visual-controlled-chrome-observation-post-render-anchor-status':
          'post_render_sample_scheduled',
      })
    )
    expect(JSON.stringify(summary)).not.toContain('http://')
    expect(JSON.stringify(summary)).not.toContain('provider_payload_raw')
    expect(JSON.stringify(summary)).not.toContain('entity_id')
    expect(JSON.stringify(summary)).not.toContain('C:/')
    expect(JSON.stringify(summary)).not.toContain('private_path_marker')
  })

  it('surfaces diagnostic-only WebGL default-framebuffer risk when presented 2D copy is unavailable', () => {
    let nowMs = 0
    const root = document.querySelector<HTMLElement>(
      '[data-projection-visual-mode]'
    ) as HTMLElement
    const canvas = root.querySelector('canvas') as HTMLCanvasElement
    Object.defineProperty(canvas, 'clientWidth', {
      configurable: true,
      value: 200,
    })
    Object.defineProperty(canvas, 'clientHeight', {
      configurable: true,
      value: 120,
    })
    Object.defineProperty(window, 'devicePixelRatio', {
      configurable: true,
      value: 2,
    })
    const readPixels = jest.fn(
      (
        _x: number,
        _y: number,
        _width: number,
        _height: number,
        _format: number,
        _type: number,
        pixels: Uint8Array
      ) => {
        pixels.fill(0)
      }
    )
    Object.defineProperty(canvas, 'getContext', {
      configurable: true,
      value: jest.fn((contextId: string) =>
        contextId === 'webgl2'
          ? {
              RGBA: 6408,
              UNSIGNED_BYTE: 5121,
              getContextAttributes: () => ({
                preserveDrawingBuffer: false,
              }),
              readPixels,
            }
          : null
      ),
    })
    const originalCreateElement = document.createElement.bind(document)
    jest.spyOn(document, 'createElement').mockImplementation((tagName) => {
      const element = originalCreateElement(tagName)
      if (tagName.toLowerCase() === 'canvas') {
        Object.defineProperty(element, 'getContext', {
          configurable: true,
          value: jest.fn(() => null),
        })
      }
      return element
    })

    const session = new ProjectionVisualControlledChromeObservationSession({
      stimulusRef: 'voice.dance_please',
      root,
      nowMs: () => nowMs,
    })
    session.recordSample({ postRenderAnchorSource: 'request_animation_frame' })
    nowMs = 350
    session.recordSample({ postRenderAnchorSource: 'request_animation_frame' })
    session.complete()

    const summary = session.buildSummary(resultState)
    const attributes =
      buildProjectionVisualControlledChromeObservationDomAttributes(summary)

    expect(readPixels).toHaveBeenCalled()
    expect(summary.canvas_readback_summary).toEqual(
      expect.objectContaining({
        sample_source_kinds: ['canvas_webgl_read_pixels'],
        readback_context_kinds: ['webgl2'],
        static_reason_codes: [
          'webgl_default_framebuffer_preserve_drawing_buffer_false',
        ],
        readback_strategy: 'webgl_default_framebuffer_read_pixels',
        readback_metric_readiness: 'diagnostic_only',
        readback_metric_blocker_reason_codes: [
          'webgl_default_framebuffer_preserve_drawing_buffer_false',
          'webgl_default_framebuffer_readback_diagnostic_only',
        ],
        post_render_anchor: {
          source: 'request_animation_frame',
          status: 'post_render_sample_scheduled',
        },
        latest_canvas_buffer_width: 100,
        latest_canvas_buffer_height: 100,
        latest_canvas_client_width: 200,
        latest_canvas_client_height: 120,
        latest_device_pixel_ratio: 2,
        readback_status: 'static',
      })
    )
    expect(attributes).toEqual(
      expect.objectContaining({
        'data-projection-visual-controlled-chrome-observation-canvas-readback-context-kind':
          'webgl2',
        'data-projection-visual-controlled-chrome-observation-canvas-readback-static-reason-code':
          'webgl_preserve_false',
        'data-projection-visual-controlled-chrome-observation-canvas-readback-strategy':
          'webgl_default_framebuffer_read_pixels',
        'data-projection-visual-controlled-chrome-observation-canvas-readback-metric-readiness':
          'diagnostic_only',
        'data-projection-visual-controlled-chrome-observation-canvas-readback-blocker-reason-code':
          'webgl_preserve_false',
        'data-projection-visual-controlled-chrome-observation-post-render-anchor-source':
          'request_animation_frame',
        'data-projection-visual-controlled-chrome-observation-post-render-anchor-status':
          'post_render_sample_scheduled',
      })
    )
    expect(JSON.stringify(summary)).not.toContain('http://')
    expect(JSON.stringify(summary)).not.toContain('provider_payload_raw')
    expect(JSON.stringify(summary)).not.toContain('entity_id')
    expect(JSON.stringify(summary)).not.toContain('C:/')
    expect(JSON.stringify(summary)).not.toContain('private_path_marker')
  })

  it('publishes controlled-Chrome-readable DOM attributes and bounded summary JSON', () => {
    const root = document.querySelector<HTMLElement>(
      '[data-projection-visual-mode]'
    ) as HTMLElement
    const session = new ProjectionVisualControlledChromeObservationSession({
      stimulusRef: 'voice.smile_please',
      root,
      nowMs: () => 0,
    })
    const summary = session.buildSummary(
      {
        ...resultState,
        stimulus_ref: 'voice.smile_please',
        result: {
          ...resultState.result!,
          reason_code: 'motion_runtime_expression_frame_queued',
          safe_visible_state: 'expression_change_requested',
          stimulus_id: 'mot_stim_controlled_chrome_voice_smile_please',
          runtime_result_id: 'mot_res_controlled_chrome_expression_actual_1',
          driver_result_id: 'driver_result_controlled_chrome_expression_1',
        },
      },
      {
        inPageDiagnostics: {
          schema_version: 'projection_visual_in_page_diagnostics.v0',
          frame_seq: 77,
          frame_timestamp_mono_ms: 940.5,
          driver_frame_anchor: {
            frame_seq: 75,
            frame_timestamp_mono_ms: 930.25,
            driver_result_id: 'driver_result_controlled_chrome_expression_1',
            reason_code: 'motion_driver_applied',
            safe_visible_state: 'expression_changed',
            observed_at: 'post_vrm_update_pre_render',
          },
          expression_value_summary: {
            expression_weight_applied: true,
            channel_names: ['happy'],
            frame_applied_count: 30,
            last_driver_result_id:
              'driver_result_controlled_chrome_expression_1',
            last_driver_result: 'applied',
            last_driver_reason_code: 'motion_driver_applied',
            last_safe_visible_state: 'expression_changed',
            last_observed_at: 'post_vrm_update_pre_render',
          },
        },
        motionRuntimeDebugSnapshot: {
          session: {
            instances: [
              {
                groupKey: 'dance.sequence',
                phase: 'active',
              },
            ],
          },
          poseFrame: {
            humanoidRotationBoneNames: ['hips', 'leftUpperArm'],
            humanoidTranslationBoneNames: ['hips'],
          },
        },
      }
    )
    const attributes =
      buildProjectionVisualControlledChromeObservationDomAttributes(summary)

    expect(summary.rois).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          roi_id: 'avatar_face_head',
          kind: 'avatar',
          counts_as_avatar_motion: true,
          expected_for_pass: true,
          rect_norm: { x: 0.55, y: 0.04, w: 0.2, h: 0.3 },
        }),
        expect.objectContaining({
          roi_id: 'speech_bubble',
          kind: 'guard_ui',
          counts_as_avatar_motion: false,
          expected_for_pass: false,
          rect_norm: { x: 0.03, y: 0.05, w: 0.28, h: 0.22 },
        }),
      ])
    )
    const faceHeadRoi = summary.rois.find(
      (roi) => roi.roi_id === 'avatar_face_head'
    )
    const expressionSpeechBubbleRoi = summary.rois.find(
      (roi) => roi.roi_id === 'speech_bubble'
    )
    expect(faceHeadRoi?.rect_norm.x).toBeGreaterThan(
      (expressionSpeechBubbleRoi?.rect_norm.x ?? 0) +
        (expressionSpeechBubbleRoi?.rect_norm.w ?? 0)
    )
    expect(
      rectsOverlap(
        faceHeadRoi?.rect_norm as NormalizedRect,
        expressionSpeechBubbleRoi?.rect_norm as NormalizedRect
      )
    ).toBe(false)

    expect(attributes).toEqual(
      expect.objectContaining({
        [PROJECTION_VISUAL_CONTROLLED_CHROME_OBSERVATION_ATTRIBUTE]:
          PROJECTION_VISUAL_CONTROLLED_CHROME_OBSERVATION_SCHEMA_VERSION,
        'data-projection-visual-controlled-chrome-observation-source-kind':
          'controlled_chrome_metric_summary',
        'data-projection-visual-controlled-chrome-observation-scenario-label':
          'expression_visible_change',
        'data-projection-visual-controlled-chrome-observation-expected-roi-id':
          'avatar_face_head',
        'data-projection-visual-controlled-chrome-observation-runtime-status':
          'started',
        'data-projection-visual-controlled-chrome-observation-runtime-reason-code':
          'motion_runtime_expression_frame_queued',
        'data-projection-visual-controlled-chrome-observation-runtime-safe-visible-state':
          'expression_change_requested',
        'data-projection-visual-controlled-chrome-observation-driver-result-id':
          'driver_result_controlled_chrome_expression_1',
        'data-projection-visual-controlled-chrome-observation-result-event-observed-at-ms':
          '336.25',
        'data-projection-visual-controlled-chrome-observation-frame-anchor-source':
          'projection_visual_in_page_diagnostics.v0',
        'data-projection-visual-controlled-chrome-observation-expression-frame-applied-count':
          '30',
        'data-projection-visual-controlled-chrome-observation-pose-frame-observed':
          'true',
        'data-projection-visual-controlled-chrome-observation-canvas-readback-status':
          'unavailable',
        'data-projection-visual-controlled-chrome-observation-raw-frame-included':
          'false',
        'data-projection-visual-controlled-chrome-observation-provider-payload-included':
          'false',
        'data-projection-visual-controlled-chrome-observation-json-present':
          'true',
      })
    )

    publishProjectionVisualControlledChromeObservationDomSummary(root, summary)

    expect(root).toHaveAttribute(
      PROJECTION_VISUAL_CONTROLLED_CHROME_OBSERVATION_ATTRIBUTE,
      PROJECTION_VISUAL_CONTROLLED_CHROME_OBSERVATION_SCHEMA_VERSION
    )
    expect(root).toHaveAttribute(
      'data-projection-visual-controlled-chrome-observation-scenario-label',
      'expression_visible_change'
    )
    const script = document.getElementById(
      PROJECTION_VISUAL_CONTROLLED_CHROME_OBSERVATION_JSON_SCRIPT_ID
    ) as HTMLScriptElement
    const parsed = JSON.parse(script.textContent ?? '{}')
    expect(parsed).toEqual(
      expect.objectContaining({
        schema_version: 'self_mirror_controlled_chrome_observation.v0',
        source_kind: 'controlled_chrome_metric_summary',
        scenario_label: 'expression_visible_change',
        raw_frame_included: false,
        raw_screenshot_included: false,
        frame_applied_anchor: expect.objectContaining({
          source: 'projection_visual_in_page_diagnostics.v0',
          expression_weight_applied: true,
          expression_frame_applied_count: 30,
          dance_active_instance_count: 1,
          pose_humanoid_rotation_channel_count: 2,
          pose_humanoid_translation_channel_count: 1,
          pose_frame_observed: true,
        }),
        canvas_readback_summary: expect.objectContaining({
          readback_status: 'unavailable',
          readback_strategy: 'unavailable',
          readback_metric_readiness: 'unavailable',
          readback_metric_blocker_reason_codes: ['readback_sample_unavailable'],
          post_render_anchor: {
            source: 'not_available',
            status: 'not_available',
          },
          readback_context_kinds: [],
          static_reason_codes: [],
        }),
      })
    )
    expect(script.textContent).not.toContain('http://')
    expect(script.textContent).not.toContain('provider_payload_raw')
    expect(script.textContent).not.toContain('entity_id')
    expect(script.textContent).not.toContain('C:/')
    expect(script.textContent).not.toContain('private_path_marker')
  })
})
