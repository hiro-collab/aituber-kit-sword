export const MOTION_STIMULUS_RECEIVER_EVENT =
  'projection-visual-motion-stimulus'
export const MOTION_STIMULUS_RECEIVER_RESULT_EVENT =
  'projection-visual-motion-stimulus-result'

export const DEFAULT_DANCE_MOTION_ASSET_PATH =
  '/local-vrma/worker2-demo-dance.vrma'

export const CONTEXT_NOD_GROUP_KEY = 'context.nod'
export const CONTEXT_NOD_DURATION_MS = 900
export const DANCE_SEQUENCE_GROUP_KEY = 'dance.sequence'

export type MotionStimulusReceiverStatus =
  | 'accepted'
  | 'started'
  | 'completed'
  | 'degraded'
  | 'unavailable'
  | 'failed_safe'

export type MotionStimulusReceiverLifecycleState =
  | 'request_issued'
  | 'runtime_accepted'
  | 'runtime_started'
  | 'result'

export interface MotionStimulusTraceIds {
  event_id?: string
  turn_id?: string
  session_id?: string
  request_id?: string
  attempt_id?: string
  multi_stimulus_group_id?: string
  runtime_result_id?: string
  motion_event_id: string
  stimulus_id: string
  stimulus_instance_id: string
  driver_result_id?: string
}

export interface MotionStimulusRuntimeStartRequest {
  assetPath: string
  stimulusId: string
  stimulusInstanceId: string
  groupKey: string
  requestedAtMs: number
  loop: boolean
  trace: MotionStimulusTraceIds
}

export interface MotionStimulusRuntimeContextNodRequest {
  stimulusId: string
  stimulusInstanceId: string
  groupKey: string
  requestedAtMs: number
  durationMs: number
  trace: MotionStimulusTraceIds
}

export interface MotionStimulusRuntimeStopRequest {
  stimulusId: string
  stimulusInstanceId: string
  groupKey: string
  requestedAtMs: number
  trace: MotionStimulusTraceIds
}

export interface MotionStimulusRuntimeExpressionVisibleRequest {
  stimulusId: string
  stimulusInstanceId: string
  requestedAtMs: number
  expressionProfileRef: string
  expressionProfileId: string
  expressionWeights: Record<string, number>
  expressionTargetWeights: Record<string, number>
  frameCount: number
  trace: MotionStimulusTraceIds
}

export interface MotionStimulusRuntimeStartResult {
  status: MotionStimulusReceiverStatus
  reason_code: string
  runtime_result_id?: string
  safe_visible_state?: string
}

export interface MotionStimulusReceiverAdapter {
  startDance: (
    request: MotionStimulusRuntimeStartRequest
  ) =>
    | MotionStimulusRuntimeStartResult
    | Promise<MotionStimulusRuntimeStartResult>
  startContextNod?: (
    request: MotionStimulusRuntimeContextNodRequest
  ) =>
    | MotionStimulusRuntimeStartResult
    | Promise<MotionStimulusRuntimeStartResult>
  startExpressionVisible?: (
    request: MotionStimulusRuntimeExpressionVisibleRequest
  ) =>
    | MotionStimulusRuntimeStartResult
    | Promise<MotionStimulusRuntimeStartResult>
  stopDance?: (
    request: MotionStimulusRuntimeStopRequest
  ) =>
    | MotionStimulusRuntimeStartResult
    | Promise<MotionStimulusRuntimeStartResult>
}

export interface MotionStimulusLifecycleTraceEntry {
  state: MotionStimulusReceiverLifecycleState
  status: MotionStimulusReceiverStatus
  reason_code: string
  at_ms: number
}

export interface MotionStimulusReceiverResult {
  source_kind: 'thought_core_motion_stimulus_v0'
  debug_playback: false
  accepted: boolean
  status: MotionStimulusReceiverStatus
  reason_code: string
  safe_visible_state: string
  motion_event_id?: string
  stimulus_id?: string
  stimulus_instance_id?: string
  event_id?: string
  turn_id?: string
  session_id?: string
  request_id?: string
  attempt_id?: string
  multi_stimulus_group_id?: string
  runtime_result_id?: string
  driver_result_id?: string
  lifecycle_trace: MotionStimulusLifecycleTraceEntry[]
}

interface NormalizedMotionStimulus {
  motionEventId: string
  stimulusId: string
  stimulusInstanceId: string
  requestedAtMs: number
  requestMode: string
  kind: string
  payloadRef?: string
  durationMs?: number
  loop?: boolean
  interruptPolicy?: string
  fallbackState?: string
  stopReason?: string
  targetModelType: string
  trackMask?: Record<string, unknown>
  requirements?: Record<string, unknown>
  trace: MotionStimulusTraceIds
}

const REQUIRED_STIMULUS_FIELDS = [
  'schema_version',
  'motion_event_id',
  'stimulus_id',
  'stimulus_instance_id',
  'source_class',
  'source_origin',
  'requested_at',
  'kind',
  'request_mode',
  'phase',
  'lifecycle_state',
  'safe_visible_state',
  'target_model_type',
  'track_mask',
  'requirements',
  'trace',
  'redaction',
] as const

const UNSAFE_FIELD_NAMES = new Set([
  'action',
  'action_id',
  'action_type',
  'appliance',
  'appliance_id',
  'entity_id',
  'ha_entity_id',
  'raw_prompt',
  'prompt',
  'provider_payload',
  'provider_response',
  'raw_transcript',
  'transcript',
  'raw_media',
  'audio',
  'video',
  'screenshot',
  'local_path',
  'private_path',
  'absolute_path',
  'device_route',
  'ha_route',
  'target',
  'url',
])
const HOME_CONTROL_MARKER_NAMES = new Set([
  'contains_home_control_route',
  'home_action',
  'home_control',
  'home_control_route',
  'is_home_action',
])
const SENSITIVE_FIELD_PATTERN =
  /(?:authorization|credential|password|secret|token|api[_-]?key|confirmation)/i
const UNSAFE_STRING_PATTERN = /(?:https?:\/\/|file:\/\/|[a-zA-Z]:[\\/]|\\\\)/
const UNSAFE_CORRELATION_ID_PATTERN =
  /(?:raw|private|provider|device|entity|ha_entity|home_control|home|appliance|media|audio|video|transcript|prompt|token|secret|credential|password|authorization|api[_-]?key)/i

const ALLOWED_DANCE_STIMULUS_IDS = new Set([
  'dance',
  'dance.sequence',
  'dance_sequence',
  'dance.full_body',
  'dance_sequence.thought_core',
  'dance_sequence.local_vrma',
])

const DANCE_SEQUENCE_PAYLOAD_REFS = new Set([
  'motion.thought_core.dance_sequence.v0',
])
const MOTION_STOP_PAYLOAD_REFS = new Set(['motion.thought_core.stop.v0'])
const MOTION_STOP_INTERRUPT_POLICY = 'stop'
const MOTION_STOP_FALLBACK_STATE = 'stop_to_idle'
const MOTION_STOP_REASON = 'user_requested'

const CONTEXT_NOD_PAYLOAD_REFS = new Set([
  'motion.thought_core.expression.v0',
  'motion.fixture.context_nod.v0',
])
const EXPRESSION_VISIBLE_PAYLOAD_REF =
  'motion.thought_core.expression_visible.v0'
const EXPRESSION_VISIBLE_PROFILE_REF =
  'motion.runtime.vrm_expression_weights.v0'
const EXPRESSION_VISIBLE_FULL_RELAXED_PROFILE_REF =
  'motion.runtime.vrm_expression_weights.full_relaxed.v0'
const EXPRESSION_VISIBLE_CHANGE = 'face_expression'
const EXPRESSION_VISIBLE_ROI = 'avatar_face_head'
const EXPRESSION_VISIBLE_TRACK_SCOPE = 'face_head'
const EXPRESSION_VISIBLE_TRACK_CHANNEL = 'expression_weight'
const EXPRESSION_VISIBLE_FRAME_WEIGHTS = {
  happy: 1,
  relaxed: 0.75,
  joy: 1,
  Joy: 1,
  fun: 0.75,
  Fun: 0.75,
}
const EXPRESSION_VISIBLE_FULL_RELAXED_FRAME_WEIGHTS = {
  happy: 1,
  relaxed: 1,
  joy: 1,
  Joy: 1,
  fun: 1,
  Fun: 1,
}
const EXPRESSION_VISIBLE_FRAME_COUNT = 30

type ExpressionVisibleProfile = {
  profileRef: string
  profileId: 'expression_visible_default' | 'expression_visible_full_relaxed'
  expressionWeights: Record<string, number>
}

const EXPRESSION_VISIBLE_PROFILES: Record<string, ExpressionVisibleProfile> = {
  [EXPRESSION_VISIBLE_PROFILE_REF]: {
    profileRef: EXPRESSION_VISIBLE_PROFILE_REF,
    profileId: 'expression_visible_default',
    expressionWeights: EXPRESSION_VISIBLE_FRAME_WEIGHTS,
  },
  [EXPRESSION_VISIBLE_FULL_RELAXED_PROFILE_REF]: {
    profileRef: EXPRESSION_VISIBLE_FULL_RELAXED_PROFILE_REF,
    profileId: 'expression_visible_full_relaxed',
    expressionWeights: EXPRESSION_VISIBLE_FULL_RELAXED_FRAME_WEIGHTS,
  },
}

export async function receiveMotionStimulusV0(
  input: unknown,
  adapter: MotionStimulusReceiverAdapter,
  args: { nowMs?: () => number } = {}
): Promise<MotionStimulusReceiverResult> {
  const nowMs = args.nowMs ?? Date.now
  const normalized = normalizeMotionStimulus(input)
  if (normalized.ok === false) {
    return createRejectedResult(normalized.reasonCode, nowMs())
  }

  const stimulus = normalized.stimulus
  const issuedAtMs = stimulus.requestedAtMs
  if (stimulus.targetModelType !== 'vrm') {
    return createUnavailableResult(
      stimulus,
      'target_model_type_unavailable',
      issuedAtMs
    )
  }
  if (isMotionStopStimulus(stimulus)) {
    if (!adapter.stopDance) {
      return createUnavailableResult(
        stimulus,
        'dance_stop_adapter_unavailable',
        issuedAtMs
      )
    }

    const stopResult = await adapter.stopDance({
      stimulusId: stimulus.stimulusId,
      stimulusInstanceId: stimulus.stimulusInstanceId,
      groupKey: DANCE_SEQUENCE_GROUP_KEY,
      requestedAtMs: issuedAtMs,
      trace: stimulus.trace,
    })

    return createRuntimeResult(stimulus, stopResult, nowMs())
  }
  if (isExpressionVisibleContractEnvelope(stimulus)) {
    if (!hasExpressionVisibleRequirementShape(stimulus.requirements)) {
      return createUnavailableResult(
        stimulus,
        'stimulus_not_supported_by_receiver_v0',
        issuedAtMs
      )
    }
    const expressionProfile = resolveExpressionVisibleProfile(
      stimulus.requirements
    )
    if (!expressionProfile) {
      return createUnavailableResult(
        stimulus,
        'expression_visible_profile_ref_unsupported',
        issuedAtMs
      )
    }
    if (!adapter.startExpressionVisible) {
      return createUnavailableResult(
        stimulus,
        'expression_visible_adapter_unavailable',
        issuedAtMs
      )
    }

    const expressionVisibleResult = await adapter.startExpressionVisible({
      stimulusId: stimulus.stimulusId,
      stimulusInstanceId: stimulus.stimulusInstanceId,
      requestedAtMs: issuedAtMs,
      expressionProfileRef: expressionProfile.profileRef,
      expressionProfileId: expressionProfile.profileId,
      expressionWeights: { ...expressionProfile.expressionWeights },
      expressionTargetWeights: { ...expressionProfile.expressionWeights },
      frameCount: EXPRESSION_VISIBLE_FRAME_COUNT,
      trace: stimulus.trace,
    })

    return createRuntimeResult(stimulus, expressionVisibleResult, nowMs())
  }
  if (isRepresentativeContextNodStimulus(stimulus)) {
    if (!adapter.startContextNod) {
      return createUnavailableResult(
        stimulus,
        'context_nod_adapter_unavailable',
        issuedAtMs
      )
    }

    const contextNodResult = await adapter.startContextNod({
      stimulusId: stimulus.stimulusId,
      stimulusInstanceId: stimulus.stimulusInstanceId,
      groupKey: CONTEXT_NOD_GROUP_KEY,
      requestedAtMs: issuedAtMs,
      durationMs: CONTEXT_NOD_DURATION_MS,
      trace: stimulus.trace,
    })

    return createRuntimeResult(stimulus, contextNodResult, nowMs())
  }

  if (isDanceStimulus(stimulus)) {
    if (!isSupportedDanceRequestMode(stimulus)) {
      return createUnavailableResult(
        stimulus,
        'request_mode_not_supported_by_receiver_v0',
        issuedAtMs
      )
    }

    const startResult = await adapter.startDance({
      assetPath: DEFAULT_DANCE_MOTION_ASSET_PATH,
      stimulusId: stimulus.stimulusId,
      stimulusInstanceId: stimulus.stimulusInstanceId,
      groupKey: DANCE_SEQUENCE_GROUP_KEY,
      requestedAtMs: issuedAtMs,
      loop: true,
      trace: stimulus.trace,
    })

    return createRuntimeResult(stimulus, startResult, nowMs())
  }

  return createUnavailableResult(
    stimulus,
    'stimulus_not_supported_by_receiver_v0',
    issuedAtMs
  )
}

function normalizeMotionStimulus(
  input: unknown
):
  | { ok: true; stimulus: NormalizedMotionStimulus }
  | { ok: false; reasonCode: string } {
  if (!isRecord(input)) {
    return { ok: false, reasonCode: 'motion_stimulus_not_object' }
  }
  const missing = REQUIRED_STIMULUS_FIELDS.filter((field) => !(field in input))
  if (missing.length > 0) {
    return { ok: false, reasonCode: 'motion_stimulus_missing_required_fields' }
  }
  if (findUnsafeField(input)) {
    return { ok: false, reasonCode: 'motion_stimulus_contains_unsafe_field' }
  }

  const motionEventId = safeString(input.motion_event_id)
  const stimulusId = safeString(input.stimulus_id)
  const stimulusInstanceId = safeString(input.stimulus_instance_id)
  const requestedAtText = safeString(input.requested_at)
  const kind = safeString(input.kind)
  const payloadRef = optionalSafeString(input.payload_ref)
  const requestMode = safeString(input.request_mode).toLowerCase()
  const durationMs =
    typeof input.duration_ms === 'number' && Number.isFinite(input.duration_ms)
      ? input.duration_ms
      : undefined
  const loop = typeof input.loop === 'boolean' ? input.loop : undefined
  const interruptPolicy = optionalSafeString(input.interrupt_policy)
  const fallbackState = optionalSafeString(input.fallback_state)
  const stopReason = optionalSafeString(input.stop_reason)
  const targetModelType = safeString(input.target_model_type).toLowerCase()
  if (
    !motionEventId ||
    !stimulusId ||
    !stimulusInstanceId ||
    !requestedAtText ||
    !kind ||
    !requestMode ||
    !targetModelType
  ) {
    return { ok: false, reasonCode: 'motion_stimulus_required_field_empty' }
  }
  if (
    !isSafeIdentifier(motionEventId) ||
    !isSafeIdentifier(stimulusId) ||
    !isSafeIdentifier(stimulusInstanceId)
  ) {
    return { ok: false, reasonCode: 'motion_stimulus_id_not_safe' }
  }

  const requestedAtMs = Date.parse(requestedAtText)
  if (!Number.isFinite(requestedAtMs)) {
    return { ok: false, reasonCode: 'motion_stimulus_requested_at_invalid' }
  }

  const traceRecord = isRecord(input.trace) ? input.trace : {}
  const trackMask = isRecord(input.track_mask) ? input.track_mask : undefined
  const requirements = isRecord(input.requirements)
    ? input.requirements
    : undefined
  const driverResultId = optionalSafeString(traceRecord.driver_result_id)
  const runtimeResultId = optionalSafeString(traceRecord.runtime_result_id)
  const trace: MotionStimulusTraceIds = {
    event_id: optionalSafeString(traceRecord.event_id),
    turn_id: optionalSafeString(traceRecord.turn_id),
    session_id: optionalSafeString(traceRecord.session_id),
    request_id: optionalSafeString(traceRecord.request_id),
    attempt_id:
      optionalSafeString(traceRecord.attempt_id) ??
      optionalSafeString(traceRecord.attempt),
    multi_stimulus_group_id: optionalSafeCorrelationId(
      traceRecord.multi_stimulus_group_id
    ),
    runtime_result_id: runtimeResultId,
    motion_event_id: motionEventId,
    stimulus_id: stimulusId,
    stimulus_instance_id: stimulusInstanceId,
    driver_result_id: driverResultId,
  }

  return {
    ok: true,
    stimulus: {
      motionEventId,
      stimulusId,
      stimulusInstanceId,
      requestedAtMs,
      requestMode,
      kind,
      payloadRef,
      durationMs,
      loop,
      interruptPolicy,
      fallbackState,
      stopReason,
      targetModelType,
      trackMask,
      requirements,
      trace,
    },
  }
}

function createRuntimeResult(
  stimulus: NormalizedMotionStimulus,
  startResult: MotionStimulusRuntimeStartResult,
  observedAtMs: number
): MotionStimulusReceiverResult {
  const accepted =
    startResult.status === 'accepted' ||
    startResult.status === 'started' ||
    startResult.status === 'completed'
  const lifecycleTrace: MotionStimulusLifecycleTraceEntry[] = [
    {
      state: 'request_issued',
      status: 'accepted',
      reason_code: 'motion_stimulus_received',
      at_ms: stimulus.requestedAtMs,
    },
  ]
  if (accepted) {
    lifecycleTrace.push({
      state: 'runtime_accepted',
      status: 'accepted',
      reason_code: isStopResult(startResult)
        ? 'motion_runtime_stop_adapter_accepted'
        : 'motion_runtime_start_adapter_accepted',
      at_ms: observedAtMs,
    })
  }
  if (startResult.status === 'started' || startResult.status === 'completed') {
    lifecycleTrace.push({
      state: 'runtime_started',
      status: 'started',
      reason_code: startResult.reason_code,
      at_ms: observedAtMs,
    })
  }
  lifecycleTrace.push({
    state: 'result',
    status: startResult.status,
    reason_code: startResult.reason_code,
    at_ms: observedAtMs,
  })

  return {
    source_kind: 'thought_core_motion_stimulus_v0',
    debug_playback: false,
    accepted,
    status: startResult.status,
    reason_code: startResult.reason_code,
    safe_visible_state: startResult.safe_visible_state ?? 'unknown',
    motion_event_id: stimulus.motionEventId,
    stimulus_id: stimulus.stimulusId,
    stimulus_instance_id: stimulus.stimulusInstanceId,
    event_id: stimulus.trace.event_id,
    turn_id: stimulus.trace.turn_id,
    session_id: stimulus.trace.session_id,
    request_id: stimulus.trace.request_id,
    attempt_id: stimulus.trace.attempt_id,
    multi_stimulus_group_id: stimulus.trace.multi_stimulus_group_id,
    runtime_result_id:
      startResult.runtime_result_id ?? stimulus.trace.runtime_result_id,
    driver_result_id: stimulus.trace.driver_result_id,
    lifecycle_trace: lifecycleTrace,
  }
}

function isStopResult(result: MotionStimulusRuntimeStartResult): boolean {
  return (
    result.reason_code === 'motion_stopped' ||
    result.reason_code === 'motion_runtime_stop_requested'
  )
}

function createUnavailableResult(
  stimulus: NormalizedMotionStimulus,
  reasonCode: string,
  atMs: number
): MotionStimulusReceiverResult {
  return {
    source_kind: 'thought_core_motion_stimulus_v0',
    debug_playback: false,
    accepted: false,
    status: 'unavailable',
    reason_code: reasonCode,
    safe_visible_state: 'no_visible_change',
    motion_event_id: stimulus.motionEventId,
    stimulus_id: stimulus.stimulusId,
    stimulus_instance_id: stimulus.stimulusInstanceId,
    event_id: stimulus.trace.event_id,
    turn_id: stimulus.trace.turn_id,
    session_id: stimulus.trace.session_id,
    request_id: stimulus.trace.request_id,
    attempt_id: stimulus.trace.attempt_id,
    multi_stimulus_group_id: stimulus.trace.multi_stimulus_group_id,
    runtime_result_id: stimulus.trace.runtime_result_id,
    driver_result_id: stimulus.trace.driver_result_id,
    lifecycle_trace: [
      {
        state: 'request_issued',
        status: 'accepted',
        reason_code: 'motion_stimulus_received',
        at_ms: stimulus.requestedAtMs,
      },
      {
        state: 'result',
        status: 'unavailable',
        reason_code: reasonCode,
        at_ms: atMs,
      },
    ],
  }
}

function createRejectedResult(
  reasonCode: string,
  atMs: number
): MotionStimulusReceiverResult {
  return {
    source_kind: 'thought_core_motion_stimulus_v0',
    debug_playback: false,
    accepted: false,
    status: 'unavailable',
    reason_code: reasonCode,
    safe_visible_state: 'no_visible_change',
    lifecycle_trace: [
      {
        state: 'result',
        status: 'unavailable',
        reason_code: reasonCode,
        at_ms: atMs,
      },
    ],
  }
}

function isDanceStimulus(stimulus: NormalizedMotionStimulus): boolean {
  const stimulusId = stimulus.stimulusId.toLowerCase()
  const kind = stimulus.kind.toLowerCase()
  return (
    ALLOWED_DANCE_STIMULUS_IDS.has(stimulusId) ||
    kind === 'dance' ||
    isContractDanceSequenceStimulus(stimulus)
  )
}

function isContractDanceSequenceStimulus(
  stimulus: NormalizedMotionStimulus
): boolean {
  return (
    stimulus.kind.toLowerCase() === 'dance_sequence' &&
    Boolean(
      stimulus.payloadRef &&
      DANCE_SEQUENCE_PAYLOAD_REFS.has(stimulus.payloadRef)
    )
  )
}

function isMotionStopStimulus(stimulus: NormalizedMotionStimulus): boolean {
  const kind = stimulus.kind.toLowerCase()
  return (
    (kind === 'stop' || kind === 'motion_stop' || kind === 'dance_sequence') &&
    stimulus.requestMode === 'stop' &&
    Boolean(
      stimulus.payloadRef && MOTION_STOP_PAYLOAD_REFS.has(stimulus.payloadRef)
    ) &&
    hasCompatibleMotionStopMetadata(stimulus)
  )
}

function hasCompatibleMotionStopMetadata(
  stimulus: NormalizedMotionStimulus
): boolean {
  if (stimulus.durationMs !== undefined && stimulus.durationMs !== 0) {
    return false
  }
  if (stimulus.loop !== undefined && stimulus.loop !== false) {
    return false
  }
  if (
    stimulus.interruptPolicy &&
    stimulus.interruptPolicy !== MOTION_STOP_INTERRUPT_POLICY
  ) {
    return false
  }
  if (
    stimulus.fallbackState &&
    stimulus.fallbackState !== MOTION_STOP_FALLBACK_STATE
  ) {
    return false
  }
  if (stimulus.stopReason && stimulus.stopReason !== MOTION_STOP_REASON) {
    return false
  }
  return true
}

function isSupportedDanceRequestMode(
  stimulus: NormalizedMotionStimulus
): boolean {
  if (stimulus.requestMode === 'start' || stimulus.requestMode === 'replace') {
    return true
  }

  return (
    stimulus.requestMode === 'play' && isContractDanceSequenceStimulus(stimulus)
  )
}

function isExpressionVisibleContractEnvelope(
  stimulus: NormalizedMotionStimulus
): boolean {
  return (
    stimulus.kind.toLowerCase() === 'expression' &&
    stimulus.requestMode === 'apply' &&
    stimulus.payloadRef === EXPRESSION_VISIBLE_PAYLOAD_REF &&
    hasExpressionVisibleTrackMask(stimulus.trackMask)
  )
}

function isRepresentativeContextNodStimulus(
  stimulus: NormalizedMotionStimulus
): boolean {
  if (stimulus.requestMode !== 'play') return false

  const kind = stimulus.kind.toLowerCase()
  if (kind !== 'expression' && kind !== 'posture') return false

  return Boolean(
    stimulus.payloadRef && CONTEXT_NOD_PAYLOAD_REFS.has(stimulus.payloadRef)
  )
}

function hasExpressionVisibleRequirementShape(
  requirements?: Record<string, unknown>
): boolean {
  return Boolean(
    requirements &&
    safeString(requirements.expected_visible_change) ===
      EXPRESSION_VISIBLE_CHANGE &&
    safeString(requirements.expected_roi) === EXPRESSION_VISIBLE_ROI
  )
}

function resolveExpressionVisibleProfile(
  requirements?: Record<string, unknown>
): ExpressionVisibleProfile | null {
  const profileRef = safeString(requirements?.expression_profile_ref)
  if (!profileRef)
    return EXPRESSION_VISIBLE_PROFILES[EXPRESSION_VISIBLE_PROFILE_REF]
  return EXPRESSION_VISIBLE_PROFILES[profileRef] ?? null
}

function hasExpressionVisibleTrackMask(
  trackMask?: Record<string, unknown>
): boolean {
  if (!trackMask) return false
  if (
    safeString(trackMask.scope).toLowerCase() !== EXPRESSION_VISIBLE_TRACK_SCOPE
  ) {
    return false
  }
  const channels = trackMask.channels
  if (Array.isArray(channels)) {
    return (
      channels.length > 0 &&
      channels.every(
        (channel) =>
          safeString(channel).toLowerCase() === EXPRESSION_VISIBLE_TRACK_CHANNEL
      )
    )
  }
  return (
    safeString(trackMask.channel).toLowerCase() ===
    EXPRESSION_VISIBLE_TRACK_CHANNEL
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function safeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function optionalSafeString(value: unknown): string | undefined {
  const text =
    typeof value === 'number' && Number.isFinite(value)
      ? String(value)
      : safeString(value)
  return text && isSafeIdentifier(text) ? text : undefined
}

function optionalSafeCorrelationId(value: unknown): string | undefined {
  const text = optionalSafeString(value)
  if (!text || UNSAFE_CORRELATION_ID_PATTERN.test(text)) return undefined
  return text
}

function isSafeIdentifier(value: string): boolean {
  return /^[a-zA-Z0-9._:-]{1,128}$/.test(value)
}

function findUnsafeField(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(findUnsafeField)
  if (typeof value === 'string') return UNSAFE_STRING_PATTERN.test(value)
  if (!isRecord(value)) return false
  for (const [key, nestedValue] of Object.entries(value)) {
    const normalizedKey = key.toLowerCase()
    if (
      HOME_CONTROL_MARKER_NAMES.has(normalizedKey) &&
      nestedValue !== false &&
      nestedValue !== null &&
      nestedValue !== undefined
    ) {
      return true
    }
    if (
      UNSAFE_FIELD_NAMES.has(normalizedKey) ||
      SENSITIVE_FIELD_PATTERN.test(key)
    ) {
      return true
    }
    if (findUnsafeField(nestedValue)) return true
  }
  return false
}
