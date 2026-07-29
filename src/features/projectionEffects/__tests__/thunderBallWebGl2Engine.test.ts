import {
  THUNDER_WEBGL2_BLUR_SCALES,
  THUNDER_WEBGL2_BLUR_WEIGHTS,
  THUNDER_WEBGL2_MAX_RESOURCE_COUNT,
  THUNDER_WEBGL2_PASS_GRAPH,
  type ThunderWebGl2EngineFrame,
  type ThunderWebGl2ResourceKind,
} from '../plugins/thunderBall/webgl2/contracts'
import {
  mapThunderParametersToWebGl2AdapterConfig,
  mapThunderWebGl2EngineFrame,
} from '../plugins/thunderBall/webgl2/adapter'
import { ThunderBallWebGl2Engine } from '../plugins/thunderBall/webgl2/engine'
import {
  resolveThunderWebGl2BlurOracle,
  resolveThunderWebGl2CompositeOracle,
  resolveThunderWebGl2RawOracle,
  resolveThunderWebGl2StraightPresentationOracle,
  THUNDER_WEBGL2_BLOOM_FRAGMENT_SHADER,
  THUNDER_WEBGL2_BLUR_FRAGMENT_SHADER,
  THUNDER_WEBGL2_FULLSCREEN_VERTEX_SHADER,
  THUNDER_WEBGL2_RIBBON_FRAGMENT_SHADER,
  THUNDER_WEBGL2_TEMPORAL_FRAGMENT_SHADER,
} from '../plugins/thunderBall/webgl2/shaders'
import {
  createThunderWebGl2Topology,
  resolveThunderWebGl2Tone,
} from '../plugins/thunderBall/webgl2/topology'

interface FakeResource {
  id: number
  kind: ThunderWebGl2ResourceKind
}

interface FakeThunderGl {
  allocated: Record<ThunderWebGl2ResourceKind, FakeResource[]>
  armContextLossAtCheck(check: number): void
  armDeleteFailure(kind: ThunderWebGl2ResourceKind): void
  armDrawFailure(): void
  armGlErrorAtCheck(check: number): void
  armLegacyBlitError(): void
  armResizeFailure(): void
  bindFramebuffer: jest.Mock
  bindTexture: jest.Mock
  blitFramebuffer: jest.Mock
  blendEquation: jest.Mock
  blurSteps: jest.Mock
  bufferData: jest.Mock
  deleteAttempts: Record<ThunderWebGl2ResourceKind, FakeResource[]>
  drawArrays: jest.Mock
  gl: WebGL2RenderingContext
  successfulDeletes: Record<ThunderWebGl2ResourceKind, FakeResource[]>
  uniform1f: jest.Mock
}

const RESOURCE_KINDS: readonly ThunderWebGl2ResourceKind[] = [
  'shader',
  'buffer',
  'vertexArray',
  'framebuffer',
  'texture',
  'program',
]
const PRIVATE_NATIVE_TEXT = 'private://driver/C:/secret/thunder.bin'

describe('Thunder Ball WebGL2 engine', () => {
  it('maps the fullscreen triangle over the complete clip space with stable UVs', () => {
    const vertices = [0, 1, 2].map((vertexId) => {
      const position = [(vertexId << 1) & 2, vertexId & 2] as const
      return {
        clip: [position[0] * 2 - 1, position[1] * 2 - 1],
        uv: [position[0], position[1]],
      }
    })

    expect(vertices).toEqual([
      { clip: [-1, -1], uv: [0, 0] },
      { clip: [3, -1], uv: [2, 0] },
      { clip: [-1, 3], uv: [0, 2] },
    ])
    expect(
      [
        [-1, -1],
        [1, -1],
        [-1, 1],
        [1, 1],
      ].map(([clipX, clipY]) => {
        const weightB = (clipX + 1) / 4
        const weightC = (clipY + 1) / 4
        const weightA = 1 - weightB - weightC
        return vertices[0]!.uv.map(
          (_, axis) =>
            vertices[0]!.uv[axis]! * weightA +
            vertices[1]!.uv[axis]! * weightB +
            vertices[2]!.uv[axis]! * weightC
        )
      })
    ).toEqual([
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
    ])
    expect(THUNDER_WEBGL2_FULLSCREEN_VERTEX_SHADER).toContain('vUv = position;')
    expect(THUNDER_WEBGL2_FULLSCREEN_VERTEX_SHADER).not.toContain(
      'vUv = position * 0.5;'
    )
    expect(THUNDER_WEBGL2_FULLSCREEN_VERTEX_SHADER).toContain(
      'gl_Position = vec4(position * 2.0 - 1.0, 0.0, 1.0);'
    )
    expect(THUNDER_WEBGL2_FULLSCREEN_VERTEX_SHADER).not.toContain(
      'gl_Position = vec4(position - 1.0, 0.0, 1.0);'
    )
  })

  it('uses the fixed bounded pass/resource graph and renders supplied ribbons', () => {
    const fake = createFakeThunderGl()
    const engine = new ThunderBallWebGl2Engine({
      gl: fake.gl,
      width: 640,
      height: 360,
    })
    const frame = createValidEngineFrame(7, 0)

    expect(frame.ribbons).toHaveLength(21)
    expect(frame.sources).toHaveLength(21)
    expect(engine.audit()).toMatchObject({
      state: 'ready',
      failure: null,
      failureStage: 'none',
      passGraph: THUNDER_WEBGL2_PASS_GRAPH,
      blurScales: THUNDER_WEBGL2_BLUR_SCALES,
      blurWeights: THUNDER_WEBGL2_BLUR_WEIGHTS,
      resources: { total: THUNDER_WEBGL2_MAX_RESOURCE_COUNT },
    })
    expect(engine.render(frame)).toMatchObject({
      status: 'rendered',
      state: 'ready',
      failureStage: 'none',
    })
    expect(fake.blendEquation).toHaveBeenCalledWith(fake.gl.MAX)
    expect(fake.blendEquation).not.toHaveBeenCalledWith(fake.gl.FUNC_ADD)
    expect(fake.drawArrays).toHaveBeenCalledTimes(frame.ribbons.length + 9)
    expect(fake.blurSteps).toHaveBeenCalledTimes(6)
    expect(
      fake.blurSteps.mock.calls.map(([, stepX, stepY]) => [stepX, stepY])
    ).toEqual([
      [1 / 640, 1 / 360],
      [2 / 640, 2 / 360],
      [4 / 640, 4 / 360],
      [8 / 640, 8 / 360],
      [16 / 640, 16 / 360],
      [32 / 640, 32 / 360],
    ])
    expect(
      fake.uniform1f.mock.calls
        .filter(([location]) => location?.name === 'uStageWeight')
        .map(([, value]) => value)
    ).toEqual(THUNDER_WEBGL2_BLUR_WEIGHTS)
    expect(fake.blitFramebuffer).not.toHaveBeenCalled()
    expect(fake.bindFramebuffer).toHaveBeenLastCalledWith(
      fake.gl.FRAMEBUFFER,
      null
    )
    expect(
      fake.uniform1f.mock.calls.filter(
        ([location, value]) => location?.name === 'uBloomGain' && value === 0
      )
    ).toHaveLength(1)
    const presentationTextures = fake.bindTexture.mock.calls.slice(-2)
    expect(presentationTextures).toHaveLength(2)
    expect(presentationTextures[0]?.[1]).toBeTruthy()
    expect(presentationTextures[1]?.[1]).toBe(presentationTextures[0]?.[1])
    const feedbackUniformIndex = fake.uniform1f.mock.calls.findIndex(
      ([location]) => location?.name === 'uFeedback'
    )
    const presentationUniformIndex = fake.uniform1f.mock.calls.findIndex(
      ([location, value]) => location?.name === 'uBloomGain' && value === 0
    )
    expect(
      fake.uniform1f.mock.invocationCallOrder[feedbackUniformIndex]!
    ).toBeLessThan(
      fake.uniform1f.mock.invocationCallOrder[presentationUniformIndex]!
    )
    expect(
      fake.uniform1f.mock.invocationCallOrder[presentationUniformIndex]!
    ).toBeLessThan(
      fake.drawArrays.mock.invocationCallOrder[
        fake.drawArrays.mock.invocationCallOrder.length - 1
      ]!
    )
    expect(engine.audit().feedbackIndex).toBe(1)
    expect(engine.audit().passGraph).toHaveLength(9)
    expect(engine.audit().resources.total).toBe(
      THUNDER_WEBGL2_MAX_RESOURCE_COUNT
    )
  })

  it('renders an exact recipe frame, a reduced live subset, and an empty zero-temporal frame', () => {
    const fake = createFakeThunderGl()
    const engine = new ThunderBallWebGl2Engine({
      gl: fake.gl,
      width: 640,
      height: 360,
    })
    const seed = 17
    const epochStartMs = 192
    const withinEpochMs = 250
    const topology = createThunderWebGl2Topology({
      seed,
      nowMs: epochStartMs,
    })
    const sameEpoch = createThunderWebGl2Topology({
      seed,
      nowMs: withinEpochMs,
    })
    const config = mapThunderParametersToWebGl2AdapterConfig({ seed })
    const frameFromConnections = (
      connections: typeof topology.connections
    ): ThunderWebGl2EngineFrame =>
      mapThunderWebGl2EngineFrame(
        {
          ribbons: connections.map(({ ribbon }) => ribbon),
          tone: resolveThunderWebGl2Tone(false),
        },
        config
      )
    const liveConnections = Object.freeze(
      topology.connections.filter(
        ({ bornAtMs, lifeMs }) => bornAtMs + lifeMs > withinEpochMs
      )
    )
    const exactFrame = frameFromConnections(topology.connections)
    const reducedFrame = frameFromConnections(liveConnections)
    const emptyFrame = frameFromConnections(Object.freeze([]))

    expect(sameEpoch.epoch).toBeGreaterThan(topology.epoch)
    expect(exactFrame.ribbons).toHaveLength(21)
    expect(reducedFrame.ribbons.length).toBeGreaterThan(0)
    expect(reducedFrame.ribbons.length).toBeLessThan(21)
    expect(reducedFrame.sources).toHaveLength(reducedFrame.ribbons.length)

    expect(engine.render(exactFrame)).toMatchObject({
      status: 'rendered',
      state: 'ready',
      failure: null,
      failureStage: 'none',
    })
    expect(engine.render(reducedFrame)).toMatchObject({
      status: 'rendered',
      state: 'ready',
      failure: null,
      failureStage: 'none',
    })
    expect(engine.render(emptyFrame)).toMatchObject({
      status: 'rendered',
      state: 'ready',
      failure: null,
      failureStage: 'none',
    })
    expect(fake.drawArrays).toHaveBeenCalledTimes(
      exactFrame.ribbons.length + 9 + reducedFrame.ribbons.length + 9 + 9
    )
    expect(engine.audit()).toMatchObject({
      state: 'ready',
      failure: null,
      failureStage: 'none',
    })
  })

  it('presents the temporal target as an exact fullscreen copy without legacy blit', () => {
    const present = (
      raw: readonly [number, number, number, number],
      blurred: readonly [number, number, number, number],
      bloomGain: number
    ) =>
      raw.map((value, index) => value + (blurred[index] ?? 0) * bloomGain) as [
        number,
        number,
        number,
        number,
      ]

    expect(present([0, 0, 0, 0], [0, 0, 0, 0], 0)).toEqual([0, 0, 0, 0])
    expect(present([0.18, 0.42, 0.76, 0.64], [1, 1, 1, 1], 0)).toEqual([
      0.18, 0.42, 0.76, 0.64,
    ])

    const fake = createFakeThunderGl()
    const engine = new ThunderBallWebGl2Engine({
      gl: fake.gl,
      width: 640,
      height: 360,
    })
    fake.armLegacyBlitError()

    expect(engine.render(createValidEngineFrame(7, 0))).toMatchObject({
      status: 'rendered',
      state: 'ready',
    })
    expect(fake.blitFramebuffer).not.toHaveBeenCalled()
    expect(engine.audit()).toMatchObject({
      feedbackIndex: 1,
      resources: { total: THUNDER_WEBGL2_MAX_RESOURCE_COUNT },
    })
    expect(
      fake.uniform1f.mock.calls
        .filter(([location]) => location?.name === 'uStraightAlphaPresentation')
        .map(([, value]) => value)
    ).toEqual([0, 1])
  })

  it('unassociates presentation RGB exactly once for the straight-alpha browser boundary', () => {
    const transparent = resolveThunderWebGl2StraightPresentationOracle({
      red: 0,
      green: 0,
      blue: 0,
      alpha: 0,
    })
    const internal = {
      red: 0.03,
      green: 0.06,
      blue: 0.09,
      alpha: 0.12,
    }
    const presented = resolveThunderWebGl2StraightPresentationOracle(internal)

    expect(transparent).toEqual({ red: 0, green: 0, blue: 0, alpha: 0 })
    expect(presented).toEqual({
      red: 0.25,
      green: 0.5,
      blue: 0.75,
      alpha: 0.12,
    })
    expect(
      sourceOver(
        [presented.red, presented.green, presented.blue, presented.alpha],
        [0, 1, 0]
      )
    ).toEqual([internal.red, internal.green + 0.88, internal.blue])
    const highEnergy = {
      red: 0.18,
      green: 0.42,
      blue: 0.76,
      alpha: 0.64,
    }
    const highEnergyPresented =
      resolveThunderWebGl2StraightPresentationOracle(highEnergy)
    expect(highEnergyPresented.alpha).toBe(0.76)
    expect(
      sourceOver(
        [
          highEnergyPresented.red,
          highEnergyPresented.green,
          highEnergyPresented.blue,
          highEnergyPresented.alpha,
        ],
        [0, 0, 0]
      )
    ).toEqual([highEnergy.red, highEnergy.green, highEnergy.blue])
    expect(THUNDER_WEBGL2_BLOOM_FRAGMENT_SHADER).toContain(
      'uStraightAlphaPresentation'
    )
    expect(THUNDER_WEBGL2_BLOOM_FRAGMENT_SHADER).toContain(
      'color / outputAlpha'
    )
  })

  it('advances temporal history only after direct presentation succeeds', () => {
    const fake = createFakeThunderGl()
    const engine = new ThunderBallWebGl2Engine({
      gl: fake.gl,
      width: 640,
      height: 360,
    })
    fake.armGlErrorAtCheck(11)

    expect(engine.render(createValidEngineFrame(7, 0))).toEqual({
      status: 'blocked',
      state: 'quarantined',
      failure: 'draw-failed',
      failureStage: 'presentation',
    })
    expect(fake.blitFramebuffer).not.toHaveBeenCalled()
    expect(engine.audit()).toMatchObject({
      feedbackIndex: 0,
      failureStage: 'presentation',
      resources: { total: 0 },
    })
    const drawCount = fake.drawArrays.mock.calls.length
    expect(engine.render(createValidEngineFrame(7, 1))).toMatchObject({
      status: 'blocked',
      state: 'quarantined',
    })
    expect(fake.drawArrays).toHaveBeenCalledTimes(drawCount)
  })

  it.each([
    ['preflight', 1],
    ['raw', 2],
    ['blur', 3],
    ['blur', 4],
    ['blur', 5],
    ['blur', 6],
    ['blur', 7],
    ['blur', 8],
    ['bloom', 9],
    ['temporal', 10],
    ['presentation', 11],
  ] as const)(
    'reports only the fixed %s failure stage and blocks all later GPU work',
    (failureStage, check) => {
      const fake = createFakeThunderGl()
      const engine = new ThunderBallWebGl2Engine({
        gl: fake.gl,
        width: 640,
        height: 360,
      })
      fake.armGlErrorAtCheck(check)

      const failed = engine.render(createValidEngineFrame(7, 0))
      expect(failed).toEqual({
        status: 'blocked',
        state: 'quarantined',
        failure: 'draw-failed',
        failureStage,
      })
      expect(engine.audit()).toMatchObject({
        feedbackIndex: 0,
        failureStage,
        resources: { total: 0 },
      })
      expect(JSON.stringify(failed)).not.toContain(PRIVATE_NATIVE_TEXT)

      const drawCount = fake.drawArrays.mock.calls.length
      const uploadCount = fake.bufferData.mock.calls.length
      expect(engine.render(createValidEngineFrame(7, 1))).toMatchObject({
        status: 'blocked',
        state: 'quarantined',
        failureStage,
      })
      expect(fake.drawArrays).toHaveBeenCalledTimes(drawCount)
      expect(fake.bufferData).toHaveBeenCalledTimes(uploadCount)
    }
  )

  it('reports context loss as one fixed stage without later GPU work', () => {
    const fake = createFakeThunderGl()
    const engine = new ThunderBallWebGl2Engine({
      gl: fake.gl,
      width: 640,
      height: 360,
    })
    fake.armContextLossAtCheck(1)

    expect(engine.render(createValidEngineFrame(7, 0))).toEqual({
      status: 'blocked',
      state: 'quarantined',
      failure: 'draw-failed',
      failureStage: 'context-lost',
    })
    expect(fake.bufferData).toHaveBeenCalledTimes(0)
    expect(fake.drawArrays).toHaveBeenCalledTimes(0)
    expect(engine.audit()).toMatchObject({
      feedbackIndex: 0,
      failureStage: 'context-lost',
    })
  })

  it('keeps the raw mesh white so Stage5.3 color is applied only after blur', () => {
    const base = {
      sourceEnergy: 0.5788,
      coreWidth: 0.08,
      haloWidth: 0.46,
      coreLuminance: 2.4,
      haloLuminance: 0.82,
    }
    const black = resolveThunderWebGl2RawOracle({
      ...base,
      along: 0,
      side: 0,
      sourceEnergy: 0,
    })
    const sourceCore = resolveThunderWebGl2RawOracle({
      ...base,
      along: 0,
      side: 0,
    })
    const branchCore = resolveThunderWebGl2RawOracle({
      ...base,
      along: 0.55,
      side: 0,
    })
    const branchHalo = resolveThunderWebGl2RawOracle({
      ...base,
      along: 0.55,
      side: 0.28,
    })

    expect(black).toEqual({ red: 0, green: 0, blue: 0, alpha: 0 })
    expect(sourceCore).toEqual({
      red: base.sourceEnergy,
      green: base.sourceEnergy,
      blue: base.sourceEnergy,
      alpha: base.sourceEnergy,
    })
    expect(branchCore).toEqual(sourceCore)
    expect(branchHalo).toEqual(sourceCore)
    const coreOverGreen = sourceOver([0.92, 0.96, 1, 0.84], [0, 1, 0])
    const haloOverGreen = sourceOver([0.04, 0.22, 0.38, 0.12], [0, 1, 0])
    expect(distance(coreOverGreen, [0.92, 0.96, 1])).toBeLessThan(
      distance(coreOverGreen, [0, 1, 0])
    )
    expect(distance(haloOverGreen, [0, 1, 0])).toBeLessThan(
      distance(haloOverGreen, [0.04, 0.22, 0.38])
    )
    expect(THUNDER_WEBGL2_RIBBON_FRAGMENT_SHADER).toContain(
      'outColor = vec4(vec3(sourceEnergy), sourceEnergy)'
    )
  })

  it('uses the isotropic 003 nine-tap blur and all six recipe-ordered scales', () => {
    const center = 16
    const axes = [8, 4, 2, 6]
    const diagonals = [1, 3, 5, 7]
    const rotatedAxes = [4, 2, 6, 8]
    const reflectedDiagonals = [3, 1, 7, 5]

    expect(resolveThunderWebGl2BlurOracle(center, axes, diagonals)).toBe(7.5)
    expect(
      resolveThunderWebGl2BlurOracle(center, rotatedAxes, reflectedDiagonals)
    ).toBe(7.5)
    expect(THUNDER_WEBGL2_BLUR_SCALES).toEqual([1, 2, 4, 8, 16, 32])
    expect(THUNDER_WEBGL2_BLUR_WEIGHTS).toEqual([
      0.15, 0.35, 0.7, 1.1, 1.6, 2.1,
    ])
    expect(THUNDER_WEBGL2_BLUR_FRAGMENT_SHADER).toContain('blurred /= 16.0')
    expect(THUNDER_WEBGL2_BLUR_FRAGMENT_SHADER).toContain(
      'clamp(uStageWeight, 0.0, 2.1)'
    )
  })

  it('retains six weighted blur energies and maps weak core energy without full-frame washout', () => {
    const off = resolveThunderWebGl2CompositeOracle({
      rawEnergy: 0,
      blurEnergies: [0, 0, 0, 0, 0, 0],
      bloomGain: 0,
      historyEnergy: 0,
      feedback: 0,
      exposure: 1,
      gamma: 1,
    })
    const weak = resolveThunderWebGl2CompositeOracle({
      rawEnergy: 0.42,
      blurEnergies: [0.38, 0.31, 0.24, 0.18, 0.12, 0.08],
      bloomGain: 0.4,
      historyEnergy: 0.1,
      feedback: 0.14,
      exposure: 1.1,
      gamma: 1,
    })
    const strong = resolveThunderWebGl2CompositeOracle({
      rawEnergy: 0.86,
      blurEnergies: [0.72, 0.6, 0.46, 0.32, 0.2, 0.12],
      bloomGain: 0.78,
      historyEnergy: 0.2,
      feedback: 0.14,
      exposure: 1.28,
      gamma: 1,
    })

    expect(off).toEqual({ alpha: 0, bloomEnergy: 0, mappedEnergy: 0 })
    expect(weak.bloomEnergy).toBeGreaterThan(0)
    expect(weak.mappedEnergy).toBeGreaterThan(0)
    expect(weak.mappedEnergy).toBeLessThan(strong.mappedEnergy)
    expect(strong.alpha).toBeGreaterThan(weak.alpha)
    expect(strong.alpha).toBeLessThanOrEqual(1)
    const contributions = THUNDER_WEBGL2_BLUR_WEIGHTS.map((_, index) =>
      resolveThunderWebGl2CompositeOracle({
        rawEnergy: 0,
        blurEnergies: THUNDER_WEBGL2_BLUR_WEIGHTS.map((__, blurIndex) =>
          blurIndex === index ? 0.2 : 0
        ),
        bloomGain: 1,
        historyEnergy: 0,
        feedback: 0,
        exposure: 1,
        gamma: 1,
      })
    )
    expect(contributions.every(({ bloomEnergy }) => bloomEnergy > 0)).toBe(true)
    expect(contributions.map(({ bloomEnergy }) => bloomEnergy)).toEqual(
      [...contributions]
        .map(({ bloomEnergy }) => bloomEnergy)
        .sort((left, right) => left - right)
    )
    expect(THUNDER_WEBGL2_TEMPORAL_FRAGMENT_SHADER).toContain(
      'mix(current, history, clamp(uFeedback, 0.0, 0.9999))'
    )
    expect(THUNDER_WEBGL2_TEMPORAL_FRAGMENT_SHADER).not.toContain(
      'max(current, history'
    )
  })

  it('recreates size resources without growing the live resource ceiling', () => {
    const fake = createFakeThunderGl()
    const engine = new ThunderBallWebGl2Engine({
      gl: fake.gl,
      width: 320,
      height: 180,
    })

    expect(engine.resize(1280, 720)).toMatchObject({
      status: 'resized',
      state: 'ready',
    })
    expect(engine.audit()).toMatchObject({
      width: 1280,
      height: 720,
      resizeCount: 1,
      resources: { total: THUNDER_WEBGL2_MAX_RESOURCE_COUNT },
    })
    expect(engine.resize(1280, 720)).toMatchObject({ status: 'resized' })
    expect(engine.audit().resizeCount).toBe(1)
  })

  it('fails closed on context, extension, compile, allocation and resize failures', () => {
    const missingContext = new ThunderBallWebGl2Engine({
      gl: null,
      width: 1,
      height: 1,
    })
    expect(missingContext.audit()).toMatchObject({
      state: 'quarantined',
      failure: 'context-unavailable',
      resources: { total: 0 },
    })

    const missingExtension = createFakeThunderGl({
      extensionAvailable: false,
    })
    const capability = new ThunderBallWebGl2Engine({
      gl: missingExtension.gl,
      width: 1,
      height: 1,
    })
    expect(capability.audit()).toMatchObject({
      state: 'quarantined',
      failure: 'capability-unavailable',
    })

    const compileFake = createFakeThunderGl({ failCompile: true })
    const compile = new ThunderBallWebGl2Engine({
      gl: compileFake.gl,
      width: 1,
      height: 1,
    })
    expect(compile.audit()).toMatchObject({
      state: 'quarantined',
      failure: 'compile-failed',
      resources: { total: 0 },
      cleanupAttemptedKinds: RESOURCE_KINDS,
    })

    const allocationFake = createFakeThunderGl({ failTextureAllocation: true })
    const allocation = new ThunderBallWebGl2Engine({
      gl: allocationFake.gl,
      width: 1,
      height: 1,
    })
    expect(allocation.audit()).toMatchObject({
      state: 'quarantined',
      failure: 'allocation-failed',
      resources: { total: 0 },
    })

    const resizeFake = createFakeThunderGl()
    const resize = new ThunderBallWebGl2Engine({
      gl: resizeFake.gl,
      width: 1,
      height: 1,
    })
    resizeFake.armResizeFailure()
    expect(resize.resize(2, 2)).toMatchObject({
      status: 'blocked',
      state: 'quarantined',
      failure: 'resize-failed',
    })
    expect(resize.audit().resources.total).toBe(0)
  })

  it('quarantines draw failure, releases every resource kind, and blocks later draw', () => {
    const fake = createFakeThunderGl()
    const engine = new ThunderBallWebGl2Engine({
      gl: fake.gl,
      width: 10,
      height: 10,
    })
    const frame = createValidEngineFrame(1, 0)
    fake.armDrawFailure()
    const failed = engine.render(frame)

    expect(failed).toEqual({
      status: 'blocked',
      state: 'quarantined',
      failure: 'draw-failed',
      failureStage: 'raw',
    })
    const drawCount = fake.drawArrays.mock.calls.length
    expect(
      engine.render({
        ribbons: [],
        tone: resolveThunderWebGl2Tone(false),
      })
    ).toMatchObject({ status: 'blocked' })
    expect(fake.drawArrays).toHaveBeenCalledTimes(drawCount)
    expectEveryKindAttempted(fake)
    expect(engine.audit().resources.total).toBe(0)
  })

  it.each([
    [
      'ribbon over-count',
      (
        frame: Readonly<ThunderWebGl2EngineFrame>
      ): ThunderWebGl2EngineFrame => ({
        ...frame,
        ribbons: Object.freeze([
          ...frame.ribbons,
          frame.ribbons[0] as ThunderWebGl2EngineFrame['ribbons'][number],
        ]),
      }),
    ],
    [
      'one overlong ribbon',
      (
        frame: Readonly<ThunderWebGl2EngineFrame>
      ): ThunderWebGl2EngineFrame => ({
        ...frame,
        ribbons: Object.freeze(
          frame.ribbons.map((ribbon, index) =>
            index === 0
              ? Object.freeze([
                  ...ribbon,
                  ribbon[
                    ribbon.length - 1
                  ] as ThunderWebGl2EngineFrame['ribbons'][number][number],
                ])
              : ribbon
          )
        ),
      }),
    ],
    [
      'one nonfinite sample',
      (
        frame: Readonly<ThunderWebGl2EngineFrame>
      ): ThunderWebGl2EngineFrame => ({
        ...frame,
        ribbons: Object.freeze(
          frame.ribbons.map((ribbon, ribbonIndex) =>
            ribbonIndex === 0
              ? Object.freeze(
                  ribbon.map((sample, sampleIndex) =>
                    sampleIndex === 0
                      ? Object.freeze({ ...sample, centerX: Number.NaN })
                      : sample
                  )
                )
              : ribbon
          )
        ),
      }),
    ],
    [
      'source/ribbon count mismatch under the cap',
      (
        frame: Readonly<ThunderWebGl2EngineFrame>
      ): ThunderWebGl2EngineFrame => ({
        ...frame,
        sources: Object.freeze((frame.sources ?? []).slice(0, -1)),
      }),
    ],
    [
      'duplicate source index',
      (
        frame: Readonly<ThunderWebGl2EngineFrame>
      ): ThunderWebGl2EngineFrame => ({
        ...frame,
        sources: Object.freeze(
          (frame.sources ?? []).map((source, index, sources) =>
            index === 1
              ? Object.freeze({
                  ...source,
                  index: sources[0]?.index ?? source.index,
                })
              : source
          )
        ),
      }),
    ],
    [
      'one nonfinite source',
      (
        frame: Readonly<ThunderWebGl2EngineFrame>
      ): ThunderWebGl2EngineFrame => ({
        ...frame,
        sources: Object.freeze(
          (frame.sources ?? []).map((source, index) =>
            index === 0
              ? Object.freeze({ ...source, x: Number.POSITIVE_INFINITY })
              : source
          )
        ),
      }),
    ],
    [
      'mismatched pass graph',
      (
        frame: Readonly<ThunderWebGl2EngineFrame>
      ): ThunderWebGl2EngineFrame => ({
        ...frame,
        passGraph: Object.freeze(THUNDER_WEBGL2_PASS_GRAPH.slice(0, -1)),
      }),
    ],
  ] as const)(
    'rejects %s before GL work and latches a fixed non-echoing quarantine',
    (_label, mutate) => {
      const fake = createFakeThunderGl()
      const engine = new ThunderBallWebGl2Engine({
        gl: fake.gl,
        width: 640,
        height: 360,
      })
      const validFrame = createValidEngineFrame(17, 0)
      const invalidFrame = mutate(validFrame)
      fake.armDrawFailure()

      expect(engine.render(invalidFrame)).toEqual({
        status: 'blocked',
        state: 'quarantined',
        failure: 'frame-invalid',
        failureStage: 'preflight',
      })
      expect(fake.drawArrays).toHaveBeenCalledTimes(0)
      expect(fake.bufferData).toHaveBeenCalledTimes(0)
      expect(JSON.stringify(engine.audit())).not.toContain(PRIVATE_NATIVE_TEXT)

      expect(engine.render(validFrame)).toEqual({
        status: 'blocked',
        state: 'quarantined',
        failure: 'frame-invalid',
        failureStage: 'preflight',
      })
      expect(fake.drawArrays).toHaveBeenCalledTimes(0)
      expect(fake.bufferData).toHaveBeenCalledTimes(0)
      expect(engine.dispose()).toMatchObject({
        status: 'disposed',
        state: 'disposed',
        failure: null,
      })
    }
  )

  it('retains failed shader cleanup, attempts later kinds, and retries to convergence', () => {
    const fake = createFakeThunderGl({ failShaderDeleteCount: 3 })
    const engine = new ThunderBallWebGl2Engine({
      gl: fake.gl,
      width: 10,
      height: 10,
    })

    expect(engine.audit()).toMatchObject({
      state: 'quarantined',
      failure: 'cleanup-incomplete',
      resources: { shader: 1, total: 1 },
      cleanupAttemptedKinds: RESOURCE_KINDS,
    })
    expect(JSON.stringify(engine.audit())).not.toContain(PRIVATE_NATIVE_TEXT)
    expect(fake.deleteAttempts.buffer.length).toBeGreaterThan(0)
    expect(fake.deleteAttempts.vertexArray.length).toBeGreaterThan(0)
    const drawCount = fake.drawArrays.mock.calls.length
    expect(
      engine.render({ ribbons: [], tone: resolveThunderWebGl2Tone(false) })
    ).toEqual({
      status: 'cleanup-incomplete',
      state: 'quarantined',
      failure: 'cleanup-incomplete',
      failureStage: 'none',
    })
    expect(fake.drawArrays).toHaveBeenCalledTimes(drawCount)

    expect(engine.dispose()).toEqual({
      status: 'disposed',
      state: 'disposed',
      failure: null,
      failureStage: 'none',
    })
    expect(fake.deleteAttempts.shader).toHaveLength(5)
    expect(engine.audit().resources).toMatchObject({ shader: 0, total: 0 })
  })

  it('retains a failed delete identity for retry without echoing private text', () => {
    const fake = createFakeThunderGl()
    const engine = new ThunderBallWebGl2Engine({
      gl: fake.gl,
      width: 10,
      height: 10,
    })
    fake.armDeleteFailure('buffer')

    const failed = engine.dispose()
    expect(failed).toEqual({
      status: 'cleanup-incomplete',
      state: 'quarantined',
      failure: 'cleanup-incomplete',
      failureStage: 'none',
    })
    expect(JSON.stringify(failed)).not.toContain(PRIVATE_NATIVE_TEXT)
    expect(engine.audit().resources).toMatchObject({ buffer: 1, total: 1 })
    expectEveryKindAttempted(fake)
    const draws = fake.drawArrays.mock.calls.length
    expect(
      engine.render({ ribbons: [], tone: resolveThunderWebGl2Tone(false) })
    ).toMatchObject({ status: 'cleanup-incomplete' })
    expect(fake.drawArrays).toHaveBeenCalledTimes(draws)

    expect(engine.dispose()).toMatchObject({
      status: 'disposed',
      state: 'disposed',
      failure: null,
    })
    expect(engine.dispose()).toMatchObject({ status: 'disposed' })
    expect(fake.deleteAttempts.buffer).toHaveLength(2)
    expect(engine.audit().resources.total).toBe(0)
  })
})

function createValidEngineFrame(
  seed: number,
  nowMs: number
): ThunderWebGl2EngineFrame {
  const topology = createThunderWebGl2Topology({ seed, nowMs })
  return mapThunderWebGl2EngineFrame(
    {
      ribbons: topology.connections.map(({ ribbon }) => ribbon),
      tone: resolveThunderWebGl2Tone(false),
    },
    mapThunderParametersToWebGl2AdapterConfig({ seed })
  )
}

function resourceRecord(): Record<ThunderWebGl2ResourceKind, FakeResource[]> {
  return {
    shader: [],
    program: [],
    buffer: [],
    vertexArray: [],
    texture: [],
    framebuffer: [],
  }
}

function createFakeThunderGl(
  options: Readonly<{
    extensionAvailable?: boolean
    failCompile?: boolean
    failShaderDeleteCount?: number
    failTextureAllocation?: boolean
  }> = {}
): FakeThunderGl {
  const allocated = resourceRecord()
  const deleteAttempts = resourceRecord()
  const successfulDeletes = resourceRecord()
  let nextId = 1
  let compileFailurePending = options.failCompile === true
  let textureAllocationFailurePending = options.failTextureAllocation === true
  let resizeFailurePending = false
  let drawFailurePending = false
  let boundaryCheckCount = 0
  let contextLossAtCheck: number | null = null
  let glErrorAtCheck: number | null = null
  let glErrorPending = false
  let legacyBlitErrorArmed = false
  const deleteFailureBudget: Partial<
    Record<ThunderWebGl2ResourceKind, number>
  > = {
    shader: options.failShaderDeleteCount ?? 0,
  }

  const allocate = (kind: ThunderWebGl2ResourceKind): FakeResource | null => {
    if (kind === 'texture' && textureAllocationFailurePending) {
      textureAllocationFailurePending = false
      return null
    }
    const value = { id: nextId++, kind }
    allocated[kind].push(value)
    return value
  }
  const deleteNative = (kind: ThunderWebGl2ResourceKind) =>
    jest.fn((value: FakeResource) => {
      deleteAttempts[kind].push(value)
      const remainingFailures = deleteFailureBudget[kind] ?? 0
      if (remainingFailures > 0) {
        deleteFailureBudget[kind] = remainingFailures - 1
        throw new Error(PRIVATE_NATIVE_TEXT)
      }
      successfulDeletes[kind].push(value)
    })
  const constants = {
    ARRAY_BUFFER: 1,
    BLEND: 2,
    CLAMP_TO_EDGE: 3,
    COLOR_ATTACHMENT0: 4,
    COLOR_BUFFER_BIT: 5,
    COMPILE_STATUS: 6,
    DRAW_FRAMEBUFFER: 7,
    DYNAMIC_DRAW: 8,
    FLOAT: 9,
    FRAGMENT_SHADER: 10,
    FRAMEBUFFER: 11,
    FRAMEBUFFER_COMPLETE: 12,
    FUNC_ADD: 13,
    HALF_FLOAT: 14,
    LINEAR: 15,
    LINK_STATUS: 16,
    MAX_TEXTURE_IMAGE_UNITS: 17,
    MAX_TEXTURE_SIZE: 18,
    MAX_VERTEX_ATTRIBS: 19,
    NO_ERROR: 0,
    ONE: 20,
    READ_FRAMEBUFFER: 21,
    RGBA: 22,
    RGBA16F: 23,
    TEXTURE0: 30,
    TEXTURE_2D: 31,
    TEXTURE_MAG_FILTER: 32,
    TEXTURE_MIN_FILTER: 33,
    TEXTURE_WRAP_S: 34,
    TEXTURE_WRAP_T: 35,
    TRIANGLES: 36,
    TRIANGLE_STRIP: 37,
    VERTEX_SHADER: 38,
    MAX: 39,
  }
  const drawArrays = jest.fn(() => {
    if (drawFailurePending) {
      drawFailurePending = false
      throw new Error(PRIVATE_NATIVE_TEXT)
    }
  })
  const blitFramebuffer = jest.fn(() => {
    if (legacyBlitErrorArmed) glErrorPending = true
  })
  const blurSteps = jest.fn()
  const bufferData = jest.fn()
  const bindFramebuffer = jest.fn()
  const bindTexture = jest.fn()
  const uniform1f = jest.fn()
  const blendEquation = jest.fn()
  const gl = {
    ...constants,
    activeTexture: jest.fn(),
    attachShader: jest.fn(),
    bindBuffer: jest.fn(),
    bindFramebuffer,
    bindTexture,
    bindVertexArray: jest.fn(),
    blendEquation,
    blendFunc: jest.fn(),
    blitFramebuffer,
    bufferData,
    checkFramebufferStatus: jest.fn(() => constants.FRAMEBUFFER_COMPLETE),
    clear: jest.fn(),
    clearColor: jest.fn(),
    compileShader: jest.fn(),
    createBuffer: jest.fn(() => allocate('buffer')),
    createFramebuffer: jest.fn(() => allocate('framebuffer')),
    createProgram: jest.fn(() => allocate('program')),
    createShader: jest.fn(() => allocate('shader')),
    createTexture: jest.fn(() => allocate('texture')),
    createVertexArray: jest.fn(() => allocate('vertexArray')),
    deleteBuffer: deleteNative('buffer'),
    deleteFramebuffer: deleteNative('framebuffer'),
    deleteProgram: deleteNative('program'),
    deleteShader: deleteNative('shader'),
    deleteTexture: deleteNative('texture'),
    deleteVertexArray: deleteNative('vertexArray'),
    disable: jest.fn(),
    drawArrays,
    enable: jest.fn(),
    enableVertexAttribArray: jest.fn(),
    framebufferTexture2D: jest.fn(),
    getError: jest.fn(() => {
      if (glErrorPending) {
        glErrorPending = false
        return 40
      }
      return boundaryCheckCount === glErrorAtCheck ? 40 : constants.NO_ERROR
    }),
    getExtension: jest.fn(() =>
      options.extensionAvailable === false ? null : {}
    ),
    getParameter: jest.fn((parameter: number) => {
      if (parameter === constants.MAX_TEXTURE_SIZE) return 8192
      if (parameter === constants.MAX_TEXTURE_IMAGE_UNITS) return 8
      if (parameter === constants.MAX_VERTEX_ATTRIBS) return 8
      return 0
    }),
    getProgramParameter: jest.fn(() => true),
    getShaderParameter: jest.fn(() => {
      if (!compileFailurePending) return true
      compileFailurePending = false
      return false
    }),
    isContextLost: jest.fn(() => {
      boundaryCheckCount += 1
      return boundaryCheckCount === contextLossAtCheck
    }),
    getUniformLocation: jest.fn((program, name) => ({ program, name })),
    linkProgram: jest.fn(),
    shaderSource: jest.fn(),
    texImage2D: jest.fn(() => {
      if (resizeFailurePending) {
        resizeFailurePending = false
        throw new Error(PRIVATE_NATIVE_TEXT)
      }
    }),
    texParameteri: jest.fn(),
    uniform1f,
    uniform1i: jest.fn(),
    uniform2f: blurSteps,
    uniform3f: jest.fn(),
    uniform4f: jest.fn(),
    useProgram: jest.fn(),
    vertexAttribPointer: jest.fn(),
    viewport: jest.fn(),
  } as unknown as WebGL2RenderingContext

  return {
    allocated,
    armContextLossAtCheck(check) {
      contextLossAtCheck = check
    },
    armDeleteFailure(kind) {
      deleteFailureBudget[kind] = 1
    },
    armDrawFailure() {
      drawFailurePending = true
    },
    armGlErrorAtCheck(check) {
      glErrorAtCheck = check
    },
    armLegacyBlitError() {
      legacyBlitErrorArmed = true
    },
    armResizeFailure() {
      resizeFailurePending = true
    },
    bindFramebuffer,
    bindTexture,
    blitFramebuffer,
    blendEquation,
    blurSteps,
    bufferData,
    deleteAttempts,
    drawArrays,
    gl,
    successfulDeletes,
    uniform1f,
  }
}

function expectEveryKindAttempted(fake: FakeThunderGl): void {
  for (const kind of RESOURCE_KINDS) {
    expect(fake.deleteAttempts[kind].length).toBeGreaterThan(0)
  }
}

function sourceOver(
  source: readonly [number, number, number, number],
  destination: readonly [number, number, number]
): readonly [number, number, number] {
  const alpha = source[3]
  return [
    source[0] * alpha + destination[0] * (1 - alpha),
    source[1] * alpha + destination[1] * (1 - alpha),
    source[2] * alpha + destination[2] * (1 - alpha),
  ]
}

function distance(
  left: readonly [number, number, number],
  right: readonly [number, number, number]
): number {
  return Math.hypot(left[0] - right[0], left[1] - right[1], left[2] - right[2])
}
