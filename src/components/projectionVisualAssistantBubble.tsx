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
  writeWindowSpeechOutputParitySummary,
  type SpeechOutputDisplayState,
  type SpeechOutputSummary,
} from '@/utils/speechOutputParitySummary'

const MAX_OPERATOR_VISIBLE_LINES = 6
const MAX_PASSIVE_VISIBLE_LINES = 3
const PAGE_READ_MS = 12000
const MEASURE_EPSILON_PX = 2

type BubblePage = {
  text: string
}

type ProjectionVisualAssistantBubbleProps = {
  variant?: 'operator' | 'passive' | 'stage-output'
}

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
  const [operatorSpeechOutputDisplayState, setOperatorSpeechOutputDisplayState] =
    useState<SpeechOutputDisplayState | null>(() =>
      readWindowSpeechOutputDisplayState()
    )
  const characterName = settingsStore((s) => s.characterName)
  const showCharacterName = settingsStore((s) => s.showCharacterName)
  const poseConfigs = settingsStore((s) => s.poseConfigs)
  const measureRef = useRef<HTMLDivElement | null>(null)
  const [pages, setPages] = useState<BubblePage[]>([])
  const [pageIndex, setPageIndex] = useState(0)
  const shouldUseProjectionDisplayMessage =
    variant === 'stage-output' ||
    (variant === 'passive' && Boolean(passiveAssistantMessage))
  const latestChatAssistantMessageEntry = getLatestAssistantMessageEntry(chatLog)
  const shouldUseOperatorSpeechDisplayMessage =
    variant === 'operator' &&
    Boolean(operatorSpeechOutputDisplayState?.display_message) &&
    (!latestChatAssistantMessageEntry.id ||
      operatorSpeechOutputDisplayState?.message_id ===
        latestChatAssistantMessageEntry.id)
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
  const bubbleSourceField = shouldUseProjectionDisplayMessage
    ? 'projectionDisplayStore.assistantMessage'
    : shouldUseOperatorSpeechDisplayMessage
      ? 'speechOutputDisplayState.display_message'
      : 'homeStore.chatLog.latestAssistantMessage'
  const bubbleSummary = useMemo(
    () =>
      buildSpeechOutputSummary({
        surface: 'projection_visual_assistant_bubble',
        sourceField: bubbleSourceField,
        message: currentPage,
        messageId: latestAssistantMessageEntry.id,
      }),
    [bubbleSourceField, currentPage, latestAssistantMessageEntry.id]
  )
  const [operatorSpeechOutputSummary, setOperatorSpeechOutputSummary] =
    useState<SpeechOutputSummary | null>(() => readWindowSpeechOutputSummary())
  const ttsSpeechOutputSummary = shouldUseProjectionDisplayMessage
    ? passiveSpeechOutputSummary
    : operatorSpeechOutputSummary
  const paritySummary = useMemo(
    () => compareSpeechOutputSummaries(bubbleSummary, ttsSpeechOutputSummary),
    [bubbleSummary, ttsSpeechOutputSummary]
  )
  const maxVisibleLines =
    variant === 'operator'
      ? MAX_OPERATOR_VISIBLE_LINES
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
    }, PAGE_READ_MS)

    return () => {
      window.clearTimeout(timer)
    }
  }, [pageIndex, pages.length])

  if (!cleanedMessage) {
    return null
  }

  return (
    <aside
      className="td-assistant-bubble"
      aria-live="polite"
      data-variant={variant}
      data-page-count={pages.length || 1}
      data-page-index={pageIndex}
      data-assistant-message-id={
        latestAssistantMessageEntry.id ?? 'assistant-message-id-unavailable'
      }
      data-projection-visual-speech-parity-v0={paritySummary.schema_version}
      data-speech-parity-status={paritySummary.parity_status}
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
      {showCharacterName && (
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
