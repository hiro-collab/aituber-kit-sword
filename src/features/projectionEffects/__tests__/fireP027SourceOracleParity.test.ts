import {
  FIRE_P027_FIXED_DT_SECONDS,
  FIRE_P027_LAYER_COUNT,
  FIRE_P027_SOURCE_ORACLE_PROFILE,
  FIRE_P027_SOURCE_POST_OFF_FRAME,
  FIRE_P027_SOURCE_SIZE_LAG_SECONDS,
} from '../plugins/fire/p027/contracts'
import { mapFireParametersToP027Controls } from '../plugins/fire/p027/renderer'
import {
  FIRE_P027_GENERATOR_FRAGMENT_SHADER,
  FIRE_P027_RASTER_FRAGMENT_SHADER,
  FIRE_P027_RASTER_VERTEX_SHADER,
  summarizeFireP027RgbaMetrics,
} from '../plugins/fire/p027/shaders'

describe('P027 Fire O1 source-oracle parity boundary', () => {
  it('keeps the public recipe scalar envelope fixed and free of private evidence', () => {
    expect(FIRE_P027_SOURCE_ORACLE_PROFILE).toEqual({
      authority: 'p027-o1-original',
      schemaVersion: 1,
      fixedHz: 60,
      slotCount: 150,
      sliceSize: 50,
      layerCount: 120,
      birthPerSecond: 300,
      lifeSeconds: 0.5,
      spriteWidthOrtho: 0.3,
      spriteHeightOrtho: 0.3,
      sizeLagSeconds: FIRE_P027_SOURCE_SIZE_LAG_SECONDS,
      postOffZeroFrame: FIRE_P027_SOURCE_POST_OFF_FRAME,
      blend: {
        source: 'one-minus-source-alpha',
        destination: 'one',
        depthTest: false,
        legacyAlpha: true,
      },
    })
    expect(Object.isFrozen(FIRE_P027_SOURCE_ORACLE_PROFILE)).toBe(true)
    expect(Object.isFrozen(FIRE_P027_SOURCE_ORACLE_PROFILE.blend)).toBe(true)
    expect(JSON.stringify(FIRE_P027_SOURCE_ORACLE_PROFILE)).not.toMatch(
      /[A-Za-z]:\\|source_oracle_v1|measurements|repeatability|\.toe|\.png/i
    )
  })

  it('reproduces the distinct source gate and size-lag response', () => {
    const onFrameZero = advanceLag(0, 1)
    const steady = advanceLagFrames(0, 1, 31)
    const offFrameZero = advanceLag(steady, 0)
    const drained = advanceLagFrames(offFrameZero, 0, 45)

    expect(onFrameZero).toBeGreaterThan(0.31)
    expect(onFrameZero).toBeLessThan(0.33)
    expect(steady).toBeGreaterThan(0.999)
    expect(offFrameZero).toBeGreaterThan(0.67)
    expect(offFrameZero).toBeLessThan(0.69)
    expect(drained).toBeLessThan(0.0000001)
    expect(FIRE_P027_SOURCE_POST_OFF_FRAME).toBe(45)
  })

  it('does not let product look controls rewrite the O1 particle recipe', () => {
    const controls = mapFireParametersToP027Controls({
      emissionRate: 1,
      lifetimeMs: 10_000,
      particleBudget: 8,
      pointSize: 2,
      upwardSpeed: 0,
      noiseStrength: 0,
      masterIntensity: 0.5,
    })

    expect(controls).toEqual(
      expect.objectContaining({
        birthPerSecond: 300,
        lifeSeconds: 0.5,
        spriteWidthOrtho: 0.3,
        spriteHeightOrtho: 0.3,
        originRadiusX: 0.1,
        originRadiusY: 0.1,
        originRadiusZ: 0.1,
        forceY: 4,
        windY: 3,
        turbulenceX: 6,
        turbulenceY: 6,
        turbulenceZ: 6,
        turbulencePeriod: 0.01,
        lifeVarianceSeconds: 0,
        jitterBirths: false,
      })
    )
  })

  it('preserves the two generator families, radial base and 120-layer phase', () => {
    expect(FIRE_P027_GENERATOR_FRAGMENT_SHADER).toContain(
      'float primarySeed = mix(1.0, 480.0, preset);'
    )
    expect(FIRE_P027_GENERATOR_FRAGMENT_SHADER).toContain(
      'float displacementSeed = mix(1.0, 181.0, preset);'
    )
    expect(FIRE_P027_GENERATOR_FRAGMENT_SHADER).toContain(
      'float displacementSpread = mix(2.0, 20.0, preset);'
    )
    expect(FIRE_P027_GENERATOR_FRAGMENT_SHADER).toContain(
      'float radial = clamp(1.0 - length(warped), 0.0, 1.0);'
    )
    expect(FIRE_P027_GENERATOR_FRAGMENT_SHADER).toContain(
      'hsv.x = fract(hsv.x - 150.0 / 360.0);'
    )
    expect(FIRE_P027_GENERATOR_FRAGMENT_SHADER).not.toContain('perforation')
    expect(FIRE_P027_GENERATOR_FRAGMENT_SHADER).not.toContain('lift')
    expect(FIRE_P027_RASTER_VERTEX_SHADER).toContain(
      'float phase = float(slot)'
    )
    expect(FIRE_P027_RASTER_VERTEX_SHADER).toContain(
      'vLayer = clamp(int(floor(phase + lifePhase + 0.5))'
    )
    expect(FIRE_P027_LAYER_COUNT).toBe(120)
  })

  it('uses the source blend factor once and keeps depth out of the raster shader', () => {
    expect(FIRE_P027_SOURCE_ORACLE_PROFILE.blend).toEqual(
      expect.objectContaining({
        source: 'one-minus-source-alpha',
        destination: 'one',
        depthTest: false,
      })
    )
    expect(FIRE_P027_RASTER_FRAGMENT_SHADER).not.toContain(
      'sourceRgb *= (1.0 - sourceAlpha)'
    )
  })

  it('reduces transient pixels to bounded oracle vocabulary without retaining them', () => {
    const rgba = new Float32Array([
      0, 0, 0, 0.2, 1, 0.8, 0.2, 0.7, 0, 0, 0, 0, 0, 0, 0, 0.1, 0.82, 0.39,
      0.02, 0.8, 0, 0, 0, 0,
    ])
    const summary = summarizeFireP027RgbaMetrics(rgba, 3, 2)

    expect(summary).toEqual(
      expect.objectContaining({
        width: 3,
        height: 2,
        supportPixels: 2,
        supportArea: 1 / 3,
        hotPixels: 1,
        warmPixels: 1,
        hotToWarmRatio: 1,
        outsideSupportMaxRgb: 0,
        outsideSupportAlphaMin: 0,
        postOffRgbaZero: false,
      })
    )
    expect(summary.outsideSupportAlphaMax).toBeCloseTo(0.2)
    expect(Object.isFrozen(summary)).toBe(true)
    expect(JSON.stringify(summary)).not.toContain('1,0.8,0.2')
    expect(
      Object.values(summary).every((value) => {
        return typeof value !== 'number' || Number.isFinite(value)
      })
    ).toBe(true)
  })

  it('requires exact input shape and recognizes strict post-off RGBA zero', () => {
    expect(() =>
      summarizeFireP027RgbaMetrics(new Float32Array(3), 1, 1)
    ).toThrow('P027 metric input shape invalid')
    expect(
      summarizeFireP027RgbaMetrics(new Float32Array(4 * 4 * 4), 4, 4)
        .postOffRgbaZero
    ).toBe(true)
  })
})

function advanceLag(previous: number, rawGate: number): number {
  const response =
    1 -
    Math.exp(-FIRE_P027_FIXED_DT_SECONDS / FIRE_P027_SOURCE_SIZE_LAG_SECONDS)
  return previous + (rawGate - previous) * response
}

function advanceLagFrames(
  initial: number,
  rawGate: number,
  frameCount: number
): number {
  let value = initial
  for (let frame = 0; frame < frameCount; frame += 1) {
    value = advanceLag(value, rawGate)
  }
  return value
}
