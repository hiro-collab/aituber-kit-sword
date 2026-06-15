import * as THREE from 'three'
import { VRMMotionAdapter } from '../vrmMotionAdapter'

describe('VRMMotionAdapter', () => {
  it('is inert without a frame request', () => {
    const adapter = new VRMMotionAdapter()

    expect(adapter.applyFrame({}, null)).toBeNull()
    expect(adapter.applyFrame({})).toBeNull()
  })

  it('applies bounded expression weights and finalizes driver result timing', () => {
    const adapter = new VRMMotionAdapter()
    const setValue = jest.fn()

    const result = adapter.applyFrame(
      { expressionManager: { setValue } },
      {
        stimulusInstanceId: 'stimulus-expression-1',
        frameCount: 1,
        expressionWeights: {
          happy: 1.4,
          angry: -0.2,
        },
      }
    )

    expect(setValue).toHaveBeenCalledWith('happy', 1)
    expect(setValue).toHaveBeenCalledWith('angry', 0)
    expect(result?.result).toBe('applied')
    expect(result?.safe_visible_state).toBe('expression_changed')
    expect(result?.per_part_results).toEqual([
      expect.objectContaining({
        part: 'expression',
        result: 'applied',
        reason_code: 'expression_weight_applied',
      }),
    ])

    const finalized = adapter.finalizeDriverResult(result)
    expect(finalized?.observed_at).toBe('post_vrm_update_pre_render')
  })

  it('sets and restores a temporary lookAt target', () => {
    const adapter = new VRMMotionAdapter()
    const parent = new THREE.Object3D()
    const originalTarget = new THREE.Object3D()
    const lookAt = { target: originalTarget }

    const result = adapter.applyFrame(
      { lookAt, lookAtTargetParent: parent },
      {
        stimulusInstanceId: 'stimulus-gaze-1',
        lookAtTarget: { x: 0.2, y: 1.1, z: -0.5 },
      }
    )

    expect(result?.result).toBe('applied')
    expect(lookAt.target).not.toBe(originalTarget)
    expect(lookAt.target?.name).toBe('MotionRuntimeLookAtTarget')
    expect(parent.children).toContain(lookAt.target)

    const releaseResult = adapter.applyFrame(
      { lookAt, lookAtTargetParent: parent },
      { lookAtTarget: { release: true } }
    )

    expect(releaseResult?.result).toBe('stopped')
    expect(lookAt.target).toBe(originalTarget)
    expect(parent.children).not.toContain(lookAt.target)
  })

  it('maps resetToIdle to a bounded stopped driver result', () => {
    const adapter = new VRMMotionAdapter()
    const resetToIdle = jest.fn(() => true)

    const result = adapter.applyFrame(
      { resetToIdle },
      {
        stimulusInstanceId: 'stimulus-reset-1',
        resetToIdle: true,
      }
    )

    expect(resetToIdle).toHaveBeenCalledTimes(1)
    expect(result?.result).toBe('stopped')
    expect(result?.safe_visible_state).toBe('neutral_idle_requested')
    expect(result?.per_part_results).toEqual([
      expect.objectContaining({
        part: 'reset',
        result: 'stopped',
        reason_code: 'reset_to_idle_requested',
      }),
    ])
  })
})
