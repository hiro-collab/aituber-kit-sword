import * as THREE from 'three'
import type { MotionRuntimeAsset } from '../motionAsset'
import { MotionRuntimeSession } from '../motionRuntimeSession'
import { MotionRuntimeCompiledTrack } from '../motionTrackSampler'

describe('MotionRuntimeSession', () => {
  it('creates instances at request time and assigns ready instances to role-free slots', () => {
    const session = new MotionRuntimeSession({
      config: { maxActiveSlots: 2 },
    })

    const feedback = session.request({
      stimulusId: 'dance_01',
      requestedAtMs: 1000,
      channelIds: ['humanoid:leftUpperArm:rotation'],
      interruptPolicy: 'coexist',
    })

    expect(feedback.accepted).toBe(true)
    session.tick(1000)

    expect(session.snapshot()).toEqual(
      expect.objectContaining({
        occupiedSlots: 1,
        instances: [
          expect.objectContaining({
            instanceId: feedback.instanceId,
            phase: 'active',
            slotId: 'slot_0',
            activeChannelIds: ['humanoid:leftUpperArm:rotation'],
          }),
        ],
      })
    )
  })

  it('allows coexist but resolves same-channel output by priority winner', () => {
    const session = new MotionRuntimeSession({
      config: { maxActiveSlots: 2 },
    })

    session.request({
      stimulusId: 'low_priority_wave',
      requestedAtMs: 1000,
      channelIds: ['humanoid:rightUpperArm:rotation'],
      priorityByChannel: { 'humanoid:rightUpperArm:rotation': 10 },
      interruptPolicy: 'coexist',
    })
    session.request({
      stimulusId: 'high_priority_dance',
      requestedAtMs: 1010,
      channelIds: ['humanoid:rightUpperArm:rotation'],
      priorityByChannel: { 'humanoid:rightUpperArm:rotation': 80 },
      interruptPolicy: 'coexist',
    })
    session.tick(1010)

    const instances = session.snapshot().instances
    expect(instances).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          stimulusId: 'low_priority_wave',
          phase: 'suppressed',
          suppressedChannelIds: ['humanoid:rightUpperArm:rotation'],
        }),
        expect.objectContaining({
          stimulusId: 'high_priority_dance',
          phase: 'active',
          activeChannelIds: ['humanoid:rightUpperArm:rotation'],
        }),
      ])
    )
  })

  it('pauses suppressed instances by default and advances only when configured', () => {
    const session = new MotionRuntimeSession({
      config: { maxActiveSlots: 3 },
    })

    session.request({
      stimulusId: 'paused_suppressed',
      requestedAtMs: 1000,
      channelIds: ['humanoid:head:rotation'],
      priorityByChannel: { 'humanoid:head:rotation': 10 },
      interruptPolicy: 'coexist',
    })
    session.request({
      stimulusId: 'advancing_suppressed',
      requestedAtMs: 1001,
      channelIds: ['humanoid:head:rotation'],
      priorityByChannel: { 'humanoid:head:rotation': 20 },
      interruptPolicy: 'coexist',
      suppressionClock: 'advance',
    })
    session.request({
      stimulusId: 'winner',
      requestedAtMs: 1002,
      channelIds: ['humanoid:head:rotation'],
      priorityByChannel: { 'humanoid:head:rotation': 90 },
      interruptPolicy: 'coexist',
    })

    session.tick(1002)
    session.tick(1102)

    const instances = session.snapshot().instances
    expect(
      instances.find((instance) => instance.stimulusId === 'paused_suppressed')
        ?.localTimeMs
    ).toBe(0)
    expect(
      instances.find(
        (instance) => instance.stimulusId === 'advancing_suppressed'
      )?.localTimeMs
    ).toBe(100)
  })

  it('queues without occupying slots and promotes after a slot is released', () => {
    const session = new MotionRuntimeSession({
      config: { maxActiveSlots: 1, defaultReleaseDurationMs: 100 },
    })

    session.request({
      stimulusId: 'first',
      requestedAtMs: 1000,
      channelIds: ['humanoid:hips:rotation'],
      interruptPolicy: 'coexist',
      durationMs: 50,
    })
    session.request({
      stimulusId: 'second',
      requestedAtMs: 1010,
      channelIds: ['humanoid:spine:rotation'],
      interruptPolicy: 'queue_same_group',
      groupKey: 'demo',
    })

    session.tick(1000)
    expect(session.snapshot().occupiedSlots).toBe(1)
    expect(
      session
        .snapshot()
        .instances.find((instance) => instance.stimulusId === 'second')?.phase
    ).toBe('queued')

    session.tick(1151)
    session.tick(1252)
    session.tick(1253)

    const second = session
      .snapshot()
      .instances.find((instance) => instance.stimulusId === 'second')
    expect(second?.phase).toBe('active')
    expect(second?.slotId).toBe('slot_0')
  })

  it('uses newer instance as deterministic winner when channel priority ties', () => {
    const session = new MotionRuntimeSession({
      config: { maxActiveSlots: 2 },
    })

    session.request({
      stimulusId: 'older',
      requestedAtMs: 1000,
      channelIds: ['humanoid:leftHand:rotation'],
      priorityByChannel: { 'humanoid:leftHand:rotation': 50 },
      interruptPolicy: 'coexist',
    })
    session.request({
      stimulusId: 'newer',
      requestedAtMs: 1001,
      channelIds: ['humanoid:leftHand:rotation'],
      priorityByChannel: { 'humanoid:leftHand:rotation': 50 },
      interruptPolicy: 'coexist',
    })
    session.tick(1001)

    expect(session.snapshot().instances).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          stimulusId: 'older',
          phase: 'suppressed',
        }),
        expect.objectContaining({
          stimulusId: 'newer',
          phase: 'active',
          activeChannelIds: ['humanoid:leftHand:rotation'],
        }),
      ])
    )
  })

  it('replace_same_group moves old matching instances to releasing', () => {
    const session = new MotionRuntimeSession({
      config: { maxActiveSlots: 2, defaultReleaseDurationMs: 100 },
    })

    const first = session.request({
      stimulusId: 'dance_a',
      requestedAtMs: 1000,
      groupKey: 'dance.sequence',
      channelIds: ['humanoid:hips:rotation'],
      interruptPolicy: 'coexist',
    })
    session.tick(1000)

    const second = session.request({
      stimulusId: 'dance_b',
      requestedAtMs: 1050,
      groupKey: 'dance.sequence',
      channelIds: ['humanoid:hips:rotation'],
      interruptPolicy: 'replace_same_group',
    })

    expect(second.replacedInstanceIds).toEqual([first.instanceId])
    expect(
      session
        .snapshot()
        .instances.find((instance) => instance.instanceId === first.instanceId)
        ?.phase
    ).toBe('releasing')
  })

  it('keeps loading asset instances out of slots until the asset is attached', () => {
    const session = new MotionRuntimeSession({
      config: { maxActiveSlots: 1 },
    })
    const request = session.request({
      stimulusId: 'asset_dance',
      requestedAtMs: 1000,
      channelIds: ['humanoid:spine:rotation'],
      interruptPolicy: 'coexist',
      requiresAsset: true,
    })

    session.tick(1000)
    expect(session.snapshot().occupiedSlots).toBe(0)
    expect(session.snapshot().instances[0]).toEqual(
      expect.objectContaining({
        phase: 'loading',
        slotId: null,
      })
    )

    session.attachMotionAsset(
      request.instanceId!,
      createRotationAsset('asset_dance', 'spine', 0.25),
      1010
    )
    session.tick(1010)

    expect(session.snapshot().occupiedSlots).toBe(1)
    expect(session.snapshot().instances[0]).toEqual(
      expect.objectContaining({
        phase: 'active',
        slotId: 'slot_0',
      })
    )
  })

  it('waits for replacement asset readiness before releasing the visible old instance', () => {
    const session = new MotionRuntimeSession({
      config: { maxActiveSlots: 2, defaultReleaseDurationMs: 100 },
    })
    const first = session.request({
      stimulusId: 'dance_a',
      requestedAtMs: 1000,
      groupKey: 'dance.sequence',
      channelIds: ['humanoid:spine:rotation'],
      interruptPolicy: 'coexist',
      requiresAsset: true,
    })
    session.attachMotionAsset(
      first.instanceId!,
      createRotationAsset('dance_a', 'spine', 0.2),
      1000
    )
    session.tick(1000)

    const second = session.request({
      stimulusId: 'dance_b',
      requestedAtMs: 1010,
      groupKey: 'dance.sequence',
      channelIds: ['humanoid:spine:rotation'],
      interruptPolicy: 'replace_same_group',
      requiresAsset: true,
    })
    session.tick(1010)

    expect(second.pendingReplacementInstanceIds).toEqual([first.instanceId])
    expect(
      session
        .snapshot()
        .instances.find((instance) => instance.instanceId === first.instanceId)
        ?.phase
    ).toBe('active')

    session.attachMotionAsset(
      second.instanceId!,
      createRotationAsset('dance_b', 'spine', 0.7),
      1020
    )
    session.tick(1020)

    expect(
      session
        .snapshot()
        .instances.find((instance) => instance.instanceId === first.instanceId)
        ?.phase
    ).toBe('releasing')
    expect(
      session
        .snapshot()
        .instances.find((instance) => instance.instanceId === second.instanceId)
        ?.phase
    ).toBe('active')
  })

  it('samples the winning asset channel into the latest pose frame', () => {
    const session = new MotionRuntimeSession({
      config: { maxActiveSlots: 2 },
    })
    const low = session.request({
      stimulusId: 'low',
      requestedAtMs: 1000,
      channelIds: ['humanoid:spine:rotation'],
      priorityByChannel: { 'humanoid:spine:rotation': 10 },
      interruptPolicy: 'coexist',
      requiresAsset: true,
    })
    const high = session.request({
      stimulusId: 'high',
      requestedAtMs: 1001,
      channelIds: ['humanoid:spine:rotation'],
      priorityByChannel: { 'humanoid:spine:rotation': 90 },
      interruptPolicy: 'coexist',
      requiresAsset: true,
    })
    session.attachMotionAsset(
      low.instanceId!,
      createRotationAsset('low', 'spine', 0.1),
      1000
    )
    session.attachMotionAsset(
      high.instanceId!,
      createRotationAsset('high', 'spine', 0.8),
      1001
    )
    session.tick(1001)

    const expected = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 1, 0),
      0.8
    )

    expect(
      session
        .getLastPoseFrame()
        .humanoidRotations.get('spine')
        ?.angleTo(expected)
    ).toBeLessThan(0.0001)
  })

  it('keeps looping assets active after their source clip duration', () => {
    const session = new MotionRuntimeSession({
      config: { maxActiveSlots: 1, defaultReleaseDurationMs: 100 },
    })
    const request = session.request({
      stimulusId: 'looping_dance',
      requestedAtMs: 1000,
      channelIds: ['humanoid:spine:rotation'],
      interruptPolicy: 'coexist',
      requiresAsset: true,
    })

    session.attachMotionAsset(
      request.instanceId!,
      createRotationAsset('looping_dance', 'spine', 0.4, true),
      1000
    )
    session.tick(1000)
    session.tick(2500)

    expect(session.snapshot().instances[0]).toEqual(
      expect.objectContaining({
        stimulusId: 'looping_dance',
        phase: 'active',
        localTimeMs: 1500,
      })
    )
  })

  it('releases matching group instances when the selected motion asset is cleared', () => {
    const session = new MotionRuntimeSession({
      config: { maxActiveSlots: 2, defaultReleaseDurationMs: 100 },
    })

    const dance = session.request({
      stimulusId: 'looping_dance',
      requestedAtMs: 1000,
      groupKey: 'dance.sequence',
      channelIds: ['humanoid:spine:rotation'],
      interruptPolicy: 'coexist',
      requiresAsset: true,
    })
    session.attachMotionAsset(
      dance.instanceId!,
      createRotationAsset('looping_dance', 'spine', 0.4, true),
      1000
    )
    session.tick(1000)

    expect(session.releaseGroup('dance.sequence', 1100)).toEqual([
      dance.instanceId,
    ])
    expect(session.snapshot().instances[0]).toEqual(
      expect.objectContaining({
        phase: 'releasing',
        reasonCode: 'group_release_requested',
      })
    )
  })
})

function createRotationAsset(
  assetId: string,
  boneName: string,
  radians: number,
  loop = false
): MotionRuntimeAsset {
  const rotation = new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(0, 1, 0),
    radians
  )
  const track = new MotionRuntimeCompiledTrack({
    channel: {
      id: `humanoid:${boneName}:rotation`,
      kind: 'humanoidRotation',
      boneName,
    },
    valueKind: 'quaternion',
    times: [0, 1],
    values: [...rotation.toArray(), ...rotation.toArray()],
  })

  return {
    assetId,
    loop,
    durationSec: 1,
    tracks: [track],
    trackByChannelId: new Map([[track.channel.id, track]]),
  }
}
