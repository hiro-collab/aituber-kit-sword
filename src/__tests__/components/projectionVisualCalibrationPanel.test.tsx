import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'

import { ProjectionVisualCalibrationPanel } from '@/components/projectionVisualCalibrationPanel'
import settingsStore from '@/features/stores/settings'

describe('ProjectionVisualCalibrationPanel', () => {
  const initialCameraHorizontalFov =
    settingsStore.getState().cameraHorizontalFov
  const initialLightingIntensity = settingsStore.getState().lightingIntensity

  afterEach(() => {
    cleanup()
    settingsStore.setState({
      cameraHorizontalFov: initialCameraHorizontalFov,
      lightingIntensity: initialLightingIntensity,
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
})
