import { render, waitFor } from '@testing-library/react'
import { ProjectionVisualHud } from '@/components/projectionVisualHud'

const FIXED_DETAIL = 'Camera room-light observation unavailable'
const RAW_MARKER = 'RAW_HUD_ROOM_LIGHT_MARKER_MUST_NOT_ECHO'
const originalFetch = globalThis.fetch

const canonicalObservation = (overrides: Record<string, unknown> = {}) => ({
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

const statusWithRoomLight = (roomLight: unknown) => ({
  timestamp: '2026-07-10T10:00:00.000Z',
  environment: { vision: { room_light: roomLight } },
})

const roomLightCard = () =>
  document.querySelector<HTMLElement>(
    '.td-env-value-card[data-update-signal="environment.vision.room_light"]'
  )

describe('ProjectionVisualHud room-light behavior', () => {
  beforeEach(() => {
    window.localStorage.clear()
    globalThis.fetch = jest.fn().mockResolvedValue({
      json: async () => ({}),
    } as Response)
  })

  afterEach(() => {
    jest.restoreAllMocks()
    if (originalFetch) globalThis.fetch = originalFetch
    else delete (globalThis as { fetch?: typeof fetch }).fetch
  })

  const renderStatus = async (status: unknown) => {
    ;(globalThis.fetch as jest.Mock).mockResolvedValue({
      json: async () => status,
    } as Response)
    const view = render(<ProjectionVisualHud variant="passive" />)
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled())
    return view
  }

  it('omits room_light when the actual helper returns undefined', async () => {
    await renderStatus(
      statusWithRoomLight({
        freshness: { level: 'recent' },
        sequence: {
          frame_count: 1,
          first_frame_id: 1,
          last_frame_id: 1,
          temporal_window_ms: 0,
        },
        model: { name: 'unrelated-model', kind: 'heuristic' },
        source_snapshot_id: 'unrelated-snapshot',
      })
    )
    await waitFor(() => expect(roomLightCard()).toBeNull())
  })

  it('renders the canonical camera estimate card', async () => {
    await renderStatus(statusWithRoomLight(canonicalObservation()))
    await waitFor(() => expect(roomLightCard()).not.toBeNull())
    const card = roomLightCard() as HTMLElement
    expect(card).toHaveAttribute('data-state', 'OK')
    expect(card).toHaveAttribute(
      'data-update-signal',
      'environment.vision.room_light'
    )
    expect(card).toHaveAttribute('data-update-kind', 'fresh')
    expect(card).toHaveTextContent('Balanced')
    expect(card).toHaveTextContent('confidence 83%')
    expect(card).toHaveTextContent('daylight ambiguity MEDIUM')
  })

  it('renders room-light-like invalid input as fixed degraded without raw markers', async () => {
    await renderStatus(
      statusWithRoomLight(
        canonicalObservation({
          does_not_prove: [
            'home_assistant_light_state',
            'physical_room_light_state',
          ],
          detail: RAW_MARKER,
          unknown_test_field: RAW_MARKER,
        })
      )
    )
    await waitFor(() => expect(roomLightCard()).not.toBeNull())
    const card = roomLightCard() as HTMLElement
    expect(card).toHaveAttribute('data-state', 'DEGRADED')
    expect(card).toHaveAttribute('data-update-kind', 'stale')
    expect(card).toHaveTextContent('Unknown')
    expect(card).toHaveTextContent(FIXED_DETAIL)
    expect(card).not.toHaveTextContent(RAW_MARKER)
    expect(card.outerHTML).not.toContain(RAW_MARKER)
  })
})
