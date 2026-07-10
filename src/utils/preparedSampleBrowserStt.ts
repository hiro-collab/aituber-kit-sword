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

const OPAQUE_REF_PATTERN = /^[a-z][a-z0-9_.:-]{2,127}$/
const PREPARED_SAMPLE_ID_PATTERN = /^[a-z][a-z0-9_.-]{2,127}$/

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
