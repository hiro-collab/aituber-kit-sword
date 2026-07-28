import {
  createProjectionEffectDiagnosticController,
  type ProjectionEffectDiagnosticAction,
} from '../browser/projectionEffectDiagnosticController'
import type {
  ProjectionEffectDeliveryResult,
  ProjectionEffectIntent,
} from '../projectionEffectIntent'

const EVENT_IDS = {
  fire_start: 'evt_11111111111111111111111111111111',
  thunder_start: 'evt_22222222222222222222222222222222',
  stop: 'evt_33333333333333333333333333333333',
  reset: 'evt_44444444444444444444444444444444',
} satisfies Record<ProjectionEffectDiagnosticAction, string>

const completedResultClass = (intent: ProjectionEffectIntent) => {
  if (intent.action === 'start') return 'started' as const
  return intent.action === 'stop' ? ('stopped' as const) : ('reset' as const)
}

describe('projection effect diagnostic controller', () => {
  it('uses only the four fixed catalog actions and the operator diagnostic turn', async () => {
    const actions = Object.keys(EVENT_IDS) as ProjectionEffectDiagnosticAction[]
    let eventIndex = 0
    const deliver = jest.fn(
      async (
        intent: ProjectionEffectIntent
      ): Promise<ProjectionEffectDeliveryResult> => ({
        schemaVersion: 1,
        eventId: intent.eventId,
        status: 'completed',
        resultClass: completedResultClass(intent),
      })
    )
    const controller = createProjectionEffectDiagnosticController({
      createEventId: () => EVENT_IDS[actions[eventIndex++]!],
      deliver,
    })

    for (const action of actions) {
      await controller.execute(action)
    }

    expect(deliver.mock.calls.map(([intent]) => intent)).toEqual([
      {
        schemaVersion: 1,
        eventId: EVENT_IDS.fire_start,
        turnId: 'operator_projection_effect_diagnostic_v1',
        action: 'start',
        effectId: 'fire',
      },
      {
        schemaVersion: 1,
        eventId: EVENT_IDS.thunder_start,
        turnId: 'operator_projection_effect_diagnostic_v1',
        action: 'start',
        effectId: 'thunderBall',
      },
      {
        schemaVersion: 1,
        eventId: EVENT_IDS.stop,
        turnId: 'operator_projection_effect_diagnostic_v1',
        action: 'stop',
      },
      {
        schemaVersion: 1,
        eventId: EVENT_IDS.reset,
        turnId: 'operator_projection_effect_diagnostic_v1',
        action: 'reset',
      },
    ])
  })

  it('reports completed only for a correlated receipt with the expected result class', async () => {
    const deliver = jest
      .fn<Promise<ProjectionEffectDeliveryResult>, [ProjectionEffectIntent]>()
      .mockResolvedValueOnce({
        schemaVersion: 1,
        eventId: EVENT_IDS.fire_start,
        status: 'completed',
        resultClass: 'started',
      })
      .mockResolvedValueOnce({
        schemaVersion: 1,
        eventId: EVENT_IDS.thunder_start,
        status: 'completed',
        resultClass: 'started',
      })
      .mockResolvedValueOnce({
        schemaVersion: 1,
        eventId: EVENT_IDS.stop,
        status: 'completed',
        resultClass: 'reset',
      })
    const ids = [EVENT_IDS.fire_start, EVENT_IDS.stop, EVENT_IDS.stop]
    const controller = createProjectionEffectDiagnosticController({
      createEventId: () => ids.shift()!,
      deliver,
    })

    await expect(controller.execute('fire_start')).resolves.toEqual({
      event_id: EVENT_IDS.fire_start,
      status: 'completed',
      result_class: 'started',
    })
    await expect(controller.execute('thunder_start')).resolves.toEqual({
      event_id: EVENT_IDS.stop,
      status: 'rejected',
      result_class: 'delivery_unconfirmed',
    })
    await expect(controller.execute('stop')).resolves.toEqual({
      event_id: EVENT_IDS.stop,
      status: 'rejected',
      result_class: 'delivery_unconfirmed',
    })
  })

  it('allows only one in-flight delivery request', async () => {
    let resolveDelivery!: (value: ProjectionEffectDeliveryResult) => void
    const deliver = jest.fn(
      () =>
        new Promise<ProjectionEffectDeliveryResult>((resolve) => {
          resolveDelivery = resolve
        })
    )
    const controller = createProjectionEffectDiagnosticController({
      createEventId: () => EVENT_IDS.fire_start,
      deliver,
    })

    const first = controller.execute('fire_start')
    await expect(controller.execute('reset')).resolves.toEqual({
      event_id: null,
      status: 'rejected',
      result_class: 'delivery_unconfirmed',
    })
    expect(deliver).toHaveBeenCalledTimes(1)

    resolveDelivery({
      schemaVersion: 1,
      eventId: EVENT_IDS.fire_start,
      status: 'completed',
      resultClass: 'started',
    })
    await expect(first).resolves.toEqual({
      event_id: EVENT_IDS.fire_start,
      status: 'completed',
      result_class: 'started',
    })
  })

  it('projects degraded receipts to the three public diagnostic fields only', async () => {
    const deliver = jest.fn(
      async () =>
        ({
          schemaVersion: 1,
          eventId: EVENT_IDS.reset,
          status: 'rejected',
          resultClass: 'host_rejected',
        }) as ProjectionEffectDeliveryResult
    )
    const controller = createProjectionEffectDiagnosticController({
      createEventId: () => EVENT_IDS.reset,
      deliver,
    })

    const result = await controller.execute('reset')

    expect(result).toEqual({
      event_id: EVENT_IDS.reset,
      status: 'rejected',
      result_class: 'host_rejected',
    })
    expect(Object.keys(result)).toEqual(['event_id', 'status', 'result_class'])
  })
})
