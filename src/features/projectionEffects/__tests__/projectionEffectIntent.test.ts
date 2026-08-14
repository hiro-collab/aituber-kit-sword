/**
 * @jest-environment jsdom
 */

import {
  PROJECTION_EFFECT_INTENT_CHANNEL,
  PROJECTION_EFFECT_RECEIPT_WINDOW_EVENT,
  completedProjectionEffectExecutionReceipt,
  deliverProjectionEffectIntent,
  projectionEffectDeliverySucceeded,
  publishProjectionEffectExecutionReceipt,
  publishProjectionEffectIntent,
  readProjectionEffectIntent,
  readProjectionEffectRequestedEvent,
  subscribeProjectionEffectIntentMirror,
  subscribeProjectionEffectIntents,
} from '../projectionEffectIntent'
import { CONTROL_PROJECTION_PERFORMANCE_PLAN_SCHEMA_SHA256 } from '../projectionPerformancePlan'

const EVENT_ID = 'evt_0123456789abcdef0123456789abcdef'
const TURN_ID = 'turn_projection_phase1'
const SESSION_ID = 'session_projection_phase1'

type TestChannel = {
  listeners: Set<(event: MessageEvent) => void>
  closed: boolean
}

function createChannelHarness(
  shouldDrop: (value: unknown) => boolean = () => false
) {
  const channels = new Set<TestChannel>()
  const close = jest.fn()
  const createBroadcastChannel = jest.fn((name: string) => {
    expect(name).toBe(PROJECTION_EFFECT_INTENT_CHANNEL)
    const state: TestChannel = { listeners: new Set(), closed: false }
    channels.add(state)
    return {
      postMessage(value: unknown) {
        if (state.closed || shouldDrop(value)) return
        for (const peer of channels) {
          if (peer === state || peer.closed) continue
          for (const listener of peer.listeners) {
            listener({ data: value } as MessageEvent)
          }
        }
      },
      addEventListener(
        _type: 'message',
        listener: (event: MessageEvent) => void
      ) {
        state.listeners.add(listener)
      },
      removeEventListener(
        _type: 'message',
        listener: (event: MessageEvent) => void
      ) {
        state.listeners.delete(listener)
      },
      close() {
        state.closed = true
        state.listeners.clear()
        channels.delete(state)
        close()
      },
    }
  })
  return { channels, close, createBroadcastChannel }
}

const canonicalEvent = (data: Record<string, unknown>) => ({
  schema_version: 'thought-core.event.v0',
  event_id: EVENT_ID,
  turn_id: TURN_ID,
  session_id: SESSION_ID,
  seq: 3,
  timestamp: '2026-07-23T00:00:00.000Z',
  source: 'thought-core',
  type: 'projection.effect.requested',
  data,
})

const context = {
  expectedTurnId: TURN_ID,
  expectedSessionId: SESSION_ID,
}

const planContext = {
  ...context,
  expectedPerformancePlanSchemaSha256:
    CONTROL_PROJECTION_PERFORMANCE_PLAN_SCHEMA_SHA256,
}

const performancePlan = (overrides: Record<string, unknown> = {}) => ({
  schemaVersion: 1,
  planId: 'planv1_0123456789abcdef0123456789abcdef',
  sessionId: SESSION_ID,
  revision: 1,
  action: 'start',
  effectId: 'fire',
  position: { x: 0.65, y: 0.55 },
  strength: 0.3,
  durationMs: 3_000,
  seed: 42,
  keyframes: [
    {
      atMs: 0,
      position: { x: 0.65, y: 0.55 },
      strength: 0.3,
    },
  ],
  ...overrides,
})

describe('canonical projection effect intent v1', () => {
  it('binds the top-level event identity to one exact Phase1 DTO', () => {
    expect(
      readProjectionEffectRequestedEvent(
        canonicalEvent({
          schemaVersion: 1,
          action: 'start',
          effectId: 'fire',
        }),
        context
      )
    ).toEqual({
      schemaVersion: 1,
      eventId: EVENT_ID,
      turnId: TURN_ID,
      action: 'start',
      effectId: 'fire',
    })
    expect(
      readProjectionEffectRequestedEvent(
        canonicalEvent({ schemaVersion: 1, action: 'stop' }),
        context
      )
    ).toEqual({
      schemaVersion: 1,
      eventId: EVENT_ID,
      turnId: TURN_ID,
      action: 'stop',
    })
    expect(
      readProjectionEffectIntent({
        schemaVersion: 1,
        eventId: EVENT_ID,
        turnId: TURN_ID,
        action: 'reset',
      })
    ).toEqual({
      schemaVersion: 1,
      eventId: EVENT_ID,
      turnId: TURN_ID,
      action: 'reset',
    })
  })

  it.each([
    ['start', 'started', true],
    ['stop', 'stopped', true],
    ['reset', 'reset', true],
    ['start', 'stopped', false],
    ['stop', 'reset', false],
  ] as const)(
    'owns the %s completed-result correlation for every consumer',
    (action, resultClass, expected) => {
      const intent = {
        schemaVersion: 1,
        eventId: EVENT_ID,
        turnId: TURN_ID,
        action,
        ...(action === 'start' ? { effectId: 'fire' as const } : {}),
      } as const

      expect(
        projectionEffectDeliverySucceeded(intent, {
          schemaVersion: 1,
          eventId: EVENT_ID,
          status: 'completed',
          resultClass,
        })
      ).toBe(expected)
      expect(completedProjectionEffectExecutionReceipt(intent)).toEqual({
        schemaVersion: 1,
        eventId: EVENT_ID,
        status: 'completed',
        resultClass:
          action === 'start'
            ? 'started'
            : action === 'stop'
              ? 'stopped'
              : 'reset',
      })
      expect(
        projectionEffectDeliverySucceeded(intent, {
          schemaVersion: 1,
          eventId: 'evt_ffffffffffffffffffffffffffffffff',
          status: 'completed',
          resultClass,
        })
      ).toBe(false)
    }
  )

  it.each([
    ['rejected', 'host_rejected'],
    ['cleanup_unproved', 'cleanup_unproved'],
  ] as const)(
    'does not promote a %s receipt to a completed effect',
    (status, resultClass) => {
      expect(
        projectionEffectDeliverySucceeded(
          {
            schemaVersion: 1,
            eventId: EVENT_ID,
            turnId: TURN_ID,
            action: 'start',
            effectId: 'fire',
          },
          {
            schemaVersion: 1,
            eventId: EVENT_ID,
            status,
            resultClass,
          }
        )
      ).toBe(false)
    }
  )

  it('projects one exact text-free v2 plan from the canonical envelope', () => {
    const event = canonicalEvent({
      schemaVersion: 2,
      action: 'start',
      plan: performancePlan({
        effectId: 'thunderBall',
        position: { x: 0, y: 0.3 },
        strength: 0.25,
        durationMs: 5_000,
        keyframes: [
          {
            atMs: 0,
            position: { x: 0, y: 0 },
            strength: 0.25,
          },
          {
            atMs: 5_000,
            position: { x: 0, y: 0.3 },
            strength: 0.25,
          },
        ],
      }),
    })
    const projected = readProjectionEffectRequestedEvent(event, planContext)

    expect(projected).toEqual({
      schemaVersion: 2,
      eventId: EVENT_ID,
      turnId: TURN_ID,
      action: 'start',
      plan: performancePlan({
        effectId: 'thunderBall',
        position: { x: 0, y: 0.3 },
        strength: 0.25,
        durationMs: 5_000,
        keyframes: [
          {
            atMs: 0,
            position: { x: 0, y: 0 },
            strength: 0.25,
          },
          {
            atMs: 5_000,
            position: { x: 0, y: 0.3 },
            strength: 0.25,
          },
        ],
      }),
    })
    expect(readProjectionEffectIntent(projected)).toEqual(projected)
    expect(completedProjectionEffectExecutionReceipt(projected)).toEqual({
      schemaVersion: 1,
      eventId: EVENT_ID,
      status: 'completed',
      resultClass: 'started',
    })
    expect(JSON.stringify(projected)).not.toContain('raw')
    expect(JSON.stringify(projected)).not.toContain('PRIVATE')
  })

  it.each([
    [
      'missing schema digest',
      canonicalEvent({
        schemaVersion: 2,
        action: 'start',
        plan: performancePlan(),
      }),
      context,
    ],
    [
      'schema digest mismatch',
      canonicalEvent({
        schemaVersion: 2,
        action: 'start',
        plan: performancePlan(),
      }),
      {
        ...context,
        expectedPerformancePlanSchemaSha256: '0'.repeat(64),
      },
    ],
    [
      'session mismatch',
      canonicalEvent({
        schemaVersion: 2,
        action: 'start',
        plan: performancePlan({ sessionId: 'other_session' }),
      }),
      planContext,
    ],
    [
      'duplicated effect id',
      canonicalEvent({
        schemaVersion: 2,
        action: 'start',
        effectId: 'fire',
        plan: performancePlan(),
      }),
      planContext,
    ],
    [
      'v2 stop',
      canonicalEvent({
        schemaVersion: 2,
        action: 'stop',
        plan: performancePlan(),
      }),
      planContext,
    ],
    [
      'v2 private extra',
      canonicalEvent({
        schemaVersion: 2,
        action: 'start',
        plan: { ...performancePlan(), rawPrompt: 'PRIVATE_PLAN_MARKER' },
      }),
      planContext,
    ],
  ])('rejects %s', (_label, event, candidateContext) => {
    expect(
      readProjectionEffectRequestedEvent(event, candidateContext)
    ).toBeNull()
  })

  it.each([
    [
      'legacy type',
      {
        ...canonicalEvent({ schemaVersion: 1, action: 'reset' }),
        type: 'projection_effect.intent',
      },
    ],
    [
      'event id mismatch',
      {
        ...canonicalEvent({ schemaVersion: 1, action: 'reset' }),
        event_id: 'intent.private',
      },
    ],
    [
      'turn mismatch',
      {
        ...canonicalEvent({ schemaVersion: 1, action: 'reset' }),
        turn_id: 'other_turn',
      },
    ],
    [
      'session mismatch',
      {
        ...canonicalEvent({ schemaVersion: 1, action: 'reset' }),
        session_id: 'other_session',
      },
    ],
    [
      'source mismatch',
      {
        ...canonicalEvent({ schemaVersion: 1, action: 'reset' }),
        source: 'provider-child',
      },
    ],
    [
      'top-level extra',
      {
        ...canonicalEvent({ schemaVersion: 1, action: 'reset' }),
        private_path: 'C:/private',
      },
    ],
    [
      'payload extra',
      canonicalEvent({
        schemaVersion: 1,
        action: 'reset',
        raw_prompt: 'private',
      }),
    ],
    [
      'Phase2 action',
      canonicalEvent({ schemaVersion: 1, action: 'update', effectId: 'fire' }),
    ],
    [
      'unknown effect',
      canonicalEvent({ schemaVersion: 1, action: 'start', effectId: 'portal' }),
    ],
  ])('rejects %s', (_label, event) => {
    expect(readProjectionEffectRequestedEvent(event, context)).toBeNull()
  })

  it('reports ready only after owning a cross-tab channel and rejects receiver overlap', () => {
    const harness = createChannelHarness()
    const states: string[] = []
    const receive = jest.fn()
    const subscription = subscribeProjectionEffectIntents(receive, {
      createBroadcastChannel: harness.createBroadcastChannel,
      onReceiverStateChange: (state) => states.push(state),
    })

    expect(subscription.getState()).toBe('ready')
    expect(states).toEqual(['ready'])
    expect(harness.channels.size).toBe(1)

    const conflictStates: string[] = []
    const conflict = subscribeProjectionEffectIntents(jest.fn(), {
      createBroadcastChannel: harness.createBroadcastChannel,
      onReceiverStateChange: (state) => conflictStates.push(state),
    })
    expect(conflict.getState()).toBe('receiver-conflict')
    expect(conflictStates).toEqual(['receiver-conflict'])
    expect(harness.channels.size).toBe(1)

    conflict()
    expect(conflict.getState()).toBe('disposed')
    expect(conflictStates).toEqual(['receiver-conflict', 'disposed'])
    subscription()
    expect(subscription.getState()).toBe('disposed')
    expect(states).toEqual(['ready', 'disposed'])
    expect(harness.channels.size).toBe(0)
  })

  it('keeps a mirror silent when no authoritative receiver is ready', async () => {
    const harness = createChannelHarness()
    const receive = jest.fn()
    const states: string[] = []
    const mirror = subscribeProjectionEffectIntentMirror(receive, {
      createBroadcastChannel: harness.createBroadcastChannel,
      onMirrorStateChange: (state) => states.push(state),
    })

    const result = await deliverProjectionEffectIntent(
      {
        schemaVersion: 1,
        eventId: EVENT_ID,
        turnId: TURN_ID,
        action: 'start',
        effectId: 'fire',
      },
      { createBroadcastChannel: harness.createBroadcastChannel }
    )

    expect(result).toEqual({
      schemaVersion: 1,
      eventId: EVENT_ID,
      status: 'rejected',
      resultClass: 'receiver_unavailable',
    })
    expect(receive).not.toHaveBeenCalled()
    expect(states).toEqual(['mirror-ready'])
    mirror()
    expect(states).toEqual(['mirror-ready', 'disposed'])
  })

  it.each([
    [
      'start',
      { action: 'start', effectId: 'fire' },
      { status: 'completed', resultClass: 'started' },
    ],
    [
      'stop',
      { action: 'stop' },
      { status: 'completed', resultClass: 'stopped' },
    ],
    [
      'reset',
      { action: 'reset' },
      { status: 'completed', resultClass: 'reset' },
    ],
  ])(
    'mirrors one correlated completed %s without becoming a receipt owner',
    async (_label, intentFields, receiptFields) => {
      const harness = createChannelHarness()
      const receive = jest.fn()
      const mirror = subscribeProjectionEffectIntentMirror(receive, {
        createBroadcastChannel: harness.createBroadcastChannel,
      })
      const receiver = subscribeProjectionEffectIntents(
        (intent) => {
          publishProjectionEffectExecutionReceipt({
            schemaVersion: 1,
            eventId: intent.eventId,
            status: receiptFields.status as 'completed',
            resultClass: receiptFields.resultClass as
              | 'started'
              | 'stopped'
              | 'reset',
          })
        },
        { createBroadcastChannel: harness.createBroadcastChannel }
      )
      const intent = {
        schemaVersion: 1,
        eventId: EVENT_ID,
        turnId: TURN_ID,
        ...intentFields,
      }

      const result = await deliverProjectionEffectIntent(intent, {
        createBroadcastChannel: harness.createBroadcastChannel,
      })

      expect(result).toEqual({
        schemaVersion: 1,
        eventId: EVENT_ID,
        ...receiptFields,
      })
      expect(receive).toHaveBeenCalledTimes(1)
      expect(receive).toHaveBeenCalledWith(intent)
      receiver()
      mirror()
    }
  )

  it.each([
    ['rejected', { status: 'rejected', resultClass: 'host_rejected' }],
    ['action-mismatched', { status: 'completed', resultClass: 'stopped' }],
  ] as const)(
    'does not mirror a %s authoritative receipt',
    async (_label, receiptFields) => {
      const harness = createChannelHarness()
      const receive = jest.fn()
      const mirror = subscribeProjectionEffectIntentMirror(receive, {
        createBroadcastChannel: harness.createBroadcastChannel,
      })
      const receiver = subscribeProjectionEffectIntents(
        (intent) => {
          publishProjectionEffectExecutionReceipt({
            schemaVersion: 1,
            eventId: intent.eventId,
            ...receiptFields,
          })
        },
        { createBroadcastChannel: harness.createBroadcastChannel }
      )

      const result = await deliverProjectionEffectIntent(
        {
          schemaVersion: 1,
          eventId: EVENT_ID,
          turnId: TURN_ID,
          action: 'start',
          effectId: 'fire',
        },
        { createBroadcastChannel: harness.createBroadcastChannel }
      )

      expect(result).toMatchObject({ eventId: EVENT_ID, ...receiptFields })
      expect(receive).not.toHaveBeenCalled()
      receiver()
      mirror()
    }
  )

  it('pairs a completed receipt that arrives before its correlated intent', () => {
    const harness = createChannelHarness()
    const receive = jest.fn()
    const mirror = subscribeProjectionEffectIntentMirror(receive, {
      createBroadcastChannel: harness.createBroadcastChannel,
    })
    const peer = harness.createBroadcastChannel(
      PROJECTION_EFFECT_INTENT_CHANNEL
    )
    const intent = {
      schemaVersion: 1,
      eventId: EVENT_ID,
      turnId: TURN_ID,
      action: 'start',
      effectId: 'fire',
    } as const

    peer.postMessage({
      schemaVersion: 1,
      kind: 'receipt',
      origin: window.location.origin,
      receipt: {
        schemaVersion: 1,
        eventId: EVENT_ID,
        status: 'completed',
        resultClass: 'started',
      },
    })
    expect(receive).not.toHaveBeenCalled()
    window.dispatchEvent(
      new CustomEvent('sword:projection-effect-intent-v1', { detail: intent })
    )

    expect(receive).toHaveBeenCalledTimes(1)
    expect(receive).toHaveBeenCalledWith(intent)
    peer.close()
    mirror()
  })

  it.each([
    ['missing cross-tab channel', () => null as never],
    [
      'throwing cross-tab constructor',
      () => {
        throw new Error('PRIVATE_CROSS_TAB_CONSTRUCTOR_DETAIL')
      },
    ],
  ])('fails closed with a fixed state for %s', (_label, createChannel) => {
    const states: string[] = []
    const receive = jest.fn()
    const subscription = subscribeProjectionEffectIntents(receive, {
      createBroadcastChannel: createChannel,
      onReceiverStateChange: (state) => states.push(state),
    })

    expect(subscription.getState()).toBe('cross-tab-unavailable')
    expect(states).toEqual(['cross-tab-unavailable'])
    window.dispatchEvent(
      new CustomEvent('sword:projection-effect-intent-v1', {
        detail: {
          schemaVersion: 1,
          eventId: EVENT_ID,
          turnId: TURN_ID,
          action: 'reset',
        },
      })
    )
    expect(receive).not.toHaveBeenCalled()
    expect(
      publishProjectionEffectExecutionReceipt({
        schemaVersion: 1,
        eventId: EVENT_ID,
        status: 'completed',
        resultClass: 'started',
      })
    ).toBe(false)
    expect(JSON.stringify(states)).not.toContain('PRIVATE_')

    subscription()
    expect(subscription.getState()).toBe('disposed')
    expect(states).toEqual(['cross-tab-unavailable', 'disposed'])
  })

  it('deduplicates same-window and same-origin channel delivery and rejects collisions', () => {
    const listeners = new Set<(event: MessageEvent) => void>()
    const close = jest.fn()
    const createBroadcastChannel = jest.fn((name: string) => {
      expect(name).toBe(PROJECTION_EFFECT_INTENT_CHANNEL)
      return {
        postMessage(value: unknown) {
          for (const listener of listeners) {
            listener({ data: value } as MessageEvent)
          }
        },
        addEventListener(
          _type: 'message',
          listener: (event: MessageEvent) => void
        ) {
          listeners.add(listener)
        },
        removeEventListener(
          _type: 'message',
          listener: (event: MessageEvent) => void
        ) {
          listeners.delete(listener)
        },
        close,
      }
    })
    const receive = jest.fn()
    const dispose = subscribeProjectionEffectIntents(receive, {
      createBroadcastChannel,
    })
    const intent = {
      schemaVersion: 1,
      eventId: EVENT_ID,
      turnId: TURN_ID,
      action: 'start',
      effectId: 'thunderBall',
    } as const

    expect(
      publishProjectionEffectIntent(intent, { createBroadcastChannel })
    ).toEqual({
      schemaVersion: 1,
      eventId: EVENT_ID,
      status: 'published',
      resultClass: 'published',
    })
    expect(receive).toHaveBeenCalledTimes(1)

    window.dispatchEvent(
      new CustomEvent('sword:projection-effect-intent-v1', {
        detail: { ...intent, action: 'reset', effectId: undefined },
      })
    )
    expect(receive).toHaveBeenCalledTimes(1)

    for (const listener of listeners) {
      listener({
        data: {
          schemaVersion: 1,
          kind: 'intent',
          origin: 'https://foreign.invalid',
          intent: {
            ...intent,
            eventId: 'evt_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          },
        },
      } as MessageEvent)
    }
    expect(receive).toHaveBeenCalledTimes(1)

    dispose()
    expect(listeners.size).toBe(0)
    expect(close).toHaveBeenCalled()
  })

  it('deduplicates a v2 plan across both transports and rejects an ID collision', () => {
    const listeners = new Set<(event: MessageEvent) => void>()
    const createBroadcastChannel = () => ({
      postMessage(value: unknown) {
        for (const listener of listeners) {
          listener({ data: value } as MessageEvent)
        }
      },
      addEventListener(
        _type: 'message',
        listener: (event: MessageEvent) => void
      ) {
        listeners.add(listener)
      },
      removeEventListener(
        _type: 'message',
        listener: (event: MessageEvent) => void
      ) {
        listeners.delete(listener)
      },
      close() {},
    })
    const receive = jest.fn()
    const dispose = subscribeProjectionEffectIntents(receive, {
      createBroadcastChannel,
    })
    const intent = {
      schemaVersion: 2,
      eventId: EVENT_ID,
      turnId: TURN_ID,
      action: 'start',
      plan: performancePlan(),
    } as const

    expect(
      publishProjectionEffectIntent(intent, { createBroadcastChannel })
    ).toMatchObject({ status: 'published', eventId: EVENT_ID })
    expect(receive).toHaveBeenCalledTimes(1)
    window.dispatchEvent(
      new CustomEvent('sword:projection-effect-intent-v1', {
        detail: {
          ...intent,
          plan: performancePlan({ strength: 0.9 }),
        },
      })
    )
    expect(receive).toHaveBeenCalledTimes(1)
    dispose()
    expect(listeners.size).toBe(0)
  })

  it('quarantines a partially registered receiver without exposing native setup failures', () => {
    const privateMarker = 'PRIVATE_RECEIVER_SETUP_DETAIL'
    const receive = jest.fn()
    const postMessage = jest.fn()
    const removeChannelListener = jest.fn()
    const close = jest.fn()
    let channelListener: ((event: MessageEvent) => void) | undefined
    const removeWindowListener = jest.spyOn(window, 'removeEventListener')
    try {
      let dispose:
        | ReturnType<typeof subscribeProjectionEffectIntents>
        | undefined
      expect(() => {
        dispose = subscribeProjectionEffectIntents(receive, {
          createBroadcastChannel: () => ({
            postMessage,
            addEventListener(_type, listener) {
              channelListener = listener
              throw new Error(privateMarker)
            },
            removeEventListener: removeChannelListener,
            close,
          }),
        })
      }).not.toThrow()

      expect(dispose?.getState()).toBe('cross-tab-unavailable')
      expect(removeWindowListener).not.toHaveBeenCalled()
      expect(removeChannelListener).toHaveBeenCalledWith(
        'message',
        channelListener
      )
      expect(close).toHaveBeenCalledTimes(1)
      expect(
        publishProjectionEffectExecutionReceipt({
          schemaVersion: 1,
          eventId: EVENT_ID,
          status: 'completed',
          resultClass: 'started',
        })
      ).toBe(false)
      window.dispatchEvent(
        new CustomEvent('sword:projection-effect-intent-v1', {
          detail: {
            schemaVersion: 1,
            eventId: EVENT_ID,
            turnId: TURN_ID,
            action: 'reset',
          },
        })
      )
      channelListener?.({
        data: {
          schemaVersion: 1,
          kind: 'probe',
          origin: window.location.origin,
          eventId: EVENT_ID,
        },
      } as MessageEvent)
      expect(receive).not.toHaveBeenCalled()
      expect(postMessage).not.toHaveBeenCalled()
      expect(() => dispose?.()).not.toThrow()
      expect(dispose?.getState()).toBe('disposed')
    } finally {
      removeWindowListener.mockRestore()
    }
  })

  it('attempts every receiver cleanup independently and leaves late handlers inert', () => {
    const privateMarker = 'PRIVATE_RECEIVER_TEARDOWN_DETAIL'
    const receive = jest.fn()
    const postMessage = jest.fn()
    const removeChannelListener = jest.fn(() => {
      throw new Error(privateMarker)
    })
    const close = jest.fn(() => {
      throw new Error(privateMarker)
    })
    let channelListener: ((event: MessageEvent) => void) | undefined
    const originalRemoveWindowListener = window.removeEventListener.bind(window)
    const removeWindowListener = jest
      .spyOn(window, 'removeEventListener')
      .mockImplementation(((
        ...args: Parameters<typeof window.removeEventListener>
      ) => {
        originalRemoveWindowListener(...args)
        throw new Error(privateMarker)
      }) as typeof window.removeEventListener)
    try {
      const dispose = subscribeProjectionEffectIntents(receive, {
        createBroadcastChannel: () => ({
          postMessage,
          addEventListener(_type, listener) {
            channelListener = listener
          },
          removeEventListener: removeChannelListener,
          close,
        }),
      })

      expect(() => dispose()).not.toThrow()
      expect(removeWindowListener).toHaveBeenCalled()
      expect(removeChannelListener).toHaveBeenCalledWith(
        'message',
        channelListener
      )
      expect(close).toHaveBeenCalledTimes(1)
      channelListener?.({
        data: {
          schemaVersion: 1,
          kind: 'probe',
          origin: window.location.origin,
          eventId: EVENT_ID,
        },
      } as MessageEvent)
      channelListener?.({
        data: {
          schemaVersion: 1,
          kind: 'intent',
          origin: window.location.origin,
          intent: {
            schemaVersion: 1,
            eventId: EVENT_ID,
            turnId: TURN_ID,
            action: 'reset',
          },
        },
      } as MessageEvent)
      expect(receive).not.toHaveBeenCalled()
      expect(postMessage).not.toHaveBeenCalled()
      expect(() => dispose()).not.toThrow()
      expect(
        publishProjectionEffectExecutionReceipt({
          schemaVersion: 1,
          eventId: EVENT_ID,
          status: 'completed',
          resultClass: 'started',
        })
      ).toBe(false)
      expect(close).toHaveBeenCalledTimes(1)
    } finally {
      removeWindowListener.mockRestore()
    }
  })

  it('fails closed at the live reservation cap and permits only expired IDs', () => {
    let timestamp = 0
    const receive = jest.fn()
    const dispose = subscribeProjectionEffectIntents(receive, {
      now: () => timestamp,
      createBroadcastChannel: () => ({
        postMessage() {},
        addEventListener() {},
        removeEventListener() {},
        close() {},
      }),
    })
    for (let index = 0; index < 256; index += 1) {
      window.dispatchEvent(
        new CustomEvent('sword:projection-effect-intent-v1', {
          detail: {
            schemaVersion: 1,
            eventId: `evt_${index.toString(16).padStart(32, '0')}`,
            turnId: TURN_ID,
            action: 'reset',
          },
        })
      )
    }
    expect(receive).toHaveBeenCalledTimes(256)

    window.dispatchEvent(
      new CustomEvent('sword:projection-effect-intent-v1', {
        detail: {
          schemaVersion: 1,
          eventId: `evt_${(256).toString(16).padStart(32, '0')}`,
          turnId: TURN_ID,
          action: 'reset',
        },
      })
    )
    window.dispatchEvent(
      new CustomEvent('sword:projection-effect-intent-v1', {
        detail: {
          schemaVersion: 1,
          eventId: `evt_${(0).toString(16).padStart(32, '0')}`,
          turnId: TURN_ID,
          action: 'reset',
        },
      })
    )
    expect(receive).toHaveBeenCalledTimes(256)

    timestamp = 5 * 60 * 1000 + 1
    window.dispatchEvent(
      new CustomEvent('sword:projection-effect-intent-v1', {
        detail: {
          schemaVersion: 1,
          eventId: `evt_${(0).toString(16).padStart(32, '0')}`,
          turnId: TURN_ID,
          action: 'reset',
        },
      })
    )
    expect(receive).toHaveBeenCalledTimes(257)
    dispose()
  })

  it('waits for a fresh receiver, ingress acknowledgement, and matching execution receipt', async () => {
    const harness = createChannelHarness()
    const receive = jest.fn((intent: { eventId: string }) => {
      publishProjectionEffectExecutionReceipt(
        {
          schemaVersion: 1,
          eventId: intent.eventId,
          status: 'completed',
          resultClass: 'started',
        },
        { createBroadcastChannel: harness.createBroadcastChannel }
      )
    })
    const dispose = subscribeProjectionEffectIntents(receive, {
      createBroadcastChannel: harness.createBroadcastChannel,
    })
    const intent = {
      schemaVersion: 2,
      eventId: EVENT_ID,
      turnId: TURN_ID,
      action: 'start',
      plan: performancePlan(),
    } as const

    await expect(
      deliverProjectionEffectIntent(intent, {
        createBroadcastChannel: harness.createBroadcastChannel,
      })
    ).resolves.toEqual({
      schemaVersion: 1,
      eventId: EVENT_ID,
      status: 'completed',
      resultClass: 'started',
    })
    expect(receive).toHaveBeenCalledTimes(1)
    dispose()
    expect(harness.channels.size).toBe(0)
  })

  it('fails closed when no receiver becomes ready', async () => {
    jest.useFakeTimers()
    try {
      const harness = createChannelHarness()
      const delivery = deliverProjectionEffectIntent(
        {
          schemaVersion: 1,
          eventId: EVENT_ID,
          turnId: TURN_ID,
          action: 'reset',
        },
        { createBroadcastChannel: harness.createBroadcastChannel }
      )
      await jest.advanceTimersByTimeAsync(501)
      await expect(delivery).resolves.toMatchObject({
        status: 'rejected',
        resultClass: 'receiver_unavailable',
      })
      expect(harness.channels.size).toBe(0)
    } finally {
      jest.useRealTimers()
    }
  })

  it('collapses transport setup failures to fixed non-echoing delivery results', async () => {
    const privateMarker = 'PRIVATE_TRANSPORT_SETUP_DETAIL'
    const intent = {
      schemaVersion: 1,
      eventId: EVENT_ID,
      turnId: TURN_ID,
      action: 'reset',
    } as const
    const close = jest.fn()

    const constructorFailure = await deliverProjectionEffectIntent(intent, {
      createBroadcastChannel() {
        throw new Error(privateMarker)
      },
    })
    const listenerFailure = await deliverProjectionEffectIntent(intent, {
      createBroadcastChannel: () => ({
        postMessage() {},
        addEventListener() {
          throw new Error(privateMarker)
        },
        removeEventListener() {},
        close,
      }),
    })

    expect(constructorFailure).toMatchObject({
      status: 'rejected',
      resultClass: 'transport_unavailable',
    })
    expect(listenerFailure).toMatchObject({
      status: 'rejected',
      resultClass: 'delivery_unconfirmed',
    })
    expect(close).toHaveBeenCalledTimes(1)
    expect(
      JSON.stringify({ constructorFailure, listenerFailure })
    ).not.toContain(privateMarker)
  })

  it('does not report success when transport teardown is unproved', async () => {
    const privateMarker = 'PRIVATE_TRANSPORT_CLOSE_DETAIL'
    const harness = createChannelHarness()
    let channelCount = 0
    const createBroadcastChannel = (name: string) => {
      const channel = harness.createBroadcastChannel(name)
      channelCount += 1
      if (channelCount !== 2) return channel
      return {
        ...channel,
        close() {
          channel.close()
          throw new Error(privateMarker)
        },
      }
    }
    const receive = jest.fn((intent: { eventId: string }) => {
      publishProjectionEffectExecutionReceipt(
        {
          schemaVersion: 1,
          eventId: intent.eventId,
          status: 'completed',
          resultClass: 'started',
        },
        { createBroadcastChannel }
      )
    })
    const dispose = subscribeProjectionEffectIntents(receive, {
      createBroadcastChannel,
    })

    const result = await deliverProjectionEffectIntent(
      {
        schemaVersion: 1,
        eventId: EVENT_ID,
        turnId: TURN_ID,
        action: 'start',
        effectId: 'fire',
      },
      { createBroadcastChannel }
    )

    expect(result).toMatchObject({
      status: 'rejected',
      resultClass: 'delivery_unconfirmed',
    })
    expect(JSON.stringify(result)).not.toContain(privateMarker)
    expect(receive).toHaveBeenCalledTimes(1)
    dispose()
    expect(harness.channels.size).toBe(0)
  })

  it.each([
    ['first intent', 'intent'],
    ['first ingress acknowledgement', 'intent_ack'],
  ])(
    'retries a dropped %s with the same ID but invokes the receiver once',
    async (_label, droppedKind) => {
      let dropped = false
      const harness = createChannelHarness((value) => {
        const kind =
          typeof value === 'object' && value !== null
            ? (value as { kind?: unknown }).kind
            : null
        if (!dropped && kind === droppedKind) {
          dropped = true
          return true
        }
        return false
      })
      const receive = jest.fn((intent: { eventId: string }) => {
        publishProjectionEffectExecutionReceipt(
          {
            schemaVersion: 1,
            eventId: intent.eventId,
            status: 'completed',
            resultClass: 'started',
          },
          { createBroadcastChannel: harness.createBroadcastChannel }
        )
      })
      const dispose = subscribeProjectionEffectIntents(receive, {
        createBroadcastChannel: harness.createBroadcastChannel,
      })

      await expect(
        deliverProjectionEffectIntent(
          {
            schemaVersion: 1,
            eventId: EVENT_ID,
            turnId: TURN_ID,
            action: 'start',
            effectId: 'fire',
          },
          { createBroadcastChannel: harness.createBroadcastChannel }
        )
      ).resolves.toMatchObject({
        status: 'completed',
        resultClass: 'started',
      })
      expect(dropped).toBe(true)
      expect(receive).toHaveBeenCalledTimes(1)
      dispose()
    }
  )

  it('never redispatches a duplicate and never acknowledges an ID collision', async () => {
    jest.useFakeTimers()
    try {
      const harness = createChannelHarness()
      const receive = jest.fn((intent: { eventId: string }) => {
        publishProjectionEffectExecutionReceipt(
          {
            schemaVersion: 1,
            eventId: intent.eventId,
            status: 'completed',
            resultClass: 'started',
          },
          { createBroadcastChannel: harness.createBroadcastChannel }
        )
      })
      const dispose = subscribeProjectionEffectIntents(receive, {
        createBroadcastChannel: harness.createBroadcastChannel,
      })
      const intent = {
        schemaVersion: 1,
        eventId: EVENT_ID,
        turnId: TURN_ID,
        action: 'start',
        effectId: 'fire',
      } as const
      await deliverProjectionEffectIntent(intent, {
        createBroadcastChannel: harness.createBroadcastChannel,
      })

      const duplicate = deliverProjectionEffectIntent(intent, {
        createBroadcastChannel: harness.createBroadcastChannel,
      })
      await jest.advanceTimersByTimeAsync(1_501)
      await expect(duplicate).resolves.toMatchObject({
        status: 'rejected',
        resultClass: 'delivery_unconfirmed',
      })
      const collision = deliverProjectionEffectIntent(
        { ...intent, effectId: 'thunderBall' },
        { createBroadcastChannel: harness.createBroadcastChannel }
      )
      await jest.advanceTimersByTimeAsync(501)
      await expect(collision).resolves.toMatchObject({
        status: 'rejected',
        resultClass: 'delivery_unconfirmed',
      })
      expect(receive).toHaveBeenCalledTimes(1)
      dispose()
    } finally {
      jest.useRealTimers()
    }
  })

  it.each([
    ['host rejection', 'rejected', 'host_rejected'],
    ['cleanup uncertainty', 'cleanup_unproved', 'cleanup_unproved'],
  ] as const)(
    'returns the fixed %s receipt without retrying the receiver',
    async (_label, status, resultClass) => {
      const harness = createChannelHarness()
      const receive = jest.fn((intent: { eventId: string }) => {
        publishProjectionEffectExecutionReceipt(
          {
            schemaVersion: 1,
            eventId: intent.eventId,
            status,
            resultClass,
          },
          { createBroadcastChannel: harness.createBroadcastChannel }
        )
      })
      const dispose = subscribeProjectionEffectIntents(receive, {
        createBroadcastChannel: harness.createBroadcastChannel,
      })
      await expect(
        deliverProjectionEffectIntent(
          {
            schemaVersion: 1,
            eventId: EVENT_ID,
            turnId: TURN_ID,
            action: 'start',
            effectId: 'thunderBall',
          },
          { createBroadcastChannel: harness.createBroadcastChannel }
        )
      ).resolves.toMatchObject({ status, resultClass })
      expect(receive).toHaveBeenCalledTimes(1)
      dispose()
    }
  )

  it('fails after an ingress acknowledgement without execution and cancels on abort', async () => {
    jest.useFakeTimers()
    try {
      const harness = createChannelHarness()
      const receive = jest.fn()
      const dispose = subscribeProjectionEffectIntents(receive, {
        createBroadcastChannel: harness.createBroadcastChannel,
      })
      const intent = {
        schemaVersion: 1,
        eventId: EVENT_ID,
        turnId: TURN_ID,
        action: 'reset',
      } as const
      const delivery = deliverProjectionEffectIntent(intent, {
        createBroadcastChannel: harness.createBroadcastChannel,
      })
      await jest.advanceTimersByTimeAsync(1_501)
      await expect(delivery).resolves.toMatchObject({
        status: 'rejected',
        resultClass: 'delivery_unconfirmed',
      })
      expect(receive).toHaveBeenCalledTimes(1)

      const controller = new AbortController()
      const aborted = deliverProjectionEffectIntent(
        { ...intent, eventId: 'evt_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
        {
          createBroadcastChannel: harness.createBroadcastChannel,
          signal: controller.signal,
        }
      )
      controller.abort()
      await expect(aborted).resolves.toMatchObject({
        status: 'rejected',
        resultClass: 'delivery_aborted',
      })
      dispose()
      const lateSender = harness.createBroadcastChannel(
        PROJECTION_EFFECT_INTENT_CHANNEL
      )
      lateSender.postMessage({
        schemaVersion: 1,
        kind: 'intent',
        origin: window.location.origin,
        intent: {
          ...intent,
          eventId: 'evt_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        },
      })
      expect(receive).toHaveBeenCalledTimes(1)
      lateSender.close()
      expect(harness.channels.size).toBe(0)
      expect(jest.getTimerCount()).toBe(0)
    } finally {
      jest.useRealTimers()
    }
  })

  it('publishes a fixed execution receipt through the active receiver-owned channel only', () => {
    const harness = createChannelHarness()
    const receipts: unknown[] = []
    const peerReceipts: unknown[] = []
    const listener = (event: Event) => {
      if (event instanceof CustomEvent) receipts.push(event.detail)
    }
    const dispose = subscribeProjectionEffectIntents(jest.fn(), {
      createBroadcastChannel: harness.createBroadcastChannel,
    })
    const secondReceive = jest.fn()
    const disposeSecond = subscribeProjectionEffectIntents(secondReceive, {
      createBroadcastChannel: harness.createBroadcastChannel,
    })
    expect(harness.createBroadcastChannel).toHaveBeenCalledTimes(1)
    const peer = harness.createBroadcastChannel(
      PROJECTION_EFFECT_INTENT_CHANNEL
    )
    peer.addEventListener('message', (event) => {
      const value = event.data as { kind?: unknown; receipt?: unknown }
      if (value.kind === 'receipt') peerReceipts.push(value.receipt)
    })
    const perReceiptChannel = jest.fn(() => {
      throw new Error('PRIVATE_PER_RECEIPT_CHANNEL')
    })
    window.addEventListener(PROJECTION_EFFECT_RECEIPT_WINDOW_EVENT, listener)
    try {
      const receipt = {
        schemaVersion: 1,
        eventId: EVENT_ID,
        status: 'completed',
        resultClass: 'started',
      } as const
      expect(
        publishProjectionEffectExecutionReceipt(receipt, {
          createBroadcastChannel: perReceiptChannel,
        })
      ).toBe(true)
      expect(perReceiptChannel).not.toHaveBeenCalled()
      expect(peerReceipts).toEqual([receipt])
      expect(receipts).toEqual([receipt])
      expect(secondReceive).not.toHaveBeenCalled()
      expect(harness.close).not.toHaveBeenCalled()

      disposeSecond()
      dispose()
      expect(publishProjectionEffectExecutionReceipt(receipt)).toBe(false)
      expect(peerReceipts).toEqual([receipt])
    } finally {
      window.removeEventListener(
        PROJECTION_EFFECT_RECEIPT_WINDOW_EVENT,
        listener
      )
      disposeSecond()
      dispose()
      peer.close()
    }
    expect(harness.channels.size).toBe(0)
  })

  it('quarantines the active receiver when owned-channel receipt posting fails', () => {
    const privateMarker = 'PRIVATE_RECEIPT_POST_DETAIL'
    const receive = jest.fn()
    const close = jest.fn()
    const dispose = subscribeProjectionEffectIntents(receive, {
      createBroadcastChannel: () => ({
        postMessage() {
          throw new Error(privateMarker)
        },
        addEventListener() {},
        removeEventListener() {},
        close,
      }),
    })
    const receipt = {
      schemaVersion: 1,
      eventId: EVENT_ID,
      status: 'completed',
      resultClass: 'started',
    } as const

    let result = true
    expect(() => {
      result = publishProjectionEffectExecutionReceipt(receipt)
    }).not.toThrow()
    expect(result).toBe(false)
    expect(publishProjectionEffectExecutionReceipt(receipt)).toBe(false)
    expect(close).toHaveBeenCalledTimes(1)
    expect(receive).not.toHaveBeenCalled()
    expect(() => dispose()).not.toThrow()
  })
})
