import { validateProjectionEffectParameterValues } from './canonical/validation'
import { fluidFireRelayDefinition } from './plugins/fluidFireRelay/definition'

export type ProjectionEffectSelection =
  | 'none'
  | typeof fluidFireRelayDefinition.id

export type FluidFireRelayParameters = {
  densityGain: number
  temperatureGain: number
  velocityDissipation: number
  relayMix: number
  bloomGain: number
}

export type ProjectionEffectsSettings = {
  selectedEffect: ProjectionEffectSelection
  fluidFireRelay: FluidFireRelayParameters
}

export const DEFAULT_FLUID_FIRE_RELAY_PARAMETERS = Object.freeze(
  Object.fromEntries(
    fluidFireRelayDefinition.parameters.map((parameter) => [
      parameter.id,
      parameter.defaultValue,
    ])
  ) as FluidFireRelayParameters
)

export const DEFAULT_PROJECTION_EFFECTS_SETTINGS: ProjectionEffectsSettings =
  Object.freeze({
    selectedEffect: 'none',
    fluidFireRelay: DEFAULT_FLUID_FIRE_RELAY_PARAMETERS,
  })

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const hasExactKeys = (
  value: Record<string, unknown>,
  expectedKeys: readonly string[]
) => {
  const actualKeys = Object.keys(value).sort()
  const sortedExpectedKeys = [...expectedKeys].sort()
  return (
    actualKeys.length === sortedExpectedKeys.length &&
    actualKeys.every((key, index) => key === sortedExpectedKeys[index])
  )
}

export const isProjectionEffectSelection = (
  value: unknown
): value is ProjectionEffectSelection =>
  value === 'none' || value === fluidFireRelayDefinition.id

export const isFluidFireRelayParameters = (
  value: unknown
): value is FluidFireRelayParameters => {
  if (!isRecord(value)) return false
  const parameterIds = fluidFireRelayDefinition.parameters.map(
    (parameter) => parameter.id
  )
  return (
    hasExactKeys(value, parameterIds) &&
    validateProjectionEffectParameterValues(
      fluidFireRelayDefinition.parameters,
      value
    ).length === 0
  )
}

export const isProjectionEffectsSettings = (
  value: unknown
): value is ProjectionEffectsSettings =>
  isRecord(value) &&
  hasExactKeys(value, ['selectedEffect', 'fluidFireRelay']) &&
  isProjectionEffectSelection(value.selectedEffect) &&
  isFluidFireRelayParameters(value.fluidFireRelay)

export const resolveProjectionEffectsSettings = (
  value: unknown
): ProjectionEffectsSettings =>
  isProjectionEffectsSettings(value)
    ? value
    : DEFAULT_PROJECTION_EFFECTS_SETTINGS
