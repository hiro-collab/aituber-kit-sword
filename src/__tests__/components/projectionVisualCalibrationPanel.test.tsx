import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'

import { ProjectionVisualCalibrationPanel } from '@/components/projectionVisualCalibrationPanel'
import { DEFAULT_SPEECH_BUBBLE_PRESENTATION } from '@/features/projectionVisualBubble/presentation'
import {
  DEFAULT_FLUID_FIRE_RELAY_PARAMETERS,
  DEFAULT_PROJECTION_EFFECTS_SETTINGS,
} from '@/features/projectionEffects/settings'
import homeStore from '@/features/stores/home'
import settingsStore from '@/features/stores/settings'
import toastStore from '@/features/stores/toast'

describe('ProjectionVisualCalibrationPanel', () => {
  const initialCameraHorizontalFov =
    settingsStore.getState().cameraHorizontalFov
  const initialLightingIntensity = settingsStore.getState().lightingIntensity
  const initialProjectionEffects = settingsStore.getState().projectionEffects
  const initialSpeechBubblePresentation =
    settingsStore.getState().speechBubblePresentation
  const initialFixedCharacterPosition =
    settingsStore.getState().fixedCharacterPosition
  const initialCharacterPosition = settingsStore.getState().characterPosition
  const initialCharacterRotation = settingsStore.getState().characterRotation

  afterEach(() => {
    cleanup()
    jest.restoreAllMocks()
    settingsStore.setState({
      cameraHorizontalFov: initialCameraHorizontalFov,
      lightingIntensity: initialLightingIntensity,
      projectionEffects: initialProjectionEffects,
      speechBubblePresentation: initialSpeechBubblePresentation,
      fixedCharacterPosition: initialFixedCharacterPosition,
      characterPosition: initialCharacterPosition,
      characterRotation: initialCharacterRotation,
    })
  })

  it('keeps every calibration control out of disabled display surfaces', () => {
    render(<ProjectionVisualCalibrationPanel enabled={false} />)

    expect(screen.queryByText('投影調整')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('dialog', {
        name: '投影キャリブレーションと外観',
      })
    ).not.toBeInTheDocument()
  })

  it('keeps VRM framing actions out of non-VRM operator modes', () => {
    render(<ProjectionVisualCalibrationPanel enabled framingEnabled={false} />)
    fireEvent.click(screen.getByText('投影調整'))

    expect(
      screen.queryByText('モデル全体へ自動フィット')
    ).not.toBeInTheDocument()
  })

  it('closes on ownership loss and captures a fresh snapshot after ownership returns', () => {
    settingsStore.setState({ cameraHorizontalFov: 30, lightingIntensity: 1 })
    const { rerender } = render(<ProjectionVisualCalibrationPanel enabled />)
    fireEvent.click(screen.getByText('投影調整'))

    rerender(<ProjectionVisualCalibrationPanel enabled={false} />)
    act(() => {
      settingsStore.setState({ cameraHorizontalFov: 45, lightingIntensity: 2 })
    })
    rerender(<ProjectionVisualCalibrationPanel enabled />)

    expect(
      screen.queryByRole('dialog', {
        name: '投影キャリブレーションと外観',
      })
    ).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('投影調整'))
    fireEvent.click(screen.getByText('30°'))
    fireEvent.change(screen.getByLabelText('VRM照明の強度スライダー'), {
      target: { value: '1.5' },
    })
    fireEvent.click(screen.getByText('画角・外観を開いた時へ戻す'))

    expect(settingsStore.getState().cameraHorizontalFov).toBe(45)
    expect(settingsStore.getState().lightingIntensity).toBe(2)
  })

  it.each([
    ['numeric string', '1.5'],
    ['object', { value: 1.5 }],
    ['null', null],
    ['not finite', Number.POSITIVE_INFINITY],
    ['zero', 0],
    ['below minimum', 0.09],
    ['above maximum', 3.01],
  ])(
    'renders safely for an invalid stored lighting value: %s',
    (_label, value) => {
      settingsStore.setState({
        lightingIntensity: value as unknown as number,
      })

      render(<ProjectionVisualCalibrationPanel enabled />)
      fireEvent.click(screen.getByText('投影調整'))

      expect(screen.getByLabelText('VRM照明の強度数値')).toHaveValue(1)
    }
  )

  it('updates FOV and lighting live through the settings owner', () => {
    settingsStore.setState({ cameraHorizontalFov: 35, lightingIntensity: 1 })
    render(<ProjectionVisualCalibrationPanel enabled />)

    fireEvent.click(screen.getByText('投影調整'))
    fireEvent.change(screen.getByLabelText('投影カメラの水平画角スライダー'), {
      target: { value: '45' },
    })
    fireEvent.change(screen.getByLabelText('VRM照明の強度スライダー'), {
      target: { value: '1.7' },
    })

    expect(settingsStore.getState().cameraHorizontalFov).toBe(45)
    expect(settingsStore.getState().lightingIntensity).toBe(1.7)
  })

  it('routes framing actions to the existing viewer authority only', () => {
    const viewer = homeStore.getState().viewer
    const fixCameraPosition = jest
      .spyOn(viewer, 'fixCameraPosition')
      .mockImplementation(() => {
        settingsStore.setState({ fixedCharacterPosition: true })
        return true
      })
    const unfixCameraPosition = jest
      .spyOn(viewer, 'unfixCameraPosition')
      .mockImplementation(() => {
        settingsStore.setState({ fixedCharacterPosition: false })
        return true
      })
    const autoFitCameraToModel = jest
      .spyOn(viewer, 'autoFitCameraToModel')
      .mockImplementation(() => {
        settingsStore.setState({ fixedCharacterPosition: false })
        return true
      })
    settingsStore.setState({ fixedCharacterPosition: false })
    render(<ProjectionVisualCalibrationPanel enabled />)
    fireEvent.click(screen.getByText('投影調整'))

    fireEvent.click(screen.getByText('現在の構図を固定'))
    expect(fixCameraPosition).toHaveBeenCalledTimes(1)
    expect(
      screen.getByText('固定解除', { selector: 'button' })
    ).not.toBeDisabled()

    fireEvent.click(screen.getByText('固定解除'))
    expect(unfixCameraPosition).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByText('モデル全体へ自動フィット'))
    expect(autoFitCameraToModel).toHaveBeenCalledTimes(1)
  })

  it('reports auto-fit failure without claiming completion', () => {
    const viewer = homeStore.getState().viewer
    jest.spyOn(viewer, 'autoFitCameraToModel').mockReturnValue(false)
    const addToast = jest.spyOn(toastStore.getState(), 'addToast')
    render(<ProjectionVisualCalibrationPanel enabled />)
    fireEvent.click(screen.getByText('投影調整'))

    fireEvent.click(screen.getByText('モデル全体へ自動フィット'))

    expect(addToast).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'error',
        message: expect.stringContaining('構図を変更できませんでした'),
      })
    )
    expect(addToast).not.toHaveBeenCalledWith(
      expect.objectContaining({ message: 'モデル全体へ自動フィットしました' })
    )
  })

  it('updates the bounded projection effect selection and parameters through the same owner', () => {
    settingsStore.setState({
      projectionEffects: { ...DEFAULT_PROJECTION_EFFECTS_SETTINGS },
    })
    render(<ProjectionVisualCalibrationPanel enabled />)
    fireEvent.click(screen.getByText('投影調整'))

    fireEvent.change(screen.getByLabelText('投影エフェクト'), {
      target: { value: 'fluidFireRelay' },
    })
    fireEvent.change(screen.getByLabelText('投影エフェクト 密度'), {
      target: { value: '1.2' },
    })

    expect(settingsStore.getState().projectionEffects).toEqual({
      selectedEffect: 'fluidFireRelay',
      fluidFireRelay: {
        ...DEFAULT_FLUID_FIRE_RELAY_PARAMETERS,
        densityGain: 1.2,
      },
    })
  })

  it('does not publish a redundant projection effect update for the same value', () => {
    settingsStore.setState({
      projectionEffects: { ...DEFAULT_PROJECTION_EFFECTS_SETTINGS },
    })
    render(<ProjectionVisualCalibrationPanel enabled />)
    fireEvent.click(screen.getByText('投影調整'))
    const setState = jest.spyOn(settingsStore, 'setState')

    fireEvent.change(screen.getByLabelText('投影エフェクト 密度'), {
      target: {
        value: String(DEFAULT_FLUID_FIRE_RELAY_PARAMETERS.densityGain),
      },
    })

    expect(setState).not.toHaveBeenCalled()
    setState.mockRestore()
  })

  it('restores projection effect selection and parameters to the opening snapshot', () => {
    const opening = {
      selectedEffect: 'fluidFireRelay' as const,
      fluidFireRelay: {
        ...DEFAULT_FLUID_FIRE_RELAY_PARAMETERS,
        bloomGain: 1.1,
      },
    }
    settingsStore.setState({ projectionEffects: opening })
    render(<ProjectionVisualCalibrationPanel enabled />)
    fireEvent.click(screen.getByText('投影調整'))
    fireEvent.change(screen.getByLabelText('投影エフェクト'), {
      target: { value: 'none' },
    })
    fireEvent.change(screen.getByLabelText('投影エフェクト 発光'), {
      target: { value: '0.2' },
    })

    fireEvent.click(screen.getByText('画角・外観を開いた時へ戻す'))

    expect(settingsStore.getState().projectionEffects).toEqual(opening)
  })

  it('supports exact presets and fails closed for invalid numeric input', () => {
    settingsStore.setState({ cameraHorizontalFov: 35 })
    render(<ProjectionVisualCalibrationPanel enabled />)
    fireEvent.click(screen.getByText('投影調整'))

    fireEvent.click(screen.getByText('30°'))
    expect(settingsStore.getState().cameraHorizontalFov).toBe(30)

    const numericInput = screen.getByLabelText('投影カメラの水平画角数値')
    fireEvent.change(numericInput, { target: { value: '91' } })
    fireEvent.blur(numericInput)

    expect(settingsStore.getState().cameraHorizontalFov).toBe(30)
    expect(numericInput).toHaveValue(30)
  })

  it('distinguishes the opening snapshot from canonical defaults', () => {
    const savedFraming = { x: 1, y: 2, z: 3, scale: 1 }
    const savedTarget = { x: 0.1, y: 1.1, z: 0 }
    settingsStore.setState({
      cameraHorizontalFov: 45,
      lightingIntensity: 2,
      fixedCharacterPosition: true,
      characterPosition: savedFraming,
      characterRotation: savedTarget,
    })
    render(<ProjectionVisualCalibrationPanel enabled />)
    fireEvent.click(screen.getByText('投影調整'))

    fireEvent.click(screen.getByText('30°'))
    fireEvent.change(screen.getByLabelText('VRM照明の強度スライダー'), {
      target: { value: '1.5' },
    })
    fireEvent.click(screen.getByText('画角・外観を開いた時へ戻す'))
    expect(settingsStore.getState().cameraHorizontalFov).toBe(45)
    expect(settingsStore.getState().lightingIntensity).toBe(2)

    fireEvent.click(screen.getByText('画角・外観を既定値へ戻す'))
    expect(settingsStore.getState().cameraHorizontalFov).toBe(35)
    expect(settingsStore.getState().lightingIntensity).toBe(1)
    expect(settingsStore.getState().projectionEffects).toEqual(
      DEFAULT_PROJECTION_EFFECTS_SETTINGS
    )
    expect(settingsStore.getState().fixedCharacterPosition).toBe(true)
    expect(settingsStore.getState().characterPosition).toEqual(savedFraming)
    expect(settingsStore.getState().characterRotation).toEqual(savedTarget)
  })

  it('updates bounded bubble layout and timing through the same operator settings owner', () => {
    settingsStore.setState({
      speechBubblePresentation: { ...DEFAULT_SPEECH_BUBBLE_PRESENTATION },
    })
    render(<ProjectionVisualCalibrationPanel enabled />)
    fireEvent.click(screen.getByText('投影調整'))

    fireEvent.change(screen.getByLabelText('吹き出し文字サイズ'), {
      target: { value: '30' },
    })
    fireEvent.change(screen.getByLabelText('吹き出し幅モード'), {
      target: { value: 'fixed' },
    })
    fireEvent.change(screen.getByLabelText('吹き出し位置X'), {
      target: { value: '0.2' },
    })
    fireEvent.change(screen.getByLabelText('吹き出し喉の向き'), {
      target: { value: 'left' },
    })
    fireEvent.change(screen.getByLabelText('吹き出し表示時間モード'), {
      target: { value: 'reading-time' },
    })

    expect(settingsStore.getState().speechBubblePresentation).toMatchObject({
      source: 'operator-manual',
      fontSizePx: 30,
      widthMode: 'fixed',
      positionX: 0.2,
      tailSide: 'left',
      timingMode: 'reading-time',
    })
    expect(screen.getByLabelText('吹き出し配置プレビュー')).toHaveAttribute(
      'data-timing-mode',
      'reading-time'
    )
    const preview = screen.getByLabelText('吹き出し文字プレビュー')
    expect(preview).toHaveAttribute('data-tail-side', 'left')
    expect(preview).toHaveAttribute(
      'data-preview-reference-viewport',
      '1366x768'
    )
    expect(preview.getAttribute('style')).toContain(
      '--speech-bubble-font-size: 7.906px'
    )
    expect(screen.getByRole('status')).toHaveTextContent(
      '安全領域で補正中（選択値は変更しません）'
    )
  })

  it('previews representative Japanese text and resets bubble values with the shared panel', () => {
    settingsStore.setState({
      speechBubblePresentation: {
        ...DEFAULT_SPEECH_BUBBLE_PRESENTATION,
        fontSizePx: 32,
      },
    })
    render(<ProjectionVisualCalibrationPanel enabled />)
    fireEvent.click(screen.getByText('投影調整'))
    fireEvent.click(screen.getByText('長文見本'))

    expect(screen.getByLabelText('吹き出し文字プレビュー')).toHaveTextContent(
      '長い文章でも'
    )
    fireEvent.click(screen.getByText('画角・外観を既定値へ戻す'))
    expect(settingsStore.getState().speechBubblePresentation).toEqual(
      DEFAULT_SPEECH_BUBBLE_PRESENTATION
    )
  })
})
