import {
  isFailClosedMappingStatus,
  type ProjectionEffectDefinition,
  type ProjectionEffectLifecycleState,
} from './canonical/types'
import {
  validateProjectionEffectDefinition,
  validateProjectionEffectParameterValues,
} from './canonical/validation'
import type {
  ProjectionEffectFrameContext,
  ProjectionEffectRenderResult,
  ProjectionEffectRenderStatus,
  ProjectionEffectRenderer,
  ProjectionEffectRendererPlugin,
  ProjectionEffectSession,
  ProjectionEffectStopContext,
} from './rendererPlugin'
import { fluidFireRelayPlugin } from './plugins/fluidFireRelay/renderer'

const MAX_FRAME_CLOCK_MS = 10_000_000_000_000
const MAX_FRAME_DELTA_MS = 1_000

interface RegisteredProjectionEffectPlugin {
  readonly definition: ProjectionEffectDefinition
  readonly createRenderer: () => ProjectionEffectRenderer
}

export class ProjectionEffectSessionCreationError extends Error {
  readonly code = 'projection-effect-renderer-create-failed'

  constructor() {
    super('projection effect renderer creation failed')
    this.name = 'ProjectionEffectSessionCreationError'
  }
}

export class ProjectionEffectRegistry {
  private readonly plugins = new Map<string, RegisteredProjectionEffectPlugin>()

  register(plugin: ProjectionEffectRendererPlugin): void {
    const validation = validateProjectionEffectDefinition(plugin.definition)
    if (!validation.ok) throw new Error('invalid projection effect definition')
    const definition = deepFreezeDefinition(validation.value)
    if (this.plugins.has(definition.id)) {
      throw new Error('projection effect id is already owned')
    }
    const createRenderer = plugin.createRenderer
    this.plugins.set(
      definition.id,
      Object.freeze({ definition, createRenderer })
    )
  }

  has(effectId: string): boolean {
    return this.plugins.has(effectId)
  }

  listEffectIds(): readonly string[] {
    return [...this.plugins.keys()]
  }

  createSession(effectId: string): ProjectionEffectSession {
    const plugin = this.plugins.get(effectId)
    if (!plugin) throw new Error('projection effect is not registered')
    try {
      return RegisteredProjectionEffectSession.create(plugin)
    } catch {
      throw new ProjectionEffectSessionCreationError()
    }
  }
}

class RegisteredProjectionEffectSession implements ProjectionEffectSession {
  readonly definition: ProjectionEffectDefinition

  private lifecycleValue: ProjectionEffectLifecycleState = 'registered'
  private operationTail: Promise<void> = Promise.resolve()
  private readonly renderer: ProjectionEffectRenderer
  private readonly abortController = new AbortController()
  private terminationPromise: Promise<ProjectionEffectRenderResult> | null =
    null
  private terminationComplete = false
  private terminationResult: ProjectionEffectRenderResult | null = null

  private constructor(plugin: RegisteredProjectionEffectPlugin) {
    this.definition = plugin.definition
    const renderer = plugin.createRenderer()
    if (!isProjectionEffectRenderer(renderer)) {
      throw new Error('invalid renderer')
    }
    this.renderer = renderer
  }

  static create(
    plugin: RegisteredProjectionEffectPlugin
  ): RegisteredProjectionEffectSession {
    return new RegisteredProjectionEffectSession(plugin)
  }

  get lifecycle(): ProjectionEffectLifecycleState {
    return this.lifecycleValue
  }

  start(): Promise<ProjectionEffectRenderResult> {
    return this.enqueue(async () => {
      if (this.isTerminatingOrDisposed()) return this.disposedResult()
      if (
        this.definition.sourceMappings.some((mapping) =>
          isFailClosedMappingStatus(mapping.status)
        )
      ) {
        this.lifecycleValue = 'suspended'
        return this.result('blocked-mapping')
      }
      this.lifecycleValue = 'running'
      return this.result('started')
    })
  }

  update(
    context: ProjectionEffectFrameContext
  ): Promise<ProjectionEffectRenderResult> {
    return this.enqueue(async () => {
      if (this.isTerminatingOrDisposed()) return this.disposedResult()
      if (this.lifecycleValue !== 'running') {
        return this.result('skipped-not-running')
      }
      if (!hasValidFrameTiming(context)) return this.result('invalid-timing')
      const parameterErrors = validateProjectionEffectParameterValues(
        this.definition.parameters,
        context.parameters
      )
      if (parameterErrors.length > 0) {
        return this.result('invalid-parameters', parameterErrors.length)
      }
      try {
        await this.renderer.render({
          ...context,
          signal: this.abortController.signal,
        })
        return this.isDisposed()
          ? this.disposedResult()
          : this.result('rendered')
      } catch {
        if (this.isTerminatingOrDisposed()) return this.disposedResult()
        this.lifecycleValue = 'suspended'
        return this.result('render-failed')
      }
    })
  }

  stop(
    context: ProjectionEffectStopContext
  ): Promise<ProjectionEffectRenderResult> {
    return this.enqueue(async () => {
      if (this.isTerminatingOrDisposed()) return this.disposedResult()
      if (!hasValidStopContext(context)) return this.result('invalid-timing')
      try {
        if (this.renderer.stop) {
          await this.renderer.stop({
            ...context,
            signal: this.abortController.signal,
          })
        } else {
          await this.renderer.reset()
        }
        if (this.isDisposed()) return this.disposedResult()
        this.lifecycleValue = 'ready'
        return this.result('stopped')
      } catch {
        if (this.isTerminatingOrDisposed()) return this.disposedResult()
        this.lifecycleValue = 'suspended'
        return this.result('stop-failed')
      }
    })
  }

  reset(): Promise<ProjectionEffectRenderResult> {
    return this.enqueue(async () => {
      if (this.isTerminatingOrDisposed()) return this.disposedResult()
      try {
        await this.renderer.reset()
        if (this.isDisposed()) return this.disposedResult()
        this.lifecycleValue = 'ready'
        return this.result('reset')
      } catch {
        if (this.isTerminatingOrDisposed()) return this.disposedResult()
        this.lifecycleValue = 'suspended'
        return this.result('reset-failed')
      }
    })
  }

  dispose(): Promise<ProjectionEffectRenderResult> {
    if (this.terminationComplete) return Promise.resolve(this.disposedResult())
    return this.beginTermination()
  }

  terminate(): Promise<ProjectionEffectRenderResult> {
    if (this.terminationComplete && this.terminationResult) {
      return Promise.resolve(this.terminationResult)
    }
    return this.beginTermination()
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operationTail.then(operation)
    this.operationTail = result.then(
      () => undefined,
      () => undefined
    )
    return result
  }

  private result(
    status: ProjectionEffectRenderStatus,
    parameterErrorCount = 0
  ): ProjectionEffectRenderResult {
    return { status, lifecycle: this.lifecycleValue, parameterErrorCount }
  }

  private disposedResult(): ProjectionEffectRenderResult {
    return this.result('ignored-disposed')
  }

  private beginTermination(): Promise<ProjectionEffectRenderResult> {
    if (this.terminationPromise) return this.terminationPromise
    const pendingOperations = this.operationTail
    this.lifecycleValue = 'disposed'
    this.abortController.abort()
    this.terminationPromise = pendingOperations
      .then(() => this.renderer.dispose())
      .then(
        () => this.result('disposed'),
        () => this.result('dispose-failed')
      )
      .then((result) => {
        this.terminationResult = result
        return result
      })
      .finally(() => {
        this.terminationComplete = true
      })
    return this.terminationPromise
  }

  private isDisposed(): boolean {
    return this.lifecycleValue === 'disposed'
  }

  private isTerminatingOrDisposed(): boolean {
    return this.terminationPromise !== null || this.isDisposed()
  }
}

function hasValidFrameTiming(context: ProjectionEffectFrameContext): boolean {
  return (
    isFiniteBoundedNumber(context.nowMs, MAX_FRAME_CLOCK_MS) &&
    isFiniteBoundedNumber(context.deltaMs, MAX_FRAME_DELTA_MS)
  )
}

function hasValidStopContext(context: ProjectionEffectStopContext): boolean {
  return (
    (context.mode === 'fade' || context.mode === 'immediate') &&
    Number.isInteger(context.fadeMs) &&
    context.fadeMs >= 0 &&
    context.fadeMs <= 1_000 &&
    (context.mode === 'fade' || context.fadeMs === 0)
  )
}

function isFiniteBoundedNumber(value: number, maximum: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= maximum
}

function isProjectionEffectRenderer(
  input: unknown
): input is ProjectionEffectRenderer {
  if (typeof input !== 'object' || input === null) return false
  const renderer = input as Partial<ProjectionEffectRenderer>
  return (
    typeof renderer.render === 'function' &&
    typeof renderer.reset === 'function' &&
    typeof renderer.dispose === 'function'
  )
}

function deepFreezeDefinition(
  definition: ProjectionEffectDefinition
): ProjectionEffectDefinition {
  const snapshot = JSON.parse(
    JSON.stringify(definition)
  ) as ProjectionEffectDefinition
  return deepFreeze(snapshot)
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) {
    return value
  }
  for (const key of Object.keys(value)) {
    deepFreeze((value as Record<string, unknown>)[key])
  }
  return Object.freeze(value)
}

export function createDefaultProjectionEffectRegistry(): ProjectionEffectRegistry {
  const registry = new ProjectionEffectRegistry()
  registry.register(fluidFireRelayPlugin)
  return registry
}
