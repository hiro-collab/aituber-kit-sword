import { type MotionRuntimeAsset } from './motionAsset'
import {
  type MotionRuntimeChannelId,
  type MotionRuntimeInterruptPolicy,
  type MotionRuntimePhase,
  type MotionRuntimeSuppressionClock,
  type MotionStimulusInstanceSnapshot,
  type MotionStimulusRequest,
} from './motionRuntimeTypes'
import type { MotionRuntimeSampledValue } from './motionTrackSampler'

export interface MotionStimulusInstanceArgs {
  instanceId: string
  request: MotionStimulusRequest
  defaultReleaseDurationMs: number
}

export interface MotionMixerFeedback {
  activeChannelIds: MotionRuntimeChannelId[]
  suppressedChannelIds: MotionRuntimeChannelId[]
}

export interface MotionStimulusChannelSample {
  channelId: MotionRuntimeChannelId
  boneName: string
  value: MotionRuntimeSampledValue
}

export class MotionStimulusInstance {
  public readonly instanceId: string
  public readonly stimulusId: string
  public readonly requestedAtMs: number
  public readonly groupKey?: string
  public readonly channelIds: MotionRuntimeChannelId[]
  public readonly priorityByChannel: Record<MotionRuntimeChannelId, number>
  public readonly interruptPolicy: MotionRuntimeInterruptPolicy
  public readonly suppressionClock: MotionRuntimeSuppressionClock
  public readonly releaseDurationMs: number
  public durationMs: number

  public phase: MotionRuntimePhase = 'loading'
  public slotId: string | null = null
  public startedAtMs: number | null = null
  public localTimeMs = 0
  public releaseStartedAtMs: number | null = null
  public activeChannelIds: MotionRuntimeChannelId[] = []
  public suppressedChannelIds: MotionRuntimeChannelId[] = []
  public reasonCode = 'instance_created'
  public motionAsset: MotionRuntimeAsset | null = null

  public constructor(args: MotionStimulusInstanceArgs) {
    const { request } = args
    this.instanceId = args.instanceId
    this.stimulusId = request.stimulusId
    this.requestedAtMs = request.requestedAtMs
    this.groupKey = request.groupKey
    this.channelIds = [...new Set(request.channelIds)]
    this.priorityByChannel = Object.fromEntries(
      this.channelIds.map((channelId) => [
        channelId,
        request.priorityByChannel?.[channelId] ?? 50,
      ])
    )
    this.interruptPolicy = request.interruptPolicy ?? 'replace_same_track'
    this.suppressionClock = request.suppressionClock ?? 'pause'
    this.durationMs = request.durationMs ?? 0
    this.releaseDurationMs =
      request.releaseDurationMs ?? args.defaultReleaseDurationMs
  }

  public markQueued(reasonCode = 'queued'): void {
    this.phase = 'queued'
    this.reasonCode = reasonCode
  }

  public markReady(reasonCode = 'asset_ready'): void {
    if (this.phase === 'killed' || this.phase === 'completed') return
    this.phase = 'ready'
    this.reasonCode = reasonCode
  }

  public attachMotionAsset(asset: MotionRuntimeAsset): void {
    this.motionAsset = asset
    if (!asset.loop && this.durationMs <= 0 && asset.durationSec > 0) {
      this.durationMs = asset.durationSec * 1000
    }
  }

  public assignSlot(slotId: string, nowMs: number): void {
    this.slotId = slotId
    this.startedAtMs ??= nowMs
    this.phase = 'active'
    this.reasonCode = 'slot_assigned'
  }

  public startRelease(nowMs: number, reasonCode = 'release_requested'): void {
    if (this.phase === 'completed' || this.phase === 'killed') return
    this.phase = 'releasing'
    this.releaseStartedAtMs ??= nowMs
    this.reasonCode = reasonCode
  }

  public kill(reasonCode = 'killed'): void {
    this.phase = 'killed'
    this.slotId = null
    this.reasonCode = reasonCode
  }

  public advance(nowMs: number, deltaMs: number): void {
    if (this.phase === 'active' || this.phase === 'releasing') {
      this.localTimeMs += Math.max(0, deltaMs)
    } else if (
      this.phase === 'suppressed' &&
      this.suppressionClock === 'advance'
    ) {
      this.localTimeMs += Math.max(0, deltaMs)
    }

    if (
      this.durationMs > 0 &&
      this.localTimeMs >= this.durationMs &&
      this.phase !== 'releasing' &&
      this.phase !== 'completed' &&
      this.phase !== 'killed'
    ) {
      this.startRelease(nowMs, 'duration_elapsed')
    }

    if (
      this.phase === 'releasing' &&
      this.releaseStartedAtMs !== null &&
      nowMs - this.releaseStartedAtMs >= this.releaseDurationMs
    ) {
      this.phase = 'completed'
      this.slotId = null
      this.reasonCode = 'release_completed'
    }
  }

  public applyMixerFeedback(feedback: MotionMixerFeedback): void {
    this.activeChannelIds = feedback.activeChannelIds
    this.suppressedChannelIds = feedback.suppressedChannelIds

    if (this.phase === 'active' || this.phase === 'suppressed') {
      this.phase =
        feedback.activeChannelIds.length > 0 ? 'active' : 'suppressed'
      this.reasonCode =
        feedback.activeChannelIds.length > 0
          ? 'channels_active'
          : 'channels_suppressed'
    }
  }

  public overlapsChannels(channelIds: MotionRuntimeChannelId[]): boolean {
    const current = new Set(this.channelIds)
    return channelIds.some((channelId) => current.has(channelId))
  }

  public sampleChannel(
    channelId: MotionRuntimeChannelId
  ): MotionStimulusChannelSample | null {
    const track = this.motionAsset?.trackByChannelId.get(channelId)
    if (!track) return null
    return {
      channelId,
      boneName: track.channel.boneName,
      value: track.sample(this.localTimeMs / 1000),
    }
  }

  public snapshot(): MotionStimulusInstanceSnapshot {
    return {
      instanceId: this.instanceId,
      stimulusId: this.stimulusId,
      slotId: this.slotId,
      groupKey: this.groupKey,
      phase: this.phase,
      requestedAtMs: this.requestedAtMs,
      startedAtMs: this.startedAtMs,
      localTimeMs: this.localTimeMs,
      channelIds: this.channelIds,
      activeChannelIds: this.activeChannelIds,
      suppressedChannelIds: this.suppressedChannelIds,
      interruptPolicy: this.interruptPolicy,
      suppressionClock: this.suppressionClock,
      reasonCode: this.reasonCode,
    }
  }
}
