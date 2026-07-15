import { useEffect, useRef, useState, type CSSProperties } from 'react'

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
import {
  DEFAULT_SPEECH_BUBBLE_PRESENTATION,
  isSpeechBubblePresentationSettings,
  resolveSpeechBubblePlacement,
  resolveSpeechBubblePresentationSettings,
  resolveSpeechBubbleTailAngle,
  type SpeechBubblePresentationSettings,
} from '@/features/projectionVisualBubble/presentation'

type ProjectionVisualCalibrationPanelProps = {
  enabled: boolean
}

type CalibrationSnapshot = {
  cameraHorizontalFov: number
  lightingIntensity: number
  speechBubblePresentation: SpeechBubblePresentationSettings
}

const CAMERA_FOV_PRESETS = [30, 35, 45] as const
const SHORT_PREVIEW = '今日はどんなことを一緒に試しましょうか。'
const LONG_PREVIEW =
  '長い文章でも、読みやすい文字の大きさと行間を保ちながら、吹き出しの中で順番に読めるように表示します。位置や大きさ、喉の向きも投影環境に合わせて調整できます。'

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

const applySpeechBubblePresentation = (
  patch: Partial<SpeechBubblePresentationSettings>
) => {
  const current = resolveSpeechBubblePresentationSettings(
    settingsStore.getState().speechBubblePresentation
  )
  const next = { ...current, ...patch }
  if (!isSpeechBubblePresentationSettings(next)) return false
  settingsStore.setState({ speechBubblePresentation: next })
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
  const speechBubblePresentation = resolveSpeechBubblePresentationSettings(
    settingsStore((s) => s.speechBubblePresentation)
  )
  const [isOpen, setIsOpen] = useState(false)
  const [previewText, setPreviewText] = useState(SHORT_PREVIEW)
  const [cameraFovInput, setCameraFovInput] = useState(
    String(cameraHorizontalFov)
  )
  const [lightingInput, setLightingInput] = useState(
    lightingIntensity.toFixed(1)
  )
  const openSnapshotRef = useRef<CalibrationSnapshot>({
    cameraHorizontalFov,
    lightingIntensity,
    speechBubblePresentation,
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
    openSnapshotRef.current = {
      cameraHorizontalFov,
      lightingIntensity,
      speechBubblePresentation: { ...speechBubblePresentation },
    }
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
    settingsStore.setState({
      speechBubblePresentation: {
        ...openSnapshotRef.current.speechBubblePresentation,
      },
    })
  }

  const restoreDefaults = () => {
    applyCameraHorizontalFov(CAMERA_HORIZONTAL_FOV_DEFAULT)
    applyLightingIntensity(LIGHTING_INTENSITY_DEFAULT)
    settingsStore.setState({
      speechBubblePresentation: { ...DEFAULT_SPEECH_BUBBLE_PRESENTATION },
    })
  }

  const previewViewport = { width: 360, height: 203 }
  const previewBubbleWidth = Math.max(
    96,
    previewViewport.width * (speechBubblePresentation.widthPercent / 100)
  )
  const previewBubbleHeight =
    speechBubblePresentation.heightMode === 'fixed'
      ? Math.max(
          64,
          previewViewport.height *
            (speechBubblePresentation.heightPercent / 100)
        )
      : 88
  const previewPlacement = resolveSpeechBubblePlacement({
    preferredX: speechBubblePresentation.positionX,
    preferredY: speechBubblePresentation.positionY,
    bubbleWidth: previewBubbleWidth,
    bubbleHeight: previewBubbleHeight,
    viewportWidth: previewViewport.width,
    viewportHeight: previewViewport.height,
    safeAreaPx: 6,
    tailExtentPx: 28,
  })
  const previewTailAngle = resolveSpeechBubbleTailAngle({
    side: speechBubblePresentation.tailSide,
    targetX: speechBubblePresentation.tailTargetX * previewViewport.width,
    targetY: speechBubblePresentation.tailTargetY * previewViewport.height,
    centerX: previewPlacement.centerX,
    centerY: previewPlacement.centerY,
    bubbleWidth: previewBubbleWidth,
    bubbleHeight: previewBubbleHeight,
  })
  const previewStyle = {
    left: previewPlacement.centerX,
    top: previewPlacement.centerY,
    width: previewBubbleWidth,
    height:
      speechBubblePresentation.heightMode === 'fixed'
        ? previewBubbleHeight
        : undefined,
    maxHeight: previewBubbleHeight,
    '--speech-bubble-font-size': `${Math.max(10, speechBubblePresentation.fontSizePx * 0.55)}px`,
    '--speech-bubble-line-height': String(speechBubblePresentation.lineHeight),
    '--speech-bubble-tail-angle': `${previewTailAngle}deg`,
  } as CSSProperties

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

          <section className="mb-4 rounded-xl border border-cyan-100/20 p-3">
            <h3 className="mb-3 text-sm font-black uppercase tracking-wide text-cyan-100">
              Speech Bubble
            </h3>
            <p className="mb-3 text-xs leading-5 text-cyan-100/70">
              手動設定が現在の唯一の表示元です。安全領域で補正された場合も、選んだ値自体は書き換えません。
            </p>

            <div className="mb-3 flex gap-2">
              <button
                type="button"
                onClick={() => setPreviewText(SHORT_PREVIEW)}
                className="rounded-md border border-cyan-100/30 px-2 py-1 text-xs"
              >
                短文見本
              </button>
              <button
                type="button"
                onClick={() => setPreviewText(LONG_PREVIEW)}
                className="rounded-md border border-cyan-100/30 px-2 py-1 text-xs"
              >
                長文見本
              </button>
            </div>
            <div
              aria-label="吹き出し配置プレビュー"
              className="projection-bubble-preview-stage mb-2"
              data-timing-mode={speechBubblePresentation.timingMode}
              data-safe-area-clamped={String(previewPlacement.clamped)}
            >
              <div
                aria-label="吹き出し文字プレビュー"
                className="td-assistant-bubble projection-bubble-preview"
                data-tail-side={speechBubblePresentation.tailSide}
                style={previewStyle}
              >
                <div className="td-assistant-bubble-text">{previewText}</div>
                <span className="td-assistant-bubble-tail" aria-hidden="true" />
              </div>
            </div>
            <div
              role="status"
              aria-live="polite"
              className="mb-4 text-[11px] text-cyan-100/80"
            >
              表示方式: {speechBubblePresentation.timingMode} /{' '}
              {previewPlacement.clamped
                ? '安全領域で補正中（選択値は変更しません）'
                : '安全領域内（補正なし）'}
            </div>

            <label
              className="mb-1 block text-xs font-bold"
              htmlFor="bubble-font-size"
            >
              文字サイズ: {speechBubblePresentation.fontSizePx}px
            </label>
            <input
              id="bubble-font-size"
              aria-label="吹き出し文字サイズ"
              type="range"
              min={16}
              max={36}
              step={1}
              value={speechBubblePresentation.fontSizePx}
              onChange={(event) =>
                applySpeechBubblePresentation({
                  fontSizePx: Number(event.target.value),
                })
              }
              className="input-range mb-3 w-full"
            />

            <label
              className="mb-1 block text-xs font-bold"
              htmlFor="bubble-line-height"
            >
              行間: {speechBubblePresentation.lineHeight.toFixed(2)}
            </label>
            <input
              id="bubble-line-height"
              aria-label="吹き出し行間"
              type="range"
              min={1.2}
              max={2}
              step={0.05}
              value={speechBubblePresentation.lineHeight}
              onChange={(event) =>
                applySpeechBubblePresentation({
                  lineHeight: Number(event.target.value),
                })
              }
              className="input-range mb-3 w-full"
            />

            <div className="mb-3 grid grid-cols-2 gap-2">
              <label className="text-xs font-bold">
                幅
                <select
                  aria-label="吹き出し幅モード"
                  value={speechBubblePresentation.widthMode}
                  onChange={(event) =>
                    applySpeechBubblePresentation({
                      widthMode: event.target.value as 'auto' | 'fixed',
                    })
                  }
                  className="mt-1 w-full rounded border border-cyan-100/30 bg-slate-900 p-2"
                >
                  <option value="auto">自動上限</option>
                  <option value="fixed">固定</option>
                </select>
              </label>
              <label className="text-xs font-bold">
                高さ
                <select
                  aria-label="吹き出し高さモード"
                  value={speechBubblePresentation.heightMode}
                  onChange={(event) =>
                    applySpeechBubblePresentation({
                      heightMode: event.target.value as 'auto' | 'fixed',
                    })
                  }
                  className="mt-1 w-full rounded border border-cyan-100/30 bg-slate-900 p-2"
                >
                  <option value="auto">自動上限</option>
                  <option value="fixed">固定</option>
                </select>
              </label>
            </div>
            <label
              className="mb-1 block text-xs font-bold"
              htmlFor="bubble-width"
            >
              幅: {speechBubblePresentation.widthPercent}vw
            </label>
            <input
              id="bubble-width"
              aria-label="吹き出し幅"
              type="range"
              min={20}
              max={75}
              value={speechBubblePresentation.widthPercent}
              onChange={(event) =>
                applySpeechBubblePresentation({
                  widthPercent: Number(event.target.value),
                })
              }
              className="input-range mb-3 w-full"
            />
            <label
              className="mb-1 block text-xs font-bold"
              htmlFor="bubble-height"
            >
              高さ: {speechBubblePresentation.heightPercent}vh
            </label>
            <input
              id="bubble-height"
              aria-label="吹き出し高さ"
              type="range"
              min={18}
              max={75}
              value={speechBubblePresentation.heightPercent}
              onChange={(event) =>
                applySpeechBubblePresentation({
                  heightPercent: Number(event.target.value),
                })
              }
              className="input-range mb-3 w-full"
            />

            <div className="mb-3 grid grid-cols-2 gap-2">
              {(['X', 'Y'] as const).map((axis) => {
                const key = axis === 'X' ? 'positionX' : 'positionY'
                return (
                  <label key={axis} className="text-xs font-bold">
                    位置 {axis}:{' '}
                    {Math.round(speechBubblePresentation[key] * 100)}%
                    <input
                      aria-label={`吹き出し位置${axis}`}
                      type="range"
                      min={0}
                      max={1}
                      step={0.01}
                      value={speechBubblePresentation[key]}
                      onChange={(event) =>
                        applySpeechBubblePresentation({
                          [key]: Number(event.target.value),
                        })
                      }
                      className="input-range mt-1 w-full"
                    />
                  </label>
                )
              })}
            </div>

            <label className="mb-3 block text-xs font-bold">
              喉の辺
              <select
                aria-label="吹き出し喉の向き"
                value={speechBubblePresentation.tailSide}
                onChange={(event) =>
                  applySpeechBubblePresentation({
                    tailSide: event.target.value as
                      | 'left'
                      | 'right'
                      | 'top'
                      | 'bottom',
                  })
                }
                className="mt-1 w-full rounded border border-cyan-100/30 bg-slate-900 p-2"
              >
                <option value="left">左</option>
                <option value="right">右</option>
                <option value="top">上</option>
                <option value="bottom">下</option>
              </select>
            </label>
            <div className="mb-3 grid grid-cols-2 gap-2">
              {(['X', 'Y'] as const).map((axis) => {
                const key = axis === 'X' ? 'tailTargetX' : 'tailTargetY'
                return (
                  <label key={axis} className="text-xs font-bold">
                    喉の目標 {axis}:{' '}
                    {Math.round(speechBubblePresentation[key] * 100)}%
                    <input
                      aria-label={`吹き出し喉の目標${axis}`}
                      type="range"
                      min={0}
                      max={1}
                      step={0.01}
                      value={speechBubblePresentation[key]}
                      onChange={(event) =>
                        applySpeechBubblePresentation({
                          [key]: Number(event.target.value),
                        })
                      }
                      className="input-range mt-1 w-full"
                    />
                  </label>
                )
              })}
            </div>

            <label className="mb-3 block text-xs font-bold">
              表示時間
              <select
                aria-label="吹き出し表示時間モード"
                value={speechBubblePresentation.timingMode}
                onChange={(event) =>
                  applySpeechBubblePresentation({
                    timingMode: event.target
                      .value as SpeechBubblePresentationSettings['timingMode'],
                  })
                }
                className="mt-1 w-full rounded border border-cyan-100/30 bg-slate-900 p-2"
              >
                <option value="speech-synchronized">音声終了＋保持</option>
                <option value="reading-time">文字量から算出</option>
                <option value="fixed-duration">固定時間</option>
                <option value="until-next-message">次の発話まで</option>
              </select>
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="text-xs font-bold">
                最短表示 (秒)
                <input
                  aria-label="吹き出し最短表示秒数"
                  type="number"
                  min={1}
                  max={30}
                  value={speechBubblePresentation.minVisibleMs / 1000}
                  onChange={(event) =>
                    applySpeechBubblePresentation({
                      minVisibleMs: Number(event.target.value) * 1000,
                    })
                  }
                  className="mt-1 w-full rounded border border-cyan-100/30 bg-slate-900 p-2"
                />
              </label>
              <label className="text-xs font-bold">
                音声後保持 (秒)
                <input
                  aria-label="吹き出し音声後保持秒数"
                  type="number"
                  min={0}
                  max={15}
                  value={speechBubblePresentation.postSpeechHoldMs / 1000}
                  onChange={(event) =>
                    applySpeechBubblePresentation({
                      postSpeechHoldMs: Number(event.target.value) * 1000,
                    })
                  }
                  className="mt-1 w-full rounded border border-cyan-100/30 bg-slate-900 p-2"
                />
              </label>
              <label className="text-xs font-bold">
                固定時間 (秒)
                <input
                  aria-label="吹き出し固定表示秒数"
                  type="number"
                  min={1}
                  max={60}
                  value={speechBubblePresentation.fixedDurationMs / 1000}
                  onChange={(event) =>
                    applySpeechBubblePresentation({
                      fixedDurationMs: Number(event.target.value) * 1000,
                    })
                  }
                  className="mt-1 w-full rounded border border-cyan-100/30 bg-slate-900 p-2"
                />
              </label>
              <label className="text-xs font-bold">
                読了時間 上限 (秒)
                <input
                  aria-label="吹き出し読了時間上限秒数"
                  type="number"
                  min={1}
                  max={60}
                  value={speechBubblePresentation.readingMaxMs / 1000}
                  onChange={(event) =>
                    applySpeechBubblePresentation({
                      readingMaxMs: Number(event.target.value) * 1000,
                    })
                  }
                  className="mt-1 w-full rounded border border-cyan-100/30 bg-slate-900 p-2"
                />
              </label>
            </div>
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
