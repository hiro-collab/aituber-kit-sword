import type {
  ProjectionEffectFrameContext,
  ProjectionEffectRenderer,
  ProjectionEffectRendererPlugin,
} from '../../rendererPlugin'
import { fluidFireRelayDefinition } from './definition'
import { fluidFireRelayPassGraph } from './mapping'

export interface FluidFireRelayRendererSnapshot {
  disposed: boolean
  frameCount: number
  densityEnergy: number
  temperatureEnergy: number
  pressureEnergy: number
  completedPassCount: number
}

export type FluidFireRelayFrameObserver = (
  snapshot: Readonly<FluidFireRelayRendererSnapshot>,
  context: ProjectionEffectFrameContext
) => void

export class FluidFireRelayRenderer implements ProjectionEffectRenderer {
  private disposed = false
  private frameCount = 0
  private densityEnergy = 0
  private temperatureEnergy = 0
  private pressureEnergy = 0
  private completedPassCount = 0

  constructor(private readonly frameObserver?: FluidFireRelayFrameObserver) {}

  render(context: ProjectionEffectFrameContext): void {
    if (this.disposed) return
    const timeStep = Math.min(Math.max(context.deltaMs, 0), 100) / 1000
    const densityGain = numberParameter(context, 'densityGain')
    const temperatureGain = numberParameter(context, 'temperatureGain')
    const dissipation = numberParameter(context, 'velocityDissipation')
    const relayMix = numberParameter(context, 'relayMix')

    for (const pass of fluidFireRelayPassGraph) {
      if (this.disposed) return
      if (pass.kind === 'density-advection') {
        this.densityEnergy =
          this.densityEnergy * dissipation + densityGain * timeStep
      } else if (pass.kind === 'temperature-advection') {
        this.temperatureEnergy =
          this.temperatureEnergy * dissipation + temperatureGain * timeStep
      } else if (pass.kind === 'pressure-relaxation') {
        this.pressureEnergy =
          (this.densityEnergy + this.temperatureEnergy) * 0.5
      } else if (pass.kind === 'relay-blend') {
        this.pressureEnergy =
          this.pressureEnergy * (1 - relayMix) +
          this.temperatureEnergy * relayMix
      }
      this.completedPassCount += 1
    }
    this.frameCount += 1
    this.frameObserver?.(this.snapshot(), context)
  }

  reset(): void {
    if (this.disposed) return
    this.frameCount = 0
    this.densityEnergy = 0
    this.temperatureEnergy = 0
    this.pressureEnergy = 0
    this.completedPassCount = 0
  }

  dispose(): void {
    this.disposed = true
    this.densityEnergy = 0
    this.temperatureEnergy = 0
    this.pressureEnergy = 0
  }

  snapshot(): FluidFireRelayRendererSnapshot {
    return {
      disposed: this.disposed,
      frameCount: this.frameCount,
      densityEnergy: this.densityEnergy,
      temperatureEnergy: this.temperatureEnergy,
      pressureEnergy: this.pressureEnergy,
      completedPassCount: this.completedPassCount,
    }
  }
}

export const fluidFireRelayPlugin: ProjectionEffectRendererPlugin = {
  definition: fluidFireRelayDefinition,
  createRenderer: () => new FluidFireRelayRenderer(),
}

function numberParameter(
  context: ProjectionEffectFrameContext,
  id: string
): number {
  const value = context.parameters[id]
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}
