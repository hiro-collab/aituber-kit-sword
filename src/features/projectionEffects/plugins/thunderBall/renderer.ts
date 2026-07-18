import type {
  ProjectionEffectFrameContext,
  ProjectionEffectRenderer,
  ProjectionEffectRendererPlugin,
  ProjectionEffectStopContext,
} from '../../rendererPlugin'
import { thunderBallEffectDefinition } from './definition'
import {
  buildOrderedThunderRibbon,
  createThunderOrbAnchors,
  selectNearestThunderAnchor,
  type ThunderPoint,
  type ThunderRibbonPoint,
} from './orderedRibbon'

interface ThunderSpark {
  birthX: number
  birthY: number
  angle: number
  ageMs: number
  lifeMs: number
  seed: number
}

export interface ThunderBallRibbon {
  sparkSeed: number
  targetAnchorIndex: number
  points: readonly ThunderRibbonPoint[]
}

export interface ThunderBallDrawConfig {
  bloomGain: number
  centerX: number
  centerY: number
  lineWidth: number
  masterIntensity: number
  internalResolutionScale: number
  orbPulse: number
  orbRadius: number
  postProcessing: boolean
  reducedMotion: boolean
}

export interface ThunderBallFrame {
  ribbons: readonly ThunderBallRibbon[]
  config: Readonly<ThunderBallDrawConfig>
}

export interface ThunderBallSurface {
  draw(frame: Readonly<ThunderBallFrame>): void
  clear(): void
  dispose(): void
}

export interface ThunderBallRendererSnapshot {
  disposed: boolean
  frameCount: number
  sparkCount: number
  ribbonCount: number
  ribbonPointCount: number
  oldestSparkAgeMs: number
  maximumSparkLifeMs: number
  birthCenters: readonly ThunderPoint[]
  lastStopMode: ProjectionEffectStopContext['mode'] | null
}

export interface ThunderBallRendererOptions {
  surface?: ThunderBallSurface
  waitFrame?: (durationMs: number) => Promise<void>
  onFrame?: (snapshot: Readonly<ThunderBallRendererSnapshot>) => void
}

const EMPTY_DRAW_CONFIG: ThunderBallDrawConfig = {
  bloomGain: 0,
  centerX: 0,
  centerY: 0,
  lineWidth: 1,
  masterIntensity: 0,
  internalResolutionScale: 1,
  orbPulse: 0,
  orbRadius: 0,
  postProcessing: false,
  reducedMotion: false,
}

const INITIAL_RANDOM_STATE = 0x6d2b79f5

export class ThunderBallRenderer implements ProjectionEffectRenderer {
  private readonly sparks: ThunderSpark[] = []
  private readonly surface?: ThunderBallSurface
  private readonly waitFrame: (durationMs: number) => Promise<void>
  private readonly onFrame?: ThunderBallRendererOptions['onFrame']
  private disposed = false
  private frameCount = 0
  private emissionCarry = 0
  private randomState = INITIAL_RANDOM_STATE
  private lastStopMode: ProjectionEffectStopContext['mode'] | null = null
  private lastFrame: ThunderBallFrame = {
    ribbons: [],
    config: EMPTY_DRAW_CONFIG,
  }

  constructor(options: ThunderBallRendererOptions = {}) {
    this.surface = options.surface
    this.waitFrame = options.waitFrame ?? immediateFrame
    this.onFrame = options.onFrame
  }

  render(context: ProjectionEffectFrameContext): void {
    if (this.disposed || context.signal?.aborted) return
    const deltaMs = clamp(numberOr(context.deltaMs, 0), 0, 100)
    const deltaSeconds = deltaMs / 1000
    const sparkBudget = boundedInteger(
      numberParameter(context, 'sparkBudget'),
      4,
      128
    )
    const lifetimeMs = numberParameter(context, 'lifetimeMs')
    const center = {
      x: numberParameter(context, 'centerX'),
      y: numberParameter(context, 'centerY'),
    }

    for (const spark of this.sparks) spark.ageMs += deltaMs
    this.removeExpiredSparks()

    const requestedEmission =
      numberParameter(context, 'emissionRate') * deltaSeconds +
      this.emissionCarry
    let spawnCount = Math.min(
      Math.floor(requestedEmission),
      Math.max(0, sparkBudget - this.sparks.length)
    )
    this.emissionCarry = requestedEmission - Math.floor(requestedEmission)
    if (this.sparks.length === 0 && sparkBudget > 0) spawnCount = 1
    for (let index = 0; index < spawnCount; index += 1) {
      this.sparks.push(this.spawnSpark(center, lifetimeMs))
    }

    const reducedMotion = booleanParameter(context, 'reducedMotion')
    const ribbons = this.sparks.map((spark) =>
      this.buildSparkRibbon(context, spark, reducedMotion)
    )
    const orbRadius = numberParameter(context, 'orbRadius')
    const config: ThunderBallDrawConfig = {
      bloomGain: reducedMotion
        ? Math.min(0.35, numberParameter(context, 'bloomGain'))
        : numberParameter(context, 'bloomGain'),
      centerX: center.x,
      centerY: center.y,
      lineWidth: reducedMotion
        ? Math.min(3, numberParameter(context, 'lineWidth'))
        : numberParameter(context, 'lineWidth'),
      masterIntensity: reducedMotion
        ? Math.min(0.72, numberParameter(context, 'masterIntensity'))
        : numberParameter(context, 'masterIntensity'),
      internalResolutionScale: numberParameter(
        context,
        'internalResolutionScale'
      ),
      orbPulse: reducedMotion
        ? 0.68
        : 0.68 + Math.sin(context.nowMs * 0.012) * 0.16,
      orbRadius,
      postProcessing:
        booleanParameter(context, 'postProcessing') && !reducedMotion,
      reducedMotion,
    }
    this.lastFrame = { ribbons, config }
    this.surface?.draw(this.lastFrame)
    this.frameCount += 1
    this.onFrame?.(this.snapshot())
  }

  async stop(context: ProjectionEffectStopContext): Promise<void> {
    if (this.disposed) return
    this.lastStopMode = context.mode
    try {
      if (context.mode === 'immediate' || context.fadeMs === 0) return
      const steps = 4
      for (
        let step = 1;
        step <= steps && !this.disposed && !context.signal?.aborted;
        step += 1
      ) {
        const remaining = 1 - step / steps
        this.surface?.draw({
          ribbons: this.lastFrame.ribbons,
          config: {
            ...this.lastFrame.config,
            masterIntensity: this.lastFrame.config.masterIntensity * remaining,
          },
        })
        await this.waitFrame(context.fadeMs / steps)
      }
    } finally {
      this.clearSparks()
    }
  }

  reset(): void {
    if (this.disposed) return
    this.frameCount = 0
    this.emissionCarry = 0
    this.randomState = INITIAL_RANDOM_STATE
    this.lastStopMode = null
    this.clearSparks()
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    let cleanupError: unknown = null
    try {
      this.clearSparks()
    } catch (error) {
      cleanupError = error
    }
    try {
      this.surface?.dispose()
    } catch (error) {
      cleanupError ??= error
    }
    if (cleanupError) throw cleanupError
  }

  snapshot(): ThunderBallRendererSnapshot {
    return {
      disposed: this.disposed,
      frameCount: this.frameCount,
      sparkCount: this.sparks.length,
      ribbonCount: this.lastFrame.ribbons.length,
      ribbonPointCount: this.lastFrame.ribbons.reduce(
        (total, ribbon) => total + ribbon.points.length,
        0
      ),
      oldestSparkAgeMs: this.sparks.reduce(
        (oldest, spark) => Math.max(oldest, spark.ageMs),
        0
      ),
      maximumSparkLifeMs: this.sparks.reduce(
        (maximum, spark) => Math.max(maximum, spark.lifeMs),
        0
      ),
      birthCenters: this.sparks.map((spark) => ({
        x: spark.birthX,
        y: spark.birthY,
      })),
      lastStopMode: this.lastStopMode,
    }
  }

  private spawnSpark(
    center: Readonly<ThunderPoint>,
    lifetimeMs: number
  ): ThunderSpark {
    return {
      birthX: center.x,
      birthY: center.y,
      angle: this.nextRandom() * Math.PI * 2,
      ageMs: 0,
      lifeMs: lifetimeMs * (0.82 + this.nextRandom() * 0.36),
      seed: this.nextRandom(),
    }
  }

  private buildSparkRibbon(
    context: ProjectionEffectFrameContext,
    spark: ThunderSpark,
    reducedMotion: boolean
  ): ThunderBallRibbon {
    const progress = Math.min(1, spark.ageMs / Math.max(1, spark.lifeMs))
    const orbRadius = numberParameter(context, 'orbRadius')
    const orbitSpeed = reducedMotion
      ? 0
      : numberParameter(context, 'orbitSpeed')
    const phase =
      spark.angle +
      context.nowMs * 0.001 * orbitSpeed +
      progress * Math.PI * 1.5
    const sourceRadius =
      orbRadius * (0.12 + progress * 0.72 + Math.sin(progress * Math.PI) * 0.08)
    const source = {
      x: spark.birthX + Math.cos(phase) * sourceRadius,
      y: spark.birthY + Math.sin(phase) * sourceRadius,
    }
    const anchors = createThunderOrbAnchors(
      { x: spark.birthX, y: spark.birthY },
      orbRadius,
      numberParameter(context, 'anchorCount'),
      phase * 0.24
    )
    const nearest = selectNearestThunderAnchor(source, anchors)
    if (!nearest) {
      return { sparkSeed: spark.seed, targetAnchorIndex: -1, points: [] }
    }
    return {
      sparkSeed: spark.seed,
      targetAnchorIndex: nearest.index,
      points: buildOrderedThunderRibbon(source, nearest.point, {
        segmentCount: reducedMotion
          ? Math.min(12, numberParameter(context, 'segmentCount'))
          : numberParameter(context, 'segmentCount'),
        phase,
        wrinkleStrength: numberParameter(context, 'wrinkleStrength'),
        seed: spark.seed,
        reducedMotion,
      }),
    }
  }

  private removeExpiredSparks(): void {
    let writeIndex = 0
    for (const spark of this.sparks) {
      if (spark.ageMs < spark.lifeMs) {
        this.sparks[writeIndex] = spark
        writeIndex += 1
      }
    }
    this.sparks.length = writeIndex
  }

  private clearSparks(): void {
    this.sparks.length = 0
    this.lastFrame = { ribbons: [], config: EMPTY_DRAW_CONFIG }
    this.surface?.clear()
  }

  private nextRandom(): number {
    this.randomState = (1664525 * this.randomState + 1013904223) >>> 0
    return this.randomState / 0x100000000
  }
}

export function createThunderBallPlugin(
  options: ThunderBallRendererOptions = {}
): ProjectionEffectRendererPlugin {
  return {
    definition: thunderBallEffectDefinition,
    createRenderer: () => new ThunderBallRenderer(options),
  }
}

export const thunderBallPlugin = createThunderBallPlugin()

function numberParameter(
  context: ProjectionEffectFrameContext,
  id: string
): number {
  return numberOr(context.parameters[id], 0)
}

function booleanParameter(
  context: ProjectionEffectFrameContext,
  id: string
): boolean {
  return context.parameters[id] === true
}

function boundedInteger(
  value: number,
  minimum: number,
  maximum: number
): number {
  return Math.round(clamp(value, minimum, maximum))
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value))
}

function immediateFrame(): Promise<void> {
  return Promise.resolve()
}
