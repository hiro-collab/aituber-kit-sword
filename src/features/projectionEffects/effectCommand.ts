export const PROJECTION_EFFECT_COMMAND_SCHEMA_VERSION = 1 as const

export type ProjectionEffectSpeechCompletion = 'finished' | 'timeout'
export type ProjectionEffectStopMode = 'normal' | 'emergency'

interface ProjectionEffectCommandBase {
  schemaVersion: typeof PROJECTION_EFFECT_COMMAND_SCHEMA_VERSION
  commandId: string
  effectId: string
}

export interface ProjectionEffectStartCommand extends ProjectionEffectCommandBase {
  action: 'start'
  durationMs?: number
  parameters: Readonly<Record<string, unknown>>
  speechCompletion: ProjectionEffectSpeechCompletion
}

export interface ProjectionEffectUpdateCommand extends ProjectionEffectCommandBase {
  action: 'update'
  parameters: Readonly<Record<string, unknown>>
}

export interface ProjectionEffectStopCommand extends ProjectionEffectCommandBase {
  action: 'stop'
  mode: ProjectionEffectStopMode
}

export interface ProjectionEffectResetCommand extends ProjectionEffectCommandBase {
  action: 'reset'
}

export type ProjectionEffectCommand =
  | ProjectionEffectStartCommand
  | ProjectionEffectUpdateCommand
  | ProjectionEffectStopCommand
  | ProjectionEffectResetCommand

export type ProjectionEffectCommandValidationResult =
  | { ok: true; value: ProjectionEffectCommand }
  | { ok: false; errors: readonly string[] }

const SAFE_ID = /^[a-z][a-zA-Z0-9._-]{0,63}$/
export const MAX_PROJECTION_EFFECT_PARAMETERS = 32
export const MIN_PROJECTION_EFFECT_DURATION_MS = 500
export const MAX_PROJECTION_EFFECT_DURATION_MS = 12_000
const MAX_VALIDATION_ERRORS = 12

export function validateProjectionEffectCommand(
  input: unknown
): ProjectionEffectCommandValidationResult {
  if (!isPlainEnumerableDataRecord(input)) {
    return {
      ok: false,
      errors: ['command.shape.invalid'],
    }
  }

  const errors: string[] = []
  validateExactKeys(input, errors)
  if (input.schemaVersion !== PROJECTION_EFFECT_COMMAND_SCHEMA_VERSION) {
    addError(errors, 'command.schema_version.unsupported')
  }
  validateId(input.commandId, 'command.command_id.invalid', errors)
  validateId(input.effectId, 'command.effect_id.invalid', errors)

  if (input.action === 'start') {
    if (
      Object.prototype.propertyIsEnumerable.call(input, 'durationMs') &&
      (typeof input.durationMs !== 'number' ||
        !Number.isInteger(input.durationMs) ||
        input.durationMs < MIN_PROJECTION_EFFECT_DURATION_MS ||
        input.durationMs > MAX_PROJECTION_EFFECT_DURATION_MS)
    ) {
      addError(errors, 'command.duration_ms.invalid')
    }
    validateParameters(input.parameters, errors)
    if (
      input.speechCompletion !== 'finished' &&
      input.speechCompletion !== 'timeout'
    ) {
      addError(errors, 'command.speech_completion.unsupported')
    }
  } else if (input.action === 'update') {
    validateParameters(input.parameters, errors)
  } else if (input.action === 'stop') {
    if (input.mode !== 'normal' && input.mode !== 'emergency') {
      addError(errors, 'command.stop_mode.unsupported')
    }
  } else if (input.action !== 'reset') {
    addError(errors, 'command.action.unsupported')
  }

  return errors.length > 0
    ? { ok: false, errors }
    : { ok: true, value: snapshotProjectionEffectCommand(input) }
}

function validateExactKeys(
  input: Record<string, unknown>,
  errors: string[]
): void {
  const common = ['schemaVersion', 'commandId', 'effectId', 'action']
  const allowedActionKeys =
    input.action === 'start'
      ? ['durationMs', 'parameters', 'speechCompletion']
      : input.action === 'update'
        ? ['parameters']
        : input.action === 'stop'
          ? ['mode']
          : []
  const requiredActionKeys =
    input.action === 'start'
      ? ['parameters', 'speechCompletion']
      : allowedActionKeys
  const allowed = new Set([...common, ...allowedActionKeys])
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) {
      addError(errors, 'command.fields.unexpected')
      break
    }
  }
  for (const key of [...common, ...requiredActionKeys]) {
    if (!Object.prototype.propertyIsEnumerable.call(input, key)) {
      addError(errors, 'command.fields.missing')
      break
    }
  }
}

function validateParameters(input: unknown, errors: string[]): void {
  if (!isPlainEnumerableDataRecord(input)) {
    addError(errors, 'command.parameters.shape.invalid')
    return
  }
  const entries = Object.entries(input)
  if (entries.length > MAX_PROJECTION_EFFECT_PARAMETERS) {
    addError(errors, 'command.parameters.too_many')
    return
  }
  for (const [id, value] of entries) {
    validateId(id, 'command.parameter_id.invalid', errors)
    if (
      (typeof value !== 'number' || !Number.isFinite(value)) &&
      typeof value !== 'boolean' &&
      (typeof value !== 'string' || !SAFE_ID.test(value))
    ) {
      addError(errors, 'command.parameter_value.invalid')
    }
  }
}

function validateId(input: unknown, code: string, errors: string[]): void {
  if (typeof input !== 'string' || !SAFE_ID.test(input)) {
    addError(errors, code)
  }
}

function addError(errors: string[], code: string): void {
  if (errors.length < MAX_VALIDATION_ERRORS && !errors.includes(code)) {
    errors.push(code)
  }
}

function snapshotProjectionEffectCommand(
  input: Record<string, unknown>
): ProjectionEffectCommand {
  const common = {
    schemaVersion: PROJECTION_EFFECT_COMMAND_SCHEMA_VERSION,
    commandId: input.commandId as string,
    effectId: input.effectId as string,
  }
  if (input.action === 'start') {
    const command = {
      ...common,
      action: 'start' as const,
      parameters: snapshotParameters(input.parameters),
      speechCompletion:
        input.speechCompletion as ProjectionEffectSpeechCompletion,
      ...(Object.prototype.propertyIsEnumerable.call(input, 'durationMs')
        ? { durationMs: input.durationMs as number }
        : {}),
    }
    return freezeNullRecord(command)
  }
  if (input.action === 'update') {
    return freezeNullRecord({
      ...common,
      action: 'update' as const,
      parameters: snapshotParameters(input.parameters),
    })
  }
  if (input.action === 'stop') {
    return freezeNullRecord({
      ...common,
      action: 'stop' as const,
      mode: input.mode as ProjectionEffectStopMode,
    })
  }
  return freezeNullRecord({ ...common, action: 'reset' as const })
}

function snapshotParameters(input: unknown): Readonly<Record<string, unknown>> {
  const snapshot: Record<string, unknown> = Object.create(null)
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    snapshot[key] = value
  }
  return Object.freeze(snapshot)
}

function freezeNullRecord<T extends Record<string, unknown>>(input: T): T {
  const snapshot: Record<string, unknown> = Object.create(null)
  for (const [key, value] of Object.entries(input)) snapshot[key] = value
  return Object.freeze(snapshot) as T
}

function isPlainEnumerableDataRecord(
  input: unknown
): input is Record<string, unknown> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return false
  }
  try {
    const prototype = Object.getPrototypeOf(input)
    if (prototype !== Object.prototype && prototype !== null) return false
    return Reflect.ownKeys(input).every((key) => {
      if (typeof key !== 'string') return false
      const descriptor = Object.getOwnPropertyDescriptor(input, key)
      return Boolean(descriptor?.enumerable && 'value' in descriptor)
    })
  } catch {
    return false
  }
}
