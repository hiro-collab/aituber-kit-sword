import {
  RR003_GESTURE_VOICE_CASES,
  evaluateGestureVoiceProof,
} from '@/features/gestureVoice/gestureVoiceProof'

describe('RR003 gesture voice proof evaluation', () => {
  it('keeps the RR003 sword/victory/open-hand gate expectations explicit', () => {
    expect(RR003_GESTURE_VOICE_CASES).toEqual([
      {
        case_id: 'sword-positive',
        asset_id: 'gesture.sword.20260603',
        proof_scope: 'projection_bridge_contract',
        proof_case_type: 'synthetic_positive_signal',
        input_mode: 'synthetic_redacted_gesture_state',
        expected_gate: 'open',
        fixture_expected_gate: 'open',
      },
      {
        case_id: 'victory-upstream-false-positive-propagation',
        asset_id: 'gesture.victory.20260603',
        proof_scope: 'upstream_false_positive_propagation',
        proof_case_type: 'upstream_false_positive_propagation_test',
        input_mode: 'synthetic_redacted_gesture_state',
        expected_gate: 'open',
        fixture_expected_gate: 'closed',
      },
      {
        case_id: 'open-hand-negative',
        asset_id: 'gesture.open_hand.20260603',
        proof_scope: 'projection_bridge_contract',
        proof_case_type: 'synthetic_negative_signal',
        input_mode: 'synthetic_redacted_gesture_state',
        expected_gate: 'closed',
        fixture_expected_gate: 'closed',
      },
    ])
  })

  it('passes the positive sword case only when request and result are observed', () => {
    expect(
      evaluateGestureVoiceProof('open', [
        'gesture_ws_open',
        'gesture_start_request',
        'gesture_start_result',
      ])
    ).toMatchObject({
      gesture_start_request_observed: true,
      gesture_start_result_observed: true,
      result: 'pass',
      fixture_result: 'pass',
    })

    expect(evaluateGestureVoiceProof('open', ['gesture_ws_open'])).toMatchObject(
      {
        gesture_start_request_observed: false,
        gesture_start_result_observed: false,
        result: 'fail',
        fixture_result: 'fail',
      }
    )
  })

  it('fails negative victory/open-hand cases when a start request/result is observed', () => {
    expect(
      evaluateGestureVoiceProof('closed', [
        'gesture_ws_open',
        'gesture_start_request',
        'gesture_start_result',
      ])
    ).toMatchObject({
      gesture_start_request_observed: true,
      gesture_start_result_observed: true,
      result: 'fail',
      fixture_result: 'fail',
    })

    expect(evaluateGestureVoiceProof('closed', ['gesture_ws_open'])).toMatchObject(
      {
        gesture_start_request_observed: false,
        gesture_start_result_observed: false,
        result: 'pass',
        fixture_result: 'pass',
      }
    )
  })

  it('separates upstream false-positive propagation from victory negative fixture proof', () => {
    expect(
      evaluateGestureVoiceProof(
        'open',
        [
          'gesture_ws_open',
          'gesture_start_request',
          'gesture_start_result',
        ],
        {
          proof_scope: 'upstream_false_positive_propagation',
          proof_case_type: 'upstream_false_positive_propagation_test',
          input_mode: 'synthetic_redacted_gesture_state',
          fixture_expected_gate: 'closed',
        }
      )
    ).toMatchObject({
      proof_scope: 'upstream_false_positive_propagation',
      proof_case_type: 'upstream_false_positive_propagation_test',
      input_mode: 'synthetic_redacted_gesture_state',
      expected_gate: 'open',
      fixture_expected_gate: 'closed',
      result: 'pass',
      fixture_result: 'fail',
    })
  })
})
