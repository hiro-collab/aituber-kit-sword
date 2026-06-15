import * as THREE from 'three'

export interface MotionRuntimePoseFrame {
  humanoidRotations: Map<string, THREE.Quaternion>
  humanoidTranslations: Map<string, THREE.Vector3>
}

export function createEmptyMotionRuntimePoseFrame(): MotionRuntimePoseFrame {
  return {
    humanoidRotations: new Map(),
    humanoidTranslations: new Map(),
  }
}
