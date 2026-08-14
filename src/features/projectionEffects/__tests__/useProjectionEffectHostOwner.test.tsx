import { act, renderHook, waitFor } from '@testing-library/react'
import {
  PROJECTION_EFFECT_HOST_LOCK_NAME,
  type ProjectionEffectLockManager,
  useProjectionEffectHostOwner,
} from '../browser/useProjectionEffectHostOwner'

type PendingLock = {
  signal: AbortSignal
  callback: (lock: Readonly<{ name: string }> | null) => Promise<void>
  resolve: () => void
  reject: (error: unknown) => void
  started: boolean
}

class FakeExclusiveLockManager implements ProjectionEffectLockManager {
  readonly requests: string[] = []
  private active = false
  private readonly pending: PendingLock[] = []

  request(
    name: string,
    options: Readonly<{ mode: 'exclusive'; signal: AbortSignal }>,
    callback: (lock: Readonly<{ name: string }> | null) => Promise<void>
  ): Promise<void> {
    this.requests.push(name)
    return new Promise<void>((resolve, reject) => {
      const entry: PendingLock = {
        signal: options.signal,
        callback,
        resolve,
        reject,
        started: false,
      }
      options.signal.addEventListener(
        'abort',
        () => {
          if (entry.started) return
          const index = this.pending.indexOf(entry)
          if (index >= 0) this.pending.splice(index, 1)
          reject(new DOMException('aborted', 'AbortError'))
        },
        { once: true }
      )
      this.pending.push(entry)
      this.drain()
    })
  }

  private drain() {
    if (this.active) return
    const entry = this.pending.shift()
    if (!entry) return
    if (entry.signal.aborted) {
      entry.reject(new DOMException('aborted', 'AbortError'))
      this.drain()
      return
    }
    this.active = true
    entry.started = true
    void entry
      .callback({ name: PROJECTION_EFFECT_HOST_LOCK_NAME })
      .then(entry.resolve, entry.reject)
      .finally(() => {
        this.active = false
        this.drain()
      })
  }
}

describe('useProjectionEffectHostOwner', () => {
  it('keeps one owner and hands the exclusive lease to the next eligible tab', async () => {
    const manager = new FakeExclusiveLockManager()
    const readLockManager = () => manager
    const first = renderHook(() =>
      useProjectionEffectHostOwner({ enabled: true, readLockManager })
    )
    const second = renderHook(() =>
      useProjectionEffectHostOwner({ enabled: true, readLockManager })
    )

    await waitFor(() => expect(first.result.current.state).toBe('owner'))
    expect(second.result.current.state).toBe('waiting')
    expect(manager.requests).toEqual([
      PROJECTION_EFFECT_HOST_LOCK_NAME,
      PROJECTION_EFFECT_HOST_LOCK_NAME,
    ])

    act(() => first.unmount())
    await waitFor(() => expect(second.result.current.state).toBe('owner'))
    second.unmount()
  })

  it('fails closed when Web Locks are unavailable', () => {
    const { result } = renderHook(() =>
      useProjectionEffectHostOwner({
        enabled: true,
        readLockManager: () => null,
      })
    )

    expect(result.current).toEqual({ state: 'unsupported', isOwner: false })
  })

  it('does not request a lock for passive or otherwise ineligible surfaces', () => {
    const manager = new FakeExclusiveLockManager()
    const { result } = renderHook(() =>
      useProjectionEffectHostOwner({
        enabled: false,
        readLockManager: () => manager,
      })
    )

    expect(result.current).toEqual({ state: 'disabled', isOwner: false })
    expect(manager.requests).toEqual([])
  })
})
