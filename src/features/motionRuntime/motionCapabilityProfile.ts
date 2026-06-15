export type MotionCapabilityState =
  | 'supported'
  | 'conditional'
  | 'policy_only'
  | 'unavailable'

export interface MotionCapabilityProfile {
  version: string
  expressionWeight: MotionCapabilityState
  audioDrivenLipSyncObserved: MotionCapabilityState
  manualLipSync: MotionCapabilityState
  mouthPolicyOnly: MotionCapabilityState
  lookAtTarget: MotionCapabilityState
  lookAtYawPitch: MotionCapabilityState
  headBone: MotionCapabilityState
  upperBodyClip: MotionCapabilityState
  fullBodyAnimation: MotionCapabilityState
  resetToIdle: MotionCapabilityState
  driverResultObservation: MotionCapabilityState
}

export const MOTION_CAPABILITY_PROFILE_VERSION = 'aituberkit-vrm-adapter.v0.1'

const MOTION_CAPABILITY_PROFILE: MotionCapabilityProfile = Object.freeze({
  version: MOTION_CAPABILITY_PROFILE_VERSION,
  expressionWeight: 'supported',
  audioDrivenLipSyncObserved: 'conditional',
  manualLipSync: 'policy_only',
  mouthPolicyOnly: 'policy_only',
  lookAtTarget: 'conditional',
  lookAtYawPitch: 'conditional',
  headBone: 'conditional',
  upperBodyClip: 'conditional',
  fullBodyAnimation: 'conditional',
  resetToIdle: 'supported',
  driverResultObservation: 'conditional',
})

export function getMotionCapabilityProfile(): MotionCapabilityProfile {
  return { ...MOTION_CAPABILITY_PROFILE }
}

export function isDirectRuntimeCapability(
  state: MotionCapabilityState
): boolean {
  return state === 'supported' || state === 'conditional'
}
