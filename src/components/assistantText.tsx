import { useEffect, useMemo, useRef, useState } from 'react'

import settingsStore from '@/features/stores/settings'
import { EMOTIONS } from '@/features/messages/messages'
import {
  COMMENT_TEXT_MAX_LINES,
  clampCommentTextSize,
  getCommentPageDurationMs,
  getCommentTextColor,
  getReadableTextColor,
} from '@/utils/commentDisplayStyle'

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

const splitBoundaryPattern = /[\n。！？!?、, ]/

const arePagesEqual = (left: string[], right: string[]) =>
  left.length === right.length &&
  left.every((page, index) => page === right[index])

const findReadablePageEnd = (text: string, start: number, maxEnd: number) => {
  const pageLength = maxEnd - start
  const minBoundary = start + Math.max(12, Math.floor(pageLength * 0.55))

  for (let index = maxEnd; index > minBoundary; index--) {
    if (splitBoundaryPattern.test(text[index - 1])) {
      return index
    }
  }

  return maxEnd
}

const paginateByMeasuredHeight = (
  text: string,
  measureElement: HTMLDivElement,
  maxHeight: number
) => {
  const source = text.trim()
  if (!source) return ['']

  const fits = (value: string) => {
    measureElement.textContent = value || ' '
    return measureElement.scrollHeight <= maxHeight
  }

  if (fits(source)) return [source]

  const pages: string[] = []
  let start = 0

  while (start < source.length && pages.length < 100) {
    let low = 1
    let high = source.length - start
    let bestLength = 1

    while (low <= high) {
      const middle = Math.floor((low + high) / 2)
      const candidate = source.slice(start, start + middle).trim()

      if (fits(candidate)) {
        bestLength = middle
        low = middle + 1
      } else {
        high = middle - 1
      }
    }

    const maxEnd = start + bestLength
    const readableEnd = findReadablePageEnd(source, start, maxEnd)
    const nextEnd = Math.max(start + 1, readableEnd)
    const page = source.slice(start, nextEnd).trim()

    if (page) {
      pages.push(page)
    }

    start = nextEnd
    while (source[start] && /\s/.test(source[start])) {
      start++
    }
  }

  if (start < source.length) {
    pages.push(source.slice(start).trim())
  }

  return pages.length ? pages : [source]
}

export const AssistantText = ({ message }: { message: string }) => {
  const measureRef = useRef<HTMLDivElement>(null)
  const textAreaRef = useRef<HTMLDivElement>(null)
  const paginationSignatureRef = useRef('')
  const [pages, setPages] = useState<string[]>([])
  const [pageIndex, setPageIndex] = useState(0)

  const characterName = settingsStore((s) => s.characterName)
  const showCharacterName = settingsStore((s) => s.showCharacterName)
  const showPresetQuestions = settingsStore((s) => s.showPresetQuestions)
  const presetQuestions = settingsStore((s) => s.presetQuestions)
  const poseConfigs = settingsStore((s) => s.poseConfigs)
  const commentTextColor = getCommentTextColor(
    settingsStore((s) => s.commentTextColor)
  )
  const commentTextSizePx = clampCommentTextSize(
    settingsStore((s) => s.commentTextSizePx)
  )
  const commentHeaderTextColor = getReadableTextColor(commentTextColor)
  const commentHeaderTextSizePx = Math.max(12, commentTextSizePx - 4)
  const textLineHeight = 1.5
  const maxTextHeightPx = Math.ceil(
    commentTextSizePx * textLineHeight * COMMENT_TEXT_MAX_LINES
  )
  const motionPattern = useMemo(
    () => buildMotionPattern(poseConfigs.map((pose) => pose.id)),
    [poseConfigs]
  )
  const cleanedMessage = useMemo(
    () => message.replace(emotionPattern, '').replace(motionPattern, '').trim(),
    [message, motionPattern]
  )

  // Check if preset questions should be shown AND there are actual questions
  const shouldShowPresetQuestions =
    showPresetQuestions && presetQuestions.length > 0
  const safePageIndex = Math.min(pageIndex, Math.max(0, pages.length - 1))
  const currentPage = pages[safePageIndex] || cleanedMessage

  useEffect(() => {
    const measureElement = measureRef.current
    const textAreaElement = textAreaRef.current
    if (!measureElement || !textAreaElement) {
      return
    }

    const updatePages = () => {
      const nextPages = paginateByMeasuredHeight(
        cleanedMessage,
        measureElement,
        maxTextHeightPx
      )
      const nextSignature = nextPages.join('\u0000')

      if (paginationSignatureRef.current === nextSignature) return

      paginationSignatureRef.current = nextSignature
      setPages((currentPages) =>
        arePagesEqual(currentPages, nextPages) ? currentPages : nextPages
      )
      setPageIndex(0)
    }

    updatePages()

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updatePages)
      return () => window.removeEventListener('resize', updatePages)
    }

    const observer = new ResizeObserver(updatePages)
    observer.observe(textAreaElement)

    return () => observer.disconnect()
  }, [cleanedMessage, maxTextHeightPx])

  useEffect(() => {
    if (pages.length <= 1 || safePageIndex >= pages.length - 1) return

    const timeoutId = window.setTimeout(
      () => {
        setPageIndex((currentIndex) =>
          Math.min(currentIndex + 1, pages.length - 1)
        )
      },
      getCommentPageDurationMs(pages[safePageIndex] || '')
    )

    return () => window.clearTimeout(timeoutId)
  }, [pages, safePageIndex])

  return (
    <div
      className={`absolute bottom-0 left-0 ${shouldShowPresetQuestions ? 'mb-[140px] sm:mb-[180px]' : 'mb-[64px] sm:mb-[80px]'} w-full z-10`}
    >
      <div className="mx-auto max-w-4xl w-full p-2 sm:p-4">
        <div className="bg-white rounded-lg">
          {showCharacterName && (
            <div
              className="px-3 sm:px-6 py-2 rounded-t-lg font-bold tracking-wider"
              style={{
                backgroundColor: commentTextColor,
                color: commentHeaderTextColor,
                fontSize: `${commentHeaderTextSizePx}px`,
                lineHeight: 1.35,
              }}
            >
              {characterName}
            </div>
          )}
          <div ref={textAreaRef} className="relative px-3 sm:px-6 py-4">
            <div
              className="font-bold whitespace-pre-wrap break-words overflow-hidden"
              style={{
                color: commentTextColor,
                fontSize: `${commentTextSizePx}px`,
                lineHeight: textLineHeight,
                minHeight: `${maxTextHeightPx}px`,
              }}
            >
              {currentPage}
            </div>
            <div
              ref={measureRef}
              aria-hidden="true"
              className="absolute left-3 right-3 top-4 sm:left-6 sm:right-6 font-bold whitespace-pre-wrap break-words pointer-events-none"
              style={{
                color: commentTextColor,
                fontSize: `${commentTextSizePx}px`,
                lineHeight: textLineHeight,
                visibility: 'hidden',
              }}
            >
              {cleanedMessage}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
