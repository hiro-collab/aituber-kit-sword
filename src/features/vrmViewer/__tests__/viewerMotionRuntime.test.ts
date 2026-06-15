/**
 * @jest-environment node
 */

import * as THREE from 'three'
import { createProjectionVisualInPageDiagnostics, Viewer } from '../viewer'
import { loadVRMAnimation } from '@/lib/VRMAnimation/loadVRMAnimation'
import {
  CONTEXT_NOD_DURATION_MS,
  CONTEXT_NOD_GROUP_KEY,
  DANCE_SEQUENCE_GROUP_KEY,
} from '@/features/motionRuntime/motionStimulusReceiver'

jest.mock('@/lib/VRMAnimation/loadVRMAnimation', () => ({
  loadVRMAnimation: jest.fn(),
}))

const mockedLoadVRMAnimation = loadVRMAnimation as jest.MockedFunction<
  typeof loadVRMAnimation
>

describe('Viewer Motion Runtime asset lifecycle', () => {
  beforeEach(() => {
    mockedLoadVRMAnimation.mockReset()
    jest.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('clearing motionAsset stops the current dance sequence and ignores stale load completion', async () => {
    const viewer = new Viewer()
    const model = createReadyModel()
    viewer.model = model
    const pending = createDeferred()
    mockedLoadVRMAnimation.mockReturnValueOnce(pending.promise)

    viewer.setMotionRuntimeAssetPath('/local-vrma/dance-a.vrma')
    viewer.setMotionRuntimeAssetPath(undefined)
    pending.resolve(createVRMAnimation())
    await flushPromises()

    expect(model.stopMotionRuntimeGroup).toHaveBeenCalledWith('dance.sequence')
    expect(model.playMotionRuntimeVRMA).not.toHaveBeenCalled()
  })

  it('ignores stale async asset A when query changes to asset B before A resolves', async () => {
    const viewer = new Viewer()
    const model = createReadyModel()
    viewer.model = model
    const assetA = createDeferred()
    const assetB = createDeferred()
    mockedLoadVRMAnimation
      .mockReturnValueOnce(assetA.promise)
      .mockReturnValueOnce(assetB.promise)

    viewer.setMotionRuntimeAssetPath('/local-vrma/dance-a.vrma')
    viewer.setMotionRuntimeAssetPath('/local-vrma/dance-b.vrma')
    assetA.resolve(createVRMAnimation())
    await flushPromises()

    expect(model.playMotionRuntimeVRMA).not.toHaveBeenCalled()

    assetB.resolve(createVRMAnimation())
    await flushPromises()

    expect(model.playMotionRuntimeVRMA).toHaveBeenCalledTimes(1)
    expect(model.playMotionRuntimeVRMA).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        stimulusId: 'dance_sequence.query_vrma',
        groupKey: 'dance.sequence',
        loop: true,
      })
    )
  })

  it('replays the same selected motionAsset after the VRM model changes', async () => {
    const viewer = new Viewer()
    const modelA = createReadyModel()
    const modelB = createReadyModel()
    mockedLoadVRMAnimation.mockResolvedValue(createVRMAnimation())

    viewer.model = modelA
    viewer.setMotionRuntimeAssetPath('/local-vrma/dance-a.vrma')
    await flushPromises()

    viewer.model = modelB
    viewer.setMotionRuntimeAssetPath('/local-vrma/dance-a.vrma')
    await flushPromises()

    expect(mockedLoadVRMAnimation).toHaveBeenCalledTimes(2)
    expect(modelA.playMotionRuntimeVRMA).toHaveBeenCalledTimes(1)
    expect(modelB.playMotionRuntimeVRMA).toHaveBeenCalledTimes(1)
  })

  it('clears loaded guards after load failure so the same asset can retry', async () => {
    const viewer = new Viewer()
    const model = createReadyModel()
    viewer.model = model
    mockedLoadVRMAnimation
      .mockRejectedValueOnce(new Error('load failed'))
      .mockResolvedValueOnce(createVRMAnimation())

    viewer.setMotionRuntimeAssetPath('/local-vrma/retry.vrma')
    await flushPromises()
    viewer.setMotionRuntimeAssetPath('/local-vrma/retry.vrma')
    await flushPromises()

    expect(mockedLoadVRMAnimation).toHaveBeenCalledTimes(2)
    expect(model.playMotionRuntimeVRMA).toHaveBeenCalledTimes(1)
  })

  it('unloadVRM stops the Motion Runtime dance sequence before disposing the model', () => {
    const viewer = new Viewer()
    const model = createReadyModel()
    viewer.model = model

    viewer.unloadVRM()

    expect(model.stopMotionRuntimeGroup).toHaveBeenCalledWith('dance.sequence')
    expect(model.unLoadVrm).toHaveBeenCalledTimes(1)
  })

  it('receives Thought Core motion stimulus and starts the Motion Runtime dance path', async () => {
    const viewer = new Viewer()
    const model = createReadyModel()
    viewer.model = model
    mockedLoadVRMAnimation.mockResolvedValue(createVRMAnimation())

    const result = await viewer.receiveMotionStimulus(createDanceStimulus())

    expect(result).toEqual(
      expect.objectContaining({
        source_kind: 'thought_core_motion_stimulus_v0',
        debug_playback: false,
        accepted: true,
        status: 'started',
        reason_code: 'motion_runtime_vrma_started',
        stimulus_id: 'dance.sequence',
        runtime_result_id: 'runtime-result-planned-1',
      })
    )
    expect(model.playMotionRuntimeVRMA).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        stimulusId: 'dance.sequence',
        groupKey: 'dance.sequence',
        requestedAtMs: Date.parse('2026-06-05T08:55:00.000Z'),
        loop: true,
      })
    )
  })

  it('receives Thought Core stop stimulus and releases dance sequence to idle', async () => {
    const viewer = new Viewer()
    const model = createReadyModel()
    ;(model.stopMotionRuntimeGroup as jest.Mock).mockReturnValue([
      'motion-runtime-instance-1',
    ])
    viewer.model = model

    const result = await viewer.receiveMotionStimulus(createStopStimulus())

    expect(result).toEqual(
      expect.objectContaining({
        source_kind: 'thought_core_motion_stimulus_v0',
        debug_playback: false,
        accepted: true,
        status: 'completed',
        reason_code: 'motion_stopped',
        safe_visible_state: 'neutral_idle_requested',
        stimulus_id: 'motion.stop.dance',
        runtime_result_id: 'runtime-result-stop-planned-1',
      })
    )
    expect(model.playMotionRuntimeVRMA).not.toHaveBeenCalled()
    expect(model.stopMotionRuntimeGroup).toHaveBeenCalledWith(
      DANCE_SEQUENCE_GROUP_KEY,
      Date.parse('2026-06-15T02:15:00.000Z'),
      'motion_runtime_stop_requested'
    )
    expect(model.queueMotionRuntimeFrame).toHaveBeenCalledWith({
      stimulusInstanceId: 'stimulus-instance-stop-1',
      frameCount: 1,
      resetToIdle: true,
    })
  })

  it('accepts stop stimulus idempotently when no dance sequence is active', async () => {
    const viewer = new Viewer()
    const model = createReadyModel()
    viewer.model = model

    const result = await viewer.receiveMotionStimulus(createStopStimulus())

    expect(result).toEqual(
      expect.objectContaining({
        accepted: true,
        status: 'completed',
        reason_code: 'motion_runtime_stop_requested',
        safe_visible_state: 'neutral_idle_requested',
      })
    )
    expect(model.stopMotionRuntimeGroup).toHaveBeenCalledTimes(1)
    expect(model.queueMotionRuntimeFrame).toHaveBeenCalledWith(
      expect.objectContaining({
        resetToIdle: true,
      })
    )
  })

  it('receives Thought Core expression stimulus and starts the context nod path', async () => {
    const viewer = new Viewer()
    const model = createReadyModel()
    viewer.model = model
    const stimulus = createContextNodStimulus()

    const result = await viewer.receiveMotionStimulus(stimulus)

    expect(result).toEqual(
      expect.objectContaining({
        source_kind: 'thought_core_motion_stimulus_v0',
        debug_playback: false,
        accepted: true,
        status: 'completed',
        reason_code: 'motion_runtime_context_nod_completed',
        safe_visible_state: 'context_nod_completed',
        stimulus_id: 'context.expression',
        runtime_result_id: 'runtime-result-planned-2',
      })
    )
    expect(model.playMotionRuntimeVRMA).not.toHaveBeenCalled()
    expect(model.playMotionRuntimeContextNod).toHaveBeenCalledWith(
      expect.objectContaining({
        stimulusId: 'context.expression',
        groupKey: CONTEXT_NOD_GROUP_KEY,
        requestedAtMs: Date.parse(stimulus.requested_at),
        durationMs: CONTEXT_NOD_DURATION_MS,
      })
    )
  })

  it('receives expression-visible stimulus and queues an expression frame without context nod', async () => {
    const viewer = new Viewer()
    const model = createReadyModel()
    viewer.model = model
    const stimulus = createExpressionVisibleStimulus()

    const result = await viewer.receiveMotionStimulus(stimulus)

    expect(result).toEqual(
      expect.objectContaining({
        source_kind: 'thought_core_motion_stimulus_v0',
        debug_playback: false,
        accepted: true,
        status: 'started',
        reason_code: 'motion_runtime_expression_frame_queued',
        safe_visible_state: 'expression_change_requested',
        stimulus_id: 'expression.visible.face',
        runtime_result_id: 'expression-runtime-result-planned-1',
        driver_result_id: 'driver-result-expression-planned-1',
      })
    )
    expect(model.playMotionRuntimeVRMA).not.toHaveBeenCalled()
    expect(model.playMotionRuntimeContextNod).not.toHaveBeenCalled()
    expect(model.queueMotionRuntimeFrame).toHaveBeenCalledWith({
      stimulusInstanceId: 'stimulus-instance-expression-visible',
      frameCount: 30,
      expressionWeights: { happy: 1 },
    })
  })

  it('creates reader-safe Projection Visual in-page diagnostics with separated canvas and DOM surfaces', () => {
    const diagnostics = createProjectionVisualInPageDiagnostics({
      visualSessionId: 'visual-session-test',
      projectionVisualInstanceId: 'projection-visual-instance-test',
      surfaceInstanceId: 'avatar-webgl-canvas-test',
      frameTimestampMonoMs: 1234.5,
      motionRuntimeDebugSnapshot: createMotionRuntimeDebugSnapshot(),
      motionStimulusResult: {
        source_kind: 'thought_core_motion_stimulus_v0',
        debug_playback: false,
        accepted: true,
        status: 'started',
        reason_code: 'motion_runtime_expression_frame_queued',
        safe_visible_state: 'expression_change_requested',
        motion_event_id: 'motion-event-expression-visible',
        stimulus_id: 'expression.visible.face',
        stimulus_instance_id: 'stimulus-instance-expression-visible',
        runtime_result_id: 'expression-runtime-result-planned-1',
        driver_result_id: 'driver-result-expression-planned-1',
        multi_stimulus_group_id: 'multi-stimulus-expression-turn-1',
        lifecycle_trace: [
          {
            state: 'request_issued',
            status: 'accepted',
            reason_code: 'motion_stimulus_received',
            at_ms: 1000,
          },
          {
            state: 'runtime_started',
            status: 'started',
            reason_code: 'motion_runtime_expression_frame_queued',
            at_ms: 1030,
          },
        ],
      },
    })

    expect(diagnostics).toEqual(
      expect.objectContaining({
        schema_version: 'projection_visual_in_page_diagnostics.v0',
        visual_session_id: 'visual-session-test',
        projection_visual_instance_id: 'projection-visual-instance-test',
        surface_class: 'avatar_webgl_canvas',
        surface_instance_id: 'avatar-webgl-canvas-test',
        roi_registry_version: 'projection_visual_roi_registry.v0',
        frame_seq: 42,
        frame_timestamp_mono_ms: 1234.5,
      })
    )
    expect(diagnostics.runtime_refs).toEqual(
      expect.objectContaining({
        motion_event_id: 'motion-event-expression-visible',
        runtime_result_id: 'expression-runtime-result-planned-1',
        driver_result_id: 'driver-result-expression-planned-1',
        multi_stimulus_group_id: 'multi-stimulus-expression-turn-1',
        status: 'started',
      })
    )
    expect(diagnostics.runtime_anchors.runtime_started).toEqual({
      status: 'started',
      reason_code: 'motion_runtime_expression_frame_queued',
      at_ms: 1030,
    })
    expect(diagnostics.driver_frame_anchor).toEqual(
      expect.objectContaining({
        frame_seq: 40,
        driver_result_id: 'driver-result-actual-1',
        observed_at: 'post_vrm_update_pre_render',
      })
    )
    expect(diagnostics.expression_value_summary).toEqual(
      expect.objectContaining({
        expression_weight_applied: true,
        channel_names: ['happy'],
        frame_applied_count: 8,
      })
    )
    expect(diagnostics.mixed_surface_separation).toEqual({
      avatar_canvas_surface_class: 'avatar_webgl_canvas',
      dom_overlay_surface_classes: [
        'hud_dom_overlay',
        'speech_bubble_dom_overlay',
      ],
      dom_overlay_is_not_avatar_canvas_proof: true,
      avatar_canvas_is_not_dom_overlay_proof: true,
    })
    expect(JSON.stringify(diagnostics)).not.toContain('selectedVrmPath')
  })
})

function createReadyModel() {
  return {
    vrm: {
      scene: new THREE.Object3D(),
    },
    playMotionRuntimeContextNod: jest.fn().mockReturnValue({
      accepted: true,
      instanceId: 'context-nod-instance-1',
      reasonCode: 'request_accepted',
      replacedInstanceIds: [],
      pendingReplacementInstanceIds: [],
      queuedInstanceIds: [],
    }),
    queueMotionRuntimeFrame: jest.fn(),
    playMotionRuntimeVRMA: jest.fn(),
    stopMotionRuntimeGroup: jest.fn().mockReturnValue([]),
    unLoadVrm: jest.fn(),
  } as unknown as NonNullable<Viewer['model']>
}

function createVRMAnimation() {
  return {} as Awaited<ReturnType<typeof loadVRMAnimation>>
}

function createDeferred() {
  let resolve!: (value: Awaited<ReturnType<typeof loadVRMAnimation>>) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<Awaited<ReturnType<typeof loadVRMAnimation>>>(
    (promiseResolve, promiseReject) => {
      resolve = promiseResolve
      reject = promiseReject
    }
  )
  return { promise, resolve, reject }
}

async function flushPromises(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

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
      request_id: 'motion-request-1',
      runtime_result_id: 'runtime-result-planned-1',
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
      attempt: 1,
    },
    redaction: {
      shared_summary_only: true,
    },
  }
}

function createMotionRuntimeDebugSnapshot() {
  return {
    frameSeq: 42,
    vrmReady: true,
    sceneVisible: true,
    idleNeutralVisualTestMode: true,
    driverResult: {
      driver_result_id: 'driver-result-actual-1',
      stimulus_instance_id: 'stimulus-instance-expression-visible',
      result: 'applied',
      safe_visible_state: 'expression_changed',
      capability_profile_version: 'aituberkit-vrm-adapter.v0.1',
      per_part_results: [
        {
          part: 'expression',
          result: 'applied',
          capability: 'supported',
          reason_code: 'expression_weight_applied',
          safe_visible_state: 'expression_changed',
        },
      ],
      reason_code: 'motion_driver_applied',
      frame_count_bucket: '6_to_30_frames',
      observed_at: 'post_vrm_update_pre_render',
    },
    expressionValueSummary: {
      expression_weight_applied: true,
      channel_names: ['happy'],
      frame_applied_count: 8,
      last_weight_count: 1,
      last_weight_min: 0.5,
      last_weight_max: 0.5,
      last_driver_result_id: 'driver-result-actual-1',
      last_driver_result: 'applied',
      last_driver_reason_code: 'motion_driver_applied',
      last_safe_visible_state: 'expression_changed',
      last_observed_at: 'post_vrm_update_pre_render',
      last_frame_seq: 40,
    },
    session: {
      nowMs: 1000,
      active: [],
      pending: [],
      suppressed: [],
    },
    poseFrame: {
      humanoidRotationBoneNames: [],
      humanoidTranslationBoneNames: [],
    },
  } as any
}
