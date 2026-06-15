import {
  getMotionCapabilityProfile,
  isDirectRuntimeCapability,
} from '../motionCapabilityProfile'

describe('motionCapabilityProfile', () => {
  it('keeps direct runtime capabilities separate from policy-only mouth control', () => {
    const profile = getMotionCapabilityProfile()

    expect(profile.expressionWeight).toBe('supported')
    expect(profile.audioDrivenLipSyncObserved).toBe('conditional')
    expect(profile.manualLipSync).toBe('policy_only')
    expect(profile.mouthPolicyOnly).toBe('policy_only')
    expect(isDirectRuntimeCapability(profile.manualLipSync)).toBe(false)
    expect(isDirectRuntimeCapability(profile.mouthPolicyOnly)).toBe(false)
  })

  it('marks unproven motion ownership surfaces as conditional', () => {
    const profile = getMotionCapabilityProfile()

    expect(profile.lookAtTarget).toBe('conditional')
    expect(profile.lookAtYawPitch).toBe('conditional')
    expect(profile.headBone).toBe('conditional')
    expect(profile.upperBodyClip).toBe('conditional')
    expect(profile.fullBodyAnimation).toBe('conditional')
    expect(profile.driverResultObservation).toBe('conditional')
    expect(profile.resetToIdle).toBe('supported')
  })
})
