export const SPEECH_BUBBLE_PRESENTATION_SOURCE = 'operator-manual' as const

export type SpeechBubbleSizeMode = 'auto' | 'fixed'
export type SpeechBubbleTailSide = 'left' | 'right' | 'top' | 'bottom'
export type SpeechBubbleTimingMode =
  | 'speech-synchronized'
  | 'reading-time'
  | 'fixed-duration'
  | 'until-next-message'

/**
 * Phase 1 has exactly one writer: the local operator settings store. A future
 * accepted expression plan may target this bounded shape, but it must still be
 * resolved by the bubble renderer against operator guardrails and safe areas.
 */
export type SpeechBubblePresentationSettings = {
  source: typeof SPEECH_BUBBLE_PRESENTATION_SOURCE
  fontSizePx: number
  lineHeight: number
  widthMode: SpeechBubbleSizeMode
  widthPercent: number
  heightMode: SpeechBubbleSizeMode
  heightPercent: number
  positionX: number
  positionY: number
  tailSide: SpeechBubbleTailSide
  tailTargetX: number
  tailTargetY: number
  timingMode: SpeechBubbleTimingMode
  minVisibleMs: number
  postSpeechHoldMs: number
  fixedDurationMs: number
  readingMinMs: number
  readingMaxMs: number
  readingMsPerCharacter: number
  safeAreaPx: number
}

export const DEFAULT_SPEECH_BUBBLE_PRESENTATION: SpeechBubblePresentationSettings =
  {
    source: SPEECH_BUBBLE_PRESENTATION_SOURCE,
    fontSizePx: 24,
    lineHeight: 1.5,
    widthMode: 'auto',
    widthPercent: 30,
    heightMode: 'auto',
    heightPercent: 58,
    positionX: 0.37,
    positionY: 0.34,
    tailSide: 'right',
    tailTargetX: 0.64,
    tailTargetY: 0.48,
    timingMode: 'until-next-message',
    minVisibleMs: 6000,
    postSpeechHoldMs: 2000,
    fixedDurationMs: 10000,
    readingMinMs: 12000,
    readingMaxMs: 36000,
    readingMsPerCharacter: 160,
    safeAreaPx: 24,
  }

const EXACT_KEYS = Object.keys(DEFAULT_SPEECH_BUBBLE_PRESENTATION).sort()

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const isFiniteInRange = (value: unknown, min: number, max: number) =>
  typeof value === 'number' &&
  Number.isFinite(value) &&
  value >= min &&
  value <= max

const hasExactKeys = (value: Record<string, unknown>) => {
  const keys = Object.keys(value).sort()
  return (
    keys.length === EXACT_KEYS.length &&
    keys.every((key, index) => key === EXACT_KEYS[index])
  )
}

export const isSpeechBubblePresentationSettings = (
  value: unknown
): value is SpeechBubblePresentationSettings => {
  if (!isRecord(value) || !hasExactKeys(value)) return false

  return (
    value.source === SPEECH_BUBBLE_PRESENTATION_SOURCE &&
    isFiniteInRange(value.fontSizePx, 16, 36) &&
    isFiniteInRange(value.lineHeight, 1.2, 2) &&
    (value.widthMode === 'auto' || value.widthMode === 'fixed') &&
    isFiniteInRange(value.widthPercent, 20, 75) &&
    (value.heightMode === 'auto' || value.heightMode === 'fixed') &&
    isFiniteInRange(value.heightPercent, 18, 75) &&
    isFiniteInRange(value.positionX, 0, 1) &&
    isFiniteInRange(value.positionY, 0, 1) &&
    (value.tailSide === 'left' ||
      value.tailSide === 'right' ||
      value.tailSide === 'top' ||
      value.tailSide === 'bottom') &&
    isFiniteInRange(value.tailTargetX, 0, 1) &&
    isFiniteInRange(value.tailTargetY, 0, 1) &&
    (value.timingMode === 'speech-synchronized' ||
      value.timingMode === 'reading-time' ||
      value.timingMode === 'fixed-duration' ||
      value.timingMode === 'until-next-message') &&
    isFiniteInRange(value.minVisibleMs, 1000, 30000) &&
    isFiniteInRange(value.postSpeechHoldMs, 0, 15000) &&
    isFiniteInRange(value.fixedDurationMs, 1000, 60000) &&
    isFiniteInRange(value.readingMinMs, 1000, 30000) &&
    isFiniteInRange(value.readingMaxMs, value.readingMinMs as number, 60000) &&
    isFiniteInRange(value.readingMsPerCharacter, 40, 500) &&
    isFiniteInRange(value.safeAreaPx, 0, 160)
  )
}

export const resolveSpeechBubblePresentationSettings = (
  value: unknown,
  fallback = DEFAULT_SPEECH_BUBBLE_PRESENTATION
): SpeechBubblePresentationSettings =>
  isSpeechBubblePresentationSettings(value) ? value : fallback

export type SpeechBubblePlacement = {
  centerX: number
  centerY: number
  clamped: boolean
}

export const resolveSpeechBubblePlacement = ({
  preferredX,
  preferredY,
  bubbleWidth,
  bubbleHeight,
  viewportWidth,
  viewportHeight,
  safeAreaPx,
  reservedBottomPx = 0,
  tailExtentPx = 0,
}: {
  preferredX: number
  preferredY: number
  bubbleWidth: number
  bubbleHeight: number
  viewportWidth: number
  viewportHeight: number
  safeAreaPx: number
  reservedBottomPx?: number
  tailExtentPx?: number
}): SpeechBubblePlacement => {
  const protectedInset = Math.max(0, safeAreaPx) + Math.max(0, tailExtentPx)
  const halfWidth = Math.max(0, bubbleWidth) / 2
  const halfHeight = Math.max(0, bubbleHeight) / 2
  const minX = protectedInset + halfWidth
  const maxX = Math.max(minX, viewportWidth - protectedInset - halfWidth)
  const minY = protectedInset + halfHeight
  const maxY = Math.max(
    minY,
    viewportHeight - protectedInset - reservedBottomPx - halfHeight
  )
  const requestedX = preferredX * viewportWidth
  const requestedY = preferredY * viewportHeight
  const centerX = Math.min(maxX, Math.max(minX, requestedX))
  const centerY = Math.min(maxY, Math.max(minY, requestedY))

  return {
    centerX,
    centerY,
    clamped: centerX !== requestedX || centerY !== requestedY,
  }
}

export const resolveSpeechBubbleTailAngle = ({
  side,
  targetX,
  targetY,
  centerX,
  centerY,
  bubbleWidth,
  bubbleHeight,
}: {
  side: SpeechBubbleTailSide
  targetX: number
  targetY: number
  centerX: number
  centerY: number
  bubbleWidth: number
  bubbleHeight: number
}) => {
  const halfWidth = Math.max(0, bubbleWidth) / 2
  const halfHeight = Math.max(0, bubbleHeight) / 2
  const anchor =
    side === 'left'
      ? { x: centerX - halfWidth, y: centerY }
      : side === 'right'
        ? { x: centerX + halfWidth, y: centerY }
        : side === 'top'
          ? { x: centerX, y: centerY - halfHeight }
          : { x: centerX, y: centerY + halfHeight }

  return (Math.atan2(targetY - anchor.y, targetX - anchor.x) * 180) / Math.PI
}

export type SpeechBubbleTimerDecision =
  | { action: 'hold' }
  | { action: 'advance' | 'hide'; delayMs: number }

export const resolveSpeechBubbleReadingMs = (
  characterCount: number,
  settings: SpeechBubblePresentationSettings
) =>
  Math.min(
    settings.readingMaxMs,
    Math.max(
      settings.readingMinMs,
      Math.max(0, characterCount) * settings.readingMsPerCharacter
    )
  )

export const resolveSpeechBubbleTimerDecision = ({
  settings,
  characterCount,
  pageIndex,
  pageCount,
  speechOutputActive,
  pageVisibleElapsedMs = 0,
  postSpeechElapsedMs = 0,
}: {
  settings: SpeechBubblePresentationSettings
  characterCount: number
  pageIndex: number
  pageCount: number
  speechOutputActive: boolean
  pageVisibleElapsedMs?: number
  postSpeechElapsedMs?: number
}): SpeechBubbleTimerDecision => {
  const hasNextPage = pageIndex + 1 < pageCount
  const afterMinimum = (durationMs: number) =>
    Math.max(
      0,
      Math.max(settings.minVisibleMs, durationMs) - pageVisibleElapsedMs
    )

  if (settings.timingMode === 'until-next-message') {
    return hasNextPage
      ? {
          action: 'advance',
          delayMs: afterMinimum(
            resolveSpeechBubbleReadingMs(characterCount, settings)
          ),
        }
      : { action: 'hold' }
  }

  if (settings.timingMode === 'speech-synchronized') {
    if (speechOutputActive && !hasNextPage) return { action: 'hold' }
    if (hasNextPage) {
      return {
        action: 'advance',
        delayMs: afterMinimum(
          resolveSpeechBubbleReadingMs(characterCount, settings)
        ),
      }
    }
    return {
      action: 'hide',
      delayMs: Math.max(
        0,
        settings.minVisibleMs - pageVisibleElapsedMs,
        settings.postSpeechHoldMs - postSpeechElapsedMs
      ),
    }
  }

  const durationMs =
    settings.timingMode === 'fixed-duration'
      ? settings.fixedDurationMs
      : resolveSpeechBubbleReadingMs(characterCount, settings)

  return {
    action: hasNextPage ? 'advance' : 'hide',
    delayMs: afterMinimum(durationMs),
  }
}
