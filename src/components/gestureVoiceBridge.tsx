import { useEffect, useRef } from 'react'
import { getGestureVoiceControls } from '@/features/gestureVoice/gestureVoiceControls'

type GestureSignalPayload = {
  active?: unknown
  confidence?: unknown
}

type GestureSignalSource = 'stable' | 'raw'

type GesturePayload = {
  type?: unknown
  sequence?: unknown
  gestures?: unknown
  stable?: unknown
  primary_gesture?: unknown
  sword_sign?: unknown
}

const SWORD_SIGN_STATE_TOPIC = '/vision/sword_sign/state'

const parseNumber = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const normalizeGesturePayload = (message: unknown): GesturePayload | null => {
  if (!isRecord(message)) {
    return null
  }

  if (message.topic === SWORD_SIGN_STATE_TOPIC) {
    if (!isRecord(message.payload)) {
      return null
    }
    const payload = message.payload as GesturePayload
    if (typeof payload.sequence === 'number') {
      return payload
    }
    const header = isRecord(message.header) ? message.header : null
    if (typeof header?.seq === 'number') {
      return { ...payload, sequence: header.seq }
    }
    return payload
  }

  if (typeof message.topic === 'string') {
    return null
  }

  return message as GesturePayload
}

const readSignal = (
  payload: GesturePayload,
  gestureName: string,
  useStable: boolean
): { signal: GestureSignalPayload; source: GestureSignalSource } | null => {
  if (useStable && isRecord(payload.stable)) {
    const stableGestures = payload.stable.gestures
    if (isRecord(stableGestures)) {
      const signal = stableGestures[gestureName]
      if (isRecord(signal)) {
        return { signal, source: 'stable' }
      }
    }
  }

  if (isRecord(payload.gestures)) {
    const signal = payload.gestures[gestureName]
    if (isRecord(signal)) {
      return { signal, source: 'raw' }
    }
  }

  const directSignal = (payload as Record<string, unknown>)[gestureName]
  if (isRecord(directSignal)) {
    return { signal: directSignal, source: 'raw' }
  }

  return null
}

const isGestureActive = (
  payload: GesturePayload,
  gestureName: string,
  minConfidence: number,
  useStable: boolean
): boolean | null => {
  if (typeof payload.type === 'string' && payload.type !== 'gesture_state') {
    return null
  }

  const result = readSignal(payload, gestureName, useStable)
  if (!result) {
    return null
  }

  const { signal, source } = result
  if (typeof signal.active !== 'boolean') {
    return null
  }

  if (source === 'stable') {
    return signal.active
  }

  const confidence =
    typeof signal.confidence === 'number' ? signal.confidence : 0
  return signal.active && confidence >= minConfidence
}

const dispatchSttDiagnostic = (
  event: string,
  payload: Record<string, unknown> = {}
) => {
  if (typeof window === 'undefined') {
    return
  }

  const detail = {
    event,
    controller: 'gesture_bridge',
    ...payload,
    updatedAt: new Date().toISOString(),
  }

  ;(window as any).__projectionVisualSttDiagnostic = detail
  window.dispatchEvent(
    new CustomEvent('projection-visual-stt-diagnostic', {
      detail,
    })
  )
}

const GestureVoiceBridge = () => {
  const sourceActiveRef = useRef(false)
  const bridgeListeningRef = useRef(false)
  const lastStartAttemptAtRef = useRef(0)
  const transitionRef = useRef<Promise<void>>(Promise.resolve())

  useEffect(() => {
    const enabled =
      process.env.NEXT_PUBLIC_GESTURE_VOICE_BRIDGE_ENABLED === 'true'
    if (!enabled) {
      return
    }

    const wsUrl =
      process.env.NEXT_PUBLIC_REFLEX_GESTURE_WS_URL ||
      process.env.NEXT_PUBLIC_GESTURE_VOICE_WS_URL ||
      'ws://127.0.0.1:8765'
    const gestureName =
      process.env.NEXT_PUBLIC_GESTURE_VOICE_GESTURE || 'sword_sign'
    const minConfidence = parseNumber(
      process.env.NEXT_PUBLIC_GESTURE_VOICE_MIN_CONFIDENCE,
      0.9
    )
    const reconnectMs = parseNumber(
      process.env.NEXT_PUBLIC_GESTURE_VOICE_RECONNECT_MS,
      1000
    )
    const useStable =
      process.env.NEXT_PUBLIC_GESTURE_VOICE_USE_STABLE !== 'false'
    const startRetryMs = parseNumber(
      process.env.NEXT_PUBLIC_GESTURE_VOICE_START_RETRY_MS,
      500
    )

    let websocket: WebSocket | null = null
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null
    let lastSequence: number | null = null
    let stopped = false

    const runTransition = (nextActive: boolean) => {
      transitionRef.current = transitionRef.current
        .catch(() => undefined)
        .then(async () => {
          const controls = getGestureVoiceControls()
          if (!controls) {
            dispatchSttDiagnostic('gesture_controls_missing')
            return
          }

          if (!nextActive) {
            sourceActiveRef.current = false
            lastStartAttemptAtRef.current = 0

            if (!bridgeListeningRef.current) {
              return
            }

            const result = await controls.stopListeningAndSubmit()
            bridgeListeningRef.current = false
            dispatchSttDiagnostic('gesture_release_submit', {
              detail: result.reason || (result.ok ? 'submitted' : 'skipped'),
              listening: controls.isListening(),
            })

            if (!result.ok) {
              console.debug('Gesture voice bridge skipped transition:', result)
            }
            return
          }

          const wasSourceActive = sourceActiveRef.current
          sourceActiveRef.current = true
          const actualListening = controls.isListening()
          const recognitionActive =
            controls.isRecognitionActive?.() ?? actualListening

          if (actualListening && recognitionActive) {
            bridgeListeningRef.current = true
            return
          }

          const now = Date.now()
          if (actualListening && !recognitionActive) {
            bridgeListeningRef.current = false
            dispatchSttDiagnostic('gesture_listener_stale', {
              detail: 'STT says listening, but SpeechRecognition is inactive',
              listening: true,
              recognitionActive: false,
            })

            if (
              wasSourceActive &&
              lastStartAttemptAtRef.current > 0 &&
              now - lastStartAttemptAtRef.current < startRetryMs
            ) {
              return
            }

            lastStartAttemptAtRef.current = now
            const result = controls.restartListening
              ? await controls.restartListening()
              : await controls.startListening()
            const listeningAfterRestart = controls.isListening()
            bridgeListeningRef.current =
              result.ok && listeningAfterRestart && result.reason !== 'speaking'
            dispatchSttDiagnostic('gesture_restart_result', {
              detail: result.reason || (result.ok ? 'ok' : 'failed'),
              listening: listeningAfterRestart,
              recognitionActive:
                controls.isRecognitionActive?.() ?? listeningAfterRestart,
            })

            if (!result.ok) {
              console.debug(
                'Gesture voice bridge skipped stale-listener restart:',
                result
              )
            }
            return
          }

          if (bridgeListeningRef.current && !actualListening) {
            bridgeListeningRef.current = false
            dispatchSttDiagnostic('gesture_listener_stale', {
              detail: 'bridge expected listening, but STT is idle',
              listening: false,
            })
          }

          if (
            wasSourceActive &&
            lastStartAttemptAtRef.current > 0 &&
            now - lastStartAttemptAtRef.current < startRetryMs
          ) {
            return
          }

          lastStartAttemptAtRef.current = now
          dispatchSttDiagnostic('gesture_start_request', {
            detail: gestureName,
            listening: false,
          })
          const result = await controls.startListening()
          dispatchSttDiagnostic('gesture_start_result', {
            detail: result.reason || (result.ok ? 'ok' : 'failed'),
            listening: controls.isListening(),
          })

          if (result.ok && result.reason !== 'already_listening') {
            bridgeListeningRef.current = true
          }

          if (!result.ok) {
            console.debug('Gesture voice bridge skipped transition:', result)
          }
        })
    }

    const connect = () => {
      if (stopped) {
        return
      }

      websocket = new WebSocket(wsUrl)

      websocket.onopen = () => {
        lastSequence = null
        sourceActiveRef.current = false
        bridgeListeningRef.current = false
        lastStartAttemptAtRef.current = 0
        dispatchSttDiagnostic('gesture_ws_open', {
          detail: wsUrl,
        })
      }

      websocket.onmessage = (event) => {
        try {
          if (typeof event.data !== 'string') {
            return
          }
          const payload = normalizeGesturePayload(JSON.parse(event.data))
          if (!payload) {
            return
          }
          if (typeof payload.sequence === 'number') {
            if (lastSequence !== null && payload.sequence <= lastSequence) {
              return
            }
            lastSequence = payload.sequence
          }

          const nextActive = isGestureActive(
            payload,
            gestureName,
            minConfidence,
            useStable
          )
          if (nextActive === null) {
            return
          }
          runTransition(nextActive)
        } catch (error) {
          console.warn('Gesture voice bridge ignored malformed message:', error)
        }
      }

      websocket.onclose = () => {
        websocket = null
        dispatchSttDiagnostic('gesture_ws_close')
        if (!stopped) {
          reconnectTimer = setTimeout(connect, reconnectMs)
        }
      }

      websocket.onerror = () => {
        dispatchSttDiagnostic('gesture_ws_error')
        websocket?.close()
      }
    }

    connect()

    return () => {
      stopped = true
      if (reconnectTimer) {
        clearTimeout(reconnectTimer)
      }
      websocket?.close()
    }
  }, [])

  return null
}

export default GestureVoiceBridge
