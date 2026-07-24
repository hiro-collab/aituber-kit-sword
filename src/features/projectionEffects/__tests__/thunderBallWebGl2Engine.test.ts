import {
  THUNDER_WEBGL2_MAX_RESOURCE_COUNT,
  THUNDER_WEBGL2_PASS_GRAPH,
  type ThunderWebGl2EngineFrame,
  type ThunderWebGl2ResourceKind,
} from '../plugins/thunderBall/webgl2/contracts'
import { ThunderBallWebGl2Engine } from '../plugins/thunderBall/webgl2/engine'
import { THUNDER_WEBGL2_FULLSCREEN_VERTEX_SHADER } from '../plugins/thunderBall/webgl2/shaders'
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
  armDeleteFailure(kind: ThunderWebGl2ResourceKind): void
  armDrawFailure(): void
  armResizeFailure(): void
  blitFramebuffer: jest.Mock
  blurSteps: jest.Mock
  bufferData: jest.Mock
  deleteAttempts: Record<ThunderWebGl2ResourceKind, FakeResource[]>
  drawArrays: jest.Mock
  gl: WebGL2RenderingContext
  successfulDeletes: Record<ThunderWebGl2ResourceKind, FakeResource[]>
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
    const topology = createThunderWebGl2Topology({ seed: 7, nowMs: 0 })

    expect(engine.audit()).toMatchObject({
      state: 'ready',
      failure: null,
      passGraph: THUNDER_WEBGL2_PASS_GRAPH,
      resources: { total: THUNDER_WEBGL2_MAX_RESOURCE_COUNT },
    })
    expect(
      engine.render({
        ribbons: topology.connections.map(({ ribbon }) => ribbon),
        tone: resolveThunderWebGl2Tone(false),
      })
    ).toMatchObject({ status: 'rendered', state: 'ready' })
    expect(fake.drawArrays).toHaveBeenCalledTimes(
      topology.connections.length + 8
    )
    expect(fake.blurSteps).toHaveBeenCalledTimes(6)
    expect(
      fake.blurSteps.mock.calls.map(([, stepX, stepY]) => [stepX, stepY])
    ).toEqual([
      [1 / 640, 0],
      [0, 1 / 360],
      [2 / 640, 0],
      [0, 2 / 360],
      [4 / 640, 0],
      [0, 4 / 360],
    ])
    expect(fake.blitFramebuffer).toHaveBeenCalledTimes(1)
    expect(engine.audit().passGraph).toHaveLength(9)
    expect(engine.audit().resources.total).toBe(
      THUNDER_WEBGL2_MAX_RESOURCE_COUNT
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
    const topology = createThunderWebGl2Topology({ seed: 1, nowMs: 0 })
    fake.armDrawFailure()
    const failed = engine.render({
      ribbons: topology.connections.map(({ ribbon }) => ribbon),
      tone: resolveThunderWebGl2Tone(false),
    })

    expect(failed).toEqual({
      status: 'blocked',
      state: 'quarantined',
      failure: 'draw-failed',
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
  ] as const)(
    'rejects %s before GL work and latches a fixed non-echoing quarantine',
    (_label, mutate) => {
      const fake = createFakeThunderGl()
      const engine = new ThunderBallWebGl2Engine({
        gl: fake.gl,
        width: 640,
        height: 360,
      })
      const topology = createThunderWebGl2Topology({ seed: 17, nowMs: 0 })
      const validFrame: ThunderWebGl2EngineFrame = {
        ribbons: topology.connections.map(({ ribbon }) => ribbon),
        tone: resolveThunderWebGl2Tone(false),
      }
      const invalidFrame = mutate(validFrame)
      fake.armDrawFailure()

      expect(engine.render(invalidFrame)).toEqual({
        status: 'blocked',
        state: 'quarantined',
        failure: 'frame-invalid',
      })
      expect(fake.drawArrays).toHaveBeenCalledTimes(0)
      expect(fake.bufferData).toHaveBeenCalledTimes(0)
      expect(JSON.stringify(engine.audit())).not.toContain(PRIVATE_NATIVE_TEXT)

      expect(engine.render(validFrame)).toEqual({
        status: 'blocked',
        state: 'quarantined',
        failure: 'frame-invalid',
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
    })
    expect(fake.drawArrays).toHaveBeenCalledTimes(drawCount)

    expect(engine.dispose()).toEqual({
      status: 'disposed',
      state: 'disposed',
      failure: null,
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
  }
  const drawArrays = jest.fn(() => {
    if (drawFailurePending) {
      drawFailurePending = false
      throw new Error(PRIVATE_NATIVE_TEXT)
    }
  })
  const blitFramebuffer = jest.fn()
  const blurSteps = jest.fn()
  const bufferData = jest.fn()
  const gl = {
    ...constants,
    activeTexture: jest.fn(),
    attachShader: jest.fn(),
    bindBuffer: jest.fn(),
    bindFramebuffer: jest.fn(),
    bindTexture: jest.fn(),
    bindVertexArray: jest.fn(),
    blendEquation: jest.fn(),
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
    getError: jest.fn(() => constants.NO_ERROR),
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
    getUniformLocation: jest.fn(() => ({})),
    linkProgram: jest.fn(),
    shaderSource: jest.fn(),
    texImage2D: jest.fn(() => {
      if (resizeFailurePending) {
        resizeFailurePending = false
        throw new Error(PRIVATE_NATIVE_TEXT)
      }
    }),
    texParameteri: jest.fn(),
    uniform1f: jest.fn(),
    uniform1i: jest.fn(),
    uniform2f: blurSteps,
    uniform4f: jest.fn(),
    useProgram: jest.fn(),
    vertexAttribPointer: jest.fn(),
    viewport: jest.fn(),
  } as unknown as WebGL2RenderingContext

  return {
    allocated,
    armDeleteFailure(kind) {
      deleteFailureBudget[kind] = 1
    },
    armDrawFailure() {
      drawFailurePending = true
    },
    armResizeFailure() {
      resizeFailurePending = true
    },
    blitFramebuffer,
    blurSteps,
    bufferData,
    deleteAttempts,
    drawArrays,
    gl,
    successfulDeletes,
  }
}

function expectEveryKindAttempted(fake: FakeThunderGl): void {
  for (const kind of RESOURCE_KINDS) {
    expect(fake.deleteAttempts[kind].length).toBeGreaterThan(0)
  }
}
