import { useEffect } from 'react'

import homeStore from '@/features/stores/home'
import projectionDisplayStore from '@/features/stores/projectionDisplay'
import settingsStore from '@/features/stores/settings'
import { getLatestAssistantMessageEntry } from '@/utils/assistantMessageUtils'
import {
  readWindowSpeechOutputSummary,
  sanitizeSpeechOutputSummary,
  type SpeechOutputSummary,
} from '@/utils/speechOutputParitySummary'

type ProjectionVisualDisplayStateBridgeProps = {
  mode: 'operator' | 'passive' | 'stage-output'
}

type DisplayModelType = 'vrm' | 'live2d' | 'pngtuber'

type RemoteProjectionDisplaySettings = {
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
}

type RemoteProjectionDisplayState = {
  sequence?: number
  updatedAt?: string | null
  assistantMessage?: string
  assistantMessageId?: string | null
  speechOutputSummary?: SpeechOutputSummary | null
  settings?: RemoteProjectionDisplaySettings
}

const SYNC_INTERVAL_MS = 500

const readOperatorDisplayState = () => {
  const settings = settingsStore.getState()
  const chatLog = homeStore.getState().chatLog
  const latestAssistantMessage = getLatestAssistantMessageEntry(chatLog)

  return {
    assistantMessage: latestAssistantMessage.content,
    assistantMessageId: latestAssistantMessage.id,
    speechOutputSummary: readWindowSpeechOutputSummary(),
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
    },
  }
}

const applyPassiveDisplayState = (state: RemoteProjectionDisplayState) => {
  const settings = state.settings || {}

  projectionDisplayStore.getState().setDisplayState({
    assistantMessage: String(state.assistantMessage || ''),
    assistantMessageId:
      typeof state.assistantMessageId === 'string'
        ? state.assistantMessageId
        : null,
    speechOutputSummary: sanitizeSpeechOutputSummary(state.speechOutputSummary),
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
    ...(typeof settings.lightingIntensity === 'number' && {
      lightingIntensity: settings.lightingIntensity,
    }),
  })

  const viewer = homeStore.getState().viewer
  viewer.restoreCameraPosition()
  if (typeof settings.lightingIntensity === 'number') {
    viewer.updateLightingIntensity(settings.lightingIntensity)
  }
}

export const ProjectionVisualDisplayStateBridge = ({
  mode,
}: ProjectionVisualDisplayStateBridgeProps) => {
  useEffect(() => {
    if (mode !== 'operator') return

    let stopped = false
    let lastPayload = ''

    const publish = async () => {
      const payload = readOperatorDisplayState()
      const serializedPayload = JSON.stringify(payload)
      if (serializedPayload === lastPayload) return

      lastPayload = serializedPayload
      try {
        await fetch('/api/projectionDisplayState', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: serializedPayload,
        })
      } catch {
        // Passive displays keep their last known state when the local bridge is unavailable.
      }
    }

    void publish()
    const timer = window.setInterval(() => {
      if (!stopped) void publish()
    }, SYNC_INTERVAL_MS)

    return () => {
      stopped = true
      window.clearInterval(timer)
    }
  }, [mode])

  useEffect(() => {
    if (mode !== 'passive' && mode !== 'stage-output') return

    let stopped = false
    let lastSequence = 0

    const poll = async () => {
      try {
        const response = await fetch('/api/projectionDisplayState', {
          cache: 'no-store',
        })
        if (!response.ok) return
        const payload = await response.json()
        const state = payload?.state as RemoteProjectionDisplayState | undefined
        const sequence = Number(state?.sequence || 0)
        if (!state || sequence <= lastSequence) return
        lastSequence = sequence
        applyPassiveDisplayState(state)
      } catch {
        // Passive display should fail soft and keep rendering its local state.
      }
    }

    void poll()
    const timer = window.setInterval(() => {
      if (!stopped) void poll()
    }, SYNC_INTERVAL_MS)

    return () => {
      stopped = true
      window.clearInterval(timer)
    }
  }, [mode])

  return null
}
