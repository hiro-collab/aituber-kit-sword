import {
  PROJECTION_EFFECT_SCHEMA_VERSION,
  type ProjectionEffectDefinition,
} from '../../canonical/types'

export const THUNDER_BALL_EFFECT_ID = 'thunderBall'

export const thunderBallEffectDefinition = {
  id: THUNDER_BALL_EFFECT_ID,
  schemaVersion: PROJECTION_EFFECT_SCHEMA_VERSION,
  lifecycle: 'registered',
  layerBinding: {
    layerId: 'projection.effect.thunderBall',
    order: 5,
    blendMode: 'additive',
  },
  parameters: [
    numberParameter('centerX', 0, -1, 1),
    numberParameter('centerY', 0, -1, 1),
    numberParameter('orbRadius', 0.42, 0.08, 1),
    numberParameter('anchorCount', 24, 4, 64),
    numberParameter('sparkBudget', 21, 4, 128),
    numberParameter('emissionRate', 8, 1, 30),
    numberParameter('lifetimeMs', 1400, 300, 4000),
    numberParameter('segmentCount', 20, 2, 48),
    numberParameter('orbitSpeed', 0.7, 0, 3),
    numberParameter('wrinkleStrength', 0.08, 0, 0.4),
    numberParameter('lineWidth', 4, 1, 16),
    numberParameter('masterIntensity', 0.82, 0, 1),
    numberParameter('bloomGain', 0.65, 0, 2),
    numberParameter('internalResolutionScale', 0.75, 0.25, 1),
    numberParameter('updateRateHz', 60, 15, 60),
    booleanParameter('postProcessing', true),
    booleanParameter('reducedMotion', false),
  ],
  calibrationBinding: {
    calibrationId: 'projection.defaultPlane',
    revision: 1,
    required: true,
  },
  diagnostics: [
    { code: 'sourceStaticOnly', status: 'healthy' },
    { code: 'browserRuntimePending', status: 'degraded' },
    { code: 'sfxDisabled', status: 'healthy' },
  ],
  capabilities: [
    { id: 'nearestNeighborOrderedRibbon', available: true },
    { id: 'retainedBirthState', available: true },
    { id: 'finiteSparkLife', available: true },
    { id: 'deterministicReset', available: true },
    { id: 'reducedMotionPolicy', available: true },
    { id: 'endpointBolt', available: false },
    { id: 'browserRuntimeObserved', available: false },
    { id: 'selfObservationIntegrated', available: false },
  ],
  proofStatus: 'source-static',
  sourceMappings: [
    mapped('knowledge.003.centerX', 'centerX'),
    mapped('knowledge.003.centerY', 'centerY'),
    mapped('knowledge.003.nearestNeighbor', 'anchorCount'),
    mapped('knowledge.003.birthState', 'lifetimeMs'),
    mapped('knowledge.003.orderedRibbon', 'segmentCount'),
    mapped('knowledge.003.orbitSpeed', 'orbitSpeed'),
    mapped('knowledge.003.wrinkle', 'wrinkleStrength'),
    mapped('host.quality.internalResolutionScale', 'internalResolutionScale'),
    mapped('host.quality.updateRateHz', 'updateRateHz'),
    mapped('host.quality.postProcessing', 'postProcessing'),
  ],
} as const satisfies ProjectionEffectDefinition

function numberParameter(
  id: string,
  defaultValue: number,
  minimum: number,
  maximum: number
) {
  return {
    id,
    kind: 'number',
    required: true,
    defaultValue,
    minimum,
    maximum,
  } as const
}

function booleanParameter(id: string, defaultValue: boolean) {
  return {
    id,
    kind: 'boolean',
    required: true,
    defaultValue,
  } as const
}

function mapped(sourceId: string, parameterId: string) {
  return { sourceId, parameterId, status: 'mapped' } as const
}
