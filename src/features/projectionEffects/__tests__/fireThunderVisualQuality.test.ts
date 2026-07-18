import {
  buildThunderLabVisualPlan,
  FIRE_THUNDER_LAB_VISUAL_PARAMETERS,
} from '../browser/fireThunderLabCanvasLayer'
import { fireEffectDefinition } from '../plugins/fire/definition'
import {
  FireParticleRenderer,
  type FireParticle,
  type FireParticleSurface,
} from '../plugins/fire/renderer'
import {
  FIRE_PARTICLE_FRAGMENT_SHADER,
  FIRE_PARTICLE_VERTEX_SHADER,
} from '../plugins/fire/shaders'
import { thunderBallEffectDefinition } from '../plugins/thunderBall/definition'
import {
  ThunderBallRenderer,
  type ThunderBallFrame,
  type ThunderBallSurface,
} from '../plugins/thunderBall/renderer'

describe('Fire+Thunder deterministic visual-quality contract', () => {
  it('builds a broad, hot Fire plume and restores its seeded first frame', () => {
    const draws: FireParticle[][] = []
    const surface = {
      draw: jest.fn((particles: readonly Readonly<FireParticle>[]) => {
        draws.push(particles.map((particle) => ({ ...particle })))
      }),
      clear: jest.fn(),
      dispose: jest.fn(),
    } satisfies FireParticleSurface
    const renderer = new FireParticleRenderer({ surface })
    const context = {
      nowMs: 1000,
      deltaMs: 100,
      parameters: {
        ...defaultParameters(fireEffectDefinition.parameters),
        ...FIRE_THUNDER_LAB_VISUAL_PARAMETERS.fire,
      },
    }

    renderer.render(context)
    const firstFrame = draws.at(-1)
    expect(firstFrame).toHaveLength(42)
    expect(renderer.snapshot()).toEqual(
      expect.objectContaining({
        particleCount: 42,
        averageParticleHeat: expect.any(Number),
        averageParticleSize: expect.any(Number),
        horizontalSpan: expect.any(Number),
      })
    )
    expect(renderer.snapshot().averageParticleHeat).toBeGreaterThan(0.8)
    expect(renderer.snapshot().averageParticleSize).toBeGreaterThan(65)
    expect(renderer.snapshot().horizontalSpan).toBeGreaterThan(0.25)

    renderer.reset()
    renderer.render(context)
    expect(draws.at(-1)).toEqual(firstFrame)
  })

  it('keeps the richer Fire shader inputs bounded and uses ordered fades', () => {
    expect(FIRE_PARTICLE_VERTEX_SHADER).toContain(
      'layout(location = 5) in float particleSeed'
    )
    expect(FIRE_PARTICLE_FRAGMENT_SHADER).toContain('verticalTaper')
    expect(FIRE_PARTICLE_FRAGMENT_SHADER).toContain('ageHeat')
    expect(FIRE_PARTICLE_FRAGMENT_SHADER).toContain(
      'smoothstep(0.48, 1.0, radius)'
    )
    expect(FIRE_PARTICLE_FRAGMENT_SHADER).not.toMatch(
      /smoothstep\(\s*1(?:\.0)?\s*,\s*0(?:\.0)?\s*,/
    )
  })

  it('maps the Thunder orb to a centered layered Canvas2D composition', () => {
    const frames: ThunderBallFrame[] = []
    const surface = {
      draw: jest.fn((frame: Readonly<ThunderBallFrame>) => frames.push(frame)),
      clear: jest.fn(),
      dispose: jest.fn(),
    } satisfies ThunderBallSurface
    const renderer = new ThunderBallRenderer({ surface })
    renderer.render({
      nowMs: 1000,
      deltaMs: 100,
      parameters: {
        ...defaultParameters(thunderBallEffectDefinition.parameters),
        ...FIRE_THUNDER_LAB_VISUAL_PARAMETERS.thunderBall,
      },
    })
    const frame = frames.at(-1)
    if (!frame) throw new Error('Thunder quality fixture did not draw')
    const plan = buildThunderLabVisualPlan(frame, 1280, 720)

    expect(plan.centerX).toBeCloseTo(640)
    expect(plan.centerY).toBeCloseTo(374.4)
    expect(plan.orbRadius).toBeCloseTo(172.8)
    expect(plan.coreRadius).toBeGreaterThan(18)
    expect(plan.haloRadius).toBeGreaterThan(120)
    expect(plan.haloRadius).toBeLessThan(plan.orbRadius)
    expect(plan.glowLineWidth).toBeGreaterThan(plan.lineWidth * 3)
    expect(plan.bloomBlur).toBeGreaterThan(18)
    expect(plan.masterAlpha).toBe(1)
  })

  it('keeps every lab visual preset inside its registered parameter bounds', () => {
    expectPresetInDefinition(
      FIRE_THUNDER_LAB_VISUAL_PARAMETERS.fire,
      fireEffectDefinition.parameters
    )
    expectPresetInDefinition(
      FIRE_THUNDER_LAB_VISUAL_PARAMETERS.thunderBall,
      thunderBallEffectDefinition.parameters
    )
  })
})

function defaultParameters(
  parameters: readonly Readonly<{
    id: string
    defaultValue: unknown
  }>[]
): Record<string, unknown> {
  return Object.fromEntries(
    parameters.map((parameter) => [parameter.id, parameter.defaultValue])
  )
}

function expectPresetInDefinition(
  preset: Readonly<Record<string, unknown>>,
  parameters: readonly Readonly<{
    id: string
    kind: string
    minimum?: number
    maximum?: number
  }>[]
): void {
  const definitions = new Map(
    parameters.map((parameter) => [parameter.id, parameter])
  )
  for (const [id, value] of Object.entries(preset)) {
    const parameter = definitions.get(id)
    expect(parameter).toBeDefined()
    if (typeof value !== 'number' || parameter?.kind !== 'number') continue
    expect(value).toBeGreaterThanOrEqual(parameter.minimum ?? value)
    expect(value).toBeLessThanOrEqual(parameter.maximum ?? value)
  }
}
