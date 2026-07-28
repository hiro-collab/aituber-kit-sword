import {
  acknowledgeClosedLoopOutput,
  beginClosedLoopOutput,
} from '@/features/closedLoop/closedLoopOutputFeedback'

describe('closedLoopOutputFeedback', () => {
  const originalFetch = global.fetch
  const originalEnabled =
    process.env.NEXT_PUBLIC_THOUGHT_CORE_CLOSED_LOOP_FEEDBACK_V1_ENABLED

  afterEach(() => {
    global.fetch = originalFetch
    if (originalEnabled === undefined) {
      delete process.env
        .NEXT_PUBLIC_THOUGHT_CORE_CLOSED_LOOP_FEEDBACK_V1_ENABLED
    } else {
      process.env.NEXT_PUBLIC_THOUGHT_CORE_CLOSED_LOOP_FEEDBACK_V1_ENABLED =
        originalEnabled
    }
    jest.clearAllMocks()
  })

  it('keeps disabled legacy output as a no-op', async () => {
    delete process.env.NEXT_PUBLIC_THOUGHT_CORE_CLOSED_LOOP_FEEDBACK_V1_ENABLED
    global.fetch = jest.fn() as typeof fetch

    await expect(
      beginClosedLoopOutput(
        {
          sessionId: 'session_1',
          turnId: 'turn_1',
          assistantMessageId: 'msg_1',
        },
        'display'
      )
    ).resolves.toBeNull()
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('writes intent, send attempt, then bounded acknowledgement with canonical ids', async () => {
    process.env.NEXT_PUBLIC_THOUGHT_CORE_CLOSED_LOOP_FEEDBACK_V1_ENABLED = '1'
    const responses = ['evt_intent', 'evt_send', 'evt_ack']
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true, event_id: responses.shift() }),
    })) as unknown as typeof fetch

    const barrier = await beginClosedLoopOutput(
      {
        sessionId: 'session_1',
        turnId: 'turn_1',
        assistantMessageId: 'msg_1',
      },
      'display'
    )
    await acknowledgeClosedLoopOutput(barrier)

    const bodies = (global.fetch as jest.Mock).mock.calls.map((call) =>
      JSON.parse(String(call[1].body))
    )
    expect(bodies.map((body) => body.details.profile_name)).toEqual([
      'dispatch_intent_recorded',
      'send_attempt_started_outcome_unknown',
      'submission_ack_needs_feedback',
    ])
    expect(bodies[2]).toEqual(
      expect.objectContaining({
        session_id: 'session_1',
        turn_id: 'turn_1',
        assistant_message_id: 'msg_1',
        causal_parent_event_id: 'evt_send',
        details: expect.objectContaining({
          output_channel: 'display',
          component: 'aituber_message_store',
        }),
      })
    )
    expect(JSON.stringify(bodies)).not.toMatch(
      /raw|prompt|transcript|audio|secret|path|url/i
    )
  })

  it('fails closed on a missing canonical identifier', async () => {
    process.env.NEXT_PUBLIC_THOUGHT_CORE_CLOSED_LOOP_FEEDBACK_V1_ENABLED = '1'
    global.fetch = jest.fn() as typeof fetch
    await expect(
      beginClosedLoopOutput(
        { sessionId: '', turnId: 'turn_1', assistantMessageId: 'msg_1' },
        'tts'
      )
    ).rejects.toThrow('closed_loop_output_feedback_failed')
    expect(global.fetch).not.toHaveBeenCalled()
  })
})
