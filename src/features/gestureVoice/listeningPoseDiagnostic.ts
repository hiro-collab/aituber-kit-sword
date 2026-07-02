export const PROJECTION_VISUAL_LISTENING_POSE_DIAGNOSTIC_EVENT =
  'projection-visual-listening-pose-diagnostic'
export const PROJECTION_VISUAL_LISTENING_POSE_DIAGNOSTIC_GLOBAL =
  '__projectionVisualListeningPoseDiagnostic'

export type ProjectionVisualListeningPoseStatus =
  | 'idle'
  | 'disabled'
  | 'unavailable'
  | 'requested'
  | 'applied'
  | 'reset'
  | 'failed'

export type ProjectionVisualListeningPoseReasonCode =
  | 'listening_pose_inactive'
  | 'listening_pose_disabled'
  | 'target_model_type_unavailable'
  | 'vrm_model_not_ready'
  | 'listening_pose_config_missing'
  | 'listening_pose_apply_requested'
  | 'listening_pose_applied'
  | 'listening_pose_reset_to_idle'
  | 'listening_pose_apply_failed'

export type ProjectionVisualListeningPoseDiagnostic = {
  source_kind: 'projection_visual_listening_pose_gate_v0'
  controller: 'message_input_container'
  status: ProjectionVisualListeningPoseStatus
  reason_code: ProjectionVisualListeningPoseReasonCode
  listening: boolean
  enabled: boolean
  target_model_type_class: 'vrm' | 'non_vrm' | 'unknown'
  pose_id_class: 'configured' | 'missing'
  model_ready: boolean
  pose_config_available: boolean
  safe_visible_state:
    | 'listening_pose_not_requested'
    | 'listening_pose_requested'
    | 'listening_pose_applied'
    | 'neutral_idle_requested'
    | 'no_visible_change'
  updatedAt: string
}

export type ProjectionVisualListeningPoseDiagnosticInput = Omit<
  ProjectionVisualListeningPoseDiagnostic,
  'source_kind' | 'updatedAt'
> & {
  updatedAt?: string
}

export const publishProjectionVisualListeningPoseDiagnostic = (
  input: ProjectionVisualListeningPoseDiagnosticInput
): ProjectionVisualListeningPoseDiagnostic => {
  const detail: ProjectionVisualListeningPoseDiagnostic = {
    source_kind: 'projection_visual_listening_pose_gate_v0',
    ...input,
    updatedAt: input.updatedAt ?? new Date().toISOString(),
  }

  if (typeof window !== 'undefined') {
    ;(window as any)[PROJECTION_VISUAL_LISTENING_POSE_DIAGNOSTIC_GLOBAL] =
      detail
    window.dispatchEvent(
      new CustomEvent(PROJECTION_VISUAL_LISTENING_POSE_DIAGNOSTIC_EVENT, {
        detail,
      })
    )
  }

  return detail
}
