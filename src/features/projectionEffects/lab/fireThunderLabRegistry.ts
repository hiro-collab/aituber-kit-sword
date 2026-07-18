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
  FireParticleRenderer,
  type FireParticleSurface,
} from '../plugins/fire/renderer'
import {
  THUNDER_BALL_EFFECT_ID,
  thunderBallEffectDefinition,
} from '../plugins/thunderBall/definition'
import {
  ThunderBallRenderer,
  type ThunderBallSurface,
} from '../plugins/thunderBall/renderer'

export type FireThunderLabEffectId =
  | typeof FIRE_EFFECT_ID
  | typeof THUNDER_BALL_EFFECT_ID

export const FIRE_THUNDER_LAB_EFFECT_IDS = [
  FIRE_EFFECT_ID,
  THUNDER_BALL_EFFECT_ID,
] as const satisfies readonly FireThunderLabEffectId[]

export interface FireThunderLabHostOptions {
  createFireSurface(): FireParticleSurface
  createThunderSurface(): ThunderBallSurface
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
    createRenderer: () =>
      new FireParticleRenderer({
        surface: options.createFireSurface(),
        waitFrame: options.waitFrame,
      }),
  })
  registry.register({
    definition: thunderBallEffectDefinition,
    createRenderer: () =>
      new ThunderBallRenderer({
        surface: options.createThunderSurface(),
        waitFrame: options.waitFrame,
      }),
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
