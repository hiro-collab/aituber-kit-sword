export const AVATAR_LIGHTING_CONTRIBUTION_MAX_AGE_MS = 500

export type AvatarLightingWarmthClass = 'neutral' | 'warm'

export interface AvatarLightingContribution {
  status: 'neutral' | 'active'
  intensityScale: number
  warmthClass: AvatarLightingWarmthClass
}

export const NEUTRAL_AVATAR_LIGHTING_CONTRIBUTION = Object.freeze({
  status: 'neutral',
  intensityScale: 1,
  warmthClass: 'neutral',
}) satisfies Readonly<AvatarLightingContribution>

const ALLOWED_KEYS = new Set(['status', 'intensityScale', 'warmthClass'])
const MIN_INTENSITY_SCALE = 1
const MAX_INTENSITY_SCALE = 1.5

type AvatarLightingListener = (
  contribution: Readonly<AvatarLightingContribution>
) => void

let currentContribution: Readonly<AvatarLightingContribution> =
  NEUTRAL_AVATAR_LIGHTING_CONTRIBUTION
let expiryTimer: ReturnType<typeof setTimeout> | null = null
const listeners = new Set<AvatarLightingListener>()

export function isAvatarLightingContribution(
  value: unknown
): value is AvatarLightingContribution {
  if (!isPlainRecord(value)) return false
  if (Object.keys(value).some((key) => !ALLOWED_KEYS.has(key))) return false
  if (Object.keys(value).length !== ALLOWED_KEYS.size) return false
  if (value.status !== 'neutral' && value.status !== 'active') return false
  if (
    typeof value.intensityScale !== 'number' ||
    !Number.isFinite(value.intensityScale) ||
    value.intensityScale < MIN_INTENSITY_SCALE ||
    value.intensityScale > MAX_INTENSITY_SCALE
  ) {
    return false
  }
  if (value.warmthClass !== 'neutral' && value.warmthClass !== 'warm') {
    return false
  }
  if (
    value.status === 'neutral' &&
    (value.intensityScale !== 1 || value.warmthClass !== 'neutral')
  ) {
    return false
  }
  return true
}

export function publishAvatarLightingContribution(value: unknown): boolean {
  if (!isAvatarLightingContribution(value)) {
    resetAvatarLightingContribution()
    return false
  }

  const next = Object.freeze({
    status: value.status,
    intensityScale: value.intensityScale,
    warmthClass: value.warmthClass,
  }) satisfies Readonly<AvatarLightingContribution>
  setCurrentContribution(next)
  scheduleExpiry(next)
  return true
}

export function resetAvatarLightingContribution(): void {
  clearExpiryTimer()
  setCurrentContribution(NEUTRAL_AVATAR_LIGHTING_CONTRIBUTION)
}

export function getAvatarLightingContribution(): Readonly<AvatarLightingContribution> {
  return currentContribution
}

export function subscribeToAvatarLightingContribution(
  listener: AvatarLightingListener
): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function scheduleExpiry(
  contribution: Readonly<AvatarLightingContribution>
): void {
  clearExpiryTimer()
  if (contribution.status !== 'active') return
  expiryTimer = setTimeout(() => {
    expiryTimer = null
    setCurrentContribution(NEUTRAL_AVATAR_LIGHTING_CONTRIBUTION)
  }, AVATAR_LIGHTING_CONTRIBUTION_MAX_AGE_MS)
}

function clearExpiryTimer(): void {
  if (expiryTimer === null) return
  clearTimeout(expiryTimer)
  expiryTimer = null
}

function setCurrentContribution(
  contribution: Readonly<AvatarLightingContribution>
): void {
  if (sameContribution(currentContribution, contribution)) return
  currentContribution = contribution
  for (const listener of listeners) {
    listener(currentContribution)
  }
}

function sameContribution(
  left: Readonly<AvatarLightingContribution>,
  right: Readonly<AvatarLightingContribution>
): boolean {
  return (
    left.status === right.status &&
    left.intensityScale === right.intensityScale &&
    left.warmthClass === right.warmthClass
  )
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  )
}
