import {
  buildProjectionVisualMotionRunEvidenceEnvelope,
  buildProjectionVisualMotionRunReasonGroups,
  buildProjectionVisualRuntimeDomSummaryAttributes,
  diagnoseProjectionVisualStimulusRef,
  getProjectionVisualStimulusRefInventory,
  createProjectionVisualMotionStimulusFromRef,
  PROJECTION_VISUAL_MOTION_RUN_EVIDENCE_ENVELOPE_SCHEMA_VERSION,
  PROJECTION_VISUAL_RUNTIME_DOM_SUMMARY_SCHEMA_VERSION,
  resolveProjectionVisualStimulusRef,
  type ProjectionVisualStimulusDispatchAdapterState,
} from '../projectionVisualStimulusTransport'
import { receiveMotionStimulusV0 } from '../motionStimulusReceiver'

const REQUESTED_AT = new Date('2026-06-13T10:30:15.123Z')

describe('Projection Visual safe stimulus ref transport', () => {
  const danceState: ProjectionVisualStimulusDispatchAdapterState = {
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

  const expressionState: ProjectionVisualStimulusDispatchAdapterState = {
    ...danceState,
    stimulus_ref: 'voice.smile_please',
    motion_event_id: 'mot_evt_controlled_chrome_expression_1',
    stimulus_id: 'mot_stim_controlled_chrome_voice_smile_please',
    stimulus_instance_id: 'mot_inst_controlled_chrome_expression_1',
    runtime_result_id: 'mot_res_controlled_chrome_expression_planned_1',
    driver_result_id: 'driver_result_controlled_chrome_expression_1',
    result: {
      accepted: true,
      status: 'started',
      reason_code: 'motion_runtime_expression_frame_queued',
      safe_visible_state: 'expression_change_requested',
      motion_event_id: 'mot_evt_controlled_chrome_expression_1',
      stimulus_id: 'mot_stim_controlled_chrome_voice_smile_please',
      stimulus_instance_id: 'mot_inst_controlled_chrome_expression_1',
      runtime_result_id: 'mot_res_controlled_chrome_expression_actual_1',
      driver_result_id: 'driver_result_controlled_chrome_expression_1',
      multi_stimulus_group_id: 'multi_stimulus_controlled_chrome_1',
    },
  }

  it.each([
    ['voice.dance_please', 'voice.dance_please'],
    [' VOICE.SMILE_PLEASE ', 'voice.smile_please'],
    ['voice.unknown', undefined],
    ['provider_payload', undefined],
    ['entity_id', undefined],
    ['raw_transcript', undefined],
    ['https://example.test/stimulus', undefined],
  ])('resolves only supported safe stimulus refs: %s', (value, expected) => {
    expect(resolveProjectionVisualStimulusRef(value)).toBe(expected)
  })

  it('exports source-derived safe-ref inventory for the current review-exposed routes', () => {
    expect(getProjectionVisualStimulusRefInventory()).toEqual([
      expect.objectContaining({
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
        does_not_cover: expect.arrayContaining([
          'all_dance_patterns',
          'semantic_dance_quality',
        ]),
      }),
      expect.objectContaining({
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
        does_not_cover: expect.arrayContaining([
          'all_expression_patterns',
          'semantic_expression_correctness',
        ]),
      }),
    ])
  })

  it.each([
    ['voice.dance_please', true, undefined],
    [' VOICE.SMILE_PLEASE ', true, undefined],
    ['provider_payload', false, 'unsupported_unsafe_ref'],
    ['entity_id', false, 'unsupported_unsafe_ref'],
    ['raw_transcript', false, 'unsupported_unsafe_ref'],
    ['https://example.test/stimulus', false, 'unsupported_unsafe_ref'],
    ['voice.unknown', false, 'unsupported_ref_not_in_inventory'],
    ['', false, 'unsupported_ref_empty_or_invalid'],
    [undefined, false, 'unsupported_ref_empty_or_invalid'],
  ])(
    'diagnoses safe-ref inventory support: %s',
    (value, supported, reasonCode) => {
      const diagnostic = diagnoseProjectionVisualStimulusRef(value)

      expect(diagnostic.supported).toBe(supported)
      if (diagnostic.supported) {
        expect(diagnostic.inventory_entry.safe_ref).toBe(
          diagnostic.stimulus_ref
        )
      } else {
        expect(diagnostic.reason_code).toBe(reasonCode)
      }
    }
  )

  it('builds a dance run evidence envelope without turning runtime start into Self Mirror proof', () => {
    const envelope = buildProjectionVisualMotionRunEvidenceEnvelope({
      routeId: 'RR003-02-PV-MOTION-RUN-EVIDENCE-ENVELOPE-SNL-02',
      evidenceLayer: 'controlled_chrome_runtime',
      state: danceState,
      observationSummary: {
        scenario_label: 'dance_visible_motion',
        target_identity: {
          capture_surface_kind: 'controlled_chrome_extension_tab',
          same_page_or_target: true,
          browser_process_kind: 'chrome_extension_controlled_user_chrome',
          proof_ceiling: 'controlled_chrome_self_mirror_summary_only',
          target_identity_status: 'page_summary_requires_runner_tab_safe_id',
        },
        event_timeline: {
          capture_started_at_ms: 0,
          motion_requested_at_ms: 300,
          stimulus_dispatched_at_ms: 302.5,
          result_event_observed_at_ms: 336.25,
        },
        frame_applied_anchor: {
          source: 'motion_runtime_debug_snapshot',
          pose_frame_observed: true,
          dance_active_instance_count: 1,
          dance_active_group_keys: ['dance.sequence'],
        },
        canvas_readback_summary: {
          readback_status: 'changed',
          readback_strategy: 'presented_canvas_2d_copy',
          readback_metric_readiness: 'ready',
          readback_context_kinds: ['2d'],
          static_reason_codes: [],
          readback_metric_blocker_reason_codes: [],
          latest_canvas_buffer_width: 1280,
          latest_canvas_buffer_height: 720,
          latest_canvas_client_width: 1280,
          latest_canvas_client_height: 720,
          latest_device_pixel_ratio: 1,
        },
        roi_window_coverage: {
          expected_roi_window_count: 8,
          observed_roi_window_count: 8,
          missing_roi_window_count: 0,
          missing_window_reason_codes: [],
          active_sample_sufficient: true,
          min_authority_active_sample_count: 2,
          baseline_comparison_kind: 'mixed',
        },
        rois: [
          {
            roi_id: 'avatar_full',
            kind: 'avatar',
            counts_as_avatar_motion: true,
            expected_for_pass: true,
          },
          {
            roi_id: 'speech_bubble',
            kind: 'guard_ui',
            counts_as_avatar_motion: false,
            expected_for_pass: false,
          },
        ],
        roi_window_metrics: [
          {
            roi_id: 'avatar_full',
            window_id: 'active',
            sample_count: 4,
            motion_score: 0.2,
            changed_ratio: 0.3,
          },
        ],
        authority_roi_mapping_diagnostic: {
          mapping_status: 'authority_roi_metric_active',
          decision_hint: 'authority_roi_accepted',
          reason_codes: ['authority_roi_metric_active'],
          authority_roi_id: 'avatar_full',
          guard_roi_id: 'speech_bubble',
          guard_roi_support_only: true,
        },
      },
    })

    expect(envelope).toEqual(
      expect.objectContaining({
        schema_version:
          PROJECTION_VISUAL_MOTION_RUN_EVIDENCE_ENVELOPE_SCHEMA_VERSION,
        route_id: 'RR003-02-PV-MOTION-RUN-EVIDENCE-ENVELOPE-SNL-02',
        run_id: 'run_id_unavailable_runner_required',
        test_observability: 'diagnostics_status',
        safe_ref: 'voice.dance_please',
        scenario_label: 'dance_visible_motion',
        proof_ceiling: 'controlled_chrome_self_mirror_summary_only',
      })
    )
    expect(envelope.runtime_join).toEqual(
      expect.objectContaining({
        motion_event_id: 'mot_evt_controlled_chrome_dance_1',
        stimulus_id: 'mot_stim_controlled_chrome_voice_dance_please',
        stimulus_instance_id: 'mot_inst_controlled_chrome_dance_1',
        runtime_result_id: 'mot_res_controlled_chrome_dance_actual_1',
        result_accepted: true,
        result_status: 'started',
        result_reason_code: 'motion_runtime_vrma_started',
        result_safe_visible_state: 'motion_started',
      })
    )
    expect(envelope.target_identity).toEqual(
      expect.objectContaining({
        safe_tab_session_id: undefined,
        post_navigation_continuity: 'runner_required',
        target_identity_status: 'page_summary_requires_runner_tab_safe_id',
      })
    )
    expect(envelope.roi_summary).toEqual(
      expect.objectContaining({
        authority_roi_id: 'avatar_full',
        guard_roi_id: 'speech_bubble',
        guard_roi_support_only: true,
      })
    )
    expect(envelope.review_boundaries.does_not_prove).toEqual(
      expect.arrayContaining(['visible_motion_pass', 'self_mirror_pass'])
    )
    expect(envelope.safety_flags).toEqual(
      expect.objectContaining({
        raw_frame_included: false,
        provider_payload_included: false,
        browser_storage_included: false,
        home_control_data_included: false,
      })
    )
  })

  it('builds an expression envelope that preserves driver refs and expression anchors', () => {
    const envelope = buildProjectionVisualMotionRunEvidenceEnvelope({
      routeId: 'RR003-02-PV-MOTION-RUN-EVIDENCE-ENVELOPE-SNL-02',
      runId: 'run_expr_1',
      state: expressionState,
      targetIdentity: {
        safe_tab_session_id: 'chrome_tab_safe_1',
        post_navigation_continuity: 'runner_verified',
      },
      observationSummary: {
        scenario_label: 'expression_visible_change',
        frame_applied_anchor: {
          source: 'projection_visual_in_page_diagnostics.v0',
          expression_weight_applied: true,
          expression_frame_applied_count: 30,
          driver_result_id: 'driver_result_controlled_chrome_expression_1',
        },
        canvas_readback_summary: {
          readback_status: 'changed',
          readback_strategy: 'presented_canvas_2d_copy',
          readback_metric_readiness: 'ready',
          readback_context_kinds: ['2d'],
          static_reason_codes: [],
          readback_metric_blocker_reason_codes: [],
        },
        rois: [
          {
            roi_id: 'avatar_face_head',
            kind: 'avatar',
            counts_as_avatar_motion: true,
            expected_for_pass: true,
          },
          {
            roi_id: 'speech_bubble',
            kind: 'guard_ui',
            counts_as_avatar_motion: false,
            expected_for_pass: false,
          },
        ],
      },
    })

    expect(envelope.safe_ref_inventory).toEqual(
      expect.objectContaining({
        kind: 'expression',
        expected_roi: 'avatar_face_head',
        expression_profile_ref: 'motion.runtime.vrm_expression_weights.v0',
      })
    )
    expect(envelope.runtime_join).toEqual(
      expect.objectContaining({
        driver_result_id: 'driver_result_controlled_chrome_expression_1',
        result_reason_code: 'motion_runtime_expression_frame_queued',
        result_safe_visible_state: 'expression_change_requested',
      })
    )
    expect(envelope.target_identity).toEqual(
      expect.objectContaining({
        safe_tab_session_id: 'chrome_tab_safe_1',
        post_navigation_continuity: 'runner_verified',
      })
    )
    expect(envelope.frame_applied_anchor).toEqual(
      expect.objectContaining({
        expression_weight_applied: true,
        expression_frame_applied_count: 30,
      })
    )
    expect(envelope.review_boundaries.does_not_prove).toEqual(
      expect.arrayContaining(['semantic_expression_correctness'])
    )
  })

  it('classifies reason codes by layer without using them as pass claims', () => {
    expect(
      buildProjectionVisualMotionRunReasonGroups([
        'motion_stimulus_result_observed',
        'motion_runtime_vrma_started',
        'pose_frame_observed',
        'webgl_preserve_false',
        'first_sample_no_previous',
        'page_summary_requires_runner_tab_safe_id',
        'unsupported_unsafe_ref',
      ])
    ).toEqual(
      expect.arrayContaining([
        {
          layer: 'dispatch',
          reason_codes: ['motion_stimulus_result_observed'],
        },
        {
          layer: 'receiver_runtime',
          reason_codes: ['motion_runtime_vrma_started'],
        },
        { layer: 'frame_driver', reason_codes: ['pose_frame_observed'] },
        { layer: 'readback', reason_codes: ['webgl_preserve_false'] },
        { layer: 'roi_window', reason_codes: ['first_sample_no_previous'] },
        {
          layer: 'target',
          reason_codes: ['page_summary_requires_runner_tab_safe_id'],
        },
        { layer: 'safety', reason_codes: ['unsupported_unsafe_ref'] },
      ])
    )
  })

  it('builds a controlled-Chrome-safe dance stimulus accepted by the existing receiver', async () => {
    const startDance = jest.fn().mockResolvedValue({
      status: 'started',
      reason_code: 'motion_runtime_vrma_started',
      runtime_result_id: 'mot_res_controlled_chrome_dance_actual',
      safe_visible_state: 'motion_started',
    })
    const stimulus = createProjectionVisualMotionStimulusFromRef(
      'voice.dance_please',
      REQUESTED_AT
    )

    const result = await receiveMotionStimulusV0(
      stimulus,
      { startDance },
      { nowMs: () => 1_720_000_000_500 }
    )

    expect(stimulus).toEqual(
      expect.objectContaining({
        schema_version: 'motion_stimulus.v0',
        kind: 'dance_sequence',
        request_mode: 'play',
        payload_ref: 'motion.thought_core.dance_sequence.v0',
        target_model_type: 'vrm',
        safe_visible_state: 'motion_requested',
      })
    )
    expect(startDance).toHaveBeenCalledWith(
      expect.objectContaining({
        stimulusId: 'mot_stim_controlled_chrome_voice_dance_please',
        stimulusInstanceId:
          'mot_inst_controlled_chrome_dance_20260613_103015123z',
        groupKey: 'dance.sequence',
        trace: expect.objectContaining({
          event_id:
            'evt_controlled_chrome_voice_dance_please_20260613_103015123z',
          runtime_result_id:
            'mot_res_controlled_chrome_dance_20260613_103015123z',
          multi_stimulus_group_id:
            'multi_stimulus_controlled_chrome_20260613_103015123z',
        }),
      })
    )
    expect(result).toEqual(
      expect.objectContaining({
        accepted: true,
        status: 'started',
        reason_code: 'motion_runtime_vrma_started',
        safe_visible_state: 'motion_started',
        stimulus_id: 'mot_stim_controlled_chrome_voice_dance_please',
        runtime_result_id: 'mot_res_controlled_chrome_dance_actual',
      })
    )
  })

  it('builds an expression-visible stimulus accepted by the distinct expression adapter', async () => {
    const startDance = jest.fn()
    const startContextNod = jest.fn()
    const startExpressionVisible = jest.fn().mockReturnValue({
      status: 'started',
      reason_code: 'motion_runtime_expression_frame_queued',
      runtime_result_id: 'mot_res_controlled_chrome_expression_actual',
      safe_visible_state: 'expression_change_requested',
    })
    const stimulus = createProjectionVisualMotionStimulusFromRef(
      'voice.smile_please',
      REQUESTED_AT
    )

    const result = await receiveMotionStimulusV0(
      stimulus,
      { startDance, startContextNod, startExpressionVisible },
      { nowMs: () => 1_720_000_000_500 }
    )

    expect(stimulus).toEqual(
      expect.objectContaining({
        schema_version: 'motion_stimulus.v0',
        kind: 'expression',
        request_mode: 'apply',
        payload_ref: 'motion.thought_core.expression_visible.v0',
        target_model_type: 'vrm',
        safe_visible_state: 'expression_change_requested',
        track_mask: { scope: 'face_head', channels: ['expression_weight'] },
        requirements: expect.objectContaining({
          expression_profile_ref: 'motion.runtime.vrm_expression_weights.v0',
          expected_visible_change: 'face_expression',
          expected_roi: 'avatar_face_head',
        }),
      })
    )
    expect(startDance).not.toHaveBeenCalled()
    expect(startContextNod).not.toHaveBeenCalled()
    expect(startExpressionVisible).toHaveBeenCalledWith(
      expect.objectContaining({
        stimulusId: 'mot_stim_controlled_chrome_voice_smile_please',
        stimulusInstanceId:
          'mot_inst_controlled_chrome_expression_20260613_103015123z',
        trace: expect.objectContaining({
          runtime_result_id:
            'mot_res_controlled_chrome_expression_20260613_103015123z',
          driver_result_id:
            'driver_result_controlled_chrome_expression_20260613_103015123z',
        }),
      })
    )
    expect(result).toEqual(
      expect.objectContaining({
        accepted: true,
        status: 'started',
        reason_code: 'motion_runtime_expression_frame_queued',
        safe_visible_state: 'expression_change_requested',
        stimulus_id: 'mot_stim_controlled_chrome_voice_smile_please',
        runtime_result_id: 'mot_res_controlled_chrome_expression_actual',
        driver_result_id:
          'driver_result_controlled_chrome_expression_20260613_103015123z',
      })
    )
  })

  it('does not include raw, provider, media, device, or Home Control authority fields in generated payloads', () => {
    const generatedText = JSON.stringify([
      createProjectionVisualMotionStimulusFromRef(
        'voice.dance_please',
        REQUESTED_AT
      ),
      createProjectionVisualMotionStimulusFromRef(
        'voice.smile_please',
        REQUESTED_AT
      ),
    ])

    expect(generatedText).not.toContain('raw_prompt')
    expect(generatedText).not.toContain('raw_transcript')
    expect(generatedText).not.toContain('provider_payload')
    expect(generatedText).not.toContain('entity_id')
    expect(generatedText).not.toContain('ha_entity_id')
    expect(generatedText).not.toContain('local_path')
    expect(generatedText).not.toContain('private_path')
    expect(generatedText).not.toContain('http://')
    expect(generatedText).not.toContain('https://')
  })

  it('builds controlled-Chrome-readable DOM summary attributes from adapter result state', () => {
    const attributes = buildProjectionVisualRuntimeDomSummaryAttributes({
      schema_version: 'projection_visual_stimulus_dispatch_adapter.v0',
      transport: 'projection_visual_safe_query_ref',
      stimulus_ref: 'voice.dance_please',
      status: 'dispatched',
      reason_code: 'motion_stimulus_result_observed',
      motion_event_id: 'mot_evt_controlled_chrome_dance_1',
      stimulus_id: 'mot_stim_controlled_chrome_voice_dance_please',
      stimulus_instance_id: 'mot_inst_controlled_chrome_dance_1',
      runtime_result_id: 'mot_res_controlled_chrome_dance_planned_1',
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
    })

    expect(attributes).toEqual(
      expect.objectContaining({
        'data-projection-visual-runtime-summary-v0':
          PROJECTION_VISUAL_RUNTIME_DOM_SUMMARY_SCHEMA_VERSION,
        'data-projection-visual-runtime-summary-source-schema':
          'projection_visual_stimulus_dispatch_adapter.v0',
        'data-projection-visual-runtime-summary-stimulus-ref':
          'voice.dance_please',
        'data-projection-visual-runtime-summary-adapter-status': 'dispatched',
        'data-projection-visual-runtime-summary-adapter-reason-code':
          'motion_stimulus_result_observed',
        'data-projection-visual-runtime-summary-dispatch-state': 'dispatched',
        'data-projection-visual-runtime-summary-motion-event-id':
          'mot_evt_controlled_chrome_dance_1',
        'data-projection-visual-runtime-summary-stimulus-id':
          'mot_stim_controlled_chrome_voice_dance_please',
        'data-projection-visual-runtime-summary-stimulus-instance-id':
          'mot_inst_controlled_chrome_dance_1',
        'data-projection-visual-runtime-summary-runtime-result-id':
          'mot_res_controlled_chrome_dance_actual_1',
        'data-projection-visual-runtime-summary-result-accepted': 'true',
        'data-projection-visual-runtime-summary-result-status': 'started',
        'data-projection-visual-runtime-summary-result-reason-code':
          'motion_runtime_vrma_started',
        'data-projection-visual-runtime-summary-safe-visible-state':
          'motion_started',
        'data-projection-visual-runtime-summary-raw-media-published': 'false',
        'data-projection-visual-runtime-summary-raw-logs-published': 'false',
        'data-projection-visual-runtime-summary-provider-payload-published':
          'false',
        'data-projection-visual-runtime-summary-private-data-published':
          'false',
        'data-projection-visual-runtime-summary-home-control-data-present':
          'false',
      })
    )
  })

  it('omits unsafe DOM summary values instead of reflecting private or action markers', () => {
    const attributes = buildProjectionVisualRuntimeDomSummaryAttributes({
      schema_version: 'projection_visual_stimulus_dispatch_adapter.v0',
      transport: 'projection_visual_safe_query_ref',
      stimulus_ref: 'voice.smile_please',
      status: 'dispatched',
      reason_code: 'provider_payload',
      motion_event_id: 'local_path_marker',
      stimulus_id: 'mot_stim_controlled_chrome_voice_smile_please',
      stimulus_instance_id: 'mot_inst_controlled_chrome_expression_1',
      runtime_result_id: 'raw_runtime_result',
      driver_result_id: 'entity_driver_result',
      result: {
        accepted: false,
        status: 'unavailable',
        reason_code: 'home_control_route',
        safe_visible_state: 'private_visible_state',
        motion_event_id: 'mot_evt_controlled_chrome_expression_1',
        stimulus_id: 'mot_stim_controlled_chrome_voice_smile_please',
        stimulus_instance_id: 'mot_inst_controlled_chrome_expression_1',
        runtime_result_id: 'mot_res_controlled_chrome_expression_1',
        driver_result_id: 'driver_result_controlled_chrome_expression_1',
      },
    } as ProjectionVisualStimulusDispatchAdapterState)

    expect(attributes).toEqual(
      expect.objectContaining({
        'data-projection-visual-runtime-summary-v0':
          PROJECTION_VISUAL_RUNTIME_DOM_SUMMARY_SCHEMA_VERSION,
        'data-projection-visual-runtime-summary-stimulus-ref':
          'voice.smile_please',
        'data-projection-visual-runtime-summary-result-accepted': 'false',
        'data-projection-visual-runtime-summary-result-status': 'unavailable',
        'data-projection-visual-runtime-summary-motion-event-id':
          'mot_evt_controlled_chrome_expression_1',
        'data-projection-visual-runtime-summary-runtime-result-id':
          'mot_res_controlled_chrome_expression_1',
        'data-projection-visual-runtime-summary-driver-result-id':
          'driver_result_controlled_chrome_expression_1',
      })
    )
    expect(
      attributes['data-projection-visual-runtime-summary-adapter-reason-code']
    ).toBeUndefined()
    expect(
      attributes['data-projection-visual-runtime-summary-result-reason-code']
    ).toBeUndefined()
    expect(
      attributes['data-projection-visual-runtime-summary-safe-visible-state']
    ).toBeUndefined()
    expect(JSON.stringify(attributes)).not.toContain('local_path_marker')
    expect(JSON.stringify(attributes)).not.toContain('provider_payload')
    expect(JSON.stringify(attributes)).not.toContain('home_control_route')
    expect(JSON.stringify(attributes)).not.toContain('private_visible_state')
    expect(JSON.stringify(attributes)).not.toContain('entity_driver_result')
  })
})
