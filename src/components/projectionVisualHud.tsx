import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'

type HudState = {
  fontSize: number
  inputFontSize: number
  accent: string
  visible: boolean
  matrix: boolean
}

type StatusPayload = {
  timestamp?: string
  services?: Record<string, any>
  mediapipe?: Record<string, any> | null
  touchdesigner?: Record<string, any>
  environment?: {
    appliances?: Record<string, any>
    state_queries?: Record<string, any>
    sources?: Record<string, any>
    vision?: Record<string, any>
  }
  homeActionMode?: {
    mode?: string
    label?: string
    detail?: string
    live?: boolean
  }
  homeActions?: {
    events?: Array<Record<string, any>>
    lastEvent?: Record<string, any> | null
  }
  difyChat?: {
    events?: Array<Record<string, any>>
    lastEvent?: Record<string, any> | null
  }
  thoughtCoreChat?: {
    events?: Array<Record<string, any>>
    lastEvent?: Record<string, any> | null
  }
  conversationLog?: {
    entries?: Array<Record<string, any>>
    lastEntry?: Record<string, any> | null
  }
  aiChat?: {
    lastEvent?: Record<string, any> | null
  }
  pipeline?: {
    stage?: string
    source?: string | null
    event?: string | null
    detail?: string
    updated_at?: string | null
  }
  magic?: {
    active?: boolean
    lastActionId?: string | null
    lastUserText?: string | null
  }
}

type SttStatus = {
  mode?: string
  listening?: boolean
  state?: string
  continuous?: boolean
  speaking?: boolean
  chatProcessing?: boolean
  browserAvailable?: boolean
  whisperModel?: string
  userTextLength?: number
  updatedAt?: string
}

type SttDiagnostic = {
  event?: string
  phase?: string
  controller?: string
  detail?: string
  error?: string
  transcript?: string
  elapsedMs?: number
  attempt?: number
  listening?: boolean
  recognitionActive?: boolean
  speechDetected?: boolean
  updatedAt?: string
}

type HudUpdateSignal = {
  target: string
  kind: 'updated' | 'fresh' | 'stale' | 'warning'
  source: 'camera' | 'homeAssistant' | 'thoughtCore' | 'launcher' | 'environment'
  observedAt?: string
  snapshotId?: string
  token?: string
  ttlMs?: number
}

const STATUS_URL =
  process.env.NEXT_PUBLIC_DISPLAY_RUNTIME_STATUS_URL ||
  process.env.NEXT_PUBLIC_TD_CONTROL_GUI_STATUS_URL ||
  'http://127.0.0.1:8788/api/status'

const COLOR_PRESETS = ['#4cc9ff', '#ff3fd2', '#f4ff5c', '#ffffff']
const STORAGE_KEY = 'projection-visual-hud-settings'
const MIN_HUD_FONT_SIZE = 8
const DEFAULT_HUD_FONT_SIZE = 12
const MAX_HUD_FONT_SIZE = 13
const MIN_COMMENT_FONT_SIZE = 14
const MAX_COMMENT_FONT_SIZE = 56

const clampNumber = (value: unknown, min: number, max: number): number => {
  const parsed =
    typeof value === 'number' ? value : Number.parseFloat(String(value ?? ''))
  if (!Number.isFinite(parsed)) return min
  return Math.min(max, Math.max(min, parsed))
}

const SERVICE_LABELS: Record<string, string> = {
  home_assistant_bridge: 'Action bridge',
  environment_state_server: 'Environment state',
  mediapipe: 'Reflex sensor',
  mediapipe_camera_hub_stack: 'Reflex sensor',
  vision_snapshot_processor: 'Vision snapshot',
  aituber_kit: 'Expression runtime',
  td_control_gui: 'Display runtime',
  touchdesigner_control_gui: 'Display runtime',
  dify: 'Dify compatibility',
  thought_core_api: 'Thought Core API',
  thought_core_watcher: 'Thought Core watcher',
  voicevox: 'VOICEVOX speech',
}

const SERVICE_LAYERS: Record<string, string> = {
  home_assistant_bridge: 'action boundary',
  environment_state_server: 'environment / state',
  mediapipe: 'reflex / gesture',
  mediapipe_camera_hub_stack: 'reflex / gesture',
  vision_snapshot_processor: 'environment input',
  aituber_kit: 'expression / avatar',
  td_control_gui: 'display / projection',
  touchdesigner_control_gui: 'display / projection',
  dify: 'compatibility runtime',
  thought_core_api: 'conscious / thought',
  thought_core_watcher: 'conscious bridge',
  voicevox: 'speech / voice',
}

const SERVICE_ORDER = [
  'thought_core_api',
  'thought_core_watcher',
  'environment_state_server',
  'home_assistant_bridge',
  'mediapipe',
  'mediapipe_camera_hub_stack',
  'vision_snapshot_processor',
  'aituber_kit',
  'td_control_gui',
  'touchdesigner_control_gui',
  'voicevox',
  'dify',
]

const LEGACY_SERVICE_KEYS = new Set(['dify'])

const SYSTEM_SECTIONS = [
  {
    id: 'control-plane',
    title: 'Control Plane',
    detail: 'ops / policy',
    members: ['thought_core_watcher'],
  },
  {
    id: 'thought-core',
    title: 'Thought Core',
    detail: 'turn loop / tools',
    members: ['thought_core_api'],
  },
  {
    id: 'reflex-core',
    title: 'Reflex Core',
    detail: 'camera / gesture',
    members: ['mediapipe', 'mediapipe_camera_hub_stack'],
  },
  {
    id: 'environment',
    title: 'Environment',
    detail: 'observe / indicators',
    members: ['environment_state_server', 'vision_snapshot_processor'],
  },
  {
    id: 'home-control',
    title: 'Action Boundary',
    detail: 'preview / execute',
    members: ['home_assistant_bridge'],
  },
  {
    id: 'expression',
    title: 'Expression',
    detail: 'avatar / speech',
    members: [
      'aituber_kit',
      'voicevox',
      'td_control_gui',
      'touchdesigner_control_gui',
    ],
  },
]

const SYSTEM_CALLS = [
  { id: 'observe', label: 'observe', detail: 'Environment' },
  { id: 'preview', label: 'preview', detail: 'Action Boundary' },
  { id: 'execute', label: 'execute', detail: 'Action Boundary' },
  { id: 'respond', label: 'respond', detail: 'Expression' },
]

const formatAge = (ageMs: unknown): string => {
  if (typeof ageMs !== 'number' || !Number.isFinite(ageMs)) return '-'
  return ageMs < 1000
    ? `${Math.max(0, Math.round(ageMs))}ms`
    : `${(ageMs / 1000).toFixed(1)}s`
}

const formatTime = (value: unknown): string => {
  if (typeof value !== 'string') return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  return date.toLocaleTimeString('ja-JP', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

const latestEventByTimestamp = (
  ...events: Array<Record<string, any> | null | undefined>
): Record<string, any> | null => {
  const sortedEvents = events
    .filter((event): event is Record<string, any> => Boolean(event))
    .map((event) => ({
      event,
      timestampMs: Date.parse(String(event.timestamp ?? '')),
    }))
    .filter(({ timestampMs }) => Number.isFinite(timestampMs))
    .sort((left, right) => left.timestampMs - right.timestampMs)
  return sortedEvents.length > 0
    ? sortedEvents[sortedEvents.length - 1].event
    : null
}

const readDeveloperHudDiagnosticsFlag = (): boolean => {
  if (typeof window === 'undefined') return false
  const params = new URLSearchParams(window.location.search)
  return ['debug', 'developer', 'hudDebug'].some((key) => {
    const value = String(params.get(key) ?? '').toLowerCase()
    return value === '1' || value === 'true' || value === 'yes'
  })
}

const aiSourceLabel = (event: Record<string, any> | null): string => {
  if (!event) return 'AI'
  const source = String(event.source ?? '')
    .trim()
    .toLowerCase()
  if (source === 'thought-core') return 'Thought Core'
  if (source === 'dify') return 'Dify compatibility'
  return source ? source.replace(/[-_]/g, ' ') : 'AI'
}

const conversationRoleLabel = (entry: Record<string, any>): string => {
  const role = String(entry.role ?? '').toLowerCase()
  if (role === 'user') return 'USER'
  if (role === 'assistant') return 'NIKO'
  return role ? role.toUpperCase() : 'LOG'
}

const conversationEntryText = (entry: Record<string, any>): string => {
  const text = String(entry.text ?? entry.answer_preview ?? entry.query ?? '')
  return text.trim() || '-'
}

const conversationEntryMeta = (entry: Record<string, any>): string => {
  const source = String(entry.source ?? '-')
  const turnId = String(entry.turn_id ?? '').slice(0, 18)
  return `${formatTime(entry.timestamp)} / ${source}${turnId ? ` / ${turnId}` : ''}`
}

const serviceKey = (service: any): string =>
  String(
    service?.serviceKey ??
      service?.name ??
      service?.id ??
      service?.service ??
      ''
  )

const serviceLabel = (service: any): string => {
  const key = serviceKey(service)
  return SERVICE_LABELS[key] ?? key.replace(/_/g, ' ')
}

const serviceLayer = (service: any): string => {
  const key = serviceKey(service)
  return SERVICE_LAYERS[key] ?? 'system cell'
}

const serviceSortIndex = (service: any): number => {
  const key = serviceKey(service)
  const index = SERVICE_ORDER.indexOf(key)
  return index >= 0 ? index : SERVICE_ORDER.length
}

const normalizeState = (state: unknown): string => {
  const value = String(state ?? '').toUpperCase()
  if (!value) return 'UNKNOWN'
  if (value.includes('DOWN')) return 'DOWN'
  if (value.includes('FAILED') || value.includes('ERROR')) return 'ERROR'
  if (value.includes('WAIT') || value.includes('START')) return 'STARTING'
  if (value.includes('DEGRADED')) return 'DEGRADED'
  if (value.includes('OK') || value.includes('RUNNING')) return 'OK'
  return value
}

const aggregateState = (states: unknown[]): string => {
  const normalized = states.map(normalizeState)
  if (normalized.length === 0) return 'UNKNOWN'
  if (normalized.some((state) => state === 'ERROR')) return 'ERROR'
  if (normalized.some((state) => state === 'DOWN')) return 'DOWN'
  if (normalized.some((state) => state === 'DEGRADED')) return 'DEGRADED'
  if (normalized.some((state) => state === 'STARTING')) return 'STARTING'
  if (normalized.every((state) => state === 'OK')) return 'OK'
  return normalized[0]
}

const stateLabel = (state: unknown): string => {
  const normalized = normalizeState(state)
  if (normalized === 'OK') return 'OK'
  if (normalized === 'STARTING') return 'WAIT'
  if (normalized === 'DEGRADED') return 'DEG'
  if (normalized === 'DOWN') return 'DOWN'
  if (normalized === 'ERROR') return 'ERR'
  if (normalized === 'UNKNOWN') return '?'
  return normalized
}

const stateWordLabel = (state: unknown): string => {
  const normalized = normalizeState(state)
  if (normalized === 'OK') return 'Ready'
  if (normalized === 'STARTING') return 'Checking'
  if (normalized === 'DEGRADED') return 'Stale'
  if (normalized === 'DOWN') return 'Offline'
  if (normalized === 'ERROR') return 'Issue'
  if (normalized === 'UNKNOWN') return 'Unknown'
  return normalized
}

const homeActionModeLabel = (status: StatusPayload | null) => {
  const rawMode = String(status?.homeActionMode?.mode ?? '')
    .trim()
    .toLowerCase()
    .replace(/[-\s]+/g, '_')

  if (rawMode === 'live_home' || rawMode === 'home_control') {
    return {
      mode: 'live',
      label: 'LIVE HOME',
      detail: '実家電送信',
    }
  }

  if (rawMode === 'mock' || rawMode === 'no_live' || rawMode === 'dry_run') {
    return {
      mode: 'mock',
      label: 'MOCK',
      detail: '実送信なし',
    }
  }

  if (rawMode === 'demo' || rawMode === 'demo_home' || rawMode === 'example') {
    return {
      mode: 'demo',
      label: 'DEMO',
      detail: 'デモ設定',
    }
  }

  return {
    mode: 'unknown',
    label: 'UNKNOWN',
    detail: '設定不明',
  }
}

const homeActionProofLabel = (
  event: Record<string, any> | null | undefined
): string => {
  if (!event) return 'no command'
  const proof = String(
    event.proof_layer ??
      event.verification_mode ??
      event.verification?.mode ??
      ''
  ).toLowerCase()
  if (proof.includes('ha_state')) return 'HA state proof'
  if (proof.includes('physical')) return 'physical observed'
  if (proof.includes('external')) return 'external observed'
  return 'CMD SENT / state未確認'
}

const readNumericField = (
  source: any,
  keys: string[]
): number | undefined => {
  for (const key of keys) {
    const value = source?.[key]
    const parsed = typeof value === 'number' ? value : Number(value)
    if (Number.isFinite(parsed)) {
      return parsed
    }
  }
  return undefined
}

const readStringField = (
  source: any,
  keys: string[]
): string | undefined => {
  for (const key of keys) {
    const value = source?.[key]
    if (typeof value === 'string' && value.trim()) {
      return value
    }
  }
  return undefined
}

const serviceFreshnessLabel = (
  service: any,
  nowMs: number,
  fallbackTimestamp?: string
): string => {
  const ageMs = readNumericField(service, [
    'age_ms',
    'ageMs',
    'freshness_ms',
    'freshnessMs',
  ])
  const directAge = formatAge(ageMs)
  if (directAge !== '-') {
    return `age ${directAge}`
  }

  const timestamp = readStringField(service, [
    'updated_at',
    'updatedAt',
    'checked_at',
    'checkedAt',
    'timestamp',
  ]) ?? fallbackTimestamp
  const timestampMs = timestamp ? Date.parse(timestamp) : NaN
  if (nowMs > 0 && Number.isFinite(timestampMs)) {
    return `age ${formatAge(nowMs - timestampMs)}`
  }

  return 'age ?'
}

const formatDurationCompact = (ageMs: unknown): string => {
  if (typeof ageMs !== 'number' || !Number.isFinite(ageMs)) return '-'
  const positiveAge = Math.max(0, ageMs)
  if (positiveAge < 1000) return `${Math.round(positiveAge)}ms`
  const seconds = positiveAge / 1000
  if (seconds < 60) return `${seconds.toFixed(1)}s`
  const minutes = seconds / 60
  if (minutes < 60) return `${minutes.toFixed(1)}m`
  const hours = minutes / 60
  if (hours < 48) return `${hours.toFixed(1)}h`
  return `${(hours / 24).toFixed(1)}d`
}

const compactSourceLabel = (value: unknown, fallback: string): string => {
  const source = String(value ?? '').toLowerCase()
  if (source.includes('home_assistant')) return 'HA'
  if (source.includes('vision')) return 'Vision'
  if (source.includes('camera')) return 'Camera'
  return fallback
}

const ENVIRONMENT_VALUE_LABELS: Record<string, string> = {
  aircon: 'AC',
  camera: 'CAMERA',
  door: 'DOOR',
  fan: 'FAN',
  light: 'LIGHT',
  room_light: 'ROOM EST',
}

const HUD_UPDATE_TARGETS: Record<string, string> = {
  'query:room_light': 'environment.roomLightEstimate',
  'vision:room_light': 'environment.roomLightEstimate',
}

const VISION_SOURCE_ONLY_KEYS = new Set(['camera', 'sword_sign'])

const isRecordObject = (value: unknown): value is Record<string, any> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const environmentValueLabel = (key: string, source: string): string => {
  const normalized = key.replace(/-/g, '_')
  const baseLabel =
    ENVIRONMENT_VALUE_LABELS[normalized] ??
    normalized
      .split('_')
      .filter(Boolean)
      .slice(0, 2)
      .join(' ')
      .toUpperCase()
  return source === 'vision' && !baseLabel.startsWith('VISION')
    ? `VISION ${baseLabel}`.slice(0, 14)
    : baseLabel.slice(0, 14)
}

const environmentFreshnessLabel = (signal: any, nowMs: number): string => {
  const freshness = signal?.freshness ?? {}
  const level = String(
    freshness.level ?? (signal?.stale ? 'stale' : 'fresh')
  ).toLowerCase()
  const directAge = readNumericField(freshness, ['age_ms', 'ageMs'])
  const signalAge = readNumericField(signal, ['age_ms', 'ageMs'])
  let ageLabel = formatDurationCompact(directAge ?? signalAge)
  const timestamp = readStringField(signal, [
    'updated_at',
    'updatedAt',
    'observed_at',
    'observedAt',
  ])
  const timestampMs = timestamp ? Date.parse(timestamp) : NaN
  if (ageLabel === '-' && nowMs > 0 && Number.isFinite(timestampMs)) {
    ageLabel = formatDurationCompact(nowMs - timestampMs)
  }

  const levelLabel =
    level === 'fresh' || level === 'recent' || level === 'stale'
      ? level
      : signal?.stale
        ? 'stale'
        : 'fresh'
  return ageLabel === '-' ? levelLabel : `${levelLabel} ${ageLabel}`
}

const environmentSignalState = (
  signal: any,
  unknownState: string = 'UNKNOWN'
): string => {
  if (!signal) return 'UNKNOWN'
  if (signal.stale || signal?.freshness?.level === 'stale') return 'DEGRADED'
  if (signal.available === false) return 'DEGRADED'
  const state = String(signal.state ?? '').toLowerCase()
  if (!state || state === 'unknown') return unknownState
  if (state.includes('error') || state === 'unavailable') return 'ERROR'
  return 'OK'
}

const environmentSourceState = (
  source: any,
  fallbackState: unknown
): string => {
  if (source) {
    if (source.available === false) return 'DOWN'
    if (source.stale || source?.freshness?.level === 'stale') return 'DEGRADED'
    const status = String(source.status ?? source.phase ?? '').toLowerCase()
    if (status.includes('error') || status.includes('fail')) return 'ERROR'
    if (status.includes('offline') || status.includes('down')) return 'DOWN'
    return 'OK'
  }
  return normalizeState(fallbackState)
}

const environmentSourceFreshnessLabel = (
  source: any,
  service: any,
  nowMs: number,
  fallbackTimestamp?: string
): string => {
  if (source) return environmentFreshnessLabel(source, nowMs)
  return serviceFreshnessLabel(service, nowMs, fallbackTimestamp)
}

const environmentStateValueLabel = (value: unknown): string => {
  const state = String(value ?? '').trim().toLowerCase()
  if (!state) return 'Unknown'
  if (state === 'on') return 'On'
  if (state === 'off') return 'Off'
  if (state === 'stopped') return 'Stopped'
  if (state === 'open') return 'Open'
  if (state === 'closed') return 'Closed'
  if (state === 'unknown') return 'Unknown'
  return state.replace(/_/g, ' ')
}

const formatProbability = (value: unknown): string | null => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  const normalized = value <= 1 ? value * 100 : value
  return `${Math.round(normalized)}%`
}

const environmentSignalDetailLabel = (
  signal: any,
  nowMs: number,
  fallbackSource: string
): string => {
  if (!signal) return 'not reported'

  const evidence = signal.evidence ?? {}
  const probabilities = signal.probabilities ?? {}
  const electricProbability =
    readNumericField(evidence, ['electric_on_probability']) ??
    readNumericField(probabilities, ['electric_on']) ??
    readNumericField(signal.electric_light, ['probability'])
  const daylightProbability =
    readNumericField(evidence, ['daylight_present_probability']) ??
    readNumericField(probabilities, ['daylight_present']) ??
    readNumericField(signal.daylight, ['probability'])
  const lightingType =
    readStringField(evidence, ['lighting_type']) ??
    readStringField(signal, ['lighting_type', 'label', 'daylight_state'])
  const confidence = readStringField(signal, [
    'confidence_label',
    'confidenceLabel',
  ])
  const freshness = environmentFreshnessLabel(signal, nowMs)

  const daylightLabel = formatProbability(daylightProbability)
  if (lightingType && confidence) return `${lightingType} ${confidence}`
  if (lightingType && daylightLabel) return `${lightingType} ${daylightLabel}`
  if (lightingType) return lightingType
  if (daylightLabel) return `daylight ${daylightLabel}`

  const electricLabel = formatProbability(electricProbability)
  if (electricLabel) return `elec cue ${electricLabel}`

  return freshness
}

const hudUpdateSignalSource = (
  source: string,
  signal?: any
): HudUpdateSignal['source'] => {
  const signalSource = String(
    signal?.authority ?? signal?.projected_by ?? signal?.source ?? ''
  ).toLowerCase()
  if (
    source === 'vision' ||
    signalSource.includes('vision') ||
    signalSource.includes('camera')
  ) {
    return 'camera'
  }
  if (source === 'appliance') return 'homeAssistant'
  if (source === 'query') return 'environment'
  return 'environment'
}

const hudUpdateSignalKind = (signal: any): HudUpdateSignal['kind'] => {
  const state = environmentSignalState(signal, 'DEGRADED')
  if (state === 'ERROR' || state === 'DOWN') return 'warning'
  if (state === 'DEGRADED') return 'stale'
  if (readStringField(signal, ['updated_at', 'updatedAt'])) return 'updated'
  return 'fresh'
}

const hudUpdateSemanticToken = (
  target: string,
  signal: any
): string => {
  const evidence = signal?.evidence ?? {}
  const learning = signal?.learning ?? {}
  const semanticState = environmentStateValueLabel(signal?.state ?? signal?.label)
  const confidence = readStringField(signal, [
    'confidence_label',
    'confidenceLabel',
  ])
  const lightingType =
    readStringField(evidence, ['lighting_type']) ??
    readStringField(signal, ['lighting_type', 'label', 'daylight_state'])
  const learningLevel = readStringField(learning, ['level', 'status'])

  return [
    target,
    semanticState.toLowerCase(),
    confidence,
    lightingType,
    learningLevel,
  ]
    .filter(Boolean)
    .join(':')
}

const buildEnvironmentHudUpdateSignal = (
  key: string,
  source: string,
  signal: any
): HudUpdateSignal | undefined => {
  const target = HUD_UPDATE_TARGETS[`${source}:${key}`]
  if (!target || !signal) return undefined
  const observedAt = readStringField(signal, [
    'observed_at',
    'observedAt',
    'updated_at',
    'updatedAt',
  ])
  const snapshotId = readStringField(signal, [
    'source_snapshot_id',
    'sourceSnapshotId',
    'snapshot_id',
    'snapshotId',
    'observation_id',
    'observationId',
  ])

  return {
    target,
    kind: hudUpdateSignalKind(signal),
    source: hudUpdateSignalSource(source, signal),
    observedAt,
    snapshotId,
    token: hudUpdateSemanticToken(target, signal),
    ttlMs: 1800,
  }
}

const isLegacyVisible = (service: any): boolean => {
  const key = serviceKey(service)
  if (!LEGACY_SERVICE_KEYS.has(key)) return false
  return normalizeState(service.state) !== 'DOWN'
}

const TdPanel = ({
  title,
  kicker,
  className,
  children,
}: {
  title: string
  kicker: string
  className: string
  children: ReactNode
}) => (
  <section
    className={`td-panel ${className}`}
    onClick={(event) => event.stopPropagation()}
    onPointerDown={(event) => event.stopPropagation()}
    onPointerMove={(event) => event.stopPropagation()}
    onPointerUp={(event) => event.stopPropagation()}
    onWheel={(event) => event.stopPropagation()}
  >
    <div className="td-panel-header">
      <span>{kicker}</span>
      <strong>{title}</strong>
    </div>
    {children}
  </section>
)

const compactHudValue = (key: string, value: unknown): string => {
  const raw = String(value ?? '-')
  if (raw === '-') return raw
  if (key === 'WebSocket') {
    if (raw.toLowerCase().includes('fresh') && raw.includes('Camera Hub')) {
      return 'fresh'
    }
    if (raw.toLowerCase().includes('stale') && raw.includes('Camera Hub')) {
      return 'stale'
    }
    return raw.replace(/\s*wss?:\/\/\S+$/i, '')
  }
  if (key === 'Detail' && raw.includes('UDP receiver cannot be health-checked')) {
    return 'UDP receiver unchecked'
  }
  return raw
}

const compactMetricState = (value: unknown): string => {
  const raw = String(value ?? '').toLowerCase()
  if (!raw || raw === '-' || raw === 'undefined' || raw === 'null') {
    return 'UNKNOWN'
  }
  if (
    raw.includes('fail') ||
    raw.includes('error') ||
    raw.includes('closed') ||
    raw.includes('unavailable')
  ) {
    return 'ERROR'
  }
  if (raw.includes('stale') || raw.includes('pending') || raw.includes('wait')) {
    return 'DEGRADED'
  }
  return 'OK'
}

const compactSpeechPhaseLabel = (value: unknown): string => {
  const raw = String(value ?? '-').trim()
  const normalized = raw.toLowerCase()
  if (normalized === 'start_buffering') return 'buffering'
  if (normalized === 'start_listening') return 'listening'
  if (normalized === 'recognition_started') return 'started'
  if (normalized === 'recognition_ended') return 'ended'
  return raw.replace(/^start_/, '').replace(/_/g, ' ')
}

const KeyValueRows = ({ rows }: { rows: Array<[string, unknown]> }) => (
  <div className="td-kv-list">
    {rows.map(([key, value]) => (
      <div className="td-kv" key={key}>
        <span>{key}</span>
        <strong title={String(value ?? '-')}>
          {compactHudValue(key, value)}
        </strong>
      </div>
    ))}
  </div>
)

type ProjectionVisualHudVariant = 'operator' | 'passive'

type ProjectionVisualHudProps = {
  variant?: ProjectionVisualHudVariant
}

export const ProjectionVisualHud = ({
  variant = 'operator',
}: ProjectionVisualHudProps) => {
  const isPassiveHud = variant === 'passive'
  const [status, setStatus] = useState<StatusPayload | null>(null)
  const [sttStatus, setSttStatus] = useState<SttStatus | null>(() => {
    if (typeof window === 'undefined') {
      return null
    }
    return (window as any).__projectionVisualSttStatus ?? null
  })
  const [sttDiagnostic, setSttDiagnostic] = useState<SttDiagnostic | null>(
    () => {
      if (typeof window === 'undefined') {
        return null
      }
      return (window as any).__projectionVisualSttDiagnostic ?? null
    }
  )
  const [browserSttDiagnostic, setBrowserSttDiagnostic] =
    useState<SttDiagnostic | null>(() => {
      if (typeof window === 'undefined') {
        return null
      }
      const browserDiagnostic = (window as any)
        .__projectionVisualBrowserSttDiagnostic
      const latestDiagnostic = (window as any).__projectionVisualSttDiagnostic
      return (
        browserDiagnostic ??
        (latestDiagnostic?.controller === 'browser_stt'
          ? latestDiagnostic
          : null)
      )
    })
  const [nowMs, setNowMs] = useState(0)
  const [developerHudDiagnostics] = useState(readDeveloperHudDiagnosticsFlag)
  const [hud, setHud] = useState<HudState>(() => {
    const fallback = {
      fontSize: DEFAULT_HUD_FONT_SIZE,
      inputFontSize: 16,
      accent: COLOR_PRESETS[0],
      visible: true,
      matrix: false,
    }
    if (typeof window === 'undefined') {
      return fallback
    }
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY)
      const parsed = saved ? { ...fallback, ...JSON.parse(saved) } : fallback
      return {
        ...parsed,
        fontSize:
          Number(parsed.fontSize) > MAX_HUD_FONT_SIZE
            ? DEFAULT_HUD_FONT_SIZE
            : clampNumber(
                parsed.fontSize,
                MIN_HUD_FONT_SIZE,
                MAX_HUD_FONT_SIZE
              ),
        inputFontSize: clampNumber(
          parsed.inputFontSize,
          MIN_COMMENT_FONT_SIZE,
          MAX_COMMENT_FONT_SIZE
        ),
      }
    } catch {
      return fallback
    }
  })
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const animationRef = useRef<number | null>(null)
  const columnsRef = useRef<number[]>([])

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(hud))
    } catch {
      // Ignore local setting errors.
    }
  }, [hud])

  useEffect(() => {
    document.documentElement.style.setProperty(
      '--td-comment-font-size',
      `${hud.inputFontSize}px`
    )

    return () => {
      document.documentElement.style.removeProperty('--td-comment-font-size')
    }
  }, [hud.inputFontSize])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    const handleStatus = (event: Event) => {
      setSttStatus((event as CustomEvent<SttStatus>).detail)
    }
    const handleDiagnostic = (event: Event) => {
      const detail = (event as CustomEvent<SttDiagnostic>).detail
      setSttDiagnostic(detail)
      if (detail?.controller === 'browser_stt') {
        setBrowserSttDiagnostic(detail)
      }
    }

    window.addEventListener('projection-visual-stt-status', handleStatus)
    window.addEventListener(
      'projection-visual-stt-diagnostic',
      handleDiagnostic
    )
    return () => {
      window.removeEventListener('projection-visual-stt-status', handleStatus)
      window.removeEventListener(
        'projection-visual-stt-diagnostic',
        handleDiagnostic
      )
    }
  }, [])

  useEffect(() => {
    let stopped = false

    const refresh = async () => {
      try {
        setNowMs(Date.now())
        const response = await fetch(STATUS_URL, { cache: 'no-store' })
        const nextStatus = (await response.json()) as StatusPayload
        if (!stopped) {
          setStatus(nextStatus)
        }
      } catch {
        if (!stopped) {
          setStatus(null)
        }
      }
    }

    refresh()
    const timer = window.setInterval(refresh, 1500)
    return () => {
      stopped = true
      window.clearInterval(timer)
    }
  }, [])

  async function sendTouchDesignerPing() {
    if (isPassiveHud) return
    try {
      const url = new URL(STATUS_URL)
      await fetch(`${url.origin}/api/touchdesigner/test`, { method: 'POST' })
    } catch {
      // The status panel will show service health on the next refresh.
    }
  }

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen()
      } else {
        await document.documentElement.requestFullscreen()
      }
    } catch {
      // Browser fullscreen requires a user gesture; key/button handlers provide it.
    }
  }

  function adjustFontSize(delta: number) {
    setHud((current) => ({
      ...current,
      fontSize: Math.min(
        MAX_HUD_FONT_SIZE,
        Math.max(MIN_HUD_FONT_SIZE, current.fontSize + delta)
      ),
    }))
  }

  function adjustInputFontSize(delta: number) {
    setHud((current) => ({
      ...current,
      inputFontSize: Math.min(
        MAX_COMMENT_FONT_SIZE,
        Math.max(MIN_COMMENT_FONT_SIZE, current.inputFontSize + delta)
      ),
    }))
  }

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement
      ) {
        return
      }

      if (isPassiveHud) {
        return
      }

      if (
        event.altKey &&
        (event.key === '-' || event.key === '_' || event.key === '[')
      ) {
        adjustInputFontSize(-1)
        event.preventDefault()
      } else if (
        event.altKey &&
        (event.key === '+' || event.key === '=' || event.key === ']')
      ) {
        adjustInputFontSize(1)
        event.preventDefault()
      } else if (event.key.toLowerCase() === 'h') {
        setHud((current) => ({ ...current, visible: !current.visible }))
        event.preventDefault()
      } else if (event.key.toLowerCase() === 'm') {
        setHud((current) => ({ ...current, matrix: !current.matrix }))
        event.preventDefault()
      } else if (event.key === '[' || event.key === '-' || event.key === '_') {
        adjustFontSize(-1)
        event.preventDefault()
      } else if (event.key === ']' || event.key === '+' || event.key === '=') {
        adjustFontSize(1)
        event.preventDefault()
      } else if (event.key.toLowerCase() === 'c') {
        setHud((current) => {
          const index = COLOR_PRESETS.findIndex(
            (color) => color.toLowerCase() === current.accent.toLowerCase()
          )
          return {
            ...current,
            accent: COLOR_PRESETS[(index + 1) % COLOR_PRESETS.length],
          }
        })
        event.preventDefault()
      } else if (event.key.toLowerCase() === 't') {
        void sendTouchDesignerPing()
        event.preventDefault()
      } else if (event.key.toLowerCase() === 'f') {
        void toggleFullscreen()
        event.preventDefault()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isPassiveHud])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !hud.matrix) {
      if (animationRef.current !== null) {
        cancelAnimationFrame(animationRef.current)
        animationRef.current = null
      }
      return
    }

    const context = canvas.getContext('2d')
    if (!context) return

    const resize = () => {
      canvas.width = window.innerWidth * window.devicePixelRatio
      canvas.height = window.innerHeight * window.devicePixelRatio
      columnsRef.current = Array.from(
        { length: Math.ceil(canvas.width / 18) },
        () => Math.floor(Math.random() * canvas.height)
      )
    }

    const draw = () => {
      context.fillStyle = 'rgba(0, 255, 0, 0.09)'
      context.fillRect(0, 0, canvas.width, canvas.height)
      context.font = `${15 * window.devicePixelRatio}px Consolas, monospace`
      context.fillStyle = hud.accent
      const glyphs = '01HOMEAI魔法制御状態同期'
      columnsRef.current.forEach((y, index) => {
        context.fillText(
          glyphs[Math.floor(Math.random() * glyphs.length)],
          index * 18 * window.devicePixelRatio,
          y
        )
        columnsRef.current[index] =
          y > canvas.height + Math.random() * 900
            ? 0
            : y + 18 * window.devicePixelRatio
      })
      animationRef.current = requestAnimationFrame(draw)
    }

    resize()
    window.addEventListener('resize', resize)
    draw()

    return () => {
      window.removeEventListener('resize', resize)
      if (animationRef.current !== null) {
        cancelAnimationFrame(animationRef.current)
      }
    }
  }, [hud.accent, hud.matrix])

  const services = Object.entries(status?.services ?? {})
    .map(([key, service]) => ({
      ...(service as Record<string, any>),
      serviceKey: key,
    }))
    .sort(
      (left: any, right: any) =>
        serviceSortIndex(left) - serviceSortIndex(right) ||
        serviceLabel(left).localeCompare(serviceLabel(right))
    )
  const serviceByKey = new Map(
    services.map((service: any) => [serviceKey(service), service])
  )
  const environmentStateService = serviceByKey.get('environment_state_server')
  const homeAssistantService = serviceByKey.get('home_assistant_bridge')
  const homeActionMode = homeActionModeLabel(status)
  const homeActionBridgeState = normalizeState(homeAssistantService?.state)
  const visionSnapshotService = serviceByKey.get('vision_snapshot_processor')
  const expressionRuntimeService = serviceByKey.get('aituber_kit')
  const displayRuntimeService =
    serviceByKey.get('td_control_gui') ??
    serviceByKey.get('touchdesigner_control_gui')
  const voicevoxService = serviceByKey.get('voicevox')
  const legacyServices = developerHudDiagnostics
    ? services.filter(isLegacyVisible)
    : []
  const sectionState = (members: string[]) =>
    aggregateState(
      members
        .map((member) => serviceByKey.get(member)?.state)
        .filter((state) => state !== undefined)
    )
  const events = [...(status?.homeActions?.events ?? [])].reverse().slice(0, 2)
  const difyEvents = status?.difyChat?.events ?? []
  const lastDifyEvent =
    status?.difyChat?.lastEvent ?? difyEvents[difyEvents.length - 1] ?? null
  const thoughtCoreEvents = status?.thoughtCoreChat?.events ?? []
  const conversationEntries = status?.conversationLog?.entries ?? []
  const visibleConversationEntries = conversationEntries.slice(-1)
  const lastThoughtCoreEvent =
    status?.thoughtCoreChat?.lastEvent ??
    thoughtCoreEvents[thoughtCoreEvents.length - 1] ??
    null
  const lastAiChatEvent =
    !developerHudDiagnostics &&
    String(status?.aiChat?.lastEvent?.source ?? '').toLowerCase() === 'dify'
      ? null
      : status?.aiChat?.lastEvent ?? null
  const lastAiEvent =
    (lastThoughtCoreEvent ? { ...lastThoughtCoreEvent, source: 'thought-core' } : null) ??
    lastAiChatEvent ??
    latestEventByTimestamp(
      developerHudDiagnostics && lastDifyEvent
        ? { ...lastDifyEvent, source: 'dify' }
        : null,
      null
    )
  const lastHomeEvent = status?.homeActions?.lastEvent ?? events[0] ?? null
  const environmentSnapshot = status?.environment ?? {}
  const appliances = environmentSnapshot.appliances ?? {}
  const stateQueries = environmentSnapshot.state_queries ?? {}
  const visionSignals = environmentSnapshot.vision ?? {}
  const environmentSources = environmentSnapshot.sources ?? {}
  const visionSource = environmentSources.vision_snapshot_processor
  const homeAssistantSource =
    environmentSources.home_assistant_bridge ?? environmentSources.home_assistant
  const applianceIndicators = Object.entries(appliances)
    .filter((entry): entry is [string, Record<string, any>] =>
      isRecordObject(entry[1])
    )
    .map(([key, signal]) => ({
      id: `appliance-${key}`,
      label: environmentValueLabel(key, 'appliance'),
      title: `Home Assistant state: ${key}`,
      state: environmentSignalState(signal),
      value: environmentStateValueLabel(signal.state),
      summary: compactSourceLabel(signal.source, 'HA'),
      detail: environmentSignalDetailLabel(signal, nowMs, 'HA'),
      updateSignal: buildEnvironmentHudUpdateSignal(key, 'appliance', signal),
    }))
  const stateQueryIndicators = Object.entries(stateQueries)
    .filter((entry): entry is [string, Record<string, any>] =>
      isRecordObject(entry[1])
    )
    .map(([key, signal]) => ({
      id: `state-query-${key}`,
      label: environmentValueLabel(key, 'query'),
      title:
        key === 'room_light'
          ? 'Camera room-light estimate'
          : String(signal.answer_hint ?? `Environment state query: ${key}`),
      state: environmentSignalState(signal, 'DEGRADED'),
      value: environmentStateValueLabel(signal.state),
      summary: compactSourceLabel(
        signal.authority ?? signal.source ?? signal.projected_by,
        'Vision'
      ),
      detail: environmentSignalDetailLabel(signal, nowMs, 'Vision'),
      updateSignal: buildEnvironmentHudUpdateSignal(key, 'query', signal),
    }))
  const visionEstimateIndicators = Object.entries(visionSignals)
    .filter(
      (entry): entry is [string, Record<string, any>] =>
        isRecordObject(entry[1]) &&
        !VISION_SOURCE_ONLY_KEYS.has(entry[0]) &&
        !isRecordObject(stateQueries[entry[0]])
    )
    .map(([key, signal]) => ({
      id: `vision-${key}`,
      label: environmentValueLabel(key, 'vision'),
      title:
        key === 'room_light'
          ? 'Camera room-light estimate'
          : `Camera estimate: ${key}`,
      state: environmentSignalState(signal, 'DEGRADED'),
      value: environmentStateValueLabel(signal.state ?? signal.label),
      summary: compactSourceLabel(signal.source, 'Vision'),
      detail: environmentSignalDetailLabel(signal, nowMs, 'Vision'),
      updateSignal: buildEnvironmentHudUpdateSignal(key, 'vision', signal),
    }))
  const environmentValueIndicators = [
    ...applianceIndicators,
    ...stateQueryIndicators,
    ...visionEstimateIndicators,
  ]
  const environmentIndicators = [
    {
      id: 'environment',
      label: 'ENV',
      title: 'Environment State',
      state: environmentStateService?.state,
      summary: 'Room state',
      detail: serviceFreshnessLabel(
        environmentStateService,
        nowMs,
        status?.timestamp
      ),
    },
    {
      id: 'vision',
      label: 'VISION',
      title: 'Camera/Vision',
      state: environmentSourceState(visionSource, visionSnapshotService?.state),
      summary: 'Camera input',
      detail: environmentSourceFreshnessLabel(
        visionSource,
        visionSnapshotService,
        nowMs,
        status?.timestamp
      ),
    },
    {
      id: 'device',
      label: 'DEVICE',
      title: 'Home Device',
      state: environmentSourceState(homeAssistantSource, homeAssistantService?.state),
      summary: 'Home Assistant',
      detail: homeAssistantSource
        ? environmentSourceFreshnessLabel(
            homeAssistantSource,
            homeAssistantService,
            nowMs,
            status?.timestamp
          )
        : `last ${formatTime(lastHomeEvent?.timestamp)}`,
    },
  ]
  const environmentRailState = aggregateState(
    [
      ...environmentValueIndicators.map((indicator) => indicator.state),
      ...environmentIndicators.map((indicator) => indicator.state),
    ]
  )
  const pipeline = status?.pipeline
  const mediapipe = status?.mediapipe
  const touchdesigner = status?.touchdesigner
  const touchdesignerState = String(touchdesigner?.state ?? '')
  const outputRuntimeIndicators = [
    {
      id: 'display-link',
      label: 'LINK',
      title: 'Display runtime bridge link',
      state: touchdesignerState.includes('READY')
        ? 'OK'
        : touchdesignerState || displayRuntimeService?.state,
      value: touchdesignerState
        ? touchdesignerState.replace(/^UDP_/, '')
        : stateWordLabel(displayRuntimeService?.state),
      detail:
        touchdesigner?.udpHost && touchdesigner?.udpPort
          ? `${touchdesigner.udpHost}:${touchdesigner.udpPort}`
          : serviceFreshnessLabel(displayRuntimeService, nowMs, status?.timestamp),
    },
    {
      id: 'speech',
      label: 'VOICE',
      title: 'Speech runtime',
      state: voicevoxService?.state,
      value: stateWordLabel(voicevoxService?.state),
      detail: serviceFreshnessLabel(voicevoxService, nowMs, status?.timestamp),
    },
    {
      id: 'expression',
      label: 'EXP',
      title: 'Expression runtime: face/speech path, not dance proof',
      state: expressionRuntimeService?.state,
      value: stateWordLabel(expressionRuntimeService?.state),
      detail: serviceFreshnessLabel(
        expressionRuntimeService,
        nowMs,
        status?.timestamp
      ),
    },
  ]
  const magicActive = Boolean(status?.magic?.active)
  const pipelineStage = pipeline?.stage ?? 'WAITING_FOR_INPUT'
  const activeCallId =
    pipelineStage.includes('HOME_ACTION') || magicActive
      ? 'execute'
      : pipelineStage.includes('THOUGHT_CORE')
        ? 'respond'
        : pipelineStage.includes('WAITING')
          ? ''
          : 'observe'
  const sttUpdatedAge =
    sttStatus?.updatedAt !== undefined && nowMs > 0
      ? nowMs - Date.parse(sttStatus.updatedAt)
      : undefined
  const browserSttDiagnosticAge =
    browserSttDiagnostic?.updatedAt !== undefined && nowMs > 0
      ? nowMs - Date.parse(browserSttDiagnostic.updatedAt)
      : undefined
  const latestBridgeDiagnostic =
    sttDiagnostic?.controller === 'gesture_bridge' ? sttDiagnostic : null
  const isHudVisible = isPassiveHud ? true : hud.visible
  const pipelineDetail = isPassiveHud ? '-' : pipeline?.detail ?? '-'
  const sttGateLabel = sttStatus?.speaking
    ? 'speaking'
    : sttStatus?.chatProcessing
      ? 'chat'
      : sttStatus?.continuous
        ? 'open'
        : 'closed'
  const speechAudioLabel = browserSttDiagnostic?.speechDetected
    ? 'speech'
    : browserSttDiagnostic?.recognitionActive
      ? 'listening'
      : 'idle'
  const speechStatusTiles = [
    {
      id: 'mode',
      label: 'STT',
      value: `${(sttStatus?.mode ?? 'pending').toUpperCase()}`,
      detail: String(sttStatus?.state ?? '-'),
      state: sttStatus?.listening ? 'OK' : 'DEGRADED',
    },
    {
      id: 'gate',
      label: 'GATE',
      value: sttGateLabel,
      detail: `age ${formatAge(sttUpdatedAge)}`,
      state: sttStatus?.speaking || sttStatus?.chatProcessing ? 'DEGRADED' : 'OK',
    },
    {
      id: 'phase',
      label: 'PHASE',
      value: compactSpeechPhaseLabel(
        browserSttDiagnostic?.phase ?? browserSttDiagnostic?.event ?? '-'
      ),
      detail: `retry ${browserSttDiagnostic?.attempt ?? 0}`,
      state: browserSttDiagnostic?.error ? 'ERROR' : 'OK',
    },
    {
      id: 'audio',
      label: 'AUDIO',
      value: speechAudioLabel,
      detail: `diag ${formatAge(browserSttDiagnosticAge)}`,
      state: browserSttDiagnostic?.error ? 'ERROR' : compactMetricState(speechAudioLabel),
    },
  ]
  const reflexMetricTiles = [
    {
      id: 'capture',
      label: 'CAP',
      value: compactHudValue('Capture', mediapipe?.capture),
      detail: 'capture',
    },
    {
      id: 'websocket',
      label: 'WS',
      value: compactHudValue('WebSocket', mediapipe?.websocket),
      detail: 'camera hub',
    },
    {
      id: 'fps',
      label: 'FPS',
      value: String(mediapipe?.fps ?? '-'),
      detail: 'camera',
    },
    {
      id: 'primary',
      label: 'GEST',
      value: String(mediapipe?.primary_gesture ?? '-'),
      detail: 'primary',
    },
    {
      id: 'stable',
      label: 'GATE',
      value: String(mediapipe?.stable_state ?? '-'),
      detail: 'stable',
    },
    {
      id: 'age',
      label: 'AGE',
      value: formatAge(mediapipe?.age_ms),
      detail: 'updated',
    },
  ]

  return (
    <>
      <canvas
        ref={canvasRef}
        className={`td-matrix ${hud.matrix ? 'td-matrix-visible' : ''}`}
        aria-hidden="true"
      />
      <div
        className={`projection-visual-hud ${isHudVisible ? '' : 'projection-visual-hud-hidden'}`}
        style={
          {
            '--td-accent': hud.accent,
            '--td-font-size': `${hud.fontSize}px`,
          } as CSSProperties
        }
      >
        <div className="td-panel-column td-panel-column-left">
          <TdPanel
            title="System Cell"
            kicker="ENV / ORGAN BUS"
            className="td-top-left td-system-cell-panel"
          >
            <section
              className="td-state-rail td-state-rail-inline"
              data-state={environmentRailState}
              aria-label="Environment State overview"
            >
              <div className="td-state-rail-header">
                <span>Environment State</span>
                <strong>{stateWordLabel(environmentRailState)}</strong>
              </div>
              <div
                className="td-environment-values"
                aria-label="Environment State values"
              >
                {environmentValueIndicators.map((indicator) => (
                  <div
                    className="td-env-value-card"
                    data-state={normalizeState(indicator.state)}
                    data-update-signal={indicator.updateSignal?.target}
                    data-update-kind={indicator.updateSignal?.kind}
                    data-update-source={indicator.updateSignal?.source}
                    data-update-observed-at={indicator.updateSignal?.observedAt}
                    data-update-snapshot-id={indicator.updateSignal?.snapshotId}
                    data-update-token={indicator.updateSignal?.token}
                    key={
                      indicator.updateSignal?.token
                        ? `${indicator.id}:${indicator.updateSignal.token}`
                        : indicator.id
                    }
                  >
                    <span>{indicator.label}</span>
                    <strong title={indicator.title}>{indicator.value}</strong>
                    <em title={`${indicator.summary} / ${indicator.detail}`}>
                      {indicator.summary} {indicator.detail}
                    </em>
                  </div>
                ))}
              </div>
              <div
                className="td-environment-source-strip"
                aria-label="Environment source health"
              >
                {environmentIndicators.map((indicator) => (
                  <div
                    className="td-source-chip"
                    data-state={normalizeState(indicator.state)}
                    key={indicator.id}
                  >
                    <span>{indicator.label}</span>
                    <strong title={indicator.title}>
                      {stateWordLabel(indicator.state)}
                    </strong>
                    <em title={`${indicator.summary} / ${indicator.detail}`}>
                      {indicator.summary} / {indicator.detail}
                    </em>
                  </div>
                ))}
              </div>
            </section>
            <div
              className="td-action-mode-strip"
              data-mode={homeActionMode.mode}
              data-bridge={homeActionBridgeState}
              aria-label="Home action execution mode"
            >
              <div className="td-action-mode-cell">
                <span>Action Mode</span>
                <strong>{homeActionMode.label}</strong>
                <em>{homeActionMode.detail}</em>
              </div>
              <div className="td-action-mode-cell">
                <span>Bridge</span>
                <strong>{stateLabel(homeActionBridgeState)}</strong>
                <em>接続状態のみ</em>
              </div>
            </div>
            <div className="td-system-cell-divider" />
            <div className="td-cell-map">
              {SYSTEM_SECTIONS.map((section) => {
                const state = sectionState(section.members)
                return (
                  <div
                    className="td-cell-row"
                    data-state={state}
                    key={section.id}
                  >
                    <span className="td-cell-dot" />
                    <span className="td-cell-title">
                      <b>{section.title}</b>
                      <small>{section.detail}</small>
                    </span>
                    <em>{stateLabel(state)}</em>
                  </div>
                )
              })}
            </div>
            <div className="td-contract-strip" aria-label="system contracts">
              <span>turn</span>
              <span>events</span>
              <span>memory</span>
              <span>policy</span>
            </div>
            {legacyServices.length > 0 ? (
              <>
                <div className="td-panel-subtitle">Compatibility External</div>
                <div className="td-services td-services-legacy">
                  {legacyServices.map((service: any) => (
                    <div
                      className="td-service"
                      data-state={service.state}
                      key={serviceKey(service)}
                    >
                      <span className="td-service-dot" />
                      <span className="td-service-title">
                        <b>{serviceLabel(service)}</b>
                        <small>{serviceLayer(service)}</small>
                      </span>
                      <em>{service.state}</em>
                    </div>
                  ))}
                </div>
              </>
            ) : null}
          </TdPanel>

        </div>

        <div className="td-panel-column td-panel-column-right">
          <TdPanel
            title="Reflex + Thought"
            kicker="INPUT / TURN KERNEL"
            className="td-top-right td-reflex-thought-panel"
          >
            <div className="td-sense-metric-grid" aria-label="Reflex state tiles">
              {reflexMetricTiles.map((tile) => (
                <div
                  className="td-sense-metric-tile"
                  data-state={compactMetricState(tile.value)}
                  key={tile.id}
                >
                  <span>{tile.label}</span>
                  <strong title={tile.value}>{tile.value}</strong>
                  <em>{tile.detail}</em>
                </div>
              ))}
            </div>
            <div className="td-panel-subtitle">Speech Input</div>
            <div className="td-stt-mini-grid" aria-label="Speech input states">
              {speechStatusTiles.map((tile) => (
                <div
                  className="td-stt-mini-card"
                  data-state={normalizeState(tile.state)}
                  key={tile.id}
                >
                  <span>{tile.label}</span>
                  <strong title={tile.value}>{tile.value}</strong>
                  <em title={tile.detail}>{tile.detail}</em>
                </div>
              ))}
            </div>
            {latestBridgeDiagnostic ? (
              <div className="td-stt-bridge-line" title={latestBridgeDiagnostic.detail ?? '-'}>
                bridge {latestBridgeDiagnostic.event ?? '-'} /{' '}
                {isPassiveHud
                  ? '-'
                  : latestBridgeDiagnostic.detail?.includes(
                        'SpeechRecognition is inactive'
                      )
                    ? 'recognition inactive'
                    : latestBridgeDiagnostic.detail ?? '-'}
              </div>
            ) : null}
            <div className="td-panel-subtitle">Turn Kernel</div>
            <div className="td-call-chain">
              {SYSTEM_CALLS.map((call) => (
                <div
                  className="td-call"
                  data-state={activeCallId === call.id ? 'ACTIVE' : 'IDLE'}
                  key={call.id}
                >
                  <b>{call.label}</b>
                  <span>{call.detail}</span>
                </div>
              ))}
            </div>
            <div className={`td-magic ${magicActive ? 'td-magic-active' : ''}`}>
              {magicActive
                ? `ACTION ${status?.magic?.lastActionId ?? ''}`
                : 'IDLE'}
            </div>
            <div className="td-panel-subtitle">Turn Trace</div>
            <div className="td-pipeline" data-state={pipelineStage}>
              <strong>{pipelineStage}</strong>
              <em title={pipelineDetail}>{pipelineDetail}</em>
              <span>
                {aiSourceLabel(lastAiEvent)} {lastAiEvent?.event ?? '-'} /{' '}
                {formatTime(lastAiEvent?.timestamp)}
              </span>
              <span>
                Home {lastHomeEvent?.action_id ?? '-'} /{' '}
                {homeActionProofLabel(lastHomeEvent)}
              </span>
            </div>
            {events.length > 0 ? (
              <>
                <div className="td-panel-subtitle">Action Journal</div>
                <div className="td-events">
                  {events.map((event, index) => (
                    <div className="td-event" key={`${event.timestamp}-${index}`}>
                      <strong>{event.action_id || event.event || '-'}</strong>
                      <span>
                        {formatTime(event.timestamp)} / {event.source || '-'} /{' '}
                        {homeActionProofLabel(event)} /{' '}
                        {isPassiveHud
                          ? event.request_id || ''
                          : event.user_text || event.request_id || ''}
                      </span>
                    </div>
                  ))}
                </div>
              </>
            ) : null}
            {!isPassiveHud && (
              <>
                <div className="td-panel-subtitle">Conversation Log</div>
                <div className="td-conversation-log">
                  {visibleConversationEntries.length > 0 ? (
                    visibleConversationEntries.map((entry, index) => (
                      <div
                        className="td-conversation-entry"
                        data-role={String(entry.role ?? '').toLowerCase()}
                        key={`${entry.timestamp}-${entry.role}-${index}`}
                      >
                        <strong>{conversationRoleLabel(entry)}</strong>
                        <span title={conversationEntryText(entry)}>
                          {conversationEntryText(entry)}
                        </span>
                        <em>{conversationEntryMeta(entry)}</em>
                      </div>
                    ))
                  ) : (
                    <div className="td-conversation-empty">
                      NO CONVERSATION LOG
                    </div>
                  )}
                </div>
              </>
            )}
          </TdPanel>

          <TdPanel
            title="Output Runtime"
            kicker="DISPLAY / SPEECH"
            className="td-bottom-right td-output-runtime-panel"
          >
            <div className="td-runtime-mini-grid">
              {outputRuntimeIndicators.map((indicator) => (
                <div
                  className="td-runtime-mini-card"
                  data-state={normalizeState(indicator.state)}
                  key={indicator.id}
                >
                  <span>{indicator.label}</span>
                  <strong title={indicator.title}>{indicator.value}</strong>
                  <em title={String(indicator.detail ?? '-')}>
                    {indicator.detail}
                  </em>
                </div>
              ))}
            </div>
          </TdPanel>
          {!isPassiveHud && (
            <div
              className="td-render-controls-frame"
              aria-label="Projection render controls"
            >
              <label className="td-render-range">
                <span>HUD</span>
                <input
                  type="range"
                  min={MIN_HUD_FONT_SIZE}
                  max={MAX_HUD_FONT_SIZE}
                  step={1}
                  value={hud.fontSize}
                  onChange={(event) =>
                    setHud((current) => ({
                      ...current,
                      fontSize: Number(event.target.value),
                    }))
                  }
                />
                <output>{hud.fontSize}px</output>
              </label>
              <label className="td-render-range">
                <span>Comment</span>
                <input
                  type="range"
                  min={MIN_COMMENT_FONT_SIZE}
                  max={MAX_COMMENT_FONT_SIZE}
                  value={hud.inputFontSize}
                  onChange={(event) =>
                    setHud((current) => ({
                      ...current,
                      inputFontSize: Number(event.target.value),
                    }))
                  }
                />
                <output>{hud.inputFontSize}px</output>
              </label>
              <div className="td-render-actions">
                <label className="td-render-swatch" title="Accent color">
                  <span>Color</span>
                  <input
                    type="color"
                    value={hud.accent}
                    onChange={(event) =>
                      setHud((current) => ({
                        ...current,
                        accent: event.target.value,
                      }))
                    }
                  />
                </label>
                <label className="td-render-toggle" title="Matrix rain">
                  <span>Rain</span>
                  <input
                    type="checkbox"
                    checked={hud.matrix}
                    onChange={(event) =>
                      setHud((current) => ({
                        ...current,
                        matrix: event.target.checked,
                      }))
                    }
                  />
                </label>
                <button type="button" onClick={sendTouchDesignerPing}>
                  Ping
                </button>
                <button type="button" onClick={toggleFullscreen}>
                  Full
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
      {!isPassiveHud && !hud.visible && (
        <button
          className="td-hud-pill"
          type="button"
          onClick={() => setHud((current) => ({ ...current, visible: true }))}
        >
          HUD OFF - H
        </button>
      )}
    </>
  )
}
