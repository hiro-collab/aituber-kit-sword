import type { VRMHumanBoneName } from '@pixiv/three-vrm'
import type { VRMAnimation } from '@/lib/VRMAnimation/VRMAnimation'
import {
  createHumanoidRotationChannelId,
  createHumanoidTranslationChannelId,
} from './motionChannels'
import { MotionRuntimeCompiledTrack } from './motionTrackSampler'
import type { MotionRuntimeChannelDesc } from './motionRuntimeTypes'

export interface MotionRuntimeAsset {
  assetId: string
  loop: boolean
  durationSec: number
  tracks: MotionRuntimeCompiledTrack[]
  trackByChannelId: Map<string, MotionRuntimeCompiledTrack>
}

export interface CompileVRMAnimationOptions {
  assetId?: string
  includeHipsTranslation?: boolean
  loop?: boolean
}

export function compileVRMAnimationToMotionRuntimeAsset(
  vrmAnimation: VRMAnimation,
  options: CompileVRMAnimationOptions = {}
): MotionRuntimeAsset {
  const tracks: MotionRuntimeCompiledTrack[] = []

  for (const [boneName, track] of vrmAnimation.humanoidTracks.rotation) {
    tracks.push(
      new MotionRuntimeCompiledTrack({
        channel: createHumanoidChannel(
          createHumanoidRotationChannelId(boneName),
          'humanoidRotation',
          boneName
        ),
        valueKind: 'quaternion',
        times: track.times,
        values: track.values,
        loop: options.loop,
      })
    )
  }

  if (options.includeHipsTranslation) {
    const hipsTrack = vrmAnimation.humanoidTracks.translation.get(
      'hips' as VRMHumanBoneName
    )
    if (hipsTrack) {
      tracks.push(
        new MotionRuntimeCompiledTrack({
          channel: createHumanoidChannel(
            createHumanoidTranslationChannelId('hips'),
            'humanoidTranslation',
            'hips'
          ),
          valueKind: 'vector3',
          times: hipsTrack.times,
          values: hipsTrack.values,
          loop: options.loop,
        })
      )
    }
  }

  return {
    assetId: options.assetId ?? 'motion_asset_local',
    loop: options.loop ?? false,
    durationSec: vrmAnimation.duration,
    tracks,
    trackByChannelId: new Map(
      tracks.map((track) => [track.channel.id, track] as const)
    ),
  }
}

function createHumanoidChannel(
  id: string,
  kind: MotionRuntimeChannelDesc['kind'],
  boneName: string
): MotionRuntimeChannelDesc {
  return { id, kind, boneName }
}
