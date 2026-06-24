import { useEffect, useRef } from 'react'

type CubeNodeKind = 'input' | 'condition' | 'tool' | 'external' | 'output'
type IndicatorLevel = 'active' | 'ok' | 'warn' | 'error' | 'offline' | 'unknown'

type CubeNode = {
  id: string
  label: string
  kind: CubeNodeKind
  row: number
  column: number
}

type Point3D = {
  x: number
  y: number
  z: number
}

type ProjectedPoint = {
  x: number
  y: number
  scale: number
}

type IndicatorNode = {
  node_id?: string
  status?: string
  phase?: string | null
  stale?: boolean
  detail?: string | null
  metrics?: Record<string, unknown>
  last_event?: Record<string, unknown> | null
  last_error?: string | null
  observed_at?: string
  ttl_ms?: number
}

type IndicatorSource = {
  available?: boolean
  stale?: boolean
  status?: string
  phase?: string | null
  detail?: string | null
  last_error?: string | null
}

type IndicatorEnvironment = {
  appliances?: Record<string, Record<string, unknown>>
  actions?: Array<Record<string, unknown>>
  vision?: Record<string, Record<string, unknown>>
  state_queries?: Record<string, Record<string, unknown>>
  sources?: Record<string, IndicatorSource>
}

type IndicatorPayload = {
  schema_version?: number
  stale?: boolean
  sequence?: number
  snapshot_id?: string
  observed_at?: string | null
  age_ms?: number | null
  environment?: IndicatorEnvironment
  nodes?: Record<string, IndicatorNode>
}

type IndicatorSnapshot = {
  payload: IndicatorPayload | null
  fetchedAt: number
  fetchOk: boolean
}

type CubeVisualStatus = {
  level: IndicatorLevel
  color: string
  intensity: number
}

type IndicatorDemoMode = 'cycle' | 'steady' | 'offline'
type AiMode =
  | 'idle'
  | 'listening'
  | 'thinking'
  | 'speaking'
  | 'executing'
  | 'alert'
  | 'offline'

type CubeRouteId =
  | 'input'
  | 'observation'
  | 'home'
  | 'speech'
  | 'display'
  | 'memory'

type CubeRoute = {
  id: CubeRouteId
  nodeIds: string[]
  color: string
  phaseOffset: number
}

type RouteVisual = {
  color: string
  active: boolean
  blocked: boolean
  intensity: number
}

const CUBE_NODES: CubeNode[] = [
  { id: 'operator', label: 'USER', kind: 'input', row: 3, column: 0 },
  { id: 'sense_io', label: 'SENSE I/O', kind: 'input', row: 3, column: 1 },
  { id: 'reflex_core', label: 'REFLEX', kind: 'tool', row: 3, column: 2 },
  {
    id: 'gesture_gate',
    label: 'GATE',
    kind: 'condition',
    row: 3,
    column: 3,
  },
  { id: 'voice_app', label: 'VOICE APP', kind: 'tool', row: 3, column: 4 },
  { id: 'thought_core', label: 'THOUGHT', kind: 'tool', row: 3, column: 5 },
  { id: 'environment', label: 'ENV', kind: 'tool', row: 1, column: 5 },
  { id: 'room_map', label: 'ROOM MAP', kind: 'output', row: 0, column: 5 },
  { id: 'devices', label: 'DEVICES', kind: 'output', row: 1, column: 6 },
  { id: 'ha_driver', label: 'HA DRIVER', kind: 'external', row: 2, column: 6 },
  { id: 'home_control', label: 'HOME CTRL', kind: 'tool', row: 3, column: 6 },
  { id: 'speaker', label: 'SPEAKER', kind: 'output', row: 4, column: 6 },
  { id: 'event_log', label: 'EVENT LOG', kind: 'output', row: 4, column: 3 },
  { id: 'expression', label: 'EXPR', kind: 'tool', row: 4, column: 4 },
  { id: 'memory_core', label: 'MEMORY', kind: 'tool', row: 5, column: 3 },
  { id: 'avatar', label: 'AVATAR', kind: 'output', row: 5, column: 4 },
  { id: 'speech_core', label: 'SPEECH', kind: 'tool', row: 5, column: 5 },
  {
    id: 'voicevox',
    label: 'VOICEVOX',
    kind: 'external',
    row: 5,
    column: 6,
  },
  { id: 'runtime_state', label: 'RUNTIME', kind: 'output', row: 6, column: 2 },
  { id: 'display', label: 'DISPLAY', kind: 'output', row: 6, column: 4 },
  { id: 'td_control', label: 'TD CTRL', kind: 'tool', row: 6, column: 5 },
  { id: 'td_output', label: 'TD OUT', kind: 'output', row: 6, column: 6 },
]

const DEFAULT_INDICATOR_URL =
  process.env.NEXT_PUBLIC_ENVIRONMENT_INDICATORS_URL ||
  'http://127.0.0.1:8790/indicators/current'

const NODE_BY_SLOT = new Map(
  CUBE_NODES.map((node) => [`${node.row}:${node.column}`, node])
)

const NODE_BY_ID = new Map(CUBE_NODES.map((node) => [node.id, node]))

const CUBE_ROUTES: CubeRoute[] = [
  {
    id: 'input',
    nodeIds: [
      'sense_io',
      'reflex_core',
      'gesture_gate',
      'voice_app',
      'thought_core',
    ],
    color: '#56d7ff',
    phaseOffset: 0,
  },
  {
    id: 'observation',
    nodeIds: ['thought_core', 'environment', 'room_map'],
    color: '#ff4fd8',
    phaseOffset: 0.17,
  },
  {
    id: 'home',
    nodeIds: ['thought_core', 'home_control', 'ha_driver', 'devices'],
    color: '#ffd166',
    phaseOffset: 0.34,
  },
  {
    id: 'speech',
    nodeIds: [
      'thought_core',
      'expression',
      'speech_core',
      'voicevox',
      'speaker',
    ],
    color: '#b98cff',
    phaseOffset: 0.51,
  },
  {
    id: 'display',
    nodeIds: ['expression', 'avatar', 'display', 'td_control', 'td_output'],
    color: '#7aa2ff',
    phaseOffset: 0.68,
  },
  {
    id: 'memory',
    nodeIds: ['thought_core', 'event_log', 'memory_core', 'runtime_state'],
    color: '#8fe388',
    phaseOffset: 0.82,
  },
]

const INDICATOR_NODE_ALIASES: Record<string, string[]> = {
  reflex_core: ['mediapipe_camera_hub', 'mediapipe', 'camera_hub'],
  gesture_gate: ['input_gate', 'gesture_rx', 'thought_core_watcher'],
  voice_app: ['thought_core_watcher', 'ai_talk_core', 'ai_talk'],
  thought_core: ['thought_core_api', 'thought_core', 'dify'],
  environment: ['environment_state_server'],
  home_control: ['home_assistant_bridge'],
  ha_driver: ['home_assistant'],
  speech_core: ['tts_service', 'voicevox'],
  voicevox: ['voicevox', 'tts_engine'],
  event_log: ['event_journal', 'memory_core', 'environment_state_server'],
  memory_core: ['memory_core', 'event_journal'],
  runtime_state: ['runtime_state', 'environment_state_server'],
  avatar: ['avatar_service'],
  expression: ['aituber_kit'],
  display: ['aituber_kit'],
  td_control: ['touchdesigner_control_gui', 'td_control_gui'],
  td_output: ['touchdesigner'],
  room_map: [
    'vision_snapshot_processor',
    'system_house_renderer',
    'house_map',
    'environment_state_server',
  ],
}

const KIND_COLORS: Record<CubeNodeKind, string> = {
  input: '#56d7ff',
  condition: '#ffd166',
  tool: '#7aa2ff',
  external: '#ff4fd8',
  output: '#b98cff',
}

const STATUS_VISUALS: Record<IndicatorLevel, CubeVisualStatus> = {
  active: { level: 'active', color: '#ff4fd8', intensity: 1.32 },
  ok: { level: 'ok', color: '#56d7ff', intensity: 1 },
  warn: { level: 'warn', color: '#ffd166', intensity: 0.92 },
  error: { level: 'error', color: '#ff4f7b', intensity: 1.18 },
  offline: { level: 'offline', color: '#5f6e80', intensity: 0.34 },
  unknown: { level: 'unknown', color: '#7aa2ff', intensity: 0.58 },
}

const colorToRgb = (value: string) => ({
  r: Number.parseInt(value.slice(1, 3), 16),
  g: Number.parseInt(value.slice(3, 5), 16),
  b: Number.parseInt(value.slice(5, 7), 16),
})

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value))

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isTrue = (value: unknown) => value === true || value === 'true'

const visual = (level: IndicatorLevel): CubeVisualStatus =>
  STATUS_VISUALS[level]

const pickIndicatorNode = (
  nodes: Record<string, IndicatorNode> | undefined,
  aliases: string[] | undefined
): IndicatorNode | undefined => {
  if (!nodes || !aliases) return undefined
  for (const alias of aliases) {
    const node = nodes[alias]
    if (node) return node
  }
  return undefined
}

const pickCubeIndicatorNode = (
  snapshot: IndicatorSnapshot | null,
  cubeNodeId: string
) =>
  pickIndicatorNode(
    snapshot?.payload?.nodes,
    INDICATOR_NODE_ALIASES[cubeNodeId]
  )

const nodeToVisual = (node: IndicatorNode | undefined) => {
  if (!node) return undefined
  const status = String(node.status || '').toLowerCase()
  const phase = String(node.phase || '').toLowerCase()
  if (node.stale || status === 'stale') return visual('warn')
  if (['offline', 'unreachable', 'down'].includes(status))
    return visual('offline')
  if (['error', 'failed', 'failure'].includes(status)) return visual('error')
  if (['degraded', 'warn', 'warning'].includes(status)) return visual('warn')
  if (['speaking', 'listening', 'running', 'active'].includes(phase)) {
    return visual('active')
  }
  if (status === 'ok') return visual('ok')
  return visual('unknown')
}

const nodePhase = (node: IndicatorNode | undefined) =>
  String(node?.phase || '').toLowerCase()

const cubeLevel = (
  cubeNodeId: string,
  snapshot: IndicatorSnapshot | null
): IndicatorLevel | undefined => {
  const node = NODE_BY_ID.get(cubeNodeId)
  return resolveCubeVisual(node, snapshot)?.level
}

const sourceToVisual = (source: IndicatorSource | undefined) => {
  if (!source) return undefined
  const status = String(source.status || '').toLowerCase()
  if (source.stale) return visual('warn')
  if (source.available === false) return visual('offline')
  if (['error', 'failed', 'failure'].includes(status)) return visual('error')
  if (source.available) return visual('ok')
  return visual('unknown')
}

const appliancesToVisual = (
  appliances: Record<string, Record<string, unknown>> | undefined,
  fallback: CubeVisualStatus | undefined
) => {
  const values = appliances ? Object.values(appliances) : []
  if (values.length === 0) return fallback
  const freshCount = values.filter((item) => !isTrue(item.stale)).length
  if (freshCount > 0) return visual('ok')
  return visual('warn')
}

const resolveCubeVisual = (
  node: CubeNode | undefined,
  snapshot: IndicatorSnapshot | null
): CubeVisualStatus | undefined => {
  if (!node || !snapshot) return undefined
  const payload = snapshot.payload
  const environment = payload?.environment
  const sources = environment?.sources
  const vision = environment?.vision

  if (!snapshot.fetchOk) {
    return node.id === 'event_log' ? visual('offline') : undefined
  }

  if (node.id === 'sense_io') {
    const camera = vision?.camera
    if (camera) {
      if (isTrue(camera.stale)) return visual('warn')
      return camera.state === 'available' ? visual('ok') : visual('offline')
    }
    return sourceToVisual(sources?.camera_hub)
  }

  if (node.id === 'reflex_core') {
    return (
      nodeToVisual(
        pickIndicatorNode(payload?.nodes, INDICATOR_NODE_ALIASES[node.id])
      ) || sourceToVisual(sources?.camera_hub)
    )
  }

  if (node.id === 'gesture_gate') {
    const swordSign = vision?.sword_sign
    if (swordSign) {
      if (isTrue(swordSign.stale)) return visual('warn')
      if (isTrue(swordSign.active)) return visual('active')
      return visual('ok')
    }
    return sourceToVisual(sources?.camera_hub)
  }

  if (node.id === 'devices') {
    return appliancesToVisual(
      environment?.appliances,
      sourceToVisual(sources?.home_assistant)
    )
  }

  if (node.id === 'environment') {
    return (
      nodeToVisual(
        pickIndicatorNode(payload?.nodes, INDICATOR_NODE_ALIASES[node.id])
      ) ||
      sourceToVisual(sources?.vision_snapshot_processor) ||
      sourceToVisual(sources?.camera_hub)
    )
  }

  if (node.id === 'home_control') {
    return (
      nodeToVisual(
        pickIndicatorNode(payload?.nodes, INDICATOR_NODE_ALIASES[node.id])
      ) || sourceToVisual(sources?.home_assistant_bridge)
    )
  }

  if (node.id === 'ha_driver') {
    return sourceToVisual(sources?.home_assistant)
  }

  if (node.id === 'room_map') {
    const stateQueries = environment?.state_queries
      ? Object.values(environment.state_queries)
      : []
    if (stateQueries.some((item) => !isTrue(item.stale))) return visual('ok')
    return (
      sourceToVisual(sources?.home_assistant) ||
      sourceToVisual(sources?.vision_snapshot_processor) ||
      sourceToVisual(sources?.camera_hub)
    )
  }

  return (
    nodeToVisual(
      pickIndicatorNode(payload?.nodes, INDICATOR_NODE_ALIASES[node.id])
    ) || undefined
  )
}

const routeHasBlockingNode = (
  route: CubeRoute,
  snapshot: IndicatorSnapshot | null
) =>
  route.nodeIds.some((nodeId) => {
    const level = cubeLevel(nodeId, snapshot)
    return level === 'error' || level === 'offline'
  })

const resolveAiMode = (snapshot: IndicatorSnapshot | null): AiMode => {
  if (!snapshot) return 'idle'
  if (!snapshot.fetchOk) return 'offline'

  const hasAlert = CUBE_NODES.some((node) => {
    const level = resolveCubeVisual(node, snapshot)?.level
    return level === 'error' || level === 'offline'
  })
  if (hasAlert) return 'alert'

  const ttsPhase = nodePhase(pickCubeIndicatorNode(snapshot, 'speech_core'))
  const voicevoxPhase = nodePhase(pickCubeIndicatorNode(snapshot, 'voicevox'))
  const avatarPhase = nodePhase(pickCubeIndicatorNode(snapshot, 'avatar'))
  if (
    [ttsPhase, voicevoxPhase, avatarPhase].some((phase) =>
      ['speaking', 'synthesizing', 'playing', 'active'].includes(phase)
    )
  ) {
    return 'speaking'
  }

  const homePhase = nodePhase(pickCubeIndicatorNode(snapshot, 'home_control'))
  if (['running', 'executing', 'active'].includes(homePhase)) {
    return 'executing'
  }

  const freshAppliance = Object.values(
    snapshot.payload?.environment?.appliances || {}
  ).some((item) => !isTrue(item.stale))
  if (freshAppliance) return 'executing'

  const thoughtPhase = nodePhase(
    pickCubeIndicatorNode(snapshot, 'thought_core')
  )
  if (
    ['thinking', 'running', 'processing', 'streaming', 'active'].includes(
      thoughtPhase
    )
  ) {
    return 'thinking'
  }

  const expressionPhase = nodePhase(
    pickCubeIndicatorNode(snapshot, 'expression')
  )
  const swordSign = snapshot.payload?.environment?.vision?.sword_sign
  if (isTrue(swordSign?.active) || expressionPhase === 'listening') {
    return 'listening'
  }

  return 'idle'
}

const routeVisual = (
  route: CubeRoute,
  snapshot: IndicatorSnapshot | null,
  mode: AiMode
): RouteVisual => {
  if (!snapshot) {
    return {
      color: route.color,
      active: false,
      blocked: false,
      intensity: 0,
    }
  }

  const blocked =
    !snapshot.fetchOk ||
    routeHasBlockingNode(route, snapshot) ||
    (mode === 'alert' && route.id === 'observation')

  const active =
    !blocked &&
    ((route.id === 'input' &&
      ['listening', 'thinking', 'speaking', 'executing'].includes(mode)) ||
      (route.id === 'observation' &&
        ['thinking', 'speaking', 'executing'].includes(mode)) ||
      (route.id === 'speech' && mode === 'speaking') ||
      (route.id === 'home' && mode === 'executing') ||
      (route.id === 'display' && ['listening', 'speaking'].includes(mode)) ||
      (route.id === 'memory' &&
        ['thinking', 'speaking', 'executing'].includes(mode)))

  return {
    color: blocked ? (snapshot.fetchOk ? '#ff4f7b' : '#5f6e80') : route.color,
    active,
    blocked,
    intensity: blocked ? 0.9 : active ? 1 : 0.24,
  }
}

const resolveIndicatorUrl = (params: URLSearchParams) => {
  const override =
    params.get('indicatorUrl') ||
    params.get('indicatorsUrl') ||
    params.get('environmentIndicatorsUrl')
  const candidate = (override || DEFAULT_INDICATOR_URL).trim()
  try {
    return new URL(candidate, window.location.href).toString()
  } catch {
    return DEFAULT_INDICATOR_URL
  }
}

const resolveIndicatorDemoMode = (
  params: URLSearchParams
): IndicatorDemoMode | null => {
  const raw = (
    params.get('indicatorDemo') ||
    params.get('indicatorsDemo') ||
    ''
  )
    .trim()
    .toLowerCase()
  if (!raw || raw === '0' || raw === 'false') return null
  if (raw === 'offline') return 'offline'
  if (raw === 'steady' || raw === 'static') return 'steady'
  return 'cycle'
}

const demoNode = (
  nodeId: string,
  status: string,
  phase = status,
  stale = false
): IndicatorNode => ({
  node_id: nodeId,
  status,
  phase,
  stale,
  ttl_ms: 5000,
  observed_at: new Date().toISOString(),
})

const buildDemoIndicatorSnapshot = (
  mode: IndicatorDemoMode,
  sequence: number
): IndicatorSnapshot => {
  if (mode === 'offline') {
    return {
      payload: null,
      fetchedAt: Date.now(),
      fetchOk: false,
    }
  }

  const step = mode === 'steady' ? 2 : sequence % 5
  const swordActive = step === 1 || step === 4
  const thoughtThinking = step === 2
  const ttsSpeaking = step === 3
  const haWarn = step === 4
  const now = new Date().toISOString()

  return {
    payload: {
      schema_version: 1,
      snapshot_id: `env_demo_${String(sequence).padStart(6, '0')}`,
      sequence,
      observed_at: now,
      age_ms: 0,
      stale: false,
      environment: {
        sources: {
          home_assistant: {
            available: !haWarn,
            stale: haWarn,
            status: haWarn ? 'stale' : 'ok',
            phase: haWarn ? 'waiting' : 'ok',
          },
          home_assistant_bridge: {
            available: true,
            stale: haWarn,
            status: haWarn ? 'stale' : 'ok',
            phase: haWarn ? 'executing' : 'ok',
          },
          camera_hub: {
            available: true,
            stale: false,
            status: 'ok',
          },
          vision_snapshot_processor: {
            available: true,
            stale: false,
            status: 'ok',
            phase: 'observing',
          },
        },
        vision: {
          camera: {
            state: 'available',
            stale: false,
          },
          sword_sign: {
            active: swordActive,
            stale: false,
          },
        },
        appliances: {
          fan: {
            state: 'on',
            stale: step >= 3,
          },
          door: {
            state: step === 4 ? 'open' : 'closed',
            stale: false,
          },
        },
        state_queries: {
          room_light: {
            available: true,
            stale: false,
            state: step === 0 ? 'dark' : 'bright',
            authority: 'vision_snapshot_processor',
          },
        },
        actions: [],
      },
      nodes: {
        home_assistant_bridge: demoNode(
          'home_assistant_bridge',
          haWarn ? 'stale' : 'ok',
          haWarn ? 'executing' : 'ok',
          haWarn
        ),
        thought_core_api: demoNode(
          'thought_core_api',
          'ok',
          thoughtThinking ? 'thinking' : swordActive ? 'listening' : 'ready'
        ),
        thought_core_watcher: demoNode(
          'thought_core_watcher',
          'ok',
          swordActive ? 'listening' : 'ready'
        ),
        aituber_kit: demoNode(
          'aituber_kit',
          'ok',
          ttsSpeaking ? 'speaking' : swordActive ? 'listening' : 'ready'
        ),
        tts_service: demoNode(
          'tts_service',
          'ok',
          ttsSpeaking ? 'speaking' : 'idle'
        ),
        voicevox: demoNode(
          'voicevox',
          'ok',
          ttsSpeaking ? 'synthesizing' : 'ready'
        ),
        environment_state_server: demoNode(
          'environment_state_server',
          'ok',
          'serving'
        ),
        vision_snapshot_processor: demoNode(
          'vision_snapshot_processor',
          'ok',
          'observing'
        ),
        touchdesigner_control_gui: demoNode(
          'touchdesigner_control_gui',
          'ok',
          'ready'
        ),
      },
    },
    fetchedAt: Date.now(),
    fetchOk: true,
  }
}

const drawModeGlow = (
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  mode: AiMode,
  time: number,
  pixelRatio: number
) => {
  const modeColor: Record<AiMode, string> = {
    idle: '#56d7ff',
    listening: '#56d7ff',
    thinking: '#ff4fd8',
    speaking: '#b98cff',
    executing: '#56d7ff',
    alert: '#ff4f7b',
    offline: '#5f6e80',
  }
  const rgb = colorToRgb(modeColor[mode])
  const breath =
    mode === 'idle' || mode === 'offline'
      ? 0.08
      : mode === 'executing'
        ? 0.1 + Math.max(0, Math.sin(time * 0.0026)) * 0.04
        : 0.14 + Math.max(0, Math.sin(time * 0.0026)) * 0.08
  const glow = context.createRadialGradient(
    width * 0.52,
    height * 0.48,
    0,
    width * 0.52,
    height * 0.48,
    Math.max(width, height) * 0.7
  )
  glow.addColorStop(0, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${breath})`)
  glow.addColorStop(
    0.46,
    `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${breath * 0.28})`
  )
  glow.addColorStop(1, 'rgba(0, 0, 0, 0.72)')
  context.fillStyle = glow
  context.fillRect(0, 0, width, height)

  if (mode === 'alert') {
    context.save()
    context.globalCompositeOperation = 'screen'
    context.strokeStyle = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${0.08 + Math.max(0, Math.sin(time * 0.006)) * 0.08})`
    context.lineWidth = 2 * pixelRatio
    context.strokeRect(
      18 * pixelRatio,
      18 * pixelRatio,
      width - 36 * pixelRatio,
      height - 36 * pixelRatio
    )
    context.restore()
  }
}

const drawRoute = (
  context: CanvasRenderingContext2D,
  points: ProjectedPoint[],
  visualState: RouteVisual,
  route: CubeRoute,
  time: number,
  pixelRatio: number,
  overlay: boolean
) => {
  if (points.length < 2 || visualState.intensity <= 0) return
  const rgb = colorToRgb(visualState.color)
  const alphaBase = visualState.blocked
    ? 0.18
    : visualState.active
      ? 0.28
      : 0.07
  const alpha = alphaBase * visualState.intensity

  context.save()
  context.globalCompositeOperation = 'screen'
  context.lineCap = 'round'
  context.lineJoin = 'round'
  context.beginPath()
  context.moveTo(points[0].x, points[0].y)
  for (const point of points.slice(1)) {
    context.lineTo(point.x, point.y)
  }
  context.strokeStyle = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${overlay ? alpha * 0.82 : alpha})`
  context.lineWidth =
    (overlay ? 1.45 : 3.6) *
    pixelRatio *
    (visualState.active ? 1.25 : 1) *
    (visualState.blocked ? 1.1 : 1)
  context.stroke()

  if (overlay && (visualState.active || visualState.blocked)) {
    const particles = visualState.blocked ? 2 : 3
    for (let index = 0; index < particles; index += 1) {
      const progress =
        (time * (visualState.blocked ? 0.0001 : 0.00022) +
          route.phaseOffset +
          index / particles) %
        1
      const position = pointAlongPolyline(points, progress)
      if (!position) continue
      const pulse = visualState.blocked
        ? 0.6 + Math.max(0, Math.sin(time * 0.01 + index)) * 0.28
        : 0.75 + Math.max(0, Math.sin(time * 0.006 + index)) * 0.25
      context.beginPath()
      context.arc(
        position.x,
        position.y,
        (visualState.blocked ? 3.2 : 2.6) * pixelRatio * pulse,
        0,
        Math.PI * 2
      )
      context.fillStyle = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${visualState.blocked ? 0.48 : 0.62})`
      context.fill()
    }
  }

  context.restore()
}

const pointAlongPolyline = (
  points: ProjectedPoint[],
  progress: number
): ProjectedPoint | null => {
  if (points.length < 2) return null
  const lengths: number[] = []
  let total = 0
  for (let index = 0; index < points.length - 1; index += 1) {
    const from = points[index]
    const to = points[index + 1]
    const length = Math.hypot(to.x - from.x, to.y - from.y)
    lengths.push(length)
    total += length
  }
  if (total <= 0) return points[0]
  let remaining = total * clamp(progress, 0, 1)
  for (let index = 0; index < lengths.length; index += 1) {
    const length = lengths[index]
    if (remaining <= length) {
      const from = points[index]
      const to = points[index + 1]
      const segmentProgress = length <= 0 ? 0 : remaining / length
      return {
        x: from.x + (to.x - from.x) * segmentProgress,
        y: from.y + (to.y - from.y) * segmentProgress,
        scale: from.scale + (to.scale - from.scale) * segmentProgress,
      }
    }
    remaining -= length
  }
  return points[points.length - 1]
}

const drawQuad = (
  context: CanvasRenderingContext2D,
  points: ProjectedPoint[],
  fillStyle: string | CanvasGradient,
  strokeStyle?: string,
  lineWidth = 1
) => {
  context.beginPath()
  context.moveTo(points[0].x, points[0].y)
  for (const point of points.slice(1)) {
    context.lineTo(point.x, point.y)
  }
  context.closePath()
  context.fillStyle = fillStyle
  context.fill()
  if (strokeStyle) {
    context.strokeStyle = strokeStyle
    context.lineWidth = lineWidth
    context.stroke()
  }
}

export const CubeVaultBackground = () => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const animationRef = useRef<number | null>(null)
  const lastFrameRef = useRef(0)
  const indicatorsRef = useRef<IndicatorSnapshot | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const context = canvas.getContext('2d', { alpha: false })
    if (!context) return

    const params = new URLSearchParams(window.location.search)
    const showLabels = params.get('labels') !== '0'
    const showScan = params.get('scan') !== '0'
    const indicatorsEnabled = params.get('indicators') !== '0'
    const indicatorDemoMode = indicatorsEnabled
      ? resolveIndicatorDemoMode(params)
      : null
    const indicatorUrl = resolveIndicatorUrl(params)
    const indicatorIntervalMs = clamp(
      Number(params.get('indicatorIntervalMs')) || 1500,
      800,
      10000
    )
    const fovDegrees = clamp(Number(params.get('fov')) || 60, 35, 85)
    const reducedMotion =
      params.get('motion') === '0' ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches

    const resize = () => {
      const requestedScale = Number(params.get('scale'))
      const pixelRatio = clamp(
        Number.isFinite(requestedScale) && requestedScale > 0
          ? requestedScale
          : window.devicePixelRatio || 1,
        1,
        2
      )
      canvas.width = Math.ceil(window.innerWidth * pixelRatio)
      canvas.height = Math.ceil(window.innerHeight * pixelRatio)
    }

    const drawCube = (
      node: CubeNode | undefined,
      center: Point3D,
      cubeWidth: number,
      cubeHeight: number,
      cubeDepth: number,
      yaw: number,
      project: (point: Point3D) => ProjectedPoint,
      time: number,
      pixelRatio: number
    ) => {
      const color = node ? KIND_COLORS[node.kind] : '#3a5268'
      const status = node
        ? resolveCubeVisual(node, indicatorsRef.current)
        : undefined
      const indicatorColor = status?.color || color
      const rgb = colorToRgb(indicatorColor)
      const halfWidth = cubeWidth / 2
      const halfHeight = cubeHeight / 2
      const cosYaw = Math.cos(yaw)
      const sinYaw = Math.sin(yaw)
      const localPoint = (x: number, y: number, z: number) =>
        project({
          x: center.x + x * cosYaw + z * sinYaw,
          y: center.y + y,
          z: center.z - x * sinYaw + z * cosYaw,
        })
      const pulse = node
        ? 0.85 +
          Math.max(
            0,
            Math.sin(time * 0.002 + center.x * 1.4 + center.y * 1.6)
          ) *
            0.28
        : 0.42
      const statusPulse =
        status?.level === 'active' || status?.level === 'error'
          ? 1 + Math.sin(time * 0.009) * 0.12
          : 1
      const intensity = status?.intensity ?? 1
      const edgeAlpha = node
        ? clamp(0.15 + 0.5 * pulse * intensity * statusPulse, 0.14, 0.9)
        : 0.16
      const front = [
        localPoint(-halfWidth, -halfHeight, 0),
        localPoint(halfWidth, -halfHeight, 0),
        localPoint(halfWidth, halfHeight, 0),
        localPoint(-halfWidth, halfHeight, 0),
      ]
      const back = [
        localPoint(-halfWidth, -halfHeight, cubeDepth),
        localPoint(halfWidth, -halfHeight, cubeDepth),
        localPoint(halfWidth, halfHeight, cubeDepth),
        localPoint(-halfWidth, halfHeight, cubeDepth),
      ]
      const faceWidth = Math.hypot(
        front[1].x - front[0].x,
        front[1].y - front[0].y
      )
      const faceHeight = Math.hypot(
        front[3].x - front[0].x,
        front[3].y - front[0].y
      )

      context.save()
      context.shadowColor = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${node ? 0.5 * intensity : 0.1})`
      context.shadowBlur = node
        ? clamp(12 * intensity, 4, 24) * pixelRatio
        : 4 * pixelRatio

      drawQuad(
        context,
        back,
        node ? 'rgba(17, 22, 31, 0.98)' : 'rgba(12, 16, 23, 0.95)',
        `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${edgeAlpha * 0.32})`,
        1 * pixelRatio
      )
      drawQuad(
        context,
        [front[1], back[1], back[2], front[2]],
        'rgba(8, 12, 19, 0.78)'
      )
      drawQuad(
        context,
        [front[0], front[1], back[1], back[0]],
        'rgba(17, 23, 32, 0.52)'
      )
      drawQuad(
        context,
        [front[2], back[2], back[3], front[3]],
        'rgba(5, 8, 14, 0.6)'
      )

      const glass = context.createLinearGradient(
        front[0].x,
        front[0].y,
        front[2].x,
        front[2].y
      )
      glass.addColorStop(
        0,
        `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${node ? clamp(0.06 + 0.1 * intensity, 0.04, 0.2) : 0.04})`
      )
      glass.addColorStop(0.44, 'rgba(230, 249, 255, 0.055)')
      glass.addColorStop(1, 'rgba(3, 7, 13, 0.32)')
      drawQuad(
        context,
        front,
        glass,
        `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${edgeAlpha})`,
        node ? 1.35 * pixelRatio : 0.8 * pixelRatio
      )

      context.beginPath()
      context.moveTo(
        front[0].x + (front[1].x - front[0].x) * 0.13,
        front[0].y + (front[3].y - front[0].y) * 0.2
      )
      context.lineTo(
        front[0].x + (front[1].x - front[0].x) * 0.42,
        front[0].y + (front[3].y - front[0].y) * 0.08
      )
      context.strokeStyle = 'rgba(246, 254, 255, 0.16)'
      context.lineWidth = 1.15 * pixelRatio
      context.stroke()

      if (node) {
        const markerSize = Math.max(3.8 * pixelRatio, faceWidth * 0.04)
        context.shadowBlur = clamp(6 * intensity, 3, 14) * pixelRatio
        context.beginPath()
        context.arc(
          front[0].x + (front[1].x - front[0].x) * 0.84,
          front[0].y + (front[3].y - front[0].y) * 0.2,
          markerSize,
          0,
          Math.PI * 2
        )
        context.fillStyle = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${status?.level === 'offline' ? 0.45 : 0.92})`
        context.fill()

        if (status) {
          const barStartX = front[0].x + (front[1].x - front[0].x) * 0.18
          const barStartY = front[0].y + (front[3].y - front[0].y) * 0.84
          const barEndX = front[0].x + (front[1].x - front[0].x) * 0.82
          const barEndY = front[0].y + (front[3].y - front[0].y) * 0.84
          context.beginPath()
          context.moveTo(barStartX, barStartY)
          context.lineTo(barEndX, barEndY)
          context.lineCap = 'round'
          context.lineWidth = clamp(faceHeight * 0.025, 1.4, 3.6) * pixelRatio
          context.strokeStyle = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${status.level === 'offline' ? 0.36 : 0.86})`
          context.stroke()

          if (status.level === 'active' || status.level === 'error') {
            context.beginPath()
            context.arc(
              front[0].x + (front[1].x - front[0].x) * 0.84,
              front[0].y + (front[3].y - front[0].y) * 0.2,
              markerSize * (2.1 + Math.sin(time * 0.008) * 0.18),
              0,
              Math.PI * 2
            )
            context.strokeStyle = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.34)`
            context.lineWidth = 1.1 * pixelRatio
            context.stroke()
          }
        }

        if (
          showLabels &&
          faceWidth > 48 * pixelRatio &&
          faceHeight > 28 * pixelRatio
        ) {
          const labelSize = clamp(
            faceWidth * 0.092,
            8.4 * pixelRatio,
            10.5 * pixelRatio
          )
          const labelX = front[0].x + (front[1].x - front[0].x) * 0.5
          const labelY = front[0].y + (front[3].y - front[0].y) * 0.58
          const labelMaxWidth = faceWidth * 0.82
          context.shadowBlur = 0
          context.font = `600 ${labelSize}px ui-monospace, SFMono-Regular, Consolas, monospace`
          context.textAlign = 'center'
          context.textBaseline = 'middle'
          context.lineWidth = 2.2 * pixelRatio
          context.strokeStyle = 'rgba(0, 3, 10, 0.72)'
          context.strokeText(node.label, labelX, labelY, labelMaxWidth)
          context.fillStyle = 'rgba(236, 248, 255, 0.88)'
          context.fillText(node.label, labelX, labelY, labelMaxWidth)
        }
      }

      context.restore()
    }

    let indicatorTimer: number | null = null
    let indicatorAbort: AbortController | null = null
    let indicatorDemoSequence = 0
    const refreshIndicators = async () => {
      if (!indicatorsEnabled) return
      if (indicatorDemoMode) {
        indicatorsRef.current = buildDemoIndicatorSnapshot(
          indicatorDemoMode,
          indicatorDemoSequence
        )
        indicatorDemoSequence += 1
        return
      }
      indicatorAbort?.abort()
      indicatorAbort = new AbortController()
      try {
        const response = await fetch(indicatorUrl, {
          cache: 'no-store',
          signal: indicatorAbort.signal,
        })
        if (!response.ok) {
          throw new Error(`indicators HTTP ${response.status}`)
        }
        const payload = (await response.json()) as unknown
        indicatorsRef.current = {
          payload: isRecord(payload) ? (payload as IndicatorPayload) : null,
          fetchedAt: Date.now(),
          fetchOk: true,
        }
      } catch (error) {
        if ((error as DOMException).name === 'AbortError') return
        indicatorsRef.current = {
          payload: null,
          fetchedAt: Date.now(),
          fetchOk: false,
        }
      }
    }

    const draw = (timeMs = 0) => {
      if (timeMs - lastFrameRef.current < 34 && !reducedMotion) {
        animationRef.current = requestAnimationFrame(draw)
        return
      }
      lastFrameRef.current = timeMs

      const { width, height } = canvas
      const pixelRatio = width / Math.max(1, window.innerWidth)
      const time = reducedMotion ? 0 : timeMs
      const aiMode = resolveAiMode(indicatorsRef.current)
      const centerX = width * 0.5
      const centerY = height * 0.5
      const fovRadians = (fovDegrees * Math.PI) / 180
      const focalLength = (width * 0.5) / Math.tan(fovRadians / 2)
      const camera = {
        x: Math.sin(time * 0.00022) * 0.16,
        y: Math.cos(time * 0.00019) * 0.08,
        z: -11.8,
      }
      const project = (point: Point3D): ProjectedPoint => {
        const viewZ = Math.max(0.1, point.z - camera.z)
        const scale = focalLength / viewZ
        return {
          x: centerX + (point.x - camera.x) * scale,
          y: centerY + (point.y - camera.y) * scale,
          scale,
        }
      }
      const background = context.createLinearGradient(0, 0, width, height)
      background.addColorStop(0, '#020611')
      background.addColorStop(0.45, '#08192b')
      background.addColorStop(1, '#010309')
      context.fillStyle = background
      context.fillRect(0, 0, width, height)

      drawModeGlow(context, width, height, aiMode, time, pixelRatio)

      const vanishing = project({ x: 0, y: 0, z: 13.5 })
      context.save()
      context.globalCompositeOperation = 'screen'
      context.lineWidth = 0.65 * pixelRatio
      context.strokeStyle = 'rgba(86, 215, 255, 0.055)'
      for (let index = 0; index <= 12; index += 1) {
        const edgeX = (width / 12) * index
        context.beginPath()
        context.moveTo(edgeX, 0)
        context.lineTo(vanishing.x, vanishing.y)
        context.moveTo(edgeX, height)
        context.lineTo(vanishing.x, vanishing.y)
        context.stroke()
      }
      context.restore()

      const columns = 7
      const rows = 7
      const cubeWidth = 1.54
      const cubeHeight = 0.9
      const cubeDepth = 0.84
      const gapX = 0.31
      const gapY = 0.2
      const centerColumn = (columns - 1) / 2
      const centerRow = (rows - 1) / 2
      const cubes: Array<{
        node: CubeNode | undefined
        center: Point3D
        sortZ: number
        yaw: number
      }> = []
      for (let row = 0; row < rows; row += 1) {
        for (let column = 0; column < columns; column += 1) {
          const normalizedX = column - centerColumn
          const normalizedY = row - centerRow
          const edgePull = Math.abs(normalizedX) / centerColumn
          const verticalPull = Math.abs(normalizedY) / centerRow
          cubes.push({
            node: NODE_BY_SLOT.get(`${row}:${column}`),
            center: {
              x: normalizedX * (cubeWidth + gapX),
              y: normalizedY * (cubeHeight + gapY),
              z: 5.6 + (1 - edgePull) * 1.95 - verticalPull * 0.18,
            },
            sortZ: 5.6 + (1 - edgePull) * 1.95 - verticalPull * 0.18,
            yaw: -normalizedX * 0.035,
          })
        }
      }

      const projectedCenters = new Map<string, ProjectedPoint>()
      for (const cube of cubes) {
        if (cube.node) {
          projectedCenters.set(
            cube.node.id,
            project({
              x: cube.center.x,
              y: cube.center.y,
              z: cube.center.z - 0.05,
            })
          )
        }
      }
      const routeViews = CUBE_ROUTES.map((route) => ({
        route,
        visualState: routeVisual(route, indicatorsRef.current, aiMode),
        points: route.nodeIds.flatMap((nodeId) => {
          const point = projectedCenters.get(nodeId)
          return point ? [point] : []
        }),
      }))

      for (const routeView of routeViews) {
        drawRoute(
          context,
          routeView.points,
          routeView.visualState,
          routeView.route,
          time,
          pixelRatio,
          false
        )
      }

      context.globalCompositeOperation = 'source-over'
      for (const cube of cubes.sort((a, b) => b.sortZ - a.sortZ)) {
        drawCube(
          cube.node,
          cube.center,
          cubeWidth,
          cubeHeight,
          cubeDepth,
          cube.yaw,
          project,
          time,
          pixelRatio
        )
      }

      for (const routeView of routeViews) {
        drawRoute(
          context,
          routeView.points,
          routeView.visualState,
          routeView.route,
          time,
          pixelRatio,
          true
        )
      }

      if (showScan) {
        const scanY =
          ((time * 0.018) % (height + 132 * pixelRatio)) - 66 * pixelRatio
        const scan = context.createLinearGradient(
          0,
          scanY,
          0,
          scanY + 54 * pixelRatio
        )
        scan.addColorStop(0, 'rgba(255, 255, 255, 0)')
        scan.addColorStop(0.5, 'rgba(86, 215, 255, 0.055)')
        scan.addColorStop(1, 'rgba(255, 255, 255, 0)')
        context.fillStyle = scan
        context.fillRect(0, scanY, width, 54 * pixelRatio)
      }

      for (let y = 0; y < height; y += 4 * pixelRatio) {
        context.fillStyle = 'rgba(255, 255, 255, 0.014)'
        context.fillRect(0, y, width, pixelRatio)
      }

      animationRef.current = requestAnimationFrame(draw)
    }

    resize()
    window.addEventListener('resize', resize)
    if (indicatorsEnabled) {
      refreshIndicators()
      indicatorTimer = window.setInterval(
        refreshIndicators,
        indicatorIntervalMs
      )
    }
    draw()

    return () => {
      window.removeEventListener('resize', resize)
      if (indicatorTimer !== null) {
        window.clearInterval(indicatorTimer)
      }
      indicatorAbort?.abort()
      if (animationRef.current !== null) {
        cancelAnimationFrame(animationRef.current)
      }
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="fixed inset-0 block h-screen w-screen bg-[#020611]"
    />
  )
}
