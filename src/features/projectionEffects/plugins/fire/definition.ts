import {
  PROJECTION_EFFECT_SCHEMA_VERSION,
  type ProjectionEffectDefinition,
} from '../../canonical/types'
import type { ProjectionEffectSfxCue } from '../../sfxContract'

export const FIRE_EFFECT_ID = 'fire'

export const fireEffectDefinition = {
  id: FIRE_EFFECT_ID,
  schemaVersion: PROJECTION_EFFECT_SCHEMA_VERSION,
  lifecycle: 'registered',
  layerBinding: {
    layerId: 'projection.effect.fire',
    order: 4,
    blendMode: 'additive',
  },
  parameters: [
    numberParameter('emitterX', 0, -1, 1),
    numberParameter('emitterY', -0.82, -1, 1),
    numberParameter('seed', 0, 0, 2147483647),
    numberParameter('particleBudget', 1800, 64, 12000),
    numberParameter('emissionRate', 220, 1, 1200),
    numberParameter('lifetimeMs', 1250, 200, 4000),
    numberParameter('upwardSpeed', 0.58, 0.05, 2),
    numberParameter('noiseStrength', 0.34, 0, 1.5),
    numberParameter('dissipation', 0.965, 0.8, 1),
    numberParameter('pointSize', 34, 2, 160),
    numberParameter('temperature', 0.78, 0, 1),
    numberParameter('masterIntensity', 0.92, 0, 1),
    numberParameter('bloomGain', 0.64, 0, 2),
    numberParameter('internalResolutionScale', 0.75, 0.25, 1),
    numberParameter('updateRateHz', 60, 15, 60),
    {
      id: 'postProcessing',
      kind: 'boolean',
      required: true,
      defaultValue: true,
    },
  ],
  calibrationBinding: {
    calibrationId: 'projection.defaultPlane',
    revision: 1,
    required: true,
  },
  diagnostics: [
    { code: 'sourceStaticOnly', status: 'healthy' },
    { code: 'webgl2RuntimePending', status: 'degraded' },
    { code: 'sfxAssetPending', status: 'degraded' },
  ],
  capabilities: [
    { id: 'pointEmitter', available: true },
    { id: 'finiteParticleLife', available: true },
    { id: 'webgl2PointSprite', available: true },
    { id: 'additiveEmissionSurface', available: true },
    { id: 'multiPassBloomComposite', available: false },
    { id: 'typedSfxContract', available: true },
    { id: 'browserRuntimeObserved', available: false },
    { id: 'selfObservationIntegrated', available: false },
  ],
  proofStatus: 'source-static',
  sourceMappings: [
    mappedQuality('host.quality.particleBudget', 'particleBudget'),
    mappedQuality(
      'host.quality.internalResolutionScale',
      'internalResolutionScale'
    ),
    mappedQuality('host.quality.updateRateHz', 'updateRateHz'),
    mappedQuality('host.quality.postProcessing', 'postProcessing'),
  ],
} as const satisfies ProjectionEffectDefinition

export const fireEffectSfxCue = {
  effectId: FIRE_EFFECT_ID,
  cueId: 'fire.loop',
  noisy: true,
  loop: true,
  defaultGain: 0.72,
} as const satisfies ProjectionEffectSfxCue

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

function mappedQuality(sourceId: string, parameterId: string) {
  return { sourceId, parameterId, status: 'mapped' } as const
}
