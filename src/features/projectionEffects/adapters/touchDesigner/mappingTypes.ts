import type { ProjectionEffectMappingStatus } from '../../canonical/types'

export interface TouchDesignerProjectionParameterMapping {
  touchDesignerParameterId: string
  browserParameterId: string
  status: ProjectionEffectMappingStatus
}

export interface TouchDesignerProjectionMapping {
  schemaVersion: 1
  effectId: string
  parameters: readonly TouchDesignerProjectionParameterMapping[]
}

export function summarizeTouchDesignerMapping(
  mapping: TouchDesignerProjectionMapping
): Readonly<Record<ProjectionEffectMappingStatus, number>> {
  const summary: Record<ProjectionEffectMappingStatus, number> = {
    mapped: 0,
    missing: 0,
    ambiguous: 0,
    unsupported: 0,
    'intentional-difference': 0,
    unknown: 0,
  }
  for (const parameter of mapping.parameters) summary[parameter.status] += 1
  return summary
}
