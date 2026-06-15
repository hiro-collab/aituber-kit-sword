export type GestureVoiceExpectedGate = 'open' | 'closed'
export type GestureVoiceProofResult = 'pass' | 'fail'
export type GestureVoiceProofScope =
  | 'projection_bridge_contract'
  | 'upstream_false_positive_propagation'
export type GestureVoiceProofCaseType =
  | 'actual_victory_replay_or_camera_hub_negative_proof'
  | 'synthetic_positive_signal'
  | 'synthetic_negative_signal'
  | 'upstream_false_positive_propagation_test'
export type GestureVoiceInputMode = 'synthetic_redacted_gesture_state'

export type GestureVoiceProofCase = {
  case_id: string
  asset_id: string
  proof_scope: GestureVoiceProofScope
  proof_case_type: GestureVoiceProofCaseType
  input_mode: GestureVoiceInputMode
  expected_gate: GestureVoiceExpectedGate
  fixture_expected_gate: GestureVoiceExpectedGate
}

export type GestureVoiceProofEvaluation = {
  proof_scope?: GestureVoiceProofScope
  proof_case_type?: GestureVoiceProofCaseType
  input_mode?: GestureVoiceInputMode
  expected_gate: GestureVoiceExpectedGate
  fixture_expected_gate: GestureVoiceExpectedGate
  observed_event_names: string[]
  gesture_start_request_observed: boolean
  gesture_start_result_observed: boolean
  result: GestureVoiceProofResult
  fixture_result: GestureVoiceProofResult
}

export const RR003_GESTURE_VOICE_CASES: GestureVoiceProofCase[] = [
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
]

export const evaluateGestureVoiceProof = (
  expected_gate: GestureVoiceExpectedGate,
  observed_event_names: string[],
  options: {
    fixture_expected_gate?: GestureVoiceExpectedGate
    proof_scope?: GestureVoiceProofScope
    proof_case_type?: GestureVoiceProofCaseType
    input_mode?: GestureVoiceInputMode
  } = {}
): GestureVoiceProofEvaluation => {
  const fixture_expected_gate = options.fixture_expected_gate ?? expected_gate
  const gesture_start_request_observed = observed_event_names.includes(
    'gesture_start_request'
  )
  const gesture_start_result_observed = observed_event_names.includes(
    'gesture_start_result'
  )
  const opened =
    gesture_start_request_observed && gesture_start_result_observed
  const matched = expected_gate === 'open' ? opened : !opened
  const fixtureMatched =
    fixture_expected_gate === 'open' ? opened : !opened

  return {
    proof_scope: options.proof_scope,
    proof_case_type: options.proof_case_type,
    input_mode: options.input_mode,
    expected_gate,
    fixture_expected_gate,
    observed_event_names,
    gesture_start_request_observed,
    gesture_start_result_observed,
    result: matched ? 'pass' : 'fail',
    fixture_result: fixtureMatched ? 'pass' : 'fail',
  }
}
