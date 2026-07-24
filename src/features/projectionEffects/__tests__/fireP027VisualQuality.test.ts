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

  it('tone maps brightness monotonically with finite bounded alpha', () => {
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

  it('derives bounded coverage from linear display luminance before RGB gamma', () => {
    const black = toneMapFireP027DisplaySample({ r: 0, g: 0, b: 0, a: 9 })
    const dark = toneMapFireP027DisplaySample({
      r: 0.005,
      g: 0.001,
      b: 0,
      a: 9,
    })
    const orange = toneMapFireP027DisplaySample({
      r: 0.8,
      g: 0.25,
      b: 0.02,
      a: 0,
    })
    const hot = toneMapFireP027DisplaySample({
      r: 8,
      g: 5,
      b: 0.4,
      a: 0,
    })

    expect(black).toEqual({ r: 0, g: 0, b: 0, a: 0 })
    expect(dark.a).toBeGreaterThan(0)
    expect(dark.a).toBeLessThan(0.01)
    expect(orange.a).toBeGreaterThan(0.25)
    expect(orange.a).toBeLessThan(0.7)
    expect(hot.a).toBeGreaterThan(0.9)
    expect(hot.a).toBeLessThanOrEqual(1)
    expect(orange.r).toBeGreaterThan(orange.g)
    expect(orange.g).toBeGreaterThan(orange.b)
  })

  it('produces a yellow-white core without flattening the whole result to white', () => {
    const edge = toneMapFireP027DisplaySample({
      r: 0.35,
      g: 0.08,
      b: 0,
      a: 0.25,
    })
    const core = toneMapFireP027DisplaySample({
      r: 8,
      g: 5,
      b: 0.4,
      a: 4,
    })

    expect(edge.r).toBeGreaterThan(edge.g)
    expect(edge.g).toBeGreaterThan(edge.b)
    expect(core.r).toBeGreaterThanOrEqual(core.g)
    expect(core.g).toBeGreaterThan(core.b)
    expect(core.r).toBeLessThan(1)
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
    expect(composite.b).toBeGreaterThan(greenBackground.b)
    expect(greenBackground.g * (1 - core.a)).toBeLessThan(0.13)
    expect(darkVeil.a).toBeLessThan(0.01)
  })

  it('keeps hot white-yellow samples a minority while warm midtones dominate the weak flame body', () => {
    const controls = mapFireParametersToP027Controls({
      masterIntensity: 0.5788,
      temperature: 0.93,
      bloomGain: 0.92,
      postProcessing: true,
    })
    const tint = {
      r: controls.tintR,
      g: controls.tintG,
      b: controls.tintB,
      a: controls.tintA,
    }
    const displays = [
      ...Array.from({ length: 8 }, (_, index) =>
        toneMapFireP027DisplaySample(
          composeFireP027SpriteSample(
            {
              r: 0.01 + index * 0.003,
              g: 0.002 + index * 0.001,
              b: 0,
              a: 0.04 + index * 0.005,
            },
            tint,
            1
          )
        )
      ),
      ...Array.from({ length: 6 }, (_, index) =>
        toneMapFireP027DisplaySample(
          accumulateSamples(
            Array.from({ length: 2 }, () =>
              composeFireP027SpriteSample(
                {
                  r: 0.42 + index * 0.04,
                  g: 0.12 + index * 0.025,
                  b: 0.006,
                  a: 0.28 + index * 0.02,
                },
                tint,
                1
              )
            )
          )
        )
      ),
      ...Array.from({ length: 2 }, (_, index) =>
        toneMapFireP027DisplaySample(
          accumulateSamples(
            Array.from({ length: 4 }, () =>
              composeFireP027SpriteSample(
                {
                  r: 1.1 + index * 0.2,
                  g: 0.68 + index * 0.08,
                  b: 0.08,
                  a: 0.6 + index * 0.04,
                },
                tint,
                1
              )
            )
          )
        )
      ),
    ]
    const hotWhiteYellow = displays.filter(
      (sample) =>
        sample.r > 0.82 && sample.g > 0.72 && sample.b > 0.1 && sample.a > 0.7
    )
    const warmMidtones = displays.filter(
      (sample) =>
        sample.r > sample.g &&
        sample.g > sample.b &&
        sample.r > 0.35 &&
        sample.r < 0.9 &&
        sample.a > 0.15
    )
    const paleFogOutsideCore = displays.slice(0, 14).filter((sample) => {
      const maximum = Math.max(sample.r, sample.g, sample.b)
      const minimum = Math.min(sample.r, sample.g, sample.b)
      return sample.a > 0.25 && maximum - minimum < 0.08
    })

    expect(hotWhiteYellow.length).toBeGreaterThan(0)
    expect(hotWhiteYellow.length).toBeLessThan(displays.length / 3)
    expect(warmMidtones.length).toBeGreaterThan(paleFogOutsideCore.length)
    for (const sample of displays) {
      expect(Object.values(sample).every(Number.isFinite)).toBe(true)
      expect(sample.a).toBeGreaterThanOrEqual(0)
      expect(sample.a).toBeLessThanOrEqual(1)
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
    expect(FIRE_P027_DISPLAY_FRAGMENT_SHADER).toContain('dot(displayLinearRgb')
  })

  it('locks the shader to monotonic additive energy and straight display RGBA', () => {
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
    expect(FIRE_P027_DISPLAY_FRAGMENT_SHADER).toContain(
      'toneMappedLinearLuminance'
    )
    expect(FIRE_P027_DISPLAY_FRAGMENT_SHADER).toContain(
      'vec3 displayRgb = pow('
    )
    expect(FIRE_P027_DISPLAY_FRAGMENT_SHADER).toContain('visibleAlpha')
    expect(FIRE_P027_DISPLAY_FRAGMENT_SHADER).toContain(
      'fragColor = vec4(displayRgb, visibleAlpha);'
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
