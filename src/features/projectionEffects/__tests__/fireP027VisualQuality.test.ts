import {
  FIRE_P027_DISPLAY_FRAGMENT_SHADER,
  FIRE_P027_RASTER_FRAGMENT_SHADER,
  composeFireP027SpriteSample,
  toneMapFireP027DisplaySample,
} from '../plugins/fire/p027/shaders'
import { mapFireParametersToP027Controls } from '../plugins/fire/p027/renderer'

const WHITE_TINT = { r: 1, g: 1, b: 1, a: 1 } as const

describe('P027 Fire visual compositing quality', () => {
  it('keeps transparent black exactly transparent through raster and display', () => {
    const contribution = composeFireP027SpriteSample(
      { r: 0, g: 0, b: 0, a: 1 },
      WHITE_TINT,
      1
    )
    const display = toneMapFireP027DisplaySample(contribution)

    expect(contribution).toEqual({ r: 0, g: 0, b: 0, a: 0 })
    expect(display).toEqual({ r: 0, g: 0, b: 0, a: 0 })
  })

  it('does not let dark RGB retain an opaque alpha veil', () => {
    const dark = composeFireP027SpriteSample(
      { r: 0.002, g: 0.001, b: 0, a: 0.45 },
      WHITE_TINT,
      1
    )
    const visible = composeFireP027SpriteSample(
      { r: 0.8, g: 0.38, b: 0.03, a: 0.45 },
      WHITE_TINT,
      1
    )

    expect(dark.a).toBeLessThan(0.001)
    expect(visible.a).toBeGreaterThan(dark.a)
    expect(visible.r).toBeGreaterThan(dark.r)
  })

  it('keeps additive sprite energy monotonic as source alpha and overlap rise', () => {
    const byAlpha = [0.08, 0.24, 0.5, 0.9].map((alpha) =>
      composeFireP027SpriteSample(
        { r: 0.62, g: 0.21, b: 0.018, a: alpha },
        WHITE_TINT,
        1
      )
    )
    for (let index = 1; index < byAlpha.length; index += 1) {
      const previous = byAlpha[index - 1]!
      const current = byAlpha[index]!
      expect(current.r).toBeGreaterThanOrEqual(previous.r)
      expect(current.g).toBeGreaterThanOrEqual(previous.g)
      expect(current.b).toBeGreaterThanOrEqual(previous.b)
      expect(current.a).toBeGreaterThanOrEqual(previous.a)
    }

    const overlapAlphas = [1, 2, 4, 8, 16, 32].map(
      (count) =>
        toneMapFireP027DisplaySample(
          accumulateSamples(
            Array.from({ length: count }, () =>
              composeFireP027SpriteSample(
                { r: 0.62, g: 0.21, b: 0.018, a: 0.5 },
                WHITE_TINT,
                1
              )
            )
          )
        ).a
    )
    for (let index = 1; index < overlapAlphas.length; index += 1) {
      expect(overlapAlphas[index]).toBeGreaterThanOrEqual(
        overlapAlphas[index - 1]!
      )
    }
  })

  it('clamps accumulated fixed output monotonically without recoloring it', () => {
    const samples = [0, 0.08, 0.25, 0.8, 2, 8].map((energy) =>
      toneMapFireP027DisplaySample({
        r: energy,
        g: energy * 0.58,
        b: energy * 0.08,
        a: energy,
      })
    )
    const luminance = samples.map(
      (sample) => sample.r * 0.2126 + sample.g * 0.7152 + sample.b * 0.0722
    )

    for (let index = 1; index < samples.length; index += 1) {
      expect(luminance[index]).toBeGreaterThanOrEqual(luminance[index - 1]!)
    }
    for (const sample of samples) {
      expect(Object.values(sample).every(Number.isFinite)).toBe(true)
      expect(sample.a).toBeGreaterThanOrEqual(0)
      expect(sample.a).toBeLessThanOrEqual(1)
    }
  })

  it('preserves straight alpha instead of replacing it with display luminance', () => {
    const opaqueBlack = toneMapFireP027DisplaySample({
      r: 0,
      g: 0,
      b: 0,
      a: 0.7,
    })
    const transparentOrange = toneMapFireP027DisplaySample({
      r: 0.8,
      g: 0.25,
      b: 0.02,
      a: 0,
    })
    const bounded = toneMapFireP027DisplaySample({
      r: 8,
      g: 5,
      b: 0.4,
      a: 3,
    })

    expect(opaqueBlack).toEqual({ r: 0, g: 0, b: 0, a: 0.7 })
    expect(transparentOrange).toEqual({ r: 0.8, g: 0.25, b: 0.02, a: 0 })
    expect(bounded).toEqual({ r: 1, g: 1, b: 0.4, a: 1 })
  })

  it('keeps the accumulated orange body distinct from the hottest tail', () => {
    const edge = toneMapFireP027DisplaySample({
      r: 0.35,
      g: 0.08,
      b: 0,
      a: 0.25,
    })
    const core = toneMapFireP027DisplaySample({
      r: 0.94,
      g: 0.71,
      b: 0.12,
      a: 0.91,
    })

    expect(edge).toEqual({ r: 0.35, g: 0.08, b: 0, a: 0.25 })
    expect(core).toEqual({ r: 0.94, g: 0.71, b: 0.12, a: 0.91 })
    expect(core.r - core.g).toBeGreaterThan(edge.g - edge.b)
    expect(core).not.toEqual({ r: 1, g: 1, b: 1, a: 1 })
  })

  it('keeps an active weak core materially opaque over green while its edge stays transparent', () => {
    const controls = mapFireParametersToP027Controls({
      masterIntensity: 0.5788,
      temperature: 0.78,
      bloomGain: 0.64,
      postProcessing: true,
    })
    const tint = {
      r: controls.tintR,
      g: controls.tintG,
      b: controls.tintB,
      a: controls.tintA,
    }
    const edge = toneMapFireP027DisplaySample(
      accumulateSamples([
        composeFireP027SpriteSample(
          { r: 0.004, g: 0.001, b: 0, a: 0.03 },
          tint,
          1
        ),
      ])
    )
    const midtone = toneMapFireP027DisplaySample(
      accumulateSamples(
        Array.from({ length: 2 }, () =>
          composeFireP027SpriteSample(
            { r: 0.48, g: 0.16, b: 0.008, a: 0.32 },
            tint,
            1
          )
        )
      )
    )
    const core = toneMapFireP027DisplaySample(
      accumulateSamples(
        Array.from({ length: 4 }, () =>
          composeFireP027SpriteSample(
            { r: 1.2, g: 0.72, b: 0.08, a: 0.62 },
            tint,
            1
          )
        )
      )
    )
    const darkVeil = toneMapFireP027DisplaySample(
      composeFireP027SpriteSample({ r: 0.002, g: 0.001, b: 0, a: 0.9 }, tint, 1)
    )
    const greenBackground = { r: 0.02, g: 0.78, b: 0.05 }
    const composite = sourceOver(core, greenBackground)

    expect(controls.tintA).toBeGreaterThan(0.79)
    expect(controls.tintA).toBeLessThan(0.85)
    expect(edge.a).toBeLessThan(0.025)
    expect(midtone.a).toBeGreaterThan(0.25)
    expect(midtone.a).toBeLessThan(0.8)
    expect(midtone.r).toBeGreaterThan(midtone.g)
    expect(midtone.g).toBeGreaterThan(midtone.b)
    expect(core.a).toBeGreaterThanOrEqual(0.84)
    expect(core.r).toBeGreaterThanOrEqual(core.g)
    expect(core.g).toBeGreaterThan(core.b)
    expect(composite.r).toBeGreaterThan(0.65)
    expect(composite.r).toBeGreaterThan(composite.g - 0.05)
    expect(composite.b).toBeLessThanOrEqual(greenBackground.b + 0.01)
    expect(greenBackground.g * (1 - core.a)).toBeLessThan(0.13)
    expect(darkVeil.a).toBeLessThan(0.01)
  })

  it('does not turn distinct source-orange samples into a common pale core', () => {
    const displays = [
      { r: 0.22, g: 0.04, b: 0, a: 0.16 },
      { r: 0.48, g: 0.17, b: 0.01, a: 0.41 },
      { r: 0.73, g: 0.39, b: 0.03, a: 0.68 },
      { r: 0.94, g: 0.76, b: 0.13, a: 0.92 },
    ].map(toneMapFireP027DisplaySample)

    expect(displays).toEqual([
      { r: 0.22, g: 0.04, b: 0, a: 0.16 },
      { r: 0.48, g: 0.17, b: 0.01, a: 0.41 },
      { r: 0.73, g: 0.39, b: 0.03, a: 0.68 },
      { r: 0.94, g: 0.76, b: 0.13, a: 0.92 },
    ])
    for (const sample of displays) {
      expect(sample.r).toBeGreaterThan(sample.g)
      expect(sample.g).toBeGreaterThan(sample.b)
    }
  })

  it('lets dense finite overlap approach opaque coverage without a sub-unity cap', () => {
    const controls = mapFireParametersToP027Controls({
      masterIntensity: 1,
      temperature: 1,
      bloomGain: 2,
      postProcessing: true,
    })
    const tint = {
      r: controls.tintR,
      g: controls.tintG,
      b: controls.tintB,
      a: controls.tintA,
    }
    const denseOverlap = accumulateSamples(
      Array.from({ length: 32 }, () =>
        composeFireP027SpriteSample({ r: 4, g: 2.8, b: 0.6, a: 0.92 }, tint, 1)
      )
    )
    const display = toneMapFireP027DisplaySample(denseOverlap)

    expect(display.a).toBeGreaterThan(0.95)
    expect(display.a).toBeLessThanOrEqual(1)
    expect(FIRE_P027_DISPLAY_FRAGMENT_SHADER).not.toContain('0.86')
    expect(FIRE_P027_DISPLAY_FRAGMENT_SHADER).not.toContain('dot(')
  })

  it('locks additive energy and an O1-compatible straight fixed-output display', () => {
    expect(FIRE_P027_RASTER_FRAGMENT_SHADER).not.toContain(
      'sourceColor.rgb *= sourceColor.a'
    )
    expect(FIRE_P027_RASTER_FRAGMENT_SHADER).not.toContain('spriteCoverage')
    expect(FIRE_P027_RASTER_FRAGMENT_SHADER).not.toContain(
      'sourceColor * (1.0 - sourceColor.a)'
    )
    expect(FIRE_P027_RASTER_FRAGMENT_SHADER).toContain(
      'fragColor = vec4(sourceRgb, correlatedAlpha);'
    )
    expect(FIRE_P027_RASTER_FRAGMENT_SHADER).toContain('correlatedAlpha')
    expect(FIRE_P027_DISPLAY_FRAGMENT_SHADER).not.toContain('exp(')
    expect(FIRE_P027_DISPLAY_FRAGMENT_SHADER).not.toContain('pow(')
    expect(FIRE_P027_DISPLAY_FRAGMENT_SHADER).not.toContain('smoothstep(')
    expect(FIRE_P027_DISPLAY_FRAGMENT_SHADER).not.toContain('visibleAlpha')
    expect(FIRE_P027_DISPLAY_FRAGMENT_SHADER).toContain(
      'fragColor = clamp(accumulated, vec4(0.0), vec4(1.0));'
    )
  })
})

function accumulateSamples(
  samples: readonly Readonly<{ r: number; g: number; b: number; a: number }>[]
) {
  return samples.reduce(
    (accumulated, sample) => ({
      r: accumulated.r + sample.r,
      g: accumulated.g + sample.g,
      b: accumulated.b + sample.b,
      a: accumulated.a + sample.a,
    }),
    { r: 0, g: 0, b: 0, a: 0 }
  )
}

function sourceOver(
  source: Readonly<{ r: number; g: number; b: number; a: number }>,
  backdrop: Readonly<{ r: number; g: number; b: number }>
) {
  return {
    r: source.r * source.a + backdrop.r * (1 - source.a),
    g: source.g * source.a + backdrop.g * (1 - source.a),
    b: source.b * source.a + backdrop.b * (1 - source.a),
  }
}
