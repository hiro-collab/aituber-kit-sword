import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react'

import homeStore from '@/features/stores/home'
import projectionDisplayStore from '@/features/stores/projectionDisplay'
import settingsStore from '@/features/stores/settings'
import {
  resolveSpeechBubblePlacement,
  resolveSpeechBubblePresentationSettings,
  resolveSpeechBubbleTailAngle,
  resolveSpeechBubbleTimerDecision,
} from '@/features/projectionVisualBubble/presentation'
import { EMOTIONS } from '@/features/messages/messages'
import { getLatestAssistantMessageEntry } from '@/utils/assistantMessageUtils'
import { compactReviewProofMessage } from '@/utils/reviewProofMessage'
import {
  buildSpeechOutputSummary,
  compareSpeechOutputSummaries,
  readWindowSpeechOutputDisplayState,
  readWindowSpeechOutputSummary,
  resolveSpeechOutputDisplayConversationAttemptRef,
  writeWindowSpeechOutputParitySummary,
  type SpeechOutputDisplayState,
  type SpeechOutputSummary,
} from '@/utils/speechOutputParitySummary'

const MAX_OPERATOR_COMFORTABLE_VISIBLE_LINES = 6
const MAX_OPERATOR_COMPACT_VISIBLE_LINES = 9
const MAX_OPERATOR_DENSE_VISIBLE_LINES = 11
const MAX_PASSIVE_VISIBLE_LINES = 3
const MEASURE_EPSILON_PX = 2
const OPERATOR_RESERVED_BOTTOM_PX = 132
const BUBBLE_TAIL_EXTENT_PX = 64

export type ProjectionVisualBubbleTextDensity =
  | 'comfortable'
  | 'compact'
  | 'dense'

type BubblePage = {
  text: string
}

type ProjectionVisualAssistantBubbleProps = {
  variant?: 'operator' | 'passive' | 'stage-output'
}

export const resolveProjectionVisualBubbleTextDensity = (
  text: string,
  variant: ProjectionVisualAssistantBubbleProps['variant'] = 'operator'
): ProjectionVisualBubbleTextDensity => {
  if (variant !== 'operator') {
    return 'comfortable'
  }

  const characterCount = Array.from(text).length
  if (characterCount > 180) {
    return 'dense'
  }
  if (characterCount > 80) {
    return 'compact'
  }
  return 'comfortable'
}

export const resolveProjectionVisualBubblePageReadMs = (text: string) =>
  Math.min(36000, Math.max(12000, Array.from(text).length * 160))

const useBrowserLayoutEffect =
  typeof window === 'undefined' ? useEffect : useLayoutEffect

const escapeRegExp = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const emotionPattern = new RegExp(
  `\\[(${EMOTIONS.map(escapeRegExp).join('|')})\\]`,
  'gi'
)

const buildMotionPattern = (motionIds: string[]) => {
  const pattern = motionIds.filter(Boolean).map(escapeRegExp).join('|')
  if (!pattern) {
    return /\[motion:[^\]]*\]/gi
  }
  return new RegExp(`\\[(?:motion:)?(?:${pattern})\\]`, 'gi')
}

const getNumericStyle = (style: CSSStyleDeclaration, property: string) => {
  const value = Number.parseFloat(style.getPropertyValue(property))
  return Number.isFinite(value) ? value : 0
}

const getLineHeight = (style: CSSStyleDeclaration) => {
  const parsed = Number.parseFloat(style.lineHeight)
  if (Number.isFinite(parsed)) {
    return parsed
  }
  const fontSize = Number.parseFloat(style.fontSize)
  return Number.isFinite(fontSize) ? fontSize * 1.5 : 24
}

const paginateMeasuredText = (
  text: string,
  measureElement: HTMLDivElement,
  maxVisibleLines: number
): BubblePage[] => {
  const segments = Array.from(text)
  if (segments.length === 0) {
    return []
  }

  const style = window.getComputedStyle(measureElement)
  const lineHeight = getLineHeight(style)
  const maxHeight =
    lineHeight * maxVisibleLines +
    getNumericStyle(style, 'padding-top') +
    getNumericStyle(style, 'padding-bottom') +
    MEASURE_EPSILON_PX
  const pages: BubblePage[] = []
  let start = 0

  while (start < segments.length) {
    let low = start + 1
    let high = segments.length
    let best = low

    while (low <= high) {
      const mid = Math.floor((low + high) / 2)
      const candidate = segments.slice(start, mid).join('').trim()
      measureElement.textContent = candidate || segments[mid - 1]

      if (measureElement.scrollHeight <= maxHeight) {
        best = mid
        low = mid + 1
      } else {
        high = mid - 1
      }
    }

    const pageText = segments.slice(start, best).join('').trim()
    pages.push({ text: pageText })

    start = best
    while (segments[start] === '\n') {
      start += 1
    }
  }

  return pages
}

export const ProjectionVisualAssistantBubble = ({
  variant = 'operator',
}: ProjectionVisualAssistantBubbleProps) => {
  const chatLog = homeStore((s) => s.chatLog)
  const passiveAssistantMessage = projectionDisplayStore(
    (s) => s.assistantMessage
  )
  const passiveAssistantMessageId = projectionDisplayStore(
    (s) => s.assistantMessageId
  )
  const passiveSpeechOutputSummary = projectionDisplayStore(
    (s) => s.speechOutputSummary
  )
  const passiveSpeechOutputActive = projectionDisplayStore(
    (s) => s.speechOutputActive
  )
  const operatorSpeechOutputActive = homeStore((s) => s.isSpeaking)
  const [
    operatorSpeechOutputDisplayState,
    setOperatorSpeechOutputDisplayState,
  ] = useState<SpeechOutputDisplayState | null>(() =>
    readWindowSpeechOutputDisplayState()
  )
  const [operatorSpeechOutputSummary, setOperatorSpeechOutputSummary] =
    useState<SpeechOutputSummary | null>(() => readWindowSpeechOutputSummary())
  const characterName = settingsStore((s) => s.characterName)
  const showCharacterName = settingsStore((s) => s.showCharacterName)
  const poseConfigs = settingsStore((s) => s.poseConfigs)
  const storedBubblePresentation = settingsStore(
    (s) => s.speechBubblePresentation
  )
  const bubblePresentation = resolveSpeechBubblePresentationSettings(
    storedBubblePresentation
  )
  const bubbleRef = useRef<HTMLElement | null>(null)
  const measureRef = useRef<HTMLDivElement | null>(null)
  const pageVisibleRef = useRef({
    messageKey: '',
    pageIndex: -1,
    pageText: '',
    since: 0,
  })
  const speechLifecycleRef = useRef({
    messageKey: '',
    active: false,
    endedAt: 0,
  })
  const [pagination, setPagination] = useState<{
    messageKey: string
    pages: BubblePage[]
  }>({ messageKey: '', pages: [] })
  const [pageCursor, setPageCursor] = useState({
    messageKey: '',
    pageIndex: 0,
  })
  const [hiddenMessageKey, setHiddenMessageKey] = useState<string | null>(null)
  const [placement, setPlacement] = useState<{
    centerX: number
    centerY: number
    clamped: boolean
  } | null>(null)
  const [tailAngleDeg, setTailAngleDeg] = useState(0)
  const shouldUseProjectionDisplayMessage =
    variant === 'stage-output' ||
    (variant === 'passive' && Boolean(passiveAssistantMessage))
  const speechOutputActive = shouldUseProjectionDisplayMessage
    ? passiveSpeechOutputActive
    : operatorSpeechOutputActive
  const latestChatAssistantMessageEntry =
    getLatestAssistantMessageEntry(chatLog)
  const latestChatAssistantMessage = useMemo(() => {
    for (let index = (chatLog?.length ?? 0) - 1; index >= 0; index -= 1) {
      const message = chatLog?.[index]
      if (message?.role === 'assistant') {
        return message
      }
    }
    return null
  }, [chatLog])
  const shouldUseOperatorSpeechDisplayMessage =
    variant === 'operator' &&
    Boolean(operatorSpeechOutputDisplayState?.display_message)
  const latestAssistantMessageEntry = shouldUseProjectionDisplayMessage
    ? {
        content: passiveAssistantMessage,
        id: passiveAssistantMessageId ?? undefined,
      }
    : shouldUseOperatorSpeechDisplayMessage
      ? {
          content: operatorSpeechOutputDisplayState?.display_message || '',
          id: operatorSpeechOutputDisplayState?.message_id ?? undefined,
        }
      : latestChatAssistantMessageEntry
  const latestAssistantMessage = latestAssistantMessageEntry.content
  const motionPattern = useMemo(
    () => buildMotionPattern(poseConfigs.map((pose) => pose.id)),
    [poseConfigs]
  )
  const cleanedMessage = useMemo(
    () =>
      compactReviewProofMessage(
        latestAssistantMessage
          .replace(emotionPattern, '')
          .replace(motionPattern, '')
      ),
    [latestAssistantMessage, motionPattern]
  )
  const messageKey = `${latestAssistantMessageEntry.id ?? 'unidentified'}\u0000${cleanedMessage}`
  const pages =
    pagination.messageKey === messageKey
      ? pagination.pages
      : cleanedMessage
        ? [{ text: cleanedMessage }]
        : []
  const pageIndex =
    pageCursor.messageKey === messageKey ? pageCursor.pageIndex : 0
  const currentPage = pages[pageIndex]?.text ?? cleanedMessage
  const isVisible = Boolean(cleanedMessage) && hiddenMessageKey !== messageKey
  const bubbleTextDensity = resolveProjectionVisualBubbleTextDensity(
    cleanedMessage,
    variant
  )
  const effectiveFontSizePx =
    bubbleTextDensity === 'dense'
      ? Math.max(16, bubblePresentation.fontSizePx * 0.78)
      : bubbleTextDensity === 'compact'
        ? Math.max(16, bubblePresentation.fontSizePx * 0.88)
        : bubblePresentation.fontSizePx
  const bubbleTextScopeClass =
    pages.length > 1 ? 'current_visible_page' : 'compacted_full_text'
  const bubbleSourceField = shouldUseProjectionDisplayMessage
    ? 'projectionDisplayStore.assistantMessage'
    : shouldUseOperatorSpeechDisplayMessage
      ? 'speechOutputDisplayState.display_message'
      : 'homeStore.chatLog.latestAssistantMessage'
  const bubbleConversationAttemptRef = shouldUseProjectionDisplayMessage
    ? resolveSpeechOutputDisplayConversationAttemptRef({
        displayMessageId: passiveAssistantMessageId,
        sourceMessageId: passiveSpeechOutputSummary?.message_id,
        conversationAttemptRef:
          passiveSpeechOutputSummary?.conversation_attempt_ref,
      })
    : shouldUseOperatorSpeechDisplayMessage
      ? resolveSpeechOutputDisplayConversationAttemptRef({
          displayMessageId: operatorSpeechOutputDisplayState?.message_id,
          sourceMessageId: operatorSpeechOutputSummary?.message_id,
          conversationAttemptRef:
            operatorSpeechOutputDisplayState?.conversation_attempt_ref,
        })
      : resolveSpeechOutputDisplayConversationAttemptRef({
          displayMessageId: latestAssistantMessageEntry.id,
          sourceMessageId: latestChatAssistantMessage?.id,
          conversationAttemptRef:
            latestChatAssistantMessage?.conversationAttemptRef,
        })
  const bubbleTurnId = shouldUseProjectionDisplayMessage
    ? passiveSpeechOutputSummary?.turn_id
    : shouldUseOperatorSpeechDisplayMessage
      ? operatorSpeechOutputDisplayState?.turn_id
      : latestChatAssistantMessage?.turnId
  const intendedTextSummary = useMemo(
    () =>
      buildSpeechOutputSummary({
        surface: 'projection_visual_intended_text',
        sourceField: bubbleSourceField,
        message: cleanedMessage,
        messageId: latestAssistantMessageEntry.id,
        turnId: bubbleTurnId,
        conversationAttemptRef: bubbleConversationAttemptRef,
        textRoleClass: 'intended_text',
        textScopeClass: 'compacted_full_text',
      }),
    [
      bubbleSourceField,
      cleanedMessage,
      latestAssistantMessageEntry.id,
      bubbleTurnId,
      bubbleConversationAttemptRef,
    ]
  )
  const bubbleSummary = useMemo(
    () =>
      buildSpeechOutputSummary({
        surface: 'projection_visual_assistant_bubble',
        sourceField: bubbleSourceField,
        message: currentPage,
        messageId: latestAssistantMessageEntry.id,
        turnId: bubbleTurnId,
        conversationAttemptRef: bubbleConversationAttemptRef,
        textRoleClass: 'bubble_text',
        textScopeClass: bubbleTextScopeClass,
      }),
    [
      bubbleSourceField,
      bubbleTextScopeClass,
      currentPage,
      latestAssistantMessageEntry.id,
      bubbleTurnId,
      bubbleConversationAttemptRef,
    ]
  )
  const ttsSpeechOutputSummary = shouldUseProjectionDisplayMessage
    ? passiveSpeechOutputSummary
    : operatorSpeechOutputSummary
  const paritySummary = useMemo(
    () =>
      compareSpeechOutputSummaries(bubbleSummary, ttsSpeechOutputSummary, {
        intended: intendedTextSummary,
      }),
    [bubbleSummary, intendedTextSummary, ttsSpeechOutputSummary]
  )
  const densityLineCeiling =
    variant === 'operator'
      ? bubbleTextDensity === 'dense'
        ? MAX_OPERATOR_DENSE_VISIBLE_LINES
        : bubbleTextDensity === 'compact'
          ? MAX_OPERATOR_COMPACT_VISIBLE_LINES
          : MAX_OPERATOR_COMFORTABLE_VISIBLE_LINES
      : MAX_PASSIVE_VISIBLE_LINES
  const viewportHeight =
    typeof window === 'undefined' ? 1080 : window.innerHeight
  const viewportWidth = typeof window === 'undefined' ? 1920 : window.innerWidth
  const protectedInsetPx = bubblePresentation.safeAreaPx + BUBBLE_TAIL_EXTENT_PX
  const reservedBottomPx =
    variant === 'operator' ? OPERATOR_RESERVED_BOTTOM_PX : 0
  const maxAvailableBubbleWidth = Math.max(
    240,
    viewportWidth - protectedInsetPx * 2
  )
  const maxAvailableBubbleHeight = Math.max(
    120,
    viewportHeight - protectedInsetPx * 2 - reservedBottomPx
  )
  const heightLineCeiling = Math.max(
    2,
    Math.floor(
      (Math.min(
        viewportHeight * (bubblePresentation.heightPercent / 100),
        maxAvailableBubbleHeight
      ) -
        48) /
        (effectiveFontSizePx * bubblePresentation.lineHeight)
    )
  )
  const maxVisibleLines = Math.min(densityLineCeiling, heightLineCeiling)
  const bubbleStyle = {
    left: placement
      ? `${placement.centerX}px`
      : `${bubblePresentation.positionX * 100}vw`,
    top: placement
      ? `${placement.centerY}px`
      : `${bubblePresentation.positionY * 100}vh`,
    width:
      bubblePresentation.widthMode === 'fixed'
        ? `min(${bubblePresentation.widthPercent}vw, ${maxAvailableBubbleWidth}px)`
        : `clamp(240px, ${bubblePresentation.widthPercent}vw, ${Math.min(960, maxAvailableBubbleWidth)}px)`,
    height:
      bubblePresentation.heightMode === 'fixed'
        ? `min(${bubblePresentation.heightPercent}vh, ${maxAvailableBubbleHeight}px)`
        : undefined,
    maxWidth: `${maxAvailableBubbleWidth}px`,
    maxHeight: `${maxAvailableBubbleHeight}px`,
    '--speech-bubble-font-size': `${effectiveFontSizePx}px`,
    '--speech-bubble-line-height': String(bubblePresentation.lineHeight),
    '--speech-bubble-tail-angle': `${tailAngleDeg}deg`,
  } as CSSProperties

  useEffect(() => {
    if (shouldUseProjectionDisplayMessage || typeof window === 'undefined') {
      return
    }
    const updateSpeechSummary = (event?: Event) => {
      const detail =
        event instanceof CustomEvent
          ? (event.detail as SpeechOutputSummary | undefined)
          : undefined
      setOperatorSpeechOutputSummary(detail ?? readWindowSpeechOutputSummary())
      setOperatorSpeechOutputDisplayState(readWindowSpeechOutputDisplayState())
    }

    updateSpeechSummary()
    window.addEventListener(
      'projectionVisualSpeechOutputSummaryV0',
      updateSpeechSummary
    )
    return () => {
      window.removeEventListener(
        'projectionVisualSpeechOutputSummaryV0',
        updateSpeechSummary
      )
    }
  }, [shouldUseProjectionDisplayMessage])

  useEffect(() => {
    writeWindowSpeechOutputParitySummary(paritySummary)
  }, [paritySummary])

  useBrowserLayoutEffect(() => {
    const measureElement = measureRef.current
    if (!isVisible || !cleanedMessage) {
      if (!cleanedMessage) {
        setPagination((current) =>
          current.messageKey || current.pages.length
            ? { messageKey: '', pages: [] }
            : current
        )
        setPageCursor((current) =>
          current.messageKey || current.pageIndex
            ? { messageKey: '', pageIndex: 0 }
            : current
        )
      }
      return
    }
    if (!measureElement) {
      return
    }

    const updatePages = () => {
      const nextPages = paginateMeasuredText(
        cleanedMessage,
        measureElement,
        maxVisibleLines
      )
      setPagination((current) => {
        const unchanged =
          current.messageKey === messageKey &&
          current.pages.length === nextPages.length &&
          current.pages.every(
            (page, index) => page.text === nextPages[index]?.text
          )
        return unchanged ? current : { messageKey, pages: nextPages }
      })
      setPageCursor((current) =>
        current.messageKey === messageKey &&
        current.pageIndex < nextPages.length
          ? current
          : { messageKey, pageIndex: 0 }
      )
    }

    updatePages()
    window.addEventListener('resize', updatePages)
    const observer =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(updatePages)
    observer?.observe(measureElement)

    return () => {
      window.removeEventListener('resize', updatePages)
      observer?.disconnect()
    }
  }, [
    bubblePresentation.heightMode,
    bubblePresentation.heightPercent,
    bubblePresentation.lineHeight,
    bubblePresentation.widthMode,
    bubblePresentation.widthPercent,
    cleanedMessage,
    effectiveFontSizePx,
    isVisible,
    maxVisibleLines,
    messageKey,
  ])

  useEffect(() => {
    if (!isVisible || !currentPage || pages.length === 0) return

    if (
      pageVisibleRef.current.messageKey !== messageKey ||
      pageVisibleRef.current.pageIndex !== pageIndex ||
      pageVisibleRef.current.pageText !== currentPage
    ) {
      pageVisibleRef.current = {
        messageKey,
        pageIndex,
        pageText: currentPage,
        since: Date.now(),
      }
    }

    const now = Date.now()
    if (speechLifecycleRef.current.messageKey !== messageKey) {
      speechLifecycleRef.current = {
        messageKey,
        active: speechOutputActive,
        endedAt: speechOutputActive ? 0 : pageVisibleRef.current.since,
      }
    } else if (speechLifecycleRef.current.active && !speechOutputActive) {
      speechLifecycleRef.current = {
        messageKey,
        active: false,
        endedAt: now,
      }
    } else if (!speechLifecycleRef.current.active && speechOutputActive) {
      speechLifecycleRef.current = {
        messageKey,
        active: true,
        endedAt: 0,
      }
    }

    const decision = resolveSpeechBubbleTimerDecision({
      settings: bubblePresentation,
      characterCount: Array.from(currentPage).length,
      pageIndex,
      pageCount: pages.length,
      speechOutputActive,
      pageVisibleElapsedMs: now - pageVisibleRef.current.since,
      postSpeechElapsedMs: speechLifecycleRef.current.endedAt
        ? now - speechLifecycleRef.current.endedAt
        : 0,
    })
    if (decision.action === 'hold') return

    const timer = window.setTimeout(() => {
      if (decision.action === 'advance') {
        setPageCursor({
          messageKey,
          pageIndex: Math.min(pageIndex + 1, pages.length - 1),
        })
      } else {
        setHiddenMessageKey(messageKey)
      }
    }, decision.delayMs)

    return () => {
      window.clearTimeout(timer)
    }
  }, [
    bubblePresentation,
    currentPage,
    isVisible,
    messageKey,
    pageIndex,
    pages.length,
    speechOutputActive,
  ])

  useBrowserLayoutEffect(() => {
    const bubble = bubbleRef.current
    if (!isVisible || !bubble || typeof window === 'undefined') return

    const updateGeometry = () => {
      const rect = bubble.getBoundingClientRect()
      const nextPlacement = resolveSpeechBubblePlacement({
        preferredX: bubblePresentation.positionX,
        preferredY: bubblePresentation.positionY,
        bubbleWidth: rect.width,
        bubbleHeight: rect.height,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        safeAreaPx: bubblePresentation.safeAreaPx,
        reservedBottomPx,
        tailExtentPx: BUBBLE_TAIL_EXTENT_PX,
      })
      setPlacement((current) =>
        current?.centerX === nextPlacement.centerX &&
        current?.centerY === nextPlacement.centerY &&
        current?.clamped === nextPlacement.clamped
          ? current
          : nextPlacement
      )

      setTailAngleDeg(
        resolveSpeechBubbleTailAngle({
          side: bubblePresentation.tailSide,
          targetX: bubblePresentation.tailTargetX * window.innerWidth,
          targetY: bubblePresentation.tailTargetY * window.innerHeight,
          centerX: nextPlacement.centerX,
          centerY: nextPlacement.centerY,
          bubbleWidth: rect.width,
          bubbleHeight: rect.height,
        })
      )
    }

    updateGeometry()
    window.addEventListener('resize', updateGeometry)
    const observer =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(updateGeometry)
    observer?.observe(bubble)
    return () => {
      window.removeEventListener('resize', updateGeometry)
      observer?.disconnect()
    }
  }, [bubblePresentation, currentPage, isVisible, reservedBottomPx])

  if (!cleanedMessage || !isVisible) {
    return null
  }

  return (
    <aside
      ref={bubbleRef}
      className="td-assistant-bubble"
      style={bubbleStyle}
      aria-live="polite"
      aria-label="アシスタントの会話内容"
      data-variant={variant}
      data-text-density={bubbleTextDensity}
      data-page-count={pages.length || 1}
      data-page-index={pageIndex}
      data-timing-mode={bubblePresentation.timingMode}
      data-safe-area-clamped={String(placement?.clamped ?? false)}
      data-tail-side={bubblePresentation.tailSide}
      data-assistant-message-id={
        latestAssistantMessageEntry.id ?? 'assistant-message-id-unavailable'
      }
      data-projection-visual-speech-parity-v0={paritySummary.schema_version}
      data-speech-parity-status={paritySummary.parity_status}
      data-speech-bubble-text-scope={paritySummary.bubble_text_scope_class}
      data-speech-tts-provider-input-class={
        paritySummary.tts_provider_input_text_class
      }
      data-speech-heard-text-class={paritySummary.heard_text_class}
      data-speech-intended-text-hash={intendedTextSummary.text_hash}
      data-speech-intended-text-length={intendedTextSummary.text_length}
      data-speech-message-id-match={String(paritySummary.message_id_match)}
      data-speech-text-hash-match={String(paritySummary.text_hash_match)}
      data-speech-bubble-source-field={bubbleSummary.source_field}
      data-speech-bubble-message-id={
        bubbleSummary.message_id ?? 'assistant-message-id-unavailable'
      }
      data-speech-bubble-text-hash={bubbleSummary.text_hash}
      data-speech-bubble-text-length={bubbleSummary.text_length}
      data-speech-bubble-meaning-class={bubbleSummary.meaning_class}
      data-speech-tts-source-field={
        ttsSpeechOutputSummary?.source_field ?? 'tts-summary-unavailable'
      }
      data-speech-tts-message-id={
        ttsSpeechOutputSummary?.message_id ?? 'tts-message-id-unavailable'
      }
      data-speech-tts-text-hash={
        ttsSpeechOutputSummary?.text_hash ?? 'tts-text-hash-unavailable'
      }
      data-speech-tts-text-length={ttsSpeechOutputSummary?.text_length ?? 0}
      data-speech-tts-meaning-class={
        ttsSpeechOutputSummary?.meaning_class ?? 'tts-summary-unavailable'
      }
    >
      {showCharacterName && variant !== 'operator' && (
        <div className="td-assistant-bubble-name">{characterName}</div>
      )}
      <div className="td-assistant-bubble-text">{currentPage}</div>
      <span className="td-assistant-bubble-tail" aria-hidden="true" />
      <div
        ref={measureRef}
        className="td-assistant-bubble-text td-assistant-bubble-text-measure"
        aria-hidden="true"
      />
    </aside>
  )
}
