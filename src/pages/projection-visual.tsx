import dynamic from 'next/dynamic'
import { useRouter } from 'next/router'
import { useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Form } from '@/components/form'
import MessageReceiver from '@/components/messageReceiver'
import { Meta } from '@/components/meta'
import ModalImage from '@/components/modalImage'
import VrmViewer from '@/components/vrmViewer'
import Live2DViewer from '@/components/live2DViewer'
import PNGTuberViewer from '@/components/pngTuberViewer'
import { Toasts } from '@/components/toasts'
import { WebSocketManager } from '@/components/websocketManager'
import CharacterPresetMenu from '@/components/characterPresetMenu'
import ImageOverlay from '@/components/ImageOverlay'
import PresenceManager from '@/components/presenceManager'
import GestureVoiceBridge from '@/components/gestureVoiceBridge'
import { KioskOverlay } from '@/features/kiosk/kioskOverlay'
import { YoutubeManager } from '@/components/youtubeManager'
import { MemoryServiceInitializer } from '@/components/memoryServiceInitializer'
import { ProjectionVisualHud } from '@/components/projectionVisualHud'
import { ProjectionVisualAssistantBubble } from '@/components/projectionVisualAssistantBubble'
import { ProjectionVisualDisplayStateBridge } from '@/components/projectionVisualDisplayStateBridge'
import homeStore from '@/features/stores/home'
import settingsStore from '@/features/stores/settings'
import toastStore from '@/features/stores/toast'
import { usePresetLoader } from '@/features/presets/usePresetLoader'
import { useLive2DEnabled } from '@/hooks/useLive2DEnabled'
import { useBrowserControlOwner } from '@/features/browserControl/useBrowserControlOwner'
import { BrowserControlNotice } from '@/components/browserControlNotice'
import {
  readProjectionVisualQueryFromPath,
  resolveProjectionVisualQueryState,
} from '@/utils/projectionVisualQuery'
import { ProjectionVisualStimulusRefBridge } from '@/features/motionRuntime/projectionVisualStimulusRefBridge'
import '@/lib/i18n'

const projectionVisualAIService = ((): 'dify' | 'thought-core' | null => {
  const configured = (
    process.env.NEXT_PUBLIC_PROJECTION_VISUAL_AI_SERVICE || ''
  )
    .trim()
    .toLowerCase()
  if (configured === 'dify' || configured === 'thought-core') {
    return configured
  }
  const legacyForceDify = (
    process.env.NEXT_PUBLIC_PROJECTION_VISUAL_FORCE_DIFY || ''
  )
    .trim()
    .toLowerCase()
  if (legacyForceDify === 'true') {
    return 'dify'
  }
  if (legacyForceDify === 'false') {
    return null
  }
  return 'thought-core'
})()
const shouldForceContinuousMicForProjectionVisual =
  process.env.NEXT_PUBLIC_PROJECTION_VISUAL_CONTINUOUS_MIC === 'true'

const ProjectionVisual = () => {
  const router = useRouter()
  const routeQuery = useMemo(
    () =>
      router.isReady
        ? router.query
        : readProjectionVisualQueryFromPath(router.asPath),
    [router.asPath, router.isReady, router.query]
  )
  const {
    isPassiveMode,
    isStageOutputMode,
    isDisplayOnlyMode,
    projectionVisualMode,
    projectionVisualTestMode,
    motionStimulusAssetPath,
    projectionVisualStimulusRef,
    shouldReceiveDisplayState,
    shouldRenderHud,
  } = resolveProjectionVisualQueryState(routeQuery)
  const messageReceiverEnabled = settingsStore((s) => s.messageReceiverEnabled)
  const modelType = settingsStore((s) => s.modelType)
  const { isLive2DEnabled } = useLive2DEnabled()
  const controlOwner = useBrowserControlOwner({
    label: 'Projection Visual',
    route: '/projection-visual',
    priority: 30,
    enabled: !isDisplayOnlyMode,
  })
  const characterPreset1 = settingsStore((s) => s.characterPreset1)
  const characterPreset2 = settingsStore((s) => s.characterPreset2)
  const characterPreset3 = settingsStore((s) => s.characterPreset3)
  const characterPreset4 = settingsStore((s) => s.characterPreset4)
  const characterPreset5 = settingsStore((s) => s.characterPreset5)
  const { t } = useTranslation()
  usePresetLoader()
  const displayStateBridgeMode = shouldReceiveDisplayState
    ? projectionVisualMode
    : 'operator'

  const characterPresets = useMemo(
    () => [
      { key: 'characterPreset1', value: characterPreset1 },
      { key: 'characterPreset2', value: characterPreset2 },
      { key: 'characterPreset3', value: characterPreset3 },
      { key: 'characterPreset4', value: characterPreset4 },
      { key: 'characterPreset5', value: characterPreset5 },
    ],
    [
      characterPreset1,
      characterPreset2,
      characterPreset3,
      characterPreset4,
      characterPreset5,
    ]
  )

  useEffect(() => {
    homeStore.setState({
      backgroundImageUrl: 'green',
      webcamStatus: false,
      captureStatus: false,
    })
    settingsStore.setState({
      ...(!isDisplayOnlyMode && projectionVisualAIService
        ? { selectAIService: projectionVisualAIService }
        : {}),
      ...(!isDisplayOnlyMode && shouldForceContinuousMicForProjectionVisual
        ? {
            speechRecognitionMode: 'browser' as const,
            continuousMicListeningMode: true,
          }
        : {}),
    })
  }, [isDisplayOnlyMode])

  useEffect(() => {
    if (isDisplayOnlyMode) return

    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.shiftKey) {
        const keyMap: { [key: string]: number } = {
          Digit1: 1,
          Digit2: 2,
          Digit3: 3,
          Digit4: 4,
          Digit5: 5,
        }
        const keyNumber = keyMap[event.code]

        if (keyNumber) {
          settingsStore.setState({
            systemPrompt: characterPresets[keyNumber - 1].value,
          })
          toastStore.getState().addToast({
            message: t('Toasts.PresetSwitching', {
              presetName: t(`Characterpreset${keyNumber}`),
            }),
            type: 'info',
            tag: `character-preset-switching`,
          })
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [characterPresets, isDisplayOnlyMode, t])

  return (
    <div
      className="projection-visual relative h-[100svh] overflow-hidden bg-[#00ff00]"
      data-projection-visual-mode={projectionVisualMode}
      data-projection-visual-test-mode={projectionVisualTestMode ?? 'none'}
      data-projection-visual-stimulus-ref={
        projectionVisualStimulusRef ?? 'none'
      }
    >
      <Meta />
      <ProjectionVisualDisplayStateBridge mode={displayStateBridgeMode} />
      {shouldRenderHud && (
        <ProjectionVisualHud
          variant={isDisplayOnlyMode ? 'passive' : 'operator'}
        />
      )}
      {modelType === 'live2d' && isLive2DEnabled ? (
        <Live2DViewer />
      ) : modelType === 'pngtuber' ? (
        <PNGTuberViewer />
      ) : (
        <VrmViewer
          visualTestMode={projectionVisualTestMode}
          motionStimulusAssetPath={motionStimulusAssetPath}
        />
      )}
      <ProjectionVisualStimulusRefBridge
        enabled={modelType === 'vrm'}
        stimulusRef={projectionVisualStimulusRef}
      />
      <ProjectionVisualAssistantBubble
        variant={
          isStageOutputMode
            ? 'stage-output'
            : isPassiveMode
              ? 'passive'
              : 'operator'
        }
      />
      {!isDisplayOnlyMode &&
        (controlOwner.isOwner ? (
          <Form />
        ) : (
          <BrowserControlNotice
            owner={controlOwner.owner}
            onTakeControl={controlOwner.takeControl}
            compact
          />
        ))}
      {!isDisplayOnlyMode && <ModalImage />}
      {!isDisplayOnlyMode && controlOwner.isOwner && messageReceiverEnabled && (
        <MessageReceiver />
      )}
      {!isDisplayOnlyMode && <Toasts />}
      {!isDisplayOnlyMode && controlOwner.isOwner && (
        <>
          <WebSocketManager />
          <GestureVoiceBridge />
          <YoutubeManager />
          <MemoryServiceInitializer />
        </>
      )}
      {!isDisplayOnlyMode && <CharacterPresetMenu />}
      {!isDisplayOnlyMode && <ImageOverlay />}
      {!isDisplayOnlyMode && controlOwner.isOwner && <PresenceManager />}
      {!isDisplayOnlyMode && <KioskOverlay />}
    </div>
  )
}

export default dynamic(() => Promise.resolve(ProjectionVisual), {
  ssr: false,
})
