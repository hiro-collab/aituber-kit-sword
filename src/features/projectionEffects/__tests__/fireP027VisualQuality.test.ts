import {
  FIRE_P027_DISPLAY_FRAGMENT_SHADER,
  FIRE_P027_RASTER_FRAGMENT_SHADER,
  composeFireP027SpriteSample,
  toneMapFireP027DisplaySample,
} from '../plugins/fire/p027/shaders'

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

  it('locks the shader to one premultiplication and luminance-correlated alpha', () => {
    expect(FIRE_P027_RASTER_FRAGMENT_SHADER).not.toContain(
      'sourceColor.rgb *= sourceColor.a'
    )
    expect(FIRE_P027_RASTER_FRAGMENT_SHADER).toContain('correlatedAlpha')
    expect(FIRE_P027_DISPLAY_FRAGMENT_SHADER).toContain('mappedLuminance')
    expect(FIRE_P027_DISPLAY_FRAGMENT_SHADER).toContain('visibleAlpha')
  })
})
