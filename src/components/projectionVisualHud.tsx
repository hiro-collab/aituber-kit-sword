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

type EnvironmentLiveMetric = {
  id: string
  label: string
  value: string
  title: string
}

type EnvironmentFreshnessLevel =
  | 'live'
  | 'recent'
  | 'aging'
  | 'stale'
  | 'unknown'

type EnvironmentFreshnessStyle = CSSProperties & {
  '--td-freshness-hue'?: string
  '--td-freshness-saturation'?: string
  '--td-freshness-lightness'?: string
  '--td-freshness-opacity'?: string
  '--td-freshness-glow'?: string
}

type EnvironmentFreshnessVisual = {
  level: EnvironmentFreshnessLevel
  style: EnvironmentFreshnessStyle
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
]

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
  {
    id: 'observe',
    label: 'SENSE',
    detail: 'read env',
    summary: 'Reading environment/context',
  },
  {
    id: 'preview',
    label: 'CHECK',
    detail: 'safe plan',
    summary: 'Checking an action before send',
  },
  {
    id: 'execute',
    label: 'SEND',
    detail: 'request only',
    summary: 'Sending request; proof is elsewhere',
  },
  {
    id: 'respond',
    label: 'REPLY',
    detail: 'avatar / voice',
    summary: 'Showing reply through expression',
  },
]

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
  if (normalized === 'UNREPORTED') return '-'
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

const environmentRailWordLabel = (
  state: unknown,
  freshnessSignals: Array<{ freshnessVisual?: EnvironmentFreshnessVisual }>
): string => {
  const normalized = normalizeState(state)
  if (normalized !== 'DEGRADED') return stateWordLabel(state)
  return freshnessSignals.some(
    (signal) => signal.freshnessVisual?.level === 'stale'
  )
    ? 'Stale'
    : 'Check'
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

const compactSourceLabel = (value: unknown, fallback: string): string => {
  const source = String(value ?? '').toLowerCase()
  if (source.includes('home_assistant')) return 'HA'
  if (source.includes('vision')) return 'Vision'
  if (source.includes('camera')) return 'Camera'
  return fallback
}

const readFreshnessAgeMs = (
  source: any,
  nowMs: number,
  fallbackTimestamp?: string
): number | undefined => {
  const freshness = source?.freshness ?? {}
  const directAge =
    readNumericField(freshness, ['age_ms', 'ageMs']) ??
    readNumericField(source, ['age_ms', 'ageMs', 'freshness_ms', 'freshnessMs'])
  if (directAge !== undefined) return Math.max(0, directAge)

  const timestamp =
    readStringField(source, [
      'observed_at',
      'observedAt',
      'updated_at',
      'updatedAt',
      'checked_at',
      'checkedAt',
      'timestamp',
    ]) ?? fallbackTimestamp
  const timestampMs = timestamp ? Date.parse(timestamp) : Number.NaN
  if (!Number.isFinite(timestampMs) || nowMs <= 0) return undefined
  return Math.max(0, nowMs - timestampMs)
}

const environmentFreshnessVisualLevel = (
  signal: any,
  nowMs: number,
  fallbackTimestamp?: string
): EnvironmentFreshnessLevel => {
  if (!signal) return 'unknown'
  const freshness = signal?.freshness ?? {}
  const freshnessLevel = String(freshness.level ?? '').toLowerCase()
  if (signal.stale || freshnessLevel === 'stale') return 'stale'

  const ageMs = readFreshnessAgeMs(signal, nowMs, fallbackTimestamp)
  if (ageMs === undefined) {
    return freshnessLevel === 'fresh' || freshnessLevel === 'recent'
      ? 'recent'
      : 'unknown'
  }

  if (ageMs <= 2500) return 'live'
  if (ageMs <= 6000) return 'recent'
  if (ageMs <= 15000) return 'aging'
  return 'stale'
}

const environmentFreshnessVisual = (
  signal: any,
  nowMs: number,
  fallbackTimestamp?: string
): EnvironmentFreshnessVisual => {
  const level = environmentFreshnessVisualLevel(
    signal,
    nowMs,
    fallbackTimestamp
  )
  const ageMs = readFreshnessAgeMs(signal, nowMs, fallbackTimestamp)
  if (ageMs === undefined) {
    return {
      level,
      style: {
        '--td-freshness-hue': '190',
        '--td-freshness-saturation': '18%',
        '--td-freshness-lightness': '72%',
        '--td-freshness-opacity': level === 'unknown' ? '0.44' : '0.62',
        '--td-freshness-glow': '0.24',
      },
    }
  }

  const normalRatio = Math.min(1, Math.max(0, ageMs / 8000))
  const staleRatio = Math.min(1, Math.max(0, (ageMs - 8000) / 7000))
  const hue = Math.round(188 - normalRatio * 92 - staleRatio * 66)
  return {
    level,
    style: {
      '--td-freshness-hue': `${hue}`,
      '--td-freshness-saturation': `${Math.round(98 - staleRatio * 10)}%`,
      '--td-freshness-lightness': `${Math.round(68 - staleRatio * 8)}%`,
      '--td-freshness-opacity': `${(0.98 - normalRatio * 0.14).toFixed(2)}`,
      '--td-freshness-glow': `${(0.72 - normalRatio * 0.18).toFixed(2)}`,
    },
  }
}

const freshnessDetailLabel = (
  visual?: EnvironmentFreshnessVisual
): string => {
  if (!visual) return 'age unknown'
  if (visual.level === 'live') return 'fresh signal'
  if (visual.level === 'recent') return 'recent signal'
  if (visual.level === 'aging') return 'aging signal'
  if (visual.level === 'stale') return 'stale signal'
  return 'age unknown'
}

const freshnessVisualFromAgeMs = (
  ageMs: unknown
): EnvironmentFreshnessVisual => {
  const numericAge =
    typeof ageMs === 'number' ? ageMs : Number.parseFloat(String(ageMs ?? ''))
  return Number.isFinite(numericAge)
    ? environmentFreshnessVisual({ age_ms: numericAge }, 0)
    : environmentFreshnessVisual(null, 0)
}

const serviceFreshnessVisual = (
  service: any,
  nowMs: number,
  fallbackTimestamp?: string
): EnvironmentFreshnessVisual => {
  return environmentFreshnessVisual(service, nowMs, fallbackTimestamp)
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
  if (source) return freshnessDetailLabel(environmentFreshnessVisual(source, nowMs))
  return freshnessDetailLabel(
    serviceFreshnessVisual(service, nowMs, fallbackTimestamp)
  )
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

const roomLightEstimateProbabilityLabels = (
  signal: any
): {
  electricLabel?: string
  daylightLabel?: string
} => {
  const evidence = signal?.evidence ?? {}
  const probabilities = signal?.probabilities ?? {}
  const electricProbability =
    readNumericField(evidence, ['electric_on_probability']) ??
    readNumericField(probabilities, ['electric_on']) ??
    readNumericField(signal?.electric_light, ['probability'])
  const daylightProbability =
    readNumericField(evidence, ['daylight_present_probability']) ??
    readNumericField(probabilities, ['daylight_present']) ??
    readNumericField(signal?.daylight, ['probability'])

  return {
    electricLabel: formatProbability(electricProbability) ?? undefined,
    daylightLabel: formatProbability(daylightProbability) ?? undefined,
  }
}

const environmentSignalSampleFreshnessLabel = (
  signal: any,
  nowMs: number
): string | undefined => {
  return freshnessDetailLabel(environmentFreshnessVisual(signal, nowMs))
}

const roomLightLiveMetrics = (
  signal: any,
  nowMs: number
): EnvironmentLiveMetric[] | undefined => {
  if (!signal) return undefined
  const { electricLabel, daylightLabel } =
    roomLightEstimateProbabilityLabels(signal)
  const sampleFreshnessLabel = environmentSignalSampleFreshnessLabel(signal, nowMs)
  const metrics: EnvironmentLiveMetric[] = []

  if (sampleFreshnessLabel) {
    metrics.push({
      id: 'freshness',
      label: 'SAMPLE',
      value: sampleFreshnessLabel,
      title: 'Camera estimate sample freshness',
    })
  }
  if (electricLabel) {
    metrics.push({
      id: 'electric',
      label: 'E',
      value: electricLabel,
      title: 'Electric-light cue estimate',
    })
  }
  if (daylightLabel) {
    metrics.push({
      id: 'daylight',
      label: 'D',
      value: daylightLabel,
      title: 'Daylight cue estimate',
    })
  }

  return metrics.length > 0 ? metrics : undefined
}

const environmentSignalDetailLabel = (
  signal: any,
  nowMs: number,
  fallbackSource: string
): string => {
  if (!signal) return 'not reported'

  const evidence = signal.evidence ?? {}
  const { electricLabel, daylightLabel } =
    roomLightEstimateProbabilityLabels(signal)
  const lightingType =
    readStringField(evidence, ['lighting_type']) ??
    readStringField(signal, ['lighting_type', 'label', 'daylight_state'])
  const confidence = readStringField(signal, [
    'confidence_label',
    'confidenceLabel',
  ])

  if (lightingType && confidence) return `${lightingType} ${confidence}`
  if (lightingType && daylightLabel) return `${lightingType} ${daylightLabel}`
  if (lightingType) return lightingType
  if (daylightLabel) return `daylight ${daylightLabel}`

  if (electricLabel) return `elec cue ${electricLabel}`

  return freshnessDetailLabel(environmentFreshnessVisual(signal, nowMs))
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
  const { electricLabel, daylightLabel } =
    roomLightEstimateProbabilityLabels(signal)
  const snapshotId = readStringField(signal, [
    'source_snapshot_id',
    'sourceSnapshotId',
    'snapshot_id',
    'snapshotId',
    'observation_id',
    'observationId',
  ])

  return [
    target,
    semanticState.toLowerCase(),
    confidence,
    lightingType,
    electricLabel,
    daylightLabel,
    learningLevel,
    snapshotId,
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

    setNowMs(Date.now())
    const timer = window.setInterval(() => setNowMs(Date.now()), 250)
    return () => window.clearInterval(timer)
  }, [])

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
  const sectionState = (members: string[]) => {
    const reportedStates = members
      .map((member) => serviceByKey.get(member)?.state)
      .filter((state) => state !== undefined)
    return reportedStates.length > 0 ? aggregateState(reportedStates) : 'UNREPORTED'
  }
  const events = [...(status?.homeActions?.events ?? [])].reverse().slice(0, 2)
  const thoughtCoreEvents = status?.thoughtCoreChat?.events ?? []
  const conversationEntries = status?.conversationLog?.entries ?? []
  const visibleConversationEntries = conversationEntries.slice(-1)
  const lastThoughtCoreEvent =
    status?.thoughtCoreChat?.lastEvent ??
    thoughtCoreEvents[thoughtCoreEvents.length - 1] ??
    null
  const lastAiEvent =
    (lastThoughtCoreEvent ? { ...lastThoughtCoreEvent, source: 'thought-core' } : null) ??
    status?.aiChat?.lastEvent ??
    null
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
      freshnessVisual: environmentFreshnessVisual(signal, nowMs),
      updateSignal: buildEnvironmentHudUpdateSignal(key, 'appliance', signal),
      liveMetrics: undefined,
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
      freshnessVisual: environmentFreshnessVisual(signal, nowMs),
      updateSignal: buildEnvironmentHudUpdateSignal(key, 'query', signal),
      liveMetrics:
        key === 'room_light' ? roomLightLiveMetrics(signal, nowMs) : undefined,
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
      freshnessVisual: environmentFreshnessVisual(signal, nowMs),
      updateSignal: buildEnvironmentHudUpdateSignal(key, 'vision', signal),
      liveMetrics:
        key === 'room_light' ? roomLightLiveMetrics(signal, nowMs) : undefined,
    }))
  const environmentValueIndicators = [
    ...applianceIndicators,
    ...stateQueryIndicators,
    ...visionEstimateIndicators,
  ]
  const environmentStateFreshness = serviceFreshnessVisual(
    environmentStateService,
    nowMs,
    status?.timestamp
  )
  const visionSourceFreshness = environmentFreshnessVisual(
    visionSource ?? visionSnapshotService,
    nowMs,
    status?.timestamp
  )
  const homeDeviceFreshness = environmentFreshnessVisual(
    homeAssistantSource ?? homeAssistantService ?? lastHomeEvent,
    nowMs,
    status?.timestamp
  )
  const environmentIndicators = [
    {
      id: 'environment',
      label: 'ROOM STATE',
      title: 'Environment State',
      state: environmentStateService?.state,
      summary: 'Environment API',
      detail: freshnessDetailLabel(environmentStateFreshness),
      freshnessVisual: environmentStateFreshness,
    },
    {
      id: 'vision',
      label: 'CAMERA VIEW',
      title: 'Camera/Vision',
      state: environmentSourceState(visionSource, visionSnapshotService?.state),
      summary: 'Vision source',
      detail: environmentSourceFreshnessLabel(
        visionSource,
        visionSnapshotService,
        nowMs,
        status?.timestamp
      ),
      freshnessVisual: visionSourceFreshness,
    },
    {
      id: 'device',
      label: 'HOME DEVICE',
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
        : freshnessDetailLabel(homeDeviceFreshness),
      freshnessVisual: homeDeviceFreshness,
    },
  ]
  const environmentRailState = aggregateState(
    [
      ...environmentValueIndicators.map((indicator) => indicator.state),
      ...environmentIndicators.map((indicator) => indicator.state),
    ]
  )
  const environmentRailLabel = environmentRailWordLabel(environmentRailState, [
    ...environmentValueIndicators,
    ...environmentIndicators,
  ])
  const pipeline = status?.pipeline
  const mediapipe = status?.mediapipe
  const touchdesigner = status?.touchdesigner
  const touchdesignerState = String(touchdesigner?.state ?? '')
  const displayRuntimeFreshness = serviceFreshnessVisual(
    displayRuntimeService,
    nowMs,
    status?.timestamp
  )
  const voiceFreshness = serviceFreshnessVisual(
    voicevoxService,
    nowMs,
    status?.timestamp
  )
  const expressionFreshness = serviceFreshnessVisual(
    expressionRuntimeService,
    nowMs,
    status?.timestamp
  )
  const outputRuntimeIndicators = [
    {
      id: 'display-link',
      label: 'DISPLAY LINK',
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
          : freshnessDetailLabel(displayRuntimeFreshness),
      freshnessVisual: displayRuntimeFreshness,
    },
    {
      id: 'speech',
      label: 'VOICE ENGINE',
      title: 'Speech runtime',
      state: voicevoxService?.state,
      value: stateWordLabel(voicevoxService?.state),
      detail: freshnessDetailLabel(voiceFreshness),
      freshnessVisual: voiceFreshness,
    },
    {
      id: 'expression',
      label: 'AVATAR VIEW',
      title: 'Expression runtime: face/speech path, not dance proof',
      state: expressionRuntimeService?.state,
      value: stateWordLabel(expressionRuntimeService?.state),
      detail: freshnessDetailLabel(expressionFreshness),
      freshnessVisual: expressionFreshness,
    },
  ]
  const magicActive = Boolean(status?.magic?.active)
  const pipelineStage = pipeline?.stage ?? 'WAITING_FOR_INPUT'
  const activeCallId =
    pipelineStage.includes('HOME_ACTION') || magicActive
      ? 'execute'
      : pipelineStage.includes('PREVIEW')
        ? 'preview'
      : pipelineStage.includes('THOUGHT_CORE')
        ? 'respond'
        : pipelineStage.includes('WAITING')
          ? ''
          : 'observe'
  const activeCallIndex = SYSTEM_CALLS.findIndex(
    (call) => call.id === activeCallId
  )
  const activeCall = activeCallIndex >= 0 ? SYSTEM_CALLS[activeCallIndex] : null
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
  const sttGateFreshness = freshnessVisualFromAgeMs(sttUpdatedAge)
  const browserDiagnosticFreshness =
    freshnessVisualFromAgeMs(browserSttDiagnosticAge)
  const mediapipeFreshness = freshnessVisualFromAgeMs(mediapipe?.age_ms)
  const speechStatusTiles = [
    {
      id: 'mode',
      label: 'INPUT MODE',
      value: `${(sttStatus?.mode ?? 'pending').toUpperCase()}`,
      detail: String(sttStatus?.state ?? '-'),
      state: sttStatus?.listening ? 'OK' : 'DEGRADED',
      freshnessVisual: sttGateFreshness,
    },
    {
      id: 'gate',
      label: 'INPUT GATE',
      value: sttGateLabel,
      detail: freshnessDetailLabel(sttGateFreshness),
      state: sttStatus?.speaking || sttStatus?.chatProcessing ? 'DEGRADED' : 'OK',
      freshnessVisual: sttGateFreshness,
    },
    {
      id: 'phase',
      label: 'LISTEN STEP',
      value: compactSpeechPhaseLabel(
        browserSttDiagnostic?.phase ?? browserSttDiagnostic?.event ?? '-'
      ),
      detail: `retry ${browserSttDiagnostic?.attempt ?? 0}`,
      state: browserSttDiagnostic?.error ? 'ERROR' : 'OK',
      freshnessVisual: browserDiagnosticFreshness,
    },
    {
      id: 'audio',
      label: 'AUDIO INPUT',
      value: speechAudioLabel,
      detail: `diag ${freshnessDetailLabel(browserDiagnosticFreshness)}`,
      state: browserSttDiagnostic?.error ? 'ERROR' : compactMetricState(speechAudioLabel),
      freshnessVisual: browserDiagnosticFreshness,
    },
  ]
  const reflexMetricTiles = [
    {
      id: 'capture',
      label: 'CAM CAPTURE',
      value: compactHudValue('Capture', mediapipe?.capture),
      detail: 'camera frame',
      freshnessVisual: mediapipeFreshness,
    },
    {
      id: 'websocket',
      label: 'CAM HUB',
      value: compactHudValue('WebSocket', mediapipe?.websocket),
      detail: 'websocket',
      freshnessVisual: mediapipeFreshness,
    },
    {
      id: 'fps',
      label: 'CAM FPS',
      value: String(mediapipe?.fps ?? '-'),
      detail: 'camera frames/sec',
      freshnessVisual: mediapipeFreshness,
    },
    {
      id: 'primary',
      label: 'GESTURE',
      value: String(mediapipe?.primary_gesture ?? '-'),
      detail: 'primary gesture',
      freshnessVisual: mediapipeFreshness,
    },
    {
      id: 'stable',
      label: 'GESTURE GATE',
      value: String(mediapipe?.stable_state ?? '-'),
      detail: 'stability',
      freshnessVisual: mediapipeFreshness,
    },
    {
      id: 'freshness',
      label: 'CAM FRESH',
      value: freshnessDetailLabel(mediapipeFreshness),
      detail: 'camera freshness',
      freshnessVisual: mediapipeFreshness,
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
                <strong>{environmentRailLabel}</strong>
              </div>
              <div
                className="td-environment-values"
                aria-label="Environment State values"
              >
                {environmentValueIndicators.map((indicator) => (
                  <div
                    className="td-env-value-card"
                    data-state={normalizeState(indicator.state)}
                    data-freshness={indicator.freshnessVisual.level}
                    data-update-signal={indicator.updateSignal?.target}
                    data-update-kind={indicator.updateSignal?.kind}
                    data-update-source={indicator.updateSignal?.source}
                    data-update-observed-at={indicator.updateSignal?.observedAt}
                    data-update-snapshot-id={indicator.updateSignal?.snapshotId}
                    data-update-token={indicator.updateSignal?.token}
                    style={indicator.freshnessVisual.style}
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
                    {indicator.liveMetrics?.length ? (
                      <div
                        className="td-env-live-meter"
                        aria-label={`${indicator.label} live estimate metrics`}
                      >
                        {indicator.liveMetrics.map((metric) => (
                          <span
                            className="td-env-live-chip"
                            data-metric={metric.id}
                            key={metric.id}
                            title={metric.title}
                          >
                            <b>{metric.label}</b>
                            <i>{metric.value}</i>
                          </span>
                        ))}
                      </div>
                    ) : null}
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
                    data-freshness={indicator.freshnessVisual.level}
                    style={indicator.freshnessVisual.style}
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
          </TdPanel>

        </div>

        <div className="td-panel-column td-panel-column-right">
          <TdPanel
            title="Reflex + Thought"
            kicker="INPUT / TURN STATUS"
            className="td-top-right td-reflex-thought-panel"
          >
            <div className="td-sense-metric-grid" aria-label="Reflex state tiles">
              {reflexMetricTiles.map((tile) => (
                <div
                  className="td-sense-metric-tile"
                  data-state={compactMetricState(tile.value)}
                  data-freshness={tile.freshnessVisual?.level}
                  style={tile.freshnessVisual?.style}
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
                  data-freshness={tile.freshnessVisual?.level}
                  style={tile.freshnessVisual?.style}
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
            <div className="td-panel-subtitle">Current Step</div>
            <div
              className="td-turn-stage-summary"
              data-state={activeCall ? 'ACTIVE' : 'IDLE'}
            >
              <span>
                {activeCall
                  ? `STEP ${activeCallIndex + 1}/${SYSTEM_CALLS.length}`
                  : 'WAITING'}
              </span>
              <strong>{activeCall?.label ?? 'IDLE'}</strong>
              <em>{activeCall?.summary ?? 'No active turn step'}</em>
            </div>
            <div className="td-call-chain" aria-label="Turn step progression">
              {SYSTEM_CALLS.map((call, index) => (
                <div
                  className="td-call"
                  data-state={activeCallId === call.id ? 'ACTIVE' : 'IDLE'}
                  data-step={index + 1}
                  key={call.id}
                >
                  <b>{call.label}</b>
                  <span>{call.detail}</span>
                </div>
              ))}
            </div>
            <div className={`td-magic ${magicActive ? 'td-magic-active' : ''}`}>
              <span>Action</span>
              <strong>
                {magicActive ? status?.magic?.lastActionId ?? 'running' : 'idle'}
              </strong>
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
                  data-freshness={indicator.freshnessVisual?.level}
                  style={indicator.freshnessVisual?.style}
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
