import {
  ProjectionEffectHost,
  type ProjectionEffectHostScheduler,
} from '../effectHost'
import { ProjectionEffectRegistry } from '../registry'
import {
  FIRE_EFFECT_ID,
  fireEffectDefinition,
} from '../plugins/fire/definition'
import {
  FireP027Renderer,
  type FireP027RendererOptions,
} from '../plugins/fire/p027/renderer'
import type { FireP027Surface } from '../plugins/fire/p027/contracts'
import {
  THUNDER_BALL_EFFECT_ID,
  thunderBallEffectDefinition,
} from '../plugins/thunderBall/definition'
import {
  ThunderBallWebGl2Adapter,
  type ThunderWebGl2AdapterSurface,
} from '../plugins/thunderBall/webgl2/adapter'

export type FireThunderLabEffectId =
  | typeof FIRE_EFFECT_ID
  | typeof THUNDER_BALL_EFFECT_ID

export const FIRE_THUNDER_LAB_EFFECT_IDS = [
  FIRE_EFFECT_ID,
  THUNDER_BALL_EFFECT_ID,
] as const satisfies readonly FireThunderLabEffectId[]

export interface FireThunderLabHostOptions {
  createFireSurface(): FireP027Surface
  createThunderSurface(): ThunderWebGl2AdapterSurface
  onFireRendererCreated?: (renderer: FireP027Renderer) => void
  onThunderRendererCreated?: (renderer: ThunderBallWebGl2Adapter) => void
  webgl2Available: boolean
  waitFrame?: (durationMs: number) => Promise<void>
  nowMs?: () => number
  scheduler?: ProjectionEffectHostScheduler
}

export function createFireThunderLabHost(
  options: FireThunderLabHostOptions
): ProjectionEffectHost {
  const registry = new ProjectionEffectRegistry()
  registry.register({
    definition: fireEffectDefinition,
    createRenderer: () => {
      const renderer = new FireP027Renderer({
        surface: options.createFireSurface(),
        waitFrame: options.waitFrame,
      } satisfies FireP027RendererOptions)
      options.onFireRendererCreated?.(renderer)
      return renderer
    },
  })
  registry.register({
    definition: thunderBallEffectDefinition,
    createRenderer: () => {
      const renderer = new ThunderBallWebGl2Adapter({
        surface: options.createThunderSurface(),
        waitFrame: options.waitFrame,
      })
      options.onThunderRendererCreated?.(renderer)
      return renderer
    },
  })

  return new ProjectionEffectHost({
    registry,
    capabilities: {
      webgl2Available: options.webgl2Available,
      audioOutputAvailable: false,
      sfxAssetsAvailable: false,
      selfObservationAvailable: false,
    },
    effectLifetimeMs: {
      [FIRE_EFFECT_ID]: 8_000,
      [THUNDER_BALL_EFFECT_ID]: 5_000,
    },
    nowMs: options.nowMs,
    scheduler: options.scheduler,
  })
}
