import {
  FIRE_P027_DEFAULT_CONTROLS,
  FIRE_P027_LAYER_COUNT,
  FIRE_P027_SLICE_SIZE,
  FIRE_P027_SLOT_COUNT,
  FIRE_P027_STATE_PORTS,
  FireP027CapabilityError,
  assertFireP027Capabilities,
  cloneFireP027Defaults,
  type FireP027CapabilitySnapshot,
} from '../plugins/fire/p027/contracts'
import {
  FIRE_P027_GENERATOR_FRAGMENT_SHADER,
  FIRE_P027_RASTER_FRAGMENT_SHADER,
  FIRE_P027_RASTER_VERTEX_SHADER,
  FIRE_P027_STATE_FRAGMENT_SHADER,
} from '../plugins/fire/p027/shaders'

const READY: FireP027CapabilitySnapshot = {
  webgl2: true,
  colorBufferFloat: true,
  floatBlend: true,
  maxDrawBuffers: 4,
  maxColorAttachments: 4,
  maxArrayTextureLayers: 120,
}

describe('P027 Fire source/static contract', () => {
  it('keeps the verified bounded state, slice and layer topology', () => {
    expect(FIRE_P027_SLOT_COUNT).toBe(150)
    expect(FIRE_P027_SLICE_SIZE).toBe(50)
    expect(FIRE_P027_LAYER_COUNT).toBe(120)
    expect(FIRE_P027_STATE_PORTS).toEqual([
      'STATE_POSITION_AGE',
      'STATE_GENERATION_LIFE',
      'STATE_VELOCITY_OPACITY',
      'STATE_CONTROL_RELAY',
    ])
    expect(Object.isFrozen(FIRE_P027_STATE_PORTS)).toBe(true)
  })

  it('preserves P027 defaults while returning mutable per-session controls', () => {
    const controls = cloneFireP027Defaults()
    controls.birthPerSecond = 12
    expect(FIRE_P027_DEFAULT_CONTROLS.birthPerSecond).toBe(300)
    expect(FIRE_P027_DEFAULT_CONTROLS.lifeSeconds).toBe(0.5)
    expect(FIRE_P027_DEFAULT_CONTROLS.inputLagSeconds).toBe(0.1)
    expect(Object.isFrozen(FIRE_P027_DEFAULT_CONTROLS)).toBe(true)
  })

  it('requires the exact WebGL2 capability floor', () => {
    expect(() => assertFireP027Capabilities(READY)).not.toThrow()
    const failures = [
      ['webgl2', { webgl2: false }],
      ['color-buffer-float', { colorBufferFloat: false }],
      ['float-blend', { floatBlend: false }],
      ['draw-buffers', { maxDrawBuffers: 3 }],
      ['color-attachments', { maxColorAttachments: 3 }],
      ['array-layers', { maxArrayTextureLayers: 119 }],
    ] as const

    for (const [failure, patch] of failures) {
      expect(() => assertFireP027Capabilities({ ...READY, ...patch })).toThrow(
        expect.objectContaining<Partial<FireP027CapabilityError>>({ failure })
      )
    }
  })

  it('keeps state, appearance generation and instanced raster as separate domains', () => {
    expect(FIRE_P027_STATE_FRAGMENT_SHADER).toContain(
      'layout(location = 3) out vec4 oControlRelay'
    )
    expect(FIRE_P027_STATE_FRAGMENT_SHADER).toContain(
      'nextVelocityOpacity = vec4(0.0, 0.0, 0.0, 1.0)'
    )
    expect(FIRE_P027_GENERATOR_FRAGMENT_SHADER).toContain('float fbm(')
    expect(FIRE_P027_RASTER_VERTEX_SHADER).toContain('gl_InstanceID')
    expect(FIRE_P027_RASTER_FRAGMENT_SHADER).toContain(
      'sourceColor * (1.0 - sourceColor.a)'
    )
  })
})
