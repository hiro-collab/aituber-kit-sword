export const THUNDER_WEBGL2_CANDIDATE_COUNT = 42
export const THUNDER_WEBGL2_SOURCE_COUNT = 21
export const THUNDER_WEBGL2_RIBBON_SAMPLE_COUNT = 30
export const THUNDER_WEBGL2_RIBBON_SEGMENTS =
  THUNDER_WEBGL2_RIBBON_SAMPLE_COUNT - 1
export const THUNDER_WEBGL2_RIBBON_SIDES = 2
export const THUNDER_WEBGL2_SAMPLE_COORDINATE_LIMIT = 4
export const THUNDER_WEBGL2_SAMPLE_DISPLACEMENT_LIMIT = 4
export const THUNDER_WEBGL2_SAMPLE_WIDTH_LIMIT = 0.12
export const THUNDER_WEBGL2_VERTICES_PER_CONNECTION =
  THUNDER_WEBGL2_RIBBON_SAMPLE_COUNT * THUNDER_WEBGL2_RIBBON_SIDES
export const THUNDER_WEBGL2_TOTAL_RIBBON_VERTICES =
  THUNDER_WEBGL2_SOURCE_COUNT * THUNDER_WEBGL2_VERTICES_PER_CONNECTION
export const THUNDER_WEBGL2_MAX_DRAIN_MS = 5_000
export const THUNDER_WEBGL2_MAX_RESOURCE_COUNT = 19

export const THUNDER_WEBGL2_PASS_GRAPH = Object.freeze([
  'raw',
  'blur-1',
  'blur-2',
  'blur-3',
  'blur-4',
  'blur-5',
  'blur-6',
  'bloom',
  'temporal-feedback-final',
] as const)

export type ThunderWebGl2Pass = (typeof THUNDER_WEBGL2_PASS_GRAPH)[number]

export interface ThunderWebGl2Point {
  x: number
  y: number
}

export interface ThunderWebGl2Candidate extends ThunderWebGl2Point {
  index: number
}

export interface ThunderWebGl2RibbonSample {
  along: number
  centerX: number
  centerY: number
  displacement: number
  leftX: number
  leftY: number
  rightX: number
  rightY: number
  width: number
}

export interface ThunderWebGl2Connection {
  pIndex: number
  qIndex: number
  source: Readonly<ThunderWebGl2Candidate>
  target: Readonly<ThunderWebGl2Candidate>
  bornAtMs: number
  lifeMs: number
  seed: number
  ribbon: readonly Readonly<ThunderWebGl2RibbonSample>[]
}

export interface ThunderWebGl2Topology {
  seed: number
  epoch: number
  bornAtMs: number
  cadenceMs: number
  candidates: readonly Readonly<ThunderWebGl2Candidate>[]
  connections: readonly Readonly<ThunderWebGl2Connection>[]
}

export interface ThunderWebGl2Tone {
  coreWidth: number
  haloWidth: number
  coreLuminance: number
  haloLuminance: number
  feedback: number
  pulse: number
}

export interface ThunderWebGl2SurfaceBoundary {
  readonly gl: WebGL2RenderingContext | null
  readonly width: number
  readonly height: number
}

export type ThunderWebGl2ResourceKind =
  | 'shader'
  | 'program'
  | 'buffer'
  | 'vertexArray'
  | 'texture'
  | 'framebuffer'

export type ThunderWebGl2FailureClass =
  | 'context-unavailable'
  | 'capability-unavailable'
  | 'allocation-failed'
  | 'compile-failed'
  | 'frame-invalid'
  | 'draw-failed'
  | 'resize-failed'
  | 'cleanup-incomplete'

export type ThunderWebGl2EngineState = 'ready' | 'quarantined' | 'disposed'

export type ThunderWebGl2EngineStatus =
  | 'rendered'
  | 'cleared'
  | 'resized'
  | 'blocked'
  | 'cleanup-incomplete'
  | 'disposed'

export interface ThunderWebGl2EngineResult {
  status: ThunderWebGl2EngineStatus
  state: ThunderWebGl2EngineState
  failure: ThunderWebGl2FailureClass | null
}

export interface ThunderWebGl2ResourceCounts {
  shader: number
  program: number
  buffer: number
  vertexArray: number
  texture: number
  framebuffer: number
  total: number
}

export interface ThunderWebGl2EngineAudit {
  state: ThunderWebGl2EngineState
  failure: ThunderWebGl2FailureClass | null
  width: number
  height: number
  drawCount: number
  resizeCount: number
  feedbackIndex: 0 | 1
  passGraph: readonly ThunderWebGl2Pass[]
  resources: Readonly<ThunderWebGl2ResourceCounts>
  cleanupAttemptedKinds: readonly ThunderWebGl2ResourceKind[]
}

export interface ThunderWebGl2EngineFrame {
  ribbons: readonly (readonly Readonly<ThunderWebGl2RibbonSample>[])[]
  tone: Readonly<ThunderWebGl2Tone>
}

export type ThunderWebGl2RendererState =
  | 'idle'
  | 'running'
  | 'paused'
  | 'draining'
  | 'stopped'
  | 'quarantined'
  | 'disposed'

export type ThunderWebGl2RendererStatus =
  | 'started'
  | 'paused'
  | 'resumed'
  | 'rendered'
  | 'draining'
  | 'stopped'
  | 'reset'
  | 'emergency-stopped'
  | 'blocked'
  | 'disposed'

export interface ThunderWebGl2RendererResult {
  status: ThunderWebGl2RendererStatus
  state: ThunderWebGl2RendererState
  failure: ThunderWebGl2FailureClass | null
}

export interface ThunderWebGl2RendererSnapshot {
  state: ThunderWebGl2RendererState
  failure: ThunderWebGl2FailureClass | null
  seed: number
  reducedMotion: boolean
  birthsEnabled: boolean
  topologyEpoch: number | null
  connectionCount: number
  drainDeadlineMs: number | null
  pausedAtMs: number | null
  engine: Readonly<ThunderWebGl2EngineAudit>
}
