import { CONVERSATION_ATTEMPT_REF_PATTERN } from '@/utils/speechOutputParitySummary'

export const PREPARED_SAMPLE_ATTEMPT_COUNT = 5
export const PREPARED_SAMPLE_ATTEMPT_TIMEOUT_MS = 10_000

export type PreparedSampleTextPublication = {
  textPublicationPolicy: 'prepared_sample_text_allowed'
  textProvenanceClass: 'prepared_local_sample_set'
}

export type PreparedSampleIndexPreflight = {
  sampleIndexPreflightClass: 'prepared_sample_index_verified'
  sampleIndexPreflightRef: string
}

export type PreparedSampleAttempt = {
  attemptNumber: number
  resultEventCount: number
  finalResultCount: number
  contentMatchClass:
    | 'matched'
    | 'mismatch'
    | 'missing_final_result'
    | 'timed_out'
  stopClass:
    | 'final_result_recorded'
    | 'missing_final_result'
    | 'attempt_timeout'
  recognizedText: string
}

export type PreparedSampleRun = {
  conversationAttemptRef: string
  selectedSampleId: string
  sampleIndexPreflight: PreparedSampleIndexPreflight
  expectedText: string
  textPublication: PreparedSampleTextPublication
  attempts: PreparedSampleAttempt[]
}

export type PreparedSampleRunSummary = {
  boundedAttemptCount: number
  resultEventCount: number
  finalResultCount: number
  contentMatchStabilityClass:
    | 'stable_positive'
    | 'incomplete_attempt_set'
    | 'final_result_not_observed'
    | 'content_match_not_stable'
  blockerClass: string | null
}

export type AcceptedPreparedSampleSpeechEnvelope = {
  accepted_user_speech_candidate: {
    schema_version: 'accepted_user_speech_candidate_input_gate.v0'
    candidate_id: string
    generated_at: string
    proof_layer: 'source_static_contract_test_only'
    route_id: 'ACCEPTED-USER-SPEECH-CANDIDATE-INPUT-GATE-THOUGHT-CORE-CONTRACT-RR00301-SOURCE-STATIC-02'
    candidate_route: 'prepared_sample_browser_stt'
    source_kind: 'prepared_local_audio_sample'
    speaker_role: 'user_candidate'
    recognition_summary: {
      source_label: string
      recognition_summary_ref: string
      recognition_summary_class: 'stable_browser_stt_prepared_sample'
      recognized_text_class: 'absent'
      recognized_text_length_bucket: 'none'
      language_bucket: 'ja'
      confidence_bucket: 'high'
      raw_text_in_shared_artifact: false
    }
    text_publication: {
      text_publication_policy: 'text_redacted_or_absent'
      text_provenance_class: 'redacted_or_absent'
      expected_sample_text: null
      recognized_text: null
      content_match_text: null
      non_sample_or_live_text_policy: 'protected_or_redacted'
    }
    self_output_context: {
      self_output_correlation_class: 'not_self_output'
      session_join_class: 'same_session_not_self_output'
      bubble_tts_parity_class: 'not_authority_for_user_speech'
      bubble_or_tts_as_user_speech_authority: false
    }
    input_gate: {
      input_gate_decision_owner: 'ai_talk_core_input_gate'
      input_gate_decision_class: 'accepted_user_speech_candidate'
      normal_turn_block_reason: null
    }
    acceptance_decision: {
      acceptance_status: 'accepted_user_speech_candidate'
      may_materialize_thought_core_turninput: true
      private_text_handoff_required: true
      shared_artifact_contains_text: false
      thought_core_turninput_materialized: false
      thought_core_turninput_count: 0
      thought_core_turninput_ref: null
      turn_materialization_route: 'separate_private_runtime_handoff_required'
    }
    redaction_guards: {
      raw_audio_included: false
      raw_media_included: false
      raw_transcript_included: false
      raw_recognized_text_included: false
      private_path_included: false
      provider_payload_included: false
      browser_storage_included: false
      token_or_secret_included: false
      home_control_action_authority_included: false
    }
    non_claims: [
      'not_audio_capture',
      'not_user_heard_proof',
      'not_home_control_action',
      'not_touchdesigner_action',
      'not_source_git_adoption',
      'not_readiness_or_rr003_pass',
    ]
    raw_private_publication_flags: false
  }
  private_turn: {
    text: string
    turn_id: string
    session_id: 'prepared_sample_browser_stt_operator'
    locale: 'ja-JP'
    context_refs: {
      conversation_attempt_ref: string
    }
  }
}

const OPAQUE_REF_PATTERN = /^[a-z][a-z0-9_.:-]{2,127}$/
const PREPARED_SAMPLE_ID_PATTERN = /^[a-z][a-z0-9_.-]{2,127}$/
const MAX_PRIVATE_TURN_TEXT_LENGTH = 4_000

const normalizePreparedSampleText = (text: string): string =>
  text
    .normalize('NFKC')
    .toLocaleLowerCase('ja-JP')
    .replace(/[\s\p{P}\p{S}]/gu, '')

const assertOpaqueRef = (value: string, label: string) => {
  if (!OPAQUE_REF_PATTERN.test(value)) {
    throw new Error(`${label} must be an opaque stable reference`)
  }
}

const assertConversationAttemptRef = (value: string) => {
  if (!CONVERSATION_ATTEMPT_REF_PATTERN.test(value)) {
    throw new Error(
      'conversationAttemptRef must be a canonical prepared sample attempt reference'
    )
  }
}

const assertCanonicalGeneratedAt = (value: string) => {
  const parsed = new Date(value)
  if (
    value.length > 32 ||
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString() !== value
  ) {
    throw new Error('generatedAt must be a canonical UTC timestamp')
  }
}

const assertPreparedSampleId = (value: string, label: string) => {
  if (!PREPARED_SAMPLE_ID_PATTERN.test(value)) {
    throw new Error(`${label} must be a prepared sample ID`)
  }
}

const assertPreparedSampleTextPublication = (
  textPublication: PreparedSampleTextPublication
) => {
  if (
    textPublication.textPublicationPolicy !== 'prepared_sample_text_allowed' ||
    textPublication.textProvenanceClass !== 'prepared_local_sample_set'
  ) {
    throw new Error('prepared sample text publication policy is required')
  }
}

const assertPreparedSampleIndexPreflight = (
  sampleIndexPreflight: PreparedSampleIndexPreflight
) => {
  if (
    sampleIndexPreflight.sampleIndexPreflightClass !==
    'prepared_sample_index_verified'
  ) {
    throw new Error('prepared sample index preflight verification is required')
  }
  assertOpaqueRef(
    sampleIndexPreflight.sampleIndexPreflightRef,
    'sampleIndexPreflightRef'
  )
}

export const createPreparedSampleRun = (input: {
  conversationAttemptRef: string
  selectedSampleId: string
  sampleIndexPreflight: PreparedSampleIndexPreflight
  expectedText: string
  textPublication: PreparedSampleTextPublication
}): PreparedSampleRun => {
  assertConversationAttemptRef(input.conversationAttemptRef)
  assertPreparedSampleId(input.selectedSampleId, 'selectedSampleId')
  assertPreparedSampleTextPublication(input.textPublication)
  assertPreparedSampleIndexPreflight(input.sampleIndexPreflight)
  if (!input.expectedText.trim()) {
    throw new Error('expectedText is required for a prepared sample run')
  }

  return { ...input, attempts: [] }
}

export const createAcceptedPreparedSampleSpeechEnvelope = (input: {
  conversationAttemptRef: string
  selectedSampleId: string
  recognizedText: string
  generatedAt: string
}): AcceptedPreparedSampleSpeechEnvelope => {
  assertConversationAttemptRef(input.conversationAttemptRef)
  assertPreparedSampleId(input.selectedSampleId, 'selectedSampleId')
  assertCanonicalGeneratedAt(input.generatedAt)
  const text = input.recognizedText.trim()
  if (!text || text.length > MAX_PRIVATE_TURN_TEXT_LENGTH) {
    throw new Error('recognizedText must be a bounded private turn')
  }

  const attemptId = input.conversationAttemptRef.slice(
    'm4.prepared_sample_attempt:'.length
  )
  return {
    accepted_user_speech_candidate: {
      schema_version: 'accepted_user_speech_candidate_input_gate.v0',
      candidate_id: `ausc_prepared_sample_browser_stt_${attemptId}`,
      generated_at: input.generatedAt,
      proof_layer: 'source_static_contract_test_only',
      route_id:
        'ACCEPTED-USER-SPEECH-CANDIDATE-INPUT-GATE-THOUGHT-CORE-CONTRACT-RR00301-SOURCE-STATIC-02',
      candidate_route: 'prepared_sample_browser_stt',
      source_kind: 'prepared_local_audio_sample',
      speaker_role: 'user_candidate',
      recognition_summary: {
        source_label: input.selectedSampleId,
        recognition_summary_ref: `event:prepared_sample_browser_stt:${attemptId}`,
        recognition_summary_class: 'stable_browser_stt_prepared_sample',
        recognized_text_class: 'absent',
        recognized_text_length_bucket: 'none',
        language_bucket: 'ja',
        confidence_bucket: 'high',
        raw_text_in_shared_artifact: false,
      },
      text_publication: {
        text_publication_policy: 'text_redacted_or_absent',
        text_provenance_class: 'redacted_or_absent',
        expected_sample_text: null,
        recognized_text: null,
        content_match_text: null,
        non_sample_or_live_text_policy: 'protected_or_redacted',
      },
      self_output_context: {
        self_output_correlation_class: 'not_self_output',
        session_join_class: 'same_session_not_self_output',
        bubble_tts_parity_class: 'not_authority_for_user_speech',
        bubble_or_tts_as_user_speech_authority: false,
      },
      input_gate: {
        input_gate_decision_owner: 'ai_talk_core_input_gate',
        input_gate_decision_class: 'accepted_user_speech_candidate',
        normal_turn_block_reason: null,
      },
      acceptance_decision: {
        acceptance_status: 'accepted_user_speech_candidate',
        may_materialize_thought_core_turninput: true,
        private_text_handoff_required: true,
        shared_artifact_contains_text: false,
        thought_core_turninput_materialized: false,
        thought_core_turninput_count: 0,
        thought_core_turninput_ref: null,
        turn_materialization_route: 'separate_private_runtime_handoff_required',
      },
      redaction_guards: {
        raw_audio_included: false,
        raw_media_included: false,
        raw_transcript_included: false,
        raw_recognized_text_included: false,
        private_path_included: false,
        provider_payload_included: false,
        browser_storage_included: false,
        token_or_secret_included: false,
        home_control_action_authority_included: false,
      },
      non_claims: [
        'not_audio_capture',
        'not_user_heard_proof',
        'not_home_control_action',
        'not_touchdesigner_action',
        'not_source_git_adoption',
        'not_readiness_or_rr003_pass',
      ],
      raw_private_publication_flags: false,
    },
    private_turn: {
      text,
      turn_id: `prepared_sample_browser_stt_${attemptId}`,
      session_id: 'prepared_sample_browser_stt_operator',
      locale: 'ja-JP',
      context_refs: {
        conversation_attempt_ref: input.conversationAttemptRef,
      },
    },
  }
}

export const recordPreparedSampleAttempt = (
  run: PreparedSampleRun,
  input: {
    resultEventCount: number
    finalResultCount: number
    recognizedText: string
    timedOut: boolean
  }
): PreparedSampleRun => {
  assertPreparedSampleTextPublication(run.textPublication)
  if (run.attempts.length >= PREPARED_SAMPLE_ATTEMPT_COUNT) {
    throw new Error('prepared sample run already has five attempts')
  }
  if (input.resultEventCount < 0 || input.finalResultCount < 0) {
    throw new Error('recognition counts cannot be negative')
  }
  if (input.finalResultCount > input.resultEventCount) {
    throw new Error('final result count cannot exceed result event count')
  }

  const recognizedText = input.recognizedText.trim()
  const contentMatchClass = input.timedOut
    ? 'timed_out'
    : input.finalResultCount === 0
      ? 'missing_final_result'
      : normalizePreparedSampleText(run.expectedText) ===
          normalizePreparedSampleText(recognizedText)
        ? 'matched'
        : 'mismatch'

  return {
    ...run,
    attempts: [
      ...run.attempts,
      {
        attemptNumber: run.attempts.length + 1,
        resultEventCount: input.resultEventCount,
        finalResultCount: input.finalResultCount,
        contentMatchClass,
        stopClass: input.timedOut
          ? 'attempt_timeout'
          : input.finalResultCount > 0
            ? 'final_result_recorded'
            : 'missing_final_result',
        recognizedText,
      },
    ],
  }
}

export const summarizePreparedSampleRun = (
  run: PreparedSampleRun
): PreparedSampleRunSummary => {
  const resultEventCount = run.attempts.reduce(
    (total, attempt) => total + attempt.resultEventCount,
    0
  )
  const finalResultCount = run.attempts.reduce(
    (total, attempt) => total + attempt.finalResultCount,
    0
  )

  if (run.attempts.length !== PREPARED_SAMPLE_ATTEMPT_COUNT) {
    return {
      boundedAttemptCount: run.attempts.length,
      resultEventCount,
      finalResultCount,
      contentMatchStabilityClass: 'incomplete_attempt_set',
      blockerClass: 'bounded_attempt_count_not_met',
    }
  }
  if (run.attempts.some((attempt) => attempt.finalResultCount === 0)) {
    return {
      boundedAttemptCount: run.attempts.length,
      resultEventCount,
      finalResultCount,
      contentMatchStabilityClass: 'final_result_not_observed',
      blockerClass: 'final_result_not_observed',
    }
  }
  if (run.attempts.some((attempt) => attempt.contentMatchClass !== 'matched')) {
    return {
      boundedAttemptCount: run.attempts.length,
      resultEventCount,
      finalResultCount,
      contentMatchStabilityClass: 'content_match_not_stable',
      blockerClass: 'repeat_content_match_not_stable',
    }
  }

  return {
    boundedAttemptCount: run.attempts.length,
    resultEventCount,
    finalResultCount,
    contentMatchStabilityClass: 'stable_positive',
    blockerClass: null,
  }
}
