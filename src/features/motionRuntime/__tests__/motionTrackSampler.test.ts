import * as THREE from 'three'
import { MotionRuntimeCompiledTrack } from '../motionTrackSampler'

describe('MotionRuntimeCompiledTrack', () => {
  it('samples vector tracks with linear interpolation', () => {
    const track = new MotionRuntimeCompiledTrack({
      channel: {
        id: 'humanoid:hips:translation',
        kind: 'humanoidTranslation',
        boneName: 'hips',
      },
      valueKind: 'vector3',
      times: [0, 1],
      values: [0, 0, 0, 2, 4, 6],
    })

    expect(track.sample(0.5).vector).toEqual(new THREE.Vector3(1, 2, 3))
  })

  it('samples quaternion tracks with shortest-path slerp', () => {
    const start = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 1, 0),
      0
    )
    const end = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 1, 0),
      Math.PI
    )
    const track = new MotionRuntimeCompiledTrack({
      channel: {
        id: 'humanoid:spine:rotation',
        kind: 'humanoidRotation',
        boneName: 'spine',
      },
      valueKind: 'quaternion',
      times: [0, 1],
      values: [...start.toArray(), ...end.toArray()],
    })

    const sampled = track.sample(0.5).quaternion
    const expected = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 1, 0),
      Math.PI / 2
    )

    expect(sampled?.angleTo(expected)).toBeLessThan(0.0001)
  })

  it('wraps looped tracks by duration', () => {
    const track = new MotionRuntimeCompiledTrack({
      channel: {
        id: 'humanoid:hips:translation',
        kind: 'humanoidTranslation',
        boneName: 'hips',
      },
      valueKind: 'vector3',
      times: [0, 1],
      values: [0, 0, 0, 10, 0, 0],
      loop: true,
    })

    expect(track.sample(1.25).vector).toEqual(new THREE.Vector3(2.5, 0, 0))
  })
})
