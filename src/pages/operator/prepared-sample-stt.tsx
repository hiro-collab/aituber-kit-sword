import { useCallback, useEffect, useRef, useState } from 'react'
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

type ParentPreflightState = {
  value: ParentPreflightQuery | null
  error: string | null
}

const OPAQUE_REF_PATTERN = /^[a-z][a-z0-9_.:-]{2,127}$/
const PREPARED_SAMPLE_ID_PATTERN = /^[a-z][a-z0-9_.-]{2,127}$/
const MAX_PRIVATE_DEVICE_ID_LENGTH = 512
const PARENT_PREFLIGHT_STATUSES = [
  'parent_preflight_query_required',
  'parent_preflight_query_invalid',
] as const
const EXPLICIT_AUDIO_TRACK_CLEANUP_COMPLETE =
  'explicit_audio_track_cleanup_complete' as const
const EXPLICIT_AUDIO_TRACK_CLEANUP_FAILED =
  'explicit_audio_track_cleanup_failed' as const

type ExplicitAudioTrackCleanupClass =
  | typeof EXPLICIT_AUDIO_TRACK_CLEANUP_COMPLETE
  | typeof EXPLICIT_AUDIO_TRACK_CLEANUP_FAILED

type OperatorSetupStatus =
  | 'explicit_audio_input_device_required'
  | 'explicit_audio_input_acquisition_failed'
  | 'explicit_audio_input_track_invalid'
  | 'explicit_audio_input_settings_unavailable'
  | 'explicit_audio_input_device_mismatch'
  | 'explicit_audio_input_processing_not_disabled'

class OperatorSetupError extends Error {
  constructor(readonly status: OperatorSetupStatus) {
    super(status)
    this.name = 'OperatorSetupError'
  }
}

type PreparedSamplePrivateWindow = Window & {
  __preparedSampleSttAudioInputDeviceId?: string
  __preparedSampleSttReleaseAudioTrack?: () => ExplicitAudioTrackCleanupClass
  __preparedSampleSttFinalizeAudioInput?: () => Promise<void>
}

const readPrivateAudioInputDeviceId = (): string => {
  const value = (window as PreparedSamplePrivateWindow)
    .__preparedSampleSttAudioInputDeviceId
  if (
    typeof value !== 'string' ||
    value.length < 1 ||
    value.length > MAX_PRIVATE_DEVICE_ID_LENGTH ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw new OperatorSetupError('explicit_audio_input_device_required')
  }
  return value
}

const stopAcquiredTracks = (tracks: MediaStreamTrack[]) => {
  new Set(tracks).forEach((track) => {
    try {
      track.stop()
    } catch {
      // Cleanup remains best-effort and never publishes native track details.
    }
  })
}

const acquireExplicitAudioTrack = async (): Promise<MediaStreamTrack> => {
  const deviceId = readPrivateAudioInputDeviceId()
  let stream: MediaStream
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: { exact: deviceId },
        echoCancellation: { exact: false },
        noiseSuppression: { exact: false },
        autoGainControl: { exact: false },
      },
    })
  } catch {
    throw new OperatorSetupError('explicit_audio_input_acquisition_failed')
  }

  const acquiredTracks: MediaStreamTrack[] = []
  try {
    const tracks = stream.getTracks()
    acquiredTracks.push(...tracks)
    const audioTracks = stream.getAudioTracks()
    audioTracks.forEach((track) => {
      if (!acquiredTracks.includes(track)) acquiredTracks.push(track)
    })
    const track = audioTracks[0]
    if (
      tracks.length !== 1 ||
      audioTracks.length !== 1 ||
      !track ||
      track.kind !== 'audio' ||
      track.readyState !== 'live'
    ) {
      throw new OperatorSetupError('explicit_audio_input_track_invalid')
    }
    if (typeof track.getSettings !== 'function') {
      throw new OperatorSetupError('explicit_audio_input_settings_unavailable')
    }

    let settings: MediaTrackSettings
    try {
      settings = track.getSettings()
    } catch {
      throw new OperatorSetupError('explicit_audio_input_settings_unavailable')
    }
    if (settings.deviceId !== deviceId) {
      throw new OperatorSetupError('explicit_audio_input_device_mismatch')
    }
    if (
      settings.echoCancellation !== false ||
      settings.noiseSuppression !== false ||
      settings.autoGainControl !== false
    ) {
      throw new OperatorSetupError(
        'explicit_audio_input_processing_not_disabled'
      )
    }
    return track
  } catch (error) {
    stopAcquiredTracks(acquiredTracks)
    if (error instanceof OperatorSetupError) throw error
    throw new OperatorSetupError('explicit_audio_input_track_invalid')
  }
}

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
  const explicitAudioTrackCleanupFailedHandlerRef = useRef<() => void>(() => {})
  const {
    isListening,
    startListeningWithAudioTrack,
    releaseExplicitAudioTrack,
    stopListening,
  } = useBrowserSpeechRecognition(ignoreSubmission, () =>
    explicitAudioTrackCleanupFailedHandlerRef.current()
  )
  const [parentPreflight, setParentPreflight] = useState<ParentPreflightState>({
    value: null,
    error: 'parent_preflight_mount_pending',
  })
  const [expectedText, setExpectedText] = useState('')
  const [run, setRun] = useState<PreparedSampleRun | null>(null)
  const [status, setStatus] = useState('mount_pending')
  const [drainFinalizationPending, setDrainFinalizationPending] =
    useState(false)
  const resultEventCountRef = useRef(0)
  const finalResultCountRef = useRef(0)
  const latestTranscriptRef = useRef('')
  const attemptActiveRef = useRef(false)
  const completionInFlightRef = useRef(false)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const ownedAudioTrackRef = useRef<MediaStreamTrack | null>(null)
  const cleanupFailureRef = useRef(false)

  explicitAudioTrackCleanupFailedHandlerRef.current = () => {
    if (cleanupFailureRef.current) return
    cleanupFailureRef.current = true
    attemptActiveRef.current = false
    setDrainFinalizationPending(false)
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
    setStatus(EXPLICIT_AUDIO_TRACK_CLEANUP_FAILED)
  }

  const releaseOwnedAudioTrack =
    useCallback((): ExplicitAudioTrackCleanupClass => {
      const track = ownedAudioTrackRef.current
      ownedAudioTrackRef.current = null
      let cleanupFailed = false
      try {
        if (track && typeof track.stop === 'function') track.stop()
      } catch {
        cleanupFailed = true
      } finally {
        try {
          if (
            releaseExplicitAudioTrack() === EXPLICIT_AUDIO_TRACK_CLEANUP_FAILED
          ) {
            cleanupFailed = true
          }
        } catch {
          cleanupFailed = true
        }
      }
      if (cleanupFailed) {
        cleanupFailureRef.current = true
        setStatus(EXPLICIT_AUDIO_TRACK_CLEANUP_FAILED)
        return EXPLICIT_AUDIO_TRACK_CLEANUP_FAILED
      }
      return EXPLICIT_AUDIO_TRACK_CLEANUP_COMPLETE
    }, [releaseExplicitAudioTrack])

  useEffect(() => {
    try {
      setParentPreflight({ value: readParentPreflightQuery(), error: null })
      setStatus('ready')
    } catch (error) {
      const errorClass =
        error instanceof Error &&
        PARENT_PREFLIGHT_STATUSES.includes(
          error.message as (typeof PARENT_PREFLIGHT_STATUSES)[number]
        )
          ? error.message
          : 'parent_preflight_query_invalid'
      setParentPreflight({
        value: null,
        error: errorClass,
      })
      setStatus(errorClass)
    }
  }, [])

  useEffect(() => {
    const privateWindow = window as PreparedSamplePrivateWindow
    privateWindow.__preparedSampleSttReleaseAudioTrack = releaseOwnedAudioTrack
    privateWindow.__preparedSampleSttFinalizeAudioInput = async () => {
      if (!attemptActiveRef.current) return
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
        timeoutRef.current = null
      }
      setDrainFinalizationPending(true)
      try {
        await stopListening(true)
      } catch (error) {
        setDrainFinalizationPending(false)
        throw error
      }
    }
    return () => {
      releaseOwnedAudioTrack()
      delete privateWindow.__preparedSampleSttReleaseAudioTrack
      delete privateWindow.__preparedSampleSttFinalizeAudioInput
    }
  }, [releaseOwnedAudioTrack, stopListening])

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
    setDrainFinalizationPending(false)
    completionInFlightRef.current = true
    clearAttemptTimeout()
    try {
      await stopListening()
      if (!cleanupFailureRef.current) {
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
      }
    } finally {
      releaseOwnedAudioTrack()
      if (cleanupFailureRef.current) {
        setStatus(EXPLICIT_AUDIO_TRACK_CLEANUP_FAILED)
      }
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
      cleanupFailureRef.current = false
      setDrainFinalizationPending(false)
      const track = await acquireExplicitAudioTrack()
      ownedAudioTrackRef.current = track
      const startPromise = startListeningWithAudioTrack(track)
      ownedAudioTrackRef.current = null
      const startResult = await startPromise
      if (startResult === EXPLICIT_AUDIO_TRACK_CLEANUP_FAILED) {
        attemptActiveRef.current = false
        cleanupFailureRef.current = true
        setStatus(EXPLICIT_AUDIO_TRACK_CLEANUP_FAILED)
        return
      }
      if (!startResult) {
        attemptActiveRef.current = false
        if (!cleanupFailureRef.current) {
          setStatus('explicit_speech_audio_track_unsupported')
        }
        return
      }
      timeoutRef.current = setTimeout(() => {
        void finishAttempt(true)
      }, PREPARED_SAMPLE_ATTEMPT_TIMEOUT_MS)
      setStatus('attempt_listening')
    } catch (error) {
      attemptActiveRef.current = false
      releaseOwnedAudioTrack()
      if (!cleanupFailureRef.current) {
        setStatus(
          error instanceof OperatorSetupError
            ? error.status
            : 'operator_setup_failed'
        )
      }
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
          disabled={!isListening && !drainFinalizationPending}
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
            parentPreflight.value?.sampleIndexPreflight
              .sampleIndexPreflightClass ??
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
