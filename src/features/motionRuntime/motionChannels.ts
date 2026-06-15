import type { MotionRuntimeChannelId } from './motionRuntimeTypes'

export function createHumanoidRotationChannelId(
  boneName: string
): MotionRuntimeChannelId {
  return `humanoid:${boneName}:rotation`
}

export function createHumanoidTranslationChannelId(
  boneName: string
): MotionRuntimeChannelId {
  return `humanoid:${boneName}:translation`
}

export function parseHumanoidChannelId(channelId: MotionRuntimeChannelId): {
  kind: 'rotation' | 'translation'
  boneName: string
} | null {
  const match = /^humanoid:([^:]+):(rotation|translation)$/.exec(channelId)
  if (!match) return null
  return {
    boneName: match[1],
    kind: match[2] as 'rotation' | 'translation',
  }
}
