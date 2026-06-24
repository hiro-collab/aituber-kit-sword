import { useCallback, useEffect, useRef, useState } from 'react'

import homeStore from '@/features/stores/home'
import settingsStore from '@/features/stores/settings'
import { loadVRMAnimation } from '@/lib/VRMAnimation/loadVRMAnimation'
import PoseTestButton from '@/components/poseTestButton'
import type { ProjectionVisualTestMode } from '@/utils/projectionVisualQuery'
import {
  MOTION_STIMULUS_RECEIVER_EVENT,
  MOTION_STIMULUS_RECEIVER_RESULT_EVENT,
  type MotionStimulusReceiverResult,
} from '@/features/motionRuntime/motionStimulusReceiver'

type VrmViewerProps = {
  visualTestMode?: ProjectionVisualTestMode
  motionStimulusAssetPath?: string
}

type VrmLoadError = {
  selectedVrmPathClass: string
  reasonCode: string
}

const VRM_PUBLIC_ROOT_HINT = 'organs/expression/aituber-kit/public/vrm'
const VRM_PATH_HINT = '/vrm/<file>.vrm'

const getVrmFileNameFromPath = (selectedVrmPath: string) => {
  if (!selectedVrmPath.startsWith('/vrm/')) return undefined
  const fileName = selectedVrmPath.slice('/vrm/'.length)
  if (!fileName || fileName.includes('/') || fileName.includes('\\')) {
    return undefined
  }
  try {
    return decodeURIComponent(fileName)
  } catch {
    return fileName
  }
}

const getVrmPathClass = (selectedVrmPath: string) => {
  if (selectedVrmPath.startsWith('blob:')) return 'browser_blob_vrm'
  if (getVrmFileNameFromPath(selectedVrmPath)) return 'configured_vrm_public_path'
  if (selectedVrmPath.startsWith('/vrm/')) return 'invalid_vrm_public_path'
  return 'unsupported_vrm_path'
}

const createVrmLoadError = (selectedVrmPath: string): VrmLoadError => {
  const selectedVrmPathClass = getVrmPathClass(selectedVrmPath)
  return {
    selectedVrmPathClass,
    reasonCode: 'selected_vrm_load_failed',
  }
}

export default function VrmViewer({
  visualTestMode,
  motionStimulusAssetPath,
}: VrmViewerProps = {}) {
  const loadedVrmPathRef = useRef<string | null>(null)
  const loadedVisualTestModeRef = useRef<ProjectionVisualTestMode | undefined>(
    undefined
  )
  const visualTestModeRef = useRef<ProjectionVisualTestMode | undefined>(
    visualTestMode
  )
  const idleNeutralVisualTestMode = visualTestMode === 'idle-neutral'
  const selfMirrorBaselineVisualTestMode =
    visualTestMode === 'self-mirror-baseline'
  const frozenVisualTestMode =
    idleNeutralVisualTestMode || selfMirrorBaselineVisualTestMode
  const frozenVisualTestModeRef = useRef(frozenVisualTestMode)
  const motionStimulusAssetPathRef = useRef<string | undefined>(
    motionStimulusAssetPath
  )
  const motionStimulusHandlerRef = useRef<((event: Event) => void) | null>(null)
  const selectedVrmPath = settingsStore((s) => s.selectedVrmPath)
  const [vrmLoadError, setVrmLoadError] = useState<VrmLoadError | null>(null)

  const publishVrmViewerDebugState = useCallback(
    (selectedVrmPath: string | null | undefined) => {
      ;(window as any).__projectionVisualVrmViewerDebug = {
        selectedVrmPathClass: selectedVrmPath
          ? getVrmPathClass(selectedVrmPath)
          : null,
        visualTestMode: visualTestModeRef.current ?? null,
        frozenVisualTestMode: frozenVisualTestModeRef.current,
        selfMirrorBaselineVisualTestMode:
          visualTestModeRef.current === 'self-mirror-baseline',
        motionStimulusAssetPath: motionStimulusAssetPathRef.current ?? null,
      }
    },
    []
  )

  const dispatchMotionStimulusResult = useCallback(
    (result: MotionStimulusReceiverResult) => {
      ;(window as any).__projectionVisualMotionStimulusResult = result
      window.dispatchEvent(
        new CustomEvent(MOTION_STIMULUS_RECEIVER_RESULT_EVENT, {
          detail: result,
        })
      )
    },
    []
  )

  const createFailedMotionStimulusResult = useCallback(
    (detail: unknown): MotionStimulusReceiverResult => {
      const record =
        detail && typeof detail === 'object'
          ? (detail as Record<string, unknown>)
          : {}
      const trace =
        record.trace && typeof record.trace === 'object'
          ? (record.trace as Record<string, unknown>)
          : {}
      const stringValue = (value: unknown) =>
        typeof value === 'string' ? value : undefined

      return {
        source_kind: 'thought_core_motion_stimulus_v0',
        debug_playback: false,
        accepted: false,
        status: 'failed_safe',
        reason_code: 'motion_stimulus_receiver_exception',
        safe_visible_state: 'no_visible_change',
        motion_event_id: stringValue(record.motion_event_id),
        stimulus_id: stringValue(record.stimulus_id),
        stimulus_instance_id: stringValue(record.stimulus_instance_id),
        event_id: stringValue(trace.event_id),
        turn_id: stringValue(trace.turn_id),
        runtime_result_id:
          stringValue(trace.runtime_result_id) ??
          stringValue(trace.driver_result_id),
        lifecycle_trace: [
          {
            state: 'result',
            status: 'failed_safe',
            reason_code: 'motion_stimulus_receiver_exception',
            at_ms: Date.now(),
          },
        ],
      }
    },
    []
  )

  const bindMotionStimulusReceiver = useCallback(() => {
    if (motionStimulusHandlerRef.current) {
      return
    }

    const handleMotionStimulus = (event: Event) => {
      const detail = event instanceof CustomEvent ? event.detail : undefined
      const { viewer } = homeStore.getState()
      void viewer
        .receiveMotionStimulus(detail)
        .then(dispatchMotionStimulusResult)
        .catch((error) => {
          console.error('Failed to receive Motion Runtime stimulus:', error)
          dispatchMotionStimulusResult(createFailedMotionStimulusResult(detail))
        })
    }

    motionStimulusHandlerRef.current = handleMotionStimulus
    window.addEventListener(
      MOTION_STIMULUS_RECEIVER_EVENT,
      handleMotionStimulus
    )
  }, [createFailedMotionStimulusResult, dispatchMotionStimulusResult])

  const unbindMotionStimulusReceiver = useCallback(() => {
    const handleMotionStimulus = motionStimulusHandlerRef.current
    if (!handleMotionStimulus) {
      return
    }

    window.removeEventListener(
      MOTION_STIMULUS_RECEIVER_EVENT,
      handleMotionStimulus
    )
    motionStimulusHandlerRef.current = null
  }, [])

  useEffect(() => {
    visualTestModeRef.current = visualTestMode
    frozenVisualTestModeRef.current = frozenVisualTestMode
  }, [frozenVisualTestMode, visualTestMode])

  const loadVrmWithErrorState = useCallback(
    (
      selectedVrmPath: string,
      options: { idleNeutralVisualTestMode?: boolean } = {}
    ) => {
      const { viewer } = homeStore.getState()
      setVrmLoadError(null)
      void viewer
        .loadVrm(selectedVrmPath, options)
        .then(() => {
          ;(window as any).__projectionVisualVrmLoadError = null
          setVrmLoadError((current) =>
            current?.selectedVrmPathClass === getVrmPathClass(selectedVrmPath)
              ? null
              : current
          )
        })
        .catch(() => {
          const loadError = createVrmLoadError(selectedVrmPath)
          console.warn('Selected VRM load failed', {
            reason_code: loadError.reasonCode,
            path_class: loadError.selectedVrmPathClass,
          })
          ;(window as any).__projectionVisualVrmLoadError = {
            selectedVrmPathClass: loadError.selectedVrmPathClass,
            reasonCode: loadError.reasonCode,
          }
          setVrmLoadError(loadError)
        })
    },
    []
  )

  const canvasRef = useCallback(
    (canvas: HTMLCanvasElement) => {
      if (canvas) {
        const { viewer } = homeStore.getState()
        const { selectedVrmPath } = settingsStore.getState()
        viewer.setup(canvas)
        loadVrmWithErrorState(selectedVrmPath, {
          idleNeutralVisualTestMode: frozenVisualTestModeRef.current,
        })
        viewer.setMotionRuntimeAssetPath(motionStimulusAssetPathRef.current)
        bindMotionStimulusReceiver()
        publishVrmViewerDebugState(selectedVrmPath)
        loadedVrmPathRef.current = selectedVrmPath
        loadedVisualTestModeRef.current = visualTestModeRef.current

        // Drag and DropでVRMを差し替え
        canvas.addEventListener('dragover', function (event) {
          event.preventDefault()
        })

        canvas.addEventListener('drop', function (event) {
          event.preventDefault()

          const files = event.dataTransfer?.files
          if (!files) {
            return
          }

          const file = files[0]
          if (!file) {
            return
          }
          const file_type = file.name.split('.').pop()
          if (file_type === 'vrm') {
            const blob = new Blob([file], { type: 'application/octet-stream' })
            const url = window.URL.createObjectURL(blob)
            loadVrmWithErrorState(url, {
              idleNeutralVisualTestMode: frozenVisualTestModeRef.current,
            })
            publishVrmViewerDebugState(url)
          } else if (file_type === 'vrma') {
            const blob = new Blob([file], { type: 'application/octet-stream' })
            const url = window.URL.createObjectURL(blob)
            loadVRMAnimation(url)
              .then((vrma) => {
                if (vrma) viewer.model?.loadAnimation(vrma)
              })
              .catch((error) => {
                console.error('Failed to load VRMA:', error)
              })
              .finally(() => URL.revokeObjectURL(url))
          } else if (file.type.startsWith('image/')) {
            const reader = new FileReader()
            reader.readAsDataURL(file)
            reader.onload = function () {
              const image = reader.result as string
              image !== '' && homeStore.setState({ modalImage: image })
            }
          }
        })
      }
    },
    [
      bindMotionStimulusReceiver,
      loadVrmWithErrorState,
      publishVrmViewerDebugState,
    ]
  )

  useEffect(() => {
    const { viewer } = homeStore.getState()
    if (
      !viewer.isReady ||
      !selectedVrmPath ||
      (loadedVrmPathRef.current === selectedVrmPath &&
        loadedVisualTestModeRef.current === visualTestMode)
    ) {
      return
    }
    loadedVrmPathRef.current = selectedVrmPath
    loadedVisualTestModeRef.current = visualTestMode
    loadVrmWithErrorState(selectedVrmPath, {
      idleNeutralVisualTestMode: frozenVisualTestMode,
    })
    publishVrmViewerDebugState(selectedVrmPath)
  }, [
    frozenVisualTestMode,
    loadVrmWithErrorState,
    publishVrmViewerDebugState,
    selectedVrmPath,
    visualTestMode,
  ])

  useEffect(() => {
    motionStimulusAssetPathRef.current = motionStimulusAssetPath
    const { viewer } = homeStore.getState()
    viewer.setMotionRuntimeAssetPath(motionStimulusAssetPath)
    publishVrmViewerDebugState(selectedVrmPath)
  }, [motionStimulusAssetPath, publishVrmViewerDebugState, selectedVrmPath])

  useEffect(() => {
    bindMotionStimulusReceiver()
    return unbindMotionStimulusReceiver
  }, [bindMotionStimulusReceiver, unbindMotionStimulusReceiver])

  const poseAdjustMode = settingsStore((s) => s.poseAdjustMode)

  return (
    <>
      <div className={'absolute top-0 left-0 w-screen h-[100svh] z-5'}>
        <canvas ref={canvasRef} className={'h-full w-full'}></canvas>
      </div>
      {vrmLoadError && (
        <div
          className="absolute left-4 top-4 z-20 max-w-xl rounded-md border border-red-300 bg-black/80 p-4 text-sm leading-6 text-white shadow-lg"
          role="alert"
          aria-live="polite"
        >
          <div className="mb-2 font-bold text-red-200">
            VRMを読み込めませんでした
          </div>
          <div>
            VRMパス種別: <code>{vrmLoadError.selectedVrmPathClass}</code>
          </div>
          <div>
            任意のローカルVRMを使う場合は、選択したファイル名のVRMを{' '}
            <code>{VRM_PUBLIC_ROOT_HINT}</code> に置き、{' '}
            <code>NEXT_PUBLIC_SELECTED_VRM_PATH={VRM_PATH_HINT}</code>{' '}
            を設定します。Windows absolute pathではなく、Next.jsが配信する{' '}
            <code>/vrm/...</code> の形を使います。
          </div>
          <div>
            .envを変えた後はNext.jsを再起動し、古いブラウザ保存設定が残る場合は
            設定画面でVRMを選び直すかサイトデータをクリアしてください。
          </div>
        </div>
      )}
      {poseAdjustMode && <PoseTestButton />}
    </>
  )
}
