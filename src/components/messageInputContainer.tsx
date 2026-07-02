import { useEffect, useRef, type ChangeEvent } from 'react'
import { MessageInput } from '@/components/messageInput'
import homeStore from '@/features/stores/home'
import settingsStore from '@/features/stores/settings'
import { useVoiceRecognition } from '@/hooks/useVoiceRecognition'
import { registerGestureVoiceControls } from '@/features/gestureVoice/gestureVoiceControls'
import {
  publishProjectionVisualListeningPoseDiagnostic,
  type ProjectionVisualListeningPoseDiagnosticInput,
} from '@/features/gestureVoice/listeningPoseDiagnostic'

const gestureVoiceInterruptsSpeech =
  process.env.NEXT_PUBLIC_GESTURE_VOICE_INTERRUPT_SPEECH === 'true'

// 無音検出用の状態と変数を追加
type Props = {
  onChatProcessStart: (text: string) => void
}

export const MessageInputContainer = ({ onChatProcessStart }: Props) => {
  const isSpeaking = homeStore((s) => s.isSpeaking)
  const chatProcessing = homeStore((s) => s.chatProcessing)
  const continuousMicListeningMode = settingsStore(
    (s) => s.continuousMicListeningMode
  )
  const speechRecognitionMode = settingsStore((s) => s.speechRecognitionMode)
  const whisperTranscriptionModel = settingsStore(
    (s) => s.whisperTranscriptionModel
  )
  const realtimeAPIMode = settingsStore((s) => s.realtimeAPIMode)
  const modelType = settingsStore((s) => s.modelType)
  const poseConfigs = settingsStore((s) => s.poseConfigs)
  const listeningPoseEnabled = settingsStore((s) => s.listeningPoseEnabled)
  const listeningPoseId = settingsStore((s) => s.listeningPoseId)

  // 音声認識フックを使用
  const {
    userMessage,
    isListening,
    silenceTimeoutRemaining,
    handleInputChange,
    handleSendMessage,
    toggleListening,
    handleStopSpeaking,
    startListening,
    stopListening,
    checkRecognitionActive,
  } = useVoiceRecognition({ onChatProcessStart })

  const latestVoiceStateRef = useRef({
    userMessage,
    isListening,
    recognitionActive: checkRecognitionActive(),
  })
  const listeningPoseActiveRef = useRef(false)

  useEffect(() => {
    latestVoiceStateRef.current = {
      userMessage,
      isListening,
      recognitionActive: checkRecognitionActive(),
    }
  }, [checkRecognitionActive, userMessage, isListening])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    const browserSpeechRecognitionAvailable =
      'SpeechRecognition' in window || 'webkitSpeechRecognition' in window
    const detail = {
      mode: realtimeAPIMode
        ? 'realtime'
        : speechRecognitionMode === 'whisper'
          ? 'whisper'
          : 'browser',
      listening: isListening,
      state: isListening ? 'LISTENING' : 'IDLE',
      continuous:
        continuousMicListeningMode && speechRecognitionMode === 'browser',
      speaking: isSpeaking,
      chatProcessing,
      browserAvailable: browserSpeechRecognitionAvailable,
      whisperModel: whisperTranscriptionModel,
      userTextLength: userMessage.length,
      updatedAt: new Date().toISOString(),
    }

    ;(window as any).__projectionVisualSttStatus = detail
    window.dispatchEvent(
      new CustomEvent('projection-visual-stt-status', {
        detail,
      })
    )
  }, [
    chatProcessing,
    continuousMicListeningMode,
    isListening,
    isSpeaking,
    realtimeAPIMode,
    speechRecognitionMode,
    userMessage.length,
    whisperTranscriptionModel,
  ])

  useEffect(() => {
    const targetModelTypeClass =
      modelType === 'vrm' ? 'vrm' : modelType ? 'non_vrm' : 'unknown'
    const poseIdClass = listeningPoseId ? 'configured' : 'missing'
    const publishListeningPoseDiagnostic = (
      detail: Omit<
        ProjectionVisualListeningPoseDiagnosticInput,
        | 'controller'
        | 'listening'
        | 'enabled'
        | 'target_model_type_class'
        | 'pose_id_class'
      >
    ) => {
      publishProjectionVisualListeningPoseDiagnostic({
        controller: 'message_input_container',
        listening: isListening,
        enabled: listeningPoseEnabled,
        target_model_type_class: targetModelTypeClass,
        pose_id_class: poseIdClass,
        ...detail,
      })
    }
    const resetListeningPose = () => {
      if (!listeningPoseActiveRef.current) {
        return false
      }

      const model = homeStore.getState().viewer.model
      if (model) {
        model.poseManager.resetToIdle(model)
      }
      listeningPoseActiveRef.current = false
      publishListeningPoseDiagnostic({
        status: 'reset',
        reason_code: 'listening_pose_reset_to_idle',
        model_ready: Boolean(model),
        pose_config_available: false,
        safe_visible_state: 'neutral_idle_requested',
      })
      return true
    }

    if (!listeningPoseEnabled) {
      resetListeningPose()
      publishListeningPoseDiagnostic({
        status: 'disabled',
        reason_code: 'listening_pose_disabled',
        model_ready: Boolean(homeStore.getState().viewer.model),
        pose_config_available: false,
        safe_visible_state: 'listening_pose_not_requested',
      })
      return
    }

    if (modelType !== 'vrm') {
      resetListeningPose()
      publishListeningPoseDiagnostic({
        status: 'unavailable',
        reason_code: 'target_model_type_unavailable',
        model_ready: Boolean(homeStore.getState().viewer.model),
        pose_config_available: false,
        safe_visible_state: 'listening_pose_not_requested',
      })
      return
    }

    if (!isListening) {
      resetListeningPose()
      publishListeningPoseDiagnostic({
        status: 'idle',
        reason_code: 'listening_pose_inactive',
        model_ready: Boolean(homeStore.getState().viewer.model),
        pose_config_available: false,
        safe_visible_state: 'listening_pose_not_requested',
      })
      return
    }

    const model = homeStore.getState().viewer.model
    if (!model) {
      publishListeningPoseDiagnostic({
        status: 'unavailable',
        reason_code: 'vrm_model_not_ready',
        model_ready: false,
        pose_config_available: false,
        safe_visible_state: 'no_visible_change',
      })
      return
    }

    const poseConfig = poseConfigs.find((pose) => pose.id === listeningPoseId)
    if (!poseConfig) {
      publishListeningPoseDiagnostic({
        status: 'unavailable',
        reason_code: 'listening_pose_config_missing',
        model_ready: true,
        pose_config_available: false,
        safe_visible_state: 'no_visible_change',
      })
      return
    }

    listeningPoseActiveRef.current = true
    publishListeningPoseDiagnostic({
      status: 'requested',
      reason_code: 'listening_pose_apply_requested',
      model_ready: true,
      pose_config_available: true,
      safe_visible_state: 'listening_pose_requested',
    })
    void model.poseManager
      .applyPose(model, listeningPoseId, poseConfig)
      .then(() => {
        publishListeningPoseDiagnostic({
          status: 'applied',
          reason_code: 'listening_pose_applied',
          model_ready: true,
          pose_config_available: true,
          safe_visible_state: 'listening_pose_applied',
        })
        if (!latestVoiceStateRef.current.isListening) {
          resetListeningPose()
        }
      })
      .catch(() => {
        listeningPoseActiveRef.current = false
        console.warn('Listening pose apply failed', {
          reason_code: 'listening_pose_apply_failed',
        })
        publishListeningPoseDiagnostic({
          status: 'failed',
          reason_code: 'listening_pose_apply_failed',
          model_ready: true,
          pose_config_available: true,
          safe_visible_state: 'no_visible_change',
        })
      })
  }, [
    isListening,
    listeningPoseEnabled,
    listeningPoseId,
    modelType,
    poseConfigs,
  ])

  useEffect(() => {
    return () => {
      if (!listeningPoseActiveRef.current) {
        return
      }

      const model = homeStore.getState().viewer.model
      if (model) {
        model.poseManager.resetToIdle(model)
      }
      listeningPoseActiveRef.current = false
    }
  }, [])

  useEffect(() => {
    return registerGestureVoiceControls({
      isListening: () => latestVoiceStateRef.current.isListening,
      isRecognitionActive: () => checkRecognitionActive(),
      startListening: async () => {
        if (homeStore.getState().chatProcessing) {
          return { ok: false, reason: 'chat_processing' }
        }
        if (latestVoiceStateRef.current.isListening) {
          return { ok: true, reason: 'already_listening' }
        }

        if (homeStore.getState().isSpeaking) {
          if (!gestureVoiceInterruptsSpeech) {
            return { ok: false, reason: 'speaking' }
          }

          handleStopSpeaking()
        }

        const started = await startListening()
        const recognitionActive = checkRecognitionActive()
        const listening =
          recognitionActive || latestVoiceStateRef.current.isListening
        return {
          ok: Boolean(started || listening),
          reason: started || listening ? 'started' : 'not_started',
        }
      },
      restartListening: async () => {
        if (homeStore.getState().chatProcessing) {
          return { ok: false, reason: 'chat_processing' }
        }

        if (homeStore.getState().isSpeaking) {
          if (!gestureVoiceInterruptsSpeech) {
            return { ok: false, reason: 'speaking' }
          }

          handleStopSpeaking()
        }

        await stopListening()
        await new Promise((resolve) => setTimeout(resolve, 160))
        const started = await startListening()
        const recognitionActive = checkRecognitionActive()
        const listening =
          recognitionActive || latestVoiceStateRef.current.isListening
        return {
          ok: Boolean(started || listening),
          reason: started || listening ? 'restarted' : 'not_started',
        }
      },
      stopListeningAndSubmit: async () => {
        if (!latestVoiceStateRef.current.isListening) {
          return { ok: false, reason: 'not_listening' }
        }

        const messageBeforeStop = latestVoiceStateRef.current.userMessage.trim()
        await stopListening()

        if (settingsStore.getState().speechRecognitionMode === 'whisper') {
          return { ok: true, reason: 'whisper_submits_on_stop' }
        }

        const message =
          latestVoiceStateRef.current.userMessage.trim() || messageBeforeStop
        if (!message) {
          return { ok: false, reason: 'empty_message' }
        }

        handleInputChange({
          target: { value: '' },
        } as ChangeEvent<HTMLTextAreaElement>)
        onChatProcessStart(message)

        return { ok: true }
      },
    })
  }, [
    handleInputChange,
    handleStopSpeaking,
    onChatProcessStart,
    startListening,
    stopListening,
    checkRecognitionActive,
  ])

  // 常時マイク入力モードの切り替え
  const toggleContinuousMode = () => {
    // Whisperモードの場合は常時マイク入力モードを使用できない
    if (speechRecognitionMode === 'whisper') return

    // 現在のモードを反転して設定
    settingsStore.setState({
      continuousMicListeningMode: !continuousMicListeningMode,
    })
  }

  return (
    <MessageInput
      userMessage={userMessage}
      isMicRecording={isListening}
      onChangeUserMessage={handleInputChange}
      onClickMicButton={toggleListening}
      onClickSendButton={handleSendMessage}
      onClickStopButton={handleStopSpeaking}
      isSpeaking={isSpeaking}
      silenceTimeoutRemaining={silenceTimeoutRemaining}
      continuousMicListeningMode={
        continuousMicListeningMode && speechRecognitionMode === 'browser'
      }
      onToggleContinuousMode={toggleContinuousMode}
    />
  )
}
