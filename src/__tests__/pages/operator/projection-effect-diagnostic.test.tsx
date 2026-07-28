import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import ProjectionEffectDiagnosticOperator from '@/pages/operator/projection-effect-diagnostic'
import type {
  ProjectionEffectDiagnosticAction,
  ProjectionEffectDiagnosticResult,
} from '@/features/projectionEffects/browser/projectionEffectDiagnosticController'

const mockExecute = jest.fn<
  Promise<ProjectionEffectDiagnosticResult>,
  [ProjectionEffectDiagnosticAction]
>()

jest.mock(
  '@/features/projectionEffects/browser/projectionEffectDiagnosticController',
  () => ({
    createProjectionEffectDiagnosticController: () => ({
      execute: (action: ProjectionEffectDiagnosticAction) =>
        mockExecute(action),
    }),
  })
)

describe('projection effect operator diagnostic page', () => {
  beforeEach(() => {
    mockExecute.mockReset()
  })

  it('is an operator-only diagnostic surface without another host or canvas', () => {
    const { container } = render(<ProjectionEffectDiagnosticOperator />)

    expect(screen.getByText('Operator diagnostic only')).toBeInTheDocument()
    expect(
      screen.getByText(/never grants normal AI or user authority/i)
    ).toBeInTheDocument()
    expect(
      screen.getByText(/No Journal write is performed here/i)
    ).toBeInTheDocument()
    expect(container.querySelector('canvas')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Fire start' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Thunder start' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Stop' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Reset' })).toBeEnabled()
  })

  it('exposes all four fixed actions and retains only the three safe result fields', async () => {
    mockExecute.mockImplementation(async (action) => ({
      event_id:
        action === 'fire_start'
          ? 'evt_11111111111111111111111111111111'
          : 'evt_22222222222222222222222222222222',
      status: 'completed',
      result_class:
        action === 'stop'
          ? 'stopped'
          : action === 'reset'
            ? 'reset'
            : 'started',
    }))
    render(<ProjectionEffectDiagnosticOperator />)

    const cases: ReadonlyArray<
      readonly [string, ProjectionEffectDiagnosticAction]
    > = [
      ['Fire start', 'fire_start'],
      ['Thunder start', 'thunder_start'],
      ['Stop', 'stop'],
      ['Reset', 'reset'],
    ]
    for (const [label, action] of cases) {
      fireEvent.click(screen.getByRole('button', { name: label }))
      await waitFor(() => expect(mockExecute).toHaveBeenLastCalledWith(action))
      await waitFor(() =>
        expect(screen.getByRole('button', { name: label })).toBeEnabled()
      )
    }

    const result = screen.getByTestId(
      'projection-effect-diagnostic-result-fields'
    )
    expect(result).toHaveTextContent('event_id')
    expect(result).toHaveTextContent('status')
    expect(result).toHaveTextContent('result_class')
    expect(
      screen.getByTestId('projection-effect-diagnostic-verdict')
    ).toHaveTextContent('VERIFIED')
  })

  it('keeps one request in flight and marks every non-completed outcome degraded', async () => {
    let resolveDelivery!: (value: ProjectionEffectDiagnosticResult) => void
    mockExecute.mockImplementationOnce(
      () =>
        new Promise<ProjectionEffectDiagnosticResult>((resolve) => {
          resolveDelivery = resolve
        })
    )
    render(<ProjectionEffectDiagnosticOperator />)

    fireEvent.click(screen.getByRole('button', { name: 'Fire start' }))
    expect(mockExecute).toHaveBeenCalledTimes(1)
    expect(
      screen.getByTestId('projection-effect-diagnostic-verdict')
    ).toHaveTextContent('PENDING')
    for (const button of screen.getAllByRole('button')) {
      expect(button).toBeDisabled()
    }
    fireEvent.click(screen.getByRole('button', { name: 'Thunder start' }))
    expect(mockExecute).toHaveBeenCalledTimes(1)

    await act(async () => {
      resolveDelivery({
        event_id: 'evt_11111111111111111111111111111111',
        status: 'rejected',
        result_class: 'host_unavailable',
      })
    })

    expect(
      screen.getByTestId('projection-effect-diagnostic-verdict')
    ).toHaveTextContent('DEGRADED')
    const result = screen.getByTestId(
      'projection-effect-diagnostic-result-fields'
    )
    expect(result).toHaveTextContent('evt_11111111111111111111111111111111')
    expect(result).toHaveTextContent('rejected')
    expect(result).toHaveTextContent('host_unavailable')
  })
})
