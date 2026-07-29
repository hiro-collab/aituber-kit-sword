import {
  FIRE_P027_DEFAULT_CONTROLS,
  FIRE_P027_LAYER_COUNT,
  FIRE_P027_SLICE_SIZE,
  FIRE_P027_SLOT_COUNT,
  assertFireP027Capabilities,
  type FireP027Controls,
  type FireP027OriginPoint,
  type FireP027SpawnBatch,
  type FireP027Surface,
  type FireP027SurfaceAudit,
} from './contracts'
import {
  FIRE_P027_DISPLAY_FRAGMENT_SHADER,
  FIRE_P027_FULLSCREEN_VERTEX_SHADER,
  FIRE_P027_GENERATOR_FRAGMENT_SHADER,
  FIRE_P027_RASTER_FRAGMENT_SHADER,
  FIRE_P027_RASTER_VERTEX_SHADER,
  FIRE_P027_STATE_FRAGMENT_SHADER,
} from './shaders'

type StateTextures = [WebGLTexture, WebGLTexture, WebGLTexture, WebGLTexture]

interface StateSet {
  framebuffer: WebGLFramebuffer
  textures: StateTextures
}

const ZERO = new Float32Array([0, 0, 0, 0])
const FIRE_P027_MAX_ORIGIN_CENTER_COMPONENT = 1
const FIRE_P027_MAX_ORIGIN_DELTA_COMPONENT = 1

/** Fixed public failure for incomplete native resource cleanup. */
export class FireP027CleanupError extends Error {
  readonly failure = 'cleanup' as const

  constructor() {
    super('P027 fire resource cleanup incomplete')
    this.name = 'FireP027CleanupError'
  }
}

/** Fixed public failure for an unsafe emitter-center transition. */
export class FireP027MotionError extends Error {
  readonly failure = 'motion' as const

  constructor() {
    super('P027 fire emitter motion invalid')
    this.name = 'FireP027MotionError'
  }
}

/** WebGL2 implementation of the P027 state, appearance and raster domains. */
export class FireP027WebGlEngine implements FireP027Surface {
  private readonly canvas: HTMLCanvasElement
  private readonly gl: WebGL2RenderingContext
  private readonly resources: FireP027GlResources
  private readonly stateProgram!: WebGLProgram
  private readonly generatorProgram!: WebGLProgram
  private readonly rasterProgram!: WebGLProgram
  private readonly displayProgram!: WebGLProgram
  private readonly fullscreenVao!: WebGLVertexArrayObject
  private readonly rasterVao!: WebGLVertexArrayObject
  private readonly quadBuffer!: WebGLBuffer
  private readonly stateSets!: [StateSet, StateSet]
  private readonly snapshotFramebuffer!: WebGLFramebuffer
  private originTexture!: WebGLTexture
  private snapshotTexture!: WebGLTexture
  private outputTexture: WebGLTexture | null = null
  private outputFramebuffer: WebGLFramebuffer | null = null
  private readStateIndex = 0
  private originCountValue = 1
  private snapshotIndexValue = 0
  private snapshotCompleteValue = false
  private outputWidthValue = 0
  private outputHeightValue = 0
  private stateStepCount = 0
  private drawCountValue = 0
  private disposed = false
  private appliedOriginCenter: FireP027OriginPoint | null = null

  constructor(
    canvas: HTMLCanvasElement,
    initialControls: Readonly<FireP027Controls> = FIRE_P027_DEFAULT_CONTROLS
  ) {
    this.canvas = canvas
    const gl = canvas.getContext('webgl2', {
      alpha: true,
      antialias: false,
      depth: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: true,
    })
    assertFireP027Capabilities({
      webgl2: gl !== null,
      colorBufferFloat: gl?.getExtension('EXT_color_buffer_float') !== null,
      floatBlend: gl?.getExtension('EXT_float_blend') !== null,
      maxDrawBuffers: gl ? numberGlParameter(gl, gl.MAX_DRAW_BUFFERS) : 0,
      maxColorAttachments: gl
        ? numberGlParameter(gl, gl.MAX_COLOR_ATTACHMENTS)
        : 0,
      maxArrayTextureLayers: gl
        ? numberGlParameter(gl, gl.MAX_ARRAY_TEXTURE_LAYERS)
        : 0,
    })
    if (!gl) throw new Error('unreachable WebGL2 capability state')
    this.gl = gl
    this.resources = new FireP027GlResources(gl)

    try {
      this.stateProgram = createProgram(
        gl,
        this.resources,
        FIRE_P027_FULLSCREEN_VERTEX_SHADER,
        FIRE_P027_STATE_FRAGMENT_SHADER,
        'P027 particle state MRT'
      )
      this.generatorProgram = createProgram(
        gl,
        this.resources,
        FIRE_P027_FULLSCREEN_VERTEX_SHADER,
        FIRE_P027_GENERATOR_FRAGMENT_SHADER,
        'P027 fire slice generator'
      )
      this.rasterProgram = createProgram(
        gl,
        this.resources,
        FIRE_P027_RASTER_VERTEX_SHADER,
        FIRE_P027_RASTER_FRAGMENT_SHADER,
        'P027 instanced particle raster'
      )
      this.displayProgram = createProgram(
        gl,
        this.resources,
        FIRE_P027_FULLSCREEN_VERTEX_SHADER,
        FIRE_P027_DISPLAY_FRAGMENT_SHADER,
        'P027 display'
      )

      this.fullscreenVao = this.resources.createVertexArray()
      this.rasterVao = this.resources.createVertexArray()
      this.quadBuffer = this.resources.createBuffer()
      gl.bindVertexArray(this.rasterVao)
      gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer)
      gl.bufferData(
        gl.ARRAY_BUFFER,
        new Float32Array([0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1]),
        gl.STATIC_DRAW
      )
      gl.enableVertexAttribArray(0)
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
      gl.bindVertexArray(null)

      this.stateSets = [this.createStateSet(), this.createStateSet()]
      this.originTexture = createTexture2D(
        gl,
        this.resources,
        1,
        1,
        gl.RGBA32F,
        gl.RGBA,
        gl.FLOAT,
        gl.NEAREST
      )
      this.snapshotFramebuffer = this.resources.createFramebuffer()
      this.snapshotTexture = this.createSnapshotTexture()
      this.captureAllLayers()
      this.setOrigins(generateFireP027FallbackOrigins(initialControls))
      this.ensureOutputSize(
        initialControls.resolutionScale,
        this.readCssViewportSize()
      )
      this.clearState()
      assertNoGlError(gl, 'P027 engine initialization')
    } catch (error) {
      this.disposed = true
      let cleanupFailed = false
      for (
        let attempt = 0;
        attempt < 2 && this.resources.count > 0;
        attempt += 1
      ) {
        try {
          this.resources.dispose()
        } catch {
          cleanupFailed = true
        }
      }
      if (cleanupFailed) throw new FireP027CleanupError()
      throw error
    }
  }

  step(
    batch: Readonly<FireP027SpawnBatch>,
    rawGate: number,
    controls: Readonly<FireP027Controls>
  ): void {
    this.assertActive()
    const currentOriginCenter = originCenterFromControls(controls)
    if (
      !isBoundedVector(
        currentOriginCenter,
        FIRE_P027_MAX_ORIGIN_CENTER_COMPONENT
      )
    ) {
      this.quarantineInvalidMotion()
    }
    const originDelta = this.appliedOriginCenter
      ? subtractVector(currentOriginCenter, this.appliedOriginCenter)
      : { x: 0, y: 0, z: 0 }
    if (!isBoundedVector(originDelta, FIRE_P027_MAX_ORIGIN_DELTA_COMPONENT)) {
      this.quarantineInvalidMotion()
    }
    const gl = this.gl
    const source = this.stateSets[this.readStateIndex]
    const writeIndex = this.readStateIndex === 0 ? 1 : 0
    const destination = this.stateSets[writeIndex]
    gl.bindFramebuffer(gl.FRAMEBUFFER, destination.framebuffer)
    gl.viewport(0, 0, FIRE_P027_SLOT_COUNT, 1)
    gl.disable(gl.BLEND)
    gl.useProgram(this.stateProgram)
    gl.bindVertexArray(this.fullscreenVao)

    bindTextureUnit(gl, 0, gl.TEXTURE_2D, this.originTexture)
    source.textures.forEach((texture, index) => {
      bindTextureUnit(gl, index + 1, gl.TEXTURE_2D, texture)
    })
    gl.uniform1i(uniform(gl, this.stateProgram, 'uOrigins'), 0)
    gl.uniform1i(uniform(gl, this.stateProgram, 'uPreviousPositionAge'), 1)
    gl.uniform1i(uniform(gl, this.stateProgram, 'uPreviousGenerationLife'), 2)
    gl.uniform1i(uniform(gl, this.stateProgram, 'uPreviousVelocityOpacity'), 3)
    gl.uniform1i(uniform(gl, this.stateProgram, 'uPreviousControlRelay'), 4)
    gl.uniform1i(
      uniform(gl, this.stateProgram, 'uOriginCount'),
      this.originCountValue
    )
    gl.uniform4f(
      uniform(gl, this.stateProgram, 'uSpawn'),
      batch.start,
      batch.count,
      batch.generationBase,
      batch.logicalUpdate
    )
    gl.uniform4f(
      uniform(gl, this.stateProgram, 'uTimeLife'),
      batch.dtSeconds,
      Math.max(0.0001, controls.lifeSeconds),
      FIRE_P027_SLOT_COUNT,
      0
    )
    gl.uniform4f(
      uniform(gl, this.stateProgram, 'uForceMass'),
      controls.forceX,
      controls.forceY,
      controls.forceZ,
      Math.max(0.0001, controls.mass)
    )
    gl.uniform4f(
      uniform(gl, this.stateProgram, 'uWindDrag'),
      controls.windX,
      controls.windY,
      controls.windZ,
      Math.max(0, controls.drag)
    )
    gl.uniform4f(
      uniform(gl, this.stateProgram, 'uTurbulence'),
      controls.turbulenceX,
      controls.turbulenceY,
      controls.turbulenceZ,
      Math.max(0.001, controls.turbulencePeriod)
    )
    gl.uniform4f(
      uniform(gl, this.stateProgram, 'uOriginCenter'),
      currentOriginCenter.x,
      currentOriginCenter.y,
      currentOriginCenter.z,
      0
    )
    gl.uniform4f(
      uniform(gl, this.stateProgram, 'uOriginDelta'),
      originDelta.x,
      originDelta.y,
      originDelta.z,
      0
    )
    gl.uniform4f(
      uniform(gl, this.stateProgram, 'uConfig'),
      controls.particleSeed,
      Math.max(0, controls.lifeVarianceSeconds),
      Math.max(0, controls.alphaSpeed),
      controls.jitterBirths ? 1 : 0
    )
    gl.uniform4f(
      uniform(gl, this.stateProgram, 'uGateLag'),
      clamp(rawGate, 0, 1),
      Math.max(0, controls.inputLagSeconds),
      controls.useMass ? 1 : 0,
      controls.useDrag ? 1 : 0
    )
    gl.drawArrays(gl.TRIANGLES, 0, 3)
    this.readStateIndex = writeIndex
    this.stateStepCount += 1
    assertNoGlError(gl, 'P027 state update')
    this.appliedOriginCenter = currentOriginCenter
  }

  draw(controls: Readonly<FireP027Controls>): void {
    this.assertActive()
    const gl = this.gl
    const cssViewport = this.readCssViewportSize()
    this.ensureOutputSize(controls.resolutionScale, cssViewport)
    const state = this.stateSets[this.readStateIndex]
    if (!this.outputFramebuffer || !this.outputTexture) {
      throw new Error('P027 output framebuffer is unavailable')
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.outputFramebuffer)
    gl.viewport(0, 0, this.outputWidthValue, this.outputHeightValue)
    gl.clearBufferfv(gl.COLOR, 0, ZERO)
    gl.disable(gl.DEPTH_TEST)
    gl.enable(gl.BLEND)
    gl.blendEquation(gl.FUNC_ADD)
    gl.blendFunc(gl.ONE_MINUS_SRC_ALPHA, gl.ONE)
    gl.useProgram(this.rasterProgram)
    gl.bindVertexArray(this.rasterVao)
    state.textures.forEach((texture, index) => {
      bindTextureUnit(gl, index, gl.TEXTURE_2D, texture)
    })
    bindTextureUnit(gl, 4, gl.TEXTURE_2D_ARRAY, this.snapshotTexture)
    gl.uniform1i(uniform(gl, this.rasterProgram, 'uPositionAge'), 0)
    gl.uniform1i(uniform(gl, this.rasterProgram, 'uGenerationLife'), 1)
    gl.uniform1i(uniform(gl, this.rasterProgram, 'uVelocityOpacity'), 2)
    gl.uniform1i(uniform(gl, this.rasterProgram, 'uControlRelay'), 3)
    gl.uniform1i(uniform(gl, this.rasterProgram, 'uFireLayers'), 4)
    gl.uniform4f(
      uniform(gl, this.rasterProgram, 'uSizeOrthoSlots'),
      controls.spriteWidthOrtho,
      controls.spriteHeightOrtho,
      1,
      FIRE_P027_SLOT_COUNT
    )
    gl.uniform4f(
      uniform(gl, this.rasterProgram, 'uCssViewportLayers'),
      cssViewport.width,
      cssViewport.height,
      FIRE_P027_LAYER_COUNT,
      0
    )
    gl.uniform4f(
      uniform(gl, this.rasterProgram, 'uTint'),
      controls.tintR,
      controls.tintG,
      controls.tintB,
      controls.tintA
    )
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, FIRE_P027_SLOT_COUNT)

    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.viewport(0, 0, this.canvas.width, this.canvas.height)
    gl.disable(gl.BLEND)
    gl.useProgram(this.displayProgram)
    gl.bindVertexArray(this.fullscreenVao)
    bindTextureUnit(gl, 0, gl.TEXTURE_2D, this.outputTexture)
    gl.uniform1i(uniform(gl, this.displayProgram, 'uAccumulatedFire'), 0)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
    this.drawCountValue += 1
    assertNoGlError(gl, 'P027 raster/display')
  }

  setOrigins(points: readonly Readonly<FireP027OriginPoint>[]): void {
    this.assertActive()
    if (points.length < 1) {
      throw new Error('P027 requires at least one origin point')
    }
    const gl = this.gl
    const data = new Float32Array(points.length * 4)
    points.forEach((point, index) => {
      data[index * 4] = point.x
      data[index * 4 + 1] = point.y
      data[index * 4 + 2] = point.z
      data[index * 4 + 3] = 1
    })
    const replacement = createTexture2D(
      gl,
      this.resources,
      points.length,
      1,
      gl.RGBA32F,
      gl.RGBA,
      gl.FLOAT,
      gl.NEAREST
    )
    gl.bindTexture(gl.TEXTURE_2D, replacement)
    gl.texSubImage2D(
      gl.TEXTURE_2D,
      0,
      0,
      0,
      points.length,
      1,
      gl.RGBA,
      gl.FLOAT,
      data
    )
    gl.bindTexture(gl.TEXTURE_2D, null)
    this.resources.deleteTexture(this.originTexture)
    this.originTexture = replacement
    this.originCountValue = points.length
  }

  reset(): void {
    this.assertActive()
    this.clearState()
    this.resetSnapshot()
    this.clearOutput()
    this.drawCountValue = 0
  }

  clear(): void {
    this.assertActive()
    this.clearState()
    this.clearOutput()
  }

  dispose(): void {
    this.appliedOriginCenter = null
    this.disposed = true
    if (this.resources.count === 0) return
    try {
      this.resources.dispose()
    } finally {
      if (this.resources.count === 0) {
        this.outputFramebuffer = null
        this.outputTexture = null
      }
    }
  }

  audit(): Readonly<FireP027SurfaceAudit> {
    if (this.disposed) {
      return Object.freeze({
        aliveCount: 0,
        disposed: true,
        drawCount: this.drawCountValue,
        glError: 0,
        laggedGate: 0,
        outputHeight: this.outputHeightValue,
        outputWidth: this.outputWidthValue,
        rawGate: 0,
        resourceCount: this.resources.count,
        snapshotCaptured: this.snapshotIndexValue,
        snapshotComplete: this.snapshotCompleteValue,
        stateSteps: this.stateStepCount,
      })
    }

    const generationLife = this.readStateAttachment(1)
    const controlRelay = this.readStateAttachment(3)
    let aliveCount = 0
    for (let slot = 0; slot < FIRE_P027_SLOT_COUNT; slot += 1) {
      if ((generationLife[slot * 4 + 1] ?? 0) > 0.5) aliveCount += 1
    }
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null)
    const glError = this.gl.getError()
    return Object.freeze({
      aliveCount,
      disposed: false,
      drawCount: this.drawCountValue,
      glError,
      laggedGate: controlRelay[1] ?? 0,
      outputHeight: this.outputHeightValue,
      outputWidth: this.outputWidthValue,
      rawGate: controlRelay[0] ?? 0,
      resourceCount: this.resources.count,
      snapshotCaptured: this.snapshotIndexValue,
      snapshotComplete: this.snapshotCompleteValue,
      stateSteps: this.stateStepCount,
    })
  }

  private createStateSet(): StateSet {
    const gl = this.gl
    const textures = [0, 1, 2, 3].map(() =>
      createTexture2D(
        gl,
        this.resources,
        FIRE_P027_SLOT_COUNT,
        1,
        gl.RGBA32F,
        gl.RGBA,
        gl.FLOAT,
        gl.NEAREST
      )
    ) as StateTextures
    return {
      textures,
      framebuffer: createFramebuffer(gl, this.resources, textures),
    }
  }

  private createSnapshotTexture(): WebGLTexture {
    const gl = this.gl
    const texture = this.resources.createTexture()
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, texture)
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texStorage3D(
      gl.TEXTURE_2D_ARRAY,
      1,
      gl.RGBA16F,
      FIRE_P027_SLICE_SIZE,
      FIRE_P027_SLICE_SIZE,
      FIRE_P027_LAYER_COUNT
    )
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.snapshotFramebuffer)
    gl.drawBuffers([gl.COLOR_ATTACHMENT0])
    for (let layer = 0; layer < FIRE_P027_LAYER_COUNT; layer += 1) {
      gl.framebufferTextureLayer(
        gl.FRAMEBUFFER,
        gl.COLOR_ATTACHMENT0,
        texture,
        0,
        layer
      )
      if (layer === 0) {
        assertFramebufferComplete(gl, 'P027 snapshot framebuffer')
      }
      gl.clearBufferfv(gl.COLOR, 0, ZERO)
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    return texture
  }

  private clearState(): void {
    const gl = this.gl
    for (const stateSet of this.stateSets) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, stateSet.framebuffer)
      for (let index = 0; index < 4; index += 1) {
        gl.clearBufferfv(gl.COLOR, index, ZERO)
      }
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    this.readStateIndex = 0
    this.stateStepCount = 0
    this.appliedOriginCenter = null
  }

  private resetSnapshot(): void {
    this.resources.deleteTexture(this.snapshotTexture)
    this.snapshotTexture = this.createSnapshotTexture()
    this.snapshotIndexValue = 0
    this.snapshotCompleteValue = false
    this.captureAllLayers()
  }

  private captureAllLayers(): void {
    while (!this.snapshotCompleteValue) this.captureNextLayer()
  }

  private captureNextLayer(): void {
    if (this.snapshotCompleteValue) return
    const gl = this.gl
    const layer = this.snapshotIndexValue
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.snapshotFramebuffer)
    gl.framebufferTextureLayer(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      this.snapshotTexture,
      0,
      layer
    )
    gl.viewport(0, 0, FIRE_P027_SLICE_SIZE, FIRE_P027_SLICE_SIZE)
    gl.disable(gl.BLEND)
    gl.useProgram(this.generatorProgram)
    gl.bindVertexArray(this.fullscreenVao)
    const seconds = layer / 60
    gl.uniform4f(
      uniform(gl, this.generatorProgram, 'uGeneratorTimePreset'),
      seconds,
      seconds,
      FIRE_P027_SLICE_SIZE,
      FIRE_P027_SLICE_SIZE
    )
    gl.uniform4f(
      uniform(gl, this.generatorProgram, 'uGeneratorPresetA'),
      1.61,
      2,
      2,
      0.7
    )
    gl.uniform4f(
      uniform(gl, this.generatorProgram, 'uGeneratorPresetB'),
      0.83,
      4,
      2.2,
      0.47
    )
    gl.drawArrays(gl.TRIANGLES, 0, 3)
    this.snapshotIndexValue += 1
    this.snapshotCompleteValue =
      this.snapshotIndexValue >= FIRE_P027_LAYER_COUNT
  }

  private readCssViewportSize(): { height: number; width: number } {
    const widthCandidate = this.canvas.clientWidth || this.canvas.width || 1
    const heightCandidate = this.canvas.clientHeight || this.canvas.height || 1
    return {
      width:
        Number.isFinite(widthCandidate) && widthCandidate > 0
          ? widthCandidate
          : 1,
      height:
        Number.isFinite(heightCandidate) && heightCandidate > 0
          ? heightCandidate
          : 1,
    }
  }

  private ensureOutputSize(
    resolutionScale: number,
    cssViewport: Readonly<{ height: number; width: number }>
  ): void {
    const gl = this.gl
    const maxSize = numberGlParameter(gl, gl.MAX_TEXTURE_SIZE)
    const scale = clamp(resolutionScale, 0.25, 1)
    const width = Math.min(
      maxSize,
      Math.max(1, Math.round(cssViewport.width * scale))
    )
    const height = Math.min(
      maxSize,
      Math.max(1, Math.round(cssViewport.height * scale))
    )
    if (width === this.outputWidthValue && height === this.outputHeightValue) {
      return
    }
    if (this.outputFramebuffer) {
      this.resources.deleteFramebuffer(this.outputFramebuffer)
    }
    if (this.outputTexture) this.resources.deleteTexture(this.outputTexture)
    this.outputTexture = createTexture2D(
      gl,
      this.resources,
      width,
      height,
      gl.RGBA8,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      gl.LINEAR
    )
    this.outputFramebuffer = createFramebuffer(gl, this.resources, [
      this.outputTexture,
    ])
    this.outputWidthValue = width
    this.outputHeightValue = height
    this.canvas.width = width
    this.canvas.height = height
  }

  private clearOutput(): void {
    const gl = this.gl
    if (this.outputFramebuffer) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.outputFramebuffer)
      gl.clearBufferfv(gl.COLOR, 0, ZERO)
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
  }

  private readStateAttachment(attachmentIndex: number): Float32Array {
    const gl = this.gl
    const data = new Float32Array(FIRE_P027_SLOT_COUNT * 4)
    const state = this.stateSets[this.readStateIndex]
    gl.bindFramebuffer(gl.FRAMEBUFFER, state.framebuffer)
    gl.readBuffer(gl.COLOR_ATTACHMENT0 + attachmentIndex)
    gl.readPixels(0, 0, FIRE_P027_SLOT_COUNT, 1, gl.RGBA, gl.FLOAT, data)
    return data
  }

  private assertActive(): void {
    if (this.disposed) throw new Error('P027 fire surface is disposed')
  }

  private quarantineInvalidMotion(): never {
    this.appliedOriginCenter = null
    this.disposed = true
    try {
      if (this.resources.count > 0) this.resources.dispose()
    } catch {
      throw new FireP027CleanupError()
    }
    throw new FireP027MotionError()
  }
}

/** Deterministic 42-point substitute for an absent external SOP origin. */
export function generateFireP027FallbackOrigins(
  controls: Readonly<FireP027Controls>
): FireP027OriginPoint[] {
  const random = mulberry32(Math.round(controls.originSeed) + 0x50303237)
  const points: FireP027OriginPoint[] = []
  const pairCount = 21
  const goldenAngle = Math.PI * (3 - Math.sqrt(5))
  for (let index = 0; index < pairCount; index += 1) {
    const y = 1 - ((index + 0.5) / pairCount) * 2
    const radial = Math.sqrt(Math.max(0, 1 - y * y))
    const theta = index * goldenAngle + (random() - 0.5) * 0.16
    const shell = 0.55 + random() * 0.45
    const localX =
      Math.abs(Math.cos(theta)) * radial * shell * controls.originRadiusX
    const localY = y * shell * controls.originRadiusY
    const localZ = Math.sin(theta) * radial * shell * controls.originRadiusZ
    points.push({
      x: controls.originCenterX + localX,
      y: controls.originCenterY + localY,
      z: controls.originCenterZ + localZ,
    })
    points.push({
      x: controls.originCenterX - localX,
      y: controls.originCenterY + localY,
      z: controls.originCenterZ + localZ,
    })
  }
  return points
}

function originCenterFromControls(
  controls: Readonly<FireP027Controls>
): FireP027OriginPoint {
  return {
    x: controls.originCenterX,
    y: controls.originCenterY,
    z: controls.originCenterZ,
  }
}

function subtractVector(
  left: Readonly<FireP027OriginPoint>,
  right: Readonly<FireP027OriginPoint>
): FireP027OriginPoint {
  return {
    x: left.x - right.x,
    y: left.y - right.y,
    z: left.z - right.z,
  }
}

function isBoundedVector(
  value: Readonly<FireP027OriginPoint>,
  maximumComponent: number
): boolean {
  return [value.x, value.y, value.z].every(
    (component) =>
      Number.isFinite(component) && Math.abs(component) <= maximumComponent
  )
}

class FireP027GlResources {
  private readonly programs = new Set<WebGLProgram>()
  private readonly textures = new Set<WebGLTexture>()
  private readonly framebuffers = new Set<WebGLFramebuffer>()
  private readonly vertexArrays = new Set<WebGLVertexArrayObject>()
  private readonly buffers = new Set<WebGLBuffer>()
  constructor(private readonly gl: WebGL2RenderingContext) {}

  get count(): number {
    return (
      this.programs.size +
      this.textures.size +
      this.framebuffers.size +
      this.vertexArrays.size +
      this.buffers.size
    )
  }

  createProgram(): WebGLProgram {
    const value = this.gl.createProgram()
    if (!value) throw new Error('Unable to create P027 program')
    this.programs.add(value)
    return value
  }

  createTexture(): WebGLTexture {
    const value = this.gl.createTexture()
    if (!value) throw new Error('Unable to create P027 texture')
    this.textures.add(value)
    return value
  }

  createFramebuffer(): WebGLFramebuffer {
    const value = this.gl.createFramebuffer()
    if (!value) throw new Error('Unable to create P027 framebuffer')
    this.framebuffers.add(value)
    return value
  }

  createVertexArray(): WebGLVertexArrayObject {
    const value = this.gl.createVertexArray()
    if (!value) throw new Error('Unable to create P027 vertex array')
    this.vertexArrays.add(value)
    return value
  }

  createBuffer(): WebGLBuffer {
    const value = this.gl.createBuffer()
    if (!value) throw new Error('Unable to create P027 buffer')
    this.buffers.add(value)
    return value
  }

  deleteProgram(value: WebGLProgram): void {
    this.deleteOne(this.programs, value, (resource) =>
      this.gl.deleteProgram(resource)
    )
  }

  deleteTexture(value: WebGLTexture): void {
    this.deleteOne(this.textures, value, (resource) =>
      this.gl.deleteTexture(resource)
    )
  }

  deleteFramebuffer(value: WebGLFramebuffer): void {
    this.deleteOne(this.framebuffers, value, (resource) =>
      this.gl.deleteFramebuffer(resource)
    )
  }

  dispose(): void {
    let incomplete = false
    const attempt = <T>(
      values: Set<T>,
      deleteNative: (value: T) => void
    ): void => {
      for (const value of Array.from(values)) {
        try {
          deleteNative(value)
          values.delete(value)
        } catch {
          incomplete = true
        }
      }
    }

    attempt(this.buffers, (value) => this.gl.deleteBuffer(value))
    attempt(this.vertexArrays, (value) => this.gl.deleteVertexArray(value))
    attempt(this.framebuffers, (value) => this.gl.deleteFramebuffer(value))
    attempt(this.textures, (value) => this.gl.deleteTexture(value))
    attempt(this.programs, (value) => this.gl.deleteProgram(value))

    if (incomplete || this.count > 0) throw new FireP027CleanupError()
  }

  private deleteOne<T>(
    values: Set<T>,
    value: T,
    deleteNative: (value: T) => void
  ): void {
    if (!values.has(value)) return
    try {
      deleteNative(value)
      values.delete(value)
    } catch {
      throw new FireP027CleanupError()
    }
  }
}

function compileShader(
  gl: WebGL2RenderingContext,
  type: number,
  source: string,
  label: string
): WebGLShader {
  const shader = gl.createShader(type)
  if (!shader) throw new Error(`Unable to create ${label} shader`)
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) ?? 'unknown compile error'
    gl.deleteShader(shader)
    throw new Error(`${label} shader compile failed: ${log}`)
  }
  return shader
}

function createProgram(
  gl: WebGL2RenderingContext,
  resources: FireP027GlResources,
  vertexSource: string,
  fragmentSource: string,
  label: string
): WebGLProgram {
  let vertex: WebGLShader | null = null
  let fragment: WebGLShader | null = null
  let program: WebGLProgram | null = null
  try {
    vertex = compileShader(
      gl,
      gl.VERTEX_SHADER,
      vertexSource,
      `${label} vertex`
    )
    fragment = compileShader(
      gl,
      gl.FRAGMENT_SHADER,
      fragmentSource,
      `${label} fragment`
    )
    program = resources.createProgram()
    gl.attachShader(program, vertex)
    gl.attachShader(program, fragment)
    gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(program) ?? 'unknown link error'
      throw new Error(`${label} program link failed: ${log}`)
    }
    return program
  } catch (error) {
    if (program) resources.deleteProgram(program)
    throw error
  } finally {
    if (vertex) gl.deleteShader(vertex)
    if (fragment) gl.deleteShader(fragment)
  }
}

function createTexture2D(
  gl: WebGL2RenderingContext,
  resources: FireP027GlResources,
  width: number,
  height: number,
  internalFormat: number,
  format: number,
  type: number,
  filter: number
): WebGLTexture {
  const texture = resources.createTexture()
  gl.bindTexture(gl.TEXTURE_2D, texture)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    internalFormat,
    width,
    height,
    0,
    format,
    type,
    null
  )
  gl.bindTexture(gl.TEXTURE_2D, null)
  return texture
}

function createFramebuffer(
  gl: WebGL2RenderingContext,
  resources: FireP027GlResources,
  textures: readonly WebGLTexture[]
): WebGLFramebuffer {
  const framebuffer = resources.createFramebuffer()
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer)
  const attachments = textures.map((texture, index) => {
    const attachment = gl.COLOR_ATTACHMENT0 + index
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      attachment,
      gl.TEXTURE_2D,
      texture,
      0
    )
    return attachment
  })
  gl.drawBuffers(attachments)
  assertFramebufferComplete(gl, 'P027 framebuffer')
  gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  return framebuffer
}

function uniform(
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
  name: string
): WebGLUniformLocation {
  const location = gl.getUniformLocation(program, name)
  if (location === null) {
    throw new Error(`Required P027 uniform ${name} is inactive or missing`)
  }
  return location
}

function assertFramebufferComplete(
  gl: WebGL2RenderingContext,
  label: string
): void {
  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER)
  if (status !== gl.FRAMEBUFFER_COMPLETE) {
    throw new Error(`${label} incomplete: 0x${status.toString(16)}`)
  }
}

function bindTextureUnit(
  gl: WebGL2RenderingContext,
  unit: number,
  target: number,
  texture: WebGLTexture
): void {
  gl.activeTexture(gl.TEXTURE0 + unit)
  gl.bindTexture(target, texture)
}

function assertNoGlError(gl: WebGL2RenderingContext, label: string): void {
  const error = gl.getError()
  if (error !== gl.NO_ERROR) {
    throw new Error(`${label}: WebGL error 0x${error.toString(16)}`)
  }
}

function numberGlParameter(gl: WebGL2RenderingContext, name: number): number {
  const value = gl.getParameter(name)
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function mulberry32(seed: number): () => number {
  let value = seed >>> 0
  return () => {
    value += 0x6d2b79f5
    let mixed = value
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1)
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61)
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296
  }
}

function clamp(value: number, minimum: number, maximum: number): number {
  const finite = Number.isFinite(value) ? value : minimum
  return Math.min(maximum, Math.max(minimum, finite))
}
