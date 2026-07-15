import type { TouchDesignerProjectionMapping } from '../../adapters/touchDesigner/mappingTypes'
import { FLUID_FIRE_RELAY_EFFECT_ID } from './definition'

export type FluidFireRelayPassKind =
  | 'velocity-advection'
  | 'density-advection'
  | 'temperature-advection'
  | 'pressure-divergence'
  | 'pressure-relaxation'
  | 'relay-blend'
  | 'bloom'
  | 'composite'

export interface FluidFireRelayPassNode {
  id: string
  kind: FluidFireRelayPassKind
  inputs: readonly string[]
}

export const fluidFireRelayPassGraph: readonly FluidFireRelayPassNode[] = [
  { id: 'velocity', kind: 'velocity-advection', inputs: ['velocity.previous'] },
  {
    id: 'divergence',
    kind: 'pressure-divergence',
    inputs: ['velocity'],
  },
  {
    id: 'pressure',
    kind: 'pressure-relaxation',
    inputs: ['divergence', 'pressure.previous'],
  },
  { id: 'density', kind: 'density-advection', inputs: ['velocity'] },
  {
    id: 'temperature',
    kind: 'temperature-advection',
    inputs: ['velocity'],
  },
  {
    id: 'relay',
    kind: 'relay-blend',
    inputs: ['density', 'temperature', 'pressure'],
  },
  { id: 'bloom', kind: 'bloom', inputs: ['relay'] },
  { id: 'output', kind: 'composite', inputs: ['relay', 'bloom'] },
]

export const fluidFireRelayTouchDesignerMapping = {
  schemaVersion: 1,
  effectId: FLUID_FIRE_RELAY_EFFECT_ID,
  parameters: [
    {
      touchDesignerParameterId: 'densityGain',
      browserParameterId: 'densityGain',
      status: 'mapped',
    },
    {
      touchDesignerParameterId: 'temperatureGain',
      browserParameterId: 'temperatureGain',
      status: 'mapped',
    },
    {
      touchDesignerParameterId: 'pressureIterations',
      browserParameterId: 'relayMix',
      status: 'intentional-difference',
    },
    {
      touchDesignerParameterId: 'externalWriteback',
      browserParameterId: 'relayMix',
      status: 'unsupported',
    },
  ],
} as const satisfies TouchDesignerProjectionMapping
