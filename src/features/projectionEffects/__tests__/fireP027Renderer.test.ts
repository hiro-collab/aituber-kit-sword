import type { ProjectionEffectFrameContext } from '../rendererPlugin'
import { ProjectionPerformancePlanExecutor } from '../browser/projectionPerformancePlanExecutor'
import {
  FIRE_P027_FIXED_DT_SECONDS,
  FIRE_P027_SLOT_COUNT,
  type FireP027Surface,
} from '../plugins/fire/p027/contracts'
import {
  FireP027Renderer,
  mapFireParametersToP027Controls,
} from '../plugins/fire/p027/renderer'
import { generateFireP027FallbackOrigins } from '../plugins/fire/p027/webglEngine'
import type { ProjectionPerformancePlan } from '../projectionPerformancePlan'

const { FIRE_THUNDER_LAB_VISUAL_PARAMETERS } = jest.requireActual(
  '../browser/fireThunderLabCanvasLayer'
) as {
  FIRE_THUNDER_LAB_VISUAL_PARAMETERS: Readonly<{
    fire: Readonly<Record<string, unknown>>
  }>
}

describe('P027 Fire renderer lifecycle', () => {
  it('maps the existing Fire vocabulary into bounded P027 controls', () => {
    const controls = mapFireParametersToP027Controls({
      emitterX: 0.5,
      emitterY: -0.5,
      particleBudget: 1800,
      emissionRate: 1200,
      lifetimeMs: 2000,
      upwardSpeed: 0.58,
      noiseStrength: 0.34,
      pointSize: 72,
      temperature: 0.8,
      masterIntensity: 1,
      bloomGain: 1,
      internalResolutionScale: 0.8,
      postProcessing: true,
    })
    expect(controls.originCenterX).toBe(0.25)
    expect(controls.originCenterY).toBeCloseTo(-0.14)
    expect(controls.lifeSeconds).toBe(2)
    expect(controls.birthPerSecond).toBe(66)
    expect(controls.spriteWidthCssPx).toBe(72)
    expect(controls.spriteHeightCssPx).toBeCloseTo(80.64)
    expect(controls.forceY).toBeCloseTo(0.16)
    expect(controls.windY).toBeCloseTo(0.12)
    expect(controls.turbulenceX).toBeCloseTo(0.036)
    expect(controls.resolutionScale).toBe(0.8)
    expect(controls.tintR).toBeGreaterThan(controls.tintA)
    expect(controls.tintG).toBeGreaterThan(controls.tintA)
    expect(controls.tintA).toBeLessThanOrEqual(1)
  })

  it('separates visible emission from bounded coverage without changing the public vocabulary', () => {
    const bright = mapFireParametersToP027Controls({
      emissionRate: 80,
      temperature: 1,
      masterIntensity: 1,
      bloomGain: 2,
      postProcessing: true,
    })
    const weak = mapFireParametersToP027Controls({
      emissionRate: 80,
      temperature: 1,
      masterIntensity: 0.4,
      bloomGain: 2,
      postProcessing: true,
    })
    const off = mapFireParametersToP027Controls({
      masterIntensity: 0,
      bloomGain: 2,
      postProcessing: true,
    })

    expect(bright.tintR).toBeGreaterThan(bright.tintG)
    expect(bright.tintG).toBeGreaterThan(bright.tintB)
    expect(bright.tintR).toBeGreaterThan(bright.tintA)
    expect(bright.tintA).toBeGreaterThanOrEqual(0.94)
    expect(bright.tintA).toBeLessThanOrEqual(1)
    expect(weak.birthPerSecond).toBeLessThan(bright.birthPerSecond)
    expect(weak.tintR).toBeLessThan(bright.tintR)
    expect(weak.tintA).toBeGreaterThanOrEqual(0.75)
    expect(weak.tintA).toBeLessThan(bright.tintA)
    expect(off).toEqual(
      expect.objectContaining({
        birthPerSecond: 0,
        tintR: 0,
        tintG: 0,
        tintB: 0,
        tintA: 0,
      })
    )
  })

  it('keeps weak upper-right particles resident after scaling world motion exactly once', () => {
    const weak = controlsForPlanStrength(0.4, { x: 0.5, y: 0.5 })
    const viewportWidth = 1280
    const viewportHeight = 720
    const aspect = viewportWidth / viewportHeight
    const initialCenterY = 0.5 * 0.28
    const fullyExitedCenterY =
      0.5 / aspect + weak.spriteHeightCssPx / viewportHeight / (2 * aspect)

    const legacyNoNoiseExitSeconds = integrateVerticalExitSeconds({
      initialCenterY,
      fullyExitedCenterY,
      forceY: 5.37931,
      windY: 4.03448,
      turbulenceY: 0,
    })
    const correctedNoNoiseExitSeconds = integrateVerticalExitSeconds({
      initialCenterY,
      fullyExitedCenterY,
      forceY: weak.forceY,
      windY: weak.windY,
      turbulenceY: 0,
    })
    const correctedMaximumUpwardNoiseExitSeconds = integrateVerticalExitSeconds(
      {
        initialCenterY,
        fullyExitedCenterY,
        forceY: weak.forceY,
        windY: weak.windY,
        turbulenceY: weak.turbulenceY,
      }
    )
    const potentiallyVisibleBirthsAtHalfSecond = Math.floor(
      weak.birthPerSecond *
        Math.min(0.5, weak.lifeSeconds, correctedMaximumUpwardNoiseExitSeconds)
    )
    const legacyMaximumLateralDisplacement = integrateHorizontalDisplacementCss(
      {
        turbulenceX: 0.367058823529412,
        seconds: 0.9,
        viewportWidth: 1280,
      }
    )
    const correctedMaximumLateralDisplacement =
      integrateHorizontalDisplacementCss({
        turbulenceX: weak.turbulenceX,
        seconds: 0.9,
        viewportWidth: 1280,
      })

    expect(legacyNoNoiseExitSeconds).toBeGreaterThanOrEqual(1 / 6)
    expect(legacyNoNoiseExitSeconds).toBeLessThanOrEqual(11 / 60)
    expect(correctedNoNoiseExitSeconds).toBeGreaterThanOrEqual(0.9)
    expect(correctedMaximumUpwardNoiseExitSeconds).toBeGreaterThanOrEqual(0.6)
    expect(potentiallyVisibleBirthsAtHalfSecond).toBeGreaterThanOrEqual(30)
    expect(legacyMaximumLateralDisplacement).toBeGreaterThan(140)
    expect(correctedMaximumLateralDisplacement).toBeGreaterThan(0)
    expect(correctedMaximumLateralDisplacement).toBeLessThanOrEqual(25)
    expect(weak.forceX).toBe(0)
    expect(weak.windX).toBe(0)
    expect(weak).toEqual(
      expect.objectContaining({
        birthPerSecond: expect.closeTo(60.37333333333333, 10),
        lifeSeconds: 1.8,
        spriteWidthCssPx: 49.344,
        spriteHeightCssPx: expect.closeTo(55.26528, 10),
        forceX: 0,
        forceY: expect.closeTo(0.215172413793103, 10),
        windX: 0,
        windY: expect.closeTo(0.161379310344828, 10),
        turbulenceY: expect.closeTo(0.055058823529412, 10),
        tintR: expect.closeTo(0.9655687291392, 10),
        tintG: expect.closeTo(0.851945906496, 10),
        tintB: expect.closeTo(0.2229205893888, 10),
        tintA: expect.closeTo(0.80664, 10),
      })
    )
  })

  it('keeps real weak, medium, and strong plans below capacity with distinct density, footprint, and energy', () => {
    const weak = controlsForPlanStrength(0.4)
    const medium = controlsForPlanStrength(0.6)
    const strong = controlsForPlanStrength(0.9)
    const off = mapFireParametersToP027Controls({
      ...FIRE_THUNDER_LAB_VISUAL_PARAMETERS.fire,
      masterIntensity: 0,
    })
    const occupancy = (controls: typeof weak) =>
      controls.birthPerSecond * controls.lifeSeconds
    const spriteArea = (controls: typeof weak) =>
      controls.spriteWidthCssPx * controls.spriteHeightCssPx
    const energy = (controls: typeof weak) =>
      controls.tintR + controls.tintG + controls.tintB

    expect(occupancy(weak)).toBeGreaterThanOrEqual(108)
    expect(occupancy(weak)).toBeLessThanOrEqual(110)
    expect(occupancy(medium)).toBeGreaterThanOrEqual(119)
    expect(occupancy(medium)).toBeLessThanOrEqual(120)
    expect(occupancy(strong)).toBeGreaterThanOrEqual(130)
    expect(occupancy(strong)).toBeLessThan(FIRE_P027_SLOT_COUNT)
    expect(occupancy(weak)).toBeLessThan(occupancy(medium))
    expect(occupancy(medium)).toBeLessThan(occupancy(strong))
    expect(weak.spriteWidthCssPx).toBeCloseTo(49.344)
    expect(medium.spriteWidthCssPx).toBeCloseTo(70.656)
    expect(strong.spriteWidthCssPx).toBeCloseTo(93.984)
    expect(weak.spriteHeightCssPx).toBeCloseTo(55.26528)
    expect(medium.spriteHeightCssPx).toBeCloseTo(79.13472)
    expect(strong.spriteHeightCssPx).toBeCloseTo(105.26208)
    expect(weak.spriteWidthCssPx).toBeLessThan(medium.spriteWidthCssPx)
    expect(medium.spriteWidthCssPx).toBeLessThan(strong.spriteWidthCssPx)
    expect(spriteArea(weak)).toBeLessThan(spriteArea(medium))
    expect(spriteArea(medium)).toBeLessThan(spriteArea(strong))
    expect(weak.spriteWidthCssPx).toBeLessThan(60)
    expect(energy(weak)).toBeLessThan(energy(medium))
    expect(energy(medium)).toBeLessThan(energy(strong))
    expect(off).toEqual(
      expect.objectContaining({
        birthPerSecond: 0,
        tintR: 0,
        tintG: 0,
        tintB: 0,
        tintA: 0,
      })
    )
  })

  it('reuses compact mirrored origins into one connected weak body while retaining bounded wrinkle', () => {
    const viewportWidths = [640, 1280, 1920]
    const seeds = [0, 1, 42, 9_999]

    for (const seed of seeds) {
      const weak = controlsForPlanStrength(0.4, { x: 0, y: 0 }, seed)
      const repeated = controlsForPlanStrength(0.4, { x: 0, y: 0 }, seed)
      const origins = generateFireP027FallbackOrigins(weak)
      const repeatedOrigins = generateFireP027FallbackOrigins(repeated)
      const birthsAt900Ms = Math.floor(weak.birthPerSecond * 0.9)
      const steadyOccupancy = weak.birthPerSecond * weak.lifeSeconds
      const maxLateralDisplacementCss = integrateHorizontalDisplacementCss({
        turbulenceX: weak.turbulenceX,
        seconds: 0.9,
        viewportWidth: 1280,
      })

      expect(origins).toHaveLength(42)
      expect(repeatedOrigins).toEqual(origins)
      expect(birthsAt900Ms).toBeGreaterThanOrEqual(54)
      expect(birthsAt900Ms).toBeGreaterThan(origins.length)
      expect(steadyOccupancy / origins.length).toBeGreaterThanOrEqual(2.5)
      expect(maxLateralDisplacementCss).toBeGreaterThan(0)
      expect(maxLateralDisplacementCss).toBeLessThanOrEqual(25)

      for (let pair = 0; pair < origins.length; pair += 2) {
        const positive = origins[pair]
        const negative = origins[pair + 1]
        expect(positive.x + negative.x).toBeCloseTo(weak.originCenterX * 2, 12)
        expect(positive.y).toBeCloseTo(negative.y, 12)
        expect(positive.z).toBeCloseTo(negative.z, 12)
      }

      for (const viewportWidth of viewportWidths) {
        const localX = origins.map(
          (origin) => (origin.x - weak.originCenterX) * viewportWidth
        )
        const localY = origins.map(
          (origin) => (origin.y - weak.originCenterY) * viewportWidth
        )
        expect(Math.max(...localX) - Math.min(...localX)).toBeLessThanOrEqual(
          weak.spriteWidthCssPx * 2.6
        )
        expect(Math.max(...localY) - Math.min(...localY)).toBeLessThanOrEqual(
          weak.spriteHeightCssPx * 1.5
        )
      }

      const zeroDisplacement = createBirthSpriteRects({
        birthCount: birthsAt900Ms,
        origins,
        spriteWidth: weak.spriteWidthCssPx,
        spriteHeight: weak.spriteHeightCssPx,
        viewportWidth: 1280,
        maxLateralDisplacementCss: 0,
      })
      const boundedWrinkle = createBirthSpriteRects({
        birthCount: birthsAt900Ms,
        origins,
        spriteWidth: weak.spriteWidthCssPx,
        spriteHeight: weak.spriteHeightCssPx,
        viewportWidth: 1280,
        maxLateralDisplacementCss,
      })
      const meanWrinkleX =
        boundedWrinkle.reduce((sum, rect, index) => {
          const origin = zeroDisplacement[index]
          return sum + (rect.centerX - origin.centerX)
        }, 0) / boundedWrinkle.length

      expect(countConnectedComponents(zeroDisplacement)).toBe(1)
      expect(countConnectedComponents(boundedWrinkle)).toBe(1)
      expect(Math.abs(meanWrinkleX)).toBeLessThan(0.1)
    }
  })

  it('maps the declared seed deterministically while preserving the manual default', () => {
    const defaultControls = mapFireParametersToP027Controls({})
    const first = mapFireParametersToP027Controls({ seed: 41 })
    const repeated = mapFireParametersToP027Controls({ seed: 41 })
    const changed = mapFireParametersToP027Controls({ seed: 42 })

    expect(defaultControls).toEqual(
      expect.objectContaining({ originSeed: 0, particleSeed: 1 })
    )
    expect(first.originSeed).toBe(repeated.originSeed)
    expect(first.particleSeed).toBe(repeated.particleSeed)
    expect(changed.originSeed).not.toBe(first.originSeed)
    expect(changed.particleSeed).not.toBe(first.particleSeed)
    expect(first.originSeed).toBeGreaterThanOrEqual(0)
    expect(first.originSeed).toBeLessThanOrEqual(10000)
    expect(first.particleSeed).toBeLessThanOrEqual(10000)
    expect(Number.isInteger(first.originSeed)).toBe(true)
    expect(Number.isInteger(first.particleSeed)).toBe(true)
  })

  it('updates GPU state at fixed 60 Hz, creates origins once, and draws once per host frame', () => {
    const surface = createSurface()
    const renderer = new FireP027Renderer({ surface })
    renderer.render(frame())
    renderer.render(frame({ nowMs: 17 }))
    expect(surface.setOrigins).toHaveBeenCalledTimes(1)
    expect(surface.setOrigins.mock.calls[0]?.[0]).toHaveLength(42)
    expect(surface.step).toHaveBeenCalledTimes(2)
    expect(surface.step.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        count: 1,
        dtSeconds: FIRE_P027_FIXED_DT_SECONDS,
      })
    )
    expect(surface.draw).toHaveBeenCalledTimes(2)
  })

  it('turns Birth off immediately and drains finite life after the compositor loop stops', async () => {
    const surface = createSurface()
    const waitFrame = jest.fn(async () => undefined)
    const renderer = new FireP027Renderer({ surface, waitFrame })
    renderer.render(frame())
    surface.step.mockClear()
    await renderer.stop({ mode: 'fade', fadeMs: 180 })

    expect(surface.step.mock.calls.length).toBeGreaterThan(1)
    for (const [batch, rawGate] of surface.step.mock.calls) {
      expect(batch.count).toBe(0)
      expect(rawGate).toBe(0)
    }
    expect(waitFrame.mock.calls.length).toBeLessThanOrEqual(6)
    expect(surface.clear).toHaveBeenCalledTimes(1)
    expect(renderer.snapshot().scheduler.state).toBe('stopped')
  })

  it('clears immediately for Emergency Stop without starting drain work', async () => {
    const surface = createSurface()
    const renderer = new FireP027Renderer({ surface })
    await renderer.stop({ mode: 'immediate', fadeMs: 500 })
    expect(surface.step).not.toHaveBeenCalled()
    expect(surface.draw).not.toHaveBeenCalled()
    expect(surface.clear).toHaveBeenCalledTimes(1)
  })

  it('atomically resets GPU state and CPU cursor/generation before reuse', () => {
    const surface = createSurface()
    const renderer = new FireP027Renderer({ surface })
    renderer.render(frame())
    renderer.reset()
    surface.step.mockClear()
    surface.setOrigins.mockClear()
    renderer.render(frame({ nowMs: 33 }))
    expect(surface.reset).toHaveBeenCalledTimes(1)
    expect(surface.setOrigins).toHaveBeenCalledTimes(1)
    expect(surface.step.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ start: 0, generationBase: 0, logicalUpdate: 0 })
    )
  })

  it('disposes once and performs no later GPU work', () => {
    const surface = createSurface()
    const renderer = new FireP027Renderer({ surface })
    renderer.dispose()
    renderer.dispose()
    renderer.render(frame())
    renderer.reset()
    expect(surface.dispose).toHaveBeenCalledTimes(1)
    expect(surface.step).not.toHaveBeenCalled()
    expect(surface.draw).not.toHaveBeenCalled()
    expect(surface.reset).not.toHaveBeenCalled()
    expect(renderer.snapshot().disposed).toBe(true)
  })

  it('preserves failure truth while still clearing after a failed normal drain', async () => {
    const surface = createSurface()
    surface.step.mockImplementation(() => {
      throw new Error('synthetic P027 drain failure')
    })
    const renderer = new FireP027Renderer({ surface })
    await expect(renderer.stop({ mode: 'fade', fadeMs: 180 })).rejects.toThrow(
      'synthetic P027 drain failure'
    )
    expect(surface.clear).toHaveBeenCalledTimes(1)
  })
})

function frame(
  patch: Partial<ProjectionEffectFrameContext> = {}
): ProjectionEffectFrameContext {
  return {
    nowMs: 0,
    deltaMs: 1000 / 60,
    parameters: {},
    ...patch,
  }
}

function controlsForPlanStrength(
  strength: number,
  position: ProjectionPerformancePlan['position'] = { x: 0, y: 0 },
  seed = 42
) {
  const executor = new ProjectionPerformancePlanExecutor()
  const plan = {
    schemaVersion: 1,
    planId: `fire-density-${String(strength).replace('.', '-')}-${seed}`,
    sessionId: 'fire-density-coherence-p10',
    revision: 1,
    action: 'start',
    effectId: 'fire',
    position,
    strength,
    durationMs: 4_000,
    seed,
    keyframes: [{ atMs: 0, position, strength }],
  } as const satisfies ProjectionPerformancePlan
  const planned = executor.activate(plan)
  if (!planned) throw new Error('Fire strength fixture was rejected')
  return mapFireParametersToP027Controls({
    ...FIRE_THUNDER_LAB_VISUAL_PARAMETERS.fire,
    ...planned.parameters,
    seed: plan.seed,
  })
}

function integrateVerticalExitSeconds(options: {
  initialCenterY: number
  fullyExitedCenterY: number
  forceY: number
  windY: number
  turbulenceY: number
}): number {
  let positionY = options.initialCenterY
  let velocityY = 0
  for (let step = 1; step <= 600; step += 1) {
    const accelerationY =
      options.forceY + (options.windY - velocityY) + options.turbulenceY
    velocityY += accelerationY * FIRE_P027_FIXED_DT_SECONDS
    positionY += velocityY * FIRE_P027_FIXED_DT_SECONDS
    if (positionY >= options.fullyExitedCenterY) {
      return step * FIRE_P027_FIXED_DT_SECONDS
    }
  }
  return Number.POSITIVE_INFINITY
}

function integrateHorizontalDisplacementCss(options: {
  turbulenceX: number
  seconds: number
  viewportWidth: number
}): number {
  let positionX = 0
  let velocityX = 0
  const steps = Math.round(options.seconds / FIRE_P027_FIXED_DT_SECONDS)
  for (let step = 0; step < steps; step += 1) {
    const accelerationX = options.turbulenceX - velocityX
    velocityX += accelerationX * FIRE_P027_FIXED_DT_SECONDS
    positionX += velocityX * FIRE_P027_FIXED_DT_SECONDS
  }
  return positionX * options.viewportWidth
}

interface SpriteRect {
  centerX: number
  centerY: number
  height: number
  width: number
}

function createBirthSpriteRects(options: {
  birthCount: number
  origins: ReturnType<typeof generateFireP027FallbackOrigins>
  spriteWidth: number
  spriteHeight: number
  viewportWidth: number
  maxLateralDisplacementCss: number
}): SpriteRect[] {
  const goldenAngle = Math.PI * (3 - Math.sqrt(5))
  return Array.from({ length: options.birthCount }, (_, index) => {
    const origin = options.origins[index % options.origins.length]
    const phase = (index + 1) * goldenAngle
    return {
      centerX:
        origin.x * options.viewportWidth +
        Math.sin(phase) * options.maxLateralDisplacementCss,
      centerY:
        origin.y * options.viewportWidth +
        Math.sin(phase * 0.5) * options.maxLateralDisplacementCss * 0.35,
      width: options.spriteWidth,
      height: options.spriteHeight,
    }
  })
}

function countConnectedComponents(rects: readonly SpriteRect[]): number {
  const visited = new Set<number>()
  let components = 0
  for (let start = 0; start < rects.length; start += 1) {
    if (visited.has(start)) continue
    components += 1
    const pending = [start]
    visited.add(start)
    while (pending.length > 0) {
      const current = pending.pop()
      if (current === undefined) break
      for (let candidate = 0; candidate < rects.length; candidate += 1) {
        if (visited.has(candidate)) continue
        if (rectsOverlap(rects[current], rects[candidate])) {
          visited.add(candidate)
          pending.push(candidate)
        }
      }
    }
  }
  return components
}

function rectsOverlap(left: SpriteRect, right: SpriteRect): boolean {
  return (
    Math.abs(left.centerX - right.centerX) <=
      (left.width + right.width) * 0.5 &&
    Math.abs(left.centerY - right.centerY) <= (left.height + right.height) * 0.5
  )
}

function createSurface() {
  return {
    step: jest.fn<void, Parameters<FireP027Surface['step']>>(),
    draw: jest.fn<void, Parameters<FireP027Surface['draw']>>(),
    setOrigins: jest.fn<void, Parameters<FireP027Surface['setOrigins']>>(),
    reset: jest.fn<void, []>(),
    clear: jest.fn<void, []>(),
    dispose: jest.fn<void, []>(),
  }
}
