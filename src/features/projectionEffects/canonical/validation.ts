import {
  PROJECTION_EFFECT_SCHEMA_VERSION,
  type ProjectionEffectDefinition,
  type ProjectionEffectParameterDefinition,
  type ProjectionEffectValidationResult,
} from './types'

const SAFE_ID = /^[a-z][a-zA-Z0-9._-]{0,63}$/
const MAX_PARAMETERS = 32
const MAX_MAPPINGS = 64
const MAX_DIAGNOSTICS = 16
const MAX_CAPABILITIES = 16

const ROOT_KEYS = new Set([
  'id',
  'schemaVersion',
  'lifecycle',
  'layerBinding',
  'parameters',
  'calibrationBinding',
  'diagnostics',
  'capabilities',
  'proofStatus',
  'sourceMappings',
])

export function validateProjectionEffectDefinition(
  input: unknown
): ProjectionEffectValidationResult {
  const errors: string[] = []
  if (!isRecord(input)) {
    return { ok: false, errors: ['definition must be an object'] }
  }

  rejectUnknownKeys(input, ROOT_KEYS, 'definition', errors)
  validateId(input.id, 'definition.id', errors)
  if (input.schemaVersion !== PROJECTION_EFFECT_SCHEMA_VERSION) {
    errors.push('definition.schemaVersion must be 1')
  }
  if (input.lifecycle !== 'registered') {
    errors.push('definition.lifecycle must be registered')
  }
  validateLayerBinding(input.layerBinding, errors)
  validateParameters(input.parameters, errors)
  validateCalibrationBinding(input.calibrationBinding, errors)
  validateDiagnostics(input.diagnostics, errors)
  validateCapabilities(input.capabilities, errors)
  if (input.proofStatus !== 'source-static') {
    errors.push('definition.proofStatus must be source-static')
  }
  const parameterIds = new Set(
    Array.isArray(input.parameters)
      ? input.parameters
          .filter(isRecord)
          .map((parameter) => parameter.id)
          .filter((id): id is string => typeof id === 'string')
      : []
  )
  validateSourceMappings(input.sourceMappings, parameterIds, errors)

  if (errors.length > 0) return { ok: false, errors }
  return { ok: true, value: input as unknown as ProjectionEffectDefinition }
}

function validateLayerBinding(input: unknown, errors: string[]): void {
  if (!isRecord(input)) {
    errors.push('definition.layerBinding must be an object')
    return
  }
  rejectUnknownKeys(
    input,
    new Set(['layerId', 'order', 'blendMode']),
    'definition.layerBinding',
    errors
  )
  validateId(input.layerId, 'definition.layerBinding.layerId', errors)
  validateBoundedInteger(
    input.order,
    -32,
    32,
    'definition.layerBinding.order',
    errors
  )
  validateFixedValue(
    input.blendMode,
    ['normal', 'additive', 'screen'],
    'definition.layerBinding.blendMode',
    errors
  )
}

function validateParameters(input: unknown, errors: string[]): void {
  if (!Array.isArray(input) || input.length > MAX_PARAMETERS) {
    errors.push(
      `definition.parameters must contain at most ${MAX_PARAMETERS} items`
    )
    return
  }
  const ids = new Set<string>()
  input.forEach((item, index) => {
    const path = `definition.parameters[${index}]`
    if (!isRecord(item)) {
      errors.push(`${path} must be an object`)
      return
    }
    validateId(item.id, `${path}.id`, errors)
    if (typeof item.id === 'string') {
      if (ids.has(item.id)) errors.push(`${path}.id must be unique`)
      ids.add(item.id)
    }
    if (typeof item.required !== 'boolean') {
      errors.push(`${path}.required must be boolean`)
    }
    if (item.kind === 'number') {
      rejectUnknownKeys(
        item,
        new Set([
          'id',
          'required',
          'kind',
          'defaultValue',
          'minimum',
          'maximum',
        ]),
        path,
        errors
      )
      validateNumberParameter(item, path, errors)
    } else if (item.kind === 'boolean') {
      rejectUnknownKeys(
        item,
        new Set(['id', 'required', 'kind', 'defaultValue']),
        path,
        errors
      )
      if (typeof item.defaultValue !== 'boolean') {
        errors.push(`${path}.defaultValue must be boolean`)
      }
    } else if (item.kind === 'enum') {
      rejectUnknownKeys(
        item,
        new Set(['id', 'required', 'kind', 'defaultValue', 'values']),
        path,
        errors
      )
      validateEnumParameter(item, path, errors)
    } else {
      errors.push(`${path}.kind is unsupported`)
    }
  })
}

function validateNumberParameter(
  item: Record<string, unknown>,
  path: string,
  errors: string[]
): void {
  const { minimum, maximum, defaultValue } = item
  if (![minimum, maximum, defaultValue].every(isFiniteNumber)) {
    errors.push(`${path} numeric bounds/default must be finite numbers`)
    return
  }
  const seedParameter = item.id === 'seed'
  if (
    seedParameter &&
    (![minimum, maximum, defaultValue].every(Number.isInteger) ||
      (minimum as number) < 0 ||
      (maximum as number) > 2_147_483_647)
  ) {
    errors.push(`${path} seed bounds/default must be safe integers`)
  } else if (
    !seedParameter &&
    ((minimum as number) < -1_000_000 || (maximum as number) > 1_000_000)
  ) {
    errors.push(`${path} numeric bounds exceed the canonical limit`)
  }
  if ((minimum as number) > (maximum as number)) {
    errors.push(`${path}.minimum must not exceed maximum`)
  }
  if (
    (defaultValue as number) < (minimum as number) ||
    (defaultValue as number) > (maximum as number)
  ) {
    errors.push(`${path}.defaultValue must be within bounds`)
  }
}

function validateEnumParameter(
  item: Record<string, unknown>,
  path: string,
  errors: string[]
): void {
  if (
    !Array.isArray(item.values) ||
    item.values.length < 1 ||
    item.values.length > 16
  ) {
    errors.push(`${path}.values must contain 1..16 items`)
    return
  }
  const values = item.values
  values.forEach((value, index) =>
    validateId(value, `${path}.values[${index}]`, errors)
  )
  if (new Set(values).size !== values.length) {
    errors.push(`${path}.values must be unique`)
  }
  if (!values.includes(item.defaultValue)) {
    errors.push(`${path}.defaultValue must be one of values`)
  }
}

function validateCalibrationBinding(input: unknown, errors: string[]): void {
  if (!isRecord(input)) {
    errors.push('definition.calibrationBinding must be an object')
    return
  }
  rejectUnknownKeys(
    input,
    new Set(['calibrationId', 'revision', 'required']),
    'definition.calibrationBinding',
    errors
  )
  validateId(
    input.calibrationId,
    'definition.calibrationBinding.calibrationId',
    errors
  )
  validateBoundedInteger(
    input.revision,
    0,
    1_000_000,
    'definition.calibrationBinding.revision',
    errors
  )
  if (typeof input.required !== 'boolean') {
    errors.push('definition.calibrationBinding.required must be boolean')
  }
}

function validateDiagnostics(input: unknown, errors: string[]): void {
  const codes = new Set<string>()
  validateRecordList(
    input,
    MAX_DIAGNOSTICS,
    'diagnostics',
    errors,
    (item, path) => {
      rejectUnknownKeys(item, new Set(['code', 'status']), path, errors)
      validateId(item.code, `${path}.code`, errors)
      validateUniqueId(item.code, codes, `${path}.code`, errors)
      validateFixedValue(
        item.status,
        ['healthy', 'degraded', 'blocked', 'unknown'],
        `${path}.status`,
        errors
      )
    }
  )
}

function validateCapabilities(input: unknown, errors: string[]): void {
  const ids = new Set<string>()
  validateRecordList(
    input,
    MAX_CAPABILITIES,
    'capabilities',
    errors,
    (item, path) => {
      rejectUnknownKeys(item, new Set(['id', 'available']), path, errors)
      validateId(item.id, `${path}.id`, errors)
      validateUniqueId(item.id, ids, `${path}.id`, errors)
      if (typeof item.available !== 'boolean') {
        errors.push(`${path}.available must be boolean`)
      }
    }
  )
}

function validateSourceMappings(
  input: unknown,
  parameterIds: ReadonlySet<string>,
  errors: string[]
): void {
  const sourceIds = new Set<string>()
  validateRecordList(
    input,
    MAX_MAPPINGS,
    'sourceMappings',
    errors,
    (item, path) => {
      rejectUnknownKeys(
        item,
        new Set(['sourceId', 'parameterId', 'status']),
        path,
        errors
      )
      validateId(item.sourceId, `${path}.sourceId`, errors)
      validateUniqueId(item.sourceId, sourceIds, `${path}.sourceId`, errors)
      validateId(item.parameterId, `${path}.parameterId`, errors)
      if (
        typeof item.parameterId === 'string' &&
        !parameterIds.has(item.parameterId)
      ) {
        errors.push(`${path}.parameterId is not declared`)
      }
      validateFixedValue(
        item.status,
        [
          'mapped',
          'missing',
          'ambiguous',
          'unsupported',
          'intentional-difference',
          'unknown',
        ],
        `${path}.status`,
        errors
      )
    }
  )
}

function validateRecordList(
  input: unknown,
  maximum: number,
  name: string,
  errors: string[],
  validate: (item: Record<string, unknown>, path: string) => void
): void {
  if (!Array.isArray(input) || input.length > maximum) {
    errors.push(`definition.${name} must contain at most ${maximum} items`)
    return
  }
  input.forEach((item, index) => {
    const path = `definition.${name}[${index}]`
    if (!isRecord(item)) {
      errors.push(`${path} must be an object`)
      return
    }
    validate(item, path)
  })
}

function validateId(input: unknown, path: string, errors: string[]): void {
  if (typeof input !== 'string' || !SAFE_ID.test(input)) {
    errors.push(`${path} must be a safe bounded id`)
  }
}

function validateUniqueId(
  input: unknown,
  seen: Set<string>,
  path: string,
  errors: string[]
): void {
  if (typeof input !== 'string') return
  if (seen.has(input)) errors.push(`${path} must be unique`)
  seen.add(input)
}

function validateFixedValue(
  input: unknown,
  values: readonly string[],
  path: string,
  errors: string[]
): void {
  if (typeof input !== 'string' || !values.includes(input)) {
    errors.push(`${path} is unsupported`)
  }
}

function validateBoundedInteger(
  input: unknown,
  minimum: number,
  maximum: number,
  path: string,
  errors: string[]
): void {
  if (
    typeof input !== 'number' ||
    !Number.isInteger(input) ||
    input < minimum ||
    input > maximum
  ) {
    errors.push(`${path} must be an integer in ${minimum}..${maximum}`)
  }
}

function rejectUnknownKeys(
  input: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  path: string,
  errors: string[]
): void {
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) errors.push(`${path}.${key} is not allowed`)
  }
}

function isFiniteNumber(input: unknown): input is number {
  return typeof input === 'number' && Number.isFinite(input)
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input)
}

export function validateProjectionEffectParameterValues(
  definitions: readonly ProjectionEffectParameterDefinition[],
  values: Readonly<Record<string, unknown>>
): readonly string[] {
  const errors: string[] = []
  const known = new Map(
    definitions.map((definition) => [definition.id, definition])
  )
  if (Object.keys(values).some((key) => !known.has(key))) {
    errors.push('parameter.undeclared is not allowed')
  }
  for (const definition of definitions) {
    const value = values[definition.id]
    if (value === undefined) {
      if (definition.required)
        errors.push(`parameter.${definition.id} is required`)
      continue
    }
    if (
      definition.kind === 'number' &&
      (!isFiniteNumber(value) ||
        value < definition.minimum ||
        value > definition.maximum ||
        (definition.id === 'seed' && !Number.isInteger(value)))
    ) {
      errors.push(`parameter.${definition.id} is out of range`)
    } else if (definition.kind === 'boolean' && typeof value !== 'boolean') {
      errors.push(`parameter.${definition.id} must be boolean`)
    } else if (
      definition.kind === 'enum' &&
      (typeof value !== 'string' || !definition.values.includes(value))
    ) {
      errors.push(`parameter.${definition.id} is unsupported`)
    }
  }
  return errors
}
