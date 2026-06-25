import type { MotionStimulusReceiverResult } from './motionStimulusReceiver'

export type ProjectionVisualStimulusRef =
  | 'voice.dance_please'
  | 'voice.stop_dance'
  | 'voice.smile_please'

export const PROJECTION_VISUAL_STIMULUS_DISPATCH_ADAPTER_GLOBAL =
  '__projectionVisualStimulusDispatchAdapterV0'
export const PROJECTION_VISUAL_STIMULUS_DISPATCH_ADAPTER_SCHEMA_VERSION =
  'projection_visual_stimulus_dispatch_adapter.v0'
export const PROJECTION_VISUAL_RUNTIME_DOM_SUMMARY_SCHEMA_VERSION =
  'projection_visual_runtime_result_dom_summary.v0'
export const PROJECTION_VISUAL_RUNTIME_DOM_SUMMARY_ATTRIBUTE =
  'data-projection-visual-runtime-summary-v0'
export const PROJECTION_VISUAL_MOTION_RUN_EVIDENCE_ENVELOPE_SCHEMA_VERSION =
  'projection_visual_motion_run_evidence_envelope.v0'

const SUPPORTED_STIMULUS_REFS = new Set<ProjectionVisualStimulusRef>([
  'voice.dance_please',
  'voice.stop_dance',
  'voice.smile_please',
])

const STIMULUS_REF_INVENTORY: readonly ProjectionVisualStimulusRefInventoryEntry[] =
  [
    {
      safe_ref: 'voice.dance_please',
      status: 'supported',
      kind: 'dance_sequence',
      request_mode: 'play',
      payload_ref: 'motion.thought_core.dance_sequence.v0',
      target_model_type: 'vrm',
      track_scope: 'full_body',
      expected_roi: 'avatar_full',
      expected_visible_change: 'broad_avatar_motion',
      scenario_label: 'dance_visible_motion',
      route_owner: 'RR003-02 Motion / VRM / AITuber bridge',
      test_status:
        'controlled_chrome_route_a_reviewable_not_broad_all_dance_coverage',
      does_not_cover: [
        'all_dance_patterns',
        'semantic_dance_quality',
        'self_mirror_pass_without_metric_interpretation',
      ],
    },
    {
      safe_ref: 'voice.stop_dance',
      status: 'supported',
      kind: 'stop',
      request_mode: 'stop',
      payload_ref: 'motion.thought_core.stop.v0',
      target_model_type: 'vrm',
      track_scope: 'full_body',
      expected_roi: 'avatar_full',
      expected_visible_change: 'neutral_idle_requested',
      scenario_label: 'dance_stop_to_idle',
      route_owner: 'RR003-02 Motion / VRM / AITuber bridge',
      test_status: 'source_static_stop_stimulus_contract_only',
      does_not_cover: [
        'visible_stop_proof',
        'thought_core_stop_timing_policy',
        'self_mirror_pass_without_metric_interpretation',
      ],
    },
    {
      safe_ref: 'voice.smile_please',
      status: 'supported',
      kind: 'expression',
      request_mode: 'apply',
      payload_ref: 'motion.thought_core.expression_visible.v0',
      target_model_type: 'vrm',
      track_scope: 'face_head',
      track_channels: ['expression_weight'],
      expected_roi: 'avatar_face_head',
      expected_visible_change: 'face_expression',
      expression_profile_ref: 'motion.runtime.vrm_expression_weights.v0',
      scenario_label: 'expression_visible_change',
      route_owner: 'RR003-02 Motion / VRM / AITuber bridge',
      test_status:
        'controlled_chrome_route_b_reviewable_not_semantic_correctness',
      does_not_cover: [
        'all_expression_patterns',
        'semantic_expression_correctness',
        'self_mirror_pass_without_metric_interpretation',
      ],
    },
  ]

const UNSAFE_STIMULUS_REF_PATTERN =
  /(?:raw|private|provider|device|entity|ha_entity|home_control|home|appliance|action|media|audio|video|screenshot|transcript|prompt|token|secret|credential|password|authorization|api[_-]?key|local_path|absolute_path|https?:\/\/|file:\/\/|[a-zA-Z]:[\\/]|\\\\)/i

export type ProjectionVisualMotionStimulus = Record<string, unknown>

export type ProjectionVisualStimulusRefUnsupportedReasonCode =
  | 'unsupported_ref_empty_or_invalid'
  | 'unsupported_unsafe_ref'
  | 'unsupported_ref_not_in_inventory'

export type ProjectionVisualStimulusRefInventoryEntry = {
  safe_ref: ProjectionVisualStimulusRef
  status: 'supported'
  kind: 'dance_sequence' | 'stop' | 'expression'
  request_mode: 'play' | 'stop' | 'apply'
  payload_ref: string
  target_model_type: 'vrm'
  track_scope: 'full_body' | 'face_head'
  track_channels?: string[]
  expected_roi: 'avatar_full' | 'avatar_face_head'
  expected_visible_change:
    | 'broad_avatar_motion'
    | 'neutral_idle_requested'
    | 'face_expression'
  expression_profile_ref?: string
  scenario_label:
    | 'dance_visible_motion'
    | 'dance_stop_to_idle'
    | 'expression_visible_change'
  route_owner: 'RR003-02 Motion / VRM / AITuber bridge'
  test_status: string
  does_not_cover: string[]
}

export type ProjectionVisualStimulusRefDiagnostic =
  | {
      supported: true
      stimulus_ref: ProjectionVisualStimulusRef
      normalized_ref: ProjectionVisualStimulusRef
      inventory_entry: ProjectionVisualStimulusRefInventoryEntry
    }
  | {
      supported: false
      normalized_ref?: string
      reason_code: ProjectionVisualStimulusRefUnsupportedReasonCode
    }

export type ProjectionVisualStimulusDispatchTimeline = {
  capture_started_at_ms?: number
  motion_requested_at_ms?: number
  stimulus_dispatched_at_ms?: number
  result_event_observed_at_ms?: number
}

export type ProjectionVisualStimulusDispatchAdapterState = {
  schema_version: typeof PROJECTION_VISUAL_STIMULUS_DISPATCH_ADAPTER_SCHEMA_VERSION
  transport: 'projection_visual_safe_query_ref'
  stimulus_ref: ProjectionVisualStimulusRef
  status: 'waiting_for_vrm' | 'dispatched' | 'timeout' | 'unavailable'
  reason_code: string
  motion_event_id?: string
  stimulus_id?: string
  stimulus_instance_id?: string
  runtime_result_id?: string
  driver_result_id?: string
  dispatch_timeline?: ProjectionVisualStimulusDispatchTimeline
  result?: Pick<
    MotionStimulusReceiverResult,
    | 'accepted'
    | 'status'
    | 'reason_code'
    | 'safe_visible_state'
    | 'motion_event_id'
    | 'stimulus_id'
    | 'stimulus_instance_id'
    | 'runtime_result_id'
    | 'driver_result_id'
    | 'multi_stimulus_group_id'
  >
}

export type ProjectionVisualMotionRunEvidenceLayer =
  | 'source_no_live_design'
  | 'source_no_live_contract'
  | 'helper_runtime'
  | 'controlled_chrome_runtime'
  | 'self_mirror_metric'
  | 'local_visual_diagnostic'

export type ProjectionVisualMotionRunPostNavigationContinuity =
  | 'runner_verified'
  | 'runner_required'
  | 'not_applicable_source_no_live'
  | 'failed_reacquire'
  | 'unknown'

export type ProjectionVisualMotionRunReasonLayer =
  | 'dispatch'
  | 'receiver_runtime'
  | 'frame_driver'
  | 'readback'
  | 'roi_window'
  | 'target'
  | 'safety'
  | 'unknown'

export type ProjectionVisualMotionRunReasonGroup = {
  layer: ProjectionVisualMotionRunReasonLayer
  reason_codes: string[]
}

type ProjectionVisualMotionRunObservationSummaryInput = {
  schema_version?: string
  scenario_label?:
    | 'dance_visible_motion'
    | 'dance_stop_to_idle'
    | 'expression_visible_change'
  target_identity?: {
    capture_surface_kind?: string
    same_page_or_target?: boolean
    browser_process_kind?: string
    proof_ceiling?: string
    target_identity_status?: string
  }
  runtime_join?: {
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
  event_timeline?: ProjectionVisualStimulusDispatchTimeline & {
    runtime_started_at_ms?: number
  }
  frame_applied_anchor?: Record<string, unknown>
  canvas_readback_summary?: {
    readback_status?: string
    readback_strategy?: string
    readback_metric_readiness?: string
    readback_metric_blocker_reason_codes?: string[]
    readback_context_kinds?: string[]
    static_reason_codes?: string[]
    latest_canvas_buffer_width?: number
    latest_canvas_buffer_height?: number
    latest_canvas_client_width?: number
    latest_canvas_client_height?: number
    latest_device_pixel_ratio?: number
  }
  roi_window_coverage?: {
    expected_roi_window_count?: number
    observed_roi_window_count?: number
    missing_roi_window_count?: number
    missing_window_reason_codes?: string[]
    active_sample_sufficient?: boolean
    min_authority_active_sample_count?: number
    baseline_comparison_kind?: string
  }
  roi_input_diagnostics?: unknown[]
  roi_window_metrics?: unknown[]
  rois?: Array<{
    roi_id?: string
    kind?: string
    counts_as_avatar_motion?: boolean
    expected_for_pass?: boolean
  }>
  dance_avatar_full_readback_diagnostic?: Record<string, unknown>
  authority_roi_mapping_diagnostic?: {
    mapping_status?: string
    decision_hint?: string
    reason_codes?: string[]
    authority_roi_id?: string
    guard_roi_id?: string
    guard_roi_support_only?: boolean
  }
  raw_frame_included?: boolean
  raw_screenshot_included?: boolean
  raw_video_included?: boolean
  raw_log_included?: boolean
  provider_payload_included?: boolean
}

export type ProjectionVisualMotionRunEvidenceEnvelopeTargetIdentityInput = {
  capture_surface_kind?: string
  browser_process_kind?: string
  safe_tab_session_id?: string
  same_page_or_target?: boolean
  post_navigation_continuity?: ProjectionVisualMotionRunPostNavigationContinuity
  proof_ceiling?: string
}

export type ProjectionVisualMotionRunEvidenceEnvelopeArgs = {
  routeId: string
  runId?: string
  evidenceLayer?: ProjectionVisualMotionRunEvidenceLayer
  proofCeiling?: string
  state: ProjectionVisualStimulusDispatchAdapterState
  observationSummary?: ProjectionVisualMotionRunObservationSummaryInput
  targetIdentity?: ProjectionVisualMotionRunEvidenceEnvelopeTargetIdentityInput
}

export type ProjectionVisualMotionRunEvidenceEnvelope = {
  schema_version: typeof PROJECTION_VISUAL_MOTION_RUN_EVIDENCE_ENVELOPE_SCHEMA_VERSION
  route_id: string
  run_id: string
  test_observability: 'diagnostics_status'
  evidence_layer: ProjectionVisualMotionRunEvidenceLayer
  safe_ref: ProjectionVisualStimulusRef
  scenario_label: ProjectionVisualStimulusRefInventoryEntry['scenario_label']
  proof_ceiling: string
  safe_ref_inventory: ProjectionVisualStimulusRefInventoryEntry
  runtime_join: {
    motion_event_id?: string
    stimulus_id?: string
    stimulus_instance_id?: string
    runtime_result_id?: string
    driver_result_id?: string
    multi_stimulus_group_id?: string
    result_accepted?: boolean
    result_status?: string
    result_reason_code?: string
    result_safe_visible_state?: string
  }
  target_identity: {
    capture_surface_kind: string
    browser_process_kind: string
    safe_tab_session_id?: string
    same_page_or_target?: boolean
    post_navigation_continuity: ProjectionVisualMotionRunPostNavigationContinuity
    proof_ceiling: string
    target_identity_status: string
  }
  lifecycle: {
    adapter_status: ProjectionVisualStimulusDispatchAdapterState['status']
    adapter_reason_code?: string
    result_accepted?: boolean
    runtime_status?: string
    runtime_reason_code?: string
    safe_visible_state?: string
    result_event_observed_at_ms?: number
  }
  frame_applied_anchor: Record<string, unknown>
  readback_summary: {
    readback_status: string
    readback_strategy: string
    readback_metric_readiness: string
    readback_context_kinds: string[]
    static_reason_codes: string[]
    readback_metric_blocker_reason_codes: string[]
    latest_canvas_buffer_width?: number
    latest_canvas_buffer_height?: number
    latest_canvas_client_width?: number
    latest_canvas_client_height?: number
    latest_device_pixel_ratio?: number
  }
  roi_summary: {
    authority_roi_id: ProjectionVisualStimulusRefInventoryEntry['expected_roi']
    guard_roi_id?: 'speech_bubble'
    guard_roi_support_only: true
    roi_window_metrics: unknown[]
    roi_window_coverage?: ProjectionVisualMotionRunObservationSummaryInput['roi_window_coverage']
    roi_input_diagnostics: unknown[]
    dance_avatar_full_readback_diagnostic?: Record<string, unknown>
    authority_roi_mapping_diagnostic?: ProjectionVisualMotionRunObservationSummaryInput['authority_roi_mapping_diagnostic']
  }
  reason_codes: ProjectionVisualMotionRunReasonGroup[]
  safety_flags: {
    raw_frame_included: false
    raw_screenshot_included: false
    raw_video_included: false
    raw_log_included: false
    provider_payload_included: false
    private_data_included: false
    browser_storage_included: false
    home_control_data_included: false
    device_data_included: false
  }
  review_boundaries: {
    does_not_prove: string[]
    next_owner_hint: 'integration_management_routes_test_qa_review'
  }
}

export const PROJECTION_VISUAL_RUNTIME_DOM_SUMMARY_ATTRIBUTE_NAMES = [
  PROJECTION_VISUAL_RUNTIME_DOM_SUMMARY_ATTRIBUTE,
  'data-projection-visual-runtime-summary-source-schema',
  'data-projection-visual-runtime-summary-transport',
  'data-projection-visual-runtime-summary-stimulus-ref',
  'data-projection-visual-runtime-summary-adapter-status',
  'data-projection-visual-runtime-summary-adapter-reason-code',
  'data-projection-visual-runtime-summary-dispatch-state',
  'data-projection-visual-runtime-summary-motion-event-id',
  'data-projection-visual-runtime-summary-stimulus-id',
  'data-projection-visual-runtime-summary-stimulus-instance-id',
  'data-projection-visual-runtime-summary-runtime-result-id',
  'data-projection-visual-runtime-summary-driver-result-id',
  'data-projection-visual-runtime-summary-result-accepted',
  'data-projection-visual-runtime-summary-result-status',
  'data-projection-visual-runtime-summary-result-reason-code',
  'data-projection-visual-runtime-summary-safe-visible-state',
  'data-projection-visual-runtime-summary-raw-media-published',
  'data-projection-visual-runtime-summary-raw-logs-published',
  'data-projection-visual-runtime-summary-provider-payload-published',
  'data-projection-visual-runtime-summary-private-data-published',
  'data-projection-visual-runtime-summary-home-control-data-present',
] as const

export type ProjectionVisualRuntimeDomSummaryAttributes = Partial<
  Record<
    (typeof PROJECTION_VISUAL_RUNTIME_DOM_SUMMARY_ATTRIBUTE_NAMES)[number],
    string
  >
>

export function resolveProjectionVisualStimulusRef(
  value?: string
): ProjectionVisualStimulusRef | undefined {
  const normalized = value?.trim().toLowerCase()
  if (!normalized) return undefined
  return SUPPORTED_STIMULUS_REFS.has(normalized as ProjectionVisualStimulusRef)
    ? (normalized as ProjectionVisualStimulusRef)
    : undefined
}

export function getProjectionVisualStimulusRefInventory(): ProjectionVisualStimulusRefInventoryEntry[] {
  return STIMULUS_REF_INVENTORY.map((entry) => ({
    ...entry,
    track_channels: entry.track_channels
      ? [...entry.track_channels]
      : undefined,
    does_not_cover: [...entry.does_not_cover],
  }))
}

export function diagnoseProjectionVisualStimulusRef(
  value?: unknown
): ProjectionVisualStimulusRefDiagnostic {
  if (typeof value !== 'string') {
    return { supported: false, reason_code: 'unsupported_ref_empty_or_invalid' }
  }

  const normalized = value.trim().toLowerCase()
  if (!normalized) {
    return { supported: false, reason_code: 'unsupported_ref_empty_or_invalid' }
  }
  if (UNSAFE_STIMULUS_REF_PATTERN.test(normalized)) {
    return {
      supported: false,
      normalized_ref: normalized,
      reason_code: 'unsupported_unsafe_ref',
    }
  }

  const inventoryEntry = STIMULUS_REF_INVENTORY.find(
    (entry) => entry.safe_ref === normalized
  )
  if (!inventoryEntry) {
    return {
      supported: false,
      normalized_ref: normalized,
      reason_code: 'unsupported_ref_not_in_inventory',
    }
  }

  return {
    supported: true,
    stimulus_ref: inventoryEntry.safe_ref,
    normalized_ref: inventoryEntry.safe_ref,
    inventory_entry: {
      ...inventoryEntry,
      track_channels: inventoryEntry.track_channels
        ? [...inventoryEntry.track_channels]
        : undefined,
      does_not_cover: [...inventoryEntry.does_not_cover],
    },
  }
}

export function buildProjectionVisualMotionRunEvidenceEnvelope({
  routeId,
  runId,
  evidenceLayer = 'source_no_live_contract',
  proofCeiling,
  state,
  observationSummary,
  targetIdentity,
}: ProjectionVisualMotionRunEvidenceEnvelopeArgs): ProjectionVisualMotionRunEvidenceEnvelope {
  const inventoryEntry = inventoryEntryForRef(state.stimulus_ref)
  const runtimeJoin = {
    motion_event_id:
      safeEnvelopeValue(state.result?.motion_event_id) ??
      safeEnvelopeValue(observationSummary?.runtime_join?.motion_event_id) ??
      safeEnvelopeValue(state.motion_event_id),
    stimulus_id:
      safeEnvelopeValue(state.result?.stimulus_id) ??
      safeEnvelopeValue(observationSummary?.runtime_join?.stimulus_id) ??
      safeEnvelopeValue(state.stimulus_id),
    stimulus_instance_id:
      safeEnvelopeValue(state.result?.stimulus_instance_id) ??
      safeEnvelopeValue(
        observationSummary?.runtime_join?.stimulus_instance_id
      ) ??
      safeEnvelopeValue(state.stimulus_instance_id),
    runtime_result_id:
      safeEnvelopeValue(state.result?.runtime_result_id) ??
      safeEnvelopeValue(observationSummary?.runtime_join?.runtime_result_id) ??
      safeEnvelopeValue(state.runtime_result_id),
    driver_result_id:
      safeEnvelopeValue(state.result?.driver_result_id) ??
      safeEnvelopeValue(observationSummary?.runtime_join?.driver_result_id) ??
      safeEnvelopeValue(state.driver_result_id),
    multi_stimulus_group_id: safeEnvelopeValue(
      state.result?.multi_stimulus_group_id ??
        observationSummary?.runtime_join?.multi_stimulus_group_id
    ),
    result_accepted: state.result?.accepted,
    result_status:
      safeEnvelopeValue(state.result?.status) ??
      safeEnvelopeValue(observationSummary?.runtime_join?.result_status),
    result_reason_code:
      safeEnvelopeValue(state.result?.reason_code) ??
      safeEnvelopeValue(observationSummary?.runtime_join?.result_reason_code),
    result_safe_visible_state:
      safeEnvelopeValue(state.result?.safe_visible_state) ??
      safeEnvelopeValue(
        observationSummary?.runtime_join?.result_safe_visible_state
      ),
  }
  const targetProofCeiling =
    safeEnvelopeValue(proofCeiling) ??
    safeEnvelopeValue(targetIdentity?.proof_ceiling) ??
    safeEnvelopeValue(observationSummary?.target_identity?.proof_ceiling) ??
    'source_no_live_contract'
  const reasonCodes = buildProjectionVisualMotionRunReasonGroups([
    state.reason_code,
    runtimeJoin.result_reason_code,
    ...(observationSummary?.canvas_readback_summary
      ?.readback_metric_blocker_reason_codes ?? []),
    ...(observationSummary?.canvas_readback_summary?.static_reason_codes ?? []),
    ...(observationSummary?.roi_window_coverage?.missing_window_reason_codes ??
      []),
    ...(observationSummary?.authority_roi_mapping_diagnostic?.reason_codes ??
      []),
    observationSummary?.authority_roi_mapping_diagnostic?.mapping_status,
  ])

  return {
    schema_version:
      PROJECTION_VISUAL_MOTION_RUN_EVIDENCE_ENVELOPE_SCHEMA_VERSION,
    route_id: safeEnvelopeValue(routeId) ?? 'route_id_omitted_unsafe',
    run_id: safeEnvelopeValue(runId) ?? 'run_id_unavailable_runner_required',
    test_observability: 'diagnostics_status',
    evidence_layer: evidenceLayer,
    safe_ref: state.stimulus_ref,
    scenario_label:
      observationSummary?.scenario_label ?? inventoryEntry.scenario_label,
    proof_ceiling: targetProofCeiling,
    safe_ref_inventory: {
      ...inventoryEntry,
      track_channels: inventoryEntry.track_channels
        ? [...inventoryEntry.track_channels]
        : undefined,
      does_not_cover: [...inventoryEntry.does_not_cover],
    },
    runtime_join: runtimeJoin,
    target_identity: {
      capture_surface_kind:
        safeEnvelopeValue(targetIdentity?.capture_surface_kind) ??
        safeEnvelopeValue(
          observationSummary?.target_identity?.capture_surface_kind
        ) ??
        'source_no_live_no_browser_target',
      browser_process_kind:
        safeEnvelopeValue(targetIdentity?.browser_process_kind) ??
        safeEnvelopeValue(
          observationSummary?.target_identity?.browser_process_kind
        ) ??
        'source_no_live_no_browser_process',
      safe_tab_session_id: safeEnvelopeValue(
        targetIdentity?.safe_tab_session_id
      ),
      same_page_or_target:
        targetIdentity?.same_page_or_target ??
        observationSummary?.target_identity?.same_page_or_target,
      post_navigation_continuity:
        targetIdentity?.post_navigation_continuity ??
        (evidenceLayer === 'source_no_live_contract'
          ? 'not_applicable_source_no_live'
          : 'runner_required'),
      proof_ceiling: targetProofCeiling,
      target_identity_status:
        safeEnvelopeValue(
          observationSummary?.target_identity?.target_identity_status
        ) ??
        (targetIdentity?.post_navigation_continuity === 'runner_verified'
          ? 'runner_verified'
          : 'page_summary_requires_runner_tab_safe_id'),
    },
    lifecycle: {
      adapter_status: state.status,
      adapter_reason_code: safeEnvelopeValue(state.reason_code),
      result_accepted: state.result?.accepted,
      runtime_status: runtimeJoin.result_status,
      runtime_reason_code: runtimeJoin.result_reason_code,
      safe_visible_state: runtimeJoin.result_safe_visible_state,
      result_event_observed_at_ms:
        observationSummary?.event_timeline?.result_event_observed_at_ms ??
        state.dispatch_timeline?.result_event_observed_at_ms,
    },
    frame_applied_anchor: observationSummary?.frame_applied_anchor ?? {
      source: 'not_available',
    },
    readback_summary: {
      readback_status:
        safeEnvelopeValue(
          observationSummary?.canvas_readback_summary?.readback_status
        ) ?? 'unavailable',
      readback_strategy:
        safeEnvelopeValue(
          observationSummary?.canvas_readback_summary?.readback_strategy
        ) ?? 'unavailable',
      readback_metric_readiness:
        safeEnvelopeValue(
          observationSummary?.canvas_readback_summary?.readback_metric_readiness
        ) ?? 'unavailable',
      readback_context_kinds: safeStringArray(
        observationSummary?.canvas_readback_summary?.readback_context_kinds
      ),
      static_reason_codes: safeStringArray(
        observationSummary?.canvas_readback_summary?.static_reason_codes
      ),
      readback_metric_blocker_reason_codes: safeStringArray(
        observationSummary?.canvas_readback_summary
          ?.readback_metric_blocker_reason_codes
      ),
      latest_canvas_buffer_width:
        observationSummary?.canvas_readback_summary?.latest_canvas_buffer_width,
      latest_canvas_buffer_height:
        observationSummary?.canvas_readback_summary
          ?.latest_canvas_buffer_height,
      latest_canvas_client_width:
        observationSummary?.canvas_readback_summary?.latest_canvas_client_width,
      latest_canvas_client_height:
        observationSummary?.canvas_readback_summary
          ?.latest_canvas_client_height,
      latest_device_pixel_ratio:
        observationSummary?.canvas_readback_summary?.latest_device_pixel_ratio,
    },
    roi_summary: {
      authority_roi_id: inventoryEntry.expected_roi,
      guard_roi_id: hasSpeechBubbleGuardRoi(observationSummary)
        ? 'speech_bubble'
        : undefined,
      guard_roi_support_only: true,
      roi_window_metrics: observationSummary?.roi_window_metrics ?? [],
      roi_window_coverage: observationSummary?.roi_window_coverage,
      roi_input_diagnostics: observationSummary?.roi_input_diagnostics ?? [],
      dance_avatar_full_readback_diagnostic:
        observationSummary?.dance_avatar_full_readback_diagnostic,
      authority_roi_mapping_diagnostic:
        observationSummary?.authority_roi_mapping_diagnostic,
    },
    reason_codes: reasonCodes,
    safety_flags: {
      raw_frame_included: false,
      raw_screenshot_included: false,
      raw_video_included: false,
      raw_log_included: false,
      provider_payload_included: false,
      private_data_included: false,
      browser_storage_included: false,
      home_control_data_included: false,
      device_data_included: false,
    },
    review_boundaries: {
      does_not_prove: [
        'visible_motion_pass',
        'self_mirror_pass',
        'physical_display_proof',
        'semantic_dance_quality',
        'semantic_expression_correctness',
        'source_adoption',
        'rr003_representative_pass',
      ],
      next_owner_hint: 'integration_management_routes_test_qa_review',
    },
  }
}

export function buildProjectionVisualMotionRunReasonGroups(
  reasonCodes: Array<string | undefined>
): ProjectionVisualMotionRunReasonGroup[] {
  const grouped = new Map<ProjectionVisualMotionRunReasonLayer, Set<string>>()
  for (const reasonCode of reasonCodes) {
    const safeReasonCode = safeEnvelopeValue(reasonCode)
    if (!safeReasonCode) continue
    const layer = classifyProjectionVisualMotionRunReasonCode(safeReasonCode)
    const values = grouped.get(layer) ?? new Set<string>()
    values.add(safeReasonCode)
    grouped.set(layer, values)
  }

  return Array.from(grouped.entries()).map(([layer, values]) => ({
    layer,
    reason_codes: Array.from(values),
  }))
}

export function classifyProjectionVisualMotionRunReasonCode(
  reasonCode: string
): ProjectionVisualMotionRunReasonLayer {
  if (
    /(?:waiting_for_vrm|dispatch|projection_visual_root|motion_stimulus_result_observed)/.test(
      reasonCode
    )
  ) {
    return 'dispatch'
  }
  if (
    /(?:motion_runtime|target_model|stimulus_not_supported|request_mode_not_supported|receiver)/.test(
      reasonCode
    )
  ) {
    return 'receiver_runtime'
  }
  if (/(?:frame|pose|driver|expression_weight)/.test(reasonCode)) {
    return 'frame_driver'
  }
  if (/(?:readback|webgl|canvas|preserve|luma)/.test(reasonCode)) {
    return 'readback'
  }
  if (
    /(?:roi|window|sample|baseline|authority|guard|mapping)/.test(reasonCode)
  ) {
    return 'roi_window'
  }
  if (/(?:runner|target|navigation|reacquire|page_summary)/.test(reasonCode)) {
    return 'target'
  }
  if (
    /(?:raw|private|provider|device|entity|home_control|storage|secret|unsafe)/.test(
      reasonCode
    )
  ) {
    return 'safety'
  }
  return 'unknown'
}

export function createProjectionVisualMotionStimulusFromRef(
  stimulusRef: ProjectionVisualStimulusRef,
  requestedAt: Date = new Date()
): ProjectionVisualMotionStimulus {
  const requestedAtIso = requestedAt.toISOString()
  const suffix = createSafeTimestampSuffix(requestedAt)
  const sharedTrace = {
    event_id: `evt_controlled_chrome_${refSlug(stimulusRef)}_${suffix}`,
    turn_id: `turn_controlled_chrome_${refSlug(stimulusRef)}_${suffix}`,
    session_id: `session_controlled_chrome_${suffix}`,
    request_id: `req_controlled_chrome_${refSlug(stimulusRef)}_${suffix}`,
    attempt_id: 'attempt_1',
    multi_stimulus_group_id: `multi_stimulus_controlled_chrome_${suffix}`,
  }

  if (stimulusRef === 'voice.dance_please') {
    return {
      schema_version: 'motion_stimulus.v0',
      motion_event_id: `mot_evt_controlled_chrome_dance_${suffix}`,
      stimulus_id: 'mot_stim_controlled_chrome_voice_dance_please',
      stimulus_instance_id: `mot_inst_controlled_chrome_dance_${suffix}`,
      source_class: 'thought_core',
      source_origin: 'motion.requested',
      requested_at: requestedAtIso,
      kind: 'dance_sequence',
      request_mode: 'play',
      phase: 'requested',
      lifecycle_state: 'request_issued',
      safe_visible_state: 'motion_requested',
      target_model_type: 'vrm',
      payload_ref: 'motion.thought_core.dance_sequence.v0',
      track_mask: { scope: 'full_body' },
      requirements: { visible_motion: true },
      trace: {
        ...sharedTrace,
        runtime_result_id: `mot_res_controlled_chrome_dance_${suffix}`,
      },
      redaction: {
        shared_summary_only: true,
        safe_ref_transport: true,
      },
    }
  }

  if (stimulusRef === 'voice.stop_dance') {
    return {
      schema_version: 'motion_stimulus.v0',
      motion_event_id: `mot_evt_controlled_chrome_stop_${suffix}`,
      stimulus_id: 'mot_stim_controlled_chrome_voice_stop_dance',
      stimulus_instance_id: `mot_inst_controlled_chrome_stop_${suffix}`,
      source_class: 'thought_core',
      source_origin: 'motion.requested',
      requested_at: requestedAtIso,
      kind: 'stop',
      request_mode: 'stop',
      phase: 'requested',
      lifecycle_state: 'request_issued',
      safe_visible_state: 'neutral_idle_requested',
      target_model_type: 'vrm',
      payload_ref: 'motion.thought_core.stop.v0',
      duration_ms: 0,
      loop: false,
      interrupt_policy: 'stop',
      fallback_state: 'stop_to_idle',
      stop_reason: 'user_requested',
      track_mask: { scope: 'full_body' },
      requirements: {
        stop_target: 'dance.sequence',
        fallback_state: 'stop_to_idle',
      },
      trace: {
        ...sharedTrace,
        runtime_result_id: `mot_res_controlled_chrome_stop_${suffix}`,
      },
      redaction: {
        shared_summary_only: true,
        safe_ref_transport: true,
      },
    }
  }

  return {
    schema_version: 'motion_stimulus.v0',
    motion_event_id: `mot_evt_controlled_chrome_expression_${suffix}`,
    stimulus_id: 'mot_stim_controlled_chrome_voice_smile_please',
    stimulus_instance_id: `mot_inst_controlled_chrome_expression_${suffix}`,
    source_class: 'thought_core',
    source_origin: 'motion.requested',
    requested_at: requestedAtIso,
    kind: 'expression',
    request_mode: 'apply',
    phase: 'requested',
    lifecycle_state: 'request_issued',
    safe_visible_state: 'expression_change_requested',
    target_model_type: 'vrm',
    payload_ref: 'motion.thought_core.expression_visible.v0',
    track_mask: { scope: 'face_head', channels: ['expression_weight'] },
    requirements: {
      expression_profile_ref: 'motion.runtime.vrm_expression_weights.v0',
      expected_visible_change: 'face_expression',
      expected_roi: 'avatar_face_head',
    },
    trace: {
      ...sharedTrace,
      runtime_result_id: `mot_res_controlled_chrome_expression_${suffix}`,
      driver_result_id: `driver_result_controlled_chrome_expression_${suffix}`,
    },
    redaction: {
      shared_summary_only: true,
      safe_ref_transport: true,
    },
  }
}

export function safeStimulusString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

export function readTraceString(
  stimulus: ProjectionVisualMotionStimulus,
  key: string
): string | undefined {
  const trace = stimulus.trace
  if (!trace || typeof trace !== 'object' || Array.isArray(trace)) {
    return undefined
  }
  const value = (trace as Record<string, unknown>)[key]
  return typeof value === 'string' ? value : undefined
}

export function buildProjectionVisualRuntimeDomSummaryAttributes(
  state: ProjectionVisualStimulusDispatchAdapterState
): ProjectionVisualRuntimeDomSummaryAttributes {
  const attributes: ProjectionVisualRuntimeDomSummaryAttributes = {
    [PROJECTION_VISUAL_RUNTIME_DOM_SUMMARY_ATTRIBUTE]:
      PROJECTION_VISUAL_RUNTIME_DOM_SUMMARY_SCHEMA_VERSION,
    'data-projection-visual-runtime-summary-raw-media-published': 'false',
    'data-projection-visual-runtime-summary-raw-logs-published': 'false',
    'data-projection-visual-runtime-summary-provider-payload-published':
      'false',
    'data-projection-visual-runtime-summary-private-data-published': 'false',
    'data-projection-visual-runtime-summary-home-control-data-present': 'false',
  }

  setSafeDomSummaryAttribute(
    attributes,
    'data-projection-visual-runtime-summary-source-schema',
    state.schema_version
  )
  setSafeDomSummaryAttribute(
    attributes,
    'data-projection-visual-runtime-summary-transport',
    state.transport
  )
  setSafeDomSummaryAttribute(
    attributes,
    'data-projection-visual-runtime-summary-stimulus-ref',
    state.stimulus_ref
  )
  setSafeDomSummaryAttribute(
    attributes,
    'data-projection-visual-runtime-summary-adapter-status',
    state.status
  )
  setSafeDomSummaryAttribute(
    attributes,
    'data-projection-visual-runtime-summary-adapter-reason-code',
    state.reason_code
  )
  setSafeDomSummaryAttribute(
    attributes,
    'data-projection-visual-runtime-summary-dispatch-state',
    state.status
  )
  setSafeDomSummaryAttribute(
    attributes,
    'data-projection-visual-runtime-summary-motion-event-id',
    state.result?.motion_event_id ?? state.motion_event_id
  )
  setSafeDomSummaryAttribute(
    attributes,
    'data-projection-visual-runtime-summary-stimulus-id',
    state.result?.stimulus_id ?? state.stimulus_id
  )
  setSafeDomSummaryAttribute(
    attributes,
    'data-projection-visual-runtime-summary-stimulus-instance-id',
    state.result?.stimulus_instance_id ?? state.stimulus_instance_id
  )
  setSafeDomSummaryAttribute(
    attributes,
    'data-projection-visual-runtime-summary-runtime-result-id',
    state.result?.runtime_result_id ?? state.runtime_result_id
  )
  setSafeDomSummaryAttribute(
    attributes,
    'data-projection-visual-runtime-summary-driver-result-id',
    state.result?.driver_result_id ?? state.driver_result_id
  )
  setSafeDomSummaryAttribute(
    attributes,
    'data-projection-visual-runtime-summary-result-accepted',
    state.result?.accepted
  )
  setSafeDomSummaryAttribute(
    attributes,
    'data-projection-visual-runtime-summary-result-status',
    state.result?.status
  )
  setSafeDomSummaryAttribute(
    attributes,
    'data-projection-visual-runtime-summary-result-reason-code',
    state.result?.reason_code
  )
  setSafeDomSummaryAttribute(
    attributes,
    'data-projection-visual-runtime-summary-safe-visible-state',
    state.result?.safe_visible_state
  )

  return attributes
}

function createSafeTimestampSuffix(date: Date): string {
  return date
    .toISOString()
    .replace(/[-:.]/g, '')
    .replace('T', '_')
    .replace('Z', 'z')
}

function refSlug(stimulusRef: ProjectionVisualStimulusRef): string {
  return stimulusRef.replace('.', '_')
}

function setSafeDomSummaryAttribute(
  attributes: ProjectionVisualRuntimeDomSummaryAttributes,
  name: (typeof PROJECTION_VISUAL_RUNTIME_DOM_SUMMARY_ATTRIBUTE_NAMES)[number],
  value: unknown
) {
  const text = safeDomSummaryAttributeValue(value)
  if (text) attributes[name] = text
}

function safeDomSummaryAttributeValue(value: unknown): string | undefined {
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value !== 'string') return undefined

  const text = value.trim()
  if (!text || text.length > 160) return undefined
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

function inventoryEntryForRef(
  stimulusRef: ProjectionVisualStimulusRef
): ProjectionVisualStimulusRefInventoryEntry {
  const inventoryEntry = STIMULUS_REF_INVENTORY.find(
    (entry) => entry.safe_ref === stimulusRef
  )
  if (!inventoryEntry) {
    throw new Error(
      `Unsupported Projection Visual stimulus ref: ${stimulusRef}`
    )
  }
  return inventoryEntry
}

function safeEnvelopeValue(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const text = value.trim()
  if (!text || text.length > 200) return undefined
  if (!/^[a-zA-Z0-9._:-]+$/.test(text)) return undefined
  if (UNSAFE_STIMULUS_REF_PATTERN.test(text)) return undefined
  return text
}

function safeStringArray(values?: string[]): string[] {
  if (!values) return []
  return values.flatMap((value) => {
    const text = safeEnvelopeValue(value)
    return text ? [text] : []
  })
}

function hasSpeechBubbleGuardRoi(
  observationSummary?: ProjectionVisualMotionRunObservationSummaryInput
): boolean {
  return (
    observationSummary?.rois?.some(
      (roi) =>
        roi.roi_id === 'speech_bubble' &&
        roi.kind === 'guard_ui' &&
        roi.expected_for_pass === false
    ) ?? false
  )
}
