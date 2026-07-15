import { useEffect, useRef, useState } from 'react'

import settingsStore from '@/features/stores/settings'
import {
  CAMERA_HORIZONTAL_FOV_DEFAULT,
  CAMERA_HORIZONTAL_FOV_MAX,
  CAMERA_HORIZONTAL_FOV_MIN,
  isCameraHorizontalFov,
  isLightingIntensity,
  LIGHTING_INTENSITY_DEFAULT,
  LIGHTING_INTENSITY_MAX,
  LIGHTING_INTENSITY_MIN,
} from '@/features/stores/settingsValidation'

type ProjectionVisualCalibrationPanelProps = {
  enabled: boolean
}

type CalibrationSnapshot = {
  cameraHorizontalFov: number
  lightingIntensity: number
}

const CAMERA_FOV_PRESETS = [30, 35, 45] as const

const applyCameraHorizontalFov = (value: number) => {
  if (!isCameraHorizontalFov(value)) return false
  settingsStore.setState({ cameraHorizontalFov: value })
  return true
}

const applyLightingIntensity = (value: number) => {
  if (!isLightingIntensity(value)) return false
  settingsStore.setState({ lightingIntensity: value })
  return true
}

export function ProjectionVisualCalibrationPanel({
  enabled,
}: ProjectionVisualCalibrationPanelProps) {
  const cameraHorizontalFov = settingsStore((s) => s.cameraHorizontalFov)
  const storedLightingIntensity = settingsStore((s) => s.lightingIntensity)
  const lightingIntensity = isLightingIntensity(storedLightingIntensity)
    ? storedLightingIntensity
    : LIGHTING_INTENSITY_DEFAULT
  const [isOpen, setIsOpen] = useState(false)
  const [cameraFovInput, setCameraFovInput] = useState(
    String(cameraHorizontalFov)
  )
  const [lightingInput, setLightingInput] = useState(
    lightingIntensity.toFixed(1)
  )
  const openSnapshotRef = useRef<CalibrationSnapshot>({
    cameraHorizontalFov,
    lightingIntensity,
  })

  useEffect(() => {
    setCameraFovInput(String(cameraHorizontalFov))
  }, [cameraHorizontalFov])

  useEffect(() => {
    setLightingInput(lightingIntensity.toFixed(1))
  }, [lightingIntensity])

  useEffect(() => {
    if (!enabled) setIsOpen(false)
  }, [enabled])

  if (!enabled) return null

  const openPanel = () => {
    openSnapshotRef.current = { cameraHorizontalFov, lightingIntensity }
    setIsOpen(true)
  }

  const commitCameraFovInput = () => {
    if (!applyCameraHorizontalFov(Number(cameraFovInput))) {
      setCameraFovInput(String(cameraHorizontalFov))
    }
  }

  const commitLightingInput = () => {
    if (!applyLightingIntensity(Number(lightingInput))) {
      setLightingInput(lightingIntensity.toFixed(1))
    }
  }

  const restoreOpenSnapshot = () => {
    applyCameraHorizontalFov(openSnapshotRef.current.cameraHorizontalFov)
    applyLightingIntensity(openSnapshotRef.current.lightingIntensity)
  }

  const restoreDefaults = () => {
    applyCameraHorizontalFov(CAMERA_HORIZONTAL_FOV_DEFAULT)
    applyLightingIntensity(LIGHTING_INTENSITY_DEFAULT)
  }

  return (
    <div
      className="fixed right-4 top-4 z-[38] flex flex-col items-end gap-2"
      data-projection-calibration-owner="operator-settings-store"
    >
      <button
        type="button"
        onClick={isOpen ? () => setIsOpen(false) : openPanel}
        className="rounded-full border border-cyan-100/50 bg-slate-950/85 px-4 py-2 text-sm font-bold text-cyan-50 shadow-lg backdrop-blur hover:bg-slate-900"
        aria-expanded={isOpen}
        aria-controls="projection-calibration-panel"
      >
        {isOpen ? '投影調整を閉じる' : '投影調整'}
      </button>

      {isOpen && (
        <section
          id="projection-calibration-panel"
          role="dialog"
          aria-label="投影キャリブレーションと外観"
          className="max-h-[calc(100vh-5rem)] w-[min(24rem,calc(100vw-2rem))] overflow-y-auto rounded-2xl border border-cyan-100/40 bg-slate-950/95 p-4 text-cyan-50 shadow-2xl backdrop-blur"
        >
          <header className="mb-4">
            <h2 className="text-lg font-black">Projection Calibration</h2>
            <p className="mt-1 text-xs leading-5 text-cyan-100/75">
              変更はこの端末の設定へ保存され、投影画面へ即時反映されます。
            </p>
          </header>

          <section className="mb-5 rounded-xl border border-cyan-100/20 p-3">
            <h3 className="mb-3 text-sm font-black uppercase tracking-wide text-cyan-100">
              Camera / Framing
            </h3>
            <label
              className="block text-sm font-bold"
              htmlFor="camera-fov-range"
            >
              水平画角: {cameraHorizontalFov}°
            </label>
            <input
              id="camera-fov-range"
              aria-label="投影カメラの水平画角スライダー"
              type="range"
              min={CAMERA_HORIZONTAL_FOV_MIN}
              max={CAMERA_HORIZONTAL_FOV_MAX}
              step={1}
              value={cameraHorizontalFov}
              onChange={(event) =>
                applyCameraHorizontalFov(Number(event.target.value))
              }
              className="input-range my-3 w-full"
            />
            <div className="flex items-center gap-2">
              <input
                aria-label="投影カメラの水平画角数値"
                type="number"
                min={CAMERA_HORIZONTAL_FOV_MIN}
                max={CAMERA_HORIZONTAL_FOV_MAX}
                step={1}
                value={cameraFovInput}
                onChange={(event) => setCameraFovInput(event.target.value)}
                onBlur={commitCameraFovInput}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') commitCameraFovInput()
                }}
                className="w-24 rounded-lg border border-cyan-100/30 bg-slate-900 px-3 py-2 text-right"
              />
              <span aria-hidden="true">°</span>
              <div className="ml-auto flex gap-1">
                {CAMERA_FOV_PRESETS.map((value) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => applyCameraHorizontalFov(value)}
                    className="rounded-md border border-cyan-100/30 px-2 py-1 text-xs hover:bg-cyan-50/10"
                  >
                    {value}°
                  </button>
                ))}
              </div>
            </div>
            <p className="mt-2 text-xs leading-5 text-cyan-100/65">
              30°は遠距離投影、35°は既定、45°は近距離表示の目安です。
            </p>
          </section>

          <section className="mb-4 rounded-xl border border-cyan-100/20 p-3">
            <h3 className="mb-3 text-sm font-black uppercase tracking-wide text-cyan-100">
              Layer / Light
            </h3>
            <label
              className="block text-sm font-bold"
              htmlFor="projection-lighting-range"
            >
              VRM照明: {lightingIntensity.toFixed(1)}
            </label>
            <input
              id="projection-lighting-range"
              aria-label="VRM照明の強度スライダー"
              type="range"
              min={LIGHTING_INTENSITY_MIN}
              max={LIGHTING_INTENSITY_MAX}
              step={0.1}
              value={lightingIntensity}
              onChange={(event) =>
                applyLightingIntensity(Number(event.target.value))
              }
              className="input-range my-3 w-full"
            />
            <input
              aria-label="VRM照明の強度数値"
              type="number"
              min={LIGHTING_INTENSITY_MIN}
              max={LIGHTING_INTENSITY_MAX}
              step={0.1}
              value={lightingInput}
              onChange={(event) => setLightingInput(event.target.value)}
              onBlur={commitLightingInput}
              onKeyDown={(event) => {
                if (event.key === 'Enter') commitLightingInput()
              }}
              className="w-24 rounded-lg border border-cyan-100/30 bg-slate-900 px-3 py-2 text-right"
            />
          </section>

          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={restoreOpenSnapshot}
              className="rounded-lg border border-cyan-100/30 px-3 py-2 text-xs font-bold hover:bg-cyan-50/10"
            >
              開いた時の値に戻す
            </button>
            <button
              type="button"
              onClick={restoreDefaults}
              className="rounded-lg border border-cyan-100/30 px-3 py-2 text-xs font-bold hover:bg-cyan-50/10"
            >
              既定値へ戻す
            </button>
          </div>
        </section>
      )}
    </div>
  )
}
