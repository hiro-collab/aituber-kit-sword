export type ProjectionVisualRoomLightUpdateKind = 'fresh' | 'updated' | 'stale'

export type ProjectionVisualRoomLightSafeView = {
  kind: ProjectionVisualRoomLightUpdateKind
  state: 'OK' | 'DEGRADED'
  value: string
  detail: string
  observedAt?: string
  snapshotId?: string
  token: string
  metrics?: Array<{
    id: string
    label: string
    value: string
    title: string
  }>
}

const ROOM_LIGHT_OBSERVATION_BUCKETS = new Set([
  'dark',
  'dim',
  'balanced',
  'bright',
])
const ROOM_LIGHT_SOURCES = new Set(['camera_hub', 'vision_snapshot_processor'])
const CANONICAL_MODEL_NAME = 'room-light-heuristic-snapshot-v3'
const CANONICAL_MODEL_KIND = 'heuristic'
const CANONICAL_DOES_NOT_PROVE = [
  'physical_room_light_state',
  'home_assistant_light_state',
] as const
const MAX_IDENTIFIER_LENGTH = 160
const PRINTABLE_IDENTIFIER = /^[\x21-\x7e]+$/
const STALE_DETAIL = 'Camera room-light observation unavailable'

const ROOM_LIGHT_STRUCTURAL_DISCRIMINATORS = [
  'observation_bucket',
  'daylight_ambiguity',
  'cue_likelihoods',
] as const

type RecordValue = Record<string, unknown>

const isRecord = (value: unknown): value is RecordValue =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const hasOwn = (value: RecordValue, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(value, key)

const isLikelihood = (value: unknown): value is number =>
  typeof value === 'number' &&
  Number.isFinite(value) &&
  value >= 0 &&
  value <= 1

const isBoundedIdentifier = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length > 0 &&
  value.length <= MAX_IDENTIFIER_LENGTH &&
  PRINTABLE_IDENTIFIER.test(value)

const isParseableTimestamp = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.trim().length > 0 &&
  Number.isFinite(Date.parse(value))

const isRoomLightLike = (value: RecordValue): boolean =>
  value.type === 'room_light_observation' ||
  ROOM_LIGHT_STRUCTURAL_DISCRIMINATORS.some((key) => hasOwn(value, key))

const hasCompleteSequence = (value: unknown): boolean => {
  if (!isRecord(value)) return false

  const { frame_count, first_frame_id, last_frame_id, temporal_window_ms } =
    value
  return (
    typeof frame_count === 'number' &&
    Number.isInteger(frame_count) &&
    frame_count > 0 &&
    typeof first_frame_id === 'number' &&
    Number.isInteger(first_frame_id) &&
    first_frame_id >= 0 &&
    typeof last_frame_id === 'number' &&
    Number.isInteger(last_frame_id) &&
    last_frame_id >= first_frame_id &&
    typeof temporal_window_ms === 'number' &&
    Number.isInteger(temporal_window_ms) &&
    temporal_window_ms >= 0 &&
    frame_count <= last_frame_id - first_frame_id + 1
  )
}

const hasCanonicalModel = (value: unknown): boolean =>
  isRecord(value) &&
  value.name === CANONICAL_MODEL_NAME &&
  value.kind === CANONICAL_MODEL_KIND

const hasCanonicalDoesNotProve = (value: unknown): boolean =>
  Array.isArray(value) &&
  value.length === CANONICAL_DOES_NOT_PROVE.length &&
  CANONICAL_DOES_NOT_PROVE.every((item, index) => value[index] === item)

const hasRecognizedFreshness = (value: unknown): boolean =>
  isRecord(value) &&
  (value.level === 'fresh' ||
    value.level === 'recent' ||
    value.level === 'stale')

const isCompleteRoomLightObservation = (value: RecordValue): boolean => {
  const { observation_bucket, daylight_ambiguity, cue_likelihoods } = value
  return (
    value.type === 'room_light_observation' &&
    value.schema_version === 1 &&
    typeof observation_bucket === 'string' &&
    ROOM_LIGHT_OBSERVATION_BUCKETS.has(observation_bucket) &&
    isLikelihood(value.confidence) &&
    (daylight_ambiguity === 'low' ||
      daylight_ambiguity === 'medium' ||
      daylight_ambiguity === 'high') &&
    isRecord(cue_likelihoods) &&
    isLikelihood(cue_likelihoods.warm_light) &&
    isLikelihood(cue_likelihoods.daylight) &&
    isLikelihood(cue_likelihoods.darkness) &&
    typeof value.source === 'string' &&
    ROOM_LIGHT_SOURCES.has(value.source) &&
    value.source_class === 'camera_environment_estimate' &&
    isParseableTimestamp(value.observed_at) &&
    (isBoundedIdentifier(value.observation_id) ||
      isBoundedIdentifier(value.source_snapshot_id)) &&
    hasCompleteSequence(value.sequence) &&
    hasCanonicalModel(value.model) &&
    value.proof_ceiling === 'camera_environment_estimate_only' &&
    hasCanonicalDoesNotProve(value.does_not_prove) &&
    (value.freshness === undefined || hasRecognizedFreshness(value.freshness))
  )
}

const formatProbability = (value: number): string =>
  `${Math.round(value * 100)}%`

const staleSafeView = (): ProjectionVisualRoomLightSafeView => ({
  kind: 'stale',
  state: 'DEGRADED',
  value: 'Unknown',
  detail: STALE_DETAIL,
  token: 'environment.vision.room_light:degraded',
})

export const resolveProjectionVisualRoomLightSafeView = (
  signal: unknown
): ProjectionVisualRoomLightSafeView | undefined => {
  if (!isRecord(signal) || !isRoomLightLike(signal)) return undefined
  if (!isCompleteRoomLightObservation(signal)) return staleSafeView()

  const kind =
    signal.stale === true ||
    signal.available === false ||
    (isRecord(signal.freshness) && signal.freshness.level === 'stale')
      ? 'stale'
      : hasOwn(signal, 'updated_at') || hasOwn(signal, 'updatedAt')
        ? 'updated'
        : 'fresh'
  if (kind === 'stale') return staleSafeView()

  const cueLikelihoods = signal.cue_likelihoods as RecordValue
  const observationBucket = signal.observation_bucket as string
  const confidence = signal.confidence as number
  const daylightAmbiguity = signal.daylight_ambiguity as string
  const snapshotId = isBoundedIdentifier(signal.source_snapshot_id)
    ? signal.source_snapshot_id
    : isBoundedIdentifier(signal.observation_id)
      ? signal.observation_id
      : undefined

  return {
    kind,
    state: 'OK',
    value: observationBucket.replace(/^./, (letter) => letter.toUpperCase()),
    detail: `${observationBucket} | confidence ${formatProbability(confidence)} | daylight ambiguity ${daylightAmbiguity.toUpperCase()}`,
    observedAt: signal.observed_at as string,
    snapshotId,
    token: [
      'environment.vision.room_light',
      observationBucket,
      formatProbability(confidence),
      daylightAmbiguity,
      formatProbability(cueLikelihoods.warm_light as number),
      formatProbability(cueLikelihoods.daylight as number),
      formatProbability(cueLikelihoods.darkness as number),
    ].join(':'),
    metrics: [
      {
        id: 'confidence',
        label: 'CONF',
        value: formatProbability(confidence),
        title: 'Observation confidence',
      },
      {
        id: 'daylight-ambiguity',
        label: 'AMB',
        value: daylightAmbiguity.toUpperCase(),
        title: 'Daylight ambiguity',
      },
      {
        id: 'warm-light',
        label: 'WARM',
        value: formatProbability(cueLikelihoods.warm_light as number),
        title: 'Warm-light cue likelihood',
      },
      {
        id: 'daylight',
        label: 'DAY',
        value: formatProbability(cueLikelihoods.daylight as number),
        title: 'Daylight cue likelihood',
      },
      {
        id: 'darkness',
        label: 'DARK',
        value: formatProbability(cueLikelihoods.darkness as number),
        title: 'Darkness cue likelihood',
      },
    ],
  }
}

export const resolveProjectionVisualRoomLightUpdateKind = (
  signal: unknown
): ProjectionVisualRoomLightUpdateKind | undefined =>
  resolveProjectionVisualRoomLightSafeView(signal)?.kind
