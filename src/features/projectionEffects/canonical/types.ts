export const PROJECTION_EFFECT_SCHEMA_VERSION = 1 as const

export type ProjectionEffectLifecycleState =
  | 'registered'
  | 'ready'
  | 'running'
  | 'suspended'
  | 'disposed'

export type ProjectionEffectMappingStatus =
  | 'mapped'
  | 'missing'
  | 'ambiguous'
  | 'unsupported'
  | 'intentional-difference'
  | 'unknown'

export type ProjectionEffectProofStatus =
  | 'source-static'
  | 'runtime-observed'
  | 'not-proven'

export type ProjectionEffectDiagnosticStatus =
  | 'healthy'
  | 'degraded'
  | 'blocked'
  | 'unknown'

export interface ProjectionEffectLayerBinding {
  layerId: string
  order: number
  blendMode: 'normal' | 'additive' | 'screen'
}

interface ProjectionEffectParameterBase {
  id: string
  required: boolean
}

export interface ProjectionEffectNumberParameter extends ProjectionEffectParameterBase {
  kind: 'number'
  defaultValue: number
  minimum: number
  maximum: number
}

export interface ProjectionEffectBooleanParameter extends ProjectionEffectParameterBase {
  kind: 'boolean'
  defaultValue: boolean
}

export interface ProjectionEffectEnumParameter extends ProjectionEffectParameterBase {
  kind: 'enum'
  defaultValue: string
  values: readonly string[]
}

export type ProjectionEffectParameterDefinition =
  | ProjectionEffectNumberParameter
  | ProjectionEffectBooleanParameter
  | ProjectionEffectEnumParameter

export interface ProjectionEffectCalibrationBinding {
  calibrationId: string
  revision: number
  required: boolean
}

export interface ProjectionEffectDiagnostic {
  code: string
  status: ProjectionEffectDiagnosticStatus
}

export interface ProjectionEffectCapability {
  id: string
  available: boolean
}

export interface ProjectionEffectSourceMapping {
  sourceId: string
  parameterId: string
  status: ProjectionEffectMappingStatus
}

export interface ProjectionEffectDefinition {
  id: string
  schemaVersion: typeof PROJECTION_EFFECT_SCHEMA_VERSION
  lifecycle: ProjectionEffectLifecycleState
  layerBinding: ProjectionEffectLayerBinding
  parameters: readonly ProjectionEffectParameterDefinition[]
  calibrationBinding: ProjectionEffectCalibrationBinding
  diagnostics: readonly ProjectionEffectDiagnostic[]
  capabilities: readonly ProjectionEffectCapability[]
  proofStatus: ProjectionEffectProofStatus
  sourceMappings: readonly ProjectionEffectSourceMapping[]
}

export interface ProjectionEffectValidationFailure {
  ok: false
  errors: readonly string[]
}

export interface ProjectionEffectValidationSuccess {
  ok: true
  value: ProjectionEffectDefinition
}

export type ProjectionEffectValidationResult =
  | ProjectionEffectValidationFailure
  | ProjectionEffectValidationSuccess

export function isFailClosedMappingStatus(
  status: ProjectionEffectMappingStatus
): boolean {
  return status === 'unknown' || status === 'ambiguous'
}
