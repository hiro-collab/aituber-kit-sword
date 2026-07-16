import type {
  ProjectionEffectFrameContext,
  ProjectionEffectRenderer,
  ProjectionEffectRendererPlugin,
  ProjectionEffectStopContext,
} from '../../rendererPlugin'
import { fireEffectDefinition } from './definition'
import {
  FIRE_PARTICLE_FRAGMENT_SHADER,
  FIRE_PARTICLE_VERTEX_SHADER,
} from './shaders'

interface FireParticle {
  x: number
  y: number
  velocityX: number
  velocityY: number
  size: number
  heat: number
  alpha: number
  ageMs: number
  lifeMs: number
  seed: number
}

export interface FireParticleDrawConfig {
  bloomGain: number
  masterIntensity: number
  internalResolutionScale: number
  postProcessing: boolean
}

export interface FireParticleSurface {
  draw(
    particles: readonly Readonly<FireParticle>[],
    config: Readonly<FireParticleDrawConfig>
  ): void
  clear(): void
  dispose(): void
}

export interface FireParticleRendererSnapshot {
  disposed: boolean
  frameCount: number
  particleCount: number
  oldestParticleAgeMs: number
  maximumParticleLifeMs: number
  highestParticleY: number | null
  lastStopMode: ProjectionEffectStopContext['mode'] | null
}

export interface FireParticleRendererOptions {
  surface?: FireParticleSurface
  waitFrame?: (durationMs: number) => Promise<void>
  onFrame?: (snapshot: Readonly<FireParticleRendererSnapshot>) => void
}

const EMPTY_DRAW_CONFIG: FireParticleDrawConfig = {
  bloomGain: 0,
  masterIntensity: 0,
  internalResolutionScale: 1,
  postProcessing: false,
}

const FIRE_FADE_WAIT_GRACE_MS = 50
const FIRE_BROWSER_FRAME_TIMEOUT_MS = 100

export class FireParticleRenderer implements ProjectionEffectRenderer {
  private readonly particles: FireParticle[] = []
  private readonly surface?: FireParticleSurface
  private readonly waitFrame: (durationMs: number) => Promise<void>
  private readonly onFrame?: FireParticleRendererOptions['onFrame']
  private disposed = false
  private frameCount = 0
  private emissionCarry = 0
  private randomState = 0x2f6e2b1
  private lastStopMode: ProjectionEffectStopContext['mode'] | null = null
  private lastDrawConfig = EMPTY_DRAW_CONFIG

  constructor(options: FireParticleRendererOptions = {}) {
    this.surface = options.surface
    this.waitFrame = options.waitFrame ?? waitForBrowserFrame
    this.onFrame = options.onFrame
  }

  render(context: ProjectionEffectFrameContext): void {
    if (this.disposed || context.signal?.aborted) return
    const deltaMs = Math.min(context.deltaMs, 100)
    const deltaSeconds = deltaMs / 1000
    const budget = Math.floor(numberParameter(context, 'particleBudget'))
    const lifetimeMs = numberParameter(context, 'lifetimeMs')
    const upwardSpeed = numberParameter(context, 'upwardSpeed')
    const noiseStrength = numberParameter(context, 'noiseStrength')
    const dissipation = numberParameter(context, 'dissipation')

    for (const particle of this.particles) {
      particle.ageMs += deltaMs
      const turbulence =
        Math.sin(
          particle.seed * 13.17 +
            particle.ageMs * 0.012 +
            context.nowMs * 0.0017
        ) * noiseStrength
      particle.velocityX += turbulence * deltaSeconds * 0.32
      particle.velocityY += upwardSpeed * deltaSeconds * 0.18
      particle.x += particle.velocityX * deltaSeconds
      particle.y += particle.velocityY * deltaSeconds
      particle.alpha *= Math.pow(dissipation, deltaSeconds * 60)
    }
    this.removeExpiredParticles()

    const requestedEmission =
      numberParameter(context, 'emissionRate') * deltaSeconds +
      this.emissionCarry
    const spawnCount = Math.min(
      Math.floor(requestedEmission),
      Math.max(0, budget - this.particles.length)
    )
    this.emissionCarry = requestedEmission - Math.floor(requestedEmission)
    for (let index = 0; index < spawnCount; index += 1) {
      this.particles.push(this.spawnParticle(context, lifetimeMs, upwardSpeed))
    }

    this.lastDrawConfig = {
      bloomGain: numberParameter(context, 'bloomGain'),
      masterIntensity: numberParameter(context, 'masterIntensity'),
      internalResolutionScale: numberParameter(
        context,
        'internalResolutionScale'
      ),
      postProcessing: booleanParameter(context, 'postProcessing'),
    }
    this.surface?.draw(this.particles, this.lastDrawConfig)
    this.frameCount += 1
    this.onFrame?.(this.snapshot())
  }

  async stop(context: ProjectionEffectStopContext): Promise<void> {
    if (this.disposed) return
    this.lastStopMode = context.mode
    try {
      if (context.mode === 'immediate' || context.fadeMs === 0) return

      const steps = 6
      const initialAlpha = this.particles.map((particle) => particle.alpha)
      for (
        let step = 1;
        step <= steps && !this.disposed && !context.signal?.aborted;
        step += 1
      ) {
        const remaining = 1 - step / steps
        this.particles.forEach((particle, index) => {
          particle.alpha = initialAlpha[index] * remaining
        })
        this.surface?.draw(this.particles, {
          ...this.lastDrawConfig,
          masterIntensity: this.lastDrawConfig.masterIntensity * remaining,
        })
        await waitForBoundedFrame(
          this.waitFrame,
          context.fadeMs / steps,
          FIRE_FADE_WAIT_GRACE_MS,
          context.signal
        )
      }
    } finally {
      this.particles.length = 0
      if (!this.disposed) this.surface?.clear()
    }
  }

  reset(): void {
    if (this.disposed) return
    this.frameCount = 0
    this.emissionCarry = 0
    this.lastStopMode = null
    this.clearParticles()
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    let cleanupError: unknown = null
    try {
      this.clearParticles()
    } catch (error) {
      cleanupError = error
    }
    try {
      this.surface?.dispose()
    } catch (error) {
      cleanupError ??= error
    }
    if (cleanupError) throw cleanupError
  }

  snapshot(): FireParticleRendererSnapshot {
    return {
      disposed: this.disposed,
      frameCount: this.frameCount,
      particleCount: this.particles.length,
      oldestParticleAgeMs: this.particles.reduce(
        (oldest, particle) => Math.max(oldest, particle.ageMs),
        0
      ),
      maximumParticleLifeMs: this.particles.reduce(
        (maximum, particle) => Math.max(maximum, particle.lifeMs),
        0
      ),
      highestParticleY:
        this.particles.length === 0
          ? null
          : this.particles.reduce(
              (highest, particle) => Math.max(highest, particle.y),
              Number.NEGATIVE_INFINITY
            ),
      lastStopMode: this.lastStopMode,
    }
  }

  private spawnParticle(
    context: ProjectionEffectFrameContext,
    lifetimeMs: number,
    upwardSpeed: number
  ): FireParticle {
    const spread = (this.nextRandom() - 0.5) * 0.18
    const lifeVariance = 0.72 + this.nextRandom() * 0.56
    return {
      x: numberParameter(context, 'emitterX') + spread,
      y: numberParameter(context, 'emitterY'),
      velocityX: spread * 0.48,
      velocityY: upwardSpeed * (0.72 + this.nextRandom() * 0.4),
      size: numberParameter(context, 'pointSize') * (0.65 + this.nextRandom()),
      heat: Math.min(
        1,
        numberParameter(context, 'temperature') *
          (0.82 + this.nextRandom() * 0.22)
      ),
      alpha: 0.82 + this.nextRandom() * 0.18,
      ageMs: 0,
      lifeMs: lifetimeMs * lifeVariance,
      seed: this.nextRandom(),
    }
  }

  private removeExpiredParticles(): void {
    let writeIndex = 0
    for (const particle of this.particles) {
      if (
        particle.ageMs < particle.lifeMs &&
        particle.alpha > 0.01 &&
        particle.y < 1.2
      ) {
        this.particles[writeIndex] = particle
        writeIndex += 1
      }
    }
    this.particles.length = writeIndex
  }

  private clearParticles(): void {
    this.particles.length = 0
    this.surface?.clear()
  }

  private nextRandom(): number {
    this.randomState = (1664525 * this.randomState + 1013904223) >>> 0
    return this.randomState / 0x100000000
  }
}

export class FireWebGl2UnavailableError extends Error {
  readonly code = 'fire-webgl2-unavailable'

  constructor() {
    super('fire renderer requires WebGL2')
    this.name = 'FireWebGl2UnavailableError'
  }
}

export class FireWebGl2Surface implements FireParticleSurface {
  private readonly gl: WebGL2RenderingContext
  private readonly program: WebGLProgram
  private readonly buffer: WebGLBuffer
  private readonly bloomGain: WebGLUniformLocation
  private readonly masterIntensity: WebGLUniformLocation
  private disposed = false

  constructor(private readonly canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', {
      alpha: true,
      antialias: false,
      premultipliedAlpha: false,
    })
    if (!gl) throw new FireWebGl2UnavailableError()
    this.gl = gl
    this.program = createProgram(gl)
    const buffer = gl.createBuffer()
    const bloomGain = gl.getUniformLocation(this.program, 'bloomGain')
    const masterIntensity = gl.getUniformLocation(
      this.program,
      'masterIntensity'
    )
    if (!buffer || !bloomGain || !masterIntensity) {
      if (buffer) gl.deleteBuffer(buffer)
      gl.deleteProgram(this.program)
      throw new Error('fire renderer initialization failed')
    }
    this.buffer = buffer
    this.bloomGain = bloomGain
    this.masterIntensity = masterIntensity
  }

  draw(
    particles: readonly Readonly<FireParticle>[],
    config: Readonly<FireParticleDrawConfig>
  ): void {
    if (this.disposed) return
    const { gl } = this
    const scale = config.internalResolutionScale
    const width = Math.max(1, Math.round(this.canvas.clientWidth * scale))
    const height = Math.max(1, Math.round(this.canvas.clientHeight * scale))
    if (this.canvas.width !== width) this.canvas.width = width
    if (this.canvas.height !== height) this.canvas.height = height

    const values = new Float32Array(particles.length * 7)
    particles.forEach((particle, index) => {
      const offset = index * 7
      values[offset] = particle.x
      values[offset + 1] = particle.y
      values[offset + 2] = particle.size * scale
      values[offset + 3] = particle.heat
      values[offset + 4] = particle.alpha
      values[offset + 5] = Math.min(1, particle.ageMs / particle.lifeMs)
      values[offset + 6] = particle.seed
    })

    gl.viewport(0, 0, width, height)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE)
    gl.useProgram(this.program)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer)
    gl.bufferData(gl.ARRAY_BUFFER, values, gl.DYNAMIC_DRAW)
    const stride = 7 * Float32Array.BYTES_PER_ELEMENT
    bindAttribute(gl, 0, 2, stride, 0)
    bindAttribute(gl, 1, 1, stride, 2)
    bindAttribute(gl, 2, 1, stride, 3)
    bindAttribute(gl, 3, 1, stride, 4)
    bindAttribute(gl, 4, 1, stride, 5)
    gl.uniform1f(this.bloomGain, config.postProcessing ? config.bloomGain : 0)
    gl.uniform1f(this.masterIntensity, config.masterIntensity)
    gl.drawArrays(gl.POINTS, 0, particles.length)
  }

  clear(): void {
    if (this.disposed) return
    this.gl.clearColor(0, 0, 0, 0)
    this.gl.clear(this.gl.COLOR_BUFFER_BIT)
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    try {
      this.gl.deleteBuffer(this.buffer)
    } finally {
      this.gl.deleteProgram(this.program)
    }
  }
}

export function createFireParticlePlugin(
  options: FireParticleRendererOptions = {}
): ProjectionEffectRendererPlugin {
  return {
    definition: fireEffectDefinition,
    createRenderer: () => new FireParticleRenderer(options),
  }
}

export const fireParticlePlugin = createFireParticlePlugin()

function createProgram(gl: WebGL2RenderingContext): WebGLProgram {
  let vertex: WebGLShader | null = null
  let fragment: WebGLShader | null = null
  let program: WebGLProgram | null = null
  try {
    vertex = compileShader(gl, gl.VERTEX_SHADER, FIRE_PARTICLE_VERTEX_SHADER)
    fragment = compileShader(
      gl,
      gl.FRAGMENT_SHADER,
      FIRE_PARTICLE_FRAGMENT_SHADER
    )
    program = gl.createProgram()
    if (!program) throw new Error('fire renderer initialization failed')
    gl.attachShader(program, vertex)
    gl.attachShader(program, fragment)
    gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error('fire renderer shader link failed')
    }
    return program
  } catch (error) {
    if (program) gl.deleteProgram(program)
    throw error
  } finally {
    if (vertex) gl.deleteShader(vertex)
    if (fragment) gl.deleteShader(fragment)
  }
}

function compileShader(
  gl: WebGL2RenderingContext,
  kind: number,
  source: string
): WebGLShader {
  const shader = gl.createShader(kind)
  if (!shader) throw new Error('fire renderer shader creation failed')
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader)
    throw new Error('fire renderer shader compilation failed')
  }
  return shader
}

function bindAttribute(
  gl: WebGL2RenderingContext,
  location: number,
  size: number,
  stride: number,
  scalarOffset: number
): void {
  gl.enableVertexAttribArray(location)
  gl.vertexAttribPointer(
    location,
    size,
    gl.FLOAT,
    false,
    stride,
    scalarOffset * Float32Array.BYTES_PER_ELEMENT
  )
}

function numberParameter(
  context: ProjectionEffectFrameContext,
  id: string
): number {
  const value = context.parameters[id]
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function booleanParameter(
  context: ProjectionEffectFrameContext,
  id: string
): boolean {
  return context.parameters[id] === true
}

function waitForBrowserFrame(durationMs: number): Promise<void> {
  return new Promise((resolve) => {
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      resolve()
    }
    const timeout = setTimeout(finish, FIRE_BROWSER_FRAME_TIMEOUT_MS)
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(finish)
    } else {
      setTimeout(finish, Math.max(0, durationMs))
    }
  })
}

function waitForBoundedFrame(
  waitFrame: (durationMs: number) => Promise<void>,
  durationMs: number,
  graceMs: number,
  signal?: AbortSignal
): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (error?: unknown) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      signal?.removeEventListener('abort', abort)
      if (error === undefined) resolve()
      else reject(error)
    }
    const abort = () => finish()
    const timeout = setTimeout(
      () => finish(),
      Math.max(1, durationMs + graceMs)
    )
    if (signal?.aborted) {
      finish()
      return
    }
    signal?.addEventListener('abort', abort, { once: true })
    Promise.resolve()
      .then(() => waitFrame(durationMs))
      .then(
        () => finish(),
        (error) => finish(error)
      )
  })
}
