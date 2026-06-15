import type { MotionRuntimeChannelId } from './motionRuntimeTypes'
import type {
  MotionMixerFeedback,
  MotionStimulusInstance,
} from './motionStimulusInstance'
import { createEmptyMotionRuntimePoseFrame } from './motionPoseFrame'
import type { MotionRuntimePoseFrame } from './motionPoseFrame'

export interface MotionRuntimeChannelWinner {
  channelId: MotionRuntimeChannelId
  instanceId: string
  priority: number
  requestedAtMs: number
}

export interface MotionMixerResult {
  winners: MotionRuntimeChannelWinner[]
  feedbackByInstanceId: Map<string, MotionMixerFeedback>
}

export interface MotionMixerPoseResult extends MotionMixerResult {
  poseFrame: MotionRuntimePoseFrame
}

export class MotionMixer {
  public resolveWinners(
    instances: MotionStimulusInstance[]
  ): MotionMixerResult {
    const candidateInstances = instances.filter(
      (instance) =>
        instance.slotId &&
        (instance.phase === 'active' ||
          instance.phase === 'suppressed' ||
          instance.phase === 'releasing')
    )
    const winnerByChannel = new Map<
      MotionRuntimeChannelId,
      MotionRuntimeChannelWinner
    >()

    for (const instance of candidateInstances) {
      for (const channelId of instance.channelIds) {
        const candidate = {
          channelId,
          instanceId: instance.instanceId,
          priority: instance.priorityByChannel[channelId] ?? 50,
          requestedAtMs: instance.requestedAtMs,
        }
        const current = winnerByChannel.get(channelId)
        if (!current || isCandidateWinner(candidate, current)) {
          winnerByChannel.set(channelId, candidate)
        }
      }
    }

    const activeByInstance = new Map<string, MotionRuntimeChannelId[]>()
    const suppressedByInstance = new Map<string, MotionRuntimeChannelId[]>()

    for (const instance of candidateInstances) {
      for (const channelId of instance.channelIds) {
        const winner = winnerByChannel.get(channelId)
        const bucket =
          winner?.instanceId === instance.instanceId
            ? activeByInstance
            : suppressedByInstance
        const channelIds = bucket.get(instance.instanceId) ?? []
        channelIds.push(channelId)
        bucket.set(instance.instanceId, channelIds)
      }
    }

    const feedbackByInstanceId = new Map<string, MotionMixerFeedback>()
    for (const instance of candidateInstances) {
      feedbackByInstanceId.set(instance.instanceId, {
        activeChannelIds: activeByInstance.get(instance.instanceId) ?? [],
        suppressedChannelIds:
          suppressedByInstance.get(instance.instanceId) ?? [],
      })
    }

    return {
      winners: [...winnerByChannel.values()],
      feedbackByInstanceId,
    }
  }

  public composePoseFrame(
    instances: MotionStimulusInstance[]
  ): MotionMixerPoseResult {
    const result = this.resolveWinners(instances)
    const instanceById = new Map(
      instances.map((instance) => [instance.instanceId, instance] as const)
    )
    const poseFrame = createEmptyMotionRuntimePoseFrame()

    for (const winner of result.winners) {
      const instance = instanceById.get(winner.instanceId)
      const sample = instance?.sampleChannel(winner.channelId)
      if (!sample) continue

      if (sample.value.kind === 'quaternion' && sample.value.quaternion) {
        poseFrame.humanoidRotations.set(
          sample.boneName,
          sample.value.quaternion
        )
      }

      if (sample.value.kind === 'vector3' && sample.value.vector) {
        poseFrame.humanoidTranslations.set(sample.boneName, sample.value.vector)
      }
    }

    return {
      ...result,
      poseFrame,
    }
  }
}

function isCandidateWinner(
  candidate: MotionRuntimeChannelWinner,
  current: MotionRuntimeChannelWinner
): boolean {
  if (candidate.priority !== current.priority) {
    return candidate.priority > current.priority
  }

  if (candidate.requestedAtMs !== current.requestedAtMs) {
    return candidate.requestedAtMs > current.requestedAtMs
  }

  return candidate.instanceId > current.instanceId
}
