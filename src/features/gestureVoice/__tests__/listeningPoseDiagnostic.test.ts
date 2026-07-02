/**
 * @jest-environment jsdom
 */

import {
  PROJECTION_VISUAL_LISTENING_POSE_DIAGNOSTIC_EVENT,
  PROJECTION_VISUAL_LISTENING_POSE_DIAGNOSTIC_GLOBAL,
  publishProjectionVisualListeningPoseDiagnostic,
} from '../listeningPoseDiagnostic'

describe('Projection Visual listening pose diagnostics', () => {
  beforeEach(() => {
    delete (window as any)[PROJECTION_VISUAL_LISTENING_POSE_DIAGNOSTIC_GLOBAL]
  })

  it('publishes class-coded listening pose gate status without raw pose or path values', () => {
    const listener = jest.fn()
    window.addEventListener(
      PROJECTION_VISUAL_LISTENING_POSE_DIAGNOSTIC_EVENT,
      listener
    )

    const detail = publishProjectionVisualListeningPoseDiagnostic({
      controller: 'message_input_container',
      status: 'unavailable',
      reason_code: 'listening_pose_config_missing',
      listening: true,
      enabled: true,
      target_model_type_class: 'vrm',
      pose_id_class: 'configured',
      model_ready: true,
      pose_config_available: false,
      safe_visible_state: 'no_visible_change',
      updatedAt: '2026-06-27T00:00:00.000Z',
    })

    expect(
      (window as any)[PROJECTION_VISUAL_LISTENING_POSE_DIAGNOSTIC_GLOBAL]
    ).toEqual(detail)
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({
        detail,
      })
    )
    expect(JSON.stringify(detail)).not.toContain('/local-vrma/')
    expect(JSON.stringify(detail)).not.toContain('listeningPoseId')
  })
})
