import {
  FIRE_P027_DEFAULT_CONTROLS,
  FireP027CapabilityError,
} from '../plugins/fire/p027/contracts'
import {
  FireP027CleanupError,
  FireP027MotionError,
  FireP027WebGlEngine,
  generateFireP027FallbackOrigins,
} from '../plugins/fire/p027/webglEngine'

type ResourceKind =
  | 'buffer'
  | 'framebuffer'
  | 'program'
  | 'texture'
  | 'vertexArray'

interface FakeResource {
  id: number
  kind: ResourceKind
}

interface FakeP027WebGl2 {
  allocated: Record<ResourceKind, FakeResource[]>
  armDeleteFailure(kind: ResourceKind): void
  blendEquation: jest.Mock
  blendFunc: jest.Mock
  canvas: HTMLCanvasElement
  deleteAttempts: Record<ResourceKind, FakeResource[]>
  drawCalls: jest.Mock
  successfulDeletes: Record<ResourceKind, FakeResource[]>
  uniform4f: jest.Mock
}

const RESOURCE_KINDS: readonly ResourceKind[] = [
  'buffer',
  'vertexArray',
  'framebuffer',
  'texture',
  'program',
]

const PRIVATE_NATIVE_DELETE_TEXT = 'private native driver delete detail'
const CSS_FOOTPRINT_CASES = [
  [640, 360, 0.1542, 0.3070293333333333],
  [1280, 720, 0.0771, 0.15351466666666666],
  [1920, 1080, 0.0514, 0.1023431111111111],
].flatMap(([width, height, clipWidth, clipHeight]) =>
  [1, 2].flatMap((dpr) =>
    [0.25, 0.75, 1].map(
      (resolutionScale) =>
        [width, height, dpr, resolutionScale, clipWidth, clipHeight] as const
    )
  )
)

function resourceRecord(): Record<ResourceKind, FakeResource[]> {
  return {
    buffer: [],
    framebuffer: [],
    program: [],
    texture: [],
    vertexArray: [],
  }
}

function createFakeP027WebGl2(
  options: Readonly<{
    backingHeight?: number
    backingWidth?: number
    clientHeight?: number
    clientWidth?: number
    failDuringInitialization?: boolean
    failFirstDeleteKind?: ResourceKind
  }> = {}
): FakeP027WebGl2 {
  const allocated = resourceRecord()
  const deleteAttempts = resourceRecord()
  const successfulDeletes = resourceRecord()
  let nextId = 1
  let initializationFailurePending = options.failDuringInitialization ?? false
  let deleteFailureKind = options.failFirstDeleteKind
  let deleteFailurePending = deleteFailureKind !== undefined

  const allocate = (kind: ResourceKind): FakeResource => {
    const resource = { id: nextId++, kind }
    allocated[kind].push(resource)
    return resource
  }
  const deleteResource = (kind: ResourceKind) =>
    jest.fn((value: FakeResource) => {
      deleteAttempts[kind].push(value)
      if (deleteFailurePending && deleteFailureKind === kind) {
        deleteFailurePending = false
        throw new Error(PRIVATE_NATIVE_DELETE_TEXT)
      }
      successfulDeletes[kind].push(value)
    })

  const constants = {
    ARRAY_BUFFER: 1,
    BLEND: 2,
    CLAMP_TO_EDGE: 3,
    COLOR: 4,
    COLOR_ATTACHMENT0: 10,
    COLOR_BUFFER_BIT: 5,
    COMPILE_STATUS: 6,
    FLOAT: 7,
    FRAGMENT_SHADER: 8,
    FRAMEBUFFER: 9,
    FRAMEBUFFER_COMPLETE: 11,
    FUNC_ADD: 12,
    HALF_FLOAT: 13,
    LINEAR: 14,
    LINK_STATUS: 15,
    MAX_ARRAY_TEXTURE_LAYERS: 16,
    MAX_COLOR_ATTACHMENTS: 17,
    MAX_DRAW_BUFFERS: 18,
    MAX_TEXTURE_SIZE: 19,
    NEAREST: 20,
    NO_ERROR: 0,
    ONE: 21,
    RGBA: 22,
    RGBA16F: 23,
    RGBA32F: 24,
    STATIC_DRAW: 25,
    TEXTURE0: 30,
    TEXTURE_2D: 31,
    TEXTURE_2D_ARRAY: 32,
    TEXTURE_MAG_FILTER: 33,
    TEXTURE_MIN_FILTER: 34,
    TEXTURE_WRAP_S: 35,
    TEXTURE_WRAP_T: 36,
    TRIANGLES: 37,
    VERTEX_SHADER: 38,
  }
  const drawCalls = jest.fn()
  const blendEquation = jest.fn()
  const blendFunc = jest.fn()
  const uniform4f = jest.fn()
  const gl = {
    ...constants,
    activeTexture: jest.fn(),
    attachShader: jest.fn(),
    bindBuffer: jest.fn(),
    bindFramebuffer: jest.fn(),
    bindTexture: jest.fn(),
    bindVertexArray: jest.fn(),
    blendEquation,
    blendFunc,
    bufferData: jest.fn(),
    checkFramebufferStatus: jest.fn(() => constants.FRAMEBUFFER_COMPLETE),
    clear: jest.fn(),
    clearBufferfv: jest.fn(() => {
      if (initializationFailurePending) {
        initializationFailurePending = false
        throw new Error('synthetic initialization failure')
      }
    }),
    clearColor: jest.fn(),
    compileShader: jest.fn(),
    createBuffer: jest.fn(() => allocate('buffer')),
    createFramebuffer: jest.fn(() => allocate('framebuffer')),
    createProgram: jest.fn(() => allocate('program')),
    createShader: jest.fn(() => ({ id: nextId++, kind: 'shader' })),
    createTexture: jest.fn(() => allocate('texture')),
    createVertexArray: jest.fn(() => allocate('vertexArray')),
    deleteBuffer: deleteResource('buffer'),
    deleteFramebuffer: deleteResource('framebuffer'),
    deleteProgram: deleteResource('program'),
    deleteShader: jest.fn(),
    deleteTexture: deleteResource('texture'),
    deleteVertexArray: deleteResource('vertexArray'),
    disable: jest.fn(),
    drawArrays: drawCalls,
    drawArraysInstanced: drawCalls,
    drawBuffers: jest.fn(),
    enable: jest.fn(),
    enableVertexAttribArray: jest.fn(),
    framebufferTexture2D: jest.fn(),
    framebufferTextureLayer: jest.fn(),
    getError: jest.fn(() => constants.NO_ERROR),
    getExtension: jest.fn(() => ({})),
    getParameter: jest.fn((parameter: number) => {
      if (parameter === constants.MAX_DRAW_BUFFERS) return 4
      if (parameter === constants.MAX_COLOR_ATTACHMENTS) return 4
      if (parameter === constants.MAX_ARRAY_TEXTURE_LAYERS) return 120
      if (parameter === constants.MAX_TEXTURE_SIZE) return 4096
      return 0
    }),
    getProgramInfoLog: jest.fn(() => null),
    getProgramParameter: jest.fn(() => true),
    getShaderInfoLog: jest.fn(() => null),
    getShaderParameter: jest.fn(() => true),
    getUniformLocation: jest.fn(
      (_program: WebGLProgram, name: string) =>
        name as unknown as WebGLUniformLocation
    ),
    linkProgram: jest.fn(),
    readBuffer: jest.fn(),
    readPixels: jest.fn(),
    shaderSource: jest.fn(),
    texImage2D: jest.fn(),
    texParameteri: jest.fn(),
    texStorage3D: jest.fn(),
    texSubImage2D: jest.fn(),
    uniform1i: jest.fn(),
    uniform4f,
    useProgram: jest.fn(),
    vertexAttribPointer: jest.fn(),
    viewport: jest.fn(),
  } as unknown as WebGL2RenderingContext
  const canvas = {
    clientHeight: options.clientHeight ?? 720,
    clientWidth: options.clientWidth ?? 1280,
    getContext: jest.fn(() => gl),
    height: options.backingHeight ?? options.clientHeight ?? 720,
    width: options.backingWidth ?? options.clientWidth ?? 1280,
  } as unknown as HTMLCanvasElement

  return {
    allocated,
    armDeleteFailure(kind) {
      deleteFailureKind = kind
      deleteFailurePending = true
    },
    blendEquation,
    blendFunc,
    canvas,
    deleteAttempts,
    drawCalls,
    successfulDeletes,
    uniform4f,
  }
}

function expectEveryAllocationDeletedExactlyOnce(fake: FakeP027WebGl2): void {
  for (const kind of RESOURCE_KINDS) {
    expect(fake.allocated[kind].length).toBeGreaterThan(0)
    for (const resource of fake.allocated[kind]) {
      expect(
        fake.successfulDeletes[kind].filter((value) => value === resource)
      ).toHaveLength(1)
    }
    expect(fake.successfulDeletes[kind]).toHaveLength(
      fake.allocated[kind].length
    )
  }
}

describe('P027 Fire WebGL engine boundary', () => {
  it('constructs only from the supplied pooled canvas and fails closed without WebGL2', () => {
    const getContext = jest.fn(() => null)
    const canvas = { getContext } as unknown as HTMLCanvasElement
    expect(() => new FireP027WebGlEngine(canvas)).toThrow(
      expect.objectContaining<Partial<FireP027CapabilityError>>({
        failure: 'webgl2',
      })
    )
    expect(getContext).toHaveBeenCalledTimes(1)
    expect(getContext).toHaveBeenCalledWith(
      'webgl2',
      expect.objectContaining({ alpha: true, premultipliedAlpha: false })
    )
  })

  it.each(CSS_FOOTPRINT_CASES)(
    'keeps a 49.344 CSS-pixel sprite invariant at viewport %ix%i, DPR %i and scale %s',
    (
      clientWidth,
      clientHeight,
      dpr,
      resolutionScale,
      expectedClipWidth,
      expectedClipHeight
    ) => {
      const fake = createFakeP027WebGl2({
        clientHeight,
        clientWidth,
        backingHeight: clientHeight * dpr,
        backingWidth: clientWidth * dpr,
      })
      const engine = new FireP027WebGlEngine(fake.canvas)
      engine.draw({
        ...FIRE_P027_DEFAULT_CONTROLS,
        spriteWidthCssPx: 49.344,
        spriteHeightCssPx: 55.26528,
        resolutionScale,
      })

      expect(uniformVectors(fake, 'uSizeOrthoSlots')).toContainEqual([
        49.344, 55.26528, 1, 150,
      ])
      expect(uniformVectors(fake, 'uCssViewportLayers')).toContainEqual([
        clientWidth,
        clientHeight,
        120,
        0,
      ])
      expect((49.344 * 2) / clientWidth).toBeCloseTo(expectedClipWidth, 12)
      expect((55.26528 * 2) / clientHeight).toBeCloseTo(expectedClipHeight, 12)
      expect((expectedClipWidth / 2) * clientWidth).toBeCloseTo(49.344, 12)
      expect((expectedClipHeight / 2) * clientHeight).toBeCloseTo(55.26528, 12)
      engine.dispose()
    }
  )

  it('retains additive ONE/ONE accumulation behind a straight-alpha display', () => {
    const fake = createFakeP027WebGl2()
    const engine = new FireP027WebGlEngine(fake.canvas)

    engine.draw(FIRE_P027_DEFAULT_CONTROLS)

    expect(fake.blendEquation).toHaveBeenCalledWith(12)
    expect(fake.blendFunc).toHaveBeenCalledWith(21, 21)
    engine.dispose()
  })

  it('generates the same bounded 42 origins for the same semantic input', () => {
    const first = generateFireP027FallbackOrigins(FIRE_P027_DEFAULT_CONTROLS)
    const second = generateFireP027FallbackOrigins(FIRE_P027_DEFAULT_CONTROLS)
    expect(first).toHaveLength(42)
    expect(second).toEqual(first)
    expect(
      first.every(
        (point) =>
          Math.abs(point.x) <= FIRE_P027_DEFAULT_CONTROLS.originRadiusX &&
          Math.abs(point.y) <= FIRE_P027_DEFAULT_CONTROLS.originRadiusY &&
          Math.abs(point.z) <= FIRE_P027_DEFAULT_CONTROLS.originRadiusZ
      )
    ).toBe(true)
  })

  it('moves the fallback origin cloud without changing its deterministic shape', () => {
    const original = generateFireP027FallbackOrigins(FIRE_P027_DEFAULT_CONTROLS)
    const shifted = generateFireP027FallbackOrigins({
      ...FIRE_P027_DEFAULT_CONTROLS,
      originCenterX: 0.75,
    })
    shifted.forEach((point, index) => {
      expect(point.x - (original[index]?.x ?? 0)).toBeCloseTo(0.75)
      expect(point.y).toBeCloseTo(original[index]?.y ?? 0)
      expect(point.z).toBeCloseTo(original[index]?.z ?? 0)
    })
  })

  it('keeps fallback origins in exact local-X pairs around the emitter center', () => {
    const controls = {
      ...FIRE_P027_DEFAULT_CONTROLS,
      originCenterX: 0.27,
      originCenterY: -0.14,
      originCenterZ: 0.08,
      originSeed: 413,
    }
    const origins = generateFireP027FallbackOrigins(controls)

    for (let index = 0; index < origins.length; index += 2) {
      const positive = origins[index]!
      const negative = origins[index + 1]!
      expect(positive.x + negative.x).toBeCloseTo(
        controls.originCenterX * 2,
        12
      )
      expect(positive.y).toBeCloseTo(negative.y, 12)
      expect(positive.z).toBeCloseTo(negative.z, 12)
    }
  })

  it('applies an emitter-center delta exactly once and resets its baseline', () => {
    const fake = createFakeP027WebGl2()
    const engine = new FireP027WebGlEngine(fake.canvas)
    const centerA = {
      ...FIRE_P027_DEFAULT_CONTROLS,
      originCenterX: -0.25,
      originCenterY: -0.125,
      originCenterZ: 0.0625,
    }
    const centerB = {
      ...centerA,
      originCenterX: 0.25,
      originCenterY: 0.125,
      originCenterZ: 0,
    }
    const batch = {
      start: 0,
      count: 1,
      generationBase: 0,
      logicalUpdate: 0,
      dtSeconds: 1 / 60,
    }

    engine.step(batch, 1, centerA)
    engine.step(batch, 1, centerB)
    engine.step(batch, 1, centerB)

    expect(fake.uniform4f).toHaveBeenCalledWith(
      'uOriginCenter',
      0.25,
      0.125,
      0,
      0
    )
    expect(uniformVectors(fake, 'uOriginDelta')).toEqual([
      [0, 0, 0, 0],
      [0.5, 0.25, -0.0625, 0],
      [0, 0, 0, 0],
    ])

    engine.reset()
    engine.step(batch, 1, centerB)
    const deltasAfterReset = uniformVectors(fake, 'uOriginDelta')
    expect(deltasAfterReset[deltasAfterReset.length - 1]).toEqual([0, 0, 0, 0])
    engine.dispose()
  })

  it.each([
    ['nonfinite', Number.NaN],
    ['infinite', Number.POSITIVE_INFINITY],
    ['oversized', 1.01],
  ])(
    'quarantines a %s emitter center before any later draw',
    (_label, centerX) => {
      const fake = createFakeP027WebGl2()
      const engine = new FireP027WebGlEngine(fake.canvas)
      const drawCallsBefore = fake.drawCalls.mock.calls.length

      let failure: unknown
      try {
        engine.step(
          {
            start: 0,
            count: 0,
            generationBase: 0,
            logicalUpdate: 0,
            dtSeconds: 1 / 60,
          },
          1,
          {
            ...FIRE_P027_DEFAULT_CONTROLS,
            originCenterX: centerX,
          }
        )
      } catch (error) {
        failure = error
      }

      expect(failure).toBeInstanceOf(FireP027MotionError)
      expect((failure as Error).message).toBe(
        'P027 fire emitter motion invalid'
      )
      expect((failure as Error).message).not.toContain(String(centerX))
      expect(fake.drawCalls).toHaveBeenCalledTimes(drawCallsBefore)
      expect(engine.audit()).toMatchObject({ disposed: true, resourceCount: 0 })
      expect(() => engine.draw(FIRE_P027_DEFAULT_CONTROLS)).toThrow(
        'P027 fire surface is disposed'
      )
    }
  )

  it('retains failed cleanup ownership when an oversized delta is quarantined', () => {
    const fake = createFakeP027WebGl2()
    const engine = new FireP027WebGlEngine(fake.canvas)
    const batch = {
      start: 0,
      count: 0,
      generationBase: 0,
      logicalUpdate: 0,
      dtSeconds: 1 / 60,
    }
    engine.step(batch, 1, {
      ...FIRE_P027_DEFAULT_CONTROLS,
      originCenterX: -0.5,
    })
    fake.armDeleteFailure('buffer')
    const drawCallsBefore = fake.drawCalls.mock.calls.length

    let failure: unknown
    try {
      engine.step(batch, 1, {
        ...FIRE_P027_DEFAULT_CONTROLS,
        originCenterX: 0.75,
      })
    } catch (error) {
      failure = error
    }

    expect(failure).toBeInstanceOf(FireP027CleanupError)
    expect((failure as Error).message).toBe(
      'P027 fire resource cleanup incomplete'
    )
    expect((failure as Error).message).not.toContain(PRIVATE_NATIVE_DELETE_TEXT)
    expect(fake.drawCalls).toHaveBeenCalledTimes(drawCallsBefore)
    expect(engine.audit()).toMatchObject({ disposed: true, resourceCount: 1 })
    for (const kind of RESOURCE_KINDS.filter((value) => value !== 'buffer')) {
      expect(fake.deleteAttempts[kind].length).toBeGreaterThan(0)
    }
    expect(() => engine.draw(FIRE_P027_DEFAULT_CONTROLS)).toThrow(
      'P027 fire surface is disposed'
    )

    engine.dispose()
    expectEveryAllocationDeletedExactlyOnce(fake)
    expect(engine.audit()).toMatchObject({ disposed: true, resourceCount: 0 })
  })

  it('deletes every allocated identity exactly once and double-dispose is idempotent', () => {
    const fake = createFakeP027WebGl2()
    const engine = new FireP027WebGlEngine(fake.canvas)

    engine.dispose()
    const attemptCounts = Object.fromEntries(
      RESOURCE_KINDS.map((kind) => [kind, fake.deleteAttempts[kind].length])
    )
    engine.dispose()

    expectEveryAllocationDeletedExactlyOnce(fake)
    for (const kind of RESOURCE_KINDS) {
      expect(fake.deleteAttempts[kind]).toHaveLength(attemptCounts[kind] ?? 0)
    }
    expect(engine.audit()).toMatchObject({ disposed: true, resourceCount: 0 })
  })

  it('cleans every resource kind when construction fails after allocation', () => {
    const fake = createFakeP027WebGl2({ failDuringInitialization: true })

    expect(() => new FireP027WebGlEngine(fake.canvas)).toThrow(
      'synthetic initialization failure'
    )
    expectEveryAllocationDeletedExactlyOnce(fake)
  })

  it('retries a constructor-cleanup failure without echoing the native error', () => {
    const fake = createFakeP027WebGl2({
      failDuringInitialization: true,
      failFirstDeleteKind: 'buffer',
    })

    let failure: unknown
    try {
      new FireP027WebGlEngine(fake.canvas)
    } catch (error) {
      failure = error
    }

    expect(failure).toBeInstanceOf(FireP027CleanupError)
    expect((failure as Error).message).toBe(
      'P027 fire resource cleanup incomplete'
    )
    expect((failure as Error).message).not.toContain(PRIVATE_NATIVE_DELETE_TEXT)
    expect(fake.deleteAttempts.buffer).toHaveLength(2)
    for (const kind of RESOURCE_KINDS.filter((value) => value !== 'buffer')) {
      expect(fake.deleteAttempts[kind].length).toBeGreaterThan(0)
    }
    expectEveryAllocationDeletedExactlyOnce(fake)
  })

  it('quarantines after dispose failure and retries only retained ownership', () => {
    const fake = createFakeP027WebGl2()
    const engine = new FireP027WebGlEngine(fake.canvas)
    fake.armDeleteFailure('buffer')

    let failure: unknown
    try {
      engine.dispose()
    } catch (error) {
      failure = error
    }

    expect(failure).toBeInstanceOf(FireP027CleanupError)
    expect((failure as Error).message).toBe(
      'P027 fire resource cleanup incomplete'
    )
    expect((failure as Error).message).not.toContain(PRIVATE_NATIVE_DELETE_TEXT)
    expect(engine.audit()).toMatchObject({ disposed: true, resourceCount: 1 })
    for (const kind of RESOURCE_KINDS.filter((value) => value !== 'buffer')) {
      expect(fake.deleteAttempts[kind].length).toBeGreaterThan(0)
    }

    const drawCalls = fake.drawCalls.mock.calls.length
    expect(() => engine.draw(FIRE_P027_DEFAULT_CONTROLS)).toThrow(
      'P027 fire surface is disposed'
    )
    expect(fake.drawCalls).toHaveBeenCalledTimes(drawCalls)

    engine.dispose()
    engine.dispose()
    expect(fake.deleteAttempts.buffer).toHaveLength(2)
    expectEveryAllocationDeletedExactlyOnce(fake)
    expect(engine.audit()).toMatchObject({ disposed: true, resourceCount: 0 })
  })
})

function uniformVectors(
  fake: Readonly<FakeP027WebGl2>,
  name: string
): number[][] {
  return fake.uniform4f.mock.calls
    .filter(([location]) => location === name)
    .map(([, x, y, z, w]) => [x, y, z, w])
}
