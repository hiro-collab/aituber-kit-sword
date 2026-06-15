import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

const OWNER_STORAGE_KEY = 'aituber-kit-browser-control-owner-v1'
const TAB_ID_STORAGE_KEY = 'aituber-kit-browser-control-tab-id-v1'
const HEARTBEAT_MS = 1000
const OWNER_TTL_MS = 4500

export type BrowserControlOwner = {
  tabId: string
  label: string
  route: string
  priority: number
  updatedAt: number
}

type Options = {
  label: string
  route: string
  priority: number
  enabled?: boolean
}

const isBrowser = () => typeof window !== 'undefined'

const createTabId = () => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

const getTabId = () => {
  if (!isBrowser()) return ''

  try {
    const saved = sessionStorage.getItem(TAB_ID_STORAGE_KEY)
    if (saved) return saved

    const tabId = createTabId()
    sessionStorage.setItem(TAB_ID_STORAGE_KEY, tabId)
    return tabId
  } catch {
    return createTabId()
  }
}

const readOwner = (): BrowserControlOwner | null => {
  if (!isBrowser()) return null

  try {
    const raw = localStorage.getItem(OWNER_STORAGE_KEY)
    if (!raw) return null

    const parsed = JSON.parse(raw) as Partial<BrowserControlOwner>
    if (
      typeof parsed.tabId !== 'string' ||
      typeof parsed.label !== 'string' ||
      typeof parsed.route !== 'string' ||
      typeof parsed.priority !== 'number' ||
      typeof parsed.updatedAt !== 'number'
    ) {
      return null
    }

    return parsed as BrowserControlOwner
  } catch {
    return null
  }
}

const writeOwner = (owner: BrowserControlOwner) => {
  localStorage.setItem(OWNER_STORAGE_KEY, JSON.stringify(owner))
}

const ownerIsExpired = (owner: BrowserControlOwner | null, now = Date.now()) =>
  !owner || now - owner.updatedAt > OWNER_TTL_MS

export const useBrowserControlOwner = ({
  label,
  route,
  priority,
  enabled = true,
}: Options) => {
  const [tabId] = useState(getTabId)
  const [owner, setOwner] = useState<BrowserControlOwner | null>(null)
  const tabIdRef = useRef(tabId)

  const claim = useCallback(
    (force = false) => {
      if (!enabled || !tabIdRef.current || !isBrowser()) return

      const now = Date.now()
      const current = readOwner()
      const canClaim =
        force ||
        ownerIsExpired(current, now) ||
        current?.tabId === tabIdRef.current ||
        priority > (current?.priority ?? -1)

      if (canClaim) {
        const nextOwner = {
          tabId: tabIdRef.current,
          label,
          route,
          priority,
          updatedAt: now,
        }
        writeOwner(nextOwner)
        setOwner(nextOwner)
      } else {
        setOwner(current)
      }
    },
    [enabled, label, priority, route]
  )

  useEffect(() => {
    if (!enabled || !tabId) return

    claim()
    const intervalId = window.setInterval(() => claim(), HEARTBEAT_MS)

    const onStorage = (event: StorageEvent) => {
      if (event.key === OWNER_STORAGE_KEY) {
        setOwner(readOwner())
      }
    }

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        claim()
      }
    }

    const releaseIfOwned = () => {
      const current = readOwner()
      if (current?.tabId === tabIdRef.current) {
        localStorage.removeItem(OWNER_STORAGE_KEY)
      }
    }

    window.addEventListener('storage', onStorage)
    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('beforeunload', releaseIfOwned)

    return () => {
      window.clearInterval(intervalId)
      window.removeEventListener('storage', onStorage)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('beforeunload', releaseIfOwned)
      releaseIfOwned()
    }
  }, [claim, enabled, tabId])

  return useMemo(
    () => ({
      isOwner: owner?.tabId === tabId,
      owner,
      ready: Boolean(tabId),
      takeControl: () => claim(true),
    }),
    [claim, owner, tabId]
  )
}
