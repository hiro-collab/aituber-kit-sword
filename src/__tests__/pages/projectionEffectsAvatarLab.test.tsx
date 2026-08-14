import { forwardRef, useImperativeHandle } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import AvatarFireThunderLabPage from '@/pages/projection-effects-avatar-lab'
import type { FireThunderLabController } from '@/features/projectionEffects/browser/fireThunderLabCanvasLayer'

const mockStart = jest.fn().mockResolvedValue(null)
const mockStop = jest.fn().mockResolvedValue(null)
const mockReset = jest.fn().mockResolvedValue(null)
const mockEmergencyStop = jest.fn().mockResolvedValue(null)

jest.mock(
  '@/features/projectionEffects/browser/avatarFireThunderLabOverlay',
  () => ({
    AvatarFireThunderLabOverlay: forwardRef(
      (
        props: {
          intentRole?: 'manual' | 'authoritative-host' | 'receipt-mirror'
          onStatusChange?: (result: { status: string }) => void
          reducedMotion?: boolean
        },
        ref: import('react').ForwardedRef<FireThunderLabController>
      ) => {
        useImperativeHandle(ref, () => ({
          emergencyStop: mockEmergencyStop,
          reset: mockReset,
          start: mockStart,
          stop: mockStop,
        }))
        return (
          <div
            data-intent-role={props.intentRole}
            data-reduced-motion={String(props.reducedMotion)}
            data-testid="mock-avatar-fire-thunder-overlay"
          >
            <button
              data-testid="mock-status-started"
              onClick={() => props.onStatusChange?.({ status: 'started' })}
              type="button"
            />
            <button
              data-testid="mock-status-stopped"
              onClick={() => props.onStatusChange?.({ status: 'stopped' })}
              type="button"
            />
          </div>
        )
      }
    ),
  })
)

describe('Avatar Fire Thunder lab page', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('keeps controls above the avatar overlay and forwards all commands', () => {
    render(<AvatarFireThunderLabPage />)

    expect(screen.getByTestId('avatar-fire-thunder-lab-stage')).toHaveClass(
      'isolate'
    )
    expect(screen.getByTestId('avatar-fire-thunder-controls')).toHaveClass(
      'z-20',
      'pointer-events-auto'
    )
    expect(
      screen.getByTestId('mock-avatar-fire-thunder-overlay')
    ).toHaveAttribute('data-intent-role', 'manual')

    fireEvent.click(screen.getByTestId('avatar-fire-button'))
    fireEvent.click(screen.getByTestId('avatar-thunder-button'))
    fireEvent.click(screen.getByTestId('avatar-effect-stop'))
    fireEvent.click(screen.getByTestId('avatar-effect-reset'))
    fireEvent.click(screen.getByTestId('avatar-effect-emergency-stop'))

    expect(mockStart).toHaveBeenNthCalledWith(1, 'fire')
    expect(mockStart).toHaveBeenNthCalledWith(2, 'thunderBall')
    expect(mockStop).toHaveBeenCalledTimes(1)
    expect(mockReset).toHaveBeenCalledTimes(1)
    expect(mockEmergencyStop).toHaveBeenCalledTimes(1)
  })

  it('forwards reduced motion and presents fixed status only', () => {
    render(<AvatarFireThunderLabPage />)

    const overlay = screen.getByTestId('mock-avatar-fire-thunder-overlay')
    expect(overlay).toHaveAttribute('data-reduced-motion', 'false')
    fireEvent.click(screen.getByTestId('avatar-reduced-motion'))
    expect(overlay).toHaveAttribute('data-reduced-motion', 'true')

    fireEvent.click(screen.getByTestId('mock-status-started'))
    expect(screen.getByTestId('avatar-fire-thunder-status')).toHaveTextContent(
      'started'
    )
    fireEvent.click(screen.getByTestId('mock-status-stopped'))
    expect(screen.getByTestId('avatar-fire-thunder-status')).toHaveTextContent(
      'idle'
    )
  })
})
