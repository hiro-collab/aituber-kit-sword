export type MotionRuntimePhase =
  | 'loading'
  | 'queued'
  | 'ready'
  | 'active'
  | 'suppressed'
  | 'releasing'
  | 'completed'
  | 'killed'

export type MotionRuntimeInterruptPolicy =
  | 'replace_same_group'
  | 'replace_same_track'
  | 'queue_same_group'
  | 'coexist'
  | 'ignore_if_busy'
  | 'stop'

export type MotionRuntimeSuppressionClock = 'pause' | 'advance'

export type MotionRuntimeChannelKind =
  | 'humanoidRotation'
  | 'humanoidTranslation'

export type MotionRuntimeChannelId = string

export interface MotionRuntimeChannelDesc {
  id: MotionRuntimeChannelId
  kind: MotionRuntimeChannelKind
  boneName: string
}

export interface MotionRuntimeConfig {
  maxActiveSlots: number
  maxQueuedRequests: number
  defaultReleaseDurationMs: number
}

export const DEFAULT_MOTION_RUNTIME_CONFIG: MotionRuntimeConfig = {
  maxActiveSlots: 8,
  maxQueuedRequests: 16,
  defaultReleaseDurationMs: 400,
}

export interface MotionStimulusRequest {
  stimulusId: string
  requestedAtMs: number
  groupKey?: string
  channelIds: MotionRuntimeChannelId[]
  priorityByChannel?: Partial<Record<MotionRuntimeChannelId, number>>
  interruptPolicy?: MotionRuntimeInterruptPolicy
  suppressionClock?: MotionRuntimeSuppressionClock
  durationMs?: number
  releaseDurationMs?: number
  requiresAsset?: boolean
}

export interface MotionStimulusInstanceSnapshot {
  instanceId: string
  stimulusId: string
  slotId: string | null
  groupKey?: string
  phase: MotionRuntimePhase
  requestedAtMs: number
  startedAtMs: number | null
  localTimeMs: number
  channelIds: MotionRuntimeChannelId[]
  activeChannelIds: MotionRuntimeChannelId[]
  suppressedChannelIds: MotionRuntimeChannelId[]
  interruptPolicy: MotionRuntimeInterruptPolicy
  suppressionClock: MotionRuntimeSuppressionClock
  reasonCode: string
}

export interface MotionRuntimeRequestFeedback {
  accepted: boolean
  instanceId?: string
  reasonCode: string
  replacedInstanceIds: string[]
  pendingReplacementInstanceIds: string[]
  queuedInstanceIds: string[]
}

export interface MotionRuntimeSessionSnapshot {
  sessionId: string
  maxActiveSlots: number
  occupiedSlots: number
  instances: MotionStimulusInstanceSnapshot[]
  queueLength: number
}
