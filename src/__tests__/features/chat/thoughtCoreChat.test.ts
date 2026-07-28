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
import {
  publishProjectionEffectExecutionReceipt,
  subscribeProjectionEffectIntents,
} from '../../../features/projectionEffects/projectionEffectIntent'
import { TextDecoder, TextEncoder } from 'util'
;(global as any).TextEncoder = TextEncoder
;(global as any).TextDecoder = TextDecoder

function installProjectionEffectChannel() {
  const original = global.BroadcastChannel
  const channels = new Set<MockProjectionEffectChannel>()
  class MockProjectionEffectChannel {
    private readonly listeners = new Set<(event: MessageEvent) => void>()
    private closed = false

    constructor(_name: string) {
      channels.add(this)
    }

    postMessage(value: unknown) {
      if (this.closed) return
      for (const peer of channels) {
        if (peer === this || peer.closed) continue
        for (const listener of peer.listeners) {
          listener({ data: value } as MessageEvent)
        }
      }
    }

    addEventListener(
      _type: 'message',
      listener: (event: MessageEvent) => void
    ) {
      this.listeners.add(listener)
    }

    removeEventListener(
      _type: 'message',
      listener: (event: MessageEvent) => void
    ) {
      this.listeners.delete(listener)
    }

    close() {
      this.closed = true
      this.listeners.clear()
      channels.delete(this)
    }
  }
  global.BroadcastChannel = MockProjectionEffectChannel as any
  return {
    getChannelCount: () => channels.size,
    restore() {
      for (const channel of [...channels]) channel.close()
      global.BroadcastChannel = original
    },
  }
}

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
      expect.objectContaining({ deadlineMs: 75_000 })
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
    await jest.advanceTimersByTimeAsync(75_001)
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

describe('getThoughtCoreChatResponseStream projection effect intent bridge', () => {
  const originalFetch = global.fetch

  afterEach(() => {
    global.fetch = originalFetch
  })

  it('publishes one deduplicated fixed intent and preserves speech', async () => {
    const channelHarness = installProjectionEffectChannel()
    const received: unknown[] = []
    const dispose = subscribeProjectionEffectIntents((intent) => {
      received.push(intent)
      publishProjectionEffectExecutionReceipt({
        schemaVersion: 1,
        eventId: intent.eventId,
        status: 'completed',
        resultClass: 'started',
      })
    })
    const safeIntentEvent = {
      type: 'accepted.presentation.projection_effect_intent',
      data: {
        intent: {
          schemaVersion: 1,
          eventId: 'evt_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          turnId: 'turn_projection_phase1',
          action: 'start',
          effectId: 'thunderBall',
        },
      },
    }
    global.fetch = jest
      .fn()
      .mockResolvedValue(
        createSseResponse([
          safeIntentEvent,
          safeIntentEvent,
          { type: 'assistant.speech_delta', data: { delta: '雷を出します。' } },
        ])
      ) as any

    const stream = await getThoughtCoreChatResponseStream(
      [{ content: '雷を出して' } as any],
      '',
      'session-projection-effect'
    )
    await expect(readTextStream(stream)).resolves.toBe('雷を出します。')
    expect(received).toEqual([
      {
        schemaVersion: 1,
        eventId: 'evt_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        turnId: 'turn_projection_phase1',
        action: 'start',
        effectId: 'thunderBall',
      },
    ])
    dispose()
    channelHarness.restore()
  })

  it('publishes one deduplicated text-free v2 plan and ignores malformed plans', async () => {
    const channelHarness = installProjectionEffectChannel()
    const received: unknown[] = []
    const dispose = subscribeProjectionEffectIntents((intent) => {
      received.push(intent)
      publishProjectionEffectExecutionReceipt({
        schemaVersion: 1,
        eventId: intent.eventId,
        status: 'completed',
        resultClass: 'started',
      })
    })
    const plan = {
      schemaVersion: 1,
      planId: 'planv1_0123456789abcdef0123456789abcdef',
      sessionId: 'session_projection_phase1',
      revision: 1,
      action: 'start',
      effectId: 'fire',
      position: { x: -0.65, y: -0.55 },
      strength: 0.5,
      durationMs: 4_000,
      seed: 42,
      keyframes: [
        { atMs: 0, position: { x: -0.65, y: -0.55 }, strength: 0.5 },
        { atMs: 4_000, position: { x: 0.65, y: 0.55 }, strength: 0.5 },
      ],
    }
    const safeIntentEvent = {
      type: 'accepted.presentation.projection_effect_intent',
      data: {
        intent: {
          schemaVersion: 2,
          eventId: 'evt_cccccccccccccccccccccccccccccccc',
          turnId: 'turn_projection_phase1',
          action: 'start',
          plan,
        },
      },
    }
    global.fetch = jest.fn().mockResolvedValue(
      createSseResponse([
        safeIntentEvent,
        safeIntentEvent,
        {
          type: 'accepted.presentation.projection_effect_intent',
          data: {
            intent: {
              ...safeIntentEvent.data.intent,
              eventId: 'evt_dddddddddddddddddddddddddddddddd',
              plan: { ...plan, rawPrompt: 'PRIVATE_PLAN_MARKER' },
            },
          },
        },
        { type: 'assistant.speech_delta', data: { delta: '炎を動かします。' } },
      ])
    ) as any

    const stream = await getThoughtCoreChatResponseStream(
      [{ content: '炎を左下から右上へ4秒' } as any],
      '',
      'session-projection-effect'
    )
    await expect(readTextStream(stream)).resolves.toBe('炎を動かします。')
    expect(received).toEqual([
      {
        schemaVersion: 2,
        eventId: 'evt_cccccccccccccccccccccccccccccccc',
        turnId: 'turn_projection_phase1',
        action: 'start',
        plan,
      },
    ])
    expect(JSON.stringify(received)).not.toContain('PRIVATE_PLAN_MARKER')
    dispose()
    channelHarness.restore()
  })

  it('errors the stream with a fixed result when no Avatar receiver is ready', async () => {
    jest.useFakeTimers()
    const channelHarness = installProjectionEffectChannel()
    try {
      global.fetch = jest.fn().mockResolvedValue(
        createSseResponse([
          {
            type: 'accepted.presentation.projection_effect_intent',
            data: {
              intent: {
                schemaVersion: 1,
                eventId: 'evt_11111111111111111111111111111111',
                turnId: 'turn_projection_unavailable',
                action: 'start',
                effectId: 'fire',
              },
            },
          },
        ])
      ) as any

      const stream = await getThoughtCoreChatResponseStream(
        [{ content: '炎を出して' } as any],
        '',
        'session-projection-effect'
      )
      const result = expect(readTextStream(stream)).rejects.toThrow(
        'projection_effect_delivery_failed'
      )
      await jest.advanceTimersByTimeAsync(501)

      await result
      expect(channelHarness.getChannelCount()).toBe(0)
      expect(jest.getTimerCount()).toBe(0)
    } finally {
      channelHarness.restore()
      jest.useRealTimers()
    }
  })

  it('errors the stream with a fixed result when Avatar rejects execution', async () => {
    const channelHarness = installProjectionEffectChannel()
    const receive = jest.fn((intent: { eventId: string }) => {
      publishProjectionEffectExecutionReceipt({
        schemaVersion: 1,
        eventId: intent.eventId,
        status: 'rejected',
        resultClass: 'host_rejected',
      })
    })
    const dispose = subscribeProjectionEffectIntents(receive)
    try {
      global.fetch = jest.fn().mockResolvedValue(
        createSseResponse([
          {
            type: 'accepted.presentation.projection_effect_intent',
            data: {
              intent: {
                schemaVersion: 1,
                eventId: 'evt_22222222222222222222222222222222',
                turnId: 'turn_projection_rejected',
                action: 'start',
                effectId: 'thunderBall',
              },
            },
          },
        ])
      ) as any

      const stream = await getThoughtCoreChatResponseStream(
        [{ content: '雷を出して' } as any],
        '',
        'session-projection-effect'
      )
      await expect(readTextStream(stream)).rejects.toThrow(
        'projection_effect_delivery_failed'
      )
      expect(receive).toHaveBeenCalledTimes(1)
    } finally {
      dispose()
      channelHarness.restore()
    }
  })

  it('aborts an in-flight delivery when its public stream is cancelled', async () => {
    jest.useFakeTimers()
    const channelHarness = installProjectionEffectChannel()
    try {
      global.fetch = jest.fn().mockResolvedValue(
        createSseResponse([
          {
            type: 'accepted.presentation.projection_effect_intent',
            data: {
              intent: {
                schemaVersion: 1,
                eventId: 'evt_33333333333333333333333333333333',
                turnId: 'turn_projection_cancelled',
                action: 'reset',
              },
            },
          },
        ])
      ) as any

      const stream = await getThoughtCoreChatResponseStream(
        [{ content: 'リセットして' } as any],
        '',
        'session-projection-effect'
      )
      const reader = stream.getReader()
      await Promise.resolve()
      await expect(reader.cancel()).rejects.toThrow(
        'projection_effect_delivery_failed'
      )
      await jest.runAllTimersAsync()

      expect(channelHarness.getChannelCount()).toBe(0)
      expect(jest.getTimerCount()).toBe(0)
    } finally {
      channelHarness.restore()
      jest.useRealTimers()
    }
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
  })

  it('waits for the Avatar execution receipt before completing a planned response', async () => {
    const channelHarness = installProjectionEffectChannel()
    const received: unknown[] = []
    const lifecycle: string[] = []
    const present = jest.fn(async () => {
      lifecycle.push('present')
    })
    const dispose = subscribeProjectionEffectIntents((intent) => {
      received.push(intent)
      lifecycle.push('receipt')
      publishProjectionEffectExecutionReceipt({
        schemaVersion: 1,
        eventId: intent.eventId,
        status: 'completed',
        resultClass: 'started',
      })
    })
    const plannedIntent = {
      schemaVersion: 2,
      eventId: 'evt_eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
      turnId: 'turn_projection_planned',
      action: 'start',
      plan: {
        schemaVersion: 1,
        planId: 'planv1_0123456789abcdef0123456789abcdef',
        sessionId: 'session_projection_phase1',
        revision: 1,
        action: 'start',
        effectId: 'thunderBall',
        position: { x: 0, y: 0.35 },
        strength: 0.4,
        durationMs: 5_000,
        seed: 42,
        keyframes: [
          { atMs: 0, position: { x: 0, y: 0 }, strength: 0.4 },
          { atMs: 5_000, position: { x: 0, y: 0.35 }, strength: 0.4 },
        ],
      },
    } as const
    ;(global.fetch as jest.Mock).mockResolvedValue(
      createSseResponse([
        {
          type: 'accepted.presentation.assistant_delta',
          data: {
            conversation_attempt_ref: conversationAttemptRef,
            delta: '雷を上へ動かします。',
          },
        },
        {
          type: 'accepted.presentation.projection_effect_intent',
          data: {
            conversation_attempt_ref: conversationAttemptRef,
            intent: plannedIntent,
          },
        },
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
    ).resolves.toBeUndefined()
    expect(received).toEqual([plannedIntent])
    expect(lifecycle).toEqual(['receipt', 'present'])
    expect(present).toHaveBeenCalledTimes(1)
    dispose()
    channelHarness.restore()
  })

  it('fails fixed when Avatar rejects an otherwise valid planned response', async () => {
    const channelHarness = installProjectionEffectChannel()
    const present = jest.fn(async () => {})
    const receive = jest.fn((intent: { eventId: string }) => {
      publishProjectionEffectExecutionReceipt({
        schemaVersion: 1,
        eventId: intent.eventId,
        status: 'rejected',
        resultClass: 'host_rejected',
      })
    })
    const dispose = subscribeProjectionEffectIntents(receive)
    ;(global.fetch as jest.Mock).mockResolvedValue(
      createSseResponse([
        {
          type: 'accepted.presentation.assistant_delta',
          data: {
            conversation_attempt_ref: conversationAttemptRef,
            delta: '炎を出します。',
          },
        },
        {
          type: 'accepted.presentation.projection_effect_intent',
          data: {
            conversation_attempt_ref: conversationAttemptRef,
            intent: {
              schemaVersion: 1,
              eventId: 'evt_ffffffffffffffffffffffffffffffff',
              turnId: 'turn_projection_simple',
              action: 'start',
              effectId: 'fire',
            },
          },
        },
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
    expect(receive).toHaveBeenCalledTimes(1)
    expect(present).not.toHaveBeenCalled()
    dispose()
    channelHarness.restore()
  })

  it('does not present when aborted immediately after the Projection receipt', async () => {
    const channelHarness = installProjectionEffectChannel()
    const controller = new AbortController()
    const present = jest.fn(async () => {})
    const removeEventListener = controller.signal.removeEventListener.bind(
      controller.signal
    )
    const removeAbortListener = jest
      .spyOn(controller.signal, 'removeEventListener')
      .mockImplementation((type, listener, options) => {
        removeEventListener(type, listener, options)
        if (type === 'abort') controller.abort()
      })
    const receive = jest.fn((intent: { eventId: string }) => {
      publishProjectionEffectExecutionReceipt({
        schemaVersion: 1,
        eventId: intent.eventId,
        status: 'completed',
        resultClass: 'started',
      })
    })
    const dispose = subscribeProjectionEffectIntents(receive)
    ;(global.fetch as jest.Mock).mockResolvedValue(
      createSseResponse([
        {
          type: 'accepted.presentation.assistant_delta',
          data: {
            conversation_attempt_ref: conversationAttemptRef,
            delta: '炎を出します。',
          },
        },
        {
          type: 'accepted.presentation.projection_effect_intent',
          data: {
            conversation_attempt_ref: conversationAttemptRef,
            intent: {
              schemaVersion: 1,
              eventId: 'evt_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
              turnId: 'turn_projection_abort_after_receipt',
              action: 'start',
              effectId: 'fire',
            },
          },
        },
        {
          type: 'accepted.presentation.completed',
          data: { conversation_attempt_ref: conversationAttemptRef },
        },
      ])
    )

    try {
      await expect(
        requestAcceptedPreparedSamplePresentation(envelope, present, {
          signal: controller.signal,
          deadlineMs: 30_000,
        })
      ).rejects.toThrow('accepted_prepared_sample_request_failed')
      expect(receive).toHaveBeenCalledTimes(1)
      expect(removeAbortListener).toHaveBeenCalledWith(
        'abort',
        expect.any(Function)
      )
      expect(present).not.toHaveBeenCalled()
    } finally {
      removeAbortListener.mockRestore()
      dispose()
      channelHarness.restore()
    }
  })

  it('waits for a rendered motion lifecycle and a 12-second no-late window', async () => {
    jest.useFakeTimers()
    let handleMotionStimulus: ((event: Event) => void) | undefined
    let motionStimulusDispatchCount = 0
    try {
      const present = jest.fn(async () => {})
      setTimeout(() => {
        ;(window as any).__projectionVisualMotionRuntimeDebugSnapshot = {
          frameSeq: 10,
          vrmReady: true,
          sceneVisible: true,
          session: {
            occupiedSlots: 0,
            queueLength: 0,
            instances: [
              {
                instanceId: 'runtime-instance-previous',
                stimulusId: 'mot_stim_turn_bridge_dance_sequence',
                phase: 'completed',
              },
            ],
          },
          poseFrame: {
            humanoidRotationBoneNames: [],
            humanoidTranslationBoneNames: [],
          },
        }
      }, 100)
      handleMotionStimulus = (event: Event) => {
        motionStimulusDispatchCount += 1
        const stimulus = (event as CustomEvent).detail
        ;(window as any).__projectionVisualMotionRuntimeDebugSnapshot = {
          frameSeq: 12,
          vrmReady: true,
          sceneVisible: true,
          session: {
            occupiedSlots: 1,
            queueLength: 0,
            instances: [
              {
                instanceId: 'runtime-instance-current',
                stimulusId: stimulus.stimulus_id,
                phase: 'active',
              },
            ],
          },
          poseFrame: {
            humanoidRotationBoneNames: ['leftLowerArm'],
            humanoidTranslationBoneNames: [],
          },
        }
        window.dispatchEvent(
          new CustomEvent('projection-visual-motion-stimulus-result', {
            detail: {
              source_kind: 'thought_core_motion_stimulus_v0',
              debug_playback: false,
              accepted: true,
              status: 'started',
              reason_code: 'dance_started',
              safe_visible_state: 'motion_started',
              motion_event_id: stimulus.motion_event_id,
              stimulus_id: stimulus.stimulus_id,
              stimulus_instance_id: stimulus.stimulus_instance_id,
              lifecycle_trace: [],
            },
          })
        )
        setTimeout(() => {
          ;(window as any).__projectionVisualMotionRuntimeDebugSnapshot = {
            frameSeq: 20,
            vrmReady: true,
            sceneVisible: true,
            session: {
              occupiedSlots: 0,
              queueLength: 0,
              instances: [
                {
                  instanceId: 'runtime-instance-current',
                  stimulusId: stimulus.stimulus_id,
                  phase: 'completed',
                },
              ],
            },
            poseFrame: {
              humanoidRotationBoneNames: ['leftLowerArm'],
              humanoidTranslationBoneNames: [],
            },
          }
        }, 200)
      }
      window.addEventListener(
        MOTION_STIMULUS_RECEIVER_EVENT,
        handleMotionStimulus,
        { once: true }
      )
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
      const request = requestAcceptedPreparedSamplePresentation(
        envelope,
        present,
        {
          signal: new AbortController().signal,
          deadlineMs: 75_000,
        }
      )
      let settled = false
      void request.then(
        () => {
          settled = true
        },
        () => {
          settled = true
        }
      )
      await jest.advanceTimersByTimeAsync(99)
      expect(motionStimulusDispatchCount).toBe(0)
      await jest.advanceTimersByTimeAsync(1)
      expect(motionStimulusDispatchCount).toBe(1)
      await jest.advanceTimersByTimeAsync(12_000)
      expect(settled).toBe(false)
      await jest.advanceTimersByTimeAsync(500)
      await expect(request).resolves.toBeUndefined()
    } finally {
      if (handleMotionStimulus) {
        window.removeEventListener(
          MOTION_STIMULUS_RECEIVER_EVENT,
          handleMotionStimulus
        )
      }
      delete (window as any).__projectionVisualMotionRuntimeDebugSnapshot
      jest.useRealTimers()
    }
  })

  it.each([
    ['vrm_not_ready', false, true],
    ['scene_not_visible', true, false],
  ])(
    'does not dispatch while Projection baseline is %s',
    async (_mutation, initialVrmReady, initialSceneVisible) => {
      jest.useFakeTimers()
      const controller = new AbortController()
      let motionStimulusDispatchCount = 0
      const handleMotionStimulus = (event: Event) => {
        motionStimulusDispatchCount += 1
        const stimulus = (event as CustomEvent).detail
        window.dispatchEvent(
          new CustomEvent('projection-visual-motion-stimulus-result', {
            detail: {
              source_kind: 'thought_core_motion_stimulus_v0',
              debug_playback: false,
              accepted: false,
              status: 'failed_safe',
              reason_code: 'bounded_test_result',
              safe_visible_state: 'no_visible_change',
              motion_event_id: stimulus.motion_event_id,
              stimulus_id: stimulus.stimulus_id,
              stimulus_instance_id: stimulus.stimulus_instance_id,
              lifecycle_trace: [],
            },
          })
        )
      }
      try {
        const setBaseline = (vrmReady: boolean, sceneVisible: boolean) => {
          ;(window as any).__projectionVisualMotionRuntimeDebugSnapshot = {
            frameSeq: 10,
            vrmReady,
            sceneVisible,
            session: { occupiedSlots: 0, queueLength: 0, instances: [] },
            poseFrame: {
              humanoidRotationBoneNames: [],
              humanoidTranslationBoneNames: [],
            },
          }
        }
        setBaseline(initialVrmReady, initialSceneVisible)
        window.addEventListener(
          MOTION_STIMULUS_RECEIVER_EVENT,
          handleMotionStimulus,
          { once: true }
        )
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
        const request = expect(
          requestAcceptedPreparedSamplePresentation(
            envelope,
            jest.fn(async () => {}),
            { signal: controller.signal, deadlineMs: 75_000 }
          )
        ).rejects.toThrow('accepted_prepared_sample_request_failed')
        await jest.advanceTimersByTimeAsync(300)
        expect(motionStimulusDispatchCount).toBe(0)
        setBaseline(true, true)
        await jest.advanceTimersByTimeAsync(100)
        expect(motionStimulusDispatchCount).toBe(1)
        await request
      } finally {
        controller.abort()
        window.removeEventListener(
          MOTION_STIMULUS_RECEIVER_EVENT,
          handleMotionStimulus
        )
        delete (window as any).__projectionVisualMotionRuntimeDebugSnapshot
        jest.useRealTimers()
      }
    }
  )

  it.each([
    'missing_baseline',
    'completed_only',
    'mismatched_result',
    'rejected_result',
    'wrong_result_source',
    'debug_playback_result',
    'no_frame_progression',
    'ambiguous_new_instances',
    'late_duplicate_instance',
    'bound_id_stimulus_changed',
    'late_reactivation',
  ])('rejects motion lifecycle mutation %s', async (mutation) => {
    jest.useFakeTimers()
    const controller = new AbortController()
    let handleMotionStimulus: ((event: Event) => void) | undefined
    let motionStimulusDispatchCount = 0
    try {
      const present = jest.fn(async () => {})
      const setSnapshot = (args: {
        frameSeq: number
        phase?: string
        occupiedSlots?: number
        withPose?: boolean
        stimulus?: Record<string, string>
        instanceStimulusId?: string
        duplicatePhase?: string
      }) => {
        const currentInstance =
          args.phase && args.stimulus
            ? {
                instanceId: 'runtime-instance-current',
                stimulusId:
                  args.instanceStimulusId ?? args.stimulus.stimulus_id,
                phase: args.phase,
              }
            : null
        ;(window as any).__projectionVisualMotionRuntimeDebugSnapshot = {
          frameSeq: args.frameSeq,
          vrmReady: true,
          sceneVisible: true,
          session: {
            occupiedSlots: args.occupiedSlots ?? 0,
            queueLength: 0,
            instances:
              currentInstance && args.duplicatePhase
                ? [
                    currentInstance,
                    {
                      instanceId: 'runtime-instance-collision',
                      stimulusId: currentInstance.stimulusId,
                      phase: args.duplicatePhase,
                    },
                  ]
                : currentInstance
                  ? [currentInstance]
                  : [],
          },
          poseFrame: {
            humanoidRotationBoneNames:
              args.withPose === true ? ['leftLowerArm'] : [],
            humanoidTranslationBoneNames: [],
          },
        }
      }
      if (mutation !== 'missing_baseline') setSnapshot({ frameSeq: 10 })
      handleMotionStimulus = (event: Event) => {
        motionStimulusDispatchCount += 1
        const stimulus = (event as CustomEvent).detail as Record<string, string>
        if (mutation === 'completed_only') {
          setSnapshot({
            frameSeq: 12,
            phase: 'completed',
            stimulus,
            withPose: true,
          })
        } else {
          setSnapshot({
            frameSeq: mutation === 'no_frame_progression' ? 10 : 12,
            phase: 'active',
            occupiedSlots: 1,
            stimulus,
            withPose: true,
            duplicatePhase:
              mutation === 'ambiguous_new_instances' ? 'queued' : undefined,
          })
        }
        window.dispatchEvent(
          new CustomEvent('projection-visual-motion-stimulus-result', {
            detail: {
              source_kind:
                mutation === 'wrong_result_source'
                  ? 'untrusted_motion_result'
                  : 'thought_core_motion_stimulus_v0',
              debug_playback: mutation === 'debug_playback_result',
              accepted: mutation !== 'rejected_result',
              status:
                mutation === 'rejected_result' ? 'failed_safe' : 'started',
              reason_code: 'bounded_test_result',
              safe_visible_state:
                mutation === 'rejected_result'
                  ? 'no_visible_change'
                  : 'motion_started',
              motion_event_id:
                mutation === 'mismatched_result'
                  ? `${stimulus.motion_event_id}-changed`
                  : stimulus.motion_event_id,
              stimulus_id: stimulus.stimulus_id,
              stimulus_instance_id: stimulus.stimulus_instance_id,
              lifecycle_trace: [],
            },
          })
        )
        if (
          !['completed_only', 'mismatched_result', 'rejected_result'].includes(
            mutation
          )
        ) {
          setTimeout(() => {
            setSnapshot({
              frameSeq: 20,
              phase: 'completed',
              stimulus,
              withPose: true,
              instanceStimulusId:
                mutation === 'bound_id_stimulus_changed'
                  ? `${stimulus.stimulus_id}-changed`
                  : undefined,
              duplicatePhase:
                mutation === 'late_duplicate_instance'
                  ? 'completed'
                  : undefined,
            })
          }, 200)
        }
        if (mutation === 'late_reactivation') {
          setTimeout(() => {
            setSnapshot({
              frameSeq: 30,
              phase: 'active',
              occupiedSlots: 1,
              stimulus,
              withPose: true,
            })
          }, 1_000)
        }
      }
      window.addEventListener(
        MOTION_STIMULUS_RECEIVER_EVENT,
        handleMotionStimulus,
        { once: true }
      )
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
      setTimeout(() => controller.abort(), 2_000)
      const request = expect(
        requestAcceptedPreparedSamplePresentation(envelope, present, {
          signal: controller.signal,
          deadlineMs: 75_000,
        })
      ).rejects.toThrow('accepted_prepared_sample_request_failed')
      await jest.advanceTimersByTimeAsync(3_000)
      await request
      if (mutation === 'missing_baseline') {
        expect(motionStimulusDispatchCount).toBe(0)
      }
    } finally {
      if (handleMotionStimulus) {
        window.removeEventListener(
          MOTION_STIMULUS_RECEIVER_EVENT,
          handleMotionStimulus
        )
      }
      delete (window as any).__projectionVisualMotionRuntimeDebugSnapshot
      jest.useRealTimers()
    }
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

  it.each(['incomplete_terminal', 'invalid_motion'])(
    'cancels projected EOF mutation %s once with no late effects',
    async (mutation) => {
      const encoder = new TextEncoder()
      const cancel = jest.fn(async () => {})
      const releaseLock = jest.fn()
      const events: unknown[] = [
        {
          type: 'accepted.presentation.assistant_delta',
          data: {
            conversation_attempt_ref: conversationAttemptRef,
            delta: '安全な返答',
          },
        },
        ...(mutation === 'invalid_motion'
          ? [
              {
                type: 'accepted.presentation.motion',
                data: {
                  conversation_attempt_ref: conversationAttemptRef,
                  event: {},
                },
              },
              {
                type: 'accepted.presentation.completed',
                data: { conversation_attempt_ref: conversationAttemptRef },
              },
            ]
          : []),
      ]
      const value = encoder.encode(
        events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('')
      )
      ;(global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        body: {
          getReader: () => ({
            read: jest
              .fn()
              .mockResolvedValueOnce({ done: false, value })
              .mockResolvedValueOnce({ done: true, value: undefined }),
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
          deadlineMs: 75_000,
        })
      ).rejects.toThrow('accepted_prepared_sample_request_failed')
      expect(cancel).toHaveBeenCalledTimes(1)
      expect(releaseLock).toHaveBeenCalledTimes(1)
      expect(present).not.toHaveBeenCalled()
      expect(dispatch).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: MOTION_STIMULUS_RECEIVER_EVENT })
      )
      dispatch.mockRestore()
    }
  )
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

  it('preserves one canonical Thought Core tuple and prepares one display chain across multiple deltas', async () => {
    const originalEnabled =
      process.env.NEXT_PUBLIC_THOUGHT_CORE_CLOSED_LOOP_FEEDBACK_V1_ENABLED
    process.env.NEXT_PUBLIC_THOUGHT_CORE_CLOSED_LOOP_FEEDBACK_V1_ENABLED = '1'
    const onResponseMetadata = jest.fn()
    const feedbackEventIds = ['evt_display_intent', 'evt_display_send']
    ;(global.fetch as jest.Mock).mockImplementation(
      async (input: RequestInfo | URL) => {
        if (String(input) === '/api/thoughtCoreChat/') {
          return createSseResponse([
            {
              type: 'assistant.speech_delta',
              session_id: 'session_canonical_001',
              turn_id: 'turn_canonical_001',
              data: {
                delta: '応答します。',
                conversation_attempt_ref: conversationAttemptRef,
                assistant_message_id: 'msg_canonical_001',
              },
            },
            {
              type: 'assistant.speech_delta',
              session_id: 'session_canonical_001',
              turn_id: 'turn_canonical_001',
              data: {
                delta: '続けます。',
                assistant_message_id: 'msg_canonical_001',
              },
            },
          ])
        }
        return {
          ok: true,
          json: async () => ({
            ok: true,
            event_id: feedbackEventIds.shift(),
          }),
        } as Response
      }
    )

    try {
      const stream = await getThoughtCoreChatResponseStream(
        [{ content: 'こんにちは' } as any],
        '',
        'session-bridge',
        onResponseMetadata
      )
      await expect(readTextStream(stream)).resolves.toBe(
        '応答します。続けます。'
      )
      expect(onResponseMetadata).toHaveBeenCalledTimes(2)
      expect(onResponseMetadata).toHaveBeenNthCalledWith(1, {
        conversationAttemptRef,
        sessionId: 'session_canonical_001',
        turnId: 'turn_canonical_001',
        assistantMessageId: 'msg_canonical_001',
        displayBarrier: {
          sessionId: 'session_canonical_001',
          turnId: 'turn_canonical_001',
          assistantMessageId: 'msg_canonical_001',
          channel: 'display',
          component: 'aituber_message_store',
          sendEventId: 'evt_display_send',
        },
      })
      expect(onResponseMetadata).toHaveBeenNthCalledWith(2, {
        sessionId: 'session_canonical_001',
        turnId: 'turn_canonical_001',
        assistantMessageId: 'msg_canonical_001',
      })
      expect((global.fetch as jest.Mock).mock.calls).toHaveLength(3)
    } finally {
      if (originalEnabled === undefined) {
        delete process.env
          .NEXT_PUBLIC_THOUGHT_CORE_CLOSED_LOOP_FEEDBACK_V1_ENABLED
      } else {
        process.env.NEXT_PUBLIC_THOUGHT_CORE_CLOSED_LOOP_FEEDBACK_V1_ENABLED =
          originalEnabled
      }
    }
  })

  it.each([
    ['session_id', 'session_changed_002'],
    ['turn_id', 'turn_changed_002'],
    ['assistant_message_id', 'msg_changed_002'],
  ] as const)(
    'rejects a later assistant delta whose canonical %s changes without opening another display chain',
    async (changedField, changedValue) => {
      const originalEnabled =
        process.env.NEXT_PUBLIC_THOUGHT_CORE_CLOSED_LOOP_FEEDBACK_V1_ENABLED
      process.env.NEXT_PUBLIC_THOUGHT_CORE_CLOSED_LOOP_FEEDBACK_V1_ENABLED = '1'
      const secondEvent = {
        type: 'assistant.speech_delta',
        session_id: 'session_canonical_001',
        turn_id: 'turn_canonical_001',
        data: {
          delta: '不一致です。',
          assistant_message_id: 'msg_canonical_001',
        },
      }
      if (changedField === 'assistant_message_id') {
        secondEvent.data.assistant_message_id = changedValue
      } else {
        secondEvent[changedField] = changedValue
      }
      const feedbackEventIds = ['evt_display_intent', 'evt_display_send']
      ;(global.fetch as jest.Mock).mockImplementation(
        async (input: RequestInfo | URL) => {
          if (String(input) === '/api/thoughtCoreChat/') {
            return createSseResponse([
              {
                type: 'assistant.speech_delta',
                session_id: 'session_canonical_001',
                turn_id: 'turn_canonical_001',
                data: {
                  delta: '最初です。',
                  assistant_message_id: 'msg_canonical_001',
                },
              },
              secondEvent,
            ])
          }
          return {
            ok: true,
            json: async () => ({
              ok: true,
              event_id: feedbackEventIds.shift(),
            }),
          } as Response
        }
      )

      try {
        const stream = await getThoughtCoreChatResponseStream(
          [{ content: 'こんにちは' } as any],
          '',
          'session-bridge'
        )
        await expect(readTextStream(stream)).rejects.toThrow(
          'closed_loop_output_feedback_failed'
        )
        expect(global.fetch).toHaveBeenCalledTimes(3)
      } finally {
        if (originalEnabled === undefined) {
          delete process.env
            .NEXT_PUBLIC_THOUGHT_CORE_CLOSED_LOOP_FEEDBACK_V1_ENABLED
        } else {
          process.env.NEXT_PUBLIC_THOUGHT_CORE_CLOSED_LOOP_FEEDBACK_V1_ENABLED =
            originalEnabled
        }
      }
    }
  )

  it('fails closed instead of streaming an uncorrelated feedback speech when output feedback is enabled', async () => {
    const originalEnabled =
      process.env.NEXT_PUBLIC_THOUGHT_CORE_CLOSED_LOOP_FEEDBACK_V1_ENABLED
    process.env.NEXT_PUBLIC_THOUGHT_CORE_CLOSED_LOOP_FEEDBACK_V1_ENABLED = '1'
    ;(global.fetch as jest.Mock).mockResolvedValue(
      createSseResponse([
        {
          type: 'feedback.requested',
          data: { speech: 'もう一度確認します' },
        },
      ])
    )

    try {
      const stream = await getThoughtCoreChatResponseStream(
        [{ content: 'こんにちは' } as any],
        '',
        'session-bridge'
      )
      await expect(readTextStream(stream)).rejects.toThrow(
        'closed_loop_output_feedback_failed'
      )
      expect(global.fetch).toHaveBeenCalledTimes(1)
    } finally {
      if (originalEnabled === undefined) {
        delete process.env
          .NEXT_PUBLIC_THOUGHT_CORE_CLOSED_LOOP_FEEDBACK_V1_ENABLED
      } else {
        process.env.NEXT_PUBLIC_THOUGHT_CORE_CLOSED_LOOP_FEEDBACK_V1_ENABLED =
          originalEnabled
      }
    }
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
