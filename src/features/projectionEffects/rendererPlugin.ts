import type {
  ProjectionEffectDefinition,
  ProjectionEffectLifecycleState,
} from './canonical/types'

export interface ProjectionEffectFrameContext {
  nowMs: number
  deltaMs: number
  parameters: Readonly<Record<string, unknown>>
  signal?: AbortSignal
}

export type ProjectionEffectRenderStatus =
  | 'started'
  | 'stopped'
  | 'reset'
  | 'disposed'
  | 'rendered'
  | 'skipped-not-running'
  | 'blocked-mapping'
  | 'ignored-disposed'
  | 'invalid-parameters'
  | 'invalid-timing'
  | 'render-failed'
  | 'stop-failed'
  | 'reset-failed'
  | 'dispose-failed'

export interface ProjectionEffectRenderResult {
  status: ProjectionEffectRenderStatus
  lifecycle: ProjectionEffectLifecycleState
  parameterErrorCount: number
}

export interface ProjectionEffectRenderer {
  render(context: ProjectionEffectFrameContext): Promise<void> | void
  stop?(context: ProjectionEffectStopContext): Promise<void> | void
  reset(): Promise<void> | void
  dispose(): Promise<void> | void
}

export interface ProjectionEffectStopContext {
  mode: 'fade' | 'immediate'
  fadeMs: number
  signal?: AbortSignal
}

export interface ProjectionEffectRendererPlugin {
  definition: ProjectionEffectDefinition
  createRenderer(): ProjectionEffectRenderer
}

export interface ProjectionEffectSession {
  readonly definition: ProjectionEffectDefinition
  readonly lifecycle: ProjectionEffectLifecycleState
  start(): Promise<ProjectionEffectRenderResult>
  update(
    context: ProjectionEffectFrameContext
  ): Promise<ProjectionEffectRenderResult>
  stop(
    context: ProjectionEffectStopContext
  ): Promise<ProjectionEffectRenderResult>
  reset(): Promise<ProjectionEffectRenderResult>
  dispose(): Promise<ProjectionEffectRenderResult>
  terminate(): Promise<ProjectionEffectRenderResult>
}
