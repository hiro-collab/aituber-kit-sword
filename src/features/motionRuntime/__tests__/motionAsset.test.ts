import * as THREE from 'three'
import type { VRMHumanBoneName } from '@pixiv/three-vrm'
import { VRMAnimation } from '@/lib/VRMAnimation/VRMAnimation'
import { compileVRMAnimationToMotionRuntimeAsset } from '../motionAsset'

const FIXED_TIME_SEC = 0.625
const KNOWN_BENDS = {
  leftLowerArm: new THREE.Quaternion(0.22, -0.31, 0.41, 0.82).normalize(),
  rightLowerArm: new THREE.Quaternion(-0.18, 0.27, 0.36, 0.87).normalize(),
  leftLowerLeg: new THREE.Quaternion(0.34, 0.16, -0.29, 0.88).normalize(),
  rightLowerLeg: new THREE.Quaternion(-0.25, -0.19, -0.38, 0.86).normalize(),
} satisfies Record<string, THREE.Quaternion>

const EXPECTED_CHANNEL_IDS = [
  'humanoid:leftLowerArm:rotation',
  'humanoid:rightLowerArm:rotation',
  'humanoid:leftLowerLeg:rotation',
  'humanoid:rightLowerLeg:rotation',
]

describe('compileVRMAnimationToMotionRuntimeAsset target format', () => {
  it('keeps VRM1 quaternion values and left/right channel ids unchanged', () => {
    const asset = compileVRMAnimationToMotionRuntimeAsset(
      createKnownBendAnimation(),
      { targetMetaVersion: '1' }
    )

    expect(asset.tracks.map((track) => track.channel.id)).toEqual(
      EXPECTED_CHANNEL_IDS
    )
    for (const [boneName, source] of Object.entries(KNOWN_BENDS)) {
      const track = asset.trackByChannelId.get(`humanoid:${boneName}:rotation`)
      expect(track?.channel.boneName).toBe(boneName)
      expectQuaternionComponents(track?.values, source)
    }
  })

  it('applies the VRM0 X/Z quaternion convention without swapping bend sides or ids', () => {
    const asset = compileVRMAnimationToMotionRuntimeAsset(
      createKnownBendAnimation(),
      { targetMetaVersion: '0' }
    )

    expect(asset.tracks.map((track) => track.channel.id)).toEqual(
      EXPECTED_CHANNEL_IDS
    )
    for (const boneName of ['leftLowerArm', 'leftLowerLeg'] as const) {
      const source = KNOWN_BENDS[boneName]
      const expected = new THREE.Quaternion(
        -source.x,
        source.y,
        -source.z,
        source.w
      )
      const track = asset.trackByChannelId.get(`humanoid:${boneName}:rotation`)
      const sampled = track?.sample(FIXED_TIME_SEC).quaternion

      expect(track?.channel.boneName).toBe(boneName)
      expectQuaternionComponents(track?.values, expected)
      expect(sampled?.dot(expected)).toBeGreaterThan(0.999999)
    }
  })
})

function createKnownBendAnimation(): VRMAnimation {
  const animation = new VRMAnimation()
  animation.duration = FIXED_TIME_SEC

  for (const [boneName, quaternion] of Object.entries(KNOWN_BENDS)) {
    animation.humanoidTracks.rotation.set(
      boneName as VRMHumanBoneName,
      new THREE.VectorKeyframeTrack(
        `${boneName}.quaternion`,
        [FIXED_TIME_SEC],
        quaternion.toArray()
      )
    )
  }

  return animation
}

function expectQuaternionComponents(
  values: ArrayLike<number> | undefined,
  expected: THREE.Quaternion
): void {
  expect(values).toBeDefined()
  expect(values?.[0]).toBeCloseTo(expected.x, 6)
  expect(values?.[1]).toBeCloseTo(expected.y, 6)
  expect(values?.[2]).toBeCloseTo(expected.z, 6)
  expect(values?.[3]).toBeCloseTo(expected.w, 6)
}
