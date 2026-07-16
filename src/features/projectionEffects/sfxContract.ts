export interface ProjectionEffectSfxCue {
  readonly effectId: string
  readonly cueId: string
  readonly noisy: true
  readonly loop: boolean
  readonly defaultGain: number
}

export interface ProjectionEffectSfxPlayer {
  prepare(cue: ProjectionEffectSfxCue, signal: AbortSignal): Promise<void>
  start(cue: ProjectionEffectSfxCue, signal: AbortSignal): Promise<void>
  fadeOut(cue: ProjectionEffectSfxCue, fadeMs: number): Promise<void>
  /**
   * Cancels and joins every pending prepare/start/playback operation for the
   * cue. Resolution is the terminal ownership handoff; implementations must
   * make repeated calls share the same idempotent cleanup.
   */
  terminate(cue: ProjectionEffectSfxCue): Promise<void>
}

export type ProjectionEffectSfxStatus =
  | 'started'
  | 'stopped'
  | 'unavailable'
  | 'prepare-failed'
  | 'start-failed-cleaned'
  | 'start-failed-cleanup-failed'
  | 'stop-failed'

const SFX_CUE_KEYS = [
  'effectId',
  'cueId',
  'noisy',
  'loop',
  'defaultGain',
] as const

export function validateProjectionEffectSfxCue(
  input: unknown
): readonly string[] {
  const errors: string[] = []
  if (!isPlainEnumerableDataRecord(input)) {
    return ['sfx.shape.invalid']
  }
  const ownKeys = Object.keys(input)
  if (
    ownKeys.length !== SFX_CUE_KEYS.length ||
    !SFX_CUE_KEYS.every((key) =>
      Object.prototype.propertyIsEnumerable.call(input, key)
    ) ||
    ownKeys.some(
      (key) => !SFX_CUE_KEYS.includes(key as (typeof SFX_CUE_KEYS)[number])
    )
  ) {
    errors.push('sfx.fields.invalid')
  }
  const effectId = ownEnumerableValue(input, 'effectId')
  const cueId = ownEnumerableValue(input, 'cueId')
  const noisy = ownEnumerableValue(input, 'noisy')
  const loop = ownEnumerableValue(input, 'loop')
  const defaultGain = ownEnumerableValue(input, 'defaultGain')
  if (!isSafeId(effectId)) errors.push('sfx.effect_id.invalid')
  if (!isSafeId(cueId)) errors.push('sfx.cue_id.invalid')
  if (noisy !== true) errors.push('sfx.noisy.invalid')
  if (typeof loop !== 'boolean') errors.push('sfx.loop.invalid')
  if (
    typeof defaultGain !== 'number' ||
    !Number.isFinite(defaultGain) ||
    defaultGain < 0 ||
    defaultGain > 1
  ) {
    errors.push('sfx.default_gain.invalid')
  }
  return errors
}

export function snapshotProjectionEffectSfxCue(
  cue: ProjectionEffectSfxCue
): ProjectionEffectSfxCue {
  return Object.freeze(
    Object.assign(Object.create(null), {
      effectId: cue.effectId,
      cueId: cue.cueId,
      noisy: true,
      loop: cue.loop,
      defaultGain: cue.defaultGain,
    })
  ) as ProjectionEffectSfxCue
}

function isSafeId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z][a-zA-Z0-9._-]{0,63}$/.test(value)
}

function ownEnumerableValue(
  input: Record<string, unknown>,
  key: string
): unknown {
  return Object.prototype.propertyIsEnumerable.call(input, key)
    ? input[key]
    : undefined
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
