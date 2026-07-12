import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { existsSync, readFileSync, statSync } from 'fs'
import { hydrateRoot } from 'react-dom/client'
import { TextEncoder } from 'util'
import PreparedSampleSttOperator from '@/pages/operator/prepared-sample-stt'

Object.assign(global, { TextEncoder })
const { renderToString } =
  require('react-dom/server') as typeof import('react-dom/server')

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
let mockIsListening = false
const privateDeviceId = 'private-audio-input-device-id'
let mockAudioTrack: MediaStreamTrack
let mockHookOwnedTrack: MediaStreamTrack | null = null
let mockExplicitAudioTrackCleanupFailed: (() => void) | undefined
let mockOnChatProcessStart: ((text: string) => void) | undefined
const mockSubmitAcceptedPreparedSampleBrowserSpeech = jest.fn(
  async (_envelope: unknown) => {}
)
const conversationAttemptRef =
  sharedVectors?.canonicalConversationAttemptRef ??
  'm4.prepared_sample_attempt:0123456789abcdef0123456789abcdef'
const invalidConversationAttemptRefs =
  sharedVectors?.invalidConversationAttemptRefs ?? ['not-a-canonical-ref']
const startListening = jest.fn(
  async (
    track: MediaStreamTrack
  ): Promise<boolean | 'explicit_audio_track_cleanup_failed'> => {
    mockHookOwnedTrack = track
    mockIsListening = true
    return true
  }
)
const stopListening = jest.fn(async (acceptPendingFinalResult = false) => {
  if (acceptPendingFinalResult) {
    mockIsListening = false
    return
  }
  const track = mockHookOwnedTrack
  mockHookOwnedTrack = null
  mockIsListening = false
  try {
    track?.stop()
  } catch {
    mockExplicitAudioTrackCleanupFailed?.()
  }
})
const releaseExplicitAudioTrack = jest.fn(
  ():
    | 'explicit_audio_track_cleanup_complete'
    | 'explicit_audio_track_cleanup_failed' => {
    mockHookOwnedTrack?.stop()
    mockHookOwnedTrack = null
    return 'explicit_audio_track_cleanup_complete'
  }
)
const mockGetUserMedia = jest.fn()

jest.mock('@/features/chat/thoughtCoreChat', () => ({
  submitAcceptedPreparedSampleBrowserSpeech: (
    envelope: Record<string, unknown>
  ) => mockSubmitAcceptedPreparedSampleBrowserSpeech(envelope),
}))

const createMockAudioTrack = ({
  kind = 'audio',
  readyState = 'live',
  selectedDeviceId = privateDeviceId,
  echoCancellation = false,
  noiseSuppression = false,
  autoGainControl = false,
}: {
  kind?: string
  readyState?: MediaStreamTrackState
  selectedDeviceId?: string
  echoCancellation?: boolean
  noiseSuppression?: boolean
  autoGainControl?: boolean
} = {}) =>
  ({
    kind,
    readyState,
    getSettings: () => ({
      deviceId: selectedDeviceId,
      echoCancellation,
      noiseSuppression,
      autoGainControl,
    }),
    stop: jest.fn(),
  }) as unknown as MediaStreamTrack

jest.mock('@/hooks/useBrowserSpeechRecognition', () => ({
  useBrowserSpeechRecognition: jest.fn(
    (
      onChatProcessStart: (text: string) => void,
      onExplicitAudioTrackCleanupFailed?: () => void
    ) => {
      mockOnChatProcessStart = onChatProcessStart
      mockExplicitAudioTrackCleanupFailed = onExplicitAudioTrackCleanupFailed
      return {
        userMessage: 'stale rendered transcript',
        isListening: mockIsListening,
        startListeningWithAudioTrack: startListening,
        releaseExplicitAudioTrack,
        stopListening,
      }
    }
  ),
}))

const dispatchDiagnostic = (detail: Record<string, unknown>) => {
  window.dispatchEvent(
    new CustomEvent('projection-visual-stt-diagnostic', { detail })
  )
}

const setParentPreflightQuery = (query = '') => {
  window.history.replaceState(
    {},
    '',
    `/operator/prepared-sample-stt?${
      query ||
      `conversation_attempt_ref=${conversationAttemptRef}&selected_sample_id=voice.local_sample_001&sample_index_preflight_class=prepared_sample_index_verified&sample_index_preflight_ref=m4.sample_index_preflight_001`
    }`
  )
}

const prepareRunInputs = () => {
  fireEvent.change(screen.getByLabelText('Expected prepared-sample text'), {
    target: { value: 'prepared sample' },
  })
}

describe('PreparedSampleSttOperator', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    mockIsListening = false
    startListening.mockClear()
    stopListening.mockClear()
    releaseExplicitAudioTrack.mockClear()
    mockHookOwnedTrack = null
    mockExplicitAudioTrackCleanupFailed = undefined
    mockOnChatProcessStart = undefined
    mockSubmitAcceptedPreparedSampleBrowserSpeech.mockClear()
    mockAudioTrack = createMockAudioTrack()
    mockGetUserMedia.mockReset().mockImplementation(async () => ({
      getTracks: () => [mockAudioTrack],
      getAudioTracks: () =>
        mockAudioTrack.kind === 'audio' ? [mockAudioTrack] : [],
    }))
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: mockGetUserMedia },
    })
    Object.defineProperty(window, '__preparedSampleSttAudioInputDeviceId', {
      configurable: true,
      writable: true,
      value: privateDeviceId,
    })
    setParentPreflightQuery()
  })

  afterEach(() => {
    delete (window as any).__preparedSampleSttAudioInputDeviceId
    delete (window as any).__preparedSampleSttReleaseAudioTrack
    jest.useRealTimers()
  })

  it('keeps SSR and the first client render query-independent and non-actionable', async () => {
    jest.useRealTimers()
    setParentPreflightQuery()
    const validQueryServerHtml = renderToString(<PreparedSampleSttOperator />)
    window.history.replaceState({}, '', '/operator/prepared-sample-stt')
    const missingQueryServerHtml = renderToString(<PreparedSampleSttOperator />)

    expect(validQueryServerHtml).toBe(missingQueryServerHtml)

    const container = document.createElement('div')
    container.innerHTML = validQueryServerHtml
    document.body.appendChild(container)
    expect(
      within(container).getByTestId('prepared-sample-parent-preflight')
    ).toHaveTextContent('parent_preflight_mount_pending')
    expect(
      within(container).getByRole('button', {
        name: 'Start bounded attempt',
      })
    ).toBeDisabled()
    expect(container).not.toHaveTextContent('voice.local_sample_001')

    setParentPreflightQuery()
    const recoverableErrors: unknown[] = []
    let root: ReturnType<typeof hydrateRoot> | null = null
    try {
      await act(async () => {
        root = hydrateRoot(container, <PreparedSampleSttOperator />, {
          onRecoverableError: (error) => recoverableErrors.push(error),
        })
      })

      expect(recoverableErrors).toEqual([])
      expect(
        within(container).getByTestId('prepared-sample-parent-preflight')
      ).toHaveTextContent(
        'selected_sample_id=voice.local_sample_001 sample_index_preflight_class=prepared_sample_index_verified'
      )
      expect(
        within(container).getByRole('button', {
          name: 'Start bounded attempt',
        })
      ).toBeEnabled()
      expect(startListening).not.toHaveBeenCalled()
    } finally {
      if (root) {
        await act(async () => {
          root?.unmount()
        })
      }
      container.remove()
    }
  })

  it('uses the latest active browser-STT diagnostic transcript for matching', async () => {
    render(<PreparedSampleSttOperator />)
    prepareRunInputs()

    dispatchDiagnostic({
      controller: 'browser_stt',
      event: 'onresult_final',
      transcript: 'outside attempt',
    })
    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: 'Start bounded attempt' })
      )
    })
    dispatchDiagnostic({
      controller: 'other_controller',
      event: 'onresult_final',
      transcript: 'ignored',
    })
    dispatchDiagnostic({
      controller: 'browser_stt',
      event: 'onresult_interim',
      transcript: 'outdated transcript',
    })
    dispatchDiagnostic({
      controller: 'browser_stt',
      event: 'onresult_final',
      transcript: 'prepared sample',
    })

    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: 'Record final result' })
      )
    })

    expect(screen.getByText('Result events').nextSibling).toHaveTextContent('2')
    expect(screen.getByText('Final results').nextSibling).toHaveTextContent('1')
    expect(
      screen.getByText('sample_index_preflight_class').nextSibling
    ).toHaveTextContent('prepared_sample_index_verified')
    expect(
      screen.getByText('last_attempt_content_match_class').nextSibling
    ).toHaveTextContent('matched')
    expect(
      screen.getByText('last_attempt_stop_class').nextSibling
    ).toHaveTextContent('final_result_recorded')
    expect(screen.getByText('Stability').nextSibling).toHaveTextContent(
      'incomplete_attempt_set'
    )
    expect(stopListening).toHaveBeenCalledTimes(1)
    expect(stopListening).toHaveBeenCalledWith()
  })

  it('acquires and starts with one exact private audio input track', async () => {
    render(<PreparedSampleSttOperator />)
    prepareRunInputs()

    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: 'Start bounded attempt' })
      )
    })

    expect(mockGetUserMedia).toHaveBeenCalledWith({
      audio: {
        deviceId: { exact: privateDeviceId },
        echoCancellation: { exact: false },
        noiseSuppression: { exact: false },
        autoGainControl: { exact: false },
      },
    })
    expect(startListening).toHaveBeenCalledWith(mockAudioTrack)
    expect(document.body).not.toHaveTextContent(privateDeviceId)
  })

  it('keeps record disabled while explicit audio acquisition is still pending', async () => {
    let resolveAcquisition: ((stream: MediaStream) => void) | undefined
    mockGetUserMedia.mockReturnValueOnce(
      new Promise<MediaStream>((resolve) => {
        resolveAcquisition = resolve
      })
    )
    render(<PreparedSampleSttOperator />)
    prepareRunInputs()

    act(() => {
      fireEvent.click(
        screen.getByRole('button', { name: 'Start bounded attempt' })
      )
    })
    await act(async () => {
      await Promise.resolve()
    })

    expect(
      screen.getByRole('button', { name: 'Record final result' })
    ).toBeDisabled()

    await act(async () => {
      resolveAcquisition?.({
        getTracks: () => [mockAudioTrack],
        getAudioTracks: () => [mockAudioTrack],
      } as unknown as MediaStream)
      await Promise.resolve()
      await Promise.resolve()
    })
  })

  it('exposes a private finalize hook that stops recognition without publishing input', async () => {
    const { unmount } = render(<PreparedSampleSttOperator />)
    prepareRunInputs()

    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: 'Start bounded attempt' })
      )
    })
    await act(async () => {
      await (window as any).__preparedSampleSttFinalizeAudioInput?.()
    })

    expect(stopListening).toHaveBeenCalledTimes(1)
    expect(stopListening).toHaveBeenCalledWith(true)
    expect(document.body).not.toHaveTextContent(privateDeviceId)
    unmount()
    expect(
      (window as any).__preparedSampleSttFinalizeAudioInput
    ).toBeUndefined()
  })

  it('cancels the operator timeout while a finalized result remains pending', async () => {
    const { rerender } = render(<PreparedSampleSttOperator />)
    prepareRunInputs()

    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: 'Start bounded attempt' })
      )
      await (window as any).__preparedSampleSttFinalizeAudioInput?.()
      jest.advanceTimersByTime(20_000)
      await Promise.resolve()
    })
    rerender(<PreparedSampleSttOperator />)

    expect(stopListening).toHaveBeenCalledTimes(1)
    expect(stopListening).toHaveBeenCalledWith(true)
    expect(screen.getByTestId('prepared-sample-stt-status')).toHaveTextContent(
      'attempt_listening'
    )
    expect(screen.getByText('Attempts: 0/5')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Record final result' })
    ).toBeEnabled()
  })

  it('does not stop a transferred track twice when the hook returns unsupported', async () => {
    startListening.mockImplementationOnce(async (track: MediaStreamTrack) => {
      mockHookOwnedTrack = track
      track.stop()
      mockHookOwnedTrack = null
      mockIsListening = false
      return false
    })
    const { unmount } = render(<PreparedSampleSttOperator />)
    prepareRunInputs()

    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: 'Start bounded attempt' })
      )
    })

    expect(screen.getByTestId('prepared-sample-stt-status')).toHaveTextContent(
      'explicit_speech_audio_track_unsupported'
    )
    expect(mockAudioTrack.stop).toHaveBeenCalledTimes(1)
    expect(releaseExplicitAudioTrack).not.toHaveBeenCalled()
    unmount()
    expect(mockAudioTrack.stop).toHaveBeenCalledTimes(1)
    expect(releaseExplicitAudioTrack).toHaveBeenCalledTimes(1)
  })

  it('continues hook release from finally when local track stop throws', async () => {
    const privateMarker =
      'PRIVATE_DEVICE C:\\private\\cleanup.wav native-cause native-stack'
    let cleanupClass: unknown
    mockAudioTrack.stop = jest.fn(() => {
      throw new Error(privateMarker)
    })
    startListening.mockImplementationOnce(async () => {
      cleanupClass = (window as any).__preparedSampleSttReleaseAudioTrack?.()
      return false
    })
    render(<PreparedSampleSttOperator />)
    prepareRunInputs()

    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: 'Start bounded attempt' })
      )
    })

    expect(cleanupClass).toBe('explicit_audio_track_cleanup_failed')
    expect(mockAudioTrack.stop).toHaveBeenCalledTimes(1)
    expect(releaseExplicitAudioTrack).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('prepared-sample-stt-status')).toHaveTextContent(
      'explicit_audio_track_cleanup_failed'
    )
    expect(document.body).not.toHaveTextContent(privateMarker)
    expect(document.body).not.toHaveTextContent(privateDeviceId)
    expect(document.body).not.toHaveTextContent('C:\\private\\cleanup.wav')
    expect(document.body).not.toHaveTextContent('native-cause')

    expect((window as any).__preparedSampleSttReleaseAudioTrack?.()).toBe(
      'explicit_audio_track_cleanup_complete'
    )
    expect(mockAudioTrack.stop).toHaveBeenCalledTimes(1)
    expect(releaseExplicitAudioTrack).toHaveBeenCalledTimes(2)
  })

  it('sanitizes a throwing hook release to the fixed cleanup class', async () => {
    const privateMarker =
      'PRIVATE_RELEASE C:\\private\\device.json native-cause native-stack'
    let cleanupClass: unknown
    releaseExplicitAudioTrack.mockImplementationOnce(() => {
      throw new Error(privateMarker)
    })
    startListening.mockImplementationOnce(async () => {
      cleanupClass = (window as any).__preparedSampleSttReleaseAudioTrack?.()
      return false
    })
    render(<PreparedSampleSttOperator />)
    prepareRunInputs()

    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: 'Start bounded attempt' })
      )
    })

    expect(cleanupClass).toBe('explicit_audio_track_cleanup_failed')
    expect(mockAudioTrack.stop).toHaveBeenCalledTimes(1)
    expect(releaseExplicitAudioTrack).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('prepared-sample-stt-status')).toHaveTextContent(
      'explicit_audio_track_cleanup_failed'
    )
    expect(document.body).not.toHaveTextContent(privateMarker)
    expect(document.body).not.toHaveTextContent(privateDeviceId)
    expect(document.body).not.toHaveTextContent('C:\\private\\device.json')
    expect(document.body).not.toHaveTextContent('native-cause')
  })

  it('propagates a fixed hook cleanup failure without publishing private markers', async () => {
    const privateMarker =
      'PRIVATE_HOOK C:\\private\\hook-track.wav native-cause native-stack'
    let cleanupClass: unknown
    releaseExplicitAudioTrack.mockImplementationOnce(
      () => 'explicit_audio_track_cleanup_failed'
    )
    startListening.mockImplementationOnce(async () => {
      cleanupClass = (window as any).__preparedSampleSttReleaseAudioTrack?.()
      return false
    })
    render(<PreparedSampleSttOperator />)
    prepareRunInputs()

    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: 'Start bounded attempt' })
      )
    })

    expect(cleanupClass).toBe('explicit_audio_track_cleanup_failed')
    expect(screen.getByTestId('prepared-sample-stt-status')).toHaveTextContent(
      'explicit_audio_track_cleanup_failed'
    )
    expect(document.body).not.toHaveTextContent(privateMarker)
    expect(document.body).not.toHaveTextContent('C:\\private\\hook-track.wav')
    expect(document.body).not.toHaveTextContent('native-cause')
  })

  it('propagates explicit start cleanup failure instead of unsupported status', async () => {
    const privateMarker =
      'PRIVATE_START C:\\private\\start-track.wav native-cause native-stack'
    mockAudioTrack.stop = jest.fn(() => {
      throw new Error(privateMarker)
    })
    startListening.mockImplementationOnce(async (track: MediaStreamTrack) => {
      mockHookOwnedTrack = track
      try {
        throw new DOMException(privateMarker, 'InvalidStateError')
      } catch {
        try {
          track.stop()
        } catch {
          // The hook converts native cleanup failure to the fixed result below.
        }
        mockHookOwnedTrack = null
        return 'explicit_audio_track_cleanup_failed'
      }
    })
    const { unmount } = render(<PreparedSampleSttOperator />)
    prepareRunInputs()

    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: 'Start bounded attempt' })
      )
    })

    expect(screen.getByTestId('prepared-sample-stt-status')).toHaveTextContent(
      'explicit_audio_track_cleanup_failed'
    )
    expect(
      screen.getByTestId('prepared-sample-stt-status')
    ).not.toHaveTextContent('explicit_speech_audio_track_unsupported')
    expect(mockAudioTrack.stop).toHaveBeenCalledTimes(1)
    expect(releaseExplicitAudioTrack).not.toHaveBeenCalled()
    expect(document.body).not.toHaveTextContent(privateMarker)
    expect(document.body).not.toHaveTextContent(privateDeviceId)
    expect(document.body).not.toHaveTextContent('C:\\private\\start-track.wav')
    expect(document.body).not.toHaveTextContent('native-cause')

    unmount()
    expect(mockAudioTrack.stop).toHaveBeenCalledTimes(1)
    expect(releaseExplicitAudioTrack).toHaveBeenCalledTimes(1)
  })

  it('preserves automatic retry cleanup failure against timeout and record completion', async () => {
    const privateMarker =
      'PRIVATE_RETRY C:\\private\\automatic-retry.wav native-cause native-stack'
    mockAudioTrack.stop = jest.fn(() => {
      throw new Error(privateMarker)
    })
    const { unmount } = render(<PreparedSampleSttOperator />)
    prepareRunInputs()

    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: 'Start bounded attempt' })
      )
    })
    expect(screen.getByTestId('prepared-sample-stt-status')).toHaveTextContent(
      'attempt_listening'
    )

    act(() => {
      try {
        throw new DOMException(privateMarker, 'InvalidStateError')
      } catch {
        try {
          mockHookOwnedTrack?.stop()
        } catch {
          // The hook reports the fixed cleanup class through its callback.
        }
        mockHookOwnedTrack = null
        mockIsListening = false
        mockExplicitAudioTrackCleanupFailed?.()
        mockExplicitAudioTrackCleanupFailed?.()
      }
    })

    expect(mockAudioTrack.stop).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('prepared-sample-stt-status')).toHaveTextContent(
      'explicit_audio_track_cleanup_failed'
    )
    expect(
      screen.getByRole('button', { name: 'Record final result' })
    ).toBeDisabled()
    expect(document.body).not.toHaveTextContent(privateMarker)
    expect(document.body).not.toHaveTextContent(privateDeviceId)
    expect(document.body).not.toHaveTextContent(
      'C:\\private\\automatic-retry.wav'
    )
    expect(document.body).not.toHaveTextContent('native-cause')

    await act(async () => {
      jest.advanceTimersByTime(10_000)
      fireEvent.click(
        screen.getByRole('button', { name: 'Record final result' })
      )
    })
    expect(stopListening).not.toHaveBeenCalled()
    expect(screen.getByTestId('prepared-sample-stt-status')).toHaveTextContent(
      'explicit_audio_track_cleanup_failed'
    )
    expect(screen.getByText('Attempts: 0/5')).toBeInTheDocument()

    unmount()
    expect(mockAudioTrack.stop).toHaveBeenCalledTimes(1)
    expect(releaseExplicitAudioTrack).toHaveBeenCalledTimes(1)
  })

  it('preserves normal-stop cleanup failure before recording an attempt', async () => {
    const privateMarker =
      'PRIVATE_STOP C:\\private\\normal-completion.wav native-cause native-stack'
    mockAudioTrack.stop = jest.fn(() => {
      throw new Error(privateMarker)
    })
    const { unmount } = render(<PreparedSampleSttOperator />)
    prepareRunInputs()

    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: 'Start bounded attempt' })
      )
    })
    expect(screen.getByTestId('prepared-sample-stt-status')).toHaveTextContent(
      'attempt_listening'
    )

    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: 'Record final result' })
      )
    })

    expect(stopListening).toHaveBeenCalledTimes(1)
    expect(mockAudioTrack.stop).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('prepared-sample-stt-status')).toHaveTextContent(
      'explicit_audio_track_cleanup_failed'
    )
    expect(screen.getByText('Attempts: 0/5')).toBeInTheDocument()
    expect(document.body).not.toHaveTextContent(privateMarker)
    expect(document.body).not.toHaveTextContent(privateDeviceId)
    expect(document.body).not.toHaveTextContent(
      'C:\\private\\normal-completion.wav'
    )
    expect(document.body).not.toHaveTextContent('native-cause')

    await act(async () => {
      jest.advanceTimersByTime(10_000)
      await Promise.resolve()
    })
    expect(screen.getByTestId('prepared-sample-stt-status')).toHaveTextContent(
      'explicit_audio_track_cleanup_failed'
    )
    expect(screen.getByText('Attempts: 0/5')).toBeInTheDocument()
    expect(mockAudioTrack.stop).toHaveBeenCalledTimes(1)

    unmount()
    expect(mockAudioTrack.stop).toHaveBeenCalledTimes(1)
  })

  it('sanitizes a rejected hook start and releases transferred ownership once', async () => {
    const nativeMessage =
      'native start failed for private-audio-input-device-id at C:\\private\\sample.wav; cause=native-cause'
    startListening.mockImplementationOnce(async (track: MediaStreamTrack) => {
      mockHookOwnedTrack = track
      throw new Error(nativeMessage)
    })
    render(<PreparedSampleSttOperator />)
    prepareRunInputs()

    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: 'Start bounded attempt' })
      )
    })

    expect(screen.getByTestId('prepared-sample-stt-status')).toHaveTextContent(
      'operator_setup_failed'
    )
    expect(mockAudioTrack.stop).toHaveBeenCalledTimes(1)
    expect(releaseExplicitAudioTrack).toHaveBeenCalledTimes(1)
    expect(document.body).not.toHaveTextContent(nativeMessage)
    expect(document.body).not.toHaveTextContent(privateDeviceId)
    expect(document.body).not.toHaveTextContent('C:\\private\\sample.wav')
    expect(document.body).not.toHaveTextContent('native-cause')
  })

  it('fails closed without a private explicit device selection', async () => {
    delete (window as any).__preparedSampleSttAudioInputDeviceId
    render(<PreparedSampleSttOperator />)
    prepareRunInputs()

    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: 'Start bounded attempt' })
      )
    })

    expect(screen.getByTestId('prepared-sample-stt-status')).toHaveTextContent(
      'explicit_audio_input_device_required'
    )
    expect(mockGetUserMedia).not.toHaveBeenCalled()
    expect(startListening).not.toHaveBeenCalled()
  })

  it('maps getUserMedia rejection to a fixed non-echoing status', async () => {
    const nativeMessage =
      'NotAllowedError for private-audio-input-device-id at C:\\private\\device.json; cause=native-cause'
    mockGetUserMedia.mockRejectedValueOnce(new Error(nativeMessage))
    render(<PreparedSampleSttOperator />)
    prepareRunInputs()

    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: 'Start bounded attempt' })
      )
    })

    expect(screen.getByTestId('prepared-sample-stt-status')).toHaveTextContent(
      'explicit_audio_input_acquisition_failed'
    )
    expect(startListening).not.toHaveBeenCalled()
    expect(document.body).not.toHaveTextContent(nativeMessage)
    expect(document.body).not.toHaveTextContent(privateDeviceId)
    expect(document.body).not.toHaveTextContent('C:\\private\\device.json')
    expect(document.body).not.toHaveTextContent('native-cause')
  })

  it('stops and rejects a track with missing getSettings', async () => {
    ;(
      mockAudioTrack as unknown as {
        getSettings?: () => MediaTrackSettings
      }
    ).getSettings = undefined
    render(<PreparedSampleSttOperator />)
    prepareRunInputs()

    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: 'Start bounded attempt' })
      )
    })

    expect(screen.getByTestId('prepared-sample-stt-status')).toHaveTextContent(
      'explicit_audio_input_settings_unavailable'
    )
    expect(mockAudioTrack.stop).toHaveBeenCalledTimes(1)
    expect(startListening).not.toHaveBeenCalled()
  })

  it('stops and sanitizes a throwing getSettings', async () => {
    const nativeMessage =
      'settings failed for private-audio-input-device-id at C:\\private\\settings.json; cause=native-cause'
    mockAudioTrack.getSettings = jest.fn(() => {
      throw new Error(nativeMessage)
    })
    render(<PreparedSampleSttOperator />)
    prepareRunInputs()

    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: 'Start bounded attempt' })
      )
    })

    expect(screen.getByTestId('prepared-sample-stt-status')).toHaveTextContent(
      'explicit_audio_input_settings_unavailable'
    )
    expect(mockAudioTrack.stop).toHaveBeenCalledTimes(1)
    expect(startListening).not.toHaveBeenCalled()
    expect(document.body).not.toHaveTextContent(nativeMessage)
    expect(document.body).not.toHaveTextContent(privateDeviceId)
    expect(document.body).not.toHaveTextContent('C:\\private\\settings.json')
    expect(document.body).not.toHaveTextContent('native-cause')
  })

  it('stops and reports a fixed selected-device mismatch status', async () => {
    const mismatchedDeviceId = 'other-private-device'
    mockAudioTrack = createMockAudioTrack({
      selectedDeviceId: mismatchedDeviceId,
    })
    render(<PreparedSampleSttOperator />)
    prepareRunInputs()

    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: 'Start bounded attempt' })
      )
    })

    expect(screen.getByTestId('prepared-sample-stt-status')).toHaveTextContent(
      'explicit_audio_input_device_mismatch'
    )
    expect(mockAudioTrack.stop).toHaveBeenCalledTimes(1)
    expect(startListening).not.toHaveBeenCalled()
    expect(document.body).not.toHaveTextContent(mismatchedDeviceId)
  })

  it('stops and rejects a track when capture processing remains enabled', async () => {
    mockAudioTrack = createMockAudioTrack({ echoCancellation: true })
    mockGetUserMedia.mockResolvedValueOnce({
      getTracks: () => [mockAudioTrack],
      getAudioTracks: () => [mockAudioTrack],
    })
    render(<PreparedSampleSttOperator />)
    prepareRunInputs()

    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: 'Start bounded attempt' })
      )
    })

    expect(screen.getByTestId('prepared-sample-stt-status')).toHaveTextContent(
      'explicit_audio_input_processing_not_disabled'
    )
    expect(startListening).not.toHaveBeenCalled()
    expect(mockAudioTrack.stop).toHaveBeenCalledTimes(1)
    expect(document.body).not.toHaveTextContent(privateDeviceId)
  })

  it.each([
    ['dead track', { readyState: 'ended' as MediaStreamTrackState }],
    ['non-audio track', { kind: 'video' }],
  ])('stops and rejects a %s', async (_name, options) => {
    mockAudioTrack = createMockAudioTrack(options)
    render(<PreparedSampleSttOperator />)
    prepareRunInputs()

    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: 'Start bounded attempt' })
      )
    })

    expect(screen.getByTestId('prepared-sample-stt-status')).toHaveTextContent(
      'explicit_audio_input_track_invalid'
    )
    expect(mockAudioTrack.stop).toHaveBeenCalledTimes(1)
    expect(startListening).not.toHaveBeenCalled()
  })

  it('stops every acquired track exactly once on stream validation failure', async () => {
    const extraTrack = createMockAudioTrack()
    mockGetUserMedia.mockImplementationOnce(async () => ({
      getTracks: () => [mockAudioTrack, extraTrack],
      getAudioTracks: () => [mockAudioTrack],
    }))
    render(<PreparedSampleSttOperator />)
    prepareRunInputs()

    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: 'Start bounded attempt' })
      )
    })

    expect(screen.getByTestId('prepared-sample-stt-status')).toHaveTextContent(
      'explicit_audio_input_track_invalid'
    )
    expect(mockAudioTrack.stop).toHaveBeenCalledTimes(1)
    expect(extraTrack.stop).toHaveBeenCalledTimes(1)
    expect(startListening).not.toHaveBeenCalled()
  })

  it('releases the owned track on operator unmount', async () => {
    const { unmount } = render(<PreparedSampleSttOperator />)
    prepareRunInputs()
    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: 'Start bounded attempt' })
      )
    })

    unmount()
    expect(mockAudioTrack.stop).toHaveBeenCalledTimes(1)
  })

  it('records timeout stop and content classes and prevents duplicate completion', async () => {
    render(<PreparedSampleSttOperator />)
    prepareRunInputs()
    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: 'Start bounded attempt' })
      )
    })
    dispatchDiagnostic({
      controller: 'browser_stt',
      event: 'onresult_final',
      transcript: 'prepared sample',
    })

    await act(async () => {
      jest.advanceTimersByTime(10_000)
      fireEvent.click(
        screen.getByRole('button', { name: 'Record final result' })
      )
    })

    expect(screen.getByTestId('prepared-sample-stt-status')).toHaveTextContent(
      'attempt_timeout'
    )
    expect(screen.getByText('Result events').nextSibling).toHaveTextContent('1')
    expect(screen.getByText('Final results').nextSibling).toHaveTextContent('1')
    expect(screen.getByText('Stability').nextSibling).toHaveTextContent(
      'incomplete_attempt_set'
    )
    expect(
      screen.getByText('last_attempt_content_match_class').nextSibling
    ).toHaveTextContent('timed_out')
    expect(
      screen.getByText('last_attempt_stop_class').nextSibling
    ).toHaveTextContent('attempt_timeout')
    expect(stopListening).toHaveBeenCalledTimes(1)
  })

  it('fails closed for a missing parent preflight query', () => {
    window.history.replaceState({}, '', '/operator/prepared-sample-stt')
    render(<PreparedSampleSttOperator />)
    expect(
      screen.getByTestId('prepared-sample-parent-preflight')
    ).toHaveTextContent('parent_preflight_query_required')
    expect(
      screen.getByRole('button', { name: 'Start bounded attempt' })
    ).toBeDisabled()
    expect(startListening).not.toHaveBeenCalled()
  })

  it.each([
    'Voice.local_sample_001',
    '1voice.local_sample_001',
    'voice%3Alocal_sample_001',
    'ab',
  ])(
    'fails closed before startListening for an invalid selected sample ID %s',
    (selectedSampleId) => {
      setParentPreflightQuery(
        `conversation_attempt_ref=${conversationAttemptRef}&selected_sample_id=${selectedSampleId}&sample_index_preflight_class=prepared_sample_index_verified&sample_index_preflight_ref=m4.sample_index_preflight_001`
      )
      render(<PreparedSampleSttOperator />)

      expect(
        screen.getByTestId('prepared-sample-parent-preflight')
      ).toHaveTextContent('parent_preflight_query_invalid')
      expect(
        screen.getByRole('button', { name: 'Start bounded attempt' })
      ).toBeDisabled()
      expect(startListening).not.toHaveBeenCalled()
    }
  )

  it('fails closed for other invalid parent preflight query parameters', () => {
    setParentPreflightQuery(
      'conversation_attempt_ref=bad%20ref&selected_sample_id=voice.local_sample_001&sample_index_preflight_class=unverified&sample_index_preflight_ref=m4.sample_index_preflight_001'
    )
    render(<PreparedSampleSttOperator />)

    expect(
      screen.getByTestId('prepared-sample-parent-preflight')
    ).toHaveTextContent('parent_preflight_query_invalid')
    expect(
      screen.getByRole('button', { name: 'Start bounded attempt' })
    ).toBeDisabled()
    expect(startListening).not.toHaveBeenCalled()
  })

  it.each(invalidConversationAttemptRefs)(
    'fails closed before startListening for invalid conversation attempt ref %s',
    (invalidRef) => {
      setParentPreflightQuery(
        `conversation_attempt_ref=${invalidRef}&selected_sample_id=voice.local_sample_001&sample_index_preflight_class=prepared_sample_index_verified&sample_index_preflight_ref=m4.sample_index_preflight_001`
      )
      render(<PreparedSampleSttOperator />)

      expect(
        screen.getByTestId('prepared-sample-parent-preflight')
      ).toHaveTextContent('parent_preflight_query_invalid')
      expect(
        screen.getByRole('button', { name: 'Start bounded attempt' })
      ).toBeDisabled()
      expect(startListening).not.toHaveBeenCalled()
    }
  )

  it('submits one accepted final with the retained ref and rejects a duplicate', async () => {
    render(<PreparedSampleSttOperator />)
    prepareRunInputs()

    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: 'Start bounded attempt' })
      )
      await Promise.resolve()
    })
    expect(mockOnChatProcessStart).toBeDefined()

    await act(async () => {
      mockOnChatProcessStart?.('private prepared speech')
      await Promise.resolve()
    })

    expect(mockSubmitAcceptedPreparedSampleBrowserSpeech).toHaveBeenCalledTimes(
      1
    )
    const envelope = mockSubmitAcceptedPreparedSampleBrowserSpeech.mock
      .calls[0][0] as {
      accepted_user_speech_candidate: Record<string, unknown>
      private_turn: {
        text: string
        context_refs: { conversation_attempt_ref: string }
      }
    }
    expect(envelope.private_turn).toMatchObject({
      text: 'private prepared speech',
      context_refs: { conversation_attempt_ref: conversationAttemptRef },
    })
    expect(
      JSON.stringify(envelope.accepted_user_speech_candidate)
    ).not.toContain('private prepared speech')
    expect(screen.getByTestId('prepared-sample-stt-status')).toHaveTextContent(
      'accepted_candidate_request_completed'
    )

    act(() => {
      mockOnChatProcessStart?.('changed private speech')
    })
    expect(mockSubmitAcceptedPreparedSampleBrowserSpeech).toHaveBeenCalledTimes(
      1
    )
    expect(screen.getByTestId('prepared-sample-stt-status')).toHaveTextContent(
      'accepted_final_duplicate_rejected'
    )
  })
})
