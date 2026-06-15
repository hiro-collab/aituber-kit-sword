import { useCallback, useEffect, useRef } from 'react'

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

  const publishVrmViewerDebugState = useCallback(
    (selectedVrmPath: string | null | undefined) => {
      ;(window as any).__projectionVisualVrmViewerDebug = {
        selectedVrmPath: selectedVrmPath ?? null,
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

  const canvasRef = useCallback(
    (canvas: HTMLCanvasElement) => {
      if (canvas) {
        const { viewer } = homeStore.getState()
        const { selectedVrmPath } = settingsStore.getState()
        viewer.setup(canvas)
        viewer.loadVrm(selectedVrmPath, {
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
            viewer.loadVrm(url, {
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
    [bindMotionStimulusReceiver, publishVrmViewerDebugState]
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
    viewer.loadVrm(selectedVrmPath, {
      idleNeutralVisualTestMode: frozenVisualTestMode,
    })
    publishVrmViewerDebugState(selectedVrmPath)
  }, [
    frozenVisualTestMode,
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
      {poseAdjustMode && <PoseTestButton />}
    </>
  )
}
