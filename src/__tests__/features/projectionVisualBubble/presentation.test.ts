import {
  DEFAULT_SPEECH_BUBBLE_PRESENTATION,
  isSpeechBubblePresentationSettings,
  resolveSpeechBubblePlacement,
  resolveSpeechBubbleTailAngle,
  resolveSpeechBubbleTimerDecision,
} from '@/features/projectionVisualBubble/presentation'

describe('speech bubble presentation contract', () => {
  it('accepts only the complete bounded operator-owned shape', () => {
    expect(
      isSpeechBubblePresentationSettings(DEFAULT_SPEECH_BUBBLE_PRESENTATION)
    ).toBe(true)
    expect(
      isSpeechBubblePresentationSettings({
        ...DEFAULT_SPEECH_BUBBLE_PRESENTATION,
        fontSizePx: '24',
      })
    ).toBe(false)
    expect(
      isSpeechBubblePresentationSettings({
        ...DEFAULT_SPEECH_BUBBLE_PRESENTATION,
        arbitraryCss: 'position:fixed',
      })
    ).toBe(false)
  })

  it('clamps realized placement without rewriting the preferred coordinates', () => {
    expect(
      resolveSpeechBubblePlacement({
        preferredX: 0,
        preferredY: 1,
        bubbleWidth: 400,
        bubbleHeight: 200,
        viewportWidth: 1000,
        viewportHeight: 800,
        safeAreaPx: 24,
        reservedBottomPx: 120,
      })
    ).toEqual({ centerX: 224, centerY: 556, clamped: true })
  })

  it('keeps the tail extent inside the protected safe area and aims from the realized placement', () => {
    const placement = resolveSpeechBubblePlacement({
      preferredX: 0,
      preferredY: 0,
      bubbleWidth: 400,
      bubbleHeight: 200,
      viewportWidth: 1000,
      viewportHeight: 800,
      safeAreaPx: 24,
      tailExtentPx: 64,
    })

    expect(placement).toEqual({ centerX: 288, centerY: 188, clamped: true })
    expect(
      resolveSpeechBubbleTailAngle({
        side: 'right',
        targetX: 900,
        targetY: 400,
        centerX: placement.centerX,
        centerY: placement.centerY,
        bubbleWidth: 400,
        bubbleHeight: 200,
      })
    ).toBeCloseTo(27.2, 1)
  })

  it('keeps until-next visible while still paging long text', () => {
    const first = resolveSpeechBubbleTimerDecision({
      settings: DEFAULT_SPEECH_BUBBLE_PRESENTATION,
      characterCount: 20,
      pageIndex: 0,
      pageCount: 2,
      speechOutputActive: false,
    })
    const last = resolveSpeechBubbleTimerDecision({
      settings: DEFAULT_SPEECH_BUBBLE_PRESENTATION,
      characterCount: 20,
      pageIndex: 1,
      pageCount: 2,
      speechOutputActive: false,
    })

    expect(first).toEqual({ action: 'advance', delayMs: 12000 })
    expect(last).toEqual({ action: 'hold' })
  })

  it.each([
    ['reading-time', 12000],
    ['fixed-duration', 10000],
  ] as const)('uses one deterministic %s timer', (timingMode, delayMs) => {
    expect(
      resolveSpeechBubbleTimerDecision({
        settings: {
          ...DEFAULT_SPEECH_BUBBLE_PRESENTATION,
          timingMode,
        },
        characterCount: 10,
        pageIndex: 0,
        pageCount: 1,
        speechOutputActive: false,
      })
    ).toEqual({ action: 'hide', delayMs })
  })

  it('holds speech-synchronized text during output and applies the readable floor after it ends', () => {
    const settings = {
      ...DEFAULT_SPEECH_BUBBLE_PRESENTATION,
      timingMode: 'speech-synchronized' as const,
      postSpeechHoldMs: 2000,
      minVisibleMs: 6000,
    }

    expect(
      resolveSpeechBubbleTimerDecision({
        settings,
        characterCount: 10,
        pageIndex: 0,
        pageCount: 1,
        speechOutputActive: true,
      })
    ).toEqual({ action: 'hold' })
    expect(
      resolveSpeechBubbleTimerDecision({
        settings,
        characterCount: 10,
        pageIndex: 0,
        pageCount: 1,
        speechOutputActive: false,
        pageVisibleElapsedMs: 4500,
        postSpeechElapsedMs: 4500,
      })
    ).toEqual({ action: 'hide', delayMs: 1500 })
  })

  it('starts the full post-speech hold when long speech ends', () => {
    expect(
      resolveSpeechBubbleTimerDecision({
        settings: {
          ...DEFAULT_SPEECH_BUBBLE_PRESENTATION,
          timingMode: 'speech-synchronized',
          minVisibleMs: 1000,
          postSpeechHoldMs: 2000,
        },
        characterCount: 10,
        pageIndex: 0,
        pageCount: 1,
        speechOutputActive: false,
        pageVisibleElapsedMs: 10000,
        postSpeechElapsedMs: 0,
      })
    ).toEqual({ action: 'hide', delayMs: 2000 })
  })
})
