import dynamic from 'next/dynamic'
import { useRouter } from 'next/router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
import { ProjectionVisualCalibrationPanel } from '@/components/projectionVisualCalibrationPanel'
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
import type { MotionRuntimeLifecycleAcceptanceCandidate } from '@/features/motionRuntime/motionRuntimeSession'
import {
  registerAcceptedPreparedSamplePresentationOwner,
  requestAcceptedPreparedSamplePresentation,
} from '@/features/chat/thoughtCoreChat'
import { presentAcceptedPreparedSampleAssistantResponse } from '@/features/chat/handlers'
import { resolveProjectionEffectSelection } from '@/features/projectionEffects/browser/fluidFireRelayCanvasLayer'
import {
  AvatarFireThunderEffectLayer,
  type AvatarFireThunderHostState,
  type AvatarFireThunderReceiverState,
} from '@/features/projectionEffects/browser/avatarFireThunderLabOverlay'
import { resolveProjectionEffectsSettings } from '@/features/projectionEffects/settings'
import {
  createProjectionStageCaptureHandleSession,
  registerProjectionStageCaptureHandle,
} from '@/features/projectionDisplay/captureSourceHandle'
import '@/lib/i18n'

const projectionVisualAIService = ((): 'thought-core' | null => {
  const configured = (
    process.env.NEXT_PUBLIC_PROJECTION_VISUAL_AI_SERVICE || ''
  )
    .trim()
    .toLowerCase()
  if (configured === 'thought-core') {
    return 'thought-core'
  }
  return 'thought-core'
})()
const shouldForceContinuousMicForProjectionVisual =
  process.env.NEXT_PUBLIC_PROJECTION_VISUAL_CONTINUOUS_MIC === 'true'
const ProjectionVisual = () => {
  const [projectionEffectHostState, setProjectionEffectHostState] =
    useState<AvatarFireThunderHostState>('idle')
  const [projectionEffectReceiverState, setProjectionEffectReceiverState] =
    useState<AvatarFireThunderReceiverState>('inactive')
  const [
    danceLifecycleAcceptancePredicate,
    setDanceLifecycleAcceptancePredicate,
  ] = useState<
    | ((candidate: MotionRuntimeLifecycleAcceptanceCandidate) => boolean)
    | undefined
  >()
  const handleDanceLifecycleAcceptanceReady = useCallback(
    (
      predicate:
        | ((candidate: MotionRuntimeLifecycleAcceptanceCandidate) => boolean)
        | undefined
    ) => setDanceLifecycleAcceptancePredicate(() => predicate),
    []
  )
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
  const captureOwnerOrigin = useMemo(() => {
    const value = router.query.captureOwnerOrigin
    return Array.isArray(value) ? value[0] : value
  }, [router.query.captureOwnerOrigin])
  const captureHandleSession = useMemo(
    () => createProjectionStageCaptureHandleSession(),
    []
  )
  const projectionVisualRootRef = useRef<HTMLDivElement>(null)
  const captureHandleClearFailedRef = useRef(false)
  const messageReceiverEnabled = settingsStore((s) => s.messageReceiverEnabled)
  const modelType = settingsStore((s) => s.modelType)
  const projectionEffects = resolveProjectionEffectsSettings(
    settingsStore((s) => s.projectionEffects)
  )
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
  const projectionEffectId = resolveProjectionEffectSelection(
    'projectionEffect' in routeQuery ? routeQuery.projectionEffect : undefined,
    projectionEffects.selectedEffect,
    projectionVisualTestMode !== undefined
  )

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
    const root = projectionVisualRootRef.current
    if (captureHandleClearFailedRef.current) {
      if (root) {
        root.dataset.projectionCaptureHandleStatus = 'clear_failed'
      }
      return
    }
    const registration = registerProjectionStageCaptureHandle({
      enabled: isStageOutputMode,
      ownerOrigin: captureOwnerOrigin,
      isTopLevel:
        typeof window === 'object' ? window.top === window.self : false,
      isSecureContext:
        typeof window === 'object' ? window.isSecureContext : false,
      referrer: typeof document === 'object' ? document.referrer : undefined,
      opener: typeof window === 'object' ? window.opener : null,
      session: captureHandleSession,
    })
    if (root) {
      root.dataset.projectionCaptureHandleStatus = registration.status
    }
    return () => {
      const cleanup = registration.dispose()
      if (cleanup === 'clear_failed') {
        captureHandleClearFailedRef.current = true
      }
      if (root) {
        root.dataset.projectionCaptureHandleStatus =
          cleanup === 'clear_failed' ? 'clear_failed' : 'inactive'
      }
    }
  }, [captureHandleSession, captureOwnerOrigin, isStageOutputMode])

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

  useEffect(() => {
    if (isDisplayOnlyMode || !controlOwner.isOwner) return
    const registration = registerAcceptedPreparedSamplePresentationOwner(
      (envelope, options) =>
        requestAcceptedPreparedSamplePresentation(
          envelope,
          presentAcceptedPreparedSampleAssistantResponse,
          options
        )
    )
    const privateWindow = window as Window & {
      __openPreparedSamplePresentationOperator?: (url: string) => boolean
    }
    Object.defineProperty(
      privateWindow,
      '__openPreparedSamplePresentationOperator',
      {
        value: (url: string) => Boolean(registration.openOperator(url)),
        configurable: true,
        enumerable: false,
      }
    )
    return () => {
      delete privateWindow.__openPreparedSamplePresentationOperator
      registration.dispose()
    }
  }, [controlOwner.isOwner, isDisplayOnlyMode])

  return (
    <div
      ref={projectionVisualRootRef}
      className="projection-visual relative h-[100svh] overflow-hidden bg-[#00ff00]"
      data-projection-visual-mode={projectionVisualMode}
      data-projection-visual-test-mode={projectionVisualTestMode ?? 'none'}
      data-projection-visual-stimulus-ref={
        projectionVisualStimulusRef ?? 'none'
      }
      data-projection-effect-id={projectionEffectId ?? 'none'}
      data-projection-effect-host-state={projectionEffectHostState}
      data-projection-effect-receiver-state={projectionEffectReceiverState}
      data-projection-capture-handle-status="inactive"
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
          onDanceLifecycleAcceptanceReady={handleDanceLifecycleAcceptanceReady}
        />
      )}
      <AvatarFireThunderEffectLayer
        intentReceiverEnabled={isStageOutputMode}
        onHostStateChange={setProjectionEffectHostState}
        onIntentReceiverStateChange={setProjectionEffectReceiverState}
      />
      <ProjectionVisualStimulusRefBridge
        enabled={modelType === 'vrm'}
        stimulusRef={projectionVisualStimulusRef}
        acceptDanceLifecycleCandidate={danceLifecycleAcceptancePredicate}
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
      <ProjectionVisualCalibrationPanel
        enabled={!isDisplayOnlyMode && controlOwner.isOwner}
        framingEnabled={modelType === 'vrm'}
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
