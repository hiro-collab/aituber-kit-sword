import type { VRMHumanBoneName } from '@pixiv/three-vrm'
import type * as THREE from 'three'
import type { MotionRuntimePoseFrame } from './motionPoseFrame'

export interface VRMPoseFrameDriverHumanoidNode {
  quaternion?: Pick<THREE.Quaternion, 'copy'>
  position?: Pick<THREE.Vector3, 'copy'>
}

export interface VRMPoseFrameDriverSurface {
  humanoid?: {
    getNormalizedBoneNode: (
      boneName: VRMHumanBoneName
    ) => VRMPoseFrameDriverHumanoidNode | null | undefined
    update?: () => void
  } | null
}

export interface VRMPoseFrameDriverResult {
  appliedRotations: number
  appliedTranslations: number
  skippedTranslations: number
}

export function applyMotionRuntimePoseFrameToVRM(
  surface: VRMPoseFrameDriverSurface,
  frame: MotionRuntimePoseFrame
): VRMPoseFrameDriverResult {
  let appliedRotations = 0
  let appliedTranslations = 0
  let skippedTranslations = 0

  for (const [boneName, rotation] of frame.humanoidRotations) {
    const node = surface.humanoid?.getNormalizedBoneNode(
      boneName as VRMHumanBoneName
    )
    if (!node?.quaternion) continue
    node.quaternion.copy(rotation)
    appliedRotations += 1
  }

  for (const [boneName, translation] of frame.humanoidTranslations) {
    if (boneName !== 'hips') {
      skippedTranslations += 1
      continue
    }
    const node = surface.humanoid?.getNormalizedBoneNode(
      boneName as VRMHumanBoneName
    )
    if (!node?.position) continue
    node.position.copy(translation)
    appliedTranslations += 1
  }

  surface.humanoid?.update?.()

  return {
    appliedRotations,
    appliedTranslations,
    skippedTranslations,
  }
}
