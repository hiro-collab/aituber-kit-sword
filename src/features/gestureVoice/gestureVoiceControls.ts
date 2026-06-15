export type GestureVoiceControlResult = {
  ok: boolean
  reason?: string
}

export type GestureVoiceControls = {
  isListening: () => boolean
  isRecognitionActive?: () => boolean
  startListening: () => Promise<GestureVoiceControlResult>
  restartListening?: () => Promise<GestureVoiceControlResult>
  stopListeningAndSubmit: () => Promise<GestureVoiceControlResult>
}

let currentControls: GestureVoiceControls | null = null

export const registerGestureVoiceControls = (
  controls: GestureVoiceControls
): (() => void) => {
  currentControls = controls

  return () => {
    if (currentControls === controls) {
      currentControls = null
    }
  }
}

export const getGestureVoiceControls = (): GestureVoiceControls | null =>
  currentControls
