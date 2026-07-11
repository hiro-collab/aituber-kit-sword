import fs from 'fs'
import os from 'os'
import path from 'path'
import { resolveProjectionVisualRoomLightSafeView } from '@/utils/projectionVisualRoomLight'

const FIXTURE_FILE = 'room-light-shared-vectors.v1.json'
const FIXTURE_VERSION = 'room-light-shared-vectors.v1'
const FIXTURE_KIND = 'non_schema_test_vectors'
const FIXTURE_SENTINEL = 'fixed-unknown-room-light-sentinel-7e57'
const EXPECTED_CASE_IDS = [
  'canonical_camera_hub',
  'canonical_vision_snapshot_processor',
  'malformed_nested_sequence',
  'wrong_numeric_type',
  'nonfinite_numeric',
  'out_of_range_numeric',
  'wrong_case',
  'stale_freshness',
  'reversed_ordered_nonclaims',
  'non_room_light',
  'unknown_field_non_echo',
  'wrong_proof_ceiling',
  'responsiveness_same_identity_material_movement',
  'responsiveness_changed_identity_no_material_movement',
  'responsiveness_changed_identity_material_movement',
] as const
const FIXED_DETAIL = 'Camera room-light observation unavailable'
const RAW_MARKER = 'RAW_ROOM_LIGHT_MARKER_MUST_NOT_ECHO'
const FIXTURE_UNAVAILABLE = 'room_light_fixture_unavailable'
const FIXTURE_INVALID = 'room_light_fixture_invalid'
const MAX_FIXTURE_BYTES = 128 * 1024

type JsonRecord = Record<string, unknown>
type SharedCase = {
  case_id: string
  baseline: JsonRecord
  followup: JsonRecord
  expected: JsonRecord
  synthetic_numeric_class?: string
}
type SharedFixture = {
  unknown_field_sentinel: string
  cases: SharedCase[]
}

const isRecord = (value: unknown): value is JsonRecord =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const hasExactKeys = (
  value: JsonRecord,
  allowed: readonly string[]
): boolean => {
  const actual = Object.keys(value).sort()
  return (
    actual.length === allowed.length &&
    actual.every((key, index) => key === [...allowed].sort()[index])
  )
}

const isBoundedJson = (value: unknown, depth = 0): boolean => {
  if (depth > 6) return false
  if (typeof value === 'string')
    return value.length <= 256 && /^[\x20-\x7e]*$/.test(value)
  if (typeof value === 'number')
    return Number.isFinite(value) && Math.abs(value) <= 1_000_000
  if (typeof value === 'boolean' || value === null) return true
  if (Array.isArray(value))
    return (
      value.length <= 20 &&
      value.every((item) => isBoundedJson(item, depth + 1))
    )
  return (
    isRecord(value) &&
    Object.keys(value).length <= 24 &&
    Object.values(value).every((item) => isBoundedJson(item, depth + 1))
  )
}

const observationKeys = [
  'confidence',
  'cue_likelihoods',
  'daylight_ambiguity',
  'does_not_prove',
  'freshness',
  'model',
  'observation_bucket',
  'observation_id',
  'observed_at',
  'proof_ceiling',
  'schema_version',
  'sequence',
  'source',
  'source_class',
  'source_snapshot_id',
  'type',
] as const

const hasAllowedObservationShape = (
  value: unknown,
  allowSentinel: boolean
): value is JsonRecord => {
  if (!isRecord(value)) return false
  const allowed = allowSentinel
    ? [...observationKeys, 'unknown_test_field']
    : observationKeys
  return (
    hasExactKeys(value, allowed) &&
    isRecord(value.cue_likelihoods) &&
    hasExactKeys(value.cue_likelihoods, [
      'darkness',
      'daylight',
      'warm_light',
    ]) &&
    isRecord(value.sequence) &&
    hasExactKeys(value.sequence, [
      'first_frame_id',
      'frame_count',
      'last_frame_id',
      'temporal_window_ms',
    ]) &&
    isRecord(value.model) &&
    hasExactKeys(value.model, ['kind', 'name']) &&
    isRecord(value.freshness) &&
    hasExactKeys(value.freshness, ['level']) &&
    Array.isArray(value.does_not_prove) &&
    value.does_not_prove.length === 2
  )
}

const hasExactNonclaims = (value: JsonRecord, reversed = false): boolean => {
  const expected = reversed
    ? ['home_assistant_light_state', 'physical_room_light_state']
    : ['physical_room_light_state', 'home_assistant_light_state']
  const actual = value.does_not_prove
  return (
    Array.isArray(actual) &&
    actual.length === expected.length &&
    expected.every((item, index) => actual[index] === item)
  )
}

const readConfiguredFixture = (): SharedFixture | null => {
  const fixturePath = process.env.SWORD_T1_ROOM_LIGHT_SHARED_VECTOR_PATH
  if (!fixturePath) return null
  if (
    !path.isAbsolute(fixturePath) ||
    path.basename(fixturePath) !== FIXTURE_FILE
  ) {
    throw new Error(FIXTURE_INVALID)
  }

  let stat: fs.Stats
  try {
    stat = fs.statSync(fixturePath)
  } catch {
    throw new Error(FIXTURE_UNAVAILABLE)
  }
  if (!stat.isFile() || stat.size < 1 || stat.size > MAX_FIXTURE_BYTES) {
    throw new Error(FIXTURE_INVALID)
  }

  let rawFixture: string
  try {
    rawFixture = fs.readFileSync(fixturePath, 'utf8')
  } catch {
    throw new Error(FIXTURE_UNAVAILABLE)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(rawFixture)
  } catch {
    throw new Error(FIXTURE_INVALID)
  }
  if (!isRecord(parsed) || !isBoundedJson(parsed)) {
    throw new Error(FIXTURE_INVALID)
  }
  if (
    !hasExactKeys(parsed, [
      'cases',
      'fixture_kind',
      'fixture_version',
      'unknown_field_sentinel',
    ]) ||
    parsed.fixture_version !== FIXTURE_VERSION ||
    parsed.fixture_kind !== FIXTURE_KIND ||
    parsed.unknown_field_sentinel !== FIXTURE_SENTINEL ||
    !Array.isArray(parsed.cases) ||
    parsed.cases.length !== EXPECTED_CASE_IDS.length
  ) {
    throw new Error(FIXTURE_INVALID)
  }

  const cases = parsed.cases as unknown[]
  cases.forEach((candidate, index) => {
    if (!isRecord(candidate)) throw new Error(FIXTURE_INVALID)
    const expectedKeys =
      candidate.case_id === 'nonfinite_numeric'
        ? [
            'baseline',
            'case_id',
            'expected',
            'followup',
            'synthetic_numeric_class',
          ]
        : ['baseline', 'case_id', 'expected', 'followup']
    const allowSentinel = candidate.case_id === 'unknown_field_non_echo'
    if (
      !hasExactKeys(candidate, expectedKeys) ||
      candidate.case_id !== EXPECTED_CASE_IDS[index] ||
      !hasAllowedObservationShape(candidate.baseline, false) ||
      !hasAllowedObservationShape(candidate.followup, allowSentinel) ||
      !hasExactNonclaims(candidate.baseline) ||
      !hasExactNonclaims(
        candidate.followup,
        candidate.case_id === 'reversed_ordered_nonclaims'
      ) ||
      !isRecord(candidate.expected) ||
      !hasExactKeys(candidate.expected, [
        'claim_class',
        'delta_class',
        'responsiveness_class',
        'unknown_echo_class',
        'validation_class',
      ]) ||
      candidate.expected.unknown_echo_class !== 'not_echoed'
    ) {
      throw new Error(FIXTURE_INVALID)
    }
  })

  return parsed as unknown as SharedFixture
}

const configuredFixture = readConfiguredFixture()

const canonicalObservation = (overrides: JsonRecord = {}): JsonRecord => ({
  type: 'room_light_observation',
  schema_version: 1,
  observation_bucket: 'balanced',
  confidence: 0.83,
  daylight_ambiguity: 'medium',
  cue_likelihoods: { warm_light: 0.42, daylight: 0.71, darkness: 0.08 },
  source: 'vision_snapshot_processor',
  source_class: 'camera_environment_estimate',
  observed_at: '2026-07-10T10:00:00.000Z',
  observation_id: 'room-light-observation-1',
  source_snapshot_id: 'room-light-snapshot-1',
  sequence: {
    frame_count: 2,
    first_frame_id: 10,
    last_frame_id: 11,
    temporal_window_ms: 500,
  },
  model: { name: 'room-light-heuristic-snapshot-v3', kind: 'heuristic' },
  freshness: { level: 'fresh' },
  proof_ceiling: 'camera_environment_estimate_only',
  does_not_prove: ['physical_room_light_state', 'home_assistant_light_state'],
  ...overrides,
})

const expectFixedDegraded = (signal: unknown, markers: string[] = []) => {
  const safeView = resolveProjectionVisualRoomLightSafeView(signal)
  expect(safeView).toEqual({
    kind: 'stale',
    state: 'DEGRADED',
    value: 'Unknown',
    detail: FIXED_DETAIL,
    token: 'environment.vision.room_light:degraded',
  })
  const serialized = JSON.stringify(safeView)
  ;[RAW_MARKER, ...markers].forEach((marker) =>
    expect(serialized).not.toContain(marker)
  )
}

const captureFixtureErrorText = (load: () => unknown): string => {
  try {
    load()
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
  throw new Error('expected fixture loader failure')
}

const expectFixedFixtureError = (
  expected: typeof FIXTURE_UNAVAILABLE | typeof FIXTURE_INVALID,
  markers: readonly string[]
) => {
  const serialized = captureFixtureErrorText(readConfiguredFixture)
  expect(serialized).toBe(expected)
  markers.forEach((marker) => expect(serialized).not.toContain(marker))
}

describe('resolveProjectionVisualRoomLightSafeView', () => {
  it('uses fixed non-echo errors for bounded configured-fixture failures', () => {
    const envName = 'SWORD_T1_ROOM_LIGHT_SHARED_VECTOR_PATH'
    const originalFixturePath = process.env[envName]
    const tempDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'room-light-loader-negative-')
    )
    const fixturePath = path.join(tempDir, FIXTURE_FILE)
    const unsafeBasename = `unsafe-${FIXTURE_SENTINEL}.json`
    const unsafePath = path.join(tempDir, unsafeBasename)
    const injectedCase = 'injected_case_id_must_not_echo'
    const injectedField = 'injected_field_name_must_not_echo'
    const injectedValue = 'injected_field_value_must_not_echo'
    const osDetail = 'EACCES_OS_DETAIL_MUST_NOT_ECHO'
    const commonMarkers = [
      tempDir,
      FIXTURE_FILE,
      String(MAX_FIXTURE_BYTES + 1),
      injectedCase,
      injectedField,
      injectedValue,
      FIXTURE_SENTINEL,
      osDetail,
    ]

    try {
      process.env[envName] = fixturePath
      expectFixedFixtureError(FIXTURE_UNAVAILABLE, commonMarkers)

      fs.writeFileSync(fixturePath, '{}', 'utf8')
      const readSpy = jest
        .spyOn(fs, 'readFileSync')
        .mockImplementationOnce(() => {
          throw new Error(osDetail)
        })
      try {
        expectFixedFixtureError(FIXTURE_UNAVAILABLE, commonMarkers)
      } finally {
        readSpy.mockRestore()
      }

      fs.writeFileSync(
        fixturePath,
        `{"case_id":"${injectedCase}","${injectedField}":"${injectedValue}",`,
        'utf8'
      )
      expectFixedFixtureError(FIXTURE_INVALID, commonMarkers)

      fs.writeFileSync(fixturePath, 'x'.repeat(MAX_FIXTURE_BYTES + 1), 'utf8')
      expectFixedFixtureError(FIXTURE_INVALID, commonMarkers)

      fs.writeFileSync(unsafePath, '{}', 'utf8')
      process.env[envName] = unsafePath
      expectFixedFixtureError(FIXTURE_INVALID, [
        ...commonMarkers,
        unsafePath,
        unsafeBasename,
      ])

      process.env[envName] = fixturePath
      fs.writeFileSync(
        fixturePath,
        JSON.stringify({
          fixture_version: FIXTURE_VERSION,
          fixture_kind: FIXTURE_KIND,
          unknown_field_sentinel: FIXTURE_SENTINEL,
          cases: [{ case_id: injectedCase, [injectedField]: injectedValue }],
        }),
        'utf8'
      )
      expectFixedFixtureError(FIXTURE_INVALID, commonMarkers)
    } finally {
      if (originalFixturePath === undefined) delete process.env[envName]
      else process.env[envName] = originalFixturePath
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it('returns canonical fresh and updated safe views from actual observations', () => {
    expect(
      resolveProjectionVisualRoomLightSafeView(canonicalObservation())
    ).toMatchObject({
      kind: 'fresh',
      state: 'OK',
      value: 'Balanced',
      observedAt: '2026-07-10T10:00:00.000Z',
      snapshotId: 'room-light-snapshot-1',
    })
    expect(
      resolveProjectionVisualRoomLightSafeView(
        canonicalObservation({ updated_at: '2026-07-10T10:00:01.000Z' })
      )
    ).toMatchObject({
      kind: 'updated',
      state: 'OK',
      value: 'Balanced',
    })
  })

  it.each([
    ['explicit stale', { stale: true }],
    ['unavailable', { available: false }],
    ['stale freshness', { freshness: { level: 'stale' } }],
  ])('maps %s to the fixed stale degraded view', (_label, override) => {
    expectFixedDegraded(
      canonicalObservation({ ...override, raw_private_field: RAW_MARKER })
    )
  })

  it.each([
    [
      'reversed nonclaims',
      {
        does_not_prove: [
          'home_assistant_light_state',
          'physical_room_light_state',
        ],
      },
    ],
    ['wrong model', { model: { name: 'other-model', kind: 'heuristic' } }],
    ['wrong source', { source: 'untrusted_camera' }],
    ['wrong type', { type: 'ambient_environment_observation' }],
    ['wrong case', { observation_bucket: 'DARK' }],
    ['wrong numeric', { confidence: '0.83' }],
    ['out-of-range numeric', { confidence: 1.1 }],
    [
      'wrong cues',
      {
        cue_likelihoods: { warm_light: 0.42, daylight: 0.71, darkness: '0.08' },
      },
    ],
    [
      'wrong sequence',
      {
        sequence: {
          frame_count: '2',
          first_frame_id: 10,
          last_frame_id: 11,
          temporal_window_ms: 500,
        },
      },
    ],
    ['wrong timestamp', { observed_at: 'not-a-timestamp' }],
    ['wrong freshness', { freshness: { level: 'unknown' } }],
  ])('fails %s to a constant non-echoing degraded view', (_label, override) => {
    expectFixedDegraded(
      canonicalObservation({ ...override, raw_private_field: RAW_MARKER })
    )
  })

  it.each([
    { freshness: { level: 'recent' } },
    {
      sequence: {
        frame_count: 1,
        first_frame_id: 1,
        last_frame_id: 1,
        temporal_window_ms: 0,
      },
    },
    { model: { name: 'unrelated-model', kind: 'heuristic' } },
    { source_snapshot_id: 'unrelated-snapshot' },
    {
      freshness: { level: 'recent' },
      sequence: {
        frame_count: 1,
        first_frame_id: 1,
        last_frame_id: 1,
        temporal_window_ms: 0,
      },
      model: { name: 'unrelated-model', kind: 'heuristic' },
      source_snapshot_id: 'unrelated-snapshot',
    },
  ])('ignores unrelated generic-field record %#', (signal) => {
    expect(resolveProjectionVisualRoomLightSafeView(signal)).toBeUndefined()
  })

  const fixtureIt = configuredFixture ? it : it.skip
  fixtureIt(
    'loads and enforces the configured ordered 15-case Parent fixture',
    () => {
      expect(configuredFixture).not.toBeNull()
      const fixture = configuredFixture as SharedFixture
      expect(fixture.cases.map((item) => item.case_id)).toEqual(
        EXPECTED_CASE_IDS
      )

      fixture.cases.forEach((fixtureCase) => {
        const followup = JSON.parse(
          JSON.stringify(fixtureCase.followup)
        ) as JsonRecord
        if (fixtureCase.synthetic_numeric_class === 'followup_confidence_nan')
          followup.confidence = Number.NaN
        const safeView = resolveProjectionVisualRoomLightSafeView(followup)
        const unavailable = fixtureCase.expected.claim_class === 'unavailable'
        if (unavailable) {
          expectFixedDegraded(followup, [fixture.unknown_field_sentinel])
        } else {
          expect(safeView).toMatchObject({ state: 'OK' })
          expect(JSON.stringify(safeView)).not.toContain(
            fixture.unknown_field_sentinel
          )
        }
      })
    }
  )
})
