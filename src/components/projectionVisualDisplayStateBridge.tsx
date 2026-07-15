import { useEffect } from 'react'

import homeStore from '@/features/stores/home'
import projectionDisplayStore from '@/features/stores/projectionDisplay'
import settingsStore from '@/features/stores/settings'
import {
  isCameraHorizontalFov,
  isLightingIntensity,
} from '@/features/stores/settingsValidation'
import {
  isSpeechBubblePresentationSettings,
  type SpeechBubblePresentationSettings,
} from '@/features/projectionVisualBubble/presentation'
import {
  isProjectionEffectsSettings,
  type ProjectionEffectsSettings,
} from '@/features/projectionEffects/settings'
import { getLatestAssistantMessageEntry } from '@/utils/assistantMessageUtils'
import {
  readWindowSpeechOutputDisplayState,
  readWindowSpeechOutputSummary,
  sanitizeSpeechOutputSummary,
  type SpeechOutputSummary,
} from '@/utils/speechOutputParitySummary'

type ProjectionVisualDisplayStateBridgeProps = {
  mode: 'operator' | 'passive' | 'stage-output'
}

type DisplayModelType = 'vrm' | 'live2d' | 'pngtuber'

export type RemoteProjectionDisplaySettings = {
  modelType?: DisplayModelType
  selectedVrmPath?: string
  selectedLive2DPath?: string
  selectedPNGTuberPath?: string
  characterName?: string
  showCharacterName?: boolean
  characterPosition?: {
    x: number
    y: number
    z: number
    scale: number
  }
  characterRotation?: {
    x: number
    y: number
    z: number
  }
  lightingIntensity?: number
  cameraHorizontalFov?: number
  projectionEffects?: ProjectionEffectsSettings
  speechBubblePresentation?: SpeechBubblePresentationSettings
}

export type RemoteProjectionDisplayState = {
  sequence?: number
  updatedAt?: string | null
  assistantMessage?: string
  assistantMessageId?: string | null
  speechOutputSummary?: SpeechOutputSummary | null
  speechOutputActive?: boolean
  settings?: RemoteProjectionDisplaySettings
}

const SYNC_INTERVAL_MS = 500
const MAX_REMOTE_STATE_AGE_MS = 5000

type ProjectionDisplayStateResponse = {
  state?: RemoteProjectionDisplayState
  ageMs?: number | null
}

const clearTransientPassiveSpeechOutput = () => {
  projectionDisplayStore.setState({ speechOutputActive: false })
}

export const isFreshRemoteProjectionDisplayState = (
  payload: ProjectionDisplayStateResponse,
  now = Date.now()
) => {
  const state = payload.state
  const sequence = state?.sequence
  const updatedAtMs =
    typeof state?.updatedAt === 'string' ? Date.parse(state.updatedAt) : NaN
  const ageMs = payload.ageMs

  return (
    Boolean(state) &&
    Number.isSafeInteger(sequence) &&
    Number(sequence) > 0 &&
    Number.isFinite(updatedAtMs) &&
    updatedAtMs <= now + SYNC_INTERVAL_MS &&
    typeof ageMs === 'number' &&
    Number.isFinite(ageMs) &&
    ageMs >= 0 &&
    ageMs <= MAX_REMOTE_STATE_AGE_MS &&
    now - updatedAtMs <= MAX_REMOTE_STATE_AGE_MS + SYNC_INTERVAL_MS
  )
}

export const readOperatorDisplayState = () => {
  const settings = settingsStore.getState()
  const chatLog = homeStore.getState().chatLog
  const latestAssistantMessage = getLatestAssistantMessageEntry(chatLog)
  const currentSpeechDisplayState = readWindowSpeechOutputDisplayState()
  const currentSpeechMessageMatchesLatest =
    Boolean(currentSpeechDisplayState?.display_message) &&
    (!latestAssistantMessage.id ||
      currentSpeechDisplayState?.message_id === latestAssistantMessage.id)
  const currentSpeechDisplayMessage =
    currentSpeechDisplayState?.display_message || ''

  return {
    assistantMessage: currentSpeechMessageMatchesLatest
      ? currentSpeechDisplayMessage
      : latestAssistantMessage.content,
    assistantMessageId: currentSpeechMessageMatchesLatest
      ? currentSpeechDisplayState?.message_id
      : latestAssistantMessage.id,
    speechOutputSummary: readWindowSpeechOutputSummary(),
    speechOutputActive: homeStore.getState().isSpeaking,
    settings: {
      modelType: settings.modelType,
      selectedVrmPath: settings.selectedVrmPath,
      selectedLive2DPath: settings.selectedLive2DPath,
      selectedPNGTuberPath: settings.selectedPNGTuberPath,
      characterName: settings.characterName,
      showCharacterName: settings.showCharacterName,
      fixedCharacterPosition: settings.fixedCharacterPosition,
      characterPosition: settings.characterPosition,
      characterRotation: settings.characterRotation,
      lightingIntensity: settings.lightingIntensity,
      cameraHorizontalFov: settings.cameraHorizontalFov,
      projectionEffects: settings.projectionEffects,
      speechBubblePresentation: settings.speechBubblePresentation,
    },
  }
}

export const applyPassiveDisplayState = (
  state: RemoteProjectionDisplayState
) => {
  const settings = state.settings || {}

  projectionDisplayStore.getState().setDisplayState({
    assistantMessage: String(state.assistantMessage || ''),
    assistantMessageId:
      typeof state.assistantMessageId === 'string'
        ? state.assistantMessageId
        : null,
    speechOutputSummary: sanitizeSpeechOutputSummary(state.speechOutputSummary),
    speechOutputActive:
      typeof state.speechOutputActive === 'boolean'
        ? state.speechOutputActive
        : false,
    sequence: Number(state.sequence || 0),
    updatedAt: state.updatedAt || null,
  })

  settingsStore.setState({
    ...(typeof settings.modelType === 'string' && {
      modelType: settings.modelType,
    }),
    ...(typeof settings.selectedVrmPath === 'string' && {
      selectedVrmPath: settings.selectedVrmPath,
    }),
    ...(typeof settings.selectedLive2DPath === 'string' && {
      selectedLive2DPath: settings.selectedLive2DPath,
    }),
    ...(typeof settings.selectedPNGTuberPath === 'string' && {
      selectedPNGTuberPath: settings.selectedPNGTuberPath,
    }),
    ...(typeof settings.characterName === 'string' && {
      characterName: settings.characterName,
    }),
    ...(typeof settings.showCharacterName === 'boolean' && {
      showCharacterName: settings.showCharacterName,
    }),
    ...(settings.characterPosition && {
      characterPosition: settings.characterPosition,
      fixedCharacterPosition: true,
    }),
    ...(settings.characterRotation && {
      characterRotation: settings.characterRotation,
    }),
    ...(isLightingIntensity(settings.lightingIntensity) && {
      lightingIntensity: settings.lightingIntensity,
    }),
    ...(isCameraHorizontalFov(settings.cameraHorizontalFov) && {
      cameraHorizontalFov: settings.cameraHorizontalFov,
    }),
    ...(isProjectionEffectsSettings(settings.projectionEffects) && {
      projectionEffects: settings.projectionEffects,
    }),
    ...(isSpeechBubblePresentationSettings(
      settings.speechBubblePresentation
    ) && {
      speechBubblePresentation: settings.speechBubblePresentation,
    }),
  })
}

export const ProjectionVisualDisplayStateBridge = ({
  mode,
}: ProjectionVisualDisplayStateBridgeProps) => {
  useEffect(() => {
    if (mode !== 'operator') return

    let stopped = false
    let lastPayload = ''
    let inFlight = false
    let activeController: AbortController | null = null

    const publish = async () => {
      if (stopped || inFlight) return
      const payload = readOperatorDisplayState()
      const serializedPayload = JSON.stringify(payload)
      if (serializedPayload === lastPayload) return

      inFlight = true
      const controller = new AbortController()
      activeController = controller
      try {
        const response = await fetch('/api/projectionDisplayState', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: serializedPayload,
          signal: controller.signal,
        })
        if (!stopped && response.ok) lastPayload = serializedPayload
      } catch {
        // Passive displays keep their last known state when the local bridge is unavailable.
      } finally {
        if (activeController === controller) activeController = null
        inFlight = false
      }
    }

    void publish()
    const timer = window.setInterval(() => {
      if (!stopped) void publish()
    }, SYNC_INTERVAL_MS)

    return () => {
      stopped = true
      activeController?.abort()
      window.clearInterval(timer)
    }
  }, [mode])

  useEffect(() => {
    if (mode !== 'passive' && mode !== 'stage-output') return

    let stopped = false
    let lastSequence = 0
    let generation = 0
    let inFlight = false
    let activeController: AbortController | null = null

    const poll = async () => {
      if (stopped || inFlight) return
      inFlight = true
      const currentGeneration = ++generation
      const controller = new AbortController()
      activeController = controller
      try {
        const response = await fetch('/api/projectionDisplayState', {
          cache: 'no-store',
          signal: controller.signal,
        })
        if (stopped || currentGeneration !== generation) return
        if (!response.ok) {
          clearTransientPassiveSpeechOutput()
          return
        }
        const payload =
          (await response.json()) as ProjectionDisplayStateResponse
        if (stopped || currentGeneration !== generation) return
        if (!isFreshRemoteProjectionDisplayState(payload)) {
          clearTransientPassiveSpeechOutput()
          return
        }
        const state = payload.state
        const sequence = Number(state?.sequence || 0)
        if (!state || sequence <= lastSequence) return
        lastSequence = sequence
        applyPassiveDisplayState(state)
      } catch {
        if (!stopped && currentGeneration === generation) {
          clearTransientPassiveSpeechOutput()
        }
      } finally {
        if (activeController === controller) activeController = null
        inFlight = false
      }
    }

    void poll()
    const timer = window.setInterval(() => {
      if (!stopped) void poll()
    }, SYNC_INTERVAL_MS)

    return () => {
      stopped = true
      generation += 1
      activeController?.abort()
      window.clearInterval(timer)
      clearTransientPassiveSpeechOutput()
    }
  }, [mode])

  return null
}
