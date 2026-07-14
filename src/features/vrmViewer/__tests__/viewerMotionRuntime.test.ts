/**
 * @jest-environment node
 */

import * as THREE from 'three'
import { createProjectionVisualInPageDiagnostics, Viewer } from '../viewer'
import { calculateCameraFit } from '../cameraFit'
import { loadVRMAnimation } from '@/lib/VRMAnimation/loadVRMAnimation'
import {
  CONTEXT_NOD_DURATION_MS,
  CONTEXT_NOD_GROUP_KEY,
  DANCE_SEQUENCE_GROUP_KEY,
  DANCE_MOTION_ASSET_PATH_ENV,
  MOTION_ASSET_SEMANTIC_REGISTRY_JSON_ENV,
  SEMANTIC_MOTION_GROUP_KEY,
} from '@/features/motionRuntime/motionStimulusReceiver'

jest.mock('@/lib/VRMAnimation/loadVRMAnimation', () => ({
  loadVRMAnimation: jest.fn(),
}))

const mockedLoadVRMAnimation = loadVRMAnimation as jest.MockedFunction<
  typeof loadVRMAnimation
>
const originalDanceMotionAssetPath = process.env[DANCE_MOTION_ASSET_PATH_ENV]
const originalSemanticMotionRegistry =
  process.env[MOTION_ASSET_SEMANTIC_REGISTRY_JSON_ENV]

describe('VRM camera fit', () => {
  it('fits tall and wide model bounds using the limiting field of view', () => {
    const tall = calculateCameraFit(
      { min: { x: -0.5, y: 0, z: -0.2 }, max: { x: 0.5, y: 2, z: 0.2 } },
      20,
      16 / 9
    )
    const wide = calculateCameraFit(
      { min: { x: -2, y: 0, z: -0.2 }, max: { x: 2, y: 1, z: 0.2 } },
      20,
      16 / 9
    )

    expect(tall).toEqual(
      expect.objectContaining({
        target: { x: 0, y: 1, z: 0 },
      })
    )
    expect(wide).toEqual(
      expect.objectContaining({
        target: { x: 0, y: 0.5, z: 0 },
      })
    )
    expect(wide!.position.z).toBeGreaterThan(tall!.position.z)
    expect(tall!.near).toBeGreaterThan(0)
    expect(tall!.far).toBeGreaterThan(tall!.position.z)
  })

  it('fails closed for degenerate or invalid camera geometry', () => {
    expect(
      calculateCameraFit(
        { min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 1, z: 0 } },
        20,
        16 / 9
      )
    ).toBeNull()
    expect(
      calculateCameraFit(
        { min: { x: -1, y: 0, z: 0 }, max: { x: 1, y: 2, z: 0 } },
        20,
        0
      )
    ).toBeNull()
  })

  it('fails closed when finite inputs overflow derived camera geometry', () => {
    expect(
      calculateCameraFit(
        {
          min: { x: -1e308, y: 0, z: 0 },
          max: { x: 1e308, y: 2, z: 0 },
        },
        20,
        16 / 9
      )
    ).toBeNull()
  })

  it('fails closed when a positive FOV underflows its tangent', () => {
    expect(
      calculateCameraFit(
        { min: { x: -1, y: 0, z: 0 }, max: { x: 1, y: 2, z: 0 } },
        Number.MIN_VALUE,
        16 / 9
      )
    ).toBeNull()
  })
})

describe('Viewer Motion Runtime asset lifecycle', () => {
  beforeEach(() => {
    mockedLoadVRMAnimation.mockReset()
    process.env[DANCE_MOTION_ASSET_PATH_ENV] = '/local-vrma/test-dance.vrma'
    process.env[MOTION_ASSET_SEMANTIC_REGISTRY_JSON_ENV] = JSON.stringify({
      dance: '/local-vrma/test-dance.vrma',
    })
    jest.spyOn(console, 'error').mockImplementation(() => {})
    jest.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    restoreEnv(DANCE_MOTION_ASSET_PATH_ENV, originalDanceMotionAssetPath)
    restoreEnv(
      MOTION_ASSET_SEMANTIC_REGISTRY_JSON_ENV,
      originalSemanticMotionRegistry
    )
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
    expect(console.error).not.toHaveBeenCalled()
    expect(console.warn).toHaveBeenCalledWith(
      'Motion Runtime query VRMA unavailable',
      {
        reason_code: 'motion_query_asset_load_failed',
      }
    )
  })

  it('unloadVRM stops semantic and dance Motion Runtime groups before disposing the model', () => {
    const viewer = new Viewer()
    const model = createReadyModel()
    viewer.model = model

    viewer.unloadVRM()

    expect(model.stopMotionRuntimeGroup).toHaveBeenNthCalledWith(
      1,
      SEMANTIC_MOTION_GROUP_KEY
    )
    expect(model.stopMotionRuntimeGroup).toHaveBeenNthCalledWith(
      2,
      'dance.sequence'
    )
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

  it('loads an exact semantic registry asset as a one-shot generic VRMA lifecycle', async () => {
    const viewer = new Viewer()
    const model = createReadyModel()
    viewer.model = model
    process.env[MOTION_ASSET_SEMANTIC_REGISTRY_JSON_ENV] = JSON.stringify({
      greeting: '/local-vrma/greeting.vrma',
    })
    mockedLoadVRMAnimation.mockResolvedValue(createVRMAnimation())

    const result = await viewer.receiveMotionStimulus(
      createSemanticMotionStimulus('greeting', 'gesture')
    )

    expect(mockedLoadVRMAnimation).toHaveBeenCalledWith(
      '/local-vrma/greeting.vrma'
    )
    expect(model.playMotionRuntimeVRMA).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        stimulusId: 'mot_stim_semantic_greeting',
        groupKey: SEMANTIC_MOTION_GROUP_KEY,
        requestedAtMs: Date.parse('2026-07-14T04:00:00.000Z'),
        loop: false,
        stimulusInstanceId: 'mot_inst_semantic_greeting',
        runtimeResultId: 'mot_res_semantic_greeting',
      })
    )
    expect(result).toEqual(
      expect.objectContaining({
        accepted: true,
        status: 'started',
        reason_code: 'motion_runtime_vrma_started',
      })
    )
    expect(JSON.stringify(result)).not.toContain('/local-vrma/')
  })

  it('exposes the exact model-owned dance lifecycle predicate without a viewer shadow state', () => {
    const viewer = new Viewer()
    const model = createReadyModel()
    const predicate = jest.fn(() => true)
    ;(model as any).getDanceLifecycleAcceptancePredicate = jest
      .fn()
      .mockReturnValue(predicate)
    viewer.model = model

    expect(viewer.getDanceLifecycleAcceptancePredicate()).toBe(predicate)
    expect(viewer.getDanceLifecycleAcceptancePredicate()).toBe(predicate)
  })

  it('returns unavailable without raw error logging when a configured dance VRMA is missing', async () => {
    const viewer = new Viewer()
    const model = createReadyModel()
    viewer.model = model
    mockedLoadVRMAnimation.mockRejectedValueOnce(
      new Error(
        'fetch for "http://127.0.0.1:3000/local-vrma/test-dance.vrma" responded with 404: Not Found'
      )
    )

    const result = await viewer.receiveMotionStimulus(createDanceStimulus())

    expect(result).toEqual(
      expect.objectContaining({
        accepted: false,
        status: 'unavailable',
        reason_code: 'motion_asset_load_failed',
        safe_visible_state: 'no_visible_change',
      })
    )
    expect(model.playMotionRuntimeVRMA).not.toHaveBeenCalled()
    expect(console.error).not.toHaveBeenCalled()
    expect(console.warn).toHaveBeenCalledWith(
      'Motion Runtime VRMA asset unavailable',
      {
        reason_code: 'motion_asset_load_failed',
      }
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
      SEMANTIC_MOTION_GROUP_KEY,
      Date.parse('2026-06-15T02:15:00.000Z'),
      'motion_runtime_stop_requested'
    )
    expect(model.stopMotionRuntimeGroup).toHaveBeenCalledWith(
      DANCE_SEQUENCE_GROUP_KEY,
      Date.parse('2026-06-15T02:15:00.000Z'),
      'motion_runtime_stop_requested',
      {
        stimulusInstanceId: 'stimulus-instance-stop-1',
        runtimeResultId: 'runtime-result-stop-planned-1',
      }
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
    expect(model.stopMotionRuntimeGroup).toHaveBeenCalledTimes(2)
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
      driverResultId: 'driver-result-expression-planned-1',
      stimulusInstanceId: 'stimulus-instance-expression-visible',
      frameCount: 30,
      expressionProfileRef: 'motion.runtime.vrm_expression_weights.v0',
      expressionProfileId: 'expression_visible_default',
      expressionWeights: {
        happy: 1,
        relaxed: 0.75,
        joy: 1,
        Joy: 1,
        fun: 0.75,
        Fun: 0.75,
      },
      expressionTargetWeights: {
        happy: 1,
        relaxed: 0.75,
        joy: 1,
        Joy: 1,
        fun: 0.75,
        Fun: 0.75,
      },
    })
  })

  it('queues the allow-listed full-relaxed expression-visible profile with profile diagnostics', async () => {
    const viewer = new Viewer()
    const model = createReadyModel()
    viewer.model = model
    const stimulus = createExpressionVisibleStimulus()
    stimulus.requirements.expression_profile_ref =
      'motion.runtime.vrm_expression_weights.full_relaxed.v0'

    const result = await viewer.receiveMotionStimulus(stimulus)

    expect(result).toEqual(
      expect.objectContaining({
        accepted: true,
        status: 'started',
        reason_code: 'motion_runtime_expression_frame_queued',
        safe_visible_state: 'expression_change_requested',
      })
    )
    expect(model.queueMotionRuntimeFrame).toHaveBeenCalledWith(
      expect.objectContaining({
        expressionProfileRef:
          'motion.runtime.vrm_expression_weights.full_relaxed.v0',
        expressionProfileId: 'expression_visible_full_relaxed',
        expressionWeights: {
          happy: 1,
          relaxed: 1,
          joy: 1,
          Joy: 1,
          fun: 1,
          Fun: 1,
        },
        expressionTargetWeights: {
          happy: 1,
          relaxed: 1,
          joy: 1,
          Joy: 1,
          fun: 1,
          Fun: 1,
        },
      })
    )
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
        expression_profile_ref: 'motion.runtime.vrm_expression_weights.v0',
        expression_profile_id: 'expression_visible_default',
        frame_applied_count: 8,
        last_weight_count: 1,
        last_weight_min: 0.5,
        last_weight_max: 0.5,
        target_weight_count: 1,
        target_weight_min: 1,
        target_weight_max: 1,
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

function createSemanticMotionStimulus(semantic: 'greeting', kind: 'gesture') {
  return {
    schema_version: 'motion_stimulus.v0',
    motion_event_id: `mot_evt_semantic_${semantic}`,
    stimulus_id: `mot_stim_semantic_${semantic}`,
    stimulus_instance_id: `mot_inst_semantic_${semantic}`,
    source_class: 'user_command',
    source_origin: 'thought_core',
    requested_at: '2026-07-14T04:00:00.000Z',
    kind,
    payload_ref: `motion.thought_core.semantic_motion.${semantic}.v0`,
    request_mode: 'play',
    duration_ms: 12000,
    loop: false,
    interrupt_policy: 'replace_same_track',
    fallback_state: 'neutral_idle',
    stop_reason: 'none',
    phase: 'queued',
    lifecycle_state: 'queued',
    safe_visible_state: 'requested',
    target_model_type: 'vrm',
    track_mask: { scope: 'full_body' },
    requirements: { visible_motion: true },
    trace: {
      event_id: `evt_semantic_${semantic}`,
      turn_id: `turn_semantic_${semantic}`,
      runtime_result_id: `mot_res_semantic_${semantic}`,
    },
    redaction: { shared_summary_only: true },
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
      expression_profile_ref: 'motion.runtime.vrm_expression_weights.v0',
      expression_profile_id: 'expression_visible_default',
      frame_applied_count: 8,
      last_weight_count: 1,
      last_weight_min: 0.5,
      last_weight_max: 0.5,
      target_weight_count: 1,
      target_weight_min: 1,
      target_weight_max: 1,
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

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name]
    return
  }
  process.env[name] = value
}
