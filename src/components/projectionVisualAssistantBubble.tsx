import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

import homeStore from '@/features/stores/home'
import projectionDisplayStore from '@/features/stores/projectionDisplay'
import settingsStore from '@/features/stores/settings'
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
const MIN_PAGE_READ_MS = 12000
const MAX_PAGE_READ_MS = 36000
const PAGE_READ_MS_PER_CHARACTER = 160
const MEASURE_EPSILON_PX = 2

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
  Math.min(
    MAX_PAGE_READ_MS,
    Math.max(
      MIN_PAGE_READ_MS,
      Array.from(text).length * PAGE_READ_MS_PER_CHARACTER
    )
  )

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
  const measureRef = useRef<HTMLDivElement | null>(null)
  const [pages, setPages] = useState<BubblePage[]>([])
  const [pageIndex, setPageIndex] = useState(0)
  const shouldUseProjectionDisplayMessage =
    variant === 'stage-output' ||
    (variant === 'passive' && Boolean(passiveAssistantMessage))
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
  const currentPage = pages[pageIndex]?.text ?? cleanedMessage
  const bubbleTextDensity = resolveProjectionVisualBubbleTextDensity(
    cleanedMessage,
    variant
  )
  const currentPageReadMs = resolveProjectionVisualBubblePageReadMs(currentPage)
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
  const maxVisibleLines =
    variant === 'operator'
      ? bubbleTextDensity === 'dense'
        ? MAX_OPERATOR_DENSE_VISIBLE_LINES
        : bubbleTextDensity === 'compact'
          ? MAX_OPERATOR_COMPACT_VISIBLE_LINES
          : MAX_OPERATOR_COMFORTABLE_VISIBLE_LINES
      : MAX_PASSIVE_VISIBLE_LINES

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
    if (!measureElement || !cleanedMessage) {
      setPages([])
      setPageIndex(0)
      return
    }

    const updatePages = () => {
      const nextPages = paginateMeasuredText(
        cleanedMessage,
        measureElement,
        maxVisibleLines
      )
      setPages(nextPages)
      setPageIndex(0)
    }

    updatePages()
    window.addEventListener('resize', updatePages)

    return () => {
      window.removeEventListener('resize', updatePages)
    }
  }, [cleanedMessage, maxVisibleLines])

  useEffect(() => {
    if (pages.length <= 1) {
      return
    }

    const timer = window.setTimeout(() => {
      setPageIndex((current) => (current + 1) % pages.length)
    }, currentPageReadMs)

    return () => {
      window.clearTimeout(timer)
    }
  }, [currentPageReadMs, pageIndex, pages.length])

  if (!cleanedMessage) {
    return null
  }

  return (
    <aside
      className="td-assistant-bubble"
      aria-live="polite"
      aria-label="アシスタントの会話内容"
      data-variant={variant}
      data-text-density={bubbleTextDensity}
      data-page-count={pages.length || 1}
      data-page-index={pageIndex}
      data-page-read-ms={currentPageReadMs}
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
      <div
        ref={measureRef}
        className="td-assistant-bubble-text td-assistant-bubble-text-measure"
        aria-hidden="true"
      />
    </aside>
  )
}
