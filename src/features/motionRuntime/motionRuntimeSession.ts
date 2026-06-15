import { MotionMixer } from './motionMixer'
import { MotionStimulusInstance } from './motionStimulusInstance'
import type { MotionRuntimeAsset } from './motionAsset'
import {
  createEmptyMotionRuntimePoseFrame,
  type MotionRuntimePoseFrame,
} from './motionPoseFrame'
import {
  DEFAULT_MOTION_RUNTIME_CONFIG,
  type MotionRuntimeConfig,
  type MotionRuntimeRequestFeedback,
  type MotionRuntimeSessionSnapshot,
  type MotionStimulusRequest,
} from './motionRuntimeTypes'

export interface MotionRuntimeSlot {
  slotId: string
  instanceId: string | null
}

export class MotionRuntimeSession {
  public readonly sessionId: string
  public readonly config: MotionRuntimeConfig

  private readonly mixer = new MotionMixer()
  private readonly slots: MotionRuntimeSlot[]
  private readonly instances = new Map<string, MotionStimulusInstance>()
  private readonly queuedInstanceIds: string[] = []
  private readonly pendingReplacementByInstanceId = new Map<string, string[]>()
  private lastPoseFrame: MotionRuntimePoseFrame =
    createEmptyMotionRuntimePoseFrame()
  private nextInstanceId = 1
  private lastTickMs: number | null = null

  public constructor(
    args: {
      sessionId?: string
      config?: Partial<MotionRuntimeConfig>
    } = {}
  ) {
    this.sessionId = args.sessionId ?? 'motion-session-1'
    this.config = { ...DEFAULT_MOTION_RUNTIME_CONFIG, ...args.config }
    this.slots = Array.from({ length: this.config.maxActiveSlots }, (_, i) => ({
      slotId: `slot_${i}`,
      instanceId: null,
    }))
  }

  public request(request: MotionStimulusRequest): MotionRuntimeRequestFeedback {
    const instance = new MotionStimulusInstance({
      instanceId: this.createInstanceId(),
      request,
      defaultReleaseDurationMs: this.config.defaultReleaseDurationMs,
    })
    this.instances.set(instance.instanceId, instance)

    if (request.interruptPolicy === 'ignore_if_busy') {
      const busy = this.findBusyInstances(request)
      if (busy.length > 0) {
        instance.kill('ignored_busy')
        return {
          accepted: false,
          instanceId: instance.instanceId,
          reasonCode: 'ignored_busy',
          replacedInstanceIds: [],
          pendingReplacementInstanceIds: [],
          queuedInstanceIds: [],
        }
      }
    }

    if (request.interruptPolicy === 'queue_same_group') {
      instance.markQueued('queued_same_group')
      this.queuedInstanceIds.push(instance.instanceId)
      return {
        accepted: true,
        instanceId: instance.instanceId,
        reasonCode: 'queued_same_group',
        replacedInstanceIds: [],
        pendingReplacementInstanceIds: [],
        queuedInstanceIds: [instance.instanceId],
      }
    }

    const replacementTargets =
      request.interruptPolicy === 'replace_same_group'
        ? this.findSameGroupInstanceIds(instance)
        : request.interruptPolicy === 'replace_same_track' ||
            !request.interruptPolicy
          ? this.findSameTrackInstanceIds(instance)
          : []

    if (request.requiresAsset) {
      if (replacementTargets.length > 0) {
        this.pendingReplacementByInstanceId.set(
          instance.instanceId,
          replacementTargets
        )
      }
      return {
        accepted: true,
        instanceId: instance.instanceId,
        reasonCode: 'loading_asset',
        replacedInstanceIds: [],
        pendingReplacementInstanceIds: replacementTargets,
        queuedInstanceIds: [],
      }
    }

    instance.markReady('asset_ready')
    const replacedInstanceIds = this.releaseInstances(
      replacementTargets,
      request.requestedAtMs,
      request.interruptPolicy === 'replace_same_group'
        ? 'replace_same_group'
        : 'replace_same_track'
    )

    return {
      accepted: true,
      instanceId: instance.instanceId,
      reasonCode: 'accepted',
      replacedInstanceIds,
      pendingReplacementInstanceIds: [],
      queuedInstanceIds: [],
    }
  }

  public markReady(instanceId: string, nowMs?: number): void {
    this.instances.get(instanceId)?.markReady()
    this.releasePendingReplacements(instanceId, nowMs)
  }

  public attachMotionAsset(
    instanceId: string,
    asset: MotionRuntimeAsset,
    nowMs?: number
  ): void {
    const instance = this.instances.get(instanceId)
    if (!instance) return
    instance.attachMotionAsset(asset)
    instance.markReady('asset_ready')
    this.releasePendingReplacements(instanceId, nowMs)
  }

  public releaseGroup(
    groupKey: string,
    nowMs: number,
    reasonCode = 'group_release_requested'
  ): string[] {
    const matchingInstanceIds = [...this.instances.values()]
      .filter(
        (instance) =>
          instance.groupKey === groupKey &&
          instance.phase !== 'completed' &&
          instance.phase !== 'killed'
      )
      .map((instance) => instance.instanceId)

    return this.releaseInstances(matchingInstanceIds, nowMs, reasonCode)
  }

  public tick(nowMs: number): void {
    const deltaMs =
      this.lastTickMs === null ? 0 : Math.max(0, nowMs - this.lastTickMs)
    this.lastTickMs = nowMs

    this.promoteReadyInstances(nowMs)
    this.promoteQueuedInstances(nowMs)

    for (const instance of this.instances.values()) {
      instance.advance(nowMs, deltaMs)
    }

    const mixerResult = this.mixer.composePoseFrame([
      ...this.instances.values(),
    ])
    this.lastPoseFrame = mixerResult.poseFrame
    for (const [instanceId, feedback] of mixerResult.feedbackByInstanceId) {
      this.instances.get(instanceId)?.applyMixerFeedback(feedback)
    }

    this.collectCompleted()
  }

  public getLastPoseFrame(): MotionRuntimePoseFrame {
    return this.lastPoseFrame
  }

  public snapshot(): MotionRuntimeSessionSnapshot {
    return {
      sessionId: this.sessionId,
      maxActiveSlots: this.config.maxActiveSlots,
      occupiedSlots: this.slots.filter((slot) => slot.instanceId).length,
      instances: [...this.instances.values()].map((instance) =>
        instance.snapshot()
      ),
      queueLength: this.queuedInstanceIds.length,
    }
  }

  private promoteReadyInstances(nowMs: number): void {
    for (const instance of this.instances.values()) {
      if (instance.phase !== 'ready' || instance.slotId) continue
      const slot = this.slots.find((candidate) => candidate.instanceId === null)
      if (!slot) {
        instance.markQueued('capacity_wait')
        this.queuedInstanceIds.push(instance.instanceId)
        continue
      }
      slot.instanceId = instance.instanceId
      instance.assignSlot(slot.slotId, nowMs)
    }
  }

  private promoteQueuedInstances(nowMs: number): void {
    for (const instanceId of [...this.queuedInstanceIds]) {
      const instance = this.instances.get(instanceId)
      if (!instance || instance.phase !== 'queued') {
        this.removeQueuedInstance(instanceId)
        continue
      }
      const slot = this.slots.find((candidate) => candidate.instanceId === null)
      if (!slot) return
      this.removeQueuedInstance(instanceId)
      instance.markReady('queue_promoted')
      slot.instanceId = instance.instanceId
      instance.assignSlot(slot.slotId, nowMs)
    }
  }

  private collectCompleted(): void {
    for (const instance of this.instances.values()) {
      if (instance.phase !== 'completed' && instance.phase !== 'killed') {
        continue
      }
      for (const slot of this.slots) {
        if (slot.instanceId === instance.instanceId) {
          slot.instanceId = null
        }
      }
      this.removeQueuedInstance(instance.instanceId)
    }
  }

  private findSameGroupInstanceIds(
    newInstance: MotionStimulusInstance
  ): string[] {
    if (!newInstance.groupKey) return []
    const instanceIds: string[] = []
    for (const instance of this.instances.values()) {
      if (
        instance.instanceId !== newInstance.instanceId &&
        instance.groupKey === newInstance.groupKey &&
        instance.phase !== 'completed' &&
        instance.phase !== 'killed'
      ) {
        instanceIds.push(instance.instanceId)
      }
    }
    return instanceIds
  }

  private findSameTrackInstanceIds(
    newInstance: MotionStimulusInstance
  ): string[] {
    const instanceIds: string[] = []
    for (const instance of this.instances.values()) {
      if (
        instance.instanceId !== newInstance.instanceId &&
        instance.overlapsChannels(newInstance.channelIds) &&
        instance.phase !== 'completed' &&
        instance.phase !== 'killed'
      ) {
        instanceIds.push(instance.instanceId)
      }
    }
    return instanceIds
  }

  private releaseInstances(
    instanceIds: string[],
    nowMs: number,
    reasonCode: string
  ): string[] {
    const released: string[] = []
    for (const instanceId of instanceIds) {
      const instance = this.instances.get(instanceId)
      if (!instance) continue
      instance.startRelease(nowMs, reasonCode)
      released.push(instance.instanceId)
    }
    return released
  }

  private releasePendingReplacements(instanceId: string, nowMs?: number): void {
    const pending = this.pendingReplacementByInstanceId.get(instanceId)
    if (!pending) return
    const instance = this.instances.get(instanceId)
    this.releaseInstances(
      pending,
      nowMs ?? instance?.requestedAtMs ?? 0,
      'replace_handoff_ready'
    )
    this.pendingReplacementByInstanceId.delete(instanceId)
  }

  private findBusyInstances(
    request: MotionStimulusRequest
  ): MotionStimulusInstance[] {
    return [...this.instances.values()].filter(
      (instance) =>
        instance.phase !== 'completed' &&
        instance.phase !== 'killed' &&
        ((request.groupKey && instance.groupKey === request.groupKey) ||
          instance.overlapsChannels(request.channelIds))
    )
  }

  private removeQueuedInstance(instanceId: string): void {
    const index = this.queuedInstanceIds.indexOf(instanceId)
    if (index !== -1) this.queuedInstanceIds.splice(index, 1)
  }

  private createInstanceId(): string {
    return `mot_inst_local_${this.nextInstanceId++}`
  }
}
