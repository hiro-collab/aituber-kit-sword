import {
  PREPARED_SAMPLE_ATTEMPT_COUNT,
  createAcceptedPreparedSampleSpeechEnvelope,
  createPreparedSampleRun,
  recordPreparedSampleAttempt,
  summarizePreparedSampleRun,
} from '@/utils/preparedSampleBrowserStt'
import { existsSync, readFileSync, statSync } from 'fs'

const SHARED_VECTOR_FILE = 'm4_cross_repo_attempt_vectors.v0.json'
const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const readSharedVectors = () => {
  const fixturePath = process.env.SWORD_M4_SHARED_VECTOR_PATH
  if (!fixturePath) return null
  if (!fixturePath.endsWith(SHARED_VECTOR_FILE) || !existsSync(fixturePath)) {
    throw new Error(
      'configured M4 shared vector fixture is missing or unexpected'
    )
  }
  const size = statSync(fixturePath).size
  if (size < 1 || size > 64 * 1024) {
    throw new Error('configured M4 shared vector fixture has an invalid size')
  }
  let value: unknown
  try {
    value = JSON.parse(readFileSync(fixturePath, 'utf8'))
  } catch {
    throw new Error('configured M4 shared vector fixture is malformed')
  }
  if (
    !isRecord(value) ||
    value.schema_version !== 'm4_cross_repo_attempt_vectors.v0' ||
    typeof value.canonical_conversation_attempt_ref !== 'string' ||
    !isRecord(value.invalid_conversation_attempt_refs) ||
    Object.keys(value.invalid_conversation_attempt_refs).length !== 7 ||
    !Object.values(value.invalid_conversation_attempt_refs).every(
      (ref) => typeof ref === 'string'
    )
  ) {
    throw new Error('configured M4 shared vector fixture has an invalid shape')
  }
  return {
    canonicalConversationAttemptRef: value.canonical_conversation_attempt_ref,
    invalidConversationAttemptRefs: Object.values(
      value.invalid_conversation_attempt_refs
    ) as string[],
  }
}

const sharedVectors = readSharedVectors()

const publication = {
  textPublicationPolicy: 'prepared_sample_text_allowed' as const,
  textProvenanceClass: 'prepared_local_sample_set' as const,
}

const verifiedIndexPreflight = {
  sampleIndexPreflightClass: 'prepared_sample_index_verified' as const,
  sampleIndexPreflightRef: 'm4.sample_index_preflight_001',
}

const conversationAttemptRef =
  sharedVectors?.canonicalConversationAttemptRef ??
  'm4.prepared_sample_attempt:0123456789abcdef0123456789abcdef'
const invalidConversationAttemptRefs =
  sharedVectors?.invalidConversationAttemptRefs ?? ['not-a-canonical-ref']

describe('preparedSampleBrowserStt', () => {
  it('requires the prepared-local-sample publication policy before retaining text', () => {
    expect(() =>
      createPreparedSampleRun({
        conversationAttemptRef,
        selectedSampleId: 'voice.local_sample_001',
        sampleIndexPreflight: verifiedIndexPreflight,
        expectedText: 'prepared sample',
        textPublication: {
          textPublicationPolicy: 'prepared_sample_text_allowed',
          textProvenanceClass: 'other_source' as never,
        },
      })
    ).toThrow('prepared sample text publication policy is required')

    expect(() =>
      createPreparedSampleRun({
        conversationAttemptRef,
        selectedSampleId: 'voice.local_sample_001',
        sampleIndexPreflight: verifiedIndexPreflight,
        expectedText: 'prepared sample',
        textPublication: {
          textPublicationPolicy: 'other_policy' as never,
          textProvenanceClass: 'prepared_local_sample_set',
        },
      })
    ).toThrow('prepared sample text publication policy is required')
  })

  it('fails closed unless a verified sample-index preflight has an opaque reference', () => {
    const input = {
      conversationAttemptRef,
      selectedSampleId: 'voice.local_sample_001',
      expectedText: 'prepared sample',
      textPublication: publication,
    }

    expect(() =>
      createPreparedSampleRun({
        ...input,
        sampleIndexPreflight: {
          sampleIndexPreflightClass: 'unverified' as never,
          sampleIndexPreflightRef: 'm4.sample_index_preflight_001',
        },
      })
    ).toThrow('prepared sample index preflight verification is required')
    expect(() =>
      createPreparedSampleRun({
        ...input,
        sampleIndexPreflight: {
          sampleIndexPreflightClass: 'prepared_sample_index_verified',
          sampleIndexPreflightRef: 'not opaque ref',
        },
      })
    ).toThrow('sampleIndexPreflightRef must be an opaque stable reference')
  })

  it.each([
    'Voice.local_sample_001',
    '1voice.local_sample_001',
    'voice:local_sample_001',
    'ab',
  ])('rejects invalid prepared sample ID %s', (selectedSampleId) => {
    expect(() =>
      createPreparedSampleRun({
        conversationAttemptRef,
        selectedSampleId,
        sampleIndexPreflight: verifiedIndexPreflight,
        expectedText: 'prepared sample',
        textPublication: publication,
      })
    ).toThrow('selectedSampleId must be a prepared sample ID')
  })

  it('requires five matching final results for a stable summary', () => {
    let run = createPreparedSampleRun({
      conversationAttemptRef,
      selectedSampleId: 'voice.local_sample_001',
      sampleIndexPreflight: verifiedIndexPreflight,
      expectedText: 'prepared sample',
      textPublication: publication,
    })

    for (
      let attempt = 0;
      attempt < PREPARED_SAMPLE_ATTEMPT_COUNT;
      attempt += 1
    ) {
      run = recordPreparedSampleAttempt(run, {
        resultEventCount: 1,
        finalResultCount: 1,
        recognizedText: 'prepared sample',
        timedOut: false,
      })
    }

    expect(summarizePreparedSampleRun(run)).toEqual({
      boundedAttemptCount: PREPARED_SAMPLE_ATTEMPT_COUNT,
      resultEventCount: PREPARED_SAMPLE_ATTEMPT_COUNT,
      finalResultCount: PREPARED_SAMPLE_ATTEMPT_COUNT,
      contentMatchStabilityClass: 'stable_positive',
      blockerClass: null,
    })
  })

  it('enforces the five-attempt boundary and classifies timeout, missing-final, and mismatch attempts', () => {
    let run = createPreparedSampleRun({
      conversationAttemptRef,
      selectedSampleId: 'voice.local_sample_001',
      sampleIndexPreflight: verifiedIndexPreflight,
      expectedText: 'prepared sample',
      textPublication: publication,
    })

    run = recordPreparedSampleAttempt(run, {
      resultEventCount: 1,
      finalResultCount: 1,
      recognizedText: 'different sample',
      timedOut: false,
    })
    run = recordPreparedSampleAttempt(run, {
      resultEventCount: 1,
      finalResultCount: 0,
      recognizedText: '',
      timedOut: false,
    })
    run = recordPreparedSampleAttempt(run, {
      resultEventCount: 1,
      finalResultCount: 1,
      recognizedText: 'prepared sample',
      timedOut: true,
    })

    expect(
      run.attempts.map((attempt) => [
        attempt.contentMatchClass,
        attempt.stopClass,
      ])
    ).toEqual([
      ['mismatch', 'final_result_recorded'],
      ['missing_final_result', 'missing_final_result'],
      ['timed_out', 'attempt_timeout'],
    ])

    for (let attempt = 0; attempt < 2; attempt += 1) {
      run = recordPreparedSampleAttempt(run, {
        resultEventCount: 1,
        finalResultCount: 1,
        recognizedText: 'prepared sample',
        timedOut: false,
      })
    }

    expect(summarizePreparedSampleRun(run)).toMatchObject({
      boundedAttemptCount: PREPARED_SAMPLE_ATTEMPT_COUNT,
      contentMatchStabilityClass: 'final_result_not_observed',
      blockerClass: 'final_result_not_observed',
    })
    expect(() =>
      recordPreparedSampleAttempt(run, {
        resultEventCount: 1,
        finalResultCount: 1,
        recognizedText: 'prepared sample',
        timedOut: false,
      })
    ).toThrow('prepared sample run already has five attempts')
  })

  it.each(invalidConversationAttemptRefs)(
    'rejects non-canonical conversation attempt refs: %s',
    (invalidRef) => {
      expect(() =>
        createPreparedSampleRun({
          conversationAttemptRef: invalidRef,
          selectedSampleId: 'voice.local_sample_001',
          sampleIndexPreflight: verifiedIndexPreflight,
          expectedText: 'prepared sample',
          textPublication: publication,
        })
      ).toThrow(
        'conversationAttemptRef must be a canonical prepared sample attempt reference'
      )
    }
  )

  it('preserves a canonical conversation attempt ref without normalization', () => {
    expect(
      createPreparedSampleRun({
        conversationAttemptRef,
        selectedSampleId: 'voice.local_sample_001',
        sampleIndexPreflight: verifiedIndexPreflight,
        expectedText: 'prepared sample',
        textPublication: publication,
      }).conversationAttemptRef
    ).toBe(conversationAttemptRef)
  })

  it('creates one textless canonical candidate paired with one private turn', () => {
    const envelope = createAcceptedPreparedSampleSpeechEnvelope({
      conversationAttemptRef,
      selectedSampleId: 'voice.local_sample_001',
      recognizedText: '  prepared private speech  ',
      generatedAt: '2026-07-13T01:02:03.000Z',
    })

    expect(envelope.private_turn).toEqual({
      text: 'prepared private speech',
      turn_id: 'prepared_sample_browser_stt_0123456789abcdef0123456789abcdef',
      session_id: 'prepared_sample_browser_stt_operator',
      locale: 'ja-JP',
      context_refs: { conversation_attempt_ref: conversationAttemptRef },
    })
    expect(envelope.accepted_user_speech_candidate).toMatchObject({
      schema_version: 'accepted_user_speech_candidate_input_gate.v0',
      candidate_id:
        'ausc_prepared_sample_browser_stt_0123456789abcdef0123456789abcdef',
      candidate_route: 'prepared_sample_browser_stt',
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
    })
    expect(
      JSON.stringify(envelope.accepted_user_speech_candidate)
    ).not.toContain('prepared private speech')
    expect(envelope.accepted_user_speech_candidate.text_publication).toEqual({
      text_publication_policy: 'text_redacted_or_absent',
      text_provenance_class: 'redacted_or_absent',
      expected_sample_text: null,
      recognized_text: null,
      content_match_text: null,
      non_sample_or_live_text_policy: 'protected_or_redacted',
    })
  })

  it.each([
    '',
    'raw-private-marker',
    'C:\\private\\attempt.wav',
    'm4.prepared_sample_attempt0123456789abcdef0123456789abcdef',
    'm4.prepared_sample_attempt:0123456789ABCDEF0123456789abcdef',
    'm4.prepared_sample_attempt:0123456789abcdef0123456789abcdef0',
  ])(
    'fails closed without echoing an invalid attempt ref: %p',
    (invalidRef) => {
      expect(() =>
        createAcceptedPreparedSampleSpeechEnvelope({
          conversationAttemptRef: invalidRef,
          selectedSampleId: 'voice.local_sample_001',
          recognizedText: 'private speech',
          generatedAt: '2026-07-13T01:02:03.000Z',
        })
      ).toThrow(
        'conversationAttemptRef must be a canonical prepared sample attempt reference'
      )
    }
  )

  it('rejects empty or oversized private text and non-canonical timestamps', () => {
    const base = {
      conversationAttemptRef,
      selectedSampleId: 'voice.local_sample_001',
      generatedAt: '2026-07-13T01:02:03.000Z',
    }
    expect(() =>
      createAcceptedPreparedSampleSpeechEnvelope({
        ...base,
        recognizedText: ' ',
      })
    ).toThrow('recognizedText must be a bounded private turn')
    expect(() =>
      createAcceptedPreparedSampleSpeechEnvelope({
        ...base,
        recognizedText: 'x'.repeat(4_001),
      })
    ).toThrow('recognizedText must be a bounded private turn')
    expect(() =>
      createAcceptedPreparedSampleSpeechEnvelope({
        ...base,
        recognizedText: 'private speech',
        generatedAt: '2026-07-13',
      })
    ).toThrow('generatedAt must be a canonical UTC timestamp')
  })
})
