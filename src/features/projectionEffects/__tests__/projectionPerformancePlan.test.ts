import {
  CONTROL_PROJECTION_PERFORMANCE_PLAN_SCHEMA_SHA256,
  readProjectionPerformancePlan,
} from '../projectionPerformancePlan'

const validPlan = (overrides: Record<string, unknown> = {}) => ({
  schemaVersion: 1,
  planId: 'planv1_0123456789abcdef0123456789abcdef',
  sessionId: 'session_projection_plan_v1',
  revision: 1,
  action: 'start',
  effectId: 'fire',
  position: { x: 0.65, y: 0.55 },
  strength: 0.3,
  durationMs: 3_000,
  seed: 42,
  keyframes: [
    {
      atMs: 0,
      position: { x: 0.65, y: 0.55 },
      strength: 0.3,
    },
  ],
  ...overrides,
})

describe('Projection PerformancePlan V1 defensive mirror', () => {
  it('pins the reviewed Control schema and accepts exact golden plans', () => {
    expect(CONTROL_PROJECTION_PERFORMANCE_PLAN_SCHEMA_SHA256).toBe(
      'FECF5E29991A70A91933AF4FA4148FEACEE238B677E61F3F918B2586E36A2920'
    )
    const fire = readProjectionPerformancePlan(validPlan())
    const thunder = readProjectionPerformancePlan(
      validPlan({
        planId: 'planv1_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        effectId: 'thunderBall',
        position: { x: -1, y: 1 },
        strength: 1,
        durationMs: 12_000,
        seed: 2_147_483_647,
        keyframes: [
          { atMs: 0, position: { x: -1, y: -1 }, strength: 0 },
          { atMs: 4_000, position: { x: -0.25, y: 0.5 }, strength: 0.25 },
          { atMs: 8_000, position: { x: 0.5, y: -0.25 }, strength: 0.75 },
          { atMs: 12_000, position: { x: 1, y: 1 }, strength: 1 },
        ],
      })
    )
    const movement = readProjectionPerformancePlan(
      validPlan({
        planId: 'planv1_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        position: { x: -0.65, y: -0.55 },
        durationMs: 4_000,
        keyframes: [
          { atMs: 0, position: { x: -0.65, y: -0.55 }, strength: 0.5 },
          { atMs: 4_000, position: { x: 0.65, y: 0.55 }, strength: 0.5 },
        ],
        strength: 0.5,
      })
    )

    expect(fire).toEqual(validPlan())
    expect(thunder?.keyframes).toHaveLength(4)
    expect(movement?.keyframes).toHaveLength(2)
    expect(JSON.stringify(readProjectionPerformancePlan(validPlan()))).toBe(
      JSON.stringify(readProjectionPerformancePlan(validPlan()))
    )
  })

  it.each(
    (
      [
        ['schema digest mismatch', validPlan(), '0'.repeat(64)],
        [
          'missing field',
          (() => {
            const candidate = validPlan()
            delete (candidate as Partial<typeof candidate>).seed
            return candidate
          })(),
        ],
        ['top-level extra', { ...validPlan(), rawText: 'PRIVATE_PLAN_MARKER' }],
        ['wrong effect', validPlan({ effectId: 'thunder' })],
        ['bool revision', validPlan({ revision: true })],
        ['bool strength', validPlan({ strength: false })],
        ['nonfinite strength', validPlan({ strength: Number.NaN })],
        ['duration below', validPlan({ durationMs: 499 })],
        ['duration above', validPlan({ durationMs: 12_001 })],
        ['duration float', validPlan({ durationMs: 3_000.5 })],
        ['seed below', validPlan({ seed: -1 })],
        ['seed above', validPlan({ seed: 2_147_483_648 })],
        ['position below', validPlan({ position: { x: -1.01, y: 0 } })],
        ['position above', validPlan({ position: { x: 0, y: 1.01 } })],
        ['no keyframes', validPlan({ keyframes: [] })],
        [
          'too many keyframes',
          validPlan({
            keyframes: Array.from({ length: 5 }, (_, index) => ({
              atMs: index,
              position: { x: 0, y: 0 },
              strength: 0.5,
            })),
          }),
        ],
        [
          'duplicate keyframes',
          validPlan({
            keyframes: [
              { atMs: 0, position: { x: 0, y: 0 }, strength: 0.5 },
              { atMs: 0, position: { x: 0.1, y: 0.1 }, strength: 0.6 },
            ],
          }),
        ],
        [
          'out-of-order keyframes',
          validPlan({
            keyframes: [
              { atMs: 100, position: { x: 0, y: 0 }, strength: 0.5 },
              { atMs: 50, position: { x: 0.1, y: 0.1 }, strength: 0.6 },
            ],
          }),
        ],
        [
          'outside-duration keyframe',
          validPlan({
            keyframes: [
              { atMs: 3_001, position: { x: 0, y: 0 }, strength: 0.5 },
            ],
          }),
        ],
        [
          'incomplete keyframe',
          validPlan({
            keyframes: [{ atMs: 0, position: { x: 0, y: 0 } }],
          }),
        ],
        ['update', validPlan({ action: 'update' })],
        ['replace', { ...validPlan(), replace: true }],
        ['emergency', { ...validPlan(), emergency: true }],
        ['code', { ...validPlan(), code: 'PRIVATE_PLAN_MARKER' }],
        ['url', { ...validPlan(), url: 'https://private.invalid' }],
        ['history', { ...validPlan(), history: 'PRIVATE_PLAN_MARKER' }],
      ] as Array<[string, unknown, string?]>
    ).map(([label, candidate, digest]) => ({
      label,
      candidate,
      digest,
    }))
  )(
    'rejects $label without widening Control authority',
    ({ candidate, digest }) => {
      expect(
        readProjectionPerformancePlan(candidate, {
          expectedSchemaSha256:
            digest ?? CONTROL_PROJECTION_PERFORMANCE_PLAN_SCHEMA_SHA256,
        })
      ).toBeNull()
    }
  )

  it('rejects accessors and non-plain objects without reading private values', () => {
    const getter = jest.fn(() => {
      throw new Error('PRIVATE_GETTER_MARKER')
    })
    const candidate = validPlan()
    Object.defineProperty(candidate, 'strength', {
      enumerable: true,
      get: getter,
    })

    expect(readProjectionPerformancePlan(candidate)).toBeNull()
    expect(getter).not.toHaveBeenCalled()
    expect(readProjectionPerformancePlan(new (class {})())).toBeNull()
  })
})
