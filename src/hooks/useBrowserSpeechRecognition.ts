import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { getVoiceLanguageCode } from '@/utils/voiceLanguage'
import settingsStore from '@/features/stores/settings'
import toastStore from '@/features/stores/toast'
import homeStore from '@/features/stores/home'
import { useTranslation } from 'react-i18next'
import { useSilenceDetection } from './useSilenceDetection'
import { SpeakQueue } from '@/features/messages/speakQueue'

const isInvalidStateError = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  'name' in error &&
  (error as { name?: unknown }).name === 'InvalidStateError'

const isProjectionVisualSurface = (): boolean => {
  if (typeof window === 'undefined') {
    return false
  }

  return ['/projection-visual', '/touchdesigner-stage'].some((route) =>
    window.location.pathname.startsWith(route)
  )
}

const shouldKeepContinuousMicEnabledOnNoSpeech = (): boolean =>
  process.env.NEXT_PUBLIC_KEEP_CONTINUOUS_MIC_ON_NO_SPEECH === 'true' ||
  isProjectionVisualSurface()

const shouldPreflightMicrophonePermission = (): boolean => {
  const configured = process.env.NEXT_PUBLIC_BROWSER_STT_PERMISSION_PREFLIGHT
  if (configured === 'true') {
    return true
  }
  if (configured === 'false') {
    return false
  }

  return !isProjectionVisualSurface()
}

const parseNumberEnv = (
  value: string | undefined,
  fallback: number
): number => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

const getBrowserSttStartBufferMs = (): number =>
  Math.max(
    0,
    parseNumberEnv(
      process.env.NEXT_PUBLIC_BROWSER_STT_START_BUFFER_MS,
      isProjectionVisualSurface() ? 240 : 0
    )
  )

const getBrowserSttSoundWatchdogMs = (): number =>
  Math.max(
    800,
    parseNumberEnv(
      process.env.NEXT_PUBLIC_BROWSER_STT_SOUND_WATCHDOG_MS,
      isProjectionVisualSurface() ? 2200 : 3500
    )
  )

const getBrowserSttAudioRetryLimit = (): number =>
  Math.max(
    0,
    Math.floor(
      parseNumberEnv(process.env.NEXT_PUBLIC_BROWSER_STT_AUDIO_RETRY_LIMIT, 0)
    )
  )

const getBrowserSttRetryDelayMs = (): number =>
  Math.max(
    100,
    parseNumberEnv(process.env.NEXT_PUBLIC_BROWSER_STT_RETRY_DELAY_MS, 420)
  )

const wait = (ms: number) =>
  ms <= 0
    ? Promise.resolve()
    : new Promise<void>((resolve) => setTimeout(resolve, ms))

type BrowserSttPhase =
  | 'idle'
  | 'start_requested'
  | 'start_buffering'
  | 'permission_checking'
  | 'engine_starting'
  | 'listening_engine'
  | 'audio_open'
  | 'sound_detected'
  | 'speech_detected'
  | 'recognizing'
  | 'result_ready'
  | 'speech_ending'
  | 'audio_closed'
  | 'restart_pending'
  | 'retry_wait'
  | 'stopping'
  | 'ended'
  | 'error'
  | 'canceled'

type SttDiagnosticPayload = {
  event: string
  phase?: BrowserSttPhase
  controller?: string
  detail?: string
  error?: string
  transcript?: string
  elapsedMs?: number
  attempt?: number
  listening?: boolean
  recognitionActive?: boolean
  speechDetected?: boolean
  updatedAt: string
}

const dispatchSttDiagnostic = (
  payload: Omit<SttDiagnosticPayload, 'updatedAt'>
) => {
  if (typeof window === 'undefined') {
    return
  }

  const detail: SttDiagnosticPayload = {
    ...payload,
    updatedAt: new Date().toISOString(),
  }

  ;(window as any).__projectionVisualSttDiagnostic = detail
  if (detail.controller === 'browser_stt') {
    ;(window as any).__projectionVisualBrowserSttDiagnostic = detail
  }
  window.dispatchEvent(
    new CustomEvent('projection-visual-stt-diagnostic', {
      detail,
    })
  )
}

const formatRecognitionError = (error: unknown): string => {
  if (!error || typeof error !== 'object') {
    return String(error)
  }

  const record = error as { name?: unknown; message?: unknown }
  return [record.name, record.message].filter(Boolean).join(': ')
}

/**
 * ブラウザの音声認識APIを使用するためのカスタムフック
 */
export function useBrowserSpeechRecognition(
  onChatProcessStart: (text: string) => void
) {
  const { t } = useTranslation()
  const selectLanguage = settingsStore((s) => s.selectLanguage)
  const initialSpeechTimeout = settingsStore((s) => s.initialSpeechTimeout)

  // ----- 状態管理 -----
  const [userMessage, setUserMessage] = useState('')
  const [isListening, setIsListening] = useState(false)
  const isListeningRef = useRef(false)

  // ----- 音声認識関連 -----
  const [, setRecognition] = useState<SpeechRecognition | null>(null)
  const recognitionRef = useRef<SpeechRecognition | null>(null)
  const transcriptRef = useRef('')
  const speechDetectedRef = useRef<boolean>(false)
  const recognitionStartTimeRef = useRef<number>(0)
  const initialSpeechCheckTimerRef = useRef<NodeJS.Timeout | null>(null)
  // ----- 競合状態防止: 再起動タイマーの追跡 -----
  const restartTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const staleActiveRestartTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  // ----- 音声認識が実際に動作中かどうかを追跡 -----
  // true: onstart発火済み（動作中）, false: onend発火済み（停止中）
  const recognitionActiveRef = useRef<boolean>(false)
  // ----- 開始処理中かどうかを追跡（排他制御用） -----
  const isStartingRef = useRef<boolean>(false)
  // ----- SpeechRecognition初期化前に来た開始要求を保持 -----
  const pendingStartRef = useRef<boolean>(false)
  // ----- Chrome Web Speech API 制御状態 -----
  const recognitionPhaseRef = useRef<BrowserSttPhase>('idle')
  const startGenerationRef = useRef(0)
  const audioRetryCountRef = useRef(0)
  const controlledRestartRef = useRef(false)
  // ----- Chrome Web Speech API の入力段階診断 -----
  const recognitionProgressTimerRef = useRef<NodeJS.Timeout | null>(null)
  const recognitionSignalRef = useRef({
    audioStarted: false,
    soundStarted: false,
    speechStarted: false,
    resultSeen: false,
  })
  const startListeningRef = useRef<() => Promise<boolean>>(async () => false)
  const stopListeningRef = useRef<() => Promise<void>>(async () => {})
  const setupInitialSpeechTimerRef = useRef<
    (stopListeningFn: () => Promise<void>) => void
  >(() => {})
  const startSilenceDetectionRef = useRef<
    (stopListeningFn: () => Promise<void>) => void
  >(() => {})
  const updateSpeechTimestampRef = useRef<() => void>(() => {})
  const handleNoSpeechTimeoutRef = useRef<
    (stopListeningFn: () => Promise<void>) => Promise<void>
  >(async () => {})
  const initialSpeechTimeoutRef = useRef(initialSpeechTimeout)
  const selectLanguageRef = useRef(selectLanguage)
  const tRef = useRef(t)

  useEffect(() => {
    return () => {
      if (staleActiveRestartTimeoutRef.current) {
        clearTimeout(staleActiveRestartTimeoutRef.current)
        staleActiveRestartTimeoutRef.current = null
      }
    }
  }, [])

  // ----- キーボードトリガー関連 -----
  const keyPressStartTime = useRef<number | null>(null)
  const isKeyboardTriggered = useRef(false)

  // ----- 無音検出フックを使用 -----
  const {
    silenceTimeoutRemaining,
    clearSilenceDetection,
    startSilenceDetection,
    updateSpeechTimestamp,
    isSpeechEnded,
  } = useSilenceDetection({
    onTextDetected: onChatProcessStart,
    transcriptRef,
    setUserMessage,
    speechDetectedRef,
  })

  // ----- 初期音声検出タイマーをクリアする関数 -----
  const clearInitialSpeechCheckTimer = useCallback(() => {
    if (initialSpeechCheckTimerRef.current) {
      clearTimeout(initialSpeechCheckTimerRef.current)
      initialSpeechCheckTimerRef.current = null
    }
  }, [])

  const clearRecognitionProgressTimer = useCallback(() => {
    if (recognitionProgressTimerRef.current) {
      clearTimeout(recognitionProgressTimerRef.current)
      recognitionProgressTimerRef.current = null
    }
  }, [])

  const setRecognitionPhase = useCallback(
    (
      phase: BrowserSttPhase,
      event: string,
      payload: Partial<Omit<SttDiagnosticPayload, 'event' | 'updatedAt'>> = {}
    ) => {
      recognitionPhaseRef.current = phase
      dispatchSttDiagnostic({
        event,
        phase,
        controller: 'browser_stt',
        listening: isListeningRef.current,
        recognitionActive: recognitionActiveRef.current,
        speechDetected: speechDetectedRef.current,
        elapsedMs: recognitionStartTimeRef.current
          ? Date.now() - recognitionStartTimeRef.current
          : undefined,
        ...payload,
      })
    },
    []
  )

  // ----- 音声未検出時の停止処理を実行する共通関数 (Requirement 5.1) -----
  const handleNoSpeechTimeout = useCallback(
    async (stopListeningFn: () => Promise<void>) => {
      console.log(
        `⏱️ ${initialSpeechTimeout}秒間音声が検出されませんでした。音声認識を停止します。`
      )
      setRecognitionPhase('error', 'no_speech_timeout', {
        detail: `${initialSpeechTimeout}s without transcript`,
      })
      await stopListeningFn()

      // Projection Visual keeps the continuous listener armed so it can recover
      // after long idle periods during a performance.
      if (settingsStore.getState().continuousMicListeningMode) {
        if (shouldKeepContinuousMicEnabledOnNoSpeech()) {
          console.log('🔄 音声未検出ですが常時マイク入力モードを維持します。')
        } else {
          console.log(
            '🔇 音声未検出により常時マイク入力モードをOFFに設定します。'
          )
          settingsStore.setState({ continuousMicListeningMode: false })
        }
      }

      toastStore.getState().addToast({
        message: t('Toasts.NoSpeechDetected'),
        type: 'info',
        tag: 'no-speech-detected',
      })
    },
    [initialSpeechTimeout, setRecognitionPhase, t]
  )

  // ----- 初期音声検出タイマーをセットアップする共通関数 (Requirement 5.1) -----
  const setupInitialSpeechTimer = useCallback(
    (stopListeningFn: () => Promise<void>) => {
      // 既存のタイマーをクリアしてから新しいタイマーを設定 (Requirement 5.2)
      clearInitialSpeechCheckTimer()

      if (initialSpeechTimeout > 0) {
        initialSpeechCheckTimerRef.current = setTimeout(() => {
          if (!speechDetectedRef.current && isListeningRef.current) {
            handleNoSpeechTimeout(stopListeningFn)
          }
        }, initialSpeechTimeout * 1000)
      }
    },
    [initialSpeechTimeout, clearInitialSpeechCheckTimer, handleNoSpeechTimeout]
  )

  const waitForRecognitionReady = useCallback(async () => {
    if (recognitionRef.current) {
      return recognitionRef.current
    }

    for (let attempt = 0; attempt < 20; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 50))
      if (recognitionRef.current) {
        return recognitionRef.current
      }
    }

    return null
  }, [])

  // ----- 音声認識停止処理 -----
  const stopListening = useCallback(async () => {
    startGenerationRef.current += 1
    audioRetryCountRef.current = 0
    controlledRestartRef.current = false
    setRecognitionPhase('stopping', 'stop_requested')

    // 保留中の再起動タイマーをキャンセル (競合状態防止)
    if (restartTimeoutRef.current) {
      clearTimeout(restartTimeoutRef.current)
      restartTimeoutRef.current = null
    }
    if (staleActiveRestartTimeoutRef.current) {
      clearTimeout(staleActiveRestartTimeoutRef.current)
      staleActiveRestartTimeoutRef.current = null
    }

    // 各種タイマーをクリア
    clearSilenceDetection()
    clearInitialSpeechCheckTimer()
    clearRecognitionProgressTimer()

    // リスニング状態を更新
    isListeningRef.current = false
    setIsListening(false)

    const recognition = recognitionRef.current
    if (!recognition) {
      setRecognitionPhase('idle', 'stop_complete', {
        detail: 'SpeechRecognition instance is not ready',
        listening: false,
        recognitionActive: false,
      })
      return
    }

    // 音声認識を停止
    try {
      recognition.stop()
    } catch (error) {
      console.error('Error stopping recognition:', error)
    }
    recognitionActiveRef.current = false
    setRecognitionPhase('stopping', 'stop_called', {
      detail: 'SpeechRecognition.stop() requested; marking controller inactive',
      listening: false,
      recognitionActive: false,
    })

    // キーボードトリガーの場合の処理
    const trimmedTranscriptRef = transcriptRef.current.trim()
    if (isKeyboardTriggered.current) {
      const pressDuration = Date.now() - (keyPressStartTime.current || 0)
      // 押してから1秒以上 かつ 文字が存在する場合のみ送信
      // 無音検出による自動送信が既に行われていない場合のみ送信する
      if (pressDuration >= 1000 && trimmedTranscriptRef && !isSpeechEnded()) {
        onChatProcessStart(trimmedTranscriptRef)
        setUserMessage('')
      }
      isKeyboardTriggered.current = false
    }
  }, [
    clearSilenceDetection,
    clearInitialSpeechCheckTimer,
    clearRecognitionProgressTimer,
    isSpeechEnded,
    onChatProcessStart,
    setRecognitionPhase,
  ])

  // ----- マイク権限確認 -----
  const checkMicrophonePermission = useCallback(async (): Promise<boolean> => {
    // Firefoxの場合はエラーメッセージを表示して終了
    if (navigator.userAgent.toLowerCase().includes('firefox')) {
      toastStore.getState().addToast({
        message: t('Toasts.FirefoxNotSupported'),
        type: 'error',
        tag: 'microphone-permission-error-firefox',
      })
      return false
    }

    if (!shouldPreflightMicrophonePermission()) {
      setRecognitionPhase(
        'permission_checking',
        'permission_preflight_skipped',
        {
          detail:
            'Skipped getUserMedia preflight; SpeechRecognition.start() owns microphone capture',
        }
      )
      return true
    }

    try {
      setRecognitionPhase('permission_checking', 'permission_request', {
        detail: 'navigator.mediaDevices.getUserMedia({ audio: true })',
      })
      // getUserMediaを直接呼び出し、ブラウザのネイティブ許可モーダルを表示
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      stream.getTracks().forEach((track) => track.stop())
      setRecognitionPhase('permission_checking', 'permission_granted', {
        detail: 'microphone permission ok',
      })
      return true
    } catch (error) {
      // ユーザーが明示的に拒否した場合や、その他のエラーの場合
      console.error('Microphone permission error:', error)
      setRecognitionPhase('error', 'permission_denied', {
        error: formatRecognitionError(error),
      })
      toastStore.getState().addToast({
        message: t('Toasts.MicrophonePermissionDenied'),
        type: 'error',
        tag: 'microphone-permission-error',
      })
      return false
    }
  }, [setRecognitionPhase, t])

  // ----- 音声認識開始処理 -----
  const startListening = useCallback(async () => {
    // 排他制御: 既に開始処理中の場合は何もしない
    if (isStartingRef.current) {
      console.log('Recognition start already in progress, skipping')
      setRecognitionPhase(recognitionPhaseRef.current, 'start_skipped', {
        detail: 'start already in progress',
      })
      return false
    }
    const wasListeningAtStart = isListeningRef.current
    isStartingRef.current = true
    if (
      !isListeningRef.current &&
      recognitionPhaseRef.current !== 'retry_wait'
    ) {
      audioRetryCountRef.current = 0
      controlledRestartRef.current = false
    }
    const startGeneration = startGenerationRef.current + 1
    startGenerationRef.current = startGeneration
    setRecognitionPhase('start_requested', 'start_requested')

    // 保留中の再起動タイマーをキャンセル (onendハンドラとの競合状態防止)
    if (restartTimeoutRef.current) {
      clearTimeout(restartTimeoutRef.current)
      restartTimeoutRef.current = null
    }
    if (staleActiveRestartTimeoutRef.current) {
      clearTimeout(staleActiveRestartTimeoutRef.current)
      staleActiveRestartTimeoutRef.current = null
    }

    try {
      isListeningRef.current = true
      setIsListening(true)

      const startBufferMs = getBrowserSttStartBufferMs()
      if (startBufferMs > 0) {
        setRecognitionPhase('start_buffering', 'controller_start_buffer', {
          detail: `${startBufferMs}ms before recognition.start()`,
        })
        await wait(startBufferMs)
        if (
          startGenerationRef.current !== startGeneration ||
          !isListeningRef.current
        ) {
          setRecognitionPhase('canceled', 'start_canceled', {
            detail: 'start request was superseded during buffer',
            listening: isListeningRef.current,
          })
          return false
        }
      }

      setRecognitionPhase('permission_checking', 'permission_checking')
      const hasPermission = await checkMicrophonePermission()
      if (!hasPermission) {
        setRecognitionPhase('error', 'start_failed', {
          detail: 'microphone permission denied',
          listening: false,
          recognitionActive: false,
        })
        isListeningRef.current = false
        setIsListening(false)
        isStartingRef.current = false
        return false
      }
      if (
        startGenerationRef.current !== startGeneration ||
        !isListeningRef.current
      ) {
        setRecognitionPhase('canceled', 'start_canceled', {
          detail: 'start request was superseded after permission check',
          listening: isListeningRef.current,
        })
        return false
      }

      setRecognitionPhase('engine_starting', 'engine_starting')
      const recognition = await waitForRecognitionReady()
      if (!recognition) {
        pendingStartRef.current = true
        setRecognitionPhase('engine_starting', 'start_failed', {
          detail: 'SpeechRecognition instance is not ready; start queued',
        })
        isStartingRef.current = false
        return false
      }
      if (
        startGenerationRef.current !== startGeneration ||
        !isListeningRef.current
      ) {
        setRecognitionPhase('canceled', 'start_canceled', {
          detail: 'start request was superseded before recognition.start()',
          listening: isListeningRef.current,
        })
        return false
      }

      // start() は同じ Recognition インスタンスに対して二重に呼ぶと
      // InvalidStateError になるため、既に起動中なら開始成功扱いで返す。
      if (recognitionActiveRef.current) {
        if (!wasListeningAtStart) {
          console.warn(
            'Recognition active flag is stale while controller is idle; aborting before restart'
          )
          recognitionActiveRef.current = false
          controlledRestartRef.current = true
          setRecognitionPhase('retry_wait', 'controller_restart_stale_active', {
            detail:
              'Controller was idle but SpeechRecognition still looked active; abort and retry start',
            listening: true,
            recognitionActive: false,
          })
          try {
            recognition.abort()
          } catch (abortError) {
            console.warn(
              'Failed to abort stale SpeechRecognition before restart:',
              abortError
            )
          }
          if (staleActiveRestartTimeoutRef.current) {
            clearTimeout(staleActiveRestartTimeoutRef.current)
          }
          const staleRestartGeneration = startGenerationRef.current
          staleActiveRestartTimeoutRef.current = setTimeout(() => {
            staleActiveRestartTimeoutRef.current = null
            controlledRestartRef.current = false
            if (startGenerationRef.current === staleRestartGeneration) {
              startListening()
            }
          }, getBrowserSttRetryDelayMs())
          return false
        }

        console.log('Recognition already active, skipping start')
        setRecognitionPhase('listening_engine', 'start_skipped', {
          detail: 'recognition already active',
          listening: true,
          recognitionActive: true,
        })
        isListeningRef.current = true
        setIsListening(true)
        return true
      }

      // トランスクリプトをリセット
      transcriptRef.current = ''
      setUserMessage('')

      try {
        recognition.start()
        console.log('Recognition started successfully')
        setRecognitionPhase('engine_starting', 'start_called', {
          detail: 'recognition.start() returned',
          listening: true,
          recognitionActive: recognitionActiveRef.current,
        })
        // onstart が実際の起動完了。ここでは制御上のリスニング要求だけ保持する。
        isListeningRef.current = true
        setIsListening(true)
        return true
      } catch (error) {
        // InvalidStateErrorの場合は、既に開始されているとみなす
        if (isInvalidStateError(error)) {
          console.warn('Recognition is already running, skipping retry')
          // 既に実行中なので、リスニング状態を更新する
          recognitionActiveRef.current = true
          isListeningRef.current = true
          setIsListening(true)

          // onstart イベントハンドラと同様の処理を手動で実行
          console.log('Speech recognition started (manually triggered)')
          setRecognitionPhase('listening_engine', 'start_reused', {
            detail: 'InvalidStateError treated as active',
            listening: true,
            recognitionActive: true,
          })
          recognitionStartTimeRef.current = Date.now()
          speechDetectedRef.current = false

          // 初期音声検出タイマー設定 (Requirement 5.2: 共通関数を使用)
          setupInitialSpeechTimer(stopListening)

          // 無音検出開始
          startSilenceDetection(stopListening)
          return true
        } else {
          console.error('Error starting recognition:', error)
          setRecognitionPhase('error', 'start_error', {
            error: formatRecognitionError(error),
          })

          // その他のエラーの場合のみ再試行
          setTimeout(() => {
            try {
              const recognition = recognitionRef.current
              if (recognition) {
                // 一度確実に停止を試みる
                try {
                  recognition.stop()
                  // 停止後に短い遅延
                  setTimeout(() => {
                    try {
                      recognition.start()
                      console.log('Recognition started on retry')
                      dispatchSttDiagnostic({
                        event: 'retry_started',
                        detail: 'recognition.start() succeeded on retry',
                        listening: true,
                        recognitionActive: true,
                      })
                      recognitionActiveRef.current = true
                      isListeningRef.current = true
                      setIsListening(true)
                    } catch (startError) {
                      if (isInvalidStateError(startError)) {
                        console.warn(
                          'Recognition is already running on delayed retry, skipping'
                        )
                        dispatchSttDiagnostic({
                          event: 'retry_reused',
                          detail: 'already running on delayed retry',
                          listening: true,
                          recognitionActive: true,
                        })
                        recognitionActiveRef.current = true
                        isListeningRef.current = true
                        setIsListening(true)
                      } else {
                        console.error(
                          'Failed to start recognition on delayed retry:',
                          startError
                        )
                        dispatchSttDiagnostic({
                          event: 'retry_error',
                          error: formatRecognitionError(startError),
                          listening: false,
                          recognitionActive: false,
                        })
                        recognitionActiveRef.current = false
                        isListeningRef.current = false
                        setIsListening(false)
                      }
                    }
                  }, 100)
                } catch (stopError) {
                  // 停止できなかった場合は直接スタート
                  try {
                    recognition.start()
                    console.log('Recognition started on retry without stopping')
                    dispatchSttDiagnostic({
                      event: 'retry_started',
                      detail: 'retry without stopping succeeded',
                      listening: true,
                      recognitionActive: true,
                    })
                    recognitionActiveRef.current = true
                    isListeningRef.current = true
                    setIsListening(true)
                  } catch (startError) {
                    if (isInvalidStateError(startError)) {
                      console.warn(
                        'Recognition is already running on retry, skipping'
                      )
                      dispatchSttDiagnostic({
                        event: 'retry_reused',
                        detail: 'already running on retry',
                        listening: true,
                        recognitionActive: true,
                      })
                      recognitionActiveRef.current = true
                      isListeningRef.current = true
                      setIsListening(true)
                    } else {
                      console.error(
                        'Failed to start recognition on retry:',
                        startError
                      )
                      dispatchSttDiagnostic({
                        event: 'retry_error',
                        error: formatRecognitionError(startError),
                        listening: false,
                        recognitionActive: false,
                      })
                      recognitionActiveRef.current = false
                      isListeningRef.current = false
                      setIsListening(false)
                    }
                  }
                }
              }
            } catch (retryError) {
              console.error('Failed to start recognition on retry:', retryError)
              dispatchSttDiagnostic({
                event: 'retry_exception',
                error: formatRecognitionError(retryError),
                listening: false,
                recognitionActive: false,
              })
              recognitionActiveRef.current = false
              isListeningRef.current = false
              setIsListening(false)
              return
            }
          }, 300)
          return false
        }
      }
    } finally {
      // 排他制御を解除
      isStartingRef.current = false
    }
  }, [
    checkMicrophonePermission,
    setRecognitionPhase,
    setupInitialSpeechTimer,
    startSilenceDetection,
    stopListening,
    waitForRecognitionReady,
  ])

  // ----- 音声認識トグル処理 -----
  const toggleListening = useCallback(() => {
    if (isListeningRef.current) {
      stopListening()
    } else {
      keyPressStartTime.current = Date.now()
      isKeyboardTriggered.current = true
      startListening()
      // AIの発話を停止
      homeStore.setState({ isSpeaking: false })
    }
  }, [startListening, stopListening])

  // ----- メッセージ送信 -----
  const handleSendMessage = useCallback(async () => {
    const trimmedMessage = userMessage.trim()
    if (trimmedMessage) {
      // AIの発話を停止
      homeStore.setState({ isSpeaking: false })
      SpeakQueue.stopAll()

      // マイク入力を停止（常時音声入力モード時も自動送信と同様に停止）
      await stopListening()

      onChatProcessStart(trimmedMessage)
      setUserMessage('')
    }
  }, [userMessage, onChatProcessStart, stopListening])

  // ----- メッセージ入力 -----
  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setUserMessage(e.target.value)
    },
    []
  )

  useEffect(() => {
    startListeningRef.current = startListening
    stopListeningRef.current = stopListening
    setupInitialSpeechTimerRef.current = setupInitialSpeechTimer
    startSilenceDetectionRef.current = startSilenceDetection
    updateSpeechTimestampRef.current = updateSpeechTimestamp
    handleNoSpeechTimeoutRef.current = handleNoSpeechTimeout
    initialSpeechTimeoutRef.current = initialSpeechTimeout
    tRef.current = t
  }, [
    handleNoSpeechTimeout,
    initialSpeechTimeout,
    setupInitialSpeechTimer,
    startListening,
    startSilenceDetection,
    stopListening,
    t,
    updateSpeechTimestamp,
  ])

  useEffect(() => {
    selectLanguageRef.current = selectLanguage
    const recognition = recognitionRef.current
    if (recognition) {
      recognition.lang = getVoiceLanguageCode(selectLanguage)
    }
  }, [selectLanguage])

  // ----- 音声認識オブジェクトの初期化とイベントハンドラ設定 -----
  useEffect(() => {
    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition

    if (!SpeechRecognition) {
      console.error('Speech Recognition API is not supported in this browser')
      setRecognitionPhase('error', 'unsupported', {
        detail: 'SpeechRecognition API is not available',
        listening: false,
        recognitionActive: false,
      })
      toastStore.getState().addToast({
        message: tRef.current('Toasts.SpeechRecognitionNotSupported'),
        type: 'error',
        tag: 'speech-recognition-not-supported',
      })
      return
    }

    const newRecognition = new SpeechRecognition()
    newRecognition.lang = getVoiceLanguageCode(selectLanguageRef.current)
    newRecognition.continuous = true
    newRecognition.interimResults = true

    // ----- イベントハンドラの設定 -----

    const dispatchRecognitionSignal = (
      phase: BrowserSttPhase,
      event: string,
      detail?: string,
      updates?: Partial<typeof recognitionSignalRef.current>
    ) => {
      recognitionSignalRef.current = {
        ...recognitionSignalRef.current,
        ...updates,
      }
      setRecognitionPhase(phase, event, {
        detail,
      })
    }

    const scheduleControllerRestart = (detail: string) => {
      if (restartTimeoutRef.current) {
        return
      }

      const retryDelayMs = getBrowserSttRetryDelayMs()
      restartTimeoutRef.current = setTimeout(() => {
        restartTimeoutRef.current = null
        if (isListeningRef.current) {
          setRecognitionPhase(
            'restart_pending',
            'controller_restart_starting',
            {
              detail,
              attempt: audioRetryCountRef.current,
            }
          )
          controlledRestartRef.current = false
          startListeningRef.current()
        }
      }, retryDelayMs)
    }

    const retryAudioOpenWithoutSound = (reason: string) => {
      const retryLimit = getBrowserSttAudioRetryLimit()
      if (retryLimit <= 0) {
        setRecognitionPhase('audio_open', 'controller_retry_disabled', {
          detail: `${reason}; keeping current SpeechRecognition session open`,
          attempt: 0,
        })
        return
      }

      if (audioRetryCountRef.current >= retryLimit) {
        setRecognitionPhase('audio_open', 'controller_retry_exhausted', {
          detail: `${reason}; retry limit ${retryLimit} reached`,
          attempt: audioRetryCountRef.current,
        })
        return
      }

      audioRetryCountRef.current += 1
      controlledRestartRef.current = true
      setRecognitionPhase('retry_wait', 'controller_retry_audio_no_sound', {
        detail: `${reason}; abort and restart SpeechRecognition`,
        attempt: audioRetryCountRef.current,
      })

      const recognition = recognitionRef.current
      recognitionActiveRef.current = false
      clearRecognitionProgressTimer()
      try {
        recognition?.abort()
      } catch (error) {
        console.warn('Failed to abort SpeechRecognition for retry:', error)
        try {
          recognition?.stop()
        } catch (stopError) {
          console.warn('Failed to stop SpeechRecognition for retry:', stopError)
        }
      }

      scheduleControllerRestart(reason)
    }

    const scheduleRecognitionProgressDiagnostic = () => {
      clearRecognitionProgressTimer()
      recognitionProgressTimerRef.current = setTimeout(() => {
        recognitionProgressTimerRef.current = null

        if (!isListeningRef.current || !recognitionActiveRef.current) {
          return
        }

        const signal = recognitionSignalRef.current
        let event = 'onstart_no_audio'
        let phase: BrowserSttPhase = 'listening_engine'
        let detail =
          'No onaudiostart event; Chrome SpeechRecognition started but no audio reached Web Speech'

        if (signal.audioStarted && !signal.soundStarted) {
          event = 'audio_no_sound'
          phase = 'audio_open'
          detail = 'Audio input opened, but Web Speech did not detect sound'
        } else if (signal.soundStarted && !signal.speechStarted) {
          event = 'sound_no_speech'
          phase = 'sound_detected'
          detail =
            'Sound detected, but Web Speech did not classify it as speech'
        } else if (signal.speechStarted && !signal.resultSeen) {
          event = 'speech_no_result'
          phase = 'speech_detected'
          detail =
            'Speech detected, but Web Speech has not returned a transcript'
        } else if (signal.resultSeen) {
          return
        }

        setRecognitionPhase(phase, event, {
          detail,
        })

        if (event === 'audio_no_sound') {
          retryAudioOpenWithoutSound(detail)
        }
      }, getBrowserSttSoundWatchdogMs())
    }

    // 音声認識開始時
    newRecognition.onstart = () => {
      console.log('Speech recognition started')
      recognitionSignalRef.current = {
        audioStarted: false,
        soundStarted: false,
        speechStarted: false,
        resultSeen: false,
      }
      setRecognitionPhase('listening_engine', 'onstart', {
        detail: `lang=${newRecognition.lang}`,
        recognitionActive: true,
      })
      recognitionStartTimeRef.current = Date.now()
      speechDetectedRef.current = false
      // 音声認識が実際に動作中であることを記録
      recognitionActiveRef.current = true
      scheduleRecognitionProgressDiagnostic()

      // 初期音声検出タイマー設定 (Requirement 5.2: 共通関数を使用)
      setupInitialSpeechTimerRef.current(stopListeningRef.current)

      // 無音検出開始
      startSilenceDetectionRef.current(stopListeningRef.current)
    }

    newRecognition.onaudiostart = () => {
      console.log('🎙️ Web Speech audio capture started（onaudiostart）')
      dispatchRecognitionSignal(
        'audio_open',
        'onaudiostart',
        'audio capture started',
        {
          audioStarted: true,
        }
      )
      scheduleRecognitionProgressDiagnostic()
    }

    newRecognition.onsoundstart = () => {
      console.log('🔊 Web Speech sound detected（onsoundstart）')
      clearRecognitionProgressTimer()
      dispatchRecognitionSignal(
        'sound_detected',
        'onsoundstart',
        'sound detected',
        {
          audioStarted: true,
          soundStarted: true,
        }
      )
      scheduleRecognitionProgressDiagnostic()
    }

    // 音声入力検出時
    newRecognition.onspeechstart = () => {
      console.log('🗣️ 音声入力を検出しました（onspeechstart）')
      recognitionSignalRef.current = {
        ...recognitionSignalRef.current,
        audioStarted: true,
        soundStarted: true,
        speechStarted: true,
      }
      setRecognitionPhase('speech_detected', 'onspeechstart')
      scheduleRecognitionProgressDiagnostic()
      // ここではタイマーをリセットするだけで、speechDetectedRefは設定しない
      updateSpeechTimestampRef.current()
    }

    // 音量レベル追跡用変数
    let lastTranscriptLength = 0

    // 音声認識結果が得られたとき
    newRecognition.onresult = (event) => {
      if (!isListeningRef.current) return

      const transcript = Array.from(event.results)
        .map((result) => result[0].transcript)
        .join('')
      const hasFinalResult = Array.from(event.results).some(
        (result) => result.isFinal
      )

      // 有意な変化があるかチェック
      const isSignificantChange =
        transcript.trim().length > lastTranscriptLength
      lastTranscriptLength = transcript.trim().length

      if (isSignificantChange) {
        console.log('🎤 有意な音声を検出しました（トランスクリプト変更あり）')
        recognitionSignalRef.current = {
          ...recognitionSignalRef.current,
          resultSeen: true,
        }
        clearRecognitionProgressTimer()
        setRecognitionPhase(
          hasFinalResult ? 'result_ready' : 'recognizing',
          hasFinalResult ? 'onresult_final' : 'onresult_interim',
          {
            transcript: transcript.trim().slice(-120),
            detail: `${transcript.trim().length} chars`,
            speechDetected: true,
          }
        )
        updateSpeechTimestampRef.current()
        speechDetectedRef.current = true
      } else {
        console.log(
          '🔇 バックグラウンドノイズを無視します（トランスクリプト変更なし）'
        )
        recognitionSignalRef.current = {
          ...recognitionSignalRef.current,
          resultSeen: true,
        }
        clearRecognitionProgressTimer()
        setRecognitionPhase('recognizing', 'onresult_unchanged', {
          detail: `${transcript.trim().length} chars`,
        })
      }

      transcriptRef.current = transcript
      setUserMessage(transcript)
    }

    // 音声入力終了時
    newRecognition.onspeechend = () => {
      console.log(
        '🛑 音声入力が終了しました（onspeechend）。無音検出タイマーが動作中です。'
      )
      setRecognitionPhase('speech_ending', 'onspeechend', {
        transcript: transcriptRef.current.trim().slice(-120),
      })
    }

    newRecognition.onsoundend = () => {
      console.log('🔈 Web Speech sound ended（onsoundend）')
      dispatchRecognitionSignal('speech_ending', 'onsoundend', 'sound ended')
    }

    newRecognition.onaudioend = () => {
      console.log('🎙️ Web Speech audio capture ended（onaudioend）')
      clearRecognitionProgressTimer()
      dispatchRecognitionSignal(
        'audio_closed',
        'onaudioend',
        'audio capture ended'
      )
    }

    // 音声認識終了時
    newRecognition.onend = () => {
      console.log('Recognition ended')
      clearRecognitionProgressTimer()
      setRecognitionPhase('ended', 'onend', {
        transcript: transcriptRef.current.trim().slice(-120),
        recognitionActive: false,
      })
      // 音声認識が停止したことを記録
      recognitionActiveRef.current = false
      clearSilenceDetection()
      clearInitialSpeechCheckTimer()

      // isListeningRef.currentがtrueの場合は再開
      if (isListeningRef.current) {
        console.log('Restarting speech recognition...')
        setRecognitionPhase('restart_pending', 'restart_pending', {
          detail: 'onend while controller still wants listening',
        })
        if (restartTimeoutRef.current) {
          return
        }
        // 再起動タイマーをrefに保存して追跡 (競合状態防止)
        restartTimeoutRef.current = setTimeout(() => {
          // setTimeout実行時に再度状態を確認 (競合状態防止)
          if (isListeningRef.current) {
            startListeningRef.current()
          }
          restartTimeoutRef.current = null
        }, 1000)
      }
    }

    newRecognition.onnomatch = () => {
      clearRecognitionProgressTimer()
      dispatchRecognitionSignal(
        'speech_detected',
        'onnomatch',
        'Web Speech heard input but did not produce a recognition match'
      )
    }

    // 音声認識エラー時
    newRecognition.onerror = (event) => {
      console.error('Speech recognition error:', event.error)
      clearRecognitionProgressTimer()
      if (event.error === 'aborted' && controlledRestartRef.current) {
        setRecognitionPhase('retry_wait', 'controller_abort_ack', {
          detail: 'SpeechRecognition aborted for controlled restart',
          attempt: audioRetryCountRef.current,
        })
        return
      }

      setRecognitionPhase('error', 'onerror', {
        error: event.error,
        transcript: transcriptRef.current.trim().slice(-120),
      })

      // no-speechエラーの場合
      if (event.error === 'no-speech' && isListeningRef.current) {
        // 初回音声検出されていない場合のみ、累積時間をチェック
        const currentInitialSpeechTimeout = initialSpeechTimeoutRef.current
        if (!speechDetectedRef.current && currentInitialSpeechTimeout > 0) {
          // 認識開始からの経過時間を計算
          const elapsedTime =
            (Date.now() - recognitionStartTimeRef.current) / 1000
          console.log(
            `音声未検出の累積時間: ${elapsedTime.toFixed(1)}秒 / 設定: ${currentInitialSpeechTimeout}秒`
          )

          // 設定された初期音声タイムアウトを超えた場合は、再起動せずに終了
          if (elapsedTime >= currentInitialSpeechTimeout) {
            clearSilenceDetection()
            clearInitialSpeechCheckTimer()
            // 共通関数を使用 (Requirement 5.3)
            handleNoSpeechTimeoutRef.current(stopListeningRef.current)
            return
          }
        }

        // 音声が既に検出されている場合、または初期タイムアウトに達していない場合は
        // onendハンドラに再起動を委ねる（直接start()を呼ぶと競合状態が発生するため）
        if (
          isListeningRef.current &&
          !homeStore.getState().chatProcessing &&
          (settingsStore.getState().continuousMicListeningMode ||
            isKeyboardTriggered.current)
        ) {
          console.log('No speech detected, will restart via onend handler...')
          // onendハンドラが自動的に再起動する
        } else {
          console.log(
            '音声認識の再起動をスキップします（常時マイクモードがオフまたは他の条件を満たさない）'
          )
          isListeningRef.current = false
          setIsListening(false)
        }
      } else {
        // その他のエラーの場合は通常の終了処理
        clearSilenceDetection()
        clearInitialSpeechCheckTimer()
        stopListeningRef.current()
      }
    }

    recognitionRef.current = newRecognition
    setRecognition(newRecognition)
    if (pendingStartRef.current) {
      pendingStartRef.current = false
      restartTimeoutRef.current = setTimeout(() => {
        restartTimeoutRef.current = null
        startListeningRef.current()
      }, 0)
    }

    // クリーンアップ関数
    return () => {
      // 保留中の再起動タイマーをクリア
      if (restartTimeoutRef.current) {
        clearTimeout(restartTimeoutRef.current)
        restartTimeoutRef.current = null
      }
      try {
        if (newRecognition) {
          newRecognition.onstart = null
          newRecognition.onaudiostart = null
          newRecognition.onaudioend = null
          newRecognition.onsoundstart = null
          newRecognition.onsoundend = null
          newRecognition.onspeechstart = null
          newRecognition.onresult = null
          newRecognition.onspeechend = null
          newRecognition.onnomatch = null
          newRecognition.onend = null
          newRecognition.onerror = null
          newRecognition.abort()
        }
      } catch (error) {
        console.error('Error cleaning up speech recognition:', error)
      }
      clearSilenceDetection()
      clearInitialSpeechCheckTimer()
      clearRecognitionProgressTimer()
      pendingStartRef.current = false
      if (recognitionRef.current === newRecognition) {
        recognitionRef.current = null
      }
      setRecognition((current) => (current === newRecognition ? null : current))
    }
    // SpeechRecognition is a long-lived browser resource; volatile callbacks are read from refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ----- 音声認識が実際にアクティブかチェックする関数 -----
  const checkRecognitionActive = useCallback(() => {
    // onstart発火済みでonend未発火なら動作中
    return recognitionActiveRef.current
  }, [])

  // 戻り値オブジェクトをメモ化（Requirement 1.1, 1.4）
  const returnValue = useMemo(
    () => ({
      userMessage,
      isListening,
      silenceTimeoutRemaining,
      handleInputChange,
      handleSendMessage,
      toggleListening,
      startListening,
      stopListening,
      checkRecognitionActive,
    }),
    [
      userMessage,
      isListening,
      silenceTimeoutRemaining,
      handleInputChange,
      handleSendMessage,
      toggleListening,
      startListening,
      stopListening,
      checkRecognitionActive,
    ]
  )

  return returnValue
}
