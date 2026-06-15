export const DEFAULT_COMMENT_TEXT_COLOR = '#39FF88'
export const DEFAULT_COMMENT_TEXT_SIZE_PX = 20
export const MIN_COMMENT_TEXT_SIZE_PX = 12
export const MAX_COMMENT_TEXT_SIZE_PX = 48
export const COMMENT_TEXT_MAX_LINES = 4
export const MIN_COMMENT_PAGE_DURATION_MS = 2500
export const MAX_COMMENT_PAGE_DURATION_MS = 8000
export const COMMENT_PAGE_DURATION_MS_PER_CHAR = 120

export const COMMENT_COLOR_PRESETS = [
  DEFAULT_COMMENT_TEXT_COLOR,
  '#00D7FF',
  '#FF2BD6',
  '#FACC15',
  '#FF7A45',
  '#FFFFFF',
] as const

export const clampCommentTextSize = (value: number) =>
  Math.min(
    MAX_COMMENT_TEXT_SIZE_PX,
    Math.max(MIN_COMMENT_TEXT_SIZE_PX, Math.round(value))
  )

export const normalizeHexColor = (value?: string) => {
  if (!value) return undefined

  const trimmed = value.trim()
  const match = trimmed.match(/^#?([0-9a-fA-F]{6})$/)
  if (!match) return undefined

  return `#${match[1].toUpperCase()}`
}

export const getCommentTextColor = (value?: string) =>
  normalizeHexColor(value) || DEFAULT_COMMENT_TEXT_COLOR

export const getReadableTextColor = (backgroundColor: string) => {
  const normalized = normalizeHexColor(backgroundColor)
  if (!normalized) return '#03101C'

  const red = parseInt(normalized.slice(1, 3), 16)
  const green = parseInt(normalized.slice(3, 5), 16)
  const blue = parseInt(normalized.slice(5, 7), 16)
  const brightness = (red * 299 + green * 587 + blue * 114) / 1000

  return brightness > 150 ? '#03101C' : '#FFFFFF'
}

export const getCommentPageDurationMs = (text: string) => {
  const readableLength = text.replace(/\s/g, '').length

  return Math.round(
    Math.min(
      MAX_COMMENT_PAGE_DURATION_MS,
      Math.max(
        MIN_COMMENT_PAGE_DURATION_MS,
        readableLength * COMMENT_PAGE_DURATION_MS_PER_CHAR
      )
    )
  )
}
