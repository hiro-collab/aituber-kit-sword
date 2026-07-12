/**
 * @jest-environment jsdom
 */

import {
  dispatchThoughtCoreMotionStimulus,
  getThoughtCoreChatResponseStream,
  registerAcceptedPreparedSamplePresentationOwner,
  requestAcceptedPreparedSamplePresentation,
  submitAcceptedPreparedSampleBrowserSpeech,
} from '../../../features/chat/thoughtCoreChat'
import { MOTION_STIMULUS_RECEIVER_EVENT } from '../../../features/motionRuntime/motionStimulusReceiver'
import { createAcceptedPreparedSampleSpeechEnvelope } from '../../../utils/preparedSampleBrowserStt'
import { TextDecoder, TextEncoder } from 'util'
;(global as any).TextEncoder = TextEncoder
;(global as any).TextDecoder = TextDecoder

function createSseResponse(events: unknown[]) {
  const encoder = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const event of events) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
      }
      controller.close()
    },
  })
  return {
    ok: true,
    status: 200,
    body,
    json: jest.fn(),
  }
}

async function readTextStream(stream: ReadableStream<string>): Promise<string> {
  const reader = stream.getReader()
  let text = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    text += value
  }
  return text
}

describe('submitAcceptedPreparedSampleBrowserSpeech', () => {
  const originalMessageChannel = global.MessageChannel
  const originalFetch = global.fetch
  const originalOpen = window.open
  const originalOpener = window.opener
  const conversationAttemptRef =
    'm4.prepared_sample_attempt:0123456789abcdef0123456789abcdef'

  beforeEach(() => {
    global.fetch = jest.fn() as any
  })

  afterEach(() => {
    global.fetch = originalFetch
    global.MessageChannel = originalMessageChannel
    window.open = originalOpen
    Object.defineProperty(window, 'opener', {
      value: originalOpener,
      configurable: true,
    })
  })

  it('uses one acknowledged in-memory UI owner and never calls Core directly', async () => {
    class MemoryPort {
      onmessage: ((event: MessageEvent) => void) | null = null
      peer: MemoryPort | null = null
      postMessage(data: unknown) {
        this.peer?.onmessage?.({ data } as MessageEvent)
      }
      start() {}
      close() {}
    }
    class MemoryMessageChannel {
      port1 = new MemoryPort()
      port2 = new MemoryPort()
      constructor() {
        this.port1.peer = this.port2
        this.port2.peer = this.port1
      }
    }
    global.MessageChannel = MemoryMessageChannel as any
    const childProxy = { closed: false }
    window.open = jest.fn(() => childProxy as any)
    const opener = {
      closed: false,
      postMessage: (data: unknown, origin: string, ports: MessagePort[]) => {
        const event = new Event('message')
        Object.defineProperties(event, {
          data: { value: data },
          origin: { value: origin },
          source: { value: childProxy },
          ports: { value: ports },
        })
        window.dispatchEvent(event)
      },
    }
    Object.defineProperty(window, 'opener', {
      value: opener,
      configurable: true,
    })
    const envelope = createAcceptedPreparedSampleSpeechEnvelope({
      conversationAttemptRef,
      selectedSampleId: 'voice.local_sample_001',
      recognizedText: 'private prepared speech',
      generatedAt: '2026-07-13T01:02:03.000Z',
    })
    const owner = jest.fn(async () => {})
    const registration = registerAcceptedPreparedSamplePresentationOwner(owner)
    registration.openOperator(
      `${window.location.origin}/operator/prepared-sample-stt/`
    )
    const spoofChannel = new MemoryMessageChannel()
    const spoofEvent = new Event('message')
    Object.defineProperties(spoofEvent, {
      data: {
        value: {
          type: 'presentation_probe',
          conversation_attempt_ref: conversationAttemptRef,
        },
      },
      origin: { value: window.location.origin },
      source: { value: { closed: false } },
      ports: { value: [spoofChannel.port2] },
    })
    window.dispatchEvent(spoofEvent)
    expect(owner).not.toHaveBeenCalled()

    await submitAcceptedPreparedSampleBrowserSpeech(envelope)
    await submitAcceptedPreparedSampleBrowserSpeech(envelope)

    expect(owner).toHaveBeenCalledTimes(1)
    expect(owner).toHaveBeenCalledWith(
      envelope,
      expect.objectContaining({ deadlineMs: 30_000 })
    )
    expect(global.fetch).not.toHaveBeenCalled()
    registration.dispose()
  })

  it('rejects a second canonical presentation owner', () => {
    const registration = registerAcceptedPreparedSamplePresentationOwner(
      async () => {}
    )
    expect(() =>
      registerAcceptedPreparedSamplePresentationOwner(async () => {})
    ).toThrow('accepted_prepared_sample_request_failed')
    registration.dispose()
  })

  it('ready without ACK reaches no Core and sends one cancellation', async () => {
    jest.useFakeTimers()
    class MemoryPort {
      onmessage: ((event: MessageEvent) => void) | null = null
      peer: MemoryPort | null = null
      postMessage(data: unknown) {
        this.peer?.onmessage?.({ data } as MessageEvent)
      }
      start() {}
      close() {}
    }
    class MemoryMessageChannel {
      port1 = new MemoryPort()
      port2 = new MemoryPort()
      constructor() {
        this.port1.peer = this.port2
        this.port2.peer = this.port1
      }
    }
    global.MessageChannel = MemoryMessageChannel as any
    let cancellationCount = 0
    Object.defineProperty(window, 'opener', {
      value: {
        closed: false,
        postMessage: (data: any, _origin: string, ports: MemoryPort[]) => {
          const ownerPort = ports[0]
          ownerPort.onmessage = (event) => {
            if (event.data.type === 'presentation_cancelled') {
              cancellationCount += 1
            }
          }
          ownerPort.postMessage({
            type: 'presentation_ready',
            conversation_attempt_ref: data.conversation_attempt_ref,
          })
        },
      },
      configurable: true,
    })
    const envelope = createAcceptedPreparedSampleSpeechEnvelope({
      conversationAttemptRef,
      selectedSampleId: 'voice.local_sample_001',
      recognizedText: 'private prepared speech',
      generatedAt: '2026-07-13T01:02:03.000Z',
    })
    const pending = expect(
      submitAcceptedPreparedSampleBrowserSpeech(envelope)
    ).rejects.toThrow('accepted_prepared_sample_request_failed')
    await jest.advanceTimersByTimeAsync(30_001)
    await pending
    expect(global.fetch).not.toHaveBeenCalled()
    expect(cancellationCount).toBe(1)
    jest.useRealTimers()
  })

  it('returns a fixed failure without echoing an API body', async () => {
    const envelope = createAcceptedPreparedSampleSpeechEnvelope({
      conversationAttemptRef,
      selectedSampleId: 'voice.local_sample_001',
      recognizedText: 'private prepared speech',
      generatedAt: '2026-07-13T01:02:03.000Z',
    })
    ;(global.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      status: 400,
      json: jest.fn().mockResolvedValue({ detail: 'SECRET_PRIVATE_MARKER' }),
    })

    await expect(
      submitAcceptedPreparedSampleBrowserSpeech(envelope)
    ).rejects.toThrow('accepted_prepared_sample_request_failed')
  })

  it('normalizes a thrown fetch exception without echoing its message', async () => {
    const envelope = createAcceptedPreparedSampleSpeechEnvelope({
      conversationAttemptRef,
      selectedSampleId: 'voice.local_sample_001',
      recognizedText: 'private prepared speech',
      generatedAt: '2026-07-13T01:02:03.000Z',
    })
    ;(global.fetch as jest.Mock).mockRejectedValue(
      new Error('SECRET_PROVIDER_PATH_C:\\private\\provider.json')
    )

    await expect(
      submitAcceptedPreparedSampleBrowserSpeech(envelope)
    ).rejects.toThrow('accepted_prepared_sample_request_failed')
  })

  it('normalizes a response stream error without echoing its message', async () => {
    const envelope = createAcceptedPreparedSampleSpeechEnvelope({
      conversationAttemptRef,
      selectedSampleId: 'voice.local_sample_001',
      recognizedText: 'private prepared speech',
      generatedAt: '2026-07-13T01:02:03.000Z',
    })
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(new Error('SECRET_PROVIDER_STREAM_DETAIL'))
      },
    })
    ;(global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      body,
    })

    await expect(
      submitAcceptedPreparedSampleBrowserSpeech(envelope)
    ).rejects.toThrow('accepted_prepared_sample_request_failed')
  })
})

describe('requestAcceptedPreparedSamplePresentation', () => {
  const originalFetch = global.fetch
  const conversationAttemptRef =
    'm4.prepared_sample_attempt:0123456789abcdef0123456789abcdef'
  const envelope = createAcceptedPreparedSampleSpeechEnvelope({
    conversationAttemptRef,
    selectedSampleId: 'voice.local_sample_001',
    recognizedText: 'private prepared speech',
    generatedAt: '2026-07-13T01:02:03.000Z',
  })

  beforeEach(() => {
    global.fetch = jest.fn() as any
  })
  afterEach(() => {
    global.fetch = originalFetch
  })

  it('presents one exact projected assistant response after terminal validation', async () => {
    const present = jest.fn(async () => {})
    const dispatched: CustomEvent[] = []
    window.addEventListener(MOTION_STIMULUS_RECEIVER_EVENT, (event) => {
      dispatched.push(event as CustomEvent)
    })
    ;(global.fetch as jest.Mock).mockResolvedValue(
      createSseResponse([
        {
          type: 'accepted.presentation.assistant_delta',
          data: {
            conversation_attempt_ref: conversationAttemptRef,
            delta: '返答',
          },
        },
        {
          type: 'accepted.presentation.motion',
          data: {
            conversation_attempt_ref: conversationAttemptRef,
            event: createMotionRequestedEvent(),
          },
        },
        {
          type: 'accepted.presentation.completed',
          data: { conversation_attempt_ref: conversationAttemptRef },
        },
      ])
    )
    await requestAcceptedPreparedSamplePresentation(envelope, present, {
      signal: new AbortController().signal,
      deadlineMs: 30_000,
    })
    expect(present).toHaveBeenCalledWith(
      { conversationAttemptRef, assistantSpeech: '返答' },
      expect.objectContaining({ deadlineMs: 30_000 })
    )
    expect(dispatched).toHaveLength(1)
  })

  it.each(['non_ok', 'throw', 'stream_error'])(
    'normalizes actual presentation fetch failure %s without echo',
    async (failureClass) => {
      const present = jest.fn(async () => {})
      if (failureClass === 'non_ok') {
        ;(global.fetch as jest.Mock).mockResolvedValue({
          ok: false,
          status: 500,
          body: null,
        })
      } else if (failureClass === 'throw') {
        ;(global.fetch as jest.Mock).mockRejectedValue(
          new Error('SECRET_PROVIDER_PATH_C:\\private\\provider.json')
        )
      } else {
        ;(global.fetch as jest.Mock).mockResolvedValue({
          ok: true,
          body: new ReadableStream<Uint8Array>({
            start(controller) {
              controller.error(new Error('SECRET_PRIVATE_STREAM'))
            },
          }),
        })
      }
      await expect(
        requestAcceptedPreparedSamplePresentation(envelope, present, {
          signal: new AbortController().signal,
          deadlineMs: 30_000,
        })
      ).rejects.toThrow('accepted_prepared_sample_request_failed')
      expect(present).not.toHaveBeenCalled()
    }
  )

  it('rejects a changed ref and normalizes the fixed client failure', async () => {
    const present = jest.fn(async () => {})
    ;(global.fetch as jest.Mock).mockResolvedValue(
      createSseResponse([
        {
          type: 'accepted.presentation.assistant_delta',
          data: {
            conversation_attempt_ref:
              'm4.prepared_sample_attempt:fedcba9876543210fedcba9876543210',
            delta: 'SECRET_PRIVATE_MARKER',
          },
        },
      ])
    )
    await expect(
      requestAcceptedPreparedSamplePresentation(envelope, present, {
        signal: new AbortController().signal,
        deadlineMs: 30_000,
      })
    ).rejects.toThrow('accepted_prepared_sample_request_failed')
    expect(present).not.toHaveBeenCalled()
  })

  it('rejects terminal-before-assistant ordering with no late presentation', async () => {
    const present = jest.fn(async () => {})
    ;(global.fetch as jest.Mock).mockResolvedValue(
      createSseResponse([
        {
          type: 'accepted.presentation.completed',
          data: { conversation_attempt_ref: conversationAttemptRef },
        },
        {
          type: 'accepted.presentation.assistant_delta',
          data: {
            conversation_attempt_ref: conversationAttemptRef,
            delta: 'late assistant',
          },
        },
      ])
    )
    await expect(
      requestAcceptedPreparedSamplePresentation(envelope, present, {
        signal: new AbortController().signal,
        deadlineMs: 30_000,
      })
    ).rejects.toThrow('accepted_prepared_sample_request_failed')
    expect(present).not.toHaveBeenCalled()
  })

  it.each(['duplicate', 'mismatched_ref'])(
    'rejects %s projected motion with no presentation or dispatch',
    async (mutation) => {
      const present = jest.fn(async () => {})
      const dispatch = jest.spyOn(window, 'dispatchEvent')
      const motion = {
        type: 'accepted.presentation.motion',
        data: {
          conversation_attempt_ref:
            mutation === 'mismatched_ref'
              ? 'm4.prepared_sample_attempt:fedcba9876543210fedcba9876543210'
              : conversationAttemptRef,
          event: createMotionRequestedEvent(),
        },
      }
      ;(global.fetch as jest.Mock).mockResolvedValue(
        createSseResponse([
          {
            type: 'accepted.presentation.assistant_delta',
            data: {
              conversation_attempt_ref: conversationAttemptRef,
              delta: '返答',
            },
          },
          motion,
          ...(mutation === 'duplicate' ? [motion] : []),
          {
            type: 'accepted.presentation.completed',
            data: { conversation_attempt_ref: conversationAttemptRef },
          },
        ])
      )
      await expect(
        requestAcceptedPreparedSamplePresentation(envelope, present, {
          signal: new AbortController().signal,
          deadlineMs: 30_000,
        })
      ).rejects.toThrow('accepted_prepared_sample_request_failed')
      expect(present).not.toHaveBeenCalled()
      expect(dispatch).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: MOTION_STIMULUS_RECEIVER_EVENT })
      )
      dispatch.mockRestore()
    }
  )

  it('cancels an abnormal reader exactly once and produces no late effects', async () => {
    const cancel = jest.fn(async () => {})
    const releaseLock = jest.fn()
    ;(global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      body: {
        getReader: () => ({
          read: jest.fn().mockRejectedValue(new Error('PRIVATE_READER_ERROR')),
          cancel,
          releaseLock,
        }),
      },
    })
    const present = jest.fn(async () => {})
    await expect(
      requestAcceptedPreparedSamplePresentation(envelope, present, {
        signal: new AbortController().signal,
        deadlineMs: 30_000,
      })
    ).rejects.toThrow('accepted_prepared_sample_request_failed')
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(releaseLock).toHaveBeenCalledTimes(1)
    expect(present).not.toHaveBeenCalled()
  })

  it('cancels malformed projected SSE once with no presentation or motion', async () => {
    const encoder = new TextEncoder()
    const cancel = jest.fn(async () => {})
    const releaseLock = jest.fn()
    const value = encoder.encode(
      `data: ${JSON.stringify({
        type: 'accepted.presentation.assistant_delta',
        data: {
          conversation_attempt_ref: conversationAttemptRef,
          delta: '安全な返答',
        },
      })}\n\ndata: SECRET_MALFORMED_PRIVATE_{\n\n`
    )
    ;(global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      body: {
        getReader: () => ({
          read: jest.fn().mockResolvedValueOnce({ done: false, value }),
          cancel,
          releaseLock,
        }),
      },
    })
    const present = jest.fn(async () => {})
    const dispatch = jest.spyOn(window, 'dispatchEvent')
    await expect(
      requestAcceptedPreparedSamplePresentation(envelope, present, {
        signal: new AbortController().signal,
        deadlineMs: 30_000,
      })
    ).rejects.toThrow('accepted_prepared_sample_request_failed')
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(releaseLock).toHaveBeenCalledTimes(1)
    expect(present).not.toHaveBeenCalled()
    expect(dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: MOTION_STIMULUS_RECEIVER_EVENT })
    )
    dispatch.mockRestore()
  })
})

describe('getThoughtCoreChatResponseStream motion bridge', () => {
  const originalFetch = global.fetch

  beforeEach(() => {
    jest.clearAllMocks()
    global.fetch = jest.fn() as any
  })

  afterEach(() => {
    global.fetch = originalFetch
  })

  it('dispatches safe Thought Core dance motion requests and preserves speech', async () => {
    const dispatched: CustomEvent[] = []
    window.addEventListener(MOTION_STIMULUS_RECEIVER_EVENT, (event) => {
      dispatched.push(event as CustomEvent)
    })
    ;(global.fetch as jest.Mock).mockResolvedValue(
      createSseResponse([
        createMotionRequestedEvent({
          runtime_result_id: 'caller-runtime-result-must-not-forward',
          trace: {
            ...createDanceStimulus().trace,
            driver_result_id: 'driver-result-must-not-forward',
          },
        }),
        {
          type: 'assistant.speech_delta',
          data: { delta: '了解しました' },
        },
      ])
    )

    const stream = await getThoughtCoreChatResponseStream(
      [{ content: '踊って' } as any],
      '',
      'session-bridge'
    )
    const text = await readTextStream(stream)

    expect(text).toBe('了解しました')
    expect(dispatched).toHaveLength(1)
    expect(dispatched[0].type).toBe(MOTION_STIMULUS_RECEIVER_EVENT)
    expect(dispatched[0].detail).toEqual(
      expect.objectContaining({
        schema_version: 'motion_stimulus.v0',
        kind: 'dance_sequence',
        request_mode: 'play',
        payload_ref: 'motion.thought_core.dance_sequence.v0',
        target_model_type: 'vrm',
        motion_event_id: 'mot_evt_turn_bridge_001',
        stimulus_id: 'mot_stim_turn_bridge_dance_sequence',
        stimulus_instance_id: 'mot_inst_turn_bridge_001',
      })
    )
    expect(dispatched[0].detail.trace).toEqual(
      expect.objectContaining({
        runtime_result_id: 'mot_res_turn_bridge_pending_001',
        multi_stimulus_group_id: 'multi-stimulus-turn-bridge-001',
        motion_event_id: 'mot_evt_turn_bridge_001',
        stimulus_id: 'mot_stim_turn_bridge_dance_sequence',
        stimulus_instance_id: 'mot_inst_turn_bridge_001',
      })
    )
    expect(dispatched[0].detail).not.toHaveProperty('runtime_result_id')
    expect(dispatched[0].detail.trace).not.toHaveProperty('driver_result_id')
  })

  it('dispatches actual Thought Core dance requests with safe track mask arrays', async () => {
    const dispatched: CustomEvent[] = []
    window.addEventListener(MOTION_STIMULUS_RECEIVER_EVENT, (event) => {
      dispatched.push(event as CustomEvent)
    })
    ;(global.fetch as jest.Mock).mockResolvedValue(
      createSseResponse([
        createMotionRequestedEvent({
          phase: 'queued',
          lifecycle_state: 'queued',
          safe_visible_state: 'requested',
          track_mask: [
            'body_root',
            'spine',
            'chest',
            'neck',
            'head',
            'left_arm',
            'right_arm',
            'left_hand',
            'right_hand',
            'balance',
          ],
          requirements: {
            required_tracks: ['body_root', 'spine'],
            optional_tracks: ['chest', 'neck', 'head'],
            compatible_model_types: ['vrm'],
            provenance_required: true,
            allow_degraded: true,
            allow_fallback: true,
          },
        }),
        {
          type: 'assistant.speech_delta',
          data: { delta: '受け取りました' },
        },
      ])
    )

    const stream = await getThoughtCoreChatResponseStream(
      [{ content: '踊って' } as any],
      '',
      'session-bridge'
    )
    const text = await readTextStream(stream)

    expect(text).toBe('受け取りました')
    expect(dispatched).toHaveLength(1)
    expect(dispatched[0].detail).toEqual(
      expect.objectContaining({
        kind: 'dance_sequence',
        request_mode: 'play',
        payload_ref: 'motion.thought_core.dance_sequence.v0',
        target_model_type: 'vrm',
        track_mask: [
          'body_root',
          'spine',
          'chest',
          'neck',
          'head',
          'left_arm',
          'right_arm',
          'left_hand',
          'right_hand',
          'balance',
        ],
      })
    )
  })

  it('dispatches safe Thought Core stop requests to the Motion Runtime receiver', async () => {
    const dispatched: CustomEvent[] = []
    window.addEventListener(MOTION_STIMULUS_RECEIVER_EVENT, (event) => {
      dispatched.push(event as CustomEvent)
    })
    ;(global.fetch as jest.Mock).mockResolvedValue(
      createSseResponse([
        createMotionRequestedEvent(createStopStimulus()),
        {
          type: 'assistant.speech_delta',
          data: { delta: '踊りを止めます' },
        },
      ])
    )

    const stream = await getThoughtCoreChatResponseStream(
      [{ content: '踊りをやめて' } as any],
      '',
      'session-bridge'
    )
    const text = await readTextStream(stream)

    expect(text).toBe('踊りを止めます')
    expect(dispatched).toHaveLength(1)
    expect(dispatched[0].detail).toEqual(
      expect.objectContaining({
        schema_version: 'motion_stimulus.v0',
        kind: 'stop',
        request_mode: 'stop',
        payload_ref: 'motion.thought_core.stop.v0',
        target_model_type: 'vrm',
        motion_event_id: 'mot_evt_turn_bridge_stop',
        stimulus_id: 'mot_stim_turn_bridge_stop',
        stimulus_instance_id: 'mot_inst_turn_bridge_stop',
        safe_visible_state: 'neutral_idle_requested',
        duration_ms: 0,
        loop: false,
        interrupt_policy: 'stop',
        fallback_state: 'stop_to_idle',
        stop_reason: 'user_requested',
      })
    )
    expect(dispatched[0].detail.requirements).toEqual(
      expect.objectContaining({
        stop_target: 'dance.sequence',
      })
    )
    expect(dispatched[0].detail.trace).toEqual(
      expect.objectContaining({
        runtime_result_id: 'stop-runtime-result-planned-1',
        motion_event_id: 'mot_evt_turn_bridge_stop',
        stimulus_id: 'mot_stim_turn_bridge_stop',
        stimulus_instance_id: 'mot_inst_turn_bridge_stop',
      })
    )
  })

  it.each([
    ['task_interrupted', '別の作業に移ります'],
    ['timeout_elapsed', '踊りを止めます'],
  ])(
    'preserves allowlisted Thought Core stop reason %s',
    async (stopReason, speech) => {
      const dispatched: CustomEvent[] = []
      window.addEventListener(MOTION_STIMULUS_RECEIVER_EVENT, (event) => {
        dispatched.push(event as CustomEvent)
      })
      ;(global.fetch as jest.Mock).mockResolvedValue(
        createSseResponse([
          createMotionRequestedEvent({
            ...createStopStimulus(),
            stop_reason: stopReason,
          }),
          {
            type: 'assistant.speech_delta',
            data: { delta: speech },
          },
        ])
      )

      const stream = await getThoughtCoreChatResponseStream(
        [{ content: '別の作業をして' } as any],
        '',
        'session-bridge'
      )
      const text = await readTextStream(stream)

      expect(text).toBe(speech)
      expect(dispatched).toHaveLength(1)
      expect(dispatched[0].detail).toEqual(
        expect.objectContaining({
          kind: 'stop',
          request_mode: 'stop',
          payload_ref: 'motion.thought_core.stop.v0',
          stop_reason: stopReason,
          safe_visible_state: 'neutral_idle_requested',
        })
      )
    }
  )

  it('dispatches safe Thought Core expression-visible requests as a distinct route', async () => {
    const dispatched: CustomEvent[] = []
    window.addEventListener(MOTION_STIMULUS_RECEIVER_EVENT, (event) => {
      dispatched.push(event as CustomEvent)
    })
    ;(global.fetch as jest.Mock).mockResolvedValue(
      createSseResponse([
        createMotionRequestedEvent(createExpressionVisibleStimulus()),
        {
          type: 'assistant.speech_delta',
          data: { delta: '表情を変えます' },
        },
      ])
    )

    const stream = await getThoughtCoreChatResponseStream(
      [{ content: '笑って' } as any],
      '',
      'session-bridge'
    )
    const text = await readTextStream(stream)

    expect(text).toBe('表情を変えます')
    expect(dispatched).toHaveLength(1)
    expect(dispatched[0].detail).toEqual(
      expect.objectContaining({
        schema_version: 'motion_stimulus.v0',
        kind: 'expression',
        request_mode: 'apply',
        payload_ref: 'motion.thought_core.expression_visible.v0',
        target_model_type: 'vrm',
        motion_event_id: 'mot_evt_turn_bridge_expression_visible',
        stimulus_id: 'mot_stim_turn_bridge_expression_visible',
        stimulus_instance_id: 'mot_inst_turn_bridge_expression_visible',
        safe_visible_state: 'expression_change_requested',
        track_mask: {
          scope: 'face_head',
          channels: ['expression_weight'],
        },
      })
    )
    expect(dispatched[0].detail.requirements).toEqual(
      expect.objectContaining({
        expression_profile_ref: 'motion.runtime.vrm_expression_weights.v0',
        expected_visible_change: 'face_expression',
        expected_roi: 'avatar_face_head',
      })
    )
    expect(dispatched[0].detail.trace).toEqual(
      expect.objectContaining({
        runtime_result_id: 'expr-runtime-result-planned-1',
        driver_result_id: 'driver-result-expression-planned-1',
        multi_stimulus_group_id: 'multi-stimulus-turn-bridge-001',
        motion_event_id: 'mot_evt_turn_bridge_expression_visible',
        stimulus_id: 'mot_stim_turn_bridge_expression_visible',
        stimulus_instance_id: 'mot_inst_turn_bridge_expression_visible',
      })
    )
  })

  it('dispatches paired dance and expression requests with distinct result refs and a shared correlation ref', async () => {
    const dispatched: CustomEvent[] = []
    window.addEventListener(MOTION_STIMULUS_RECEIVER_EVENT, (event) => {
      dispatched.push(event as CustomEvent)
    })
    ;(global.fetch as jest.Mock).mockResolvedValue(
      createSseResponse([
        createMotionRequestedEvent(createDanceStimulus()),
        createMotionRequestedEvent(createExpressionVisibleStimulus()),
        {
          type: 'assistant.speech_delta',
          data: { delta: '踊りながら表情を変えます' },
        },
      ])
    )

    const stream = await getThoughtCoreChatResponseStream(
      [{ content: '踊って笑って' } as any],
      '',
      'session-bridge'
    )
    const text = await readTextStream(stream)

    expect(text).toBe('踊りながら表情を変えます')
    expect(dispatched).toHaveLength(2)
    expect(dispatched[0].detail).toEqual(
      expect.objectContaining({
        kind: 'dance_sequence',
        stimulus_instance_id: 'mot_inst_turn_bridge_001',
      })
    )
    expect(dispatched[1].detail).toEqual(
      expect.objectContaining({
        kind: 'expression',
        stimulus_instance_id: 'mot_inst_turn_bridge_expression_visible',
      })
    )
    expect(dispatched[0].detail.trace).toEqual(
      expect.objectContaining({
        runtime_result_id: 'mot_res_turn_bridge_pending_001',
        multi_stimulus_group_id: 'multi-stimulus-turn-bridge-001',
      })
    )
    expect(dispatched[1].detail.trace).toEqual(
      expect.objectContaining({
        runtime_result_id: 'expr-runtime-result-planned-1',
        driver_result_id: 'driver-result-expression-planned-1',
        multi_stimulus_group_id: 'multi-stimulus-turn-bridge-001',
      })
    )
  })

  it.each([
    'provider-openai-session',
    'device-camera-route',
    'entity.light_living_room',
    'raw-transcript-turn',
    'private-path-turn',
  ])('omits unsafe multi-stimulus correlation ref: %s', (unsafeGroupId) => {
    const dispatched: CustomEvent[] = []
    const listener = (event: Event) => {
      dispatched.push(event as CustomEvent)
    }
    window.addEventListener(MOTION_STIMULUS_RECEIVER_EVENT, listener)

    const didDispatch = dispatchThoughtCoreMotionStimulus(
      createMotionRequestedEvent({
        trace: {
          ...createDanceStimulus().trace,
          multi_stimulus_group_id: unsafeGroupId,
        },
      })
    )

    expect(didDispatch).toBe(true)
    expect(dispatched).toHaveLength(1)
    expect(dispatched[0].detail.trace).not.toHaveProperty(
      'multi_stimulus_group_id'
    )

    window.removeEventListener(MOTION_STIMULUS_RECEIVER_EVENT, listener)
  })

  it('suppresses unsafe motion payloads without breaking speech streaming', async () => {
    const dispatched: CustomEvent[] = []
    window.addEventListener(MOTION_STIMULUS_RECEIVER_EVENT, (event) => {
      dispatched.push(event as CustomEvent)
    })
    ;(global.fetch as jest.Mock).mockResolvedValue(
      createSseResponse([
        createMotionRequestedEvent({
          raw_prompt: 'do not forward',
        }),
        {
          type: 'feedback.requested',
          data: { speech: 'もう一度確認します' },
        },
      ])
    )

    const stream = await getThoughtCoreChatResponseStream(
      [{ content: '踊って' } as any],
      '',
      'session-bridge'
    )
    const text = await readTextStream(stream)

    expect(text).toBe('もう一度確認します')
    expect(dispatched).toHaveLength(0)
  })

  it('suppresses motion payloads with unsafe track mask array values', async () => {
    const dispatched: CustomEvent[] = []
    window.addEventListener(MOTION_STIMULUS_RECEIVER_EVENT, (event) => {
      dispatched.push(event as CustomEvent)
    })
    ;(global.fetch as jest.Mock).mockResolvedValue(
      createSseResponse([
        createMotionRequestedEvent({
          track_mask: ['body_root', 'C:\\private\\motion.vrma'],
        }),
        {
          type: 'assistant.speech_delta',
          data: { delta: '踊りを確認します' },
        },
      ])
    )

    const stream = await getThoughtCoreChatResponseStream(
      [{ content: '踊って' } as any],
      '',
      'session-bridge'
    )
    const text = await readTextStream(stream)

    expect(text).toBe('踊りを確認します')
    expect(dispatched).toHaveLength(0)
  })

  it('suppresses dance motion payloads that carry Home Control markers', async () => {
    const dispatched: CustomEvent[] = []
    window.addEventListener(MOTION_STIMULUS_RECEIVER_EVENT, (event) => {
      dispatched.push(event as CustomEvent)
    })
    ;(global.fetch as jest.Mock).mockResolvedValue(
      createSseResponse([
        createMotionRequestedEvent({
          is_home_action: true,
          entity_id: 'light_living_room',
          requirements: {
            ...createDanceStimulus().requirements,
            home_control_route: true,
          },
          redaction: {
            ...createDanceStimulus().redaction,
            contains_home_control_route: true,
          },
        }),
        {
          type: 'assistant.speech_delta',
          data: { delta: '踊りの経路を確認します' },
        },
      ])
    )

    const stream = await getThoughtCoreChatResponseStream(
      [{ content: '踊って' } as any],
      '',
      'session-bridge'
    )
    const text = await readTextStream(stream)

    expect(text).toBe('踊りの経路を確認します')
    expect(dispatched).toHaveLength(0)
  })

  it('suppresses expression-visible payloads that use the context nod track mask', async () => {
    const dispatched: CustomEvent[] = []
    window.addEventListener(MOTION_STIMULUS_RECEIVER_EVENT, (event) => {
      dispatched.push(event as CustomEvent)
    })
    ;(global.fetch as jest.Mock).mockResolvedValue(
      createSseResponse([
        createMotionRequestedEvent({
          ...createExpressionVisibleStimulus(),
          track_mask: { scope: 'head_neck', channels: ['expression_weight'] },
        }),
        {
          type: 'assistant.speech_delta',
          data: { delta: '表情経路を確認します' },
        },
      ])
    )

    const stream = await getThoughtCoreChatResponseStream(
      [{ content: '笑って' } as any],
      '',
      'session-bridge'
    )
    const text = await readTextStream(stream)

    expect(text).toBe('表情経路を確認します')
    expect(dispatched).toHaveLength(0)
  })

  it('suppresses expression-visible payloads that carry Home Control markers', async () => {
    const dispatched: CustomEvent[] = []
    window.addEventListener(MOTION_STIMULUS_RECEIVER_EVENT, (event) => {
      dispatched.push(event as CustomEvent)
    })
    ;(global.fetch as jest.Mock).mockResolvedValue(
      createSseResponse([
        createMotionRequestedEvent({
          ...createExpressionVisibleStimulus(),
          action_type: 'home_control',
          requirements: {
            ...createExpressionVisibleStimulus().requirements,
            home_control_route: true,
          },
        }),
        {
          type: 'assistant.speech_delta',
          data: { delta: '表情だけ確認します' },
        },
      ])
    )

    const stream = await getThoughtCoreChatResponseStream(
      [{ content: '笑って' } as any],
      '',
      'session-bridge'
    )
    const text = await readTextStream(stream)

    expect(text).toBe('表情だけ確認します')
    expect(dispatched).toHaveLength(0)
  })

  it('suppresses malformed or unsupported motion requests', () => {
    const dispatchEvent = jest.spyOn(window, 'dispatchEvent')

    expect(
      dispatchThoughtCoreMotionStimulus(
        createMotionRequestedEvent({
          request_mode: 'start',
        })
      )
    ).toBe(false)
    expect(
      dispatchThoughtCoreMotionStimulus(
        createMotionRequestedEvent({
          kind: 'dance',
        })
      )
    ).toBe(false)
    expect(dispatchEvent).not.toHaveBeenCalled()
  })
})

function createMotionRequestedEvent(overrides: Record<string, unknown> = {}) {
  return {
    type: 'motion.requested',
    event_id: 'event-motion-requested',
    turn_id: 'turn-bridge',
    session_id: 'session-bridge',
    seq: 1,
    data: {
      ...createDanceStimulus(),
      ...overrides,
    },
  }
}

function createDanceStimulus() {
  return {
    schema_version: 'motion_stimulus.v0',
    motion_event_id: 'mot_evt_turn_bridge_001',
    stimulus_id: 'mot_stim_turn_bridge_dance_sequence',
    stimulus_instance_id: 'mot_inst_turn_bridge_001',
    source_class: 'user_command',
    source_origin: 'thought_core',
    requested_at: '2026-06-12T06:30:00.000Z',
    kind: 'dance_sequence',
    request_mode: 'play',
    phase: 'requested',
    lifecycle_state: 'request_issued',
    safe_visible_state: 'motion_requested',
    target_model_type: 'vrm',
    payload_ref: 'motion.thought_core.dance_sequence.v0',
    track_mask: {
      scope: 'full_body',
    },
    requirements: {
      visible_motion: true,
    },
    trace: {
      event_id: 'event-motion-requested',
      turn_id: 'turn-bridge',
      session_id: 'session-bridge',
      request_id: 'motion-request-bridge',
      runtime_result_id: 'mot_res_turn_bridge_pending_001',
      multi_stimulus_group_id: 'multi-stimulus-turn-bridge-001',
      motion_event_id: 'mot_evt_turn_bridge_001',
      stimulus_id: 'mot_stim_turn_bridge_dance_sequence',
      stimulus_instance_id: 'mot_inst_turn_bridge_001',
      attempt: 1,
    },
    redaction: {
      shared_summary_only: true,
      contains_raw_prompt: false,
      contains_raw_transcript: false,
      contains_provider_payload: false,
      contains_private_path: false,
      contains_raw_media: false,
      contains_home_control_route: false,
    },
  }
}

function createExpressionVisibleStimulus() {
  return {
    schema_version: 'motion_stimulus.v0',
    motion_event_id: 'mot_evt_turn_bridge_expression_visible',
    stimulus_id: 'mot_stim_turn_bridge_expression_visible',
    stimulus_instance_id: 'mot_inst_turn_bridge_expression_visible',
    source_class: 'user_command',
    source_origin: 'thought_core',
    requested_at: '2026-06-12T06:31:00.000Z',
    kind: 'expression',
    request_mode: 'apply',
    phase: 'requested',
    lifecycle_state: 'request_issued',
    safe_visible_state: 'expression_change_requested',
    target_model_type: 'vrm',
    payload_ref: 'motion.thought_core.expression_visible.v0',
    track_mask: {
      scope: 'face_head',
      channels: ['expression_weight'],
    },
    requirements: {
      visible_motion: true,
      expression_profile_ref: 'motion.runtime.vrm_expression_weights.v0',
      expected_visible_change: 'face_expression',
      expected_roi: 'avatar_face_head',
    },
    trace: {
      event_id: 'event-expression-visible-requested',
      turn_id: 'turn-bridge',
      session_id: 'session-bridge',
      request_id: 'expression-request-bridge',
      runtime_result_id: 'expr-runtime-result-planned-1',
      driver_result_id: 'driver-result-expression-planned-1',
      multi_stimulus_group_id: 'multi-stimulus-turn-bridge-001',
      motion_event_id: 'mot_evt_turn_bridge_expression_visible',
      stimulus_id: 'mot_stim_turn_bridge_expression_visible',
      stimulus_instance_id: 'mot_inst_turn_bridge_expression_visible',
      attempt: 1,
    },
    redaction: {
      shared_summary_only: true,
      contains_raw_prompt: false,
      contains_raw_transcript: false,
      contains_provider_payload: false,
      contains_private_path: false,
      contains_raw_media: false,
      contains_home_control_route: false,
    },
  }
}

function createStopStimulus() {
  return {
    schema_version: 'motion_stimulus.v0',
    motion_event_id: 'mot_evt_turn_bridge_stop',
    stimulus_id: 'mot_stim_turn_bridge_stop',
    stimulus_instance_id: 'mot_inst_turn_bridge_stop',
    source_class: 'user_command',
    source_origin: 'thought_core',
    requested_at: '2026-06-15T06:30:00.000Z',
    kind: 'stop',
    request_mode: 'stop',
    phase: 'requested',
    lifecycle_state: 'request_issued',
    safe_visible_state: 'neutral_idle_requested',
    target_model_type: 'vrm',
    payload_ref: 'motion.thought_core.stop.v0',
    duration_ms: 0,
    loop: false,
    interrupt_policy: 'stop',
    fallback_state: 'stop_to_idle',
    stop_reason: 'user_requested',
    track_mask: {
      scope: 'full_body',
    },
    requirements: {
      stop_target: 'dance.sequence',
      fallback_state: 'stop_to_idle',
    },
    trace: {
      event_id: 'event-stop-requested',
      turn_id: 'turn-bridge',
      session_id: 'session-bridge',
      request_id: 'stop-request-bridge',
      runtime_result_id: 'stop-runtime-result-planned-1',
      motion_event_id: 'mot_evt_turn_bridge_stop',
      stimulus_id: 'mot_stim_turn_bridge_stop',
      stimulus_instance_id: 'mot_inst_turn_bridge_stop',
      attempt: 1,
    },
    redaction: {
      shared_summary_only: true,
      contains_raw_prompt: false,
      contains_raw_transcript: false,
      contains_provider_payload: false,
      contains_private_path: false,
      contains_raw_media: false,
      contains_home_control_route: false,
    },
  }
}

describe('getThoughtCoreChatResponseStream conversation attempt metadata', () => {
  const conversationAttemptRef =
    'm4.prepared_sample_attempt:0123456789abcdef0123456789abcdef'
  const originalFetch = global.fetch

  beforeEach(() => {
    global.fetch = jest.fn() as any
  })

  afterEach(() => {
    global.fetch = originalFetch
  })

  it('forwards only a canonical ref from accepted assistant events while preserving canonical speech', async () => {
    const onResponseMetadata = jest.fn()
    ;(global.fetch as jest.Mock).mockResolvedValue(
      createSseResponse([
        {
          type: 'assistant.speech_delta',
          data: {
            delta: '応答します。',
            conversation_attempt_ref: conversationAttemptRef,
          },
        },
      ])
    )

    const stream = await getThoughtCoreChatResponseStream(
      [{ content: 'こんにちは' } as any],
      '',
      'session-bridge',
      onResponseMetadata
    )

    await expect(readTextStream(stream)).resolves.toBe('応答します。')
    expect(onResponseMetadata).toHaveBeenCalledWith({
      conversationAttemptRef,
    })
  })

  it.each([
    undefined,
    'raw-private-marker',
    'C:\\private\\attempt',
    'm4.prepared_sample_attempt0123456789abcdef0123456789abcdef',
    'm4.prepared_sample_attempt:0123456789ABCDEF0123456789abcdef',
    'm4.other_attempt:0123456789abcdef0123456789abcdef',
    'm4.prepared_sample_attempt:0123456789abcdef0123456789abcde',
  ])(
    'omits missing or non-canonical conversation attempt refs: %p',
    async (conversationAttemptRef) => {
      const onResponseMetadata = jest.fn()
      ;(global.fetch as jest.Mock).mockResolvedValue(
        createSseResponse([
          {
            type: 'assistant.speech_delta',
            data: {
              delta: '応答します。',
              conversation_attempt_ref: conversationAttemptRef,
            },
          },
        ])
      )

      const stream = await getThoughtCoreChatResponseStream(
        [{ content: 'こんにちは' } as any],
        '',
        'session-bridge',
        onResponseMetadata
      )

      await expect(readTextStream(stream)).resolves.toBe('応答します。')
      expect(onResponseMetadata).not.toHaveBeenCalled()
    }
  )
})
