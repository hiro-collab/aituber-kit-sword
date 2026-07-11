import {
  Model,
  createEmptyMotionRuntimeExpressionValueSummary,
  createExpressionWeightFrameSequence,
  createMotionRuntimeExpressionValueSummary,
  shouldApplyQueuedMotionFrameInFrozenVisualTestMode,
} from '../model'
import { MotionRuntimeSession } from '@/features/motionRuntime/motionRuntimeSession'

describe('Model Motion Runtime frozen visual-test routing', () => {
  it('allows expression-only frames in frozen visual-test mode', () => {
    expect(
      shouldApplyQueuedMotionFrameInFrozenVisualTestMode({
        stimulusInstanceId: 'stimulus-expression-visible',
        frameCount: 1,
        expressionWeights: { happy: 1 },
      })
    ).toBe(true)
  })

  it('keeps gaze, reset, and empty frames frozen', () => {
    expect(
      shouldApplyQueuedMotionFrameInFrozenVisualTestMode({
        stimulusInstanceId: 'stimulus-gaze',
        lookAtTarget: { x: 0, y: 1, z: 0 },
      })
    ).toBe(false)
    expect(
      shouldApplyQueuedMotionFrameInFrozenVisualTestMode({
        stimulusInstanceId: 'stimulus-reset',
        resetToIdle: true,
      })
    ).toBe(false)
    expect(
      shouldApplyQueuedMotionFrameInFrozenVisualTestMode({
        stimulusInstanceId: 'stimulus-empty',
        frameCount: 1,
      })
    ).toBe(false)
  })

  it('does not mix expression-visible frames with other motion controls while frozen', () => {
    expect(
      shouldApplyQueuedMotionFrameInFrozenVisualTestMode({
        stimulusInstanceId: 'stimulus-expression-gaze',
        frameCount: 1,
        expressionWeights: { happy: 1 },
        lookAtTarget: { x: 0, y: 1, z: 0 },
      })
    ).toBe(false)
    expect(
      shouldApplyQueuedMotionFrameInFrozenVisualTestMode({
        stimulusInstanceId: 'stimulus-expression-reset',
        frameCount: 1,
        expressionWeights: { happy: 1 },
        resetToIdle: true,
      })
    ).toBe(false)
  })
})

describe('Model Motion Runtime expression-visible frame signal', () => {
  it('expands expression-visible requests into a bounded expression-weight ramp', () => {
    const frames = createExpressionWeightFrameSequence({
      stimulusInstanceId: 'stimulus-expression-visible',
      frameCount: 4,
      expressionWeights: { happy: 1, relaxed: 0.5 },
    })

    expect(frames).toHaveLength(4)
    expect(frames[0]).toEqual(
      expect.objectContaining({
        stimulusInstanceId: 'stimulus-expression-visible',
        frameCount: 4,
        expressionWeights: { happy: 0.25, relaxed: 0.125 },
      })
    )
    expect(frames[3]).toEqual(
      expect.objectContaining({
        stimulusInstanceId: 'stimulus-expression-visible',
        frameCount: 4,
        expressionWeights: { happy: 1, relaxed: 0.5 },
      })
    )
  })

  it('does not expand mixed gaze/reset frames into the expression-visible ramp', () => {
    const mixedFrame = {
      stimulusInstanceId: 'stimulus-expression-gaze',
      frameCount: 4,
      expressionWeights: { happy: 1 },
      lookAtTarget: { x: 0, y: 1, z: 0 },
    }

    expect(createExpressionWeightFrameSequence(mixedFrame)).toEqual([
      mixedFrame,
    ])
  })

  it('caps expression-visible ramps to the safe 30-frame signal window', () => {
    const frames = createExpressionWeightFrameSequence({
      stimulusInstanceId: 'stimulus-expression-visible-long',
      frameCount: 120,
      expressionWeights: { happy: 1 },
    })

    expect(frames).toHaveLength(30)
    expect(frames[29]).toEqual(
      expect.objectContaining({
        stimulusInstanceId: 'stimulus-expression-visible-long',
        frameCount: 30,
        expressionWeights: { happy: 1 },
      })
    )
  })
})

describe('Model dance lifecycle authority', () => {
  it('returns one session-owned predicate and routes stop admission through that same session', () => {
    const session = new MotionRuntimeSession()
    // The constructor needs browser audio; this test injects only the owned session.
    const model = Object.create(Model.prototype) as Model
    const predicate = session.acceptDanceLifecycleCandidate.bind(session)
    ;(model as any)._motionRuntimeSession = session
    ;(model as any)._danceLifecycleAcceptancePredicate = predicate

    expect(model.getDanceLifecycleAcceptancePredicate()).toBe(predicate)
    expect(model.getDanceLifecycleAcceptancePredicate()).toBe(predicate)

    model.stopMotionRuntimeGroup('dance.sequence', 1000, 'stop', {
      stimulusInstanceId: 'stimulus-stop',
      runtimeResultId: 'result-stop',
    })
    expect(
      predicate({
        eventKind: 'runtime_result',
        stimulusInstanceId: 'stimulus-stop',
        runtimeResultId: 'result-stop',
        candidateState: 'idle',
      })
    ).toBe(true)
  })
})

describe('Model Motion Runtime expression-value diagnostics', () => {
  it('summarizes applied expression frames without retaining a raw value map', () => {
    const summary = createMotionRuntimeExpressionValueSummary(
      createEmptyMotionRuntimeExpressionValueSummary(),
      {
        stimulusInstanceId: 'stimulus-expression-visible',
        frameCount: 30,
        expressionWeights: { happy: 0.5, relaxed: 0.25 },
      },
      {
        driver_result_id: 'driver-result-expression-1',
        stimulus_instance_id: 'stimulus-expression-visible',
        result: 'applied',
        safe_visible_state: 'expression_changed',
        capability_profile_version: 'motion-capability-profile.v0',
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
      12
    )

    expect(summary).toEqual(
      expect.objectContaining({
        expression_weight_applied: true,
        channel_names: ['happy', 'relaxed'],
        frame_applied_count: 1,
        last_weight_count: 2,
        last_weight_min: 0.25,
        last_weight_max: 0.5,
        last_driver_result_id: 'driver-result-expression-1',
        last_driver_result: 'applied',
        last_driver_reason_code: 'motion_driver_applied',
        last_safe_visible_state: 'expression_changed',
        last_observed_at: 'post_vrm_update_pre_render',
        last_frame_seq: 12,
      })
    )
    expect(summary).not.toHaveProperty('expressionWeights')
  })
})
