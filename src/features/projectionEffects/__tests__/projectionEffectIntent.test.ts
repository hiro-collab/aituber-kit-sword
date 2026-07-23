/**
 * @jest-environment jsdom
 */

import {
  PROJECTION_EFFECT_INTENT_CHANNEL,
  PROJECTION_EFFECT_RECEIPT_WINDOW_EVENT,
  publishProjectionEffectExecutionReceipt,
  publishProjectionEffectIntent,
  readProjectionEffectIntent,
  readProjectionEffectRequestedEvent,
  subscribeProjectionEffectIntents,
} from '../projectionEffectIntent'

const EVENT_ID = 'evt_0123456789abcdef0123456789abcdef'
const TURN_ID = 'turn_projection_phase1'
const SESSION_ID = 'session_projection_phase1'

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

  it('publishes only a fixed execution receipt', () => {
    const receipts: unknown[] = []
    const listener = (event: Event) => {
      if (event instanceof CustomEvent) receipts.push(event.detail)
    }
    window.addEventListener(PROJECTION_EFFECT_RECEIPT_WINDOW_EVENT, listener)
    expect(
      publishProjectionEffectExecutionReceipt(
        {
          schemaVersion: 1,
          eventId: EVENT_ID,
          status: 'completed',
          resultClass: 'started',
        },
        {
          createBroadcastChannel: () => ({
            postMessage() {},
            addEventListener() {},
            removeEventListener() {},
            close() {},
          }),
        }
      )
    ).toBe(true)
    expect(receipts).toEqual([
      {
        schemaVersion: 1,
        eventId: EVENT_ID,
        status: 'completed',
        resultClass: 'started',
      },
    ])
    window.removeEventListener(PROJECTION_EFFECT_RECEIPT_WINDOW_EVENT, listener)
  })
})
