export const CONTROL_PROJECTION_PERFORMANCE_PLAN_SCHEMA_SHA256 =
  'FECF5E29991A70A91933AF4FA4148FEACEE238B677E61F3F918B2586E36A2920'

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
const MAX_REVISION = 2_147_483_647
const MIN_DURATION_MS = 500
const MAX_DURATION_MS = 12_000
const MAX_SEED = 2_147_483_647
const MAX_KEYFRAMES = 4

export type ProjectionPerformancePlanPosition = Readonly<{
  x: number
  y: number
}>

export type ProjectionPerformancePlanKeyframe = Readonly<{
  atMs: number
  position: ProjectionPerformancePlanPosition
  strength: number
}>

export type ProjectionPerformancePlan = Readonly<{
  schemaVersion: 1
  planId: string
  sessionId: string
  revision: number
  action: 'start'
  effectId: 'fire' | 'thunderBall'
  position: ProjectionPerformancePlanPosition
  strength: number
  durationMs: number
  seed: number
  keyframes: readonly ProjectionPerformancePlanKeyframe[]
}>

export type ProjectionPerformancePlanReadOptions = Readonly<{
  expectedSchemaSha256?: string
}>

export function readProjectionPerformancePlan(
  value: unknown,
  options: ProjectionPerformancePlanReadOptions = {}
): ProjectionPerformancePlan | null {
  if (
    (options.expectedSchemaSha256 ??
      CONTROL_PROJECTION_PERFORMANCE_PLAN_SCHEMA_SHA256) !==
    CONTROL_PROJECTION_PERFORMANCE_PLAN_SCHEMA_SHA256
  ) {
    return null
  }
  const plan = exactRecord(value, [
    'schemaVersion',
    'planId',
    'sessionId',
    'revision',
    'action',
    'effectId',
    'position',
    'strength',
    'durationMs',
    'seed',
    'keyframes',
  ])
  if (
    !plan ||
    plan.schemaVersion !== 1 ||
    !safeId(plan.planId) ||
    !safeId(plan.sessionId) ||
    !boundedInteger(plan.revision, 1, MAX_REVISION) ||
    plan.action !== 'start' ||
    (plan.effectId !== 'fire' && plan.effectId !== 'thunderBall') ||
    !boundedNumber(plan.strength, 0, 1) ||
    !boundedInteger(plan.durationMs, MIN_DURATION_MS, MAX_DURATION_MS) ||
    !boundedInteger(plan.seed, 0, MAX_SEED) ||
    !Array.isArray(plan.keyframes) ||
    plan.keyframes.length < 1 ||
    plan.keyframes.length > MAX_KEYFRAMES
  ) {
    return null
  }
  const position = readPosition(plan.position)
  if (!position) return null

  const keyframes: ProjectionPerformancePlanKeyframe[] = []
  let previousAtMs = -1
  for (const candidate of plan.keyframes) {
    const keyframe = exactRecord(candidate, ['atMs', 'position', 'strength'])
    if (
      !keyframe ||
      !boundedInteger(keyframe.atMs, 0, plan.durationMs) ||
      keyframe.atMs <= previousAtMs ||
      !boundedNumber(keyframe.strength, 0, 1)
    ) {
      return null
    }
    const keyframePosition = readPosition(keyframe.position)
    if (!keyframePosition) return null
    keyframes.push(
      Object.freeze({
        atMs: keyframe.atMs,
        position: keyframePosition,
        strength: keyframe.strength,
      })
    )
    previousAtMs = keyframe.atMs
  }

  return Object.freeze({
    schemaVersion: 1,
    planId: plan.planId,
    sessionId: plan.sessionId,
    revision: plan.revision,
    action: 'start',
    effectId: plan.effectId,
    position,
    strength: plan.strength,
    durationMs: plan.durationMs,
    seed: plan.seed,
    keyframes: Object.freeze(keyframes),
  })
}

function readPosition(
  value: unknown
): ProjectionPerformancePlanPosition | null {
  const position = exactRecord(value, ['x', 'y'])
  if (
    !position ||
    !boundedNumber(position.x, -1, 1) ||
    !boundedNumber(position.y, -1, 1)
  ) {
    return null
  }
  return Object.freeze({ x: position.x, y: position.y })
}

function safeId(value: unknown): value is string {
  return typeof value === 'string' && SAFE_ID.test(value)
}

function boundedInteger(
  value: unknown,
  minimum: number,
  maximum: number
): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= minimum &&
    value <= maximum
  )
}

function boundedNumber(
  value: unknown,
  minimum: number,
  maximum: number
): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= minimum &&
    value <= maximum
  )
}

function exactRecord(
  value: unknown,
  expectedKeys: readonly string[]
): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null
  }
  try {
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) return null
    const ownKeys = Reflect.ownKeys(value)
    if (
      ownKeys.length !== expectedKeys.length ||
      ownKeys.some((key) => typeof key !== 'string')
    ) {
      return null
    }
    const actual = [...(ownKeys as string[])].sort()
    const expected = [...expectedKeys].sort()
    if (!actual.every((key, index) => key === expected[index])) return null

    const descriptors = Object.getOwnPropertyDescriptors(value)
    const record: Record<string, unknown> = {}
    for (const key of expectedKeys) {
      const descriptor = descriptors[key]
      if (
        !descriptor ||
        !descriptor.enumerable ||
        !Object.prototype.hasOwnProperty.call(descriptor, 'value')
      ) {
        return null
      }
      record[key] = descriptor.value
    }
    return record
  } catch {
    return null
  }
}
