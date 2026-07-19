import { createRef } from 'react'
import { render, screen, within } from '@testing-library/react'
import {
  AvatarFireThunderLabOverlay,
  type AvatarFireThunderLabOverlayProps,
} from '../browser/avatarFireThunderLabOverlay'
import type { FireThunderLabController } from '../browser/fireThunderLabCanvasLayer'

jest.mock('@/components/vrmViewer', () => ({
  __esModule: true,
  default: function MockVrmViewer() {
    return <canvas data-testid="mock-vrm-viewer-canvas" />
  },
}))

jest.mock('../browser/fireThunderLabCanvasLayer', () => {
  const React = jest.requireActual('react') as typeof import('react')
  const controller = {
    emergencyStop: jest.fn().mockResolvedValue(null),
    reset: jest.fn().mockResolvedValue(null),
    start: jest.fn().mockResolvedValue(null),
    stop: jest.fn().mockResolvedValue(null),
  }

  return {
    FireThunderLabCanvasLayer: React.forwardRef(
      (
        props: AvatarFireThunderLabOverlayProps,
        ref: import('react').ForwardedRef<FireThunderLabController>
      ) => {
        React.useImperativeHandle(ref, () => controller)
        return (
          <div
            data-reduced-motion={String(props.reducedMotion)}
            data-testid="fire-thunder-lab-layer"
          >
            <canvas
              data-effect-surface-backend="webgl2"
              data-testid="projection-effect-webgl2-canvas"
            />
            <canvas
              data-effect-surface-backend="canvas2d"
              data-testid="projection-effect-canvas2d-canvas"
            />
          </div>
        )
      }
    ),
  }
})

describe('AvatarFireThunderLabOverlay', () => {
  it('layers one avatar below one pooled Fire Thunder effect layer', () => {
    const { container } = render(<AvatarFireThunderLabOverlay />)

    const avatarLayer = screen.getByTestId('avatar-fire-thunder-avatar-layer')
    const effectLayer = screen.getByTestId('avatar-fire-thunder-effect-layer')

    expect(avatarLayer).toHaveClass('z-0')
    expect(effectLayer).toHaveClass('z-10', 'pointer-events-none')
    expect(
      within(avatarLayer).getAllByTestId('mock-vrm-viewer-canvas')
    ).toHaveLength(1)
    expect(
      within(effectLayer).getAllByTestId('fire-thunder-lab-layer')
    ).toHaveLength(1)
    expect(effectLayer.querySelectorAll('canvas')).toHaveLength(2)
    expect(container.querySelectorAll('canvas')).toHaveLength(3)
  })

  it('forwards the existing controller and reduced-motion contract', async () => {
    const controllerRef = createRef<FireThunderLabController>()
    render(
      <AvatarFireThunderLabOverlay ref={controllerRef} reducedMotion={true} />
    )

    expect(screen.getByTestId('fire-thunder-lab-layer')).toHaveAttribute(
      'data-reduced-motion',
      'true'
    )
    await expect(controllerRef.current?.start('fire')).resolves.toBeNull()
    await expect(controllerRef.current?.stop()).resolves.toBeNull()
    await expect(controllerRef.current?.reset()).resolves.toBeNull()
    await expect(controllerRef.current?.emergencyStop()).resolves.toBeNull()
  })

  it('unmounts without creating overlay-owned timers or animation frames', () => {
    const requestFrame = jest.spyOn(window, 'requestAnimationFrame')
    const setTimer = jest.spyOn(window, 'setTimeout')

    const { unmount } = render(<AvatarFireThunderLabOverlay />)
    unmount()

    expect(requestFrame).not.toHaveBeenCalled()
    expect(setTimer).not.toHaveBeenCalled()

    requestFrame.mockRestore()
    setTimer.mockRestore()
  })
})
