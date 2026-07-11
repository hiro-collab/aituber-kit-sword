import { act, render, waitFor } from '@testing-library/react'
import { readFileSync, statSync } from 'node:fs'
import { extname, resolve } from 'node:path'

import {
  MOTION_STIMULUS_RECEIVER_EVENT,
  MOTION_STIMULUS_RECEIVER_RESULT_EVENT,
  type MotionStimulusReceiverResult,
} from '../motionStimulusReceiver'
import { PROJECTION_VISUAL_CONTROLLED_CHROME_OBSERVATION_JSON_SCRIPT_ID } from '../projectionVisualControlledChromeObservation'
import { ProjectionVisualStimulusRefBridge } from '../projectionVisualStimulusRefBridge'
import {
  MotionRuntimeSession,
  type MotionRuntimeLifecycleAcceptanceCandidate,
} from '../motionRuntimeSession'

const DANCE_LIFECYCLE_VECTOR_ENV = 'SWORD_M4_DANCE_LIFECYCLE_VECTOR_PATH'
const danceLifecycleFixtureIt = process.env[DANCE_LIFECYCLE_VECTOR_ENV]
  ? it
  : it.skip

describe('ProjectionVisualStimulusRefBridge DOM runtime summary', () => {
  beforeEach(() => {
    document.body.innerHTML = [
      '<div',
      ' class="projection-visual"',
      ' data-projection-visual-mode="passive"',
      ' data-projection-visual-test-mode="self-mirror-baseline"',
      ' data-projection-visual-stimulus-ref="voice.dance_please"',
      '></div>',
    ].join('')
    ;(window as any).__projectionVisualMotionRuntimeDebugSnapshot = {
      vrmReady: true,
      sceneVisible: true,
      session: {
        instances: [
          {
            groupKey: 'dance.sequence',
            phase: 'active',
          },
        ],
      },
      poseFrame: {
        humanoidRotationBoneNames: ['hips'],
        humanoidTranslationBoneNames: [],
      },
    }
    ;(window as any).__projectionVisualInPageDiagnosticsV0 = {
      schema_version: 'projection_visual_in_page_diagnostics.v0',
      frame_seq: 12,
      frame_timestamp_mono_ms: 450.5,
      driver_frame_anchor: {
        frame_seq: 12,
        frame_timestamp_mono_ms: 450.5,
        reason_code: 'motion_pose_frame_observed',
        safe_visible_state: 'motion_started',
      },
      expression_value_summary: {
        expression_weight_applied: false,
        channel_names: [],
        frame_applied_count: 0,
      },
    }
  })

  afterEach(() => {
    delete (window as any).__projectionVisualMotionRuntimeDebugSnapshot
    delete (window as any).__projectionVisualInPageDiagnosticsV0
    delete (window as any).__projectionVisualStimulusDispatchAdapterV0
  })

  it('mirrors accepted runtime result refs to controlled-Chrome-readable root data attributes', async () => {
    const root = document.querySelector<HTMLElement>(
      '[data-projection-visual-mode]'
    ) as HTMLElement
    const receivedStimuli: Array<Record<string, unknown>> = []
    const receiver = (event: Event) => {
      const stimulus =
        event instanceof CustomEvent
          ? (event.detail as Record<string, unknown>)
          : {}
      receivedStimuli.push(stimulus)
      const result: MotionStimulusReceiverResult = {
        source_kind: 'thought_core_motion_stimulus_v0',
        debug_playback: false,
        accepted: true,
        status: 'started',
        reason_code: 'motion_runtime_vrma_started',
        safe_visible_state: 'motion_started',
        motion_event_id: stimulus.motion_event_id as string,
        stimulus_id: stimulus.stimulus_id as string,
        stimulus_instance_id: stimulus.stimulus_instance_id as string,
        runtime_result_id: 'mot_res_controlled_chrome_dance_actual_1',
        lifecycle_trace: [],
      }
      setTimeout(() => {
        window.dispatchEvent(
          new CustomEvent(MOTION_STIMULUS_RECEIVER_RESULT_EVENT, {
            detail: result,
          })
        )
      }, 0)
    }
    window.addEventListener(MOTION_STIMULUS_RECEIVER_EVENT, receiver)

    render(
      <ProjectionVisualStimulusRefBridge
        enabled
        stimulusRef="voice.dance_please"
        acceptDanceLifecycleCandidate={() => true}
      />
    )

    await waitFor(() => {
      expect(root).toHaveAttribute(
        'data-projection-visual-runtime-summary-result-status',
        'started'
      )
    })
    expect(receivedStimuli).toHaveLength(1)
    expect(root).toHaveAttribute(
      'data-projection-visual-runtime-summary-v0',
      'projection_visual_runtime_result_dom_summary.v0'
    )
    expect(root).toHaveAttribute(
      'data-projection-visual-runtime-summary-stimulus-ref',
      'voice.dance_please'
    )
    expect(root).toHaveAttribute(
      'data-projection-visual-runtime-summary-adapter-status',
      'dispatched'
    )
    expect(root).toHaveAttribute(
      'data-projection-visual-runtime-summary-adapter-reason-code',
      'motion_stimulus_result_observed'
    )
    expect(root).toHaveAttribute(
      'data-projection-visual-runtime-summary-runtime-result-id',
      'mot_res_controlled_chrome_dance_actual_1'
    )
    expect(root).toHaveAttribute(
      'data-projection-visual-runtime-summary-result-accepted',
      'true'
    )
    expect(root).toHaveAttribute(
      'data-projection-visual-runtime-summary-safe-visible-state',
      'motion_started'
    )
    expect(root).toHaveAttribute(
      'data-projection-visual-runtime-summary-raw-media-published',
      'false'
    )
    expect(root).toHaveAttribute(
      'data-projection-visual-runtime-summary-provider-payload-published',
      'false'
    )
    const adapterState = (window as any)
      .__projectionVisualStimulusDispatchAdapterV0
    expect(adapterState.dispatch_timeline).toEqual(
      expect.objectContaining({
        capture_started_at_ms: 0,
        motion_requested_at_ms: 300,
        stimulus_dispatched_at_ms: expect.any(Number),
        result_event_observed_at_ms: expect.any(Number),
      })
    )
    const script = document.getElementById(
      PROJECTION_VISUAL_CONTROLLED_CHROME_OBSERVATION_JSON_SCRIPT_ID
    ) as HTMLScriptElement
    const observationSummary = JSON.parse(script.textContent ?? '{}')
    expect(observationSummary.event_timeline).toEqual(
      expect.objectContaining({
        result_event_observed_at_ms: expect.any(Number),
        runtime_started_at_ms: expect.any(Number),
      })
    )
    expect(observationSummary.frame_applied_anchor).toEqual(
      expect.objectContaining({
        source: 'projection_visual_in_page_diagnostics.v0',
        dance_active_instance_count: 1,
        pose_frame_observed: true,
      })
    )
    expect(observationSummary.canvas_readback_summary).toEqual(
      expect.objectContaining({
        readback_status: 'unavailable',
      })
    )
    expect(JSON.stringify(observationSummary)).not.toContain(
      'provider_payload_raw'
    )
    expect(JSON.stringify(observationSummary)).not.toContain('entity_id')

    window.removeEventListener(MOTION_STIMULUS_RECEIVER_EVENT, receiver)
  })

  it('publishes waiting state to DOM while VRM runtime readiness is still false', async () => {
    ;(window as any).__projectionVisualMotionRuntimeDebugSnapshot = {
      vrmReady: false,
      sceneVisible: true,
    }
    const root = document.querySelector<HTMLElement>(
      '[data-projection-visual-mode]'
    ) as HTMLElement

    render(
      <ProjectionVisualStimulusRefBridge
        enabled
        stimulusRef="voice.smile_please"
        acceptDanceLifecycleCandidate={() => true}
      />
    )

    await waitFor(() => {
      expect(root).toHaveAttribute(
        'data-projection-visual-runtime-summary-adapter-status',
        'waiting_for_vrm'
      )
    })
    expect(root).toHaveAttribute(
      'data-projection-visual-runtime-summary-stimulus-ref',
      'voice.smile_please'
    )
    expect(root).toHaveAttribute(
      'data-projection-visual-runtime-summary-adapter-reason-code',
      'waiting_for_vrm_runtime_ready'
    )
    expect(root).not.toHaveAttribute(
      'data-projection-visual-runtime-summary-result-accepted'
    )
  })

  it('fails closed without a session predicate and does not dispatch or publish observation state', async () => {
    const root = document.querySelector<HTMLElement>(
      '[data-projection-visual-mode]'
    ) as HTMLElement
    const receiver = jest.fn()
    window.addEventListener(MOTION_STIMULUS_RECEIVER_EVENT, receiver)

    render(
      <ProjectionVisualStimulusRefBridge
        enabled
        stimulusRef="voice.dance_please"
      />
    )
    await Promise.resolve()

    expect(receiver).not.toHaveBeenCalled()
    expect(root).not.toHaveAttribute(
      'data-projection-visual-runtime-summary-result-status'
    )
    window.removeEventListener(MOTION_STIMULUS_RECEIVER_EVENT, receiver)
  })

  it('rejects post-stop runtime results and frames without observation mutation', async () => {
    const root = document.querySelector<HTMLElement>(
      '[data-projection-visual-mode]'
    ) as HTMLElement
    const acceptDanceLifecycleCandidate = jest.fn(() => false)
    const receiver = () => {
      window.dispatchEvent(
        new CustomEvent(MOTION_STIMULUS_RECEIVER_RESULT_EVENT, {
          detail: createDanceResult(),
        })
      )
    }
    window.addEventListener(MOTION_STIMULUS_RECEIVER_EVENT, receiver)

    render(
      <ProjectionVisualStimulusRefBridge
        enabled
        stimulusRef="voice.dance_please"
        acceptDanceLifecycleCandidate={acceptDanceLifecycleCandidate}
      />
    )
    await waitFor(() =>
      expect(acceptDanceLifecycleCandidate).toHaveBeenCalled()
    )

    expect(root).not.toHaveAttribute(
      'data-projection-visual-runtime-summary-result-status'
    )
    const summary = JSON.parse(
      document.getElementById(
        PROJECTION_VISUAL_CONTROLLED_CHROME_OBSERVATION_JSON_SCRIPT_ID
      )?.textContent ?? '{}'
    )
    expect(summary.event_timeline).not.toHaveProperty(
      'result_event_observed_at_ms'
    )
    window.removeEventListener(MOTION_STIMULUS_RECEIVER_EVENT, receiver)
  })

  danceLifecycleFixtureIt(
    'executes the configured M4 dance lifecycle fixture through the session and bridge',
    async () => {
      const originalFixturePath = process.env[DANCE_LIFECYCLE_VECTOR_ENV]
      let activeBridgeUnmount: (() => void) | undefined
      let stoppedBridgeUnmount: (() => void) | undefined
      let activeReceiver: (() => void) | undefined
      let stoppedReceiver: (() => void) | undefined

      jest.useFakeTimers()
      try {
        const fixture = loadDanceLifecycleFixture()
        const byCaseId = new Map(
          fixture.cases.map((fixtureCase) => [fixtureCase.case_id, fixtureCase])
        )
        const queued = fixtureCase(byCaseId, 'dance_start_queued')
        const active = fixtureCase(byCaseId, 'dance_active_accept')
        const stopBeforeStart = fixtureCase(byCaseId, 'dance_stop_before_start')
        const stopRepeated = fixtureCase(byCaseId, 'dance_stop_repeated')
        const stopActive = fixtureCase(byCaseId, 'dance_stop_active')
        const lateResult = fixtureCase(byCaseId, 'dance_late_result_after_stop')
        const lateFrame = fixtureCase(byCaseId, 'dance_late_frame_after_stop')
        const stale = fixtureCase(byCaseId, 'dance_stale_result')
        const settled = fixtureCase(byCaseId, 'dance_settled_idle')

        const session = new MotionRuntimeSession({
          config: { maxActiveSlots: 1, defaultReleaseDurationMs: 1 },
        })
        const queuedRequest = session.request(
          createFixtureDanceRequest(queued, 'stimulus-alpha', 'result-alpha')
        )
        expect(queued.expected_receiver_result_class).toBe('accepted_queued')
        expect(queuedRequest.queuedInstanceIds).toEqual([
          queuedRequest.instanceId,
        ])
        expect(
          session
            .snapshot()
            .instances.find(
              (instance) => instance.instanceId === queuedRequest.instanceId
            )?.phase
        ).toBe(queued.expected_state)
        session.tick(queued.sequence_number)
        session.tick(queued.sequence_number + 1)

        expect(active.expected_receiver_result_class).toBe('accepted_active')
        expect(
          session.assessDanceLifecycleCandidate(
            fixtureCandidate(active, 'stimulus-alpha', 'result-alpha')
          )
        ).toBe('accepted_active')

        const acceptDanceLifecycleCandidate = jest.fn((candidate) =>
          session.acceptDanceLifecycleCandidate(candidate)
        )
        const activeResultReceiver = () => {
          window.dispatchEvent(
            new CustomEvent(MOTION_STIMULUS_RECEIVER_RESULT_EVENT, {
              detail: createDanceResult(),
            })
          )
        }
        window.addEventListener(
          MOTION_STIMULUS_RECEIVER_EVENT,
          activeResultReceiver
        )
        activeReceiver = () =>
          window.removeEventListener(
            MOTION_STIMULUS_RECEIVER_EVENT,
            activeResultReceiver
          )
        activeBridgeUnmount = render(
          <ProjectionVisualStimulusRefBridge
            enabled
            stimulusRef="voice.dance_please"
            acceptDanceLifecycleCandidate={acceptDanceLifecycleCandidate}
          />
        ).unmount
        await act(async () => {
          jest.advanceTimersByTime(300)
        })
        expect(acceptDanceLifecycleCandidate).toHaveBeenCalledWith(
          expect.objectContaining({
            eventKind: 'runtime_result',
            candidateState: active.candidate_state,
          })
        )

        expect(stopActive.expected_receiver_result_class).toBe(
          'accepted_stop_to_idle'
        )
        expect(
          session.releaseGroup('dance.sequence', stopActive.sequence_number)
        ).toEqual([queuedRequest.instanceId])
        expect(session.snapshot().instances[0]).toEqual(
          expect.objectContaining({ phase: 'releasing' })
        )
        session.admitDanceStop('stimulus-stop-alpha', 'result-stop-alpha')
        expect(
          session.assessDanceLifecycleCandidate(
            fixtureCandidate(
              stopActive,
              'stimulus-stop-alpha',
              'result-stop-alpha'
            )
          )
        ).toBe('accepted_idle')

        expect(lateResult.expected_receiver_result_class).toBe(
          'rejected_late_after_stop'
        )
        expect(
          session.assessDanceLifecycleCandidate(
            fixtureCandidate(
              lateResult,
              'stimulus-stop-alpha',
              'result-stop-alpha'
            )
          )
        ).toBe('rejected_late_after_stop')

        const frameRoot = document.querySelector<HTMLElement>(
          '[data-projection-visual-mode]'
        ) as HTMLElement
        const frameScript = document.getElementById(
          PROJECTION_VISUAL_CONTROLLED_CHROME_OBSERVATION_JSON_SCRIPT_ID
        )
        const frameDomBefore = frameRoot.outerHTML
        const frameScriptBefore = frameScript?.textContent
        await act(async () => {
          jest.advanceTimersByTime(250)
        })
        expect(lateFrame.expected_receiver_result_class).toBe(
          'rejected_late_after_stop'
        )
        expect(
          session.assessDanceLifecycleCandidate(
            fixtureCandidate(
              lateFrame,
              'stimulus-stop-alpha',
              'result-stop-alpha'
            )
          )
        ).toBe('rejected_late_after_stop')
        expect(acceptDanceLifecycleCandidate).toHaveBeenCalledWith(
          expect.objectContaining({
            eventKind: 'frame',
            candidateState: lateFrame.candidate_state,
          })
        )
        expect(frameRoot.outerHTML).toBe(frameDomBefore)
        expect(
          document.getElementById(
            PROJECTION_VISUAL_CONTROLLED_CHROME_OBSERVATION_JSON_SCRIPT_ID
          )?.textContent
        ).toBe(frameScriptBefore)

        activeBridgeUnmount()
        activeBridgeUnmount = undefined
        activeReceiver()
        activeReceiver = undefined

        const stoppedResultReceiver = () => {
          window.setTimeout(() => {
            window.dispatchEvent(
              new CustomEvent(MOTION_STIMULUS_RECEIVER_RESULT_EVENT, {
                detail: createDanceResult(
                  'stimulus-stop-alpha',
                  'result-stop-alpha'
                ),
              })
            )
          }, 10)
        }
        window.addEventListener(
          MOTION_STIMULUS_RECEIVER_EVENT,
          stoppedResultReceiver
        )
        stoppedReceiver = () =>
          window.removeEventListener(
            MOTION_STIMULUS_RECEIVER_EVENT,
            stoppedResultReceiver
          )
        stoppedBridgeUnmount = render(
          <ProjectionVisualStimulusRefBridge
            enabled
            stimulusRef="voice.dance_please"
            acceptDanceLifecycleCandidate={acceptDanceLifecycleCandidate}
          />
        ).unmount
        await act(async () => {
          jest.advanceTimersByTime(300)
        })
        const resultRoot = document.querySelector<HTMLElement>(
          '[data-projection-visual-mode]'
        ) as HTMLElement
        const resultDomBefore = resultRoot.outerHTML
        const resultScriptBefore = document.getElementById(
          PROJECTION_VISUAL_CONTROLLED_CHROME_OBSERVATION_JSON_SCRIPT_ID
        )?.textContent
        await act(async () => {
          jest.advanceTimersByTime(10)
        })
        expect(acceptDanceLifecycleCandidate).toHaveBeenLastCalledWith(
          expect.objectContaining({
            eventKind: 'runtime_result',
            stimulusInstanceId: 'stimulus-stop-alpha',
            runtimeResultId: 'result-stop-alpha',
            candidateState: lateResult.candidate_state,
          })
        )
        expect(acceptDanceLifecycleCandidate.mock.results.at(-1)?.value).toBe(
          false
        )
        expect(resultRoot.outerHTML).toBe(resultDomBefore)
        expect(
          document.getElementById(
            PROJECTION_VISUAL_CONTROLLED_CHROME_OBSERVATION_JSON_SCRIPT_ID
          )?.textContent
        ).toBe(resultScriptBefore)
        expect(resultRoot).not.toHaveAttribute(
          'data-projection-visual-runtime-summary-result-status'
        )

        const idleSession = new MotionRuntimeSession()
        expect(stopBeforeStart.expected_receiver_result_class).toBe(
          'accepted_idempotent_idle'
        )
        idleSession.admitDanceStop('stimulus-beta', 'result-beta')
        expect(
          idleSession.acceptDanceLifecycleCandidate(
            fixtureCandidate(stopBeforeStart, 'stimulus-beta', 'result-beta')
          )
        ).toBe(true)
        expect(idleSession.snapshot().instances).toEqual([])
        expect(stopRepeated.expected_receiver_result_class).toBe(
          'accepted_idempotent_idle'
        )
        idleSession.admitDanceStop('stimulus-beta-repeat', 'result-beta-repeat')
        expect(
          idleSession.acceptDanceLifecycleCandidate(
            fixtureCandidate(
              stopRepeated,
              'stimulus-beta-repeat',
              'result-beta-repeat'
            )
          )
        ).toBe(true)

        const staleSession = new MotionRuntimeSession()
        staleSession.request(
          createFixtureDanceRequest(stale, 'stimulus-gamma', 'result-gamma')
        )
        expect(
          staleSession.acceptDanceLifecycleCandidate(
            fixtureCandidate(stale, 'stimulus-gamma', 'result-gamma', 'active')
          )
        ).toBe(true)
        staleSession.admitDanceStop('stimulus-gamma-stop', 'result-gamma-stop')
        expect(stale.expected_receiver_result_class).toBe('rejected_stale')
        expect(
          staleSession.assessDanceLifecycleCandidate(
            fixtureCandidate(stale, 'stimulus-gamma', 'result-gamma')
          )
        ).toBe('rejected_stale')

        const settledSession = new MotionRuntimeSession()
        settledSession.request(
          createFixtureDanceRequest(settled, 'stimulus-delta', 'result-delta')
        )
        settledSession.admitDanceStop('stimulus-delta', 'result-delta')
        expect(settled.expected_receiver_result_class).toBe(
          'accepted_settled_idle'
        )
        expect(
          settledSession.assessDanceLifecycleCandidate(
            fixtureCandidate(settled, 'stimulus-delta', 'result-delta')
          )
        ).toBe('accepted_idle')

        assertDanceLifecycleFixtureSensitivity(fixture)
      } finally {
        stoppedBridgeUnmount?.()
        activeBridgeUnmount?.()
        stoppedReceiver?.()
        activeReceiver?.()
        jest.useRealTimers()
        if (originalFixturePath === undefined) {
          delete process.env[DANCE_LIFECYCLE_VECTOR_ENV]
        } else {
          process.env[DANCE_LIFECYCLE_VECTOR_ENV] = originalFixturePath
        }
      }
    }
  )
})

function createDanceResult(
  stimulusInstanceId = 'stimulus-alpha',
  runtimeResultId = 'result-alpha'
): MotionStimulusReceiverResult {
  return {
    source_kind: 'thought_core_motion_stimulus_v0',
    debug_playback: false,
    accepted: true,
    status: 'started',
    reason_code: 'motion_runtime_vrma_started',
    safe_visible_state: 'motion_started',
    stimulus_instance_id: stimulusInstanceId,
    runtime_result_id: runtimeResultId,
    lifecycle_trace: [],
  }
}

type DanceLifecycleFixtureCase = {
  case_id: (typeof DANCE_LIFECYCLE_CASE_IDS)[number]
  dance_session_ref: (typeof DANCE_LIFECYCLE_SESSION_REFS)[number]
  sequence_number: number
  prior_state: 'idle' | 'queued' | 'active' | 'stopped'
  candidate_event_kind: 'stimulus' | 'runtime_result' | 'frame'
  request_mode?: 'play' | 'stop'
  lifecycle_state: 'queued' | 'active' | 'stopped' | 'completed'
  candidate_state: 'queued' | 'active' | 'stopped' | 'idle'
  expected_receiver_result_class:
    | 'accepted_queued'
    | 'accepted_active'
    | 'accepted_idempotent_idle'
    | 'accepted_stop_to_idle'
    | 'rejected_late_after_stop'
    | 'rejected_stale'
    | 'accepted_settled_idle'
  expected_state: 'queued' | 'active' | 'idle'
  core_contract_class:
    | 'play_request_accepted'
    | 'runtime_activation_accepted'
    | 'stop_idempotent'
    | 'stop_to_idle'
    | 'late_after_stop_rejected'
    | 'stale_result_rejected'
    | 'settled_idle'
}

type DanceLifecycleFixture = {
  schema_version: 'm4_dance_lifecycle_fault_vectors.v0'
  fixture_kind: 'non_schema_test_vectors'
  fixture_scope: 'parent_dance_lifecycle_fault_vector_harness_only'
  case_order: Array<(typeof DANCE_LIFECYCLE_CASE_IDS)[number]>
  cases: DanceLifecycleFixtureCase[]
}

const DANCE_LIFECYCLE_CASE_IDS = [
  'dance_start_queued',
  'dance_active_accept',
  'dance_stop_before_start',
  'dance_stop_repeated',
  'dance_stop_active',
  'dance_late_result_after_stop',
  'dance_late_frame_after_stop',
  'dance_stale_result',
  'dance_settled_idle',
] as const

const DANCE_LIFECYCLE_SESSION_REFS = [
  'dance_session_m4_vector_alpha',
  'dance_session_m4_vector_beta',
  'dance_session_m4_vector_gamma',
  'dance_session_m4_vector_delta',
] as const

const EXPECTED_DANCE_LIFECYCLE_CASES: readonly DanceLifecycleFixtureCase[] = [
  {
    case_id: 'dance_start_queued',
    dance_session_ref: 'dance_session_m4_vector_alpha',
    sequence_number: 10,
    prior_state: 'idle',
    candidate_event_kind: 'stimulus',
    request_mode: 'play',
    lifecycle_state: 'queued',
    candidate_state: 'queued',
    expected_receiver_result_class: 'accepted_queued',
    expected_state: 'queued',
    core_contract_class: 'play_request_accepted',
  },
  {
    case_id: 'dance_active_accept',
    dance_session_ref: 'dance_session_m4_vector_alpha',
    sequence_number: 20,
    prior_state: 'queued',
    candidate_event_kind: 'runtime_result',
    lifecycle_state: 'active',
    candidate_state: 'active',
    expected_receiver_result_class: 'accepted_active',
    expected_state: 'active',
    core_contract_class: 'runtime_activation_accepted',
  },
  {
    case_id: 'dance_stop_before_start',
    dance_session_ref: 'dance_session_m4_vector_beta',
    sequence_number: 10,
    prior_state: 'idle',
    candidate_event_kind: 'stimulus',
    request_mode: 'stop',
    lifecycle_state: 'stopped',
    candidate_state: 'stopped',
    expected_receiver_result_class: 'accepted_idempotent_idle',
    expected_state: 'idle',
    core_contract_class: 'stop_idempotent',
  },
  {
    case_id: 'dance_stop_repeated',
    dance_session_ref: 'dance_session_m4_vector_beta',
    sequence_number: 20,
    prior_state: 'idle',
    candidate_event_kind: 'stimulus',
    request_mode: 'stop',
    lifecycle_state: 'stopped',
    candidate_state: 'stopped',
    expected_receiver_result_class: 'accepted_idempotent_idle',
    expected_state: 'idle',
    core_contract_class: 'stop_idempotent',
  },
  {
    case_id: 'dance_stop_active',
    dance_session_ref: 'dance_session_m4_vector_alpha',
    sequence_number: 30,
    prior_state: 'active',
    candidate_event_kind: 'stimulus',
    request_mode: 'stop',
    lifecycle_state: 'stopped',
    candidate_state: 'stopped',
    expected_receiver_result_class: 'accepted_stop_to_idle',
    expected_state: 'idle',
    core_contract_class: 'stop_to_idle',
  },
  {
    case_id: 'dance_late_result_after_stop',
    dance_session_ref: 'dance_session_m4_vector_alpha',
    sequence_number: 40,
    prior_state: 'idle',
    candidate_event_kind: 'runtime_result',
    lifecycle_state: 'active',
    candidate_state: 'active',
    expected_receiver_result_class: 'rejected_late_after_stop',
    expected_state: 'idle',
    core_contract_class: 'late_after_stop_rejected',
  },
  {
    case_id: 'dance_late_frame_after_stop',
    dance_session_ref: 'dance_session_m4_vector_alpha',
    sequence_number: 50,
    prior_state: 'idle',
    candidate_event_kind: 'frame',
    lifecycle_state: 'active',
    candidate_state: 'active',
    expected_receiver_result_class: 'rejected_late_after_stop',
    expected_state: 'idle',
    core_contract_class: 'late_after_stop_rejected',
  },
  {
    case_id: 'dance_stale_result',
    dance_session_ref: 'dance_session_m4_vector_gamma',
    sequence_number: 10,
    prior_state: 'active',
    candidate_event_kind: 'runtime_result',
    lifecycle_state: 'queued',
    candidate_state: 'queued',
    expected_receiver_result_class: 'rejected_stale',
    expected_state: 'active',
    core_contract_class: 'stale_result_rejected',
  },
  {
    case_id: 'dance_settled_idle',
    dance_session_ref: 'dance_session_m4_vector_delta',
    sequence_number: 10,
    prior_state: 'stopped',
    candidate_event_kind: 'runtime_result',
    lifecycle_state: 'completed',
    candidate_state: 'idle',
    expected_receiver_result_class: 'accepted_settled_idle',
    expected_state: 'idle',
    core_contract_class: 'settled_idle',
  },
]

function loadDanceLifecycleFixture(): DanceLifecycleFixture {
  const configuredPath = process.env[DANCE_LIFECYCLE_VECTOR_ENV]
  if (
    !configuredPath ||
    configuredPath.length > 512 ||
    configuredPath.includes('\0')
  ) {
    throw new Error(`${DANCE_LIFECYCLE_VECTOR_ENV} must be a bounded file path`)
  }
  const fixturePath = resolve(configuredPath)
  if (extname(fixturePath) !== '.json') {
    throw new Error('Dance lifecycle fixture must have a .json suffix')
  }
  const stats = statSync(fixturePath)
  if (!stats.isFile() || stats.size < 1 || stats.size > 64 * 1024) {
    throw new Error('Dance lifecycle fixture must be a bounded existing file')
  }
  return validateDanceLifecycleFixture(
    JSON.parse(readFileSync(fixturePath, 'utf8'))
  )
}

function validateDanceLifecycleFixture(value: unknown): DanceLifecycleFixture {
  assertRecord(value, 'fixture')
  assertExactKeys(
    value,
    ['schema_version', 'fixture_kind', 'fixture_scope', 'case_order', 'cases'],
    'fixture'
  )
  if (
    value.schema_version !== 'm4_dance_lifecycle_fault_vectors.v0' ||
    value.fixture_kind !== 'non_schema_test_vectors' ||
    value.fixture_scope !== 'parent_dance_lifecycle_fault_vector_harness_only'
  ) {
    throw new Error('Dance lifecycle fixture identifier is invalid')
  }
  if (!Array.isArray(value.case_order) || !Array.isArray(value.cases)) {
    throw new Error('Dance lifecycle fixture rows must be arrays')
  }
  if (
    value.case_order.length !== DANCE_LIFECYCLE_CASE_IDS.length ||
    value.cases.length !== DANCE_LIFECYCLE_CASE_IDS.length
  ) {
    throw new Error('Dance lifecycle fixture must contain exactly nine rows')
  }
  value.case_order.forEach((caseId, index) => {
    if (caseId !== DANCE_LIFECYCLE_CASE_IDS[index]) {
      throw new Error('Dance lifecycle fixture case order is invalid')
    }
  })
  value.cases.forEach((fixtureCase, index) => {
    assertRecord(fixtureCase, `fixture case ${index}`)
    const expected = EXPECTED_DANCE_LIFECYCLE_CASES[index]
    assertExactKeys(
      fixtureCase,
      Object.keys(expected),
      `fixture case ${expected.case_id}`
    )
    for (const [key, expectedValue] of Object.entries(expected)) {
      if (fixtureCase[key] !== expectedValue) {
        throw new Error(`Dance lifecycle fixture value is invalid: ${key}`)
      }
    }
    if (
      !DANCE_LIFECYCLE_SESSION_REFS.includes(
        fixtureCase.dance_session_ref as (typeof DANCE_LIFECYCLE_SESSION_REFS)[number]
      ) ||
      !/^dance_session_m4_vector_[a-z]+$/.test(
        fixtureCase.dance_session_ref as string
      ) ||
      !Number.isSafeInteger(fixtureCase.sequence_number) ||
      (fixtureCase.sequence_number as number) < 1 ||
      (fixtureCase.sequence_number as number) > 1000
    ) {
      throw new Error(
        'Dance lifecycle fixture contains an unsafe reference or sequence'
      )
    }
  })
  return value as DanceLifecycleFixture
}

function assertDanceLifecycleFixtureSensitivity(
  fixture: DanceLifecycleFixture
) {
  const mutations: DanceLifecycleFixture[] = [
    mutateFixture(fixture, (copy) => copy.case_order.reverse()),
    mutateFixture(fixture, (copy) => copy.cases.pop()),
    mutateFixture(fixture, (copy) => {
      ;(
        copy.cases[0] as DanceLifecycleFixtureCase & Record<string, unknown>
      ).extra = true
    }),
    mutateFixture(fixture, (copy) => {
      copy.cases[0].dance_session_ref =
        'dance_session_m4_vector_unsafe' as DanceLifecycleFixtureCase['dance_session_ref']
    }),
    mutateFixture(fixture, (copy) => {
      copy.cases[0].sequence_number = 0
    }),
    mutateFixture(fixture, (copy) => {
      copy.cases[5].expected_receiver_result_class = 'accepted_active'
    }),
    mutateFixture(fixture, (copy) => {
      copy.cases[7].candidate_state = 'active'
    }),
  ]
  for (const mutation of mutations) {
    expect(() => validateDanceLifecycleFixture(mutation)).toThrow()
  }
}

function mutateFixture(
  fixture: DanceLifecycleFixture,
  mutate: (copy: DanceLifecycleFixture) => void
): DanceLifecycleFixture {
  const copy = JSON.parse(JSON.stringify(fixture)) as DanceLifecycleFixture
  mutate(copy)
  return copy
}

function fixtureCase(
  cases: Map<string, DanceLifecycleFixtureCase>,
  caseId: DanceLifecycleFixtureCase['case_id']
): DanceLifecycleFixtureCase {
  const value = cases.get(caseId)
  if (!value) throw new Error(`Missing fixture case: ${caseId}`)
  return value
}

function fixtureCandidate(
  fixtureCase: DanceLifecycleFixtureCase,
  stimulusInstanceId: string,
  runtimeResultId: string,
  candidateState?: 'active' | 'idle'
): MotionRuntimeLifecycleAcceptanceCandidate {
  return {
    eventKind: fixtureCase.candidate_event_kind as 'runtime_result' | 'frame',
    stimulusInstanceId,
    runtimeResultId,
    candidateState:
      candidateState ??
      (fixtureCase.candidate_state === 'active' ? 'active' : 'idle'),
  }
}

function createFixtureDanceRequest(
  fixtureCase: DanceLifecycleFixtureCase,
  stimulusInstanceId: string,
  runtimeResultId: string
) {
  return {
    stimulusId: fixtureCase.case_id,
    stimulusInstanceId,
    runtimeResultId,
    groupKey: 'dance.sequence',
    requestedAtMs: fixtureCase.sequence_number,
    channelIds: ['humanoid:hips:rotation'],
    interruptPolicy: 'queue_same_group' as const,
  }
}

function assertRecord(
  value: unknown,
  label: string
): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`)
  }
}

function assertExactKeys(
  value: Record<string, unknown>,
  expectedKeys: readonly string[],
  label: string
) {
  const actualKeys = Object.keys(value).sort()
  const sortedExpectedKeys = [...expectedKeys].sort()
  if (
    actualKeys.length !== sortedExpectedKeys.length ||
    actualKeys.some((key, index) => key !== sortedExpectedKeys[index])
  ) {
    throw new Error(`${label} has unexpected fields`)
  }
}
