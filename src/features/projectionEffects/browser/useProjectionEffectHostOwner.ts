import { useEffect, useState } from 'react'

export const PROJECTION_EFFECT_HOST_LOCK_NAME =
  'aituber-kit-projection-effect-host-v1'

export type ProjectionEffectHostOwnerState =
  | 'disabled'
  | 'unsupported'
  | 'waiting'
  | 'owner'

type ProjectionEffectLock = Readonly<{ name: string }>

export type ProjectionEffectLockManager = Readonly<{
  request: (
    name: string,
    options: Readonly<{ mode: 'exclusive'; signal: AbortSignal }>,
    callback: (lock: ProjectionEffectLock | null) => Promise<void>
  ) => Promise<void>
}>

type ProjectionEffectLockManagerReader =
  () => ProjectionEffectLockManager | null

const browserLockManager: ProjectionEffectLockManagerReader = () => {
  if (typeof navigator === 'undefined') return null
  const lockManager = (
    navigator as Navigator & { locks?: ProjectionEffectLockManager }
  ).locks
  return lockManager ?? null
}

export const useProjectionEffectHostOwner = ({
  enabled,
  readLockManager = browserLockManager,
}: {
  enabled: boolean
  readLockManager?: ProjectionEffectLockManagerReader
}) => {
  const [state, setState] = useState<ProjectionEffectHostOwnerState>(
    enabled ? 'waiting' : 'disabled'
  )

  useEffect(() => {
    if (!enabled) {
      // Eligibility can change after router hydration. Reset the externally
      // observed lease state before any later lock callback can run.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setState('disabled')
      return
    }
    const lockManager = readLockManager()
    if (!lockManager) {
      setState('unsupported')
      return
    }

    const abortController = new AbortController()
    let active = true
    let releaseOwner: (() => void) | null = null
    setState('waiting')

    void lockManager
      .request(
        PROJECTION_EFFECT_HOST_LOCK_NAME,
        { mode: 'exclusive', signal: abortController.signal },
        async (lock) => {
          if (!active || !lock) return
          setState('owner')
          await new Promise<void>((resolve) => {
            releaseOwner = resolve
          })
        }
      )
      .catch((error: unknown) => {
        if (!active) return
        if (error instanceof DOMException && error.name === 'AbortError') return
        setState('unsupported')
      })

    return () => {
      active = false
      abortController.abort()
      releaseOwner?.()
    }
  }, [enabled, readLockManager])

  return {
    state,
    isOwner: state === 'owner',
  } as const
}
