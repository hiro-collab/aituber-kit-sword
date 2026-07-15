import type {
  ProjectionEffectDefinition,
  ProjectionEffectLifecycleState,
} from './canonical/types'

export interface ProjectionEffectFrameContext {
  nowMs: number
  deltaMs: number
  parameters: Readonly<Record<string, unknown>>
}

export type ProjectionEffectRenderStatus =
  | 'started'
  | 'reset'
  | 'disposed'
  | 'rendered'
  | 'skipped-not-running'
  | 'blocked-mapping'
  | 'ignored-disposed'
  | 'invalid-parameters'
  | 'invalid-timing'
  | 'render-failed'
  | 'reset-failed'
  | 'dispose-failed'

export interface ProjectionEffectRenderResult {
  status: ProjectionEffectRenderStatus
  lifecycle: ProjectionEffectLifecycleState
  parameterErrorCount: number
}

export interface ProjectionEffectRenderer {
  render(context: ProjectionEffectFrameContext): Promise<void> | void
  reset(): Promise<void> | void
  dispose(): Promise<void> | void
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
  reset(): Promise<ProjectionEffectRenderResult>
  dispose(): Promise<ProjectionEffectRenderResult>
}
