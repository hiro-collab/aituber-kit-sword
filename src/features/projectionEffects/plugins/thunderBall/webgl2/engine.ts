import {
  THUNDER_WEBGL2_BLUR_SCALES,
  THUNDER_WEBGL2_BLUR_STAGE_COUNT,
  THUNDER_WEBGL2_BLUR_WEIGHTS,
  THUNDER_WEBGL2_MAX_DRAIN_MS,
  THUNDER_WEBGL2_MAX_RESOURCE_COUNT,
  THUNDER_WEBGL2_PASS_GRAPH,
  THUNDER_WEBGL2_RIBBON_SAMPLE_COUNT,
  THUNDER_WEBGL2_RIBBON_SIDES,
  THUNDER_WEBGL2_SAMPLE_COORDINATE_LIMIT,
  THUNDER_WEBGL2_SAMPLE_DISPLACEMENT_LIMIT,
  THUNDER_WEBGL2_SAMPLE_WIDTH_LIMIT,
  THUNDER_WEBGL2_SOURCE_COUNT,
  THUNDER_WEBGL2_SOURCE_RADIUS_LIMIT,
  THUNDER_WEBGL2_TOTAL_RIBBON_VERTICES,
  type ThunderWebGl2EngineAudit,
  type ThunderWebGl2EngineFrame,
  type ThunderWebGl2EngineResult,
  type ThunderWebGl2EngineState,
  type ThunderWebGl2FailureClass,
  type ThunderWebGl2GpuFailureStage,
  type ThunderWebGl2ResourceCounts,
  type ThunderWebGl2ResourceKind,
  type ThunderWebGl2SurfaceBoundary,
} from './contracts'
import {
  THUNDER_WEBGL2_BLUR_FRAGMENT_SHADER,
  THUNDER_WEBGL2_BLOOM_FRAGMENT_SHADER,
  THUNDER_WEBGL2_FULLSCREEN_VERTEX_SHADER,
  THUNDER_WEBGL2_RIBBON_FRAGMENT_SHADER,
  THUNDER_WEBGL2_RIBBON_VERTEX_SHADER,
  THUNDER_WEBGL2_TEMPORAL_FRAGMENT_SHADER,
} from './shaders'

type TargetName = 'raw' | 'blurA' | 'blurB' | 'bloom' | 'historyA' | 'historyB'

interface RenderTarget {
  texture: WebGLTexture
  framebuffer: WebGLFramebuffer
}

interface ThunderPrograms {
  ribbon: WebGLProgram
  blur: WebGLProgram
  bloom: WebGLProgram
  temporal: WebGLProgram
}

const RESOURCE_KINDS: readonly ThunderWebGl2ResourceKind[] = Object.freeze([
  'shader',
  'buffer',
  'vertexArray',
  'framebuffer',
  'texture',
  'program',
])

export class ThunderBallWebGl2Engine {
  private readonly gl: WebGL2RenderingContext | null
  private readonly resources: ThunderWebGl2ResourceLedger | null
  private stateValue: ThunderWebGl2EngineState = 'quarantined'
  private failureValue: ThunderWebGl2FailureClass | null = null
  private failureStageValue: ThunderWebGl2GpuFailureStage = 'none'
  private widthValue = 0
  private heightValue = 0
  private drawCountValue = 0
  private resizeCountValue = 0
  private feedbackIndexValue: 0 | 1 = 0
  private programs: ThunderPrograms | null = null
  private ribbonBuffer: WebGLBuffer | null = null
  private ribbonVao: WebGLVertexArrayObject | null = null
  private fullscreenVao: WebGLVertexArrayObject | null = null
  private targets: Record<TargetName, RenderTarget> | null = null

  constructor(boundary: Readonly<ThunderWebGl2SurfaceBoundary>) {
    this.gl = boundary.gl
    this.resources = this.gl ? new ThunderWebGl2ResourceLedger(this.gl) : null
    if (!this.gl || !this.resources) {
      this.failureValue = 'context-unavailable'
      return
    }

    let failure: ThunderWebGl2FailureClass = 'capability-unavailable'
    try {
      this.assertCapabilities()
      failure = 'allocation-failed'
      this.ribbonBuffer = this.resources.createBuffer()
      this.ribbonVao = this.resources.createVertexArray()
      this.fullscreenVao = this.resources.createVertexArray()
      this.configureRibbonGeometry()
      failure = 'compile-failed'
      this.programs = {
        ribbon: this.createProgram(
          THUNDER_WEBGL2_RIBBON_VERTEX_SHADER,
          THUNDER_WEBGL2_RIBBON_FRAGMENT_SHADER
        ),
        blur: this.createProgram(
          THUNDER_WEBGL2_FULLSCREEN_VERTEX_SHADER,
          THUNDER_WEBGL2_BLUR_FRAGMENT_SHADER
        ),
        bloom: this.createProgram(
          THUNDER_WEBGL2_FULLSCREEN_VERTEX_SHADER,
          THUNDER_WEBGL2_BLOOM_FRAGMENT_SHADER
        ),
        temporal: this.createProgram(
          THUNDER_WEBGL2_FULLSCREEN_VERTEX_SHADER,
          THUNDER_WEBGL2_TEMPORAL_FRAGMENT_SHADER
        ),
      }
      failure = 'allocation-failed'
      this.targets = this.allocateTargets(
        boundedSize(boundary.width),
        boundedSize(boundary.height)
      )
      this.widthValue = boundedSize(boundary.width)
      this.heightValue = boundedSize(boundary.height)
      this.clearTargets()
      if (this.resources.count > THUNDER_WEBGL2_MAX_RESOURCE_COUNT) {
        throw new Error('resource ceiling exceeded')
      }
      this.stateValue = 'ready'
      this.failureValue = null
    } catch {
      this.quarantine(failure)
    }
  }

  render(frame: Readonly<ThunderWebGl2EngineFrame>): ThunderWebGl2EngineResult {
    if (!this.isReady()) return this.blockedResult()
    if (!isBoundedEngineFrame(frame)) return this.rejectFrame()
    const gl = this.gl as WebGL2RenderingContext
    const programs = this.programs as ThunderPrograms
    const targets = this.targets as Record<TargetName, RenderTarget>
    let activeStage: ThunderWebGl2GpuFailureStage = 'preflight'
    try {
      this.assertGpuBoundary(activeStage)
      activeStage = 'raw'
      gl.bindFramebuffer(gl.FRAMEBUFFER, targets.raw.framebuffer)
      gl.viewport(0, 0, this.widthValue, this.heightValue)
      gl.clearColor(0, 0, 0, 0)
      gl.clear(gl.COLOR_BUFFER_BIT)
      gl.enable(gl.BLEND)
      gl.blendEquation(gl.MAX)
      gl.blendFunc(gl.ONE, gl.ONE)
      gl.useProgram(programs.ribbon)
      gl.bindVertexArray(this.ribbonVao)
      gl.uniform4f(
        gl.getUniformLocation(programs.ribbon, 'uTone'),
        clamp(frame.tone.coreWidth, 0.01, 0.4),
        clamp(frame.tone.haloWidth, 0.2, 1),
        clamp(frame.tone.coreLuminance, 0, 4),
        clamp(frame.tone.haloLuminance, 0, 2)
      )
      for (
        let ribbonIndex = 0;
        ribbonIndex < frame.ribbons.length;
        ribbonIndex += 1
      ) {
        const ribbon = frame.ribbons[ribbonIndex] as Readonly<
          ThunderWebGl2EngineFrame['ribbons'][number]
        >
        const vertices = flattenRibbon(ribbon)
        if (vertices.length === 0) continue
        gl.uniform1f(
          gl.getUniformLocation(programs.ribbon, 'uSourceEnergy'),
          clamp(frame.sources?.[ribbonIndex]?.energy ?? 0, 0, 1)
        )
        gl.bindBuffer(gl.ARRAY_BUFFER, this.ribbonBuffer)
        gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.DYNAMIC_DRAW)
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, vertices.length / 4)
      }
      gl.disable(gl.BLEND)
      this.assertGpuBoundary(activeStage)

      let previousBlur = targets.raw.texture
      for (
        let stageIndex = 0;
        stageIndex < THUNDER_WEBGL2_BLUR_STAGE_COUNT;
        stageIndex += 1
      ) {
        activeStage = 'blur'
        const target = stageIndex % 2 === 0 ? targets.blurA : targets.blurB
        const scale = THUNDER_WEBGL2_BLUR_SCALES[stageIndex] as number
        this.runBlurPass(
          targets.raw.texture,
          previousBlur,
          target.framebuffer,
          scale / this.widthValue,
          scale / this.heightValue,
          THUNDER_WEBGL2_BLUR_WEIGHTS[stageIndex] as number,
          stageIndex === 0 ? 0 : 1
        )
        previousBlur = target.texture
        this.assertGpuBoundary(activeStage)
      }
      activeStage = 'bloom'
      this.runBloomPass(
        targets.raw.texture,
        previousBlur,
        targets.bloom.framebuffer,
        clamp(frame.tone.bloomGain, 0, 2)
      )
      this.assertGpuBoundary(activeStage)

      activeStage = 'temporal'
      const historyRead =
        this.feedbackIndexValue === 0 ? targets.historyA : targets.historyB
      const historyWrite =
        this.feedbackIndexValue === 0 ? targets.historyB : targets.historyA
      this.runTemporalFinalPass(
        targets.bloom.texture,
        historyRead.texture,
        historyWrite,
        clamp(frame.tone.feedback, 0, 0.82),
        clamp(frame.tone.exposure, 0.5, 2),
        clamp(frame.tone.gamma, 0.6, 1.4)
      )
      this.assertGpuBoundary(activeStage)
      activeStage = 'presentation'
      this.runPresentationPass(historyWrite.texture)
      this.assertGpuBoundary(activeStage)
      this.feedbackIndexValue = this.feedbackIndexValue === 0 ? 1 : 0
      this.drawCountValue += 1
      return this.result('rendered')
    } catch {
      if (this.failureStageValue === 'none') {
        this.failureStageValue = activeStage
      }
      this.quarantine('draw-failed')
      return this.blockedResult()
    }
  }

  resize(width: number, height: number): ThunderWebGl2EngineResult {
    if (!this.isReady()) return this.blockedResult()
    const nextWidth = boundedSize(width)
    const nextHeight = boundedSize(height)
    if (nextWidth === this.widthValue && nextHeight === this.heightValue) {
      return this.result('resized')
    }

    let replacement: Record<TargetName, RenderTarget> | null = null
    try {
      replacement = this.allocateTargets(nextWidth, nextHeight)
      const previous = this.targets as Record<TargetName, RenderTarget>
      this.targets = replacement
      replacement = null
      this.deleteTargets(previous)
      this.widthValue = nextWidth
      this.heightValue = nextHeight
      this.feedbackIndexValue = 0
      this.resizeCountValue += 1
      this.clearTargets()
      if (
        (this.resources?.count ?? Number.POSITIVE_INFINITY) >
        THUNDER_WEBGL2_MAX_RESOURCE_COUNT
      ) {
        throw new Error('resource ceiling exceeded')
      }
      return this.result('resized')
    } catch {
      if (replacement) this.deleteTargets(replacement)
      this.quarantine('resize-failed')
      return this.blockedResult()
    }
  }

  reset(): ThunderWebGl2EngineResult {
    return this.clear()
  }

  clear(): ThunderWebGl2EngineResult {
    if (!this.isReady()) return this.blockedResult()
    try {
      this.clearTargets()
      this.feedbackIndexValue = 0
      return this.result('cleared')
    } catch {
      this.quarantine('draw-failed')
      return this.blockedResult()
    }
  }

  dispose(): ThunderWebGl2EngineResult {
    if (this.stateValue === 'disposed') return this.result('disposed')
    const complete = this.attemptCleanup()
    if (complete) {
      this.stateValue = 'disposed'
      this.failureValue = null
      this.targets = null
      this.programs = null
      this.ribbonBuffer = null
      this.ribbonVao = null
      this.fullscreenVao = null
      return this.result('disposed')
    }
    this.stateValue = 'quarantined'
    this.failureValue = 'cleanup-incomplete'
    return this.result('cleanup-incomplete')
  }

  audit(): Readonly<ThunderWebGl2EngineAudit> {
    return Object.freeze({
      state: this.stateValue,
      failure: this.failureValue,
      failureStage: this.failureStageValue,
      width: this.widthValue,
      height: this.heightValue,
      drawCount: this.drawCountValue,
      resizeCount: this.resizeCountValue,
      feedbackIndex: this.feedbackIndexValue,
      passGraph: THUNDER_WEBGL2_PASS_GRAPH,
      blurScales: THUNDER_WEBGL2_BLUR_SCALES,
      blurWeights: THUNDER_WEBGL2_BLUR_WEIGHTS,
      resources: Object.freeze(
        this.resources?.counts() ?? emptyResourceCounts()
      ),
      cleanupAttemptedKinds: Object.freeze([
        ...(this.resources?.cleanupAttemptedKinds ?? []),
      ]),
    })
  }

  private assertCapabilities(): void {
    const gl = this.gl as WebGL2RenderingContext
    const maxTextureSize = numberParameter(gl, gl.MAX_TEXTURE_SIZE)
    const maxTextureUnits = numberParameter(gl, gl.MAX_TEXTURE_IMAGE_UNITS)
    const maxVertexAttributes = numberParameter(gl, gl.MAX_VERTEX_ATTRIBS)
    if (
      gl.getExtension('EXT_color_buffer_float') === null ||
      maxTextureSize < 1 ||
      maxTextureUnits < 3 ||
      maxVertexAttributes < 3
    ) {
      throw new Error('capability unavailable')
    }
  }

  private configureRibbonGeometry(): void {
    const gl = this.gl as WebGL2RenderingContext
    gl.bindVertexArray(this.ribbonVao)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.ribbonBuffer)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 16, 0)
    gl.enableVertexAttribArray(1)
    gl.vertexAttribPointer(1, 1, gl.FLOAT, false, 16, 8)
    gl.enableVertexAttribArray(2)
    gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 16, 12)
    gl.bindVertexArray(null)
  }

  private createProgram(
    vertexSource: string,
    fragmentSource: string
  ): WebGLProgram {
    const gl = this.gl as WebGL2RenderingContext
    const resources = this.resources as ThunderWebGl2ResourceLedger
    const program = resources.createProgram()
    let vertex: WebGLShader | null = null
    let fragment: WebGLShader | null = null
    let programReady = false
    try {
      vertex = compileShader(gl, resources, gl.VERTEX_SHADER, vertexSource)
      fragment = compileShader(
        gl,
        resources,
        gl.FRAGMENT_SHADER,
        fragmentSource
      )
      gl.attachShader(program, vertex)
      gl.attachShader(program, fragment)
      gl.linkProgram(program)
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        throw new Error('program link failed')
      }
      programReady = true
    } catch {
      programReady = false
    }

    let shaderCleanupComplete = true
    if (vertex && !resources.deleteShader(vertex)) {
      shaderCleanupComplete = false
    }
    if (fragment && !resources.deleteShader(fragment)) {
      shaderCleanupComplete = false
    }
    if (!programReady || !shaderCleanupComplete) {
      resources.deleteProgram(program)
      throw new Error('program preparation failed')
    }
    return program
  }

  private allocateTargets(
    width: number,
    height: number
  ): Record<TargetName, RenderTarget> {
    const raw = this.allocateTarget(width, height)
    const blurA = this.allocateTarget(width, height)
    const blurB = this.allocateTarget(width, height)
    const bloom = this.allocateTarget(width, height)
    const historyA = this.allocateTarget(width, height)
    const historyB = this.allocateTarget(width, height)
    return { raw, blurA, blurB, bloom, historyA, historyB }
  }

  private allocateTarget(width: number, height: number): RenderTarget {
    const gl = this.gl as WebGL2RenderingContext
    const resources = this.resources as ThunderWebGl2ResourceLedger
    const texture = resources.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA16F,
      width,
      height,
      0,
      gl.RGBA,
      gl.HALF_FLOAT,
      null
    )
    const framebuffer = resources.createFramebuffer()
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer)
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      texture,
      0
    )
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error('framebuffer incomplete')
    }
    return { texture, framebuffer }
  }

  private deleteTargets(targets: Record<TargetName, RenderTarget>): void {
    const resources = this.resources as ThunderWebGl2ResourceLedger
    let incomplete = false
    for (const target of Object.values(targets)) {
      if (!resources.deleteFramebuffer(target.framebuffer)) incomplete = true
      if (!resources.deleteTexture(target.texture)) incomplete = true
    }
    if (incomplete) throw new Error('target cleanup incomplete')
  }

  private clearTargets(): void {
    const gl = this.gl as WebGL2RenderingContext
    const targets = this.targets as Record<TargetName, RenderTarget>
    gl.clearColor(0, 0, 0, 0)
    for (const target of Object.values(targets)) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer)
      gl.clear(gl.COLOR_BUFFER_BIT)
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.clear(gl.COLOR_BUFFER_BIT)
  }

  private runBlurPass(
    raw: WebGLTexture,
    previous: WebGLTexture,
    target: WebGLFramebuffer,
    stepX: number,
    stepY: number,
    stageWeight: number,
    previousWeight: number
  ): void {
    const gl = this.gl as WebGL2RenderingContext
    const program = (this.programs as ThunderPrograms).blur
    gl.bindFramebuffer(gl.FRAMEBUFFER, target)
    gl.useProgram(program)
    gl.bindVertexArray(this.fullscreenVao)
    bindTexture(gl, program, 'uRaw', raw, 0)
    bindTexture(gl, program, 'uPrevious', previous, 1)
    gl.uniform2f(gl.getUniformLocation(program, 'uTexelStep'), stepX, stepY)
    gl.uniform1f(gl.getUniformLocation(program, 'uStageWeight'), stageWeight)
    gl.uniform1f(
      gl.getUniformLocation(program, 'uPreviousWeight'),
      previousWeight
    )
    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }

  private runBloomPass(
    raw: WebGLTexture,
    blurred: WebGLTexture,
    target: WebGLFramebuffer,
    bloomGain: number
  ): void {
    const gl = this.gl as WebGL2RenderingContext
    const program = (this.programs as ThunderPrograms).bloom
    gl.bindFramebuffer(gl.FRAMEBUFFER, target)
    gl.useProgram(program)
    gl.bindVertexArray(this.fullscreenVao)
    bindTexture(gl, program, 'uRaw', raw, 0)
    bindTexture(gl, program, 'uBlurred', blurred, 1)
    gl.uniform1f(gl.getUniformLocation(program, 'uBloomGain'), bloomGain)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }

  private runTemporalFinalPass(
    current: WebGLTexture,
    history: WebGLTexture,
    target: Readonly<RenderTarget>,
    feedback: number,
    exposure: number,
    gamma: number
  ): void {
    const gl = this.gl as WebGL2RenderingContext
    const program = (this.programs as ThunderPrograms).temporal
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer)
    gl.useProgram(program)
    gl.bindVertexArray(this.fullscreenVao)
    bindTexture(gl, program, 'uCurrent', current, 0)
    bindTexture(gl, program, 'uHistory', history, 1)
    gl.uniform1f(gl.getUniformLocation(program, 'uFeedback'), feedback)
    gl.uniform1f(gl.getUniformLocation(program, 'uExposure'), exposure)
    gl.uniform1f(gl.getUniformLocation(program, 'uGamma'), gamma)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }

  private runPresentationPass(temporal: WebGLTexture): void {
    const gl = this.gl as WebGL2RenderingContext
    const program = (this.programs as ThunderPrograms).bloom
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.viewport(0, 0, this.widthValue, this.heightValue)
    gl.disable(gl.BLEND)
    gl.useProgram(program)
    gl.bindVertexArray(this.fullscreenVao)
    bindTexture(gl, program, 'uRaw', temporal, 0)
    bindTexture(gl, program, 'uBlurred', temporal, 1)
    gl.uniform1f(gl.getUniformLocation(program, 'uBloomGain'), 0)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }

  private assertGpuBoundary(stage: ThunderWebGl2GpuFailureStage): void {
    const gl = this.gl as WebGL2RenderingContext
    if (typeof gl.isContextLost === 'function' && gl.isContextLost.call(gl)) {
      this.failureStageValue = 'context-lost'
      throw new Error('thunder WebGL2 context unavailable')
    }
    if (gl.getError() !== gl.NO_ERROR) {
      this.failureStageValue = stage
      throw new Error('thunder WebGL2 pass unavailable')
    }
  }

  private quarantine(failure: ThunderWebGl2FailureClass): void {
    this.stateValue = 'quarantined'
    this.failureValue = failure
    if (!this.attemptCleanup()) this.failureValue = 'cleanup-incomplete'
  }

  private rejectFrame(): ThunderWebGl2EngineResult {
    this.stateValue = 'quarantined'
    this.failureValue = 'frame-invalid'
    this.failureStageValue = 'preflight'
    return this.result('blocked')
  }

  private attemptCleanup(): boolean {
    if (!this.resources) return true
    return this.resources.disposeAll()
  }

  private isReady(): boolean {
    return (
      this.stateValue === 'ready' &&
      this.failureValue === null &&
      this.gl !== null &&
      this.programs !== null &&
      this.targets !== null
    )
  }

  private blockedResult(): ThunderWebGl2EngineResult {
    return this.result(
      this.failureValue === 'cleanup-incomplete'
        ? 'cleanup-incomplete'
        : 'blocked'
    )
  }

  private result(
    status: ThunderWebGl2EngineResult['status']
  ): ThunderWebGl2EngineResult {
    return Object.freeze({
      status,
      state: this.stateValue,
      failure: this.failureValue,
      failureStage: this.failureStageValue,
    })
  }
}

class ThunderWebGl2ResourceLedger {
  private readonly shaders = new Set<WebGLShader>()
  private readonly programs = new Set<WebGLProgram>()
  private readonly buffers = new Set<WebGLBuffer>()
  private readonly vertexArrays = new Set<WebGLVertexArrayObject>()
  private readonly textures = new Set<WebGLTexture>()
  private readonly framebuffers = new Set<WebGLFramebuffer>()
  private readonly cleanupAttempts = new Set<ThunderWebGl2ResourceKind>()

  constructor(private readonly gl: WebGL2RenderingContext) {}

  get count(): number {
    return this.counts().total
  }

  get cleanupAttemptedKinds(): readonly ThunderWebGl2ResourceKind[] {
    return RESOURCE_KINDS.filter((kind) => this.cleanupAttempts.has(kind))
  }

  createShader(type: number): WebGLShader {
    return this.allocate('shader', this.shaders, () =>
      this.gl.createShader(type)
    )
  }

  createProgram(): WebGLProgram {
    return this.allocate('program', this.programs, () =>
      this.gl.createProgram()
    )
  }

  createBuffer(): WebGLBuffer {
    return this.allocate('buffer', this.buffers, () => this.gl.createBuffer())
  }

  createVertexArray(): WebGLVertexArrayObject {
    return this.allocate('vertexArray', this.vertexArrays, () =>
      this.gl.createVertexArray()
    )
  }

  createTexture(): WebGLTexture {
    return this.allocate('texture', this.textures, () =>
      this.gl.createTexture()
    )
  }

  createFramebuffer(): WebGLFramebuffer {
    return this.allocate('framebuffer', this.framebuffers, () =>
      this.gl.createFramebuffer()
    )
  }

  deleteProgram(value: WebGLProgram): boolean {
    return this.deleteOne('program', this.programs, value, (resource) =>
      this.gl.deleteProgram(resource)
    )
  }

  deleteShader(value: WebGLShader): boolean {
    return this.deleteOne('shader', this.shaders, value, (resource) =>
      this.gl.deleteShader(resource)
    )
  }

  deleteTexture(value: WebGLTexture): boolean {
    return this.deleteOne('texture', this.textures, value, (resource) =>
      this.gl.deleteTexture(resource)
    )
  }

  deleteFramebuffer(value: WebGLFramebuffer): boolean {
    return this.deleteOne('framebuffer', this.framebuffers, value, (resource) =>
      this.gl.deleteFramebuffer(resource)
    )
  }

  disposeAll(): boolean {
    let complete = true
    complete =
      this.deleteSet('shader', this.shaders, (value) =>
        this.gl.deleteShader(value)
      ) && complete
    complete =
      this.deleteSet('buffer', this.buffers, (value) =>
        this.gl.deleteBuffer(value)
      ) && complete
    complete =
      this.deleteSet('vertexArray', this.vertexArrays, (value) =>
        this.gl.deleteVertexArray(value)
      ) && complete
    complete =
      this.deleteSet('framebuffer', this.framebuffers, (value) =>
        this.gl.deleteFramebuffer(value)
      ) && complete
    complete =
      this.deleteSet('texture', this.textures, (value) =>
        this.gl.deleteTexture(value)
      ) && complete
    complete =
      this.deleteSet('program', this.programs, (value) =>
        this.gl.deleteProgram(value)
      ) && complete
    return complete && this.count === 0
  }

  counts(): ThunderWebGl2ResourceCounts {
    const shader = this.shaders.size
    const program = this.programs.size
    const buffer = this.buffers.size
    const vertexArray = this.vertexArrays.size
    const texture = this.textures.size
    const framebuffer = this.framebuffers.size
    return {
      shader,
      program,
      buffer,
      vertexArray,
      texture,
      framebuffer,
      total: shader + program + buffer + vertexArray + texture + framebuffer,
    }
  }

  private allocate<T>(
    _kind: ThunderWebGl2ResourceKind,
    values: Set<T>,
    allocateNative: () => T | null
  ): T {
    const value = allocateNative()
    if (!value) throw new Error('resource allocation failed')
    values.add(value)
    return value
  }

  private deleteSet<T>(
    kind: ThunderWebGl2ResourceKind,
    values: Set<T>,
    deleteNative: (value: T) => void
  ): boolean {
    this.cleanupAttempts.add(kind)
    let complete = true
    for (const value of Array.from(values)) {
      try {
        deleteNative(value)
        values.delete(value)
      } catch {
        complete = false
      }
    }
    return complete
  }

  private deleteOne<T>(
    kind: ThunderWebGl2ResourceKind,
    values: Set<T>,
    value: T,
    deleteNative: (value: T) => void
  ): boolean {
    this.cleanupAttempts.add(kind)
    if (!values.has(value)) return true
    try {
      deleteNative(value)
      values.delete(value)
      return true
    } catch {
      return false
    }
  }
}

function compileShader(
  gl: WebGL2RenderingContext,
  resources: ThunderWebGl2ResourceLedger,
  type: number,
  source: string
): WebGLShader {
  const shader = resources.createShader(type)
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error('shader compile failed')
  }
  return shader
}

function bindTexture(
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
  uniformName: string,
  texture: WebGLTexture,
  unit: number
): void {
  gl.activeTexture(gl.TEXTURE0 + unit)
  gl.bindTexture(gl.TEXTURE_2D, texture)
  gl.uniform1i(gl.getUniformLocation(program, uniformName), unit)
}

function isBoundedEngineFrame(
  frame: Readonly<ThunderWebGl2EngineFrame>
): boolean {
  const ribbons = frame.ribbons
  const sources = frame.sources
  if (
    !Array.isArray(ribbons) ||
    ribbons.length > THUNDER_WEBGL2_SOURCE_COUNT ||
    !Array.isArray(sources) ||
    sources.length !== ribbons.length ||
    !isExactPassGraph(frame.passGraph) ||
    !isBoundedTone(frame.tone)
  ) {
    return false
  }

  const sourceIndices = new Set<number>()
  let totalVertices = 0
  for (let ribbonIndex = 0; ribbonIndex < ribbons.length; ribbonIndex += 1) {
    const ribbon = ribbons[ribbonIndex]
    const source = sources[ribbonIndex]
    if (
      !Array.isArray(ribbon) ||
      ribbon.length !== THUNDER_WEBGL2_RIBBON_SAMPLE_COUNT ||
      !isBoundedSourceBirth(source) ||
      sourceIndices.has(source.index)
    ) {
      return false
    }
    sourceIndices.add(source.index)
    totalVertices += ribbon.length * THUNDER_WEBGL2_RIBBON_SIDES
    if (totalVertices > THUNDER_WEBGL2_TOTAL_RIBBON_VERTICES) return false

    for (let sampleIndex = 0; sampleIndex < ribbon.length; sampleIndex += 1) {
      const sample = ribbon[sampleIndex]
      if (
        !isBoundedRibbonSample(sample) ||
        (sampleIndex === 0 &&
          (!isBoundedSourceBirth(sample.sourceBirth) ||
            sample.sourceBirth.index !== source.index ||
            sample.sourceBirth.x !== source.x ||
            sample.sourceBirth.y !== source.y)) ||
        (sampleIndex > 0 && sample.sourceBirth !== undefined)
      ) {
        return false
      }
    }
  }
  return true
}

function isExactPassGraph(
  value: ThunderWebGl2EngineFrame['passGraph']
): boolean {
  return (
    Array.isArray(value) &&
    value.length === THUNDER_WEBGL2_PASS_GRAPH.length &&
    value.every((pass, index) => pass === THUNDER_WEBGL2_PASS_GRAPH[index])
  )
}

function isBoundedTone(
  tone: Readonly<ThunderWebGl2EngineFrame['tone']>
): boolean {
  return (
    boundedFinite(tone.coreWidth, 0.01, 0.4) &&
    boundedFinite(tone.haloWidth, 0.2, 1) &&
    boundedFinite(tone.coreLuminance, 0, 4) &&
    boundedFinite(tone.haloLuminance, 0, 2) &&
    boundedFinite(tone.bloomGain, 0, 2) &&
    boundedFinite(tone.exposure, 0.5, 2) &&
    boundedFinite(tone.gamma, 0.6, 1.4) &&
    boundedFinite(tone.feedback, 0, 0.82) &&
    boundedFinite(tone.pulse, 0, 1)
  )
}

function isBoundedSourceBirth(
  value: unknown
): value is NonNullable<ThunderWebGl2EngineFrame['sources']>[number] {
  if (value === null || typeof value !== 'object') return false
  const source = value as Partial<
    NonNullable<ThunderWebGl2EngineFrame['sources']>[number]
  >
  return (
    typeof source.index === 'number' &&
    Number.isInteger(source.index) &&
    boundedFinite(source.index, 0, THUNDER_WEBGL2_SOURCE_COUNT - 1) &&
    boundedFinite(
      source.x,
      -THUNDER_WEBGL2_SAMPLE_COORDINATE_LIMIT,
      THUNDER_WEBGL2_SAMPLE_COORDINATE_LIMIT
    ) &&
    boundedFinite(
      source.y,
      -THUNDER_WEBGL2_SAMPLE_COORDINATE_LIMIT,
      THUNDER_WEBGL2_SAMPLE_COORDINATE_LIMIT
    ) &&
    boundedFinite(source.bornAtMs, 0, Number.MAX_SAFE_INTEGER) &&
    boundedFinite(source.lifeMs, 1, THUNDER_WEBGL2_MAX_DRAIN_MS) &&
    boundedFinite(source.ageMs, 0, source.lifeMs ?? 0) &&
    boundedFinite(source.radius, 0.001, THUNDER_WEBGL2_SOURCE_RADIUS_LIMIT) &&
    boundedFinite(source.energy, 0, 1)
  )
}

function isBoundedRibbonSample(value: unknown): boolean {
  if (value === null || typeof value !== 'object') return false
  const sample = value as Partial<
    ThunderWebGl2EngineFrame['ribbons'][number][number]
  >
  return (
    boundedFinite(sample.along, 0, 1) &&
    boundedFinite(
      sample.centerX,
      -THUNDER_WEBGL2_SAMPLE_COORDINATE_LIMIT,
      THUNDER_WEBGL2_SAMPLE_COORDINATE_LIMIT
    ) &&
    boundedFinite(
      sample.centerY,
      -THUNDER_WEBGL2_SAMPLE_COORDINATE_LIMIT,
      THUNDER_WEBGL2_SAMPLE_COORDINATE_LIMIT
    ) &&
    boundedFinite(
      sample.displacement,
      -THUNDER_WEBGL2_SAMPLE_DISPLACEMENT_LIMIT,
      THUNDER_WEBGL2_SAMPLE_DISPLACEMENT_LIMIT
    ) &&
    boundedFinite(
      sample.leftX,
      -THUNDER_WEBGL2_SAMPLE_COORDINATE_LIMIT,
      THUNDER_WEBGL2_SAMPLE_COORDINATE_LIMIT
    ) &&
    boundedFinite(
      sample.leftY,
      -THUNDER_WEBGL2_SAMPLE_COORDINATE_LIMIT,
      THUNDER_WEBGL2_SAMPLE_COORDINATE_LIMIT
    ) &&
    boundedFinite(
      sample.rightX,
      -THUNDER_WEBGL2_SAMPLE_COORDINATE_LIMIT,
      THUNDER_WEBGL2_SAMPLE_COORDINATE_LIMIT
    ) &&
    boundedFinite(
      sample.rightY,
      -THUNDER_WEBGL2_SAMPLE_COORDINATE_LIMIT,
      THUNDER_WEBGL2_SAMPLE_COORDINATE_LIMIT
    ) &&
    boundedFinite(sample.width, 0, THUNDER_WEBGL2_SAMPLE_WIDTH_LIMIT)
  )
}

function boundedFinite(
  value: number | undefined,
  minimum: number,
  maximum: number
): boolean {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= minimum &&
    value <= maximum
  )
}

function flattenRibbon(
  ribbon: Readonly<ThunderWebGl2EngineFrame['ribbons'][number]>
): Float32Array {
  const values = new Float32Array(ribbon.length * 8)
  let offset = 0
  for (const sample of ribbon) {
    values[offset++] = sample.leftX
    values[offset++] = sample.leftY
    values[offset++] = sample.along
    values[offset++] = -1
    values[offset++] = sample.rightX
    values[offset++] = sample.rightY
    values[offset++] = sample.along
    values[offset++] = 1
  }
  return values
}

function numberParameter(gl: WebGL2RenderingContext, name: number): number {
  const value = gl.getParameter(name)
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function boundedSize(value: number): number {
  return Math.min(8192, Math.max(1, Math.round(finiteOr(value, 1))))
}

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, finiteOr(value, minimum)))
}

function emptyResourceCounts(): ThunderWebGl2ResourceCounts {
  return {
    shader: 0,
    program: 0,
    buffer: 0,
    vertexArray: 0,
    texture: 0,
    framebuffer: 0,
    total: 0,
  }
}
