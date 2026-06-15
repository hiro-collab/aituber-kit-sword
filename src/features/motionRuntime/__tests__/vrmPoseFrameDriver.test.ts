import * as THREE from 'three'
import { createEmptyMotionRuntimePoseFrame } from '../motionPoseFrame'
import { applyMotionRuntimePoseFrameToVRM } from '../vrmPoseFrameDriver'

describe('applyMotionRuntimePoseFrameToVRM', () => {
  it('applies normalized humanoid rotations and hips translation only', () => {
    const frame = createEmptyMotionRuntimePoseFrame()
    const spineRotation = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 1, 0),
      0.5
    )
    const hipsPosition = new THREE.Vector3(0, 1, 0)
    const handPosition = new THREE.Vector3(1, 0, 0)
    frame.humanoidRotations.set('spine', spineRotation)
    frame.humanoidTranslations.set('hips', hipsPosition)
    frame.humanoidTranslations.set('leftHand', handPosition)

    const spineNode = {
      quaternion: new THREE.Quaternion(),
    }
    const hipsNode = {
      position: new THREE.Vector3(),
    }
    const leftHandNode = {
      position: new THREE.Vector3(),
    }
    const nodes: Record<
      string,
      {
        quaternion?: THREE.Quaternion
        position?: THREE.Vector3
      }
    > = {
      spine: spineNode,
      hips: hipsNode,
      leftHand: leftHandNode,
    }
    const update = jest.fn()
    const result = applyMotionRuntimePoseFrameToVRM(
      {
        humanoid: {
          getNormalizedBoneNode: (boneName) => nodes[boneName],
          update,
        },
      },
      frame
    )

    expect(result).toEqual({
      appliedRotations: 1,
      appliedTranslations: 1,
      skippedTranslations: 1,
    })
    expect(spineNode.quaternion.angleTo(spineRotation)).toBeLessThan(0.0001)
    expect(hipsNode.position).toEqual(hipsPosition)
    expect(leftHandNode.position).toEqual(new THREE.Vector3())
    expect(update).toHaveBeenCalledTimes(1)
  })
})
