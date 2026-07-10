import { useEffect, useRef, useState } from 'react'
import { useBrowserSpeechRecognition } from '@/hooks/useBrowserSpeechRecognition'
import { CONVERSATION_ATTEMPT_REF_PATTERN } from '@/utils/speechOutputParitySummary'
import {
  PREPARED_SAMPLE_ATTEMPT_COUNT,
  PREPARED_SAMPLE_ATTEMPT_TIMEOUT_MS,
  createPreparedSampleRun,
  recordPreparedSampleAttempt,
  summarizePreparedSampleRun,
  type PreparedSampleIndexPreflight,
  type PreparedSampleRun,
} from '@/utils/preparedSampleBrowserStt'

type SttDiagnosticDetail = {
  controller?: string
  event?: string
  transcript?: string
}

const textPublication = {
  textPublicationPolicy: 'prepared_sample_text_allowed' as const,
  textProvenanceClass: 'prepared_local_sample_set' as const,
}

type ParentPreflightQuery = {
  conversationAttemptRef: string
  selectedSampleId: string
  sampleIndexPreflight: PreparedSampleIndexPreflight
}

const OPAQUE_REF_PATTERN = /^[a-z][a-z0-9_.:-]{2,127}$/
const PREPARED_SAMPLE_ID_PATTERN = /^[a-z][a-z0-9_.-]{2,127}$/

const readParentPreflightQuery = (): ParentPreflightQuery => {
  const query = new URLSearchParams(window.location.search)
  const conversationAttemptRef = query.get('conversation_attempt_ref') ?? ''
  const selectedSampleId = query.get('selected_sample_id') ?? ''
  const sampleIndexPreflightClass =
    query.get('sample_index_preflight_class') ?? ''
  const sampleIndexPreflightRef = query.get('sample_index_preflight_ref') ?? ''

  if (
    !conversationAttemptRef ||
    !selectedSampleId ||
    !sampleIndexPreflightClass ||
    !sampleIndexPreflightRef
  ) {
    throw new Error('parent_preflight_query_required')
  }
  if (
    !CONVERSATION_ATTEMPT_REF_PATTERN.test(conversationAttemptRef) ||
    !PREPARED_SAMPLE_ID_PATTERN.test(selectedSampleId) ||
    sampleIndexPreflightClass !== 'prepared_sample_index_verified' ||
    !OPAQUE_REF_PATTERN.test(sampleIndexPreflightRef)
  ) {
    throw new Error('parent_preflight_query_invalid')
  }

  return {
    conversationAttemptRef,
    selectedSampleId,
    sampleIndexPreflight: {
      sampleIndexPreflightClass: 'prepared_sample_index_verified',
      sampleIndexPreflightRef,
    },
  }
}

const ignoreSubmission = () => {}

const PreparedSampleSttOperator = () => {
  const { isListening, startListening, stopListening } =
    useBrowserSpeechRecognition(ignoreSubmission)
  const [parentPreflight] = useState(() => {
    try {
      return { value: readParentPreflightQuery(), error: null }
    } catch (error) {
      return {
        value: null,
        error:
          error instanceof Error
            ? error.message
            : 'parent_preflight_query_invalid',
      }
    }
  })
  const [expectedText, setExpectedText] = useState('')
  const [run, setRun] = useState<PreparedSampleRun | null>(null)
  const [status, setStatus] = useState('ready')
  const resultEventCountRef = useRef(0)
  const finalResultCountRef = useRef(0)
  const latestTranscriptRef = useRef('')
  const attemptActiveRef = useRef(false)
  const completionInFlightRef = useRef(false)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearAttemptTimeout = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
  }

  const finishAttempt = async (timedOut: boolean) => {
    if (!attemptActiveRef.current || completionInFlightRef.current) {
      return
    }

    attemptActiveRef.current = false
    completionInFlightRef.current = true
    clearAttemptTimeout()
    try {
      await stopListening()
      setRun((current) => {
        if (!current) {
          return current
        }
        return recordPreparedSampleAttempt(current, {
          resultEventCount: resultEventCountRef.current,
          finalResultCount: finalResultCountRef.current,
          recognizedText: latestTranscriptRef.current,
          timedOut,
        })
      })
      setStatus(timedOut ? 'attempt_timeout' : 'attempt_recorded')
    } finally {
      completionInFlightRef.current = false
    }
  }

  useEffect(() => {
    const handleDiagnostic = (event: Event) => {
      const detail = (event as CustomEvent<SttDiagnosticDetail>).detail
      if (
        !attemptActiveRef.current ||
        detail?.controller !== 'browser_stt' ||
        !detail.event?.startsWith('onresult')
      ) {
        return
      }
      if (typeof detail.transcript === 'string') {
        latestTranscriptRef.current = detail.transcript
      }
      resultEventCountRef.current += 1
      if (detail.event === 'onresult_final') {
        finalResultCountRef.current += 1
      }
    }
    window.addEventListener(
      'projection-visual-stt-diagnostic',
      handleDiagnostic
    )
    return () => {
      window.removeEventListener(
        'projection-visual-stt-diagnostic',
        handleDiagnostic
      )
      clearAttemptTimeout()
      attemptActiveRef.current = false
    }
  }, [])

  const startAttempt = async () => {
    if (!parentPreflight.value) {
      setStatus(parentPreflight.error ?? 'parent_preflight_query_invalid')
      return
    }
    if (
      isListening ||
      attemptActiveRef.current ||
      completionInFlightRef.current
    ) {
      setStatus('recognition_already_active')
      return
    }

    try {
      const current =
        run ??
        createPreparedSampleRun({
          conversationAttemptRef: parentPreflight.value.conversationAttemptRef,
          selectedSampleId: parentPreflight.value.selectedSampleId,
          sampleIndexPreflight: parentPreflight.value.sampleIndexPreflight,
          expectedText,
          textPublication,
        })
      if (current.attempts.length >= PREPARED_SAMPLE_ATTEMPT_COUNT) {
        setStatus('bounded_attempt_count_reached')
        return
      }
      setRun(current)
      resultEventCountRef.current = 0
      finalResultCountRef.current = 0
      latestTranscriptRef.current = ''
      attemptActiveRef.current = true
      const started = await startListening()
      if (!started) {
        attemptActiveRef.current = false
        setStatus('browser_stt_or_microphone_unavailable')
        return
      }
      timeoutRef.current = setTimeout(() => {
        void finishAttempt(true)
      }, PREPARED_SAMPLE_ATTEMPT_TIMEOUT_MS)
      setStatus('attempt_listening')
    } catch (error) {
      attemptActiveRef.current = false
      setStatus(
        error instanceof Error ? error.message : 'operator_setup_failed'
      )
    }
  }

  const summary = run ? summarizePreparedSampleRun(run) : null
  const lastAttempt = run?.attempts[run.attempts.length - 1]

  return (
    <main className="mx-auto max-w-2xl space-y-4 p-6">
      <h1>Prepared Sample Browser STT</h1>
      <p>
        Parent-preflight-bound browser recognition only. This surface does not
        materialize a Thought Core turn.
      </p>
      <p data-testid="prepared-sample-parent-preflight">
        {parentPreflight.value
          ? `selected_sample_id=${parentPreflight.value.selectedSampleId} sample_index_preflight_class=${parentPreflight.value.sampleIndexPreflight.sampleIndexPreflightClass}`
          : parentPreflight.error}
      </p>
      <label className="block">
        Expected prepared-sample text
        <textarea
          value={expectedText}
          onChange={(event) => setExpectedText(event.target.value)}
        />
      </label>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={startAttempt}
          disabled={isListening || !parentPreflight.value}
        >
          Start bounded attempt
        </button>
        <button
          type="button"
          onClick={() => void finishAttempt(false)}
          disabled={!isListening}
        >
          Record final result
        </button>
      </div>
      <p data-testid="prepared-sample-stt-status">{status}</p>
      <p>
        Attempts: {run?.attempts.length ?? 0}/{PREPARED_SAMPLE_ATTEMPT_COUNT}
      </p>
      <dl>
        <dt>sample_index_preflight_class</dt>
        <dd>
          {run?.sampleIndexPreflight.sampleIndexPreflightClass ??
            'not_verified'}
        </dd>
        <dt>last_attempt_content_match_class</dt>
        <dd>{lastAttempt?.contentMatchClass ?? 'not_recorded'}</dd>
        <dt>last_attempt_stop_class</dt>
        <dd>{lastAttempt?.stopClass ?? 'not_recorded'}</dd>
        {summary && (
          <>
            <dt>Result events</dt>
            <dd>{summary.resultEventCount}</dd>
            <dt>Final results</dt>
            <dd>{summary.finalResultCount}</dd>
            <dt>Stability</dt>
            <dd>{summary.contentMatchStabilityClass}</dd>
            <dt>Blocker</dt>
            <dd>{summary.blockerClass ?? 'none'}</dd>
          </>
        )}
      </dl>
    </main>
  )
}

export default PreparedSampleSttOperator
