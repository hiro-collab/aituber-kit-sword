import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'

import { ProjectionVisualCalibrationPanel } from '@/components/projectionVisualCalibrationPanel'
import { DEFAULT_SPEECH_BUBBLE_PRESENTATION } from '@/features/projectionVisualBubble/presentation'
import settingsStore from '@/features/stores/settings'

describe('ProjectionVisualCalibrationPanel', () => {
  const initialCameraHorizontalFov =
    settingsStore.getState().cameraHorizontalFov
  const initialLightingIntensity = settingsStore.getState().lightingIntensity
  const initialSpeechBubblePresentation =
    settingsStore.getState().speechBubblePresentation

  afterEach(() => {
    cleanup()
    settingsStore.setState({
      cameraHorizontalFov: initialCameraHorizontalFov,
      lightingIntensity: initialLightingIntensity,
      speechBubblePresentation: initialSpeechBubblePresentation,
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
    fireEvent.click(screen.getByText('開いた時の値に戻す'))

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
    settingsStore.setState({ cameraHorizontalFov: 45, lightingIntensity: 2 })
    render(<ProjectionVisualCalibrationPanel enabled />)
    fireEvent.click(screen.getByText('投影調整'))

    fireEvent.click(screen.getByText('30°'))
    fireEvent.change(screen.getByLabelText('VRM照明の強度スライダー'), {
      target: { value: '1.5' },
    })
    fireEvent.click(screen.getByText('開いた時の値に戻す'))
    expect(settingsStore.getState().cameraHorizontalFov).toBe(45)
    expect(settingsStore.getState().lightingIntensity).toBe(2)

    fireEvent.click(screen.getByText('既定値へ戻す'))
    expect(settingsStore.getState().cameraHorizontalFov).toBe(35)
    expect(settingsStore.getState().lightingIntensity).toBe(1)
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
    expect(preview.getAttribute('style')).toContain(
      '--speech-bubble-font-size: 16.5px'
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
    fireEvent.click(screen.getByText('既定値へ戻す'))
    expect(settingsStore.getState().speechBubblePresentation).toEqual(
      DEFAULT_SPEECH_BUBBLE_PRESENTATION
    )
  })
})
