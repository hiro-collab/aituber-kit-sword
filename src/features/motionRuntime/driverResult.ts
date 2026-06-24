import {
  MOTION_CAPABILITY_PROFILE_VERSION,
  type MotionCapabilityState,
} from './motionCapabilityProfile'

export type MotionDriverPart = 'expression' | 'gaze' | 'reset'

export type MotionDriverResultStatus =
  | 'applied'
  | 'degraded'
  | 'unavailable'
  | 'incompatible'
  | 'fallback_used'
  | 'stopped'
  | 'failed_safe'

export type MotionDriverObservationPoint =
  | 'apply_frame'
  | 'post_vrm_update_pre_render'

export type SafeVisibleState =
  | 'no_visible_change'
  | 'expression_changed'
  | 'gaze_target_changed'
  | 'neutral_idle_requested'
  | 'unknown'

export type FrameCountBucket =
  | 'single_frame'
  | '2_to_5_frames'
  | '6_to_30_frames'
  | '31_plus_frames'
  | 'unknown'

export interface MotionDriverPartResult {
  part: MotionDriverPart
  result: MotionDriverResultStatus
  capability: MotionCapabilityState
  reason_code: string
  safe_visible_state: SafeVisibleState
  requested_channel_count?: number
  applied_channel_count?: number
  dropped_channel_count?: number
  applied_channel_names?: string[]
  dropped_channel_names?: string[]
}

export interface MotionDriverResult {
  driver_result_id: string
  stimulus_instance_id?: string
  result: MotionDriverResultStatus
  safe_visible_state: SafeVisibleState
  capability_profile_version: string
  per_part_results: MotionDriverPartResult[]
  reason_code: string
  frame_count_bucket: FrameCountBucket
  observed_at: MotionDriverObservationPoint
}

let nextDriverResultId = 1

export function bucketFrameCount(frameCount?: number): FrameCountBucket {
  if (typeof frameCount !== 'number' || !Number.isFinite(frameCount)) {
    return 'unknown'
  }
  if (frameCount <= 1) return 'single_frame'
  if (frameCount <= 5) return '2_to_5_frames'
  if (frameCount <= 30) return '6_to_30_frames'
  return '31_plus_frames'
}

export function createMotionDriverResult(args: {
  stimulusInstanceId?: string
  perPartResults: MotionDriverPartResult[]
  frameCount?: number
  observedAt?: MotionDriverObservationPoint
}): MotionDriverResult {
  const result = summarizePartResults(args.perPartResults)

  return {
    driver_result_id: `driver-result-${nextDriverResultId++}`,
    stimulus_instance_id: args.stimulusInstanceId,
    result,
    safe_visible_state: summarizeSafeVisibleState(args.perPartResults),
    capability_profile_version: MOTION_CAPABILITY_PROFILE_VERSION,
    per_part_results: args.perPartResults,
    reason_code: summarizeReasonCode(result, args.perPartResults),
    frame_count_bucket: bucketFrameCount(args.frameCount),
    observed_at: args.observedAt ?? 'apply_frame',
  }
}

export function finalizeMotionDriverResult(
  result: MotionDriverResult
): MotionDriverResult {
  return {
    ...result,
    observed_at: 'post_vrm_update_pre_render',
  }
}

function summarizePartResults(
  partResults: MotionDriverPartResult[]
): MotionDriverResultStatus {
  const statuses = partResults.map((partResult) => partResult.result)
  if (statuses.includes('failed_safe')) return 'failed_safe'
  if (statuses.includes('incompatible')) return 'incompatible'
  if (statuses.includes('unavailable')) return 'unavailable'
  if (statuses.includes('degraded')) return 'degraded'
  if (statuses.includes('fallback_used')) return 'fallback_used'
  if (statuses.includes('stopped')) return 'stopped'
  return 'applied'
}

function summarizeSafeVisibleState(
  partResults: MotionDriverPartResult[]
): SafeVisibleState {
  if (partResults.some((partResult) => partResult.part === 'reset')) {
    return 'neutral_idle_requested'
  }
  if (partResults.some((partResult) => partResult.part === 'gaze')) {
    return 'gaze_target_changed'
  }
  if (
    partResults.some(
      (partResult) =>
        partResult.part === 'expression' &&
        partResult.safe_visible_state === 'expression_changed'
    )
  ) {
    return 'expression_changed'
  }
  if (
    partResults.some(
      (partResult) => partResult.safe_visible_state === 'unknown'
    )
  ) {
    return 'unknown'
  }
  return 'no_visible_change'
}

function summarizeReasonCode(
  result: MotionDriverResultStatus,
  partResults: MotionDriverPartResult[]
): string {
  if (partResults.length === 0) return 'no_motion_request'
  const firstNonApplied = partResults.find(
    (partResult) => partResult.result !== 'applied'
  )
  return firstNonApplied?.reason_code ?? `motion_driver_${result}`
}
