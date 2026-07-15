import {
  PROJECTION_EFFECT_SCHEMA_VERSION,
  type ProjectionEffectDefinition,
} from '../../canonical/types'

export const FLUID_FIRE_RELAY_EFFECT_ID = 'fluidFireRelay'

export const fluidFireRelayDefinition = {
  id: FLUID_FIRE_RELAY_EFFECT_ID,
  schemaVersion: PROJECTION_EFFECT_SCHEMA_VERSION,
  lifecycle: 'registered',
  layerBinding: {
    layerId: 'projection.fluidFireRelay',
    order: 4,
    blendMode: 'additive',
  },
  parameters: [
    {
      id: 'densityGain',
      kind: 'number',
      required: true,
      defaultValue: 0.72,
      minimum: 0,
      maximum: 2,
    },
    {
      id: 'temperatureGain',
      kind: 'number',
      required: true,
      defaultValue: 0.86,
      minimum: 0,
      maximum: 2,
    },
    {
      id: 'velocityDissipation',
      kind: 'number',
      required: true,
      defaultValue: 0.985,
      minimum: 0.8,
      maximum: 1,
    },
    {
      id: 'relayMix',
      kind: 'number',
      required: true,
      defaultValue: 0.64,
      minimum: 0,
      maximum: 1,
    },
    {
      id: 'bloomGain',
      kind: 'number',
      required: false,
      defaultValue: 0.35,
      minimum: 0,
      maximum: 1.5,
    },
  ],
  calibrationBinding: {
    calibrationId: 'projection.defaultPlane',
    revision: 1,
    required: true,
  },
  diagnostics: [{ code: 'sourceStaticOnly', status: 'healthy' }],
  capabilities: [
    { id: 'browserRendererContract', available: true },
    { id: 'browserRuntimeObserved', available: false },
    { id: 'touchDesignerWriteback', available: false },
  ],
  proofStatus: 'source-static',
  sourceMappings: [
    {
      sourceId: 'touchDesigner.densityGain',
      parameterId: 'densityGain',
      status: 'mapped',
    },
    {
      sourceId: 'touchDesigner.temperatureGain',
      parameterId: 'temperatureGain',
      status: 'mapped',
    },
    {
      sourceId: 'touchDesigner.pressureIterations',
      parameterId: 'relayMix',
      status: 'intentional-difference',
    },
    {
      sourceId: 'touchDesigner.externalWriteback',
      parameterId: 'relayMix',
      status: 'unsupported',
    },
  ],
} as const satisfies ProjectionEffectDefinition
