import {
  PREPARED_SAMPLE_ATTEMPT_COUNT,
  createPreparedSampleRun,
  recordPreparedSampleAttempt,
  summarizePreparedSampleRun,
} from '@/utils/preparedSampleBrowserStt'

const publication = {
  textPublicationPolicy: 'prepared_sample_text_allowed' as const,
  textProvenanceClass: 'prepared_local_sample_set' as const,
}

const verifiedIndexPreflight = {
  sampleIndexPreflightClass: 'prepared_sample_index_verified' as const,
  sampleIndexPreflightRef: 'm4.sample_index_preflight_001',
}

const conversationAttemptRef =
  'm4.prepared_sample_attempt:0123456789abcdef0123456789abcdef'

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

  it.each([
    'm4.prepared_sample_attempt0123456789abcdef0123456789abcdef',
    'm4.prepared_sample_attempt:0123456789ABCDEF0123456789abcdef',
    'm4.other_attempt:0123456789abcdef0123456789abcdef',
    'm4.prepared_sample_attempt:0123456789abcdef0123456789abcde',
    'm4.prepared_sample_attempt:0123456789abcdef0123456789abcdef0',
    ' m4.prepared_sample_attempt:0123456789abcdef0123456789abcdef',
  ])('rejects non-canonical conversation attempt refs: %s', (invalidRef) => {
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
  })

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
})
