import {
  MAX_PROJECTION_PERFORMANCE_PLAN_LEDGER_ENTRIES,
  PROJECTION_PERFORMANCE_PLAN_LEDGER_TTL_MS,
  ProjectionPerformancePlanExecutor,
  ProjectionPerformancePlanLedger,
} from '../browser/projectionPerformancePlanExecutor'
import type { ProjectionPerformancePlan } from '../projectionPerformancePlan'

describe('ProjectionPerformancePlanExecutor', () => {
  it('maps static Fire and Thunder state without quality or seed frame authority', () => {
    const fire = new ProjectionPerformancePlanExecutor()
    const thunder = new ProjectionPerformancePlanExecutor()

    expect(fire.activate(plan({ effectId: 'fire', strength: 0.5 }))).toEqual({
      effectId: 'fire',
      parameters: {
        emitterX: 0.25,
        emitterY: -0.5,
        masterIntensity: 0.675,
        pointSize: 60,
      },
    })
    expect(
      thunder.activate(
        plan({
          effectId: 'thunderBall',
          position: { x: -0.5, y: 0.75 },
          strength: 0.5,
          keyframes: [
            {
              atMs: 0,
              position: { x: -0.5, y: 0.75 },
              strength: 0.5,
            },
          ],
        })
      )
    ).toEqual({
      effectId: 'thunderBall',
      parameters: {
        centerX: -0.5,
        centerY: 0.75,
        masterIntensity: 0.675,
        orbRadius: 0.39,
        lineWidth: 4,
      },
    })

    expect(Object.keys(fire.frame(1_000)!.parameters)).toEqual([
      'emitterX',
      'emitterY',
      'masterIntensity',
      'pointSize',
    ])
    expect(fire.frame(1_000)!.parameters).not.toHaveProperty('seed')
    expect(fire.frame(1_000)!.parameters).not.toHaveProperty('particleBudget')
    expect(fire.frame(1_000)!.parameters).not.toHaveProperty(
      'internalResolutionScale'
    )
  })

  it('interpolates two keyframes from t0 through midpoint and holds the endpoint', () => {
    const executor = new ProjectionPerformancePlanExecutor()
    executor.activate(
      plan({
        durationMs: 4_000,
        keyframes: [
          {
            atMs: 0,
            position: { x: -1, y: -1 },
            strength: 0,
          },
          {
            atMs: 4_000,
            position: { x: 1, y: 1 },
            strength: 1,
          },
        ],
      })
    )
    expect(executor.anchor(10_000)).toBe(true)

    expect(executor.frame(10_000)?.parameters).toEqual(
      expect.objectContaining({ emitterX: -1, emitterY: -1 })
    )
    expect(executor.frame(12_000)?.parameters).toEqual({
      emitterX: 0,
      emitterY: 0,
      masterIntensity: 0.675,
      pointSize: 60,
    })
    expect(executor.frame(14_000)?.parameters).toEqual({
      emitterX: 1,
      emitterY: 1,
      masterIntensity: 1,
      pointSize: 96,
    })
    expect(executor.frame(20_000)?.parameters).toEqual(
      executor.frame(14_000)?.parameters
    )
  })

  it('uses top-level t0 unless an explicit atMs zero keyframe replaces it', () => {
    const topLevel = new ProjectionPerformancePlanExecutor()
    const replaced = new ProjectionPerformancePlanExecutor()
    topLevel.activate(
      plan({
        position: { x: 0.2, y: -0.2 },
        keyframes: [
          {
            atMs: 2_000,
            position: { x: 0.8, y: 0.8 },
            strength: 0.8,
          },
        ],
      })
    )
    replaced.activate(
      plan({
        position: { x: 0.2, y: -0.2 },
        keyframes: [
          {
            atMs: 0,
            position: { x: -0.8, y: 0.6 },
            strength: 0.25,
          },
        ],
      })
    )

    expect(topLevel.frame(500)?.parameters).toEqual(
      expect.objectContaining({ emitterX: 0.2, emitterY: -0.2 })
    )
    expect(replaced.frame(500)?.parameters).toEqual(
      expect.objectContaining({ emitterX: -0.8, emitterY: 0.6 })
    )
  })

  it('supports four full-state keyframes with deterministic current-time snapshots', () => {
    const executor = new ProjectionPerformancePlanExecutor()
    executor.activate(
      plan({
        durationMs: 3_000,
        keyframes: [
          state(0, -1, -1, 0),
          state(1_000, -0.5, 0, 0.25),
          state(2_000, 0.5, 0.5, 0.75),
          state(3_000, 1, 1, 1),
        ],
      })
    )
    expect(executor.anchor(100)).toBe(true)

    executor.frame(100)
    const first = executor.frame(1_600)
    const same = executor.frame(1_600)
    expect(first).toEqual(same)
    expect(first?.parameters).toEqual(
      expect.objectContaining({ emitterX: 0, emitterY: 0.25 })
    )
  })

  it('reserves revision and fingerprint before execution with bounded fail-closed state', () => {
    const ledger = new ProjectionPerformancePlanLedger()
    const original = plan()

    expect(ledger.reserve(original, 1_000).status).toBe('reserved')
    expect(ledger.reserve(original, 1_001).status).toBe('duplicate')
    expect(ledger.reserve(plan({ strength: 0.75 }), 1_002).status).toBe(
      'collision'
    )
    expect(ledger.reserve(plan({ revision: 2 }), 1_003).status).toBe('reserved')
    expect(ledger.reserve(original, 1_004).status).toBe('stale')
    expect(
      ledger.reserve(plan({ sessionId: 'session-other' }), 1_005).status
    ).toBe('session-mismatch')
    expect(
      ledger.reserve(
        plan({ revision: 2 }),
        1_003 + PROJECTION_PERFORMANCE_PLAN_LEDGER_TTL_MS
      ).status
    ).toBe('expired')
    expect(
      ledger.reserve(
        plan({ revision: 2 }),
        1_004 + PROJECTION_PERFORMANCE_PLAN_LEDGER_TTL_MS
      ).status
    ).toBe('expired')
  })

  it('rejects the first unique plan beyond the live cap without eviction', () => {
    const ledger = new ProjectionPerformancePlanLedger()
    for (
      let index = 0;
      index < MAX_PROJECTION_PERFORMANCE_PLAN_LEDGER_ENTRIES;
      index += 1
    ) {
      expect(
        ledger.reserve(
          plan({ planId: `plan-${index}`, revision: index + 1 }),
          1_000
        ).status
      ).toBe('reserved')
    }
    expect(
      ledger.reserve(
        plan({
          planId: `plan-${MAX_PROJECTION_PERFORMANCE_PLAN_LEDGER_ENTRIES}`,
          revision: MAX_PROJECTION_PERFORMANCE_PLAN_LEDGER_ENTRIES + 1,
        }),
        1_000
      ).status
    ).toBe('capacity')
    expect(
      ledger.reserve(plan({ planId: 'plan-0', revision: 1 }), 1_001).status
    ).toBe('duplicate')
  })

  it('rejects invalid plans and creates no RAF, timer, or listener authority', () => {
    const requestFrame = jest.spyOn(window, 'requestAnimationFrame')
    const setTimer = jest.spyOn(window, 'setTimeout')
    const addListener = jest.spyOn(window, 'addEventListener')
    const executor = new ProjectionPerformancePlanExecutor()
    const ledger = new ProjectionPerformancePlanLedger()

    expect(executor.activate({ ...plan(), strength: Number.NaN })).toBeNull()
    expect(
      ledger.reserve({ ...plan(), shader: 'private marker' }, 1_000).status
    ).toBe('invalid')
    expect(requestFrame).not.toHaveBeenCalled()
    expect(setTimer).not.toHaveBeenCalled()
    expect(addListener).not.toHaveBeenCalled()

    requestFrame.mockRestore()
    setTimer.mockRestore()
    addListener.mockRestore()
  })
})

function plan(
  overrides: Partial<ProjectionPerformancePlan> = {}
): ProjectionPerformancePlan {
  return {
    schemaVersion: 1,
    planId: 'plan-avatar-v1',
    sessionId: 'session-avatar-v1',
    revision: 1,
    action: 'start',
    effectId: 'fire',
    position: { x: 0.25, y: -0.5 },
    strength: 0.5,
    durationMs: 4_000,
    seed: 42,
    keyframes: [
      {
        atMs: 0,
        position: { x: 0.25, y: -0.5 },
        strength: 0.5,
      },
    ],
    ...overrides,
  }
}

function state(
  atMs: number,
  x: number,
  y: number,
  strength: number
): ProjectionPerformancePlan['keyframes'][number] {
  return { atMs, position: { x, y }, strength }
}
