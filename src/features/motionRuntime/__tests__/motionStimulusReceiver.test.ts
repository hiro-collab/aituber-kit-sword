import {
  CONTEXT_NOD_DURATION_MS,
  CONTEXT_NOD_GROUP_KEY,
  DANCE_SEQUENCE_GROUP_KEY,
  DEFAULT_DANCE_MOTION_ASSET_PATH,
  receiveMotionStimulusV0,
  type MotionStimulusReceiverAdapter,
} from '../motionStimulusReceiver'

describe('receiveMotionStimulusV0', () => {
  it('validates a safe motion_stimulus.v0 subset and starts the dance adapter', async () => {
    const startDance = jest.fn().mockResolvedValue({
      status: 'started',
      reason_code: 'motion_runtime_vrma_started',
      runtime_result_id: 'runtime-result-1',
      safe_visible_state: 'motion_started',
    })
    const result = await receiveMotionStimulusV0(
      createDanceStimulus(),
      { startDance },
      { nowMs: () => 1_720_000_000_500 }
    )

    expect(startDance).toHaveBeenCalledWith(
      expect.objectContaining({
        assetPath: DEFAULT_DANCE_MOTION_ASSET_PATH,
        stimulusId: 'dance.sequence',
        stimulusInstanceId: 'stimulus-instance-1',
        groupKey: 'dance.sequence',
        requestedAtMs: Date.parse('2026-06-05T08:55:00.000Z'),
        loop: true,
        trace: expect.objectContaining({
          request_id: 'motion-request-1',
          attempt_id: '1',
          runtime_result_id: 'runtime-result-planned-1',
          multi_stimulus_group_id: 'multi-stimulus-turn-1',
          motion_event_id: 'motion-event-1',
          stimulus_id: 'dance.sequence',
          stimulus_instance_id: 'stimulus-instance-1',
        }),
      })
    )
    expect(result).toEqual(
      expect.objectContaining({
        source_kind: 'thought_core_motion_stimulus_v0',
        debug_playback: false,
        accepted: true,
        status: 'started',
        reason_code: 'motion_runtime_vrma_started',
        safe_visible_state: 'motion_started',
        motion_event_id: 'motion-event-1',
        stimulus_id: 'dance.sequence',
        stimulus_instance_id: 'stimulus-instance-1',
        event_id: 'thought-event-1',
        turn_id: 'turn-1',
        session_id: 'session-1',
        request_id: 'motion-request-1',
        attempt_id: '1',
        multi_stimulus_group_id: 'multi-stimulus-turn-1',
        runtime_result_id: 'runtime-result-1',
      })
    )
    expect(result.lifecycle_trace.map((entry) => entry.state)).toEqual([
      'request_issued',
      'runtime_accepted',
      'runtime_started',
      'result',
    ])
  })

  it('starts dance for a contract-shaped Thought Core dance_sequence play request', async () => {
    const startDance = jest.fn().mockResolvedValue({
      status: 'started',
      reason_code: 'motion_runtime_vrma_started',
      runtime_result_id: 'runtime-result-dance-sequence-1',
      safe_visible_state: 'motion_started',
    })

    const result = await receiveMotionStimulusV0(
      createThoughtCoreDanceSequenceStimulus(),
      { startDance },
      { nowMs: () => 1_720_000_002_000 }
    )

    expect(startDance).toHaveBeenCalledWith(
      expect.objectContaining({
        assetPath: DEFAULT_DANCE_MOTION_ASSET_PATH,
        stimulusId: 'mot_stim_turn_123_dance_sequence',
        stimulusInstanceId: 'mot_inst_turn_123_1',
        groupKey: 'dance.sequence',
        requestedAtMs: Date.parse('2026-06-10T08:00:00.000Z'),
        loop: true,
        trace: expect.objectContaining({
          event_id: 'thought-event-dance-sequence-1',
          request_id: 'motion-request-dance-sequence-1',
          multi_stimulus_group_id: 'multi-stimulus-turn-dance-sequence-1',
          motion_event_id: 'motion-event-dance-sequence-1',
          stimulus_id: 'mot_stim_turn_123_dance_sequence',
          stimulus_instance_id: 'mot_inst_turn_123_1',
        }),
      })
    )
    expect(result).toEqual(
      expect.objectContaining({
        source_kind: 'thought_core_motion_stimulus_v0',
        accepted: true,
        status: 'started',
        reason_code: 'motion_runtime_vrma_started',
        safe_visible_state: 'motion_started',
        motion_event_id: 'motion-event-dance-sequence-1',
        stimulus_id: 'mot_stim_turn_123_dance_sequence',
        stimulus_instance_id: 'mot_inst_turn_123_1',
        multi_stimulus_group_id: 'multi-stimulus-turn-dance-sequence-1',
        runtime_result_id: 'runtime-result-dance-sequence-1',
      })
    )
    expect(result.lifecycle_trace.map((entry) => entry.state)).toEqual([
      'request_issued',
      'runtime_accepted',
      'runtime_started',
      'result',
    ])
  })

  it('does not start dance_sequence play requests without the safe dance payload ref', async () => {
    const startDance = jest.fn()
    const stimulus = createThoughtCoreDanceSequenceStimulus()
    stimulus.payload_ref = 'motion.thought_core.unknown_dance_payload.v0'

    const result = await receiveMotionStimulusV0(
      stimulus,
      { startDance },
      { nowMs: () => 1_720_000_002_000 }
    )

    expect(startDance).not.toHaveBeenCalled()
    expect(result).toEqual(
      expect.objectContaining({
        accepted: false,
        status: 'unavailable',
        reason_code: 'stimulus_not_supported_by_receiver_v0',
        stimulus_id: 'mot_stim_turn_123_dance_sequence',
      })
    )
  })

  it('routes safe Thought Core stop requests to the dance stop adapter without starting dance', async () => {
    const startDance = jest.fn()
    const stopDance = jest.fn().mockResolvedValue({
      status: 'completed',
      reason_code: 'motion_stopped',
      runtime_result_id: 'runtime-result-stop-1',
      safe_visible_state: 'neutral_idle_requested',
    })

    const result = await receiveMotionStimulusV0(
      createStopStimulus(),
      { startDance, stopDance },
      { nowMs: () => 1_720_000_004_000 }
    )

    expect(startDance).not.toHaveBeenCalled()
    expect(stopDance).toHaveBeenCalledWith(
      expect.objectContaining({
        stimulusId: 'motion.stop.dance',
        stimulusInstanceId: 'stimulus-instance-stop-1',
        groupKey: DANCE_SEQUENCE_GROUP_KEY,
        requestedAtMs: Date.parse('2026-06-15T02:15:00.000Z'),
        trace: expect.objectContaining({
          motion_event_id: 'motion-event-stop-1',
          stimulus_id: 'motion.stop.dance',
          stimulus_instance_id: 'stimulus-instance-stop-1',
          runtime_result_id: 'runtime-result-stop-planned-1',
        }),
      })
    )
    expect(result).toEqual(
      expect.objectContaining({
        accepted: true,
        status: 'completed',
        reason_code: 'motion_stopped',
        safe_visible_state: 'neutral_idle_requested',
        motion_event_id: 'motion-event-stop-1',
        stimulus_id: 'motion.stop.dance',
        stimulus_instance_id: 'stimulus-instance-stop-1',
        runtime_result_id: 'runtime-result-stop-1',
      })
    )
    expect(
      result.lifecycle_trace.find((entry) => entry.state === 'runtime_accepted')
        ?.reason_code
    ).toBe('motion_runtime_stop_adapter_accepted')
  })

  it('keeps stop requests idempotent when no dance group is active', async () => {
    const stopDance = jest.fn().mockResolvedValue({
      status: 'completed',
      reason_code: 'motion_runtime_stop_requested',
      runtime_result_id: 'runtime-result-stop-idle-1',
      safe_visible_state: 'neutral_idle_requested',
    })

    const result = await receiveMotionStimulusV0(
      createStopStimulus(),
      { startDance: jest.fn(), stopDance },
      { nowMs: () => 1_720_000_004_000 }
    )

    expect(stopDance).toHaveBeenCalledTimes(1)
    expect(result).toEqual(
      expect.objectContaining({
        accepted: true,
        status: 'completed',
        reason_code: 'motion_runtime_stop_requested',
        safe_visible_state: 'neutral_idle_requested',
      })
    )
  })

  it('does not stop dance for unsafe or incomplete stop payload markers', async () => {
    const startDance = jest.fn()
    const stopDance = jest.fn()
    const stimulus = createStopStimulus()
    stimulus.payload_ref = 'motion.thought_core.stop.private.v0'

    const result = await receiveMotionStimulusV0(
      stimulus,
      { startDance, stopDance },
      { nowMs: () => 1_720_000_004_000 }
    )

    expect(startDance).not.toHaveBeenCalled()
    expect(stopDance).not.toHaveBeenCalled()
    expect(result).toEqual(
      expect.objectContaining({
        accepted: false,
        status: 'unavailable',
        reason_code: 'stimulus_not_supported_by_receiver_v0',
        safe_visible_state: 'no_visible_change',
      })
    )
  })

  it('does not dispatch explicit stop contracts when stop metadata conflicts', async () => {
    const startDance = jest.fn()
    const stopDance = jest.fn()
    const stimulus = createStopStimulus()
    stimulus.loop = true

    const result = await receiveMotionStimulusV0(
      stimulus,
      { startDance, stopDance },
      { nowMs: () => 1_720_000_004_000 }
    )

    expect(startDance).not.toHaveBeenCalled()
    expect(stopDance).not.toHaveBeenCalled()
    expect(result).toEqual(
      expect.objectContaining({
        accepted: false,
        status: 'unavailable',
        reason_code: 'stimulus_not_supported_by_receiver_v0',
        safe_visible_state: 'no_visible_change',
      })
    )
  })

  const malformedEnvelopeCases: Array<
    [string, () => Record<string, unknown>, string]
  > = [
    [
      'missing stimulus_id',
      () => {
        const stimulus = createThoughtCoreDanceSequenceStimulus()
        delete (stimulus as Record<string, unknown>).stimulus_id
        return stimulus
      },
      'motion_stimulus_missing_required_fields',
    ],
    [
      'blank motion_event_id',
      () => ({
        ...createThoughtCoreDanceSequenceStimulus(),
        motion_event_id: '   ',
      }),
      'motion_stimulus_required_field_empty',
    ],
    [
      'unsafe-length stimulus_id boundary',
      () => ({
        ...createThoughtCoreDanceSequenceStimulus(),
        stimulus_id: 'x'.repeat(129),
      }),
      'motion_stimulus_id_not_safe',
    ],
    [
      'invalid requested_at',
      () => ({
        ...createThoughtCoreDanceSequenceStimulus(),
        requested_at: 'not-a-date',
      }),
      'motion_stimulus_requested_at_invalid',
    ],
    [
      'unsupported target_model_type',
      () => ({
        ...createThoughtCoreDanceSequenceStimulus(),
        target_model_type: 'live2d',
      }),
      'target_model_type_unavailable',
    ],
  ]

  it.each(malformedEnvelopeCases)(
    'rejects malformed stimulus envelope without dispatch: %s',
    async (_label, createStimulus, reasonCode) => {
      const startDance = jest.fn()
      const startContextNod = jest.fn()
      const startExpressionVisible = jest.fn()

      const result = await receiveMotionStimulusV0(
        createStimulus(),
        { startDance, startContextNod, startExpressionVisible },
        { nowMs: () => 1_720_000_002_500 }
      )

      expect(startDance).not.toHaveBeenCalled()
      expect(startContextNod).not.toHaveBeenCalled()
      expect(startExpressionVisible).not.toHaveBeenCalled()
      expect(result).toEqual(
        expect.objectContaining({
          accepted: false,
          status: 'unavailable',
          reason_code: reasonCode,
          safe_visible_state: 'no_visible_change',
        })
      )
    }
  )

  const malformedContractCases: Array<
    [string, () => Record<string, unknown>, string]
  > = [
    [
      'dance_sequence play with unknown payload_ref',
      () => ({
        ...createThoughtCoreDanceSequenceStimulus(),
        payload_ref: 'motion.thought_core.dance_sequence.experimental.v0',
      }),
      'stimulus_not_supported_by_receiver_v0',
    ],
    [
      'dance_sequence apply request_mode',
      () => ({
        ...createThoughtCoreDanceSequenceStimulus(),
        request_mode: 'apply',
      }),
      'request_mode_not_supported_by_receiver_v0',
    ],
    [
      'expression_visible with play request_mode',
      () => ({
        ...createExpressionVisibleStimulus(),
        request_mode: 'play',
      }),
      'stimulus_not_supported_by_receiver_v0',
    ],
    [
      'expression_visible with context payload_ref',
      () => ({
        ...createExpressionVisibleStimulus(),
        payload_ref: 'motion.thought_core.expression.v0',
      }),
      'stimulus_not_supported_by_receiver_v0',
    ],
    [
      'expression_visible with wrong track scope',
      () => ({
        ...createExpressionVisibleStimulus(),
        track_mask: { scope: 'full_body', channels: ['expression_weight'] },
      }),
      'stimulus_not_supported_by_receiver_v0',
    ],
    [
      'expression_visible with array track mask',
      () => ({
        ...createExpressionVisibleStimulus(),
        track_mask: ['face_head', 'expression_weight'],
      }),
      'stimulus_not_supported_by_receiver_v0',
    ],
    [
      'expression_visible missing expected_roi requirement',
      () => {
        const stimulus = createExpressionVisibleStimulus()
        delete (stimulus.requirements as Record<string, unknown>).expected_roi
        return stimulus
      },
      'stimulus_not_supported_by_receiver_v0',
    ],
  ]

  it.each(malformedContractCases)(
    'does not dispatch malformed contract markers: %s',
    async (_label, createStimulus, reasonCode) => {
      const startDance = jest.fn()
      const startContextNod = jest.fn()
      const startExpressionVisible = jest.fn()

      const result = await receiveMotionStimulusV0(
        createStimulus(),
        { startDance, startContextNod, startExpressionVisible },
        { nowMs: () => 1_720_000_003_500 }
      )

      expect(startDance).not.toHaveBeenCalled()
      expect(startContextNod).not.toHaveBeenCalled()
      expect(startExpressionVisible).not.toHaveBeenCalled()
      expect(result).toEqual(
        expect.objectContaining({
          accepted: false,
          status: 'unavailable',
          reason_code: reasonCode,
          safe_visible_state: 'no_visible_change',
        })
      )
    }
  )

  it.each([
    'provider-openai-session',
    'device-camera-route',
    'entity.light_living_room',
    'raw-transcript-turn',
    'private-path-turn',
  ])(
    'omits unsafe multi-stimulus correlation ref from receiver trace/result: %s',
    async (unsafeGroupId) => {
      const startDance = jest.fn().mockResolvedValue({
        status: 'started',
        reason_code: 'motion_runtime_vrma_started',
        runtime_result_id: 'runtime-result-dance-sequence-1',
        safe_visible_state: 'motion_started',
      })
      const stimulus = createThoughtCoreDanceSequenceStimulus()
      stimulus.trace.multi_stimulus_group_id = unsafeGroupId

      const result = await receiveMotionStimulusV0(
        stimulus,
        { startDance },
        { nowMs: () => 1_720_000_002_000 }
      )

      expect(startDance).toHaveBeenCalledTimes(1)
      expect(startDance.mock.calls[0][0].trace.multi_stimulus_group_id).toBe(
        undefined
      )
      expect(result.multi_stimulus_group_id).toBeUndefined()
    }
  )

  it('returns unavailable and does not start for unsafe payload fields', async () => {
    const startDance = jest.fn()
    const result = await receiveMotionStimulusV0(
      {
        ...createDanceStimulus(),
        raw_prompt: 'dance with full private prompt',
      },
      { startDance },
      { nowMs: () => 1_720_000_000_500 }
    )

    expect(startDance).not.toHaveBeenCalled()
    expect(result).toEqual(
      expect.objectContaining({
        accepted: false,
        status: 'unavailable',
        reason_code: 'motion_stimulus_contains_unsafe_field',
        safe_visible_state: 'no_visible_change',
      })
    )
  })

  it('does not execute unsupported stimulus ids through the dance entrypoint', async () => {
    const startDance = jest.fn()
    const result = await receiveMotionStimulusV0(
      {
        ...createDanceStimulus(),
        stimulus_id: 'victory.pose',
        kind: 'gesture',
      },
      { startDance },
      { nowMs: () => 1_720_000_000_500 }
    )

    expect(startDance).not.toHaveBeenCalled()
    expect(result).toEqual(
      expect.objectContaining({
        accepted: false,
        status: 'unavailable',
        reason_code: 'stimulus_not_supported_by_receiver_v0',
        stimulus_id: 'victory.pose',
        event_id: 'thought-event-1',
        turn_id: 'turn-1',
        session_id: 'session-1',
      })
    )
    expect(result.lifecycle_trace.map((entry) => entry.state)).toEqual([
      'request_issued',
      'result',
    ])
  })

  it('preserves safe ids when the runtime adapter can only accept the request', async () => {
    const adapter: MotionStimulusReceiverAdapter = {
      startDance: jest.fn().mockReturnValue({
        status: 'accepted',
        reason_code: 'motion_asset_load_requested',
        safe_visible_state: 'unknown',
      }),
    }
    const result = await receiveMotionStimulusV0(createDanceStimulus(), adapter)

    expect(result).toEqual(
      expect.objectContaining({
        accepted: true,
        status: 'accepted',
        request_id: 'motion-request-1',
        attempt_id: '1',
        runtime_result_id: 'runtime-result-planned-1',
      })
    )
    expect(result.lifecycle_trace.map((entry) => entry.state)).toEqual([
      'request_issued',
      'runtime_accepted',
      'result',
    ])
  })

  it('does not promote a caller-supplied driver_result_id to runtime_result_id', async () => {
    const adapter: MotionStimulusReceiverAdapter = {
      startDance: jest.fn().mockReturnValue({
        status: 'accepted',
        reason_code: 'motion_asset_load_requested',
        safe_visible_state: 'unknown',
      }),
    }
    const stimulus = createDanceStimulus()
    const trace = stimulus.trace as Record<string, unknown>
    trace.runtime_result_id = undefined
    trace.driver_result_id = 'driver-result-from-trace'

    const result = await receiveMotionStimulusV0(stimulus, adapter)

    expect(adapter.startDance).toHaveBeenCalledWith(
      expect.objectContaining({
        trace: expect.objectContaining({
          runtime_result_id: undefined,
          driver_result_id: 'driver-result-from-trace',
        }),
      })
    )
    expect(result).toEqual(
      expect.objectContaining({
        accepted: true,
        status: 'accepted',
        runtime_result_id: undefined,
      })
    )
  })

  it('maps the current Thought Core expression route to a bounded context nod', async () => {
    const startContextNod = jest.fn().mockReturnValue({
      status: 'completed',
      reason_code: 'motion_runtime_context_nod_completed',
      runtime_result_id: 'runtime-result-planned-2',
      safe_visible_state: 'context_nod_completed',
    })
    const startDance = jest.fn()
    const result = await receiveMotionStimulusV0(
      createContextNodStimulus(),
      { startDance, startContextNod },
      { nowMs: () => 1_720_000_001_000 }
    )

    expect(startDance).not.toHaveBeenCalled()
    expect(startContextNod).toHaveBeenCalledWith(
      expect.objectContaining({
        stimulusId: 'context.expression',
        stimulusInstanceId: 'stimulus-instance-2',
        groupKey: CONTEXT_NOD_GROUP_KEY,
        requestedAtMs: Date.parse('2026-06-06T03:00:00.000Z'),
        durationMs: CONTEXT_NOD_DURATION_MS,
        trace: expect.objectContaining({
          motion_event_id: 'motion-event-2',
          stimulus_id: 'context.expression',
          stimulus_instance_id: 'stimulus-instance-2',
          runtime_result_id: 'runtime-result-planned-2',
        }),
      })
    )
    expect(result).toEqual(
      expect.objectContaining({
        accepted: true,
        status: 'completed',
        reason_code: 'motion_runtime_context_nod_completed',
        safe_visible_state: 'context_nod_completed',
        motion_event_id: 'motion-event-2',
        stimulus_id: 'context.expression',
        stimulus_instance_id: 'stimulus-instance-2',
        runtime_result_id: 'runtime-result-planned-2',
      })
    )
    expect(result.lifecycle_trace.map((entry) => entry.state)).toEqual([
      'request_issued',
      'runtime_accepted',
      'runtime_started',
      'result',
    ])
  })

  it('routes expression-visible requests to a distinct expression adapter without context nod', async () => {
    const startDance = jest.fn()
    const startContextNod = jest.fn()
    const startExpressionVisible = jest.fn().mockReturnValue({
      status: 'started',
      reason_code: 'motion_runtime_expression_frame_queued',
      runtime_result_id: 'expression-runtime-result-1',
      safe_visible_state: 'expression_change_requested',
    })

    const result = await receiveMotionStimulusV0(
      createExpressionVisibleStimulus(),
      { startDance, startContextNod, startExpressionVisible },
      { nowMs: () => 1_720_000_003_000 }
    )

    expect(startDance).not.toHaveBeenCalled()
    expect(startContextNod).not.toHaveBeenCalled()
    expect(startExpressionVisible).toHaveBeenCalledWith(
      expect.objectContaining({
        stimulusId: 'expression.visible.face',
        stimulusInstanceId: 'stimulus-instance-expression-visible',
        requestedAtMs: Date.parse('2026-06-12T07:10:00.000Z'),
        frameCount: 30,
        expressionWeights: {
          happy: 1,
          relaxed: 0.75,
          joy: 1,
          Joy: 1,
          fun: 0.75,
          Fun: 0.75,
        },
        trace: expect.objectContaining({
          event_id: 'thought-event-expression-visible',
          request_id: 'expression-request-1',
          runtime_result_id: 'expression-runtime-result-planned-1',
          driver_result_id: 'driver-result-expression-planned-1',
          multi_stimulus_group_id: 'multi-stimulus-expression-turn-1',
          motion_event_id: 'motion-event-expression-visible',
          stimulus_id: 'expression.visible.face',
          stimulus_instance_id: 'stimulus-instance-expression-visible',
        }),
      })
    )
    expect(result).toEqual(
      expect.objectContaining({
        accepted: true,
        status: 'started',
        reason_code: 'motion_runtime_expression_frame_queued',
        safe_visible_state: 'expression_change_requested',
        motion_event_id: 'motion-event-expression-visible',
        stimulus_id: 'expression.visible.face',
        stimulus_instance_id: 'stimulus-instance-expression-visible',
        runtime_result_id: 'expression-runtime-result-1',
        driver_result_id: 'driver-result-expression-planned-1',
        multi_stimulus_group_id: 'multi-stimulus-expression-turn-1',
      })
    )
    expect(result.lifecycle_trace.map((entry) => entry.state)).toEqual([
      'request_issued',
      'runtime_accepted',
      'runtime_started',
      'result',
    ])
  })

  it('does not route expression-visible requests through context nod when markers are incomplete', async () => {
    const startContextNod = jest.fn()
    const startExpressionVisible = jest.fn()
    const stimulus = createExpressionVisibleStimulus()
    stimulus.track_mask = {
      scope: 'head_neck',
      channels: ['expression_weight'],
    }

    const result = await receiveMotionStimulusV0(
      stimulus,
      { startDance: jest.fn(), startContextNod, startExpressionVisible },
      { nowMs: () => 1_720_000_003_000 }
    )

    expect(startContextNod).not.toHaveBeenCalled()
    expect(startExpressionVisible).not.toHaveBeenCalled()
    expect(result).toEqual(
      expect.objectContaining({
        accepted: false,
        status: 'unavailable',
        reason_code: 'stimulus_not_supported_by_receiver_v0',
        safe_visible_state: 'no_visible_change',
        stimulus_id: 'expression.visible.face',
      })
    )
  })

  it('rejects expression-visible requests that carry Home Control markers', async () => {
    const startExpressionVisible = jest.fn()
    const result = await receiveMotionStimulusV0(
      {
        ...createExpressionVisibleStimulus(),
        entity_id: 'light_living_room',
      },
      { startDance: jest.fn(), startExpressionVisible },
      { nowMs: () => 1_720_000_003_000 }
    )

    expect(startExpressionVisible).not.toHaveBeenCalled()
    expect(result).toEqual(
      expect.objectContaining({
        accepted: false,
        status: 'unavailable',
        reason_code: 'motion_stimulus_contains_unsafe_field',
        safe_visible_state: 'no_visible_change',
      })
    )
  })

  it('also accepts the literal posture fixture route for context nod', async () => {
    const startContextNod = jest.fn().mockReturnValue({
      status: 'completed',
      reason_code: 'motion_runtime_context_nod_completed',
      runtime_result_id: 'runtime-result-planned-3',
      safe_visible_state: 'context_nod_completed',
    })
    const stimulus = createContextNodStimulus()
    stimulus.kind = 'posture'
    stimulus.payload_ref = 'motion.fixture.context_nod.v0'
    stimulus.trace.runtime_result_id = 'runtime-result-planned-3'

    const result = await receiveMotionStimulusV0(stimulus, {
      startDance: jest.fn(),
      startContextNod,
    })

    expect(startContextNod).toHaveBeenCalledTimes(1)
    expect(result).toEqual(
      expect.objectContaining({
        accepted: true,
        status: 'completed',
        runtime_result_id: 'runtime-result-planned-3',
      })
    )
  })
})

function createDanceStimulus() {
  return {
    schema_version: 'motion_stimulus.v0',
    motion_event_id: 'motion-event-1',
    stimulus_id: 'dance.sequence',
    stimulus_instance_id: 'stimulus-instance-1',
    source_class: 'thought_core',
    source_origin: 'motion.requested',
    requested_at: '2026-06-05T08:55:00.000Z',
    kind: 'dance',
    request_mode: 'start',
    phase: 'requested',
    lifecycle_state: 'request_issued',
    safe_visible_state: 'motion_requested',
    target_model_type: 'vrm',
    track_mask: { scope: 'full_body' },
    requirements: { visible_motion: true },
    trace: {
      event_id: 'thought-event-1',
      turn_id: 'turn-1',
      session_id: 'session-1',
      request_id: 'motion-request-1',
      runtime_result_id: 'runtime-result-planned-1',
      multi_stimulus_group_id: 'multi-stimulus-turn-1',
      attempt: 1,
    },
    redaction: {
      shared_summary_only: true,
    },
  }
}

function createThoughtCoreDanceSequenceStimulus() {
  return {
    schema_version: 'motion_stimulus.v0',
    motion_event_id: 'motion-event-dance-sequence-1',
    stimulus_id: 'mot_stim_turn_123_dance_sequence',
    stimulus_instance_id: 'mot_inst_turn_123_1',
    source_class: 'thought_core',
    source_origin: 'motion.requested',
    requested_at: '2026-06-10T08:00:00.000Z',
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
      event_id: 'thought-event-dance-sequence-1',
      turn_id: 'turn-dance-sequence-1',
      session_id: 'session-dance-sequence-1',
      request_id: 'motion-request-dance-sequence-1',
      runtime_result_id: 'runtime-result-planned-dance-sequence-1',
      multi_stimulus_group_id: 'multi-stimulus-turn-dance-sequence-1',
      attempt: 1,
    },
    redaction: {
      shared_summary_only: true,
    },
  }
}

function createStopStimulus() {
  return {
    schema_version: 'motion_stimulus.v0',
    motion_event_id: 'motion-event-stop-1',
    stimulus_id: 'motion.stop.dance',
    stimulus_instance_id: 'stimulus-instance-stop-1',
    source_class: 'thought_core',
    source_origin: 'motion.requested',
    requested_at: '2026-06-15T02:15:00.000Z',
    kind: 'stop',
    payload_ref: 'motion.thought_core.stop.v0',
    request_mode: 'stop',
    duration_ms: 0,
    loop: false,
    interrupt_policy: 'stop',
    fallback_state: 'stop_to_idle',
    stop_reason: 'user_requested',
    phase: 'requested',
    lifecycle_state: 'request_issued',
    safe_visible_state: 'neutral_idle_requested',
    target_model_type: 'vrm',
    track_mask: { scope: 'full_body' },
    requirements: { stop_target: 'dance.sequence' },
    trace: {
      event_id: 'thought-event-stop-1',
      turn_id: 'turn-stop-1',
      session_id: 'session-stop-1',
      request_id: 'motion-request-stop-1',
      runtime_result_id: 'runtime-result-stop-planned-1',
      attempt: 1,
    },
    redaction: {
      shared_summary_only: true,
    },
  }
}

function createContextNodStimulus() {
  return {
    schema_version: 'motion_stimulus.v0',
    motion_event_id: 'motion-event-2',
    stimulus_id: 'context.expression',
    stimulus_instance_id: 'stimulus-instance-2',
    source_class: 'thought_core',
    source_origin: 'motion.requested',
    requested_at: '2026-06-06T03:00:00.000Z',
    kind: 'expression',
    payload_ref: 'motion.thought_core.expression.v0',
    request_mode: 'play',
    phase: 'requested',
    lifecycle_state: 'request_issued',
    safe_visible_state: 'motion_requested',
    target_model_type: 'vrm',
    track_mask: { scope: 'head_neck' },
    requirements: { visible_motion: true },
    trace: {
      event_id: 'thought-event-2',
      turn_id: 'turn-2',
      session_id: 'session-2',
      request_id: 'motion-request-2',
      runtime_result_id: 'runtime-result-planned-2',
      attempt: 1,
    },
    redaction: {
      shared_summary_only: true,
    },
  }
}

function createExpressionVisibleStimulus() {
  return {
    schema_version: 'motion_stimulus.v0',
    motion_event_id: 'motion-event-expression-visible',
    stimulus_id: 'expression.visible.face',
    stimulus_instance_id: 'stimulus-instance-expression-visible',
    source_class: 'thought_core',
    source_origin: 'motion.requested',
    requested_at: '2026-06-12T07:10:00.000Z',
    kind: 'expression',
    payload_ref: 'motion.thought_core.expression_visible.v0',
    request_mode: 'apply',
    phase: 'requested',
    lifecycle_state: 'request_issued',
    safe_visible_state: 'expression_change_requested',
    target_model_type: 'vrm',
    track_mask: { scope: 'face_head', channels: ['expression_weight'] },
    requirements: {
      visible_motion: true,
      expression_profile_ref: 'motion.runtime.vrm_expression_weights.v0',
      expected_visible_change: 'face_expression',
      expected_roi: 'avatar_face_head',
    },
    trace: {
      event_id: 'thought-event-expression-visible',
      turn_id: 'turn-expression-visible',
      session_id: 'session-expression-visible',
      request_id: 'expression-request-1',
      runtime_result_id: 'expression-runtime-result-planned-1',
      driver_result_id: 'driver-result-expression-planned-1',
      multi_stimulus_group_id: 'multi-stimulus-expression-turn-1',
      attempt: 1,
    },
    redaction: {
      shared_summary_only: true,
    },
  }
}
