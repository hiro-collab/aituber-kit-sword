import type {
  ProjectionVisualStimulusDispatchTimeline,
  ProjectionVisualStimulusDispatchAdapterState,
  ProjectionVisualStimulusRef,
} from './projectionVisualStimulusTransport'

export const PROJECTION_VISUAL_CONTROLLED_CHROME_OBSERVATION_GLOBAL =
  '__projectionVisualControlledChromeObservationV0'
export const PROJECTION_VISUAL_CONTROLLED_CHROME_OBSERVATION_SCHEMA_VERSION =
  'self_mirror_controlled_chrome_observation.v0'
export const PROJECTION_VISUAL_CONTROLLED_CHROME_OBSERVATION_PRODUCER_SCHEMA_VERSION =
  'projection_visual_controlled_chrome_summary_metric_producer.v0'
export const PROJECTION_VISUAL_CONTROLLED_CHROME_OBSERVATION_ATTRIBUTE =
  'data-projection-visual-controlled-chrome-observation-v0'
export const PROJECTION_VISUAL_CONTROLLED_CHROME_OBSERVATION_JSON_SCRIPT_ID =
  'projection-visual-controlled-chrome-observation-v0'

export const CONTROLLED_CHROME_OBSERVATION_PRETRIGGER_MS = 300
export const CONTROLLED_CHROME_OBSERVATION_TOTAL_MS = 1600
export const CONTROLLED_CHROME_OBSERVATION_SAMPLE_INTERVAL_MS = 100

const DANCE_AVATAR_FULL_AUTHORITY_ROI_RECT = {
  x: 0.45,
  y: 0,
  w: 0.38,
  h: 0.98,
}
const EXPRESSION_FACE_HEAD_AUTHORITY_ROI_RECT = {
  x: 0.55,
  y: 0.04,
  w: 0.2,
  h: 0.3,
}
const SPEECH_BUBBLE_GUARD_ROI_RECT = {
  x: 0.03,
  y: 0.05,
  w: 0.28,
  h: 0.22,
}

export const PROJECTION_VISUAL_CONTROLLED_CHROME_OBSERVATION_ATTRIBUTE_NAMES = [
  PROJECTION_VISUAL_CONTROLLED_CHROME_OBSERVATION_ATTRIBUTE,
  'data-projection-visual-controlled-chrome-observation-producer-schema',
  'data-projection-visual-controlled-chrome-observation-source-kind',
  'data-projection-visual-controlled-chrome-observation-producer-status',
  'data-projection-visual-controlled-chrome-observation-stimulus-ref',
  'data-projection-visual-controlled-chrome-observation-scenario-id',
  'data-projection-visual-controlled-chrome-observation-scenario-label',
  'data-projection-visual-controlled-chrome-observation-expected-motion',
  'data-projection-visual-controlled-chrome-observation-expected-roi-id',
  'data-projection-visual-controlled-chrome-observation-metric-count',
  'data-projection-visual-controlled-chrome-observation-window-count',
  'data-projection-visual-controlled-chrome-observation-roi-count',
  'data-projection-visual-controlled-chrome-observation-roi-window-coverage-status',
  'data-projection-visual-controlled-chrome-observation-roi-window-expected-count',
  'data-projection-visual-controlled-chrome-observation-roi-window-observed-count',
  'data-projection-visual-controlled-chrome-observation-roi-window-missing-reason-code',
  'data-projection-visual-controlled-chrome-observation-roi-window-active-sample-sufficient',
  'data-projection-visual-controlled-chrome-observation-roi-window-min-authority-active-sample-count',
  'data-projection-visual-controlled-chrome-observation-roi-window-baseline-comparison-kind',
  'data-projection-visual-controlled-chrome-observation-authority-roi-input-status',
  'data-projection-visual-controlled-chrome-observation-authority-roi-diagnostic-class',
  'data-projection-visual-controlled-chrome-observation-authority-roi-sample-count',
  'data-projection-visual-controlled-chrome-observation-authority-roi-luma-checksum-changed',
  'data-projection-visual-controlled-chrome-observation-guard-roi-luma-checksum-changed',
  'data-projection-visual-controlled-chrome-observation-authority-roi-mapping-status',
  'data-projection-visual-controlled-chrome-observation-authority-roi-mapping-decision-hint',
  'data-projection-visual-controlled-chrome-observation-authority-roi-mapping-reason-code',
  'data-projection-visual-controlled-chrome-observation-guard-roi-support-only',
  'data-projection-visual-controlled-chrome-observation-motion-event-id',
  'data-projection-visual-controlled-chrome-observation-stimulus-id',
  'data-projection-visual-controlled-chrome-observation-stimulus-instance-id',
  'data-projection-visual-controlled-chrome-observation-runtime-result-id',
  'data-projection-visual-controlled-chrome-observation-driver-result-id',
  'data-projection-visual-controlled-chrome-observation-runtime-status',
  'data-projection-visual-controlled-chrome-observation-runtime-reason-code',
  'data-projection-visual-controlled-chrome-observation-runtime-safe-visible-state',
  'data-projection-visual-controlled-chrome-observation-result-event-observed-at-ms',
  'data-projection-visual-controlled-chrome-observation-frame-anchor-source',
  'data-projection-visual-controlled-chrome-observation-expression-frame-applied-count',
  'data-projection-visual-controlled-chrome-observation-pose-frame-observed',
  'data-projection-visual-controlled-chrome-observation-canvas-readback-status',
  'data-projection-visual-controlled-chrome-observation-canvas-luma-checksum-changed',
  'data-projection-visual-controlled-chrome-observation-canvas-readback-context-kind',
  'data-projection-visual-controlled-chrome-observation-canvas-readback-static-reason-code',
  'data-projection-visual-controlled-chrome-observation-canvas-readback-strategy',
  'data-projection-visual-controlled-chrome-observation-canvas-readback-metric-readiness',
  'data-projection-visual-controlled-chrome-observation-canvas-readback-blocker-reason-code',
  'data-projection-visual-controlled-chrome-observation-post-render-anchor-source',
  'data-projection-visual-controlled-chrome-observation-post-render-anchor-status',
  'data-projection-visual-controlled-chrome-observation-target-identity-status',
  'data-projection-visual-controlled-chrome-observation-capture-surface-kind',
  'data-projection-visual-controlled-chrome-observation-same-page-or-target',
  'data-projection-visual-controlled-chrome-observation-browser-process-kind',
  'data-projection-visual-controlled-chrome-observation-proof-ceiling',
  'data-projection-visual-controlled-chrome-observation-raw-frame-included',
  'data-projection-visual-controlled-chrome-observation-raw-screenshot-included',
  'data-projection-visual-controlled-chrome-observation-raw-video-included',
  'data-projection-visual-controlled-chrome-observation-raw-log-included',
  'data-projection-visual-controlled-chrome-observation-provider-payload-included',
  'data-projection-visual-controlled-chrome-observation-json-present',
] as const

export type ProjectionVisualControlledChromeObservationAttributes = Partial<
  Record<
    (typeof PROJECTION_VISUAL_CONTROLLED_CHROME_OBSERVATION_ATTRIBUTE_NAMES)[number],
    string
  >
>

type ObservationWindow = {
  window_id: 'pretrigger' | 'active' | 'release' | 'settle'
  start_ms: number
  end_ms: number
}

type ObservationRoi = {
  roi_id: 'avatar_full' | 'avatar_face_head' | 'speech_bubble'
  kind: 'avatar' | 'guard_ui'
  counts_as_avatar_motion: boolean
  expected_for_pass: boolean
  rect_norm: { x: number; y: number; w: number; h: number }
}

export type ProjectionVisualControlledChromeObservationMetric = {
  roi_id: ObservationRoi['roi_id']
  window_id: ObservationWindow['window_id']
  sample_count: number
  motion_score: number
  changed_ratio: number
  comparable_sample_count?: number
  first_sample_without_baseline_count?: number
  baseline_comparison_kind?: BaselineComparisonKind
  luma_checksum_changed?: boolean
  first_sample_elapsed_ms?: number
  last_sample_elapsed_ms?: number
  missing_window_reason_code?: string
  diagnostic_reason_codes?: string[]
}

type BaselineComparisonKind =
  | 'previous_sample'
  | 'first_sample_no_previous'
  | 'no_sample'
  | 'mixed'

type ProjectionVisualControlledChromeWindowCoverage = {
  expected_roi_window_count: number
  observed_roi_window_count: number
  missing_roi_window_count: number
  missing_window_reason_codes: string[]
  active_sample_sufficient: boolean
  min_authority_active_sample_count: number
  baseline_comparison_kind: BaselineComparisonKind
  first_sample_without_baseline_count: number
  comparable_sample_count: number
  luma_checksum_changed: boolean
  per_window_sample_counts: Array<{
    roi_id: ObservationRoi['roi_id']
    window_id: ObservationWindow['window_id']
    sample_count: number
    first_sample_elapsed_ms?: number
    last_sample_elapsed_ms?: number
    baseline_comparison_kind: BaselineComparisonKind
    luma_checksum_changed: boolean
    missing_window_reason_code?: string
    diagnostic_reason_codes?: string[]
  }>
}

type RoiInputStatus =
  | 'sampled_changed'
  | 'sampled_static'
  | 'not_sampled'
  | 'roi_geometry_invalid'
  | 'readback_unavailable'

type DanceAvatarFullDiagnosticClass =
  | 'not_applicable'
  | 'metric_visible_motion_detected'
  | 'authority_roi_static_guard_changed'
  | 'genuinely_no_metric_visible_motion'
  | 'wrong_canvas_or_readback_layer'
  | 'wrong_roi_coordinate_mapping'
  | 'wrong_sample_source'
  | 'missing_rendered_frame_presentation_anchor'
  | 'hidden_or_blank_canvas'
  | 'readback_unavailable'

type RoiPixelRectSummary = {
  x: number
  y: number
  w: number
  h: number
  canvas_width: number
  canvas_height: number
  status: 'ok' | 'clipped' | 'out_of_bounds' | 'zero_canvas'
}

export type ProjectionVisualControlledChromeRoiInputDiagnostic = {
  roi_id: ObservationRoi['roi_id']
  kind: ObservationRoi['kind']
  counts_as_avatar_motion: boolean
  expected_for_pass: boolean
  rect_norm: ObservationRoi['rect_norm']
  pixel_rect?: RoiPixelRectSummary
  sample_count: number
  sample_source_kinds: string[]
  readback_strategies: string[]
  readback_context_kinds: string[]
  input_status: RoiInputStatus
  diagnostic_reason_codes: string[]
  first_sample_elapsed_ms?: number
  last_sample_elapsed_ms?: number
  luma_min?: number
  luma_max?: number
  luma_range?: number
  first_luma_checksum?: number
  last_luma_checksum?: number
  unique_luma_checksum_count: number
  luma_checksum_changed: boolean
}

export type ProjectionVisualControlledChromeDanceAvatarFullReadbackDiagnostic =
  {
    schema_version: 'projection_visual_dance_avatar_full_readback_diagnostic.v0'
    diagnostic_scope: 'dance_visible_motion_avatar_full'
    authority_roi_id: 'avatar_full'
    diagnostic_class: DanceAvatarFullDiagnosticClass
    diagnostic_reason_codes: string[]
    authority_roi_input_status: RoiInputStatus
    authority_active_sample_count: number
    authority_active_motion_score: number
    authority_active_changed_ratio: number
    guard_roi_checksum_changed: boolean
    guard_roi_max_motion_score: number
    readback_strategy: ProjectionVisualControlledChromeCanvasReadbackSummary['readback_strategy']
    readback_metric_readiness: ProjectionVisualControlledChromeCanvasReadbackSummary['readback_metric_readiness']
    pose_frame_observed?: boolean
    dance_active_instance_count?: number
    raw_frame_included: false
    raw_pixel_included: false
  }

type AuthorityRoiMappingStatus =
  | 'authority_roi_metric_active'
  | 'authority_roi_unproven_static_region'
  | 'authority_roi_metric_static'
  | 'mapping_invalid_geometry'
  | 'mapping_unavailable'
  | 'mapping_unproven_frame_anchor_missing'
  | 'mapping_unproven_insufficient_samples'
  | 'not_applicable'

type AuthorityRoiMappingDecisionHint =
  | 'authority_roi_accepted'
  | 'alternate_authority_roi_decision_required'
  | 'roi_geometry_fix_required'
  | 'readback_strategy_fix_required'
  | 'render_anchor_required'
  | 'roi_window_coverage_required'
  | 'mapping_not_applicable'

export type ProjectionVisualControlledChromeAuthorityRoiMappingDiagnostic = {
  schema_version: 'projection_visual_dance_authority_roi_mapping_diagnostic.v0'
  diagnostic_scope: 'dance_visible_motion_authority_roi_mapping'
  authority_roi_id: 'avatar_full'
  authority_roi_kind: 'avatar'
  mapping_status: AuthorityRoiMappingStatus
  decision_hint: AuthorityRoiMappingDecisionHint
  reason_codes: string[]
  authority_rect_norm: ObservationRoi['rect_norm']
  authority_pixel_rect?: RoiPixelRectSummary
  authority_roi_input_status: RoiInputStatus
  authority_active_sample_count: number
  authority_active_motion_score: number
  authority_active_changed_ratio: number
  guard_roi_id: 'speech_bubble'
  guard_roi_support_only: true
  guard_roi_checksum_changed: boolean
  guard_roi_max_motion_score: number
  pose_frame_observed?: boolean
  dance_active_instance_count?: number
  raw_frame_included: false
  raw_pixel_included: false
}

export type ProjectionVisualControlledChromeRuntimeDiagnosticsInput = {
  motionRuntimeDebugSnapshot?: unknown
  inPageDiagnostics?: unknown
}

export type ProjectionVisualControlledChromeFrameAppliedAnchor = {
  source:
    | 'projection_visual_in_page_diagnostics.v0'
    | 'motion_runtime_debug_snapshot'
    | 'not_available'
  frame_seq?: number
  frame_timestamp_mono_ms?: number
  driver_result_id?: string
  driver_result?: string
  driver_reason_code?: string
  safe_visible_state?: string
  observed_at?: string
  expression_weight_applied?: boolean
  expression_frame_applied_count?: number
  expression_channel_names?: string[]
  expression_applied_channel_names?: string[]
  expression_dropped_channel_names?: string[]
  expression_requested_channel_count?: number
  expression_applied_channel_count?: number
  expression_dropped_channel_count?: number
  dance_active_instance_count?: number
  dance_active_group_keys?: string[]
  pose_humanoid_rotation_channel_count?: number
  pose_humanoid_translation_channel_count?: number
  pose_frame_observed?: boolean
}

export type ProjectionVisualControlledChromeCanvasReadbackSummary = {
  sample_attempt_count: number
  sample_rows_observed: number
  sample_source_kinds: string[]
  readback_unavailable_count: number
  luma_checksum_changed: boolean
  readback_status: 'changed' | 'static' | 'unavailable'
  readback_strategy:
    | 'custom_sample_provider'
    | 'presented_canvas_2d_copy'
    | 'webgl_default_framebuffer_read_pixels'
    | 'canvas_2d_image_data'
    | 'mixed'
    | 'unavailable'
  readback_metric_readiness: 'ready' | 'diagnostic_only' | 'unavailable'
  readback_metric_blocker_reason_codes: string[]
  post_render_anchor: {
    source:
      | 'request_animation_frame'
      | 'record_sample_call'
      | 'custom_sample_provider'
      | 'not_available'
    status:
      | 'post_render_sample_scheduled'
      | 'synchronous_sample'
      | 'custom_sample_provider'
      | 'not_available'
  }
  readback_context_kinds: string[]
  static_reason_codes: string[]
  latest_canvas_buffer_width?: number
  latest_canvas_buffer_height?: number
  latest_canvas_client_width?: number
  latest_canvas_client_height?: number
  latest_device_pixel_ratio?: number
}

export type ProjectionVisualControlledChromeObservationSummary = {
  schema_version: typeof PROJECTION_VISUAL_CONTROLLED_CHROME_OBSERVATION_SCHEMA_VERSION
  producer_schema_version: typeof PROJECTION_VISUAL_CONTROLLED_CHROME_OBSERVATION_PRODUCER_SCHEMA_VERSION
  source_kind: 'controlled_chrome_metric_summary'
  producer_status: 'collecting' | 'complete' | 'unavailable'
  stimulus_ref: ProjectionVisualStimulusRef
  scenario_id: string
  scenario_label:
    | 'dance_visible_motion'
    | 'dance_stop_to_idle'
    | 'expression_visible_change'
  expected_motion:
    | 'broad_avatar_motion'
    | 'neutral_idle_requested'
    | 'face_visible_change'
  target_identity: {
    schema_version: 'self_mirror_capture_target_identity.v0'
    capture_surface_kind: 'controlled_chrome_extension_tab'
    same_page_or_target: true
    browser_process_kind: 'chrome_extension_controlled_user_chrome'
    proof_ceiling: 'controlled_chrome_self_mirror_summary_only'
    target_identity_status: 'page_summary_requires_runner_tab_safe_id'
    capture_target_url_present: true
    trigger_target_url_present: true
    raw_frame_included: false
    raw_screenshot_included: false
    raw_video_included: false
    local_path_included: false
  }
  viewport: { width: number; height: number }
  windows: ObservationWindow[]
  rois: ObservationRoi[]
  thresholds: {
    active_motion_min_score: number
    settle_motion_max_score: number
    min_consecutive_samples: number
  }
  runtime_join: {
    motion_event_id?: string
    stimulus_id?: string
    stimulus_instance_id?: string
    runtime_result_id?: string
    driver_result_id?: string
    multi_stimulus_group_id?: string
    result_status?: string
    result_reason_code?: string
    result_safe_visible_state?: string
  }
  event_timeline: {
    capture_started_at_ms: number
    motion_requested_at_ms: number
    stimulus_dispatched_at_ms?: number
    result_event_observed_at_ms?: number
    runtime_started_at_ms?: number
  }
  frame_applied_anchor: ProjectionVisualControlledChromeFrameAppliedAnchor
  canvas_readback_summary: ProjectionVisualControlledChromeCanvasReadbackSummary
  roi_window_coverage: ProjectionVisualControlledChromeWindowCoverage
  roi_input_diagnostics: ProjectionVisualControlledChromeRoiInputDiagnostic[]
  dance_avatar_full_readback_diagnostic?: ProjectionVisualControlledChromeDanceAvatarFullReadbackDiagnostic
  authority_roi_mapping_diagnostic?: ProjectionVisualControlledChromeAuthorityRoiMappingDiagnostic
  projection_visual_diagnostics: {
    source: 'projection_visual_in_page_summary_metric_producer'
    surface_class: 'projection_visual'
    same_page_or_target: true
    target_identity_status: 'page_summary_requires_runner_tab_safe_id'
  }
  roi_window_metrics: ProjectionVisualControlledChromeObservationMetric[]
  raw_frame_included: false
  raw_screenshot_included: false
  raw_video_included: false
  raw_log_included: false
  provider_payload_included: false
  cleanup_status: {
    browser_target_finalized: false
    runtime_stopped: false
    raw_frames_deleted: true
  }
}

type ObservationScenario = {
  stimulus_ref: ProjectionVisualStimulusRef
  scenario_id: string
  scenario_label: ProjectionVisualControlledChromeObservationSummary['scenario_label']
  expected_motion: ProjectionVisualControlledChromeObservationSummary['expected_motion']
  expected_roi_id: ObservationRoi['roi_id']
  windows: ObservationWindow[]
  rois: ObservationRoi[]
}

type LumaSample = {
  roi_id: ObservationRoi['roi_id']
  luma: Uint8Array
  source_kind?: string
  readback_context_kind?: string
  static_reason_code?: string
  readback_strategy?: string
  post_render_anchor_source?: ProjectionVisualControlledChromeCanvasReadbackSummary['post_render_anchor']['source']
  post_render_anchor_status?: ProjectionVisualControlledChromeCanvasReadbackSummary['post_render_anchor']['status']
  canvas_buffer_width?: number
  canvas_buffer_height?: number
  canvas_client_width?: number
  canvas_client_height?: number
  device_pixel_ratio?: number
  pixel_rect?: RoiPixelRectSummary
}

export type ProjectionVisualControlledChromeObservationSampleProvider = (args: {
  rois: readonly ObservationRoi[]
  elapsedMs: number
  root: HTMLElement
  postRenderAnchorSource: ProjectionVisualControlledChromeCanvasReadbackSummary['post_render_anchor']['source']
}) => LumaSample[]

type MetricAccumulator = {
  sample_count: number
  motion_score: number
  changed_ratio: number
  comparable_sample_count: number
  first_sample_without_baseline_count: number
  luma_checksum_changed: boolean
  first_sample_elapsed_ms?: number
  last_sample_elapsed_ms?: number
  comparison_kinds: Set<BaselineComparisonKind>
}

type RoiInputAccumulator = {
  sample_count: number
  sample_source_kinds: Set<string>
  readback_strategies: Set<string>
  readback_context_kinds: Set<string>
  first_sample_elapsed_ms?: number
  last_sample_elapsed_ms?: number
  luma_min?: number
  luma_max?: number
  first_luma_checksum?: number
  last_luma_checksum?: number
  luma_checksums: Set<number>
  luma_checksum_changed: boolean
  pixel_rect?: RoiPixelRectSummary
}

export class ProjectionVisualControlledChromeObservationSession {
  private readonly scenario: ObservationScenario
  private readonly root: HTMLElement
  private readonly nowMs: () => number
  private readonly sampleProvider:
    | ProjectionVisualControlledChromeObservationSampleProvider
    | undefined
  private readonly startedAtMs: number
  private readonly previousLumaByRoi = new Map<string, Uint8Array>()
  private readonly previousLumaChecksumByRoi = new Map<string, number>()
  private readonly metricsByRoiWindow = new Map<string, MetricAccumulator>()
  private readonly roiInputByRoi = new Map<
    ObservationRoi['roi_id'],
    RoiInputAccumulator
  >()
  private readonly sampleSourceKinds = new Set<string>()
  private sampleAttemptCount = 0
  private sampleRowsObserved = 0
  private readbackUnavailableCount = 0
  private lumaChecksumChanged = false
  private readonly readbackContextKinds = new Set<string>()
  private readonly staticReasonCodes = new Set<string>()
  private readonly readbackStrategies = new Set<string>()
  private readonly postRenderAnchorSources = new Set<
    ProjectionVisualControlledChromeCanvasReadbackSummary['post_render_anchor']['source']
  >()
  private readonly postRenderAnchorStatuses = new Set<
    ProjectionVisualControlledChromeCanvasReadbackSummary['post_render_anchor']['status']
  >()
  private latestCanvasReadbackGeometry:
    | {
        buffer_width: number
        buffer_height: number
        client_width: number
        client_height: number
        device_pixel_ratio: number
      }
    | undefined
  private producerStatus: ProjectionVisualControlledChromeObservationSummary['producer_status'] =
    'collecting'

  constructor({
    stimulusRef,
    root,
    nowMs = () => performance.now(),
    sampleProvider,
  }: {
    stimulusRef: ProjectionVisualStimulusRef
    root: HTMLElement
    nowMs?: () => number
    sampleProvider?: ProjectionVisualControlledChromeObservationSampleProvider
  }) {
    this.scenario = scenarioForStimulusRef(stimulusRef)
    this.root = root
    this.nowMs = nowMs
    this.sampleProvider = sampleProvider
    this.startedAtMs = nowMs()
  }

  elapsedMs(): number {
    return Math.max(0, this.nowMs() - this.startedAtMs)
  }

  recordSample(options?: {
    postRenderAnchorSource?: ProjectionVisualControlledChromeCanvasReadbackSummary['post_render_anchor']['source']
  }) {
    const elapsedMs = this.elapsedMs()
    const window = windowForElapsedMs(this.scenario.windows, elapsedMs)
    if (!window) {
      this.producerStatus = 'complete'
      return
    }

    const postRenderAnchorSource =
      options?.postRenderAnchorSource ?? 'record_sample_call'
    const samples = this.readSamples(elapsedMs, postRenderAnchorSource)
    this.sampleAttemptCount += 1
    if (!samples.length) {
      this.readbackUnavailableCount += 1
      this.producerStatus =
        this.producerStatus === 'complete' ? 'complete' : 'unavailable'
      return
    }

    this.sampleRowsObserved += samples.length
    for (const sample of samples) {
      this.sampleSourceKinds.add(sample.source_kind ?? 'unknown')
      if (sample.readback_context_kind) {
        this.readbackContextKinds.add(sample.readback_context_kind)
      }
      if (sample.static_reason_code) {
        this.staticReasonCodes.add(sample.static_reason_code)
      }
      this.readbackStrategies.add(
        sample.readback_strategy ??
          (sample.source_kind === 'test_sample_provider'
            ? 'custom_sample_provider'
            : 'unavailable')
      )
      this.postRenderAnchorSources.add(
        sample.post_render_anchor_source ?? postRenderAnchorSource
      )
      this.postRenderAnchorStatuses.add(
        sample.post_render_anchor_status ??
          postRenderAnchorStatusForSource(postRenderAnchorSource)
      )
      if (
        typeof sample.canvas_buffer_width === 'number' &&
        typeof sample.canvas_buffer_height === 'number'
      ) {
        this.latestCanvasReadbackGeometry = {
          buffer_width: sample.canvas_buffer_width,
          buffer_height: sample.canvas_buffer_height,
          client_width: sample.canvas_client_width ?? 0,
          client_height: sample.canvas_client_height ?? 0,
          device_pixel_ratio: sample.device_pixel_ratio ?? 0,
        }
      }
      const checksum = checksumLumaSample(sample.luma)
      const previousChecksum = this.previousLumaChecksumByRoi.get(sample.roi_id)
      if (
        typeof previousChecksum === 'number' &&
        previousChecksum !== checksum
      ) {
        this.lumaChecksumChanged = true
      }
      this.previousLumaChecksumByRoi.set(sample.roi_id, checksum)
      const previous = this.previousLumaByRoi.get(sample.roi_id)
      const baselineComparisonKind: BaselineComparisonKind = previous
        ? 'previous_sample'
        : 'first_sample_no_previous'
      const metric = previous
        ? compareLumaSamples(sample.luma, previous)
        : { motion_score: 0, changed_ratio: 0 }
      this.recordRoiInput(sample, checksum, {
        elapsedMs,
        lumaChecksumChanged:
          typeof previousChecksum === 'number' && previousChecksum !== checksum,
      })
      this.previousLumaByRoi.set(sample.roi_id, sample.luma)
      this.recordMetric(sample.roi_id, window.window_id, metric, {
        elapsedMs,
        baselineComparisonKind,
        lumaChecksumChanged:
          typeof previousChecksum === 'number' && previousChecksum !== checksum,
      })
    }

    if (elapsedMs >= CONTROLLED_CHROME_OBSERVATION_TOTAL_MS) {
      this.producerStatus = 'complete'
    } else {
      this.producerStatus = 'collecting'
    }
  }

  complete() {
    this.producerStatus =
      this.metricsByRoiWindow.size > 0 ? 'complete' : 'unavailable'
  }

  buildSummary(
    state: ProjectionVisualStimulusDispatchAdapterState,
    diagnostics?: ProjectionVisualControlledChromeRuntimeDiagnosticsInput
  ): ProjectionVisualControlledChromeObservationSummary {
    const viewport = viewportForRoot(this.root)
    const eventTimeline = buildEventTimeline(state.dispatch_timeline)
    const frameAppliedAnchor = buildFrameAppliedAnchor(diagnostics)
    const canvasReadbackSummary = this.canvasReadbackSummary()
    const roiWindowCoverage = this.roiWindowCoverage()
    const roiWindowMetrics = this.metricRows()
    const roiInputDiagnostics = this.roiInputDiagnostics()
    const danceAvatarFullReadbackDiagnostic =
      buildDanceAvatarFullReadbackDiagnostic({
        scenario: this.scenario,
        frameAppliedAnchor,
        canvasReadbackSummary,
        roiWindowMetrics,
        roiInputDiagnostics,
      })
    const authorityRoiMappingDiagnostic =
      buildDanceAuthorityRoiMappingDiagnostic({
        scenario: this.scenario,
        frameAppliedAnchor,
        canvasReadbackSummary,
        roiWindowMetrics,
        roiInputDiagnostics,
      })
    return {
      schema_version:
        PROJECTION_VISUAL_CONTROLLED_CHROME_OBSERVATION_SCHEMA_VERSION,
      producer_schema_version:
        PROJECTION_VISUAL_CONTROLLED_CHROME_OBSERVATION_PRODUCER_SCHEMA_VERSION,
      source_kind: 'controlled_chrome_metric_summary',
      producer_status: this.producerStatus,
      stimulus_ref: this.scenario.stimulus_ref,
      scenario_id: this.scenario.scenario_id,
      scenario_label: this.scenario.scenario_label,
      expected_motion: this.scenario.expected_motion,
      target_identity: {
        schema_version: 'self_mirror_capture_target_identity.v0',
        capture_surface_kind: 'controlled_chrome_extension_tab',
        same_page_or_target: true,
        browser_process_kind: 'chrome_extension_controlled_user_chrome',
        proof_ceiling: 'controlled_chrome_self_mirror_summary_only',
        target_identity_status: 'page_summary_requires_runner_tab_safe_id',
        capture_target_url_present: true,
        trigger_target_url_present: true,
        raw_frame_included: false,
        raw_screenshot_included: false,
        raw_video_included: false,
        local_path_included: false,
      },
      viewport,
      windows: this.scenario.windows,
      rois: this.scenario.rois,
      thresholds: {
        active_motion_min_score: 0.12,
        settle_motion_max_score: 0.05,
        min_consecutive_samples: 2,
      },
      runtime_join: runtimeJoinFromState(state),
      event_timeline: eventTimeline,
      frame_applied_anchor: frameAppliedAnchor,
      canvas_readback_summary: canvasReadbackSummary,
      roi_window_coverage: roiWindowCoverage,
      roi_input_diagnostics: roiInputDiagnostics,
      dance_avatar_full_readback_diagnostic: danceAvatarFullReadbackDiagnostic,
      authority_roi_mapping_diagnostic: authorityRoiMappingDiagnostic,
      projection_visual_diagnostics: {
        source: 'projection_visual_in_page_summary_metric_producer',
        surface_class: 'projection_visual',
        same_page_or_target: true,
        target_identity_status: 'page_summary_requires_runner_tab_safe_id',
      },
      roi_window_metrics: roiWindowMetrics,
      raw_frame_included: false,
      raw_screenshot_included: false,
      raw_video_included: false,
      raw_log_included: false,
      provider_payload_included: false,
      cleanup_status: {
        browser_target_finalized: false,
        runtime_stopped: false,
        raw_frames_deleted: true,
      },
    }
  }

  private canvasReadbackSummary(): ProjectionVisualControlledChromeCanvasReadbackSummary {
    return {
      sample_attempt_count: this.sampleAttemptCount,
      sample_rows_observed: this.sampleRowsObserved,
      sample_source_kinds: [...this.sampleSourceKinds].sort().slice(0, 6),
      readback_unavailable_count: this.readbackUnavailableCount,
      luma_checksum_changed: this.lumaChecksumChanged,
      readback_status:
        this.sampleRowsObserved <= 0
          ? 'unavailable'
          : this.lumaChecksumChanged
            ? 'changed'
            : 'static',
      readback_strategy: summarizeReadbackStrategy(this.readbackStrategies),
      readback_metric_readiness: readbackMetricReadiness({
        sampleRowsObserved: this.sampleRowsObserved,
        readbackStrategies: this.readbackStrategies,
        staticReasonCodes: this.staticReasonCodes,
      }),
      readback_metric_blocker_reason_codes: readbackMetricBlockerReasonCodes({
        sampleRowsObserved: this.sampleRowsObserved,
        readbackStrategies: this.readbackStrategies,
        staticReasonCodes: this.staticReasonCodes,
      }),
      post_render_anchor: summarizePostRenderAnchor({
        sources: this.postRenderAnchorSources,
        statuses: this.postRenderAnchorStatuses,
      }),
      readback_context_kinds: [...this.readbackContextKinds].sort().slice(0, 6),
      static_reason_codes: [...this.staticReasonCodes].sort().slice(0, 6),
      latest_canvas_buffer_width:
        this.latestCanvasReadbackGeometry?.buffer_width,
      latest_canvas_buffer_height:
        this.latestCanvasReadbackGeometry?.buffer_height,
      latest_canvas_client_width:
        this.latestCanvasReadbackGeometry?.client_width,
      latest_canvas_client_height:
        this.latestCanvasReadbackGeometry?.client_height,
      latest_device_pixel_ratio:
        this.latestCanvasReadbackGeometry?.device_pixel_ratio,
    }
  }

  private recordMetric(
    roiId: ObservationRoi['roi_id'],
    windowId: ObservationWindow['window_id'],
    metric: { motion_score: number; changed_ratio: number },
    options: {
      elapsedMs: number
      baselineComparisonKind: BaselineComparisonKind
      lumaChecksumChanged: boolean
    }
  ) {
    const key = `${roiId}:${windowId}`
    const current = this.metricsByRoiWindow.get(key) ?? {
      sample_count: 0,
      motion_score: 0,
      changed_ratio: 0,
      comparable_sample_count: 0,
      first_sample_without_baseline_count: 0,
      luma_checksum_changed: false,
      comparison_kinds: new Set<BaselineComparisonKind>(),
    }
    current.sample_count += 1
    if (typeof current.first_sample_elapsed_ms !== 'number') {
      current.first_sample_elapsed_ms = options.elapsedMs
    }
    current.last_sample_elapsed_ms = options.elapsedMs
    current.motion_score = Math.max(current.motion_score, metric.motion_score)
    current.changed_ratio = Math.max(
      current.changed_ratio,
      metric.changed_ratio
    )
    if (options.baselineComparisonKind === 'previous_sample') {
      current.comparable_sample_count += 1
    }
    if (options.baselineComparisonKind === 'first_sample_no_previous') {
      current.first_sample_without_baseline_count += 1
    }
    current.luma_checksum_changed =
      current.luma_checksum_changed || options.lumaChecksumChanged
    current.comparison_kinds.add(options.baselineComparisonKind)
    this.metricsByRoiWindow.set(key, current)
  }

  private recordRoiInput(
    sample: LumaSample,
    checksum: number,
    options: {
      elapsedMs: number
      lumaChecksumChanged: boolean
    }
  ) {
    const current = this.roiInputByRoi.get(sample.roi_id) ?? {
      sample_count: 0,
      sample_source_kinds: new Set<string>(),
      readback_strategies: new Set<string>(),
      readback_context_kinds: new Set<string>(),
      luma_checksums: new Set<number>(),
      luma_checksum_changed: false,
    }
    current.sample_count += 1
    current.sample_source_kinds.add(sample.source_kind ?? 'unknown')
    current.readback_strategies.add(
      sample.readback_strategy ??
        (sample.source_kind === 'test_sample_provider'
          ? 'custom_sample_provider'
          : 'unavailable')
    )
    if (sample.readback_context_kind) {
      current.readback_context_kinds.add(sample.readback_context_kind)
    }
    if (typeof current.first_sample_elapsed_ms !== 'number') {
      current.first_sample_elapsed_ms = options.elapsedMs
    }
    current.last_sample_elapsed_ms = options.elapsedMs
    if (typeof current.first_luma_checksum !== 'number') {
      current.first_luma_checksum = checksum
    }
    current.last_luma_checksum = checksum
    current.luma_checksums.add(checksum)
    current.luma_checksum_changed =
      current.luma_checksum_changed || options.lumaChecksumChanged
    const lumaBounds = lumaMinMax(sample.luma)
    if (lumaBounds) {
      current.luma_min =
        typeof current.luma_min === 'number'
          ? Math.min(current.luma_min, lumaBounds.min)
          : lumaBounds.min
      current.luma_max =
        typeof current.luma_max === 'number'
          ? Math.max(current.luma_max, lumaBounds.max)
          : lumaBounds.max
    }
    if (sample.pixel_rect) current.pixel_rect = sample.pixel_rect
    this.roiInputByRoi.set(sample.roi_id, current)
  }

  private readSamples(
    elapsedMs: number,
    postRenderAnchorSource: ProjectionVisualControlledChromeCanvasReadbackSummary['post_render_anchor']['source']
  ): LumaSample[] {
    if (this.sampleProvider) {
      return this.sampleProvider({
        rois: this.scenario.rois,
        elapsedMs,
        root: this.root,
        postRenderAnchorSource,
      })
    }

    const canvas =
      this.root.querySelector('canvas') ?? document.querySelector('canvas')
    if (!canvas) return []

    return this.scenario.rois
      .map((roi) =>
        readCanvasRoiLumaSample(canvas, roi, postRenderAnchorSource)
      )
      .filter((sample): sample is LumaSample => Boolean(sample))
  }

  private metricRows(): ProjectionVisualControlledChromeObservationMetric[] {
    const rows: ProjectionVisualControlledChromeObservationMetric[] = []
    for (const roi of this.scenario.rois) {
      for (const window of this.scenario.windows) {
        const metric = this.metricsByRoiWindow.get(
          `${roi.roi_id}:${window.window_id}`
        )
        rows.push(this.metricRow(roi, window, metric))
      }
    }
    return rows
  }

  private metricRow(
    roi: ObservationRoi,
    window: ObservationWindow,
    metric?: MetricAccumulator
  ): ProjectionVisualControlledChromeObservationMetric {
    if (!metric) {
      const reasonCode = `${window.window_id}_window_missing`
      return {
        roi_id: roi.roi_id,
        window_id: window.window_id,
        sample_count: 0,
        motion_score: 0,
        changed_ratio: 0,
        comparable_sample_count: 0,
        first_sample_without_baseline_count: 0,
        baseline_comparison_kind: 'no_sample',
        luma_checksum_changed: false,
        missing_window_reason_code: reasonCode,
        diagnostic_reason_codes: [reasonCode],
      }
    }

    const diagnosticReasonCodes = metricDiagnosticReasonCodes({
      roi,
      window,
      metric,
      minConsecutiveSamples: 2,
    })
    return {
      roi_id: roi.roi_id,
      window_id: window.window_id,
      sample_count: Math.min(metric.sample_count, 60),
      motion_score: roundMetric(metric.motion_score),
      changed_ratio: roundMetric(metric.changed_ratio),
      comparable_sample_count: Math.min(metric.comparable_sample_count, 60),
      first_sample_without_baseline_count: Math.min(
        metric.first_sample_without_baseline_count,
        60
      ),
      baseline_comparison_kind: summarizeBaselineComparisonKinds(
        metric.comparison_kinds
      ),
      luma_checksum_changed: metric.luma_checksum_changed,
      first_sample_elapsed_ms: roundElapsedMetric(
        metric.first_sample_elapsed_ms
      ),
      last_sample_elapsed_ms: roundElapsedMetric(metric.last_sample_elapsed_ms),
      diagnostic_reason_codes: diagnosticReasonCodes.length
        ? diagnosticReasonCodes
        : undefined,
    }
  }

  private roiWindowCoverage(): ProjectionVisualControlledChromeWindowCoverage {
    const rows = this.metricRows()
    const missingReasonCodes = new Set<string>()
    let firstSampleWithoutBaselineCount = 0
    let comparableSampleCount = 0
    let lumaChecksumChanged = false
    const comparisonKinds = new Set<BaselineComparisonKind>()

    for (const row of rows) {
      if (row.missing_window_reason_code) {
        missingReasonCodes.add(row.missing_window_reason_code)
      }
      for (const reasonCode of row.diagnostic_reason_codes ?? []) {
        if (reasonCode.endsWith('_window_missing')) {
          missingReasonCodes.add(reasonCode)
        }
      }
      firstSampleWithoutBaselineCount +=
        row.first_sample_without_baseline_count ?? 0
      comparableSampleCount += row.comparable_sample_count ?? 0
      if (row.luma_checksum_changed) lumaChecksumChanged = true
      comparisonKinds.add(row.baseline_comparison_kind ?? 'no_sample')
    }

    const authorityActiveRows = rows.filter((row) => {
      const roi = this.scenario.rois.find(
        (candidate) => candidate.roi_id === row.roi_id
      )
      return (
        row.window_id === 'active' &&
        roi?.counts_as_avatar_motion === true &&
        roi.expected_for_pass === true
      )
    })
    const minAuthorityActiveSampleCount = authorityActiveRows.length
      ? Math.min(...authorityActiveRows.map((row) => row.sample_count))
      : 0
    if (minAuthorityActiveSampleCount < 2) {
      missingReasonCodes.add('active_window_insufficient_samples')
    }
    if (firstSampleWithoutBaselineCount > 0 && comparableSampleCount <= 0) {
      missingReasonCodes.add('baseline_comparison_unavailable')
    }

    return {
      expected_roi_window_count: rows.length,
      observed_roi_window_count: rows.filter((row) => row.sample_count > 0)
        .length,
      missing_roi_window_count: rows.filter((row) => row.sample_count <= 0)
        .length,
      missing_window_reason_codes: [...missingReasonCodes].sort().slice(0, 12),
      active_sample_sufficient: minAuthorityActiveSampleCount >= 2,
      min_authority_active_sample_count: minAuthorityActiveSampleCount,
      baseline_comparison_kind:
        summarizeBaselineComparisonKinds(comparisonKinds),
      first_sample_without_baseline_count: firstSampleWithoutBaselineCount,
      comparable_sample_count: comparableSampleCount,
      luma_checksum_changed: lumaChecksumChanged,
      per_window_sample_counts: rows.map((row) => ({
        roi_id: row.roi_id,
        window_id: row.window_id,
        sample_count: row.sample_count,
        first_sample_elapsed_ms: row.first_sample_elapsed_ms,
        last_sample_elapsed_ms: row.last_sample_elapsed_ms,
        baseline_comparison_kind: row.baseline_comparison_kind ?? 'no_sample',
        luma_checksum_changed: row.luma_checksum_changed ?? false,
        missing_window_reason_code: row.missing_window_reason_code,
        diagnostic_reason_codes: row.diagnostic_reason_codes,
      })),
    }
  }

  private roiInputDiagnostics(): ProjectionVisualControlledChromeRoiInputDiagnostic[] {
    return this.scenario.rois.map((roi) => {
      const accumulator = this.roiInputByRoi.get(roi.roi_id)
      const inputStatus = roiInputStatus(accumulator)
      const reasonCodes = roiInputDiagnosticReasonCodes({
        inputStatus,
        accumulator,
      })
      return {
        roi_id: roi.roi_id,
        kind: roi.kind,
        counts_as_avatar_motion: roi.counts_as_avatar_motion,
        expected_for_pass: roi.expected_for_pass,
        rect_norm: roi.rect_norm,
        pixel_rect: accumulator?.pixel_rect,
        sample_count: Math.min(accumulator?.sample_count ?? 0, 60),
        sample_source_kinds: [
          ...(accumulator?.sample_source_kinds ?? new Set<string>()),
        ]
          .sort()
          .slice(0, 6),
        readback_strategies: [
          ...(accumulator?.readback_strategies ?? new Set<string>()),
        ]
          .sort()
          .slice(0, 6),
        readback_context_kinds: [
          ...(accumulator?.readback_context_kinds ?? new Set<string>()),
        ]
          .sort()
          .slice(0, 6),
        input_status: inputStatus,
        diagnostic_reason_codes: reasonCodes,
        first_sample_elapsed_ms: roundElapsedMetric(
          accumulator?.first_sample_elapsed_ms
        ),
        last_sample_elapsed_ms: roundElapsedMetric(
          accumulator?.last_sample_elapsed_ms
        ),
        luma_min: accumulator?.luma_min,
        luma_max: accumulator?.luma_max,
        luma_range:
          typeof accumulator?.luma_min === 'number' &&
          typeof accumulator?.luma_max === 'number'
            ? accumulator.luma_max - accumulator.luma_min
            : undefined,
        first_luma_checksum: accumulator?.first_luma_checksum,
        last_luma_checksum: accumulator?.last_luma_checksum,
        unique_luma_checksum_count: Math.min(
          accumulator?.luma_checksums.size ?? 0,
          60
        ),
        luma_checksum_changed: accumulator?.luma_checksum_changed ?? false,
      }
    })
  }
}

export function buildProjectionVisualControlledChromeObservationDomAttributes(
  summary: ProjectionVisualControlledChromeObservationSummary
): ProjectionVisualControlledChromeObservationAttributes {
  const attributes: ProjectionVisualControlledChromeObservationAttributes = {
    [PROJECTION_VISUAL_CONTROLLED_CHROME_OBSERVATION_ATTRIBUTE]:
      PROJECTION_VISUAL_CONTROLLED_CHROME_OBSERVATION_SCHEMA_VERSION,
    'data-projection-visual-controlled-chrome-observation-producer-schema':
      PROJECTION_VISUAL_CONTROLLED_CHROME_OBSERVATION_PRODUCER_SCHEMA_VERSION,
    'data-projection-visual-controlled-chrome-observation-source-kind':
      'controlled_chrome_metric_summary',
    'data-projection-visual-controlled-chrome-observation-producer-status':
      summary.producer_status,
    'data-projection-visual-controlled-chrome-observation-stimulus-ref':
      summary.stimulus_ref,
    'data-projection-visual-controlled-chrome-observation-scenario-id':
      summary.scenario_id,
    'data-projection-visual-controlled-chrome-observation-scenario-label':
      summary.scenario_label,
    'data-projection-visual-controlled-chrome-observation-expected-motion':
      summary.expected_motion,
    'data-projection-visual-controlled-chrome-observation-expected-roi-id':
      scenarioForStimulusRef(summary.stimulus_ref).expected_roi_id,
    'data-projection-visual-controlled-chrome-observation-metric-count': String(
      summary.roi_window_metrics.length
    ),
    'data-projection-visual-controlled-chrome-observation-window-count': String(
      summary.windows.length
    ),
    'data-projection-visual-controlled-chrome-observation-roi-count': String(
      summary.rois.length
    ),
    'data-projection-visual-controlled-chrome-observation-roi-window-coverage-status':
      summary.roi_window_coverage.missing_roi_window_count > 0
        ? 'partial'
        : 'complete',
    'data-projection-visual-controlled-chrome-observation-roi-window-expected-count':
      String(summary.roi_window_coverage.expected_roi_window_count),
    'data-projection-visual-controlled-chrome-observation-roi-window-observed-count':
      String(summary.roi_window_coverage.observed_roi_window_count),
    'data-projection-visual-controlled-chrome-observation-roi-window-active-sample-sufficient':
      summary.roi_window_coverage.active_sample_sufficient ? 'true' : 'false',
    'data-projection-visual-controlled-chrome-observation-roi-window-min-authority-active-sample-count':
      String(summary.roi_window_coverage.min_authority_active_sample_count),
    'data-projection-visual-controlled-chrome-observation-roi-window-baseline-comparison-kind':
      summary.roi_window_coverage.baseline_comparison_kind,
    'data-projection-visual-controlled-chrome-observation-target-identity-status':
      summary.target_identity.target_identity_status,
    'data-projection-visual-controlled-chrome-observation-capture-surface-kind':
      summary.target_identity.capture_surface_kind,
    'data-projection-visual-controlled-chrome-observation-same-page-or-target':
      'true',
    'data-projection-visual-controlled-chrome-observation-browser-process-kind':
      summary.target_identity.browser_process_kind,
    'data-projection-visual-controlled-chrome-observation-proof-ceiling':
      summary.target_identity.proof_ceiling,
    'data-projection-visual-controlled-chrome-observation-raw-frame-included':
      'false',
    'data-projection-visual-controlled-chrome-observation-raw-screenshot-included':
      'false',
    'data-projection-visual-controlled-chrome-observation-raw-video-included':
      'false',
    'data-projection-visual-controlled-chrome-observation-raw-log-included':
      'false',
    'data-projection-visual-controlled-chrome-observation-provider-payload-included':
      'false',
    'data-projection-visual-controlled-chrome-observation-json-present': 'true',
  }

  setSafeObservationAttribute(
    attributes,
    'data-projection-visual-controlled-chrome-observation-roi-window-missing-reason-code',
    summary.roi_window_coverage.missing_window_reason_codes[0]
  )
  const authorityRoiInput = summary.roi_input_diagnostics.find(
    (diagnostic) =>
      diagnostic.counts_as_avatar_motion && diagnostic.expected_for_pass
  )
  setSafeObservationAttribute(
    attributes,
    'data-projection-visual-controlled-chrome-observation-authority-roi-input-status',
    authorityRoiInput?.input_status
  )
  setSafeObservationAttribute(
    attributes,
    'data-projection-visual-controlled-chrome-observation-authority-roi-diagnostic-class',
    summary.dance_avatar_full_readback_diagnostic?.diagnostic_class
  )
  setSafeObservationAttribute(
    attributes,
    'data-projection-visual-controlled-chrome-observation-authority-roi-sample-count',
    safeNumberString(authorityRoiInput?.sample_count)
  )
  setSafeObservationAttribute(
    attributes,
    'data-projection-visual-controlled-chrome-observation-authority-roi-luma-checksum-changed',
    authorityRoiInput?.luma_checksum_changed
  )
  setSafeObservationAttribute(
    attributes,
    'data-projection-visual-controlled-chrome-observation-guard-roi-luma-checksum-changed',
    summary.dance_avatar_full_readback_diagnostic?.guard_roi_checksum_changed
  )
  setSafeObservationAttribute(
    attributes,
    'data-projection-visual-controlled-chrome-observation-authority-roi-mapping-status',
    summary.authority_roi_mapping_diagnostic?.mapping_status
  )
  setSafeObservationAttribute(
    attributes,
    'data-projection-visual-controlled-chrome-observation-authority-roi-mapping-decision-hint',
    summary.authority_roi_mapping_diagnostic?.decision_hint
  )
  setSafeObservationAttribute(
    attributes,
    'data-projection-visual-controlled-chrome-observation-authority-roi-mapping-reason-code',
    summary.authority_roi_mapping_diagnostic?.reason_codes[0]
  )
  setSafeObservationAttribute(
    attributes,
    'data-projection-visual-controlled-chrome-observation-guard-roi-support-only',
    summary.authority_roi_mapping_diagnostic?.guard_roi_support_only
  )
  setSafeObservationAttribute(
    attributes,
    'data-projection-visual-controlled-chrome-observation-motion-event-id',
    summary.runtime_join.motion_event_id
  )
  setSafeObservationAttribute(
    attributes,
    'data-projection-visual-controlled-chrome-observation-stimulus-id',
    summary.runtime_join.stimulus_id
  )
  setSafeObservationAttribute(
    attributes,
    'data-projection-visual-controlled-chrome-observation-stimulus-instance-id',
    summary.runtime_join.stimulus_instance_id
  )
  setSafeObservationAttribute(
    attributes,
    'data-projection-visual-controlled-chrome-observation-runtime-result-id',
    summary.runtime_join.runtime_result_id
  )
  setSafeObservationAttribute(
    attributes,
    'data-projection-visual-controlled-chrome-observation-driver-result-id',
    summary.runtime_join.driver_result_id
  )
  setSafeObservationAttribute(
    attributes,
    'data-projection-visual-controlled-chrome-observation-runtime-status',
    summary.runtime_join.result_status
  )
  setSafeObservationAttribute(
    attributes,
    'data-projection-visual-controlled-chrome-observation-runtime-reason-code',
    summary.runtime_join.result_reason_code
  )
  setSafeObservationAttribute(
    attributes,
    'data-projection-visual-controlled-chrome-observation-runtime-safe-visible-state',
    summary.runtime_join.result_safe_visible_state
  )
  setSafeObservationAttribute(
    attributes,
    'data-projection-visual-controlled-chrome-observation-result-event-observed-at-ms',
    safeNumberString(summary.event_timeline.result_event_observed_at_ms)
  )
  setSafeObservationAttribute(
    attributes,
    'data-projection-visual-controlled-chrome-observation-frame-anchor-source',
    summary.frame_applied_anchor.source
  )
  setSafeObservationAttribute(
    attributes,
    'data-projection-visual-controlled-chrome-observation-expression-frame-applied-count',
    safeNumberString(
      summary.frame_applied_anchor.expression_frame_applied_count
    )
  )
  setSafeObservationAttribute(
    attributes,
    'data-projection-visual-controlled-chrome-observation-pose-frame-observed',
    summary.frame_applied_anchor.pose_frame_observed
  )
  setSafeObservationAttribute(
    attributes,
    'data-projection-visual-controlled-chrome-observation-canvas-readback-status',
    summary.canvas_readback_summary.readback_status
  )
  setSafeObservationAttribute(
    attributes,
    'data-projection-visual-controlled-chrome-observation-canvas-luma-checksum-changed',
    summary.canvas_readback_summary.luma_checksum_changed
  )
  setSafeObservationAttribute(
    attributes,
    'data-projection-visual-controlled-chrome-observation-canvas-readback-context-kind',
    summary.canvas_readback_summary.readback_context_kinds[0]
  )
  setSafeObservationAttribute(
    attributes,
    'data-projection-visual-controlled-chrome-observation-canvas-readback-static-reason-code',
    safeDomStaticReasonCode(
      summary.canvas_readback_summary.static_reason_codes[0]
    )
  )
  setSafeObservationAttribute(
    attributes,
    'data-projection-visual-controlled-chrome-observation-canvas-readback-strategy',
    summary.canvas_readback_summary.readback_strategy
  )
  setSafeObservationAttribute(
    attributes,
    'data-projection-visual-controlled-chrome-observation-canvas-readback-metric-readiness',
    summary.canvas_readback_summary.readback_metric_readiness
  )
  setSafeObservationAttribute(
    attributes,
    'data-projection-visual-controlled-chrome-observation-canvas-readback-blocker-reason-code',
    safeDomReadbackBlockerReasonCode(
      summary.canvas_readback_summary.readback_metric_blocker_reason_codes[0]
    )
  )
  setSafeObservationAttribute(
    attributes,
    'data-projection-visual-controlled-chrome-observation-post-render-anchor-source',
    summary.canvas_readback_summary.post_render_anchor.source
  )
  setSafeObservationAttribute(
    attributes,
    'data-projection-visual-controlled-chrome-observation-post-render-anchor-status',
    summary.canvas_readback_summary.post_render_anchor.status
  )

  return attributes
}

function safeDomStaticReasonCode(
  value: string | undefined
): string | undefined {
  if (value === 'webgl_default_framebuffer_preserve_drawing_buffer_false') {
    return 'webgl_preserve_false'
  }
  return value
}

function safeDomReadbackBlockerReasonCode(
  value: string | undefined
): string | undefined {
  if (value === 'webgl_default_framebuffer_preserve_drawing_buffer_false') {
    return 'webgl_preserve_false'
  }
  if (value === 'webgl_default_framebuffer_readback_diagnostic_only') {
    return 'webgl_readback_diagnostic_only'
  }
  return value
}

function buildDanceAvatarFullReadbackDiagnostic({
  scenario,
  frameAppliedAnchor,
  canvasReadbackSummary,
  roiWindowMetrics,
  roiInputDiagnostics,
}: {
  scenario: ObservationScenario
  frameAppliedAnchor: ProjectionVisualControlledChromeFrameAppliedAnchor
  canvasReadbackSummary: ProjectionVisualControlledChromeCanvasReadbackSummary
  roiWindowMetrics: ProjectionVisualControlledChromeObservationMetric[]
  roiInputDiagnostics: ProjectionVisualControlledChromeRoiInputDiagnostic[]
}):
  | ProjectionVisualControlledChromeDanceAvatarFullReadbackDiagnostic
  | undefined {
  if (scenario.scenario_label !== 'dance_visible_motion') return undefined

  const authorityInput = roiInputDiagnostics.find(
    (diagnostic) => diagnostic.roi_id === 'avatar_full'
  )
  const authorityActiveMetric = roiWindowMetrics.find(
    (metric) => metric.roi_id === 'avatar_full' && metric.window_id === 'active'
  )
  const guardMetrics = roiWindowMetrics.filter(
    (metric) => metric.roi_id === 'speech_bubble'
  )
  const guardRoiChecksumChanged = guardMetrics.some(
    (metric) => metric.luma_checksum_changed === true
  )
  const guardRoiMaxMotionScore = roundMetric(
    Math.max(0, ...guardMetrics.map((metric) => metric.motion_score))
  )
  const reasonCodes = new Set<string>()
  const authorityInputStatus = authorityInput?.input_status ?? 'not_sampled'
  const authorityActiveMotionScore = authorityActiveMetric?.motion_score ?? 0
  const authorityActiveChangedRatio = authorityActiveMetric?.changed_ratio ?? 0
  const authorityActiveSampleCount = authorityActiveMetric?.sample_count ?? 0
  const poseFrameObserved = frameAppliedAnchor.pose_frame_observed
  const authorityPixelStatus = authorityInput?.pixel_rect?.status
  let diagnosticClass: DanceAvatarFullDiagnosticClass =
    'genuinely_no_metric_visible_motion'

  if (canvasReadbackSummary.sample_rows_observed <= 0) {
    diagnosticClass = 'readback_unavailable'
    reasonCodes.add('readback_sample_unavailable')
  } else if (canvasReadbackSummary.readback_metric_readiness !== 'ready') {
    diagnosticClass = 'wrong_canvas_or_readback_layer'
    for (const reason of canvasReadbackSummary.readback_metric_blocker_reason_codes) {
      reasonCodes.add(reason)
    }
  } else if (
    authorityInputStatus === 'roi_geometry_invalid' ||
    authorityPixelStatus === 'out_of_bounds' ||
    authorityPixelStatus === 'zero_canvas'
  ) {
    diagnosticClass = 'wrong_roi_coordinate_mapping'
    reasonCodes.add('authority_roi_geometry_invalid')
  } else if (
    authorityInput &&
    !authorityInput.readback_strategies.some((strategy) =>
      [
        'custom_sample_provider',
        'presented_canvas_2d_copy',
        'canvas_2d_image_data',
      ].includes(strategy)
    )
  ) {
    diagnosticClass = 'wrong_sample_source'
    reasonCodes.add('authority_roi_sample_source_not_metric_ready')
  } else if (
    authorityActiveMotionScore >= 0.12 ||
    authorityActiveChangedRatio >= 0.12
  ) {
    diagnosticClass = 'metric_visible_motion_detected'
    reasonCodes.add('authority_roi_active_motion_metric_detected')
  } else if (isBlankCanvasLike(roiInputDiagnostics)) {
    diagnosticClass = 'hidden_or_blank_canvas'
    reasonCodes.add('all_roi_luma_values_blank')
  } else if (poseFrameObserved !== true) {
    diagnosticClass = 'missing_rendered_frame_presentation_anchor'
    reasonCodes.add('pose_frame_anchor_missing')
  } else if (
    authorityActiveSampleCount >= 2 &&
    authorityActiveMotionScore === 0 &&
    guardRoiChecksumChanged
  ) {
    diagnosticClass = 'authority_roi_static_guard_changed'
    reasonCodes.add('authority_roi_static_while_guard_roi_changes')
  } else {
    reasonCodes.add('authority_roi_metric_static_after_adequate_sampling')
  }

  if (authorityActiveSampleCount < 2) {
    reasonCodes.add('authority_active_window_insufficient_samples')
  }
  if (authorityInputStatus === 'sampled_static') {
    reasonCodes.add('authority_roi_input_sampled_static')
  }

  return {
    schema_version:
      'projection_visual_dance_avatar_full_readback_diagnostic.v0',
    diagnostic_scope: 'dance_visible_motion_avatar_full',
    authority_roi_id: 'avatar_full',
    diagnostic_class: diagnosticClass,
    diagnostic_reason_codes: [...reasonCodes].sort().slice(0, 10),
    authority_roi_input_status: authorityInputStatus,
    authority_active_sample_count: Math.min(authorityActiveSampleCount, 60),
    authority_active_motion_score: roundMetric(authorityActiveMotionScore),
    authority_active_changed_ratio: roundMetric(authorityActiveChangedRatio),
    guard_roi_checksum_changed: guardRoiChecksumChanged,
    guard_roi_max_motion_score: guardRoiMaxMotionScore,
    readback_strategy: canvasReadbackSummary.readback_strategy,
    readback_metric_readiness: canvasReadbackSummary.readback_metric_readiness,
    pose_frame_observed: frameAppliedAnchor.pose_frame_observed,
    dance_active_instance_count: frameAppliedAnchor.dance_active_instance_count,
    raw_frame_included: false,
    raw_pixel_included: false,
  }
}

function buildDanceAuthorityRoiMappingDiagnostic({
  scenario,
  frameAppliedAnchor,
  canvasReadbackSummary,
  roiWindowMetrics,
  roiInputDiagnostics,
}: {
  scenario: ObservationScenario
  frameAppliedAnchor: ProjectionVisualControlledChromeFrameAppliedAnchor
  canvasReadbackSummary: ProjectionVisualControlledChromeCanvasReadbackSummary
  roiWindowMetrics: ProjectionVisualControlledChromeObservationMetric[]
  roiInputDiagnostics: ProjectionVisualControlledChromeRoiInputDiagnostic[]
}): ProjectionVisualControlledChromeAuthorityRoiMappingDiagnostic | undefined {
  if (scenario.scenario_label !== 'dance_visible_motion') return undefined

  const authorityRoi = scenario.rois.find(
    (candidate) => candidate.roi_id === 'avatar_full'
  )
  const authorityInput = roiInputDiagnostics.find(
    (diagnostic) => diagnostic.roi_id === 'avatar_full'
  )
  const authorityActiveMetric = roiWindowMetrics.find(
    (metric) => metric.roi_id === 'avatar_full' && metric.window_id === 'active'
  )
  const guardMetrics = roiWindowMetrics.filter(
    (metric) => metric.roi_id === 'speech_bubble'
  )
  const guardRoiChecksumChanged = guardMetrics.some(
    (metric) => metric.luma_checksum_changed === true
  )
  const guardRoiMaxMotionScore = roundMetric(
    Math.max(0, ...guardMetrics.map((metric) => metric.motion_score))
  )
  const reasonCodes = new Set<string>()
  const authorityInputStatus = authorityInput?.input_status ?? 'not_sampled'
  const authorityActiveMotionScore = authorityActiveMetric?.motion_score ?? 0
  const authorityActiveChangedRatio = authorityActiveMetric?.changed_ratio ?? 0
  const authorityActiveSampleCount = authorityActiveMetric?.sample_count ?? 0
  const authorityPixelStatus = authorityInput?.pixel_rect?.status
  let mappingStatus: AuthorityRoiMappingStatus = 'authority_roi_metric_static'
  let decisionHint: AuthorityRoiMappingDecisionHint =
    'alternate_authority_roi_decision_required'

  if (!authorityRoi) {
    mappingStatus = 'mapping_invalid_geometry'
    decisionHint = 'roi_geometry_fix_required'
    reasonCodes.add('authority_roi_definition_missing')
  } else if (
    canvasReadbackSummary.sample_rows_observed <= 0 ||
    canvasReadbackSummary.readback_metric_readiness === 'unavailable'
  ) {
    mappingStatus = 'mapping_unavailable'
    decisionHint = 'readback_strategy_fix_required'
    reasonCodes.add('readback_sample_unavailable')
  } else if (canvasReadbackSummary.readback_metric_readiness !== 'ready') {
    mappingStatus = 'mapping_unavailable'
    decisionHint = 'readback_strategy_fix_required'
    for (const reason of canvasReadbackSummary.readback_metric_blocker_reason_codes) {
      reasonCodes.add(reason)
    }
  } else if (
    authorityInputStatus === 'roi_geometry_invalid' ||
    authorityPixelStatus === 'out_of_bounds' ||
    authorityPixelStatus === 'zero_canvas'
  ) {
    mappingStatus = 'mapping_invalid_geometry'
    decisionHint = 'roi_geometry_fix_required'
    reasonCodes.add('authority_roi_geometry_invalid')
  } else if (
    authorityActiveMotionScore >= 0.12 ||
    authorityActiveChangedRatio >= 0.12
  ) {
    mappingStatus = 'authority_roi_metric_active'
    decisionHint = 'authority_roi_accepted'
    reasonCodes.add('authority_roi_active_motion_metric_detected')
  } else if (authorityActiveSampleCount < 2) {
    mappingStatus = 'mapping_unproven_insufficient_samples'
    decisionHint = 'roi_window_coverage_required'
    reasonCodes.add('authority_active_window_insufficient_samples')
  } else if (frameAppliedAnchor.pose_frame_observed !== true) {
    mappingStatus = 'mapping_unproven_frame_anchor_missing'
    decisionHint = 'render_anchor_required'
    reasonCodes.add('pose_frame_anchor_missing')
  } else if (
    authorityInputStatus === 'sampled_static' &&
    guardRoiChecksumChanged
  ) {
    mappingStatus = 'authority_roi_unproven_static_region'
    decisionHint = 'alternate_authority_roi_decision_required'
    reasonCodes.add('authority_roi_static_while_guard_roi_changes')
    reasonCodes.add('pose_frame_active_but_authority_roi_static')
    reasonCodes.add('guard_roi_support_only_not_authority')
  } else {
    reasonCodes.add('authority_roi_metric_static_after_adequate_sampling')
  }

  if (authorityInputStatus === 'sampled_static') {
    reasonCodes.add('authority_roi_input_sampled_static')
  }

  return {
    schema_version:
      'projection_visual_dance_authority_roi_mapping_diagnostic.v0',
    diagnostic_scope: 'dance_visible_motion_authority_roi_mapping',
    authority_roi_id: 'avatar_full',
    authority_roi_kind: 'avatar',
    mapping_status: mappingStatus,
    decision_hint: decisionHint,
    reason_codes: [...reasonCodes].sort().slice(0, 10),
    authority_rect_norm: authorityRoi?.rect_norm ?? { x: 0, y: 0, w: 0, h: 0 },
    authority_pixel_rect: authorityInput?.pixel_rect,
    authority_roi_input_status: authorityInputStatus,
    authority_active_sample_count: Math.min(authorityActiveSampleCount, 60),
    authority_active_motion_score: roundMetric(authorityActiveMotionScore),
    authority_active_changed_ratio: roundMetric(authorityActiveChangedRatio),
    guard_roi_id: 'speech_bubble',
    guard_roi_support_only: true,
    guard_roi_checksum_changed: guardRoiChecksumChanged,
    guard_roi_max_motion_score: guardRoiMaxMotionScore,
    pose_frame_observed: frameAppliedAnchor.pose_frame_observed,
    dance_active_instance_count: frameAppliedAnchor.dance_active_instance_count,
    raw_frame_included: false,
    raw_pixel_included: false,
  }
}

function summarizeReadbackStrategy(
  strategies: ReadonlySet<string>
): ProjectionVisualControlledChromeCanvasReadbackSummary['readback_strategy'] {
  const unique = [
    ...new Set(
      [...strategies].filter((strategy) =>
        [
          'custom_sample_provider',
          'presented_canvas_2d_copy',
          'webgl_default_framebuffer_read_pixels',
          'canvas_2d_image_data',
        ].includes(strategy)
      )
    ),
  ]
  if (unique.length <= 0) return 'unavailable'
  if (unique.length > 1) return 'mixed'
  const [strategy] = unique
  if (
    strategy === 'custom_sample_provider' ||
    strategy === 'presented_canvas_2d_copy' ||
    strategy === 'webgl_default_framebuffer_read_pixels' ||
    strategy === 'canvas_2d_image_data'
  ) {
    return strategy
  }
  return 'unavailable'
}

function readbackMetricReadiness({
  sampleRowsObserved,
  readbackStrategies,
  staticReasonCodes,
}: {
  sampleRowsObserved: number
  readbackStrategies: ReadonlySet<string>
  staticReasonCodes: ReadonlySet<string>
}): ProjectionVisualControlledChromeCanvasReadbackSummary['readback_metric_readiness'] {
  if (sampleRowsObserved <= 0) return 'unavailable'
  const strategy = summarizeReadbackStrategy(readbackStrategies)
  const blockers = readbackMetricBlockerReasonCodes({
    sampleRowsObserved,
    readbackStrategies,
    staticReasonCodes,
  })
  if (blockers.length > 0) return 'diagnostic_only'
  return strategy === 'unavailable' ? 'unavailable' : 'ready'
}

function readbackMetricBlockerReasonCodes({
  sampleRowsObserved,
  readbackStrategies,
  staticReasonCodes,
}: {
  sampleRowsObserved: number
  readbackStrategies: ReadonlySet<string>
  staticReasonCodes: ReadonlySet<string>
}): string[] {
  if (sampleRowsObserved <= 0) return ['readback_sample_unavailable']

  const strategy = summarizeReadbackStrategy(readbackStrategies)
  const blockers = new Set<string>()
  if (
    staticReasonCodes.has(
      'webgl_default_framebuffer_preserve_drawing_buffer_false'
    ) &&
    strategy !== 'presented_canvas_2d_copy' &&
    strategy !== 'mixed'
  ) {
    blockers.add('webgl_default_framebuffer_preserve_drawing_buffer_false')
  }
  if (strategy === 'webgl_default_framebuffer_read_pixels') {
    blockers.add('webgl_default_framebuffer_readback_diagnostic_only')
  }
  if (strategy === 'unavailable') blockers.add('readback_strategy_unavailable')
  return [...blockers].sort().slice(0, 6)
}

function summarizePostRenderAnchor({
  sources,
  statuses,
}: {
  sources: ReadonlySet<
    ProjectionVisualControlledChromeCanvasReadbackSummary['post_render_anchor']['source']
  >
  statuses: ReadonlySet<
    ProjectionVisualControlledChromeCanvasReadbackSummary['post_render_anchor']['status']
  >
}): ProjectionVisualControlledChromeCanvasReadbackSummary['post_render_anchor'] {
  return {
    source: firstSafeAnchorSource(sources),
    status: firstSafeAnchorStatus(statuses),
  }
}

function firstSafeAnchorSource(
  sources: ReadonlySet<
    ProjectionVisualControlledChromeCanvasReadbackSummary['post_render_anchor']['source']
  >
): ProjectionVisualControlledChromeCanvasReadbackSummary['post_render_anchor']['source'] {
  if (sources.has('request_animation_frame')) return 'request_animation_frame'
  if (sources.has('custom_sample_provider')) return 'custom_sample_provider'
  if (sources.has('record_sample_call')) return 'record_sample_call'
  return 'not_available'
}

function firstSafeAnchorStatus(
  statuses: ReadonlySet<
    ProjectionVisualControlledChromeCanvasReadbackSummary['post_render_anchor']['status']
  >
): ProjectionVisualControlledChromeCanvasReadbackSummary['post_render_anchor']['status'] {
  if (statuses.has('post_render_sample_scheduled')) {
    return 'post_render_sample_scheduled'
  }
  if (statuses.has('custom_sample_provider')) return 'custom_sample_provider'
  if (statuses.has('synchronous_sample')) return 'synchronous_sample'
  return 'not_available'
}

function postRenderAnchorStatusForSource(
  source: ProjectionVisualControlledChromeCanvasReadbackSummary['post_render_anchor']['source']
): ProjectionVisualControlledChromeCanvasReadbackSummary['post_render_anchor']['status'] {
  if (source === 'request_animation_frame')
    return 'post_render_sample_scheduled'
  if (source === 'custom_sample_provider') return 'custom_sample_provider'
  if (source === 'record_sample_call') return 'synchronous_sample'
  return 'not_available'
}

export function publishProjectionVisualControlledChromeObservationDomSummary(
  root: HTMLElement,
  summary: ProjectionVisualControlledChromeObservationSummary
) {
  for (const attributeName of PROJECTION_VISUAL_CONTROLLED_CHROME_OBSERVATION_ATTRIBUTE_NAMES) {
    root.removeAttribute(attributeName)
  }

  const attributes =
    buildProjectionVisualControlledChromeObservationDomAttributes(summary)
  for (const [attributeName, value] of Object.entries(attributes)) {
    root.setAttribute(attributeName, value)
  }

  const document = root.ownerDocument
  let script = document.getElementById(
    PROJECTION_VISUAL_CONTROLLED_CHROME_OBSERVATION_JSON_SCRIPT_ID
  ) as HTMLScriptElement | null
  if (!script) {
    script = document.createElement('script')
    script.id = PROJECTION_VISUAL_CONTROLLED_CHROME_OBSERVATION_JSON_SCRIPT_ID
    script.type = 'application/json'
    script.setAttribute(
      'data-projection-visual-controlled-chrome-observation-json-v0',
      PROJECTION_VISUAL_CONTROLLED_CHROME_OBSERVATION_SCHEMA_VERSION
    )
    root.appendChild(script)
  }
  script.textContent = JSON.stringify(summary)

  const projectionWindow = document.defaultView as
    | (Window & {
        [PROJECTION_VISUAL_CONTROLLED_CHROME_OBSERVATION_GLOBAL]?: ProjectionVisualControlledChromeObservationSummary
      })
    | null
  if (projectionWindow) {
    projectionWindow[PROJECTION_VISUAL_CONTROLLED_CHROME_OBSERVATION_GLOBAL] =
      summary
  }
}

export function clearProjectionVisualControlledChromeObservationDomSummary(
  root: HTMLElement
) {
  for (const attributeName of PROJECTION_VISUAL_CONTROLLED_CHROME_OBSERVATION_ATTRIBUTE_NAMES) {
    root.removeAttribute(attributeName)
  }
  const script = root.ownerDocument.getElementById(
    PROJECTION_VISUAL_CONTROLLED_CHROME_OBSERVATION_JSON_SCRIPT_ID
  )
  script?.remove()
}

function scenarioForStimulusRef(
  stimulusRef: ProjectionVisualStimulusRef
): ObservationScenario {
  const windows: ObservationWindow[] = [
    { window_id: 'pretrigger', start_ms: 0, end_ms: 300 },
    { window_id: 'active', start_ms: 300, end_ms: 900 },
    { window_id: 'release', start_ms: 900, end_ms: 1200 },
    { window_id: 'settle', start_ms: 1200, end_ms: 1600 },
  ]
  const speechBubble: ObservationRoi = {
    roi_id: 'speech_bubble',
    kind: 'guard_ui',
    counts_as_avatar_motion: false,
    expected_for_pass: false,
    rect_norm: SPEECH_BUBBLE_GUARD_ROI_RECT,
  }

  if (stimulusRef === 'voice.dance_please') {
    return {
      stimulus_ref: 'voice.dance_please',
      scenario_id:
        'rr003.visible_motion.dance_visible_motion.controlled_chrome.v0',
      scenario_label: 'dance_visible_motion',
      expected_motion: 'broad_avatar_motion',
      expected_roi_id: 'avatar_full',
      windows,
      rois: [
        {
          roi_id: 'avatar_full',
          kind: 'avatar',
          counts_as_avatar_motion: true,
          expected_for_pass: true,
          rect_norm: DANCE_AVATAR_FULL_AUTHORITY_ROI_RECT,
        },
        speechBubble,
      ],
    }
  }

  if (stimulusRef === 'voice.stop_dance') {
    return {
      stimulus_ref: 'voice.stop_dance',
      scenario_id:
        'rr003.visible_motion.dance_stop_to_idle.controlled_chrome.v0',
      scenario_label: 'dance_stop_to_idle',
      expected_motion: 'neutral_idle_requested',
      expected_roi_id: 'avatar_full',
      windows,
      rois: [
        {
          roi_id: 'avatar_full',
          kind: 'avatar',
          counts_as_avatar_motion: false,
          expected_for_pass: true,
          rect_norm: DANCE_AVATAR_FULL_AUTHORITY_ROI_RECT,
        },
        speechBubble,
      ],
    }
  }

  return {
    stimulus_ref: 'voice.smile_please',
    scenario_id:
      'rr003.visible_motion.expression_visible_change.controlled_chrome.v0',
    scenario_label: 'expression_visible_change',
    expected_motion: 'face_visible_change',
    expected_roi_id: 'avatar_face_head',
    windows,
    rois: [
      {
        roi_id: 'avatar_face_head',
        kind: 'avatar',
        counts_as_avatar_motion: true,
        expected_for_pass: true,
        rect_norm: EXPRESSION_FACE_HEAD_AUTHORITY_ROI_RECT,
      },
      speechBubble,
    ],
  }
}

function runtimeJoinFromState(
  state: ProjectionVisualStimulusDispatchAdapterState
): ProjectionVisualControlledChromeObservationSummary['runtime_join'] {
  return {
    motion_event_id: state.result?.motion_event_id ?? state.motion_event_id,
    stimulus_id: state.result?.stimulus_id ?? state.stimulus_id,
    stimulus_instance_id:
      state.result?.stimulus_instance_id ?? state.stimulus_instance_id,
    runtime_result_id:
      state.result?.runtime_result_id ?? state.runtime_result_id,
    driver_result_id: state.result?.driver_result_id ?? state.driver_result_id,
    multi_stimulus_group_id: state.result?.multi_stimulus_group_id,
    result_status: state.result?.status,
    result_reason_code: state.result?.reason_code,
    result_safe_visible_state: state.result?.safe_visible_state,
  }
}

function buildEventTimeline(
  timeline?: ProjectionVisualStimulusDispatchTimeline
): ProjectionVisualControlledChromeObservationSummary['event_timeline'] {
  const resultEventObservedAtMs = safeElapsedNumber(
    timeline?.result_event_observed_at_ms
  )
  return {
    capture_started_at_ms:
      safeElapsedNumber(timeline?.capture_started_at_ms) ?? 0,
    motion_requested_at_ms:
      safeElapsedNumber(timeline?.motion_requested_at_ms) ??
      CONTROLLED_CHROME_OBSERVATION_PRETRIGGER_MS,
    stimulus_dispatched_at_ms: safeElapsedNumber(
      timeline?.stimulus_dispatched_at_ms
    ),
    result_event_observed_at_ms: resultEventObservedAtMs,
    runtime_started_at_ms: resultEventObservedAtMs,
  }
}

function buildFrameAppliedAnchor(
  diagnostics?: ProjectionVisualControlledChromeRuntimeDiagnosticsInput
): ProjectionVisualControlledChromeFrameAppliedAnchor {
  const inPageDiagnostics = asRecord(diagnostics?.inPageDiagnostics)
  const debugSnapshot = asRecord(diagnostics?.motionRuntimeDebugSnapshot)
  const expressionSummary = asRecord(
    inPageDiagnostics?.expression_value_summary ??
      debugSnapshot?.expressionValueSummary
  )
  const driverFrameAnchor = asRecord(inPageDiagnostics?.driver_frame_anchor)
  const driverResult = asRecord(debugSnapshot?.driverResult)
  const session = asRecord(debugSnapshot?.session)
  const poseFrame = asRecord(debugSnapshot?.poseFrame)
  const instancesValue = session?.instances
  const instances = Array.isArray(instancesValue) ? instancesValue : []
  const danceInstances = instances
    .map(asRecord)
    .filter((instance): instance is Record<string, unknown> => {
      if (!instance) return false
      return (
        safeSummaryString(instance.groupKey) === 'dance.sequence' &&
        ['active', 'suppressed', 'releasing'].includes(
          safeSummaryString(instance.phase) ?? ''
        )
      )
    })
  const rotationNames = safeStringArray(poseFrame?.humanoidRotationBoneNames)
  const translationNames = safeStringArray(
    poseFrame?.humanoidTranslationBoneNames
  )

  return {
    source: inPageDiagnostics
      ? 'projection_visual_in_page_diagnostics.v0'
      : debugSnapshot
        ? 'motion_runtime_debug_snapshot'
        : 'not_available',
    frame_seq:
      safeFiniteNumber(driverFrameAnchor?.frame_seq) ??
      safeFiniteNumber(inPageDiagnostics?.frame_seq) ??
      safeFiniteNumber(debugSnapshot?.frameSeq),
    frame_timestamp_mono_ms:
      safeFiniteNumber(driverFrameAnchor?.frame_timestamp_mono_ms) ??
      safeFiniteNumber(inPageDiagnostics?.frame_timestamp_mono_ms),
    driver_result_id:
      safeSummaryString(driverFrameAnchor?.driver_result_id) ??
      safeSummaryString(expressionSummary?.last_driver_result_id) ??
      safeSummaryString(driverResult?.driver_result_id),
    driver_result:
      safeSummaryString(expressionSummary?.last_driver_result) ??
      safeSummaryString(driverResult?.result),
    driver_reason_code:
      safeSummaryString(driverFrameAnchor?.reason_code) ??
      safeSummaryString(expressionSummary?.last_driver_reason_code) ??
      safeSummaryString(driverResult?.reason_code),
    safe_visible_state:
      safeSummaryString(driverFrameAnchor?.safe_visible_state) ??
      safeSummaryString(expressionSummary?.last_safe_visible_state) ??
      safeSummaryString(driverResult?.safe_visible_state),
    observed_at:
      safeSummaryString(driverFrameAnchor?.observed_at) ??
      safeSummaryString(expressionSummary?.last_observed_at) ??
      safeSummaryString(driverResult?.observed_at),
    expression_weight_applied:
      typeof expressionSummary?.expression_weight_applied === 'boolean'
        ? expressionSummary.expression_weight_applied
        : undefined,
    expression_frame_applied_count: safeFiniteNumber(
      expressionSummary?.frame_applied_count
    ),
    expression_channel_names: safeStringArray(expressionSummary?.channel_names),
    expression_applied_channel_names: safeStringArray(
      expressionSummary?.applied_channel_names
    ),
    expression_dropped_channel_names: safeStringArray(
      expressionSummary?.dropped_channel_names
    ),
    expression_requested_channel_count: safeFiniteNumber(
      expressionSummary?.requested_channel_count
    ),
    expression_applied_channel_count: safeFiniteNumber(
      expressionSummary?.applied_channel_count
    ),
    expression_dropped_channel_count: safeFiniteNumber(
      expressionSummary?.dropped_channel_count
    ),
    dance_active_instance_count: danceInstances.length,
    dance_active_group_keys: [
      ...new Set(
        danceInstances
          .map((instance) => safeSummaryString(instance.groupKey))
          .filter((value): value is string => Boolean(value))
      ),
    ].slice(0, 4),
    pose_humanoid_rotation_channel_count: rotationNames.length,
    pose_humanoid_translation_channel_count: translationNames.length,
    pose_frame_observed: rotationNames.length + translationNames.length > 0,
  }
}

function windowForElapsedMs(
  windows: ObservationWindow[],
  elapsedMs: number
): ObservationWindow | undefined {
  return windows.find(
    (window) => elapsedMs >= window.start_ms && elapsedMs < window.end_ms
  )
}

function readCanvasRoiLumaSample(
  canvas: HTMLCanvasElement,
  roi: ObservationRoi,
  postRenderAnchorSource: ProjectionVisualControlledChromeCanvasReadbackSummary['post_render_anchor']['source']
): LumaSample | undefined {
  const pixelRect = canvasPixelRectForRoi(canvas, roi)
  if (
    pixelRect.status === 'out_of_bounds' ||
    pixelRect.status === 'zero_canvas' ||
    pixelRect.w <= 0 ||
    pixelRect.h <= 0
  ) {
    return undefined
  }

  const readback = readCanvasRgba(
    canvas,
    pixelRect.x,
    pixelRect.y,
    pixelRect.w,
    pixelRect.h
  )
  if (!readback) return undefined

  const maxSamples = 480
  const pixelCount = Math.floor(readback.pixels.length / 4)
  const stride = Math.max(1, Math.ceil(pixelCount / maxSamples))
  const luma = new Uint8Array(Math.ceil(pixelCount / stride))
  let outputIndex = 0
  for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex += stride) {
    const offset = pixelIndex * 4
    luma[outputIndex] = Math.round(
      readback.pixels[offset] * 0.2126 +
        readback.pixels[offset + 1] * 0.7152 +
        readback.pixels[offset + 2] * 0.0722
    )
    outputIndex += 1
  }

  return {
    roi_id: roi.roi_id,
    luma: outputIndex === luma.length ? luma : luma.slice(0, outputIndex),
    source_kind: readback.source_kind,
    readback_context_kind: readback.context_kind,
    static_reason_code: readback.static_reason_code,
    readback_strategy: readback.readback_strategy,
    post_render_anchor_source: postRenderAnchorSource,
    post_render_anchor_status: postRenderAnchorStatusForSource(
      postRenderAnchorSource
    ),
    canvas_buffer_width: readback.canvas_buffer_width,
    canvas_buffer_height: readback.canvas_buffer_height,
    canvas_client_width: readback.canvas_client_width,
    canvas_client_height: readback.canvas_client_height,
    device_pixel_ratio: readback.device_pixel_ratio,
    pixel_rect: pixelRect,
  }
}

type CanvasReadback = {
  pixels: Uint8Array
  source_kind:
    | 'canvas_webgl_read_pixels'
    | 'canvas_2d_image_data'
    | 'canvas_presented_2d_copy'
  context_kind: 'webgl2' | 'webgl' | '2d'
  readback_strategy:
    | 'presented_canvas_2d_copy'
    | 'webgl_default_framebuffer_read_pixels'
    | 'canvas_2d_image_data'
  static_reason_code?: string
  canvas_buffer_width: number
  canvas_buffer_height: number
  canvas_client_width: number
  canvas_client_height: number
  device_pixel_ratio: number
}

function readCanvasRgba(
  canvas: HTMLCanvasElement,
  x: number,
  y: number,
  width: number,
  height: number
): CanvasReadback | undefined {
  const webglContext =
    tryGetWebglContext(canvas, 'webgl2') ?? tryGetWebglContext(canvas, 'webgl')
  if (webglContext) {
    const { context: webgl, contextKind } = webglContext
    const preserveDrawingBuffer =
      webgl.getContextAttributes()?.preserveDrawingBuffer
    if (preserveDrawingBuffer === false) {
      const presentedReadback = readPresentedCanvasCopyRgba(
        canvas,
        x,
        y,
        width,
        height
      )
      if (presentedReadback) return presentedReadback
    }
    try {
      const pixels = new Uint8Array(width * height * 4)
      const sourceY = Math.max(0, canvas.height - y - height)
      webgl.readPixels(
        x,
        sourceY,
        width,
        height,
        webgl.RGBA,
        webgl.UNSIGNED_BYTE,
        pixels
      )
      return {
        pixels,
        source_kind: 'canvas_webgl_read_pixels',
        context_kind: contextKind,
        readback_strategy: 'webgl_default_framebuffer_read_pixels',
        static_reason_code:
          preserveDrawingBuffer === false
            ? 'webgl_default_framebuffer_preserve_drawing_buffer_false'
            : undefined,
        ...canvasReadbackGeometry(canvas),
      }
    } catch {
      return undefined
    }
  }

  const context = tryGet2dContext(canvas) as CanvasRenderingContext2D | null
  if (!context) return undefined
  try {
    return {
      pixels: new Uint8Array(context.getImageData(x, y, width, height).data),
      source_kind: 'canvas_2d_image_data',
      context_kind: '2d',
      readback_strategy: 'canvas_2d_image_data',
      ...canvasReadbackGeometry(canvas),
    }
  } catch {
    return undefined
  }
}

function readPresentedCanvasCopyRgba(
  canvas: HTMLCanvasElement,
  x: number,
  y: number,
  width: number,
  height: number
): CanvasReadback | undefined {
  const document = canvas.ownerDocument
  const copy = document.createElement('canvas')
  copy.width = Math.max(1, width)
  copy.height = Math.max(1, height)

  const context = tryGet2dContext(copy) as CanvasRenderingContext2D | null
  if (!context) return undefined

  try {
    context.drawImage(canvas, x, y, width, height, 0, 0, width, height)
    return {
      pixels: new Uint8Array(context.getImageData(0, 0, width, height).data),
      source_kind: 'canvas_presented_2d_copy',
      context_kind: '2d',
      readback_strategy: 'presented_canvas_2d_copy',
      ...canvasReadbackGeometry(canvas),
    }
  } catch {
    return undefined
  }
}

function tryGetWebglContext(
  canvas: HTMLCanvasElement,
  contextId: 'webgl2' | 'webgl'
):
  | {
      context: WebGLRenderingContext | WebGL2RenderingContext
      contextKind: 'webgl2' | 'webgl'
    }
  | undefined {
  try {
    const context =
      contextId === 'webgl2'
        ? canvas.getContext('webgl2')
        : canvas.getContext('webgl')
    return context ? { context, contextKind: contextId } : undefined
  } catch {
    return undefined
  }
}

function tryGet2dContext(canvas: HTMLCanvasElement) {
  try {
    return canvas.getContext('2d', { willReadFrequently: true })
  } catch {
    return null
  }
}

function canvasReadbackGeometry(canvas: HTMLCanvasElement) {
  const clientWidth =
    typeof canvas.clientWidth === 'number' ? canvas.clientWidth : 0
  const clientHeight =
    typeof canvas.clientHeight === 'number' ? canvas.clientHeight : 0
  const view = canvas.ownerDocument.defaultView
  return {
    canvas_buffer_width: Math.max(0, canvas.width),
    canvas_buffer_height: Math.max(0, canvas.height),
    canvas_client_width: Math.max(0, clientWidth),
    canvas_client_height: Math.max(0, clientHeight),
    device_pixel_ratio:
      typeof view?.devicePixelRatio === 'number' &&
      Number.isFinite(view.devicePixelRatio)
        ? Math.max(0, view.devicePixelRatio)
        : 0,
  }
}

function compareLumaSamples(current: Uint8Array, previous: Uint8Array) {
  const length = Math.min(current.length, previous.length)
  if (length <= 0) {
    return { motion_score: 0, changed_ratio: 0 }
  }
  let totalDelta = 0
  let changed = 0
  for (let index = 0; index < length; index += 1) {
    const delta = Math.abs(current[index] - previous[index])
    totalDelta += delta
    if (delta >= 14) changed += 1
  }
  const averageDelta = totalDelta / length / 255
  return {
    motion_score: Math.max(averageDelta, changed / length),
    changed_ratio: changed / length,
  }
}

function checksumLumaSample(luma: Uint8Array): number {
  let checksum = 0
  for (let index = 0; index < luma.length; index += 1) {
    checksum = (checksum + luma[index] * (index + 1)) % 1_000_000_007
  }
  return checksum
}

function viewportForRoot(root: HTMLElement) {
  const window = root.ownerDocument.defaultView
  return {
    width: window?.innerWidth ?? root.clientWidth ?? 0,
    height: window?.innerHeight ?? root.clientHeight ?? 0,
  }
}

function setSafeObservationAttribute(
  attributes: ProjectionVisualControlledChromeObservationAttributes,
  name: (typeof PROJECTION_VISUAL_CONTROLLED_CHROME_OBSERVATION_ATTRIBUTE_NAMES)[number],
  value: unknown
) {
  const text = safeObservationAttributeValue(value)
  if (text) attributes[name] = text
}

function safeNumberString(value: unknown): string | undefined {
  const numberValue = safeFiniteNumber(value)
  return typeof numberValue === 'number' ? String(numberValue) : undefined
}

function safeObservationAttributeValue(value: unknown): string | undefined {
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value !== 'string') return undefined

  const text = value.trim()
  if (!text || text.length > 180) return undefined
  if (!/^[a-zA-Z0-9._:-]+$/.test(text)) return undefined
  if (
    /(?:raw|private|provider|device|entity|ha_entity|home_control|home|appliance|media|audio|video|transcript|prompt|local_path|absolute_path|token|secret|credential|password|authorization|api[_-]?key|https?:\/\/|file:\/\/|[a-zA-Z]:[\\/]|\\\\)/i.test(
      text
    )
  ) {
    return undefined
  }

  return text
}

function roundMetric(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.round(Math.max(0, Math.min(1, value)) * 1_000_000) / 1_000_000
}

function roundElapsedMetric(value: number | undefined): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  return Math.round(Math.max(0, value) * 1000) / 1000
}

function summarizeBaselineComparisonKinds(
  comparisonKinds: ReadonlySet<BaselineComparisonKind>
): BaselineComparisonKind {
  const kinds = [...comparisonKinds].filter((kind) => kind !== 'no_sample')
  if (kinds.length <= 0) return 'no_sample'
  const unique = [...new Set(kinds)]
  if (unique.length === 1) return unique[0]
  return 'mixed'
}

function metricDiagnosticReasonCodes({
  roi,
  window,
  metric,
  minConsecutiveSamples,
}: {
  roi: ObservationRoi
  window: ObservationWindow
  metric: MetricAccumulator
  minConsecutiveSamples: number
}): string[] {
  const reasonCodes = new Set<string>()
  if (
    window.window_id === 'active' &&
    roi.counts_as_avatar_motion &&
    roi.expected_for_pass &&
    metric.sample_count < minConsecutiveSamples
  ) {
    reasonCodes.add('active_window_insufficient_samples')
  }
  if (
    window.window_id === 'active' &&
    metric.first_sample_without_baseline_count > 0 &&
    metric.comparable_sample_count <= 0
  ) {
    reasonCodes.add('first_active_sample_without_baseline')
  }
  return [...reasonCodes].sort().slice(0, 6)
}

function roiInputStatus(
  accumulator: RoiInputAccumulator | undefined
): RoiInputStatus {
  if (!accumulator || accumulator.sample_count <= 0) return 'not_sampled'
  if (
    accumulator.pixel_rect?.status === 'out_of_bounds' ||
    accumulator.pixel_rect?.status === 'zero_canvas'
  ) {
    return 'roi_geometry_invalid'
  }
  if (accumulator.readback_strategies.has('unavailable')) {
    return 'readback_unavailable'
  }
  return accumulator.luma_checksum_changed
    ? 'sampled_changed'
    : 'sampled_static'
}

function roiInputDiagnosticReasonCodes({
  inputStatus,
  accumulator,
}: {
  inputStatus: RoiInputStatus
  accumulator: RoiInputAccumulator | undefined
}): string[] {
  const reasonCodes = new Set<string>()
  if (inputStatus === 'not_sampled') reasonCodes.add('roi_input_not_sampled')
  if (inputStatus === 'roi_geometry_invalid') {
    reasonCodes.add('roi_geometry_invalid_or_out_of_bounds')
  }
  if (inputStatus === 'readback_unavailable') {
    reasonCodes.add('roi_readback_unavailable')
  }
  if (inputStatus === 'sampled_static') reasonCodes.add('roi_input_static')
  if (inputStatus === 'sampled_changed') reasonCodes.add('roi_input_changed')
  if (accumulator?.pixel_rect?.status === 'clipped') {
    reasonCodes.add('roi_pixel_rect_clipped')
  }
  return [...reasonCodes].sort().slice(0, 6)
}

function isBlankCanvasLike(
  roiInputDiagnostics: ProjectionVisualControlledChromeRoiInputDiagnostic[]
): boolean {
  const sampled = roiInputDiagnostics.filter(
    (diagnostic) => diagnostic.sample_count > 0
  )
  return (
    sampled.length > 0 &&
    sampled.every(
      (diagnostic) =>
        diagnostic.luma_min === 0 &&
        diagnostic.luma_max === 0 &&
        diagnostic.unique_luma_checksum_count <= 1
    )
  )
}

function lumaMinMax(luma: Uint8Array):
  | {
      min: number
      max: number
    }
  | undefined {
  if (luma.length <= 0) return undefined
  let min = 255
  let max = 0
  for (const value of luma) {
    min = Math.min(min, value)
    max = Math.max(max, value)
  }
  return { min, max }
}

function canvasPixelRectForRoi(
  canvas: HTMLCanvasElement,
  roi: ObservationRoi
): RoiPixelRectSummary {
  const canvasWidth = Math.max(0, canvas.width)
  const canvasHeight = Math.max(0, canvas.height)
  if (canvasWidth <= 0 || canvasHeight <= 0) {
    return {
      x: 0,
      y: 0,
      w: 0,
      h: 0,
      canvas_width: canvasWidth,
      canvas_height: canvasHeight,
      status: 'zero_canvas',
    }
  }

  const rawX = Math.floor(roi.rect_norm.x * canvasWidth)
  const rawY = Math.floor(roi.rect_norm.y * canvasHeight)
  const rawW = Math.floor(roi.rect_norm.w * canvasWidth)
  const rawH = Math.floor(roi.rect_norm.h * canvasHeight)
  const rawRight = rawX + rawW
  const rawBottom = rawY + rawH
  const x = clampInteger(rawX, 0, canvasWidth)
  const y = clampInteger(rawY, 0, canvasHeight)
  const right = clampInteger(rawRight, 0, canvasWidth)
  const bottom = clampInteger(rawBottom, 0, canvasHeight)
  const w = Math.max(0, right - x)
  const h = Math.max(0, bottom - y)
  const outOfBounds =
    rawW <= 0 ||
    rawH <= 0 ||
    rawRight <= 0 ||
    rawBottom <= 0 ||
    rawX >= canvasWidth ||
    rawY >= canvasHeight ||
    w <= 0 ||
    h <= 0
  const clipped =
    !outOfBounds &&
    (rawX !== x || rawY !== y || rawRight !== right || rawBottom !== bottom)

  return {
    x,
    y,
    w,
    h,
    canvas_width: canvasWidth,
    canvas_height: canvasHeight,
    status: outOfBounds ? 'out_of_bounds' : clipped ? 'clipped' : 'ok',
  }
}

function clampInteger(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.max(min, Math.min(max, value))
}

function safeElapsedNumber(value: unknown): number | undefined {
  const numberValue = safeFiniteNumber(value)
  if (typeof numberValue !== 'number') return undefined
  return Math.max(0, Math.round(numberValue * 1000) / 1000)
}

function safeFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function safeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map(safeSummaryString)
    .filter((entry): entry is string => Boolean(entry))
    .slice(0, 8)
}

function safeSummaryString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const text = value.trim()
  if (!text || text.length > 120) return undefined
  if (!/^[a-zA-Z0-9._:-]+$/.test(text)) return undefined
  if (
    /(?:raw|private|provider|device|entity|ha_entity|home_control|home|appliance|media|audio|video|transcript|prompt|local_path|absolute_path|token|secret|credential|password|authorization|api[_-]?key|https?:\/\/|file:\/\/|[a-zA-Z]:[\\/]|\\\\)/i.test(
      text
    )
  ) {
    return undefined
  }
  return text
}
