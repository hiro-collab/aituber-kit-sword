import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import {
  ProjectionEffectSurfacePool,
  type ProjectionEffectSurfaceAcquireResult,
  type ProjectionEffectSurfaceBackend,
  type ProjectionEffectSurfacePoolSnapshot,
  type ProjectionEffectSurfaceRequest,
} from './projectionEffectSurfacePool'

export type ProjectionEffectCompositorState =
  | 'unavailable'
  | 'idle'
  | 'running'
  | 'quarantined'
  | 'disposed'

export type ProjectionEffectCompositorOperationStatus =
  | 'completed'
  | 'already-running'
  | 'already-stopped'
  | 'compositor-unavailable'
  | 'compositor-disposed'
  | 'compositor-quarantined'
  | 'browser-boundary-failed'
  | 'cleanup-unproved'

export interface ProjectionEffectCompositorFrame {
  nowMs: number
  pool: ProjectionEffectSurfacePool
}

export type ProjectionEffectCompositorFrameCallback = (
  frame: Readonly<ProjectionEffectCompositorFrame>
) => Promise<void> | void

export interface ProjectionEffectCompositorSnapshot {
  state: ProjectionEffectCompositorState
  scheduledFrameCount: number
  completedFrameCount: number
  staleFrameRejectionCount: number
  frameFailureCount: number
  browserBoundaryFailureCount: number
  activeRequestCount: 0 | 1
  loopGeneration: number
  pool: ProjectionEffectSurfacePoolSnapshot | null
}

export interface ProjectionEffectCompositorController {
  acquireSurface<Backend extends ProjectionEffectSurfaceBackend>(
    request: ProjectionEffectSurfaceRequest<Backend>
  ):
    | ProjectionEffectSurfaceAcquireResult<Backend>
    | {
        status: 'compositor-unavailable'
        lease: null
      }
    | {
        status: 'compositor-quarantined'
        lease: null
      }
  startFrameLoop(
    callback: ProjectionEffectCompositorFrameCallback
  ): ProjectionEffectCompositorOperationStatus
  stopFrameLoop(): ProjectionEffectCompositorOperationStatus
  shutdown(): ProjectionEffectCompositorOperationStatus
  snapshot(): ProjectionEffectCompositorSnapshot
}

export interface ProjectionEffectCompositorProps {
  requestFrame?: (callback: FrameRequestCallback) => number
  cancelFrame?: (requestId: number) => void
  unmountPoolOwnership?: 'component' | 'external-deferred'
}

const MAX_LEDGER_COUNT = 1_000_000

export const ProjectionEffectCompositor = forwardRef<
  ProjectionEffectCompositorController,
  ProjectionEffectCompositorProps
>(function ProjectionEffectCompositor(
  {
    requestFrame = defaultRequestFrame,
    cancelFrame = defaultCancelFrame,
    unmountPoolOwnership = 'component',
  },
  forwardedRef
) {
  const webgl2CanvasRef = useRef<HTMLCanvasElement | null>(null)
  const canvas2dCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const poolRef = useRef<ProjectionEffectSurfacePool | null>(null)
  const mountedRef = useRef(false)
  const disposedRef = useRef(false)
  const quarantinedRef = useRef(false)
  const runningRef = useRef(false)
  const callbackRef = useRef<ProjectionEffectCompositorFrameCallback | null>(
    null
  )
  const requestIdRef = useRef<number | null>(null)
  const loopGenerationRef = useRef(0)
  const scheduledFrameCountRef = useRef(0)
  const completedFrameCountRef = useRef(0)
  const staleFrameRejectionCountRef = useRef(0)
  const frameFailureCountRef = useRef(0)
  const browserBoundaryFailureCountRef = useRef(0)
  const requestFrameRef = useRef(requestFrame)
  const cancelFrameRef = useRef(cancelFrame)
  const scheduleRef = useRef<
    (() => ProjectionEffectCompositorOperationStatus) | null
  >(null)
  const unmountPoolOwnershipRef = useRef(unmountPoolOwnership)
  const deferredPoolRef = useRef(false)

  requestFrameRef.current = requestFrame
  cancelFrameRef.current = cancelFrame
  unmountPoolOwnershipRef.current = unmountPoolOwnership

  const latchQuarantine = (): void => {
    if (!quarantinedRef.current) {
      loopGenerationRef.current = incrementBounded(loopGenerationRef.current)
    }
    quarantinedRef.current = true
    runningRef.current = false
    callbackRef.current = null
  }

  const isCompositorQuarantined = (): boolean => {
    if (poolRef.current?.snapshot().state === 'cleanup-unproved') {
      latchQuarantine()
    }
    return quarantinedRef.current
  }

  const stopFrameLoop = (): ProjectionEffectCompositorOperationStatus => {
    const quarantinedBeforeStop = isCompositorQuarantined()
    if (disposedRef.current) {
      return quarantinedBeforeStop
        ? 'compositor-quarantined'
        : 'compositor-disposed'
    }
    if (!runningRef.current && requestIdRef.current === null) {
      return quarantinedBeforeStop
        ? 'compositor-quarantined'
        : 'already-stopped'
    }
    runningRef.current = false
    callbackRef.current = null
    loopGenerationRef.current = incrementBounded(loopGenerationRef.current)
    let cancellationFailed = false
    if (requestIdRef.current !== null) {
      const requestId = requestIdRef.current
      try {
        cancelFrameRef.current(requestId)
      } catch {
        cancellationFailed = true
        latchQuarantine()
        browserBoundaryFailureCountRef.current = incrementBounded(
          browserBoundaryFailureCountRef.current
        )
      } finally {
        requestIdRef.current = null
      }
    }
    if (cancellationFailed) return 'browser-boundary-failed'
    return isCompositorQuarantined() ? 'compositor-quarantined' : 'completed'
  }

  const shutdown = (): ProjectionEffectCompositorOperationStatus => {
    const quarantinedBeforeShutdown = isCompositorQuarantined()
    const ownsDeferredPool = deferredPoolRef.current
    if (disposedRef.current && !ownsDeferredPool) {
      return quarantinedBeforeShutdown
        ? 'compositor-quarantined'
        : 'compositor-disposed'
    }
    const stopResult = ownsDeferredPool ? 'completed' : stopFrameLoop()
    const pool = poolRef.current
    if (!pool) return 'compositor-unavailable'
    const result = pool.dispose()
    if (result.status !== 'completed') {
      latchQuarantine()
      return 'cleanup-unproved'
    }
    if (ownsDeferredPool) {
      poolRef.current = null
      deferredPoolRef.current = false
    }
    disposedRef.current = true
    if (
      quarantinedBeforeShutdown ||
      stopResult === 'browser-boundary-failed' ||
      stopResult === 'compositor-quarantined' ||
      isCompositorQuarantined()
    ) {
      return 'compositor-quarantined'
    }
    return 'completed'
  }

  useEffect(() => {
    const webgl2Canvas = webgl2CanvasRef.current
    const canvas2dCanvas = canvas2dCanvasRef.current
    if (!webgl2Canvas || !canvas2dCanvas) return

    mountedRef.current = true
    disposedRef.current = false
    poolRef.current = new ProjectionEffectSurfacePool({
      webgl2Canvas,
      canvas2dCanvas,
    })

    const schedule = (): ProjectionEffectCompositorOperationStatus => {
      if (isCompositorQuarantined()) return 'compositor-quarantined'
      if (
        !mountedRef.current ||
        disposedRef.current ||
        !runningRef.current ||
        requestIdRef.current !== null
      ) {
        return 'already-running'
      }
      const scheduledGeneration = loopGenerationRef.current
      try {
        const requestId = requestFrameRef.current((nowMs) => {
          requestIdRef.current = null
          if (
            !mountedRef.current ||
            disposedRef.current ||
            !runningRef.current ||
            scheduledGeneration !== loopGenerationRef.current
          ) {
            staleFrameRejectionCountRef.current = incrementBounded(
              staleFrameRejectionCountRef.current
            )
            return
          }
          const callback = callbackRef.current
          const pool = poolRef.current
          if (!callback || !pool) return
          scheduledFrameCountRef.current = incrementBounded(
            scheduledFrameCountRef.current
          )
          Promise.resolve()
            .then(() => callback({ nowMs, pool }))
            .then(() => {
              completedFrameCountRef.current = incrementBounded(
                completedFrameCountRef.current
              )
            })
            .catch(() => {
              frameFailureCountRef.current = incrementBounded(
                frameFailureCountRef.current
              )
            })
            .finally(() => {
              if (
                mountedRef.current &&
                !disposedRef.current &&
                runningRef.current &&
                scheduledGeneration === loopGenerationRef.current
              ) {
                schedule()
              }
            })
        })
        if (!Number.isInteger(requestId) || requestId < 0) {
          throw new Error('invalid animation frame request')
        }
        requestIdRef.current = requestId
        return 'completed'
      } catch {
        requestIdRef.current = null
        latchQuarantine()
        browserBoundaryFailureCountRef.current = incrementBounded(
          browserBoundaryFailureCountRef.current
        )
        return 'browser-boundary-failed'
      }
    }
    scheduleRef.current = schedule

    return () => {
      mountedRef.current = false
      runningRef.current = false
      callbackRef.current = null
      loopGenerationRef.current = incrementBounded(loopGenerationRef.current)
      const deferPoolDisposal =
        unmountPoolOwnershipRef.current === 'external-deferred'
      const finishUnmount = (): void => {
        const pool = poolRef.current
        if (deferPoolDisposal) {
          deferredPoolRef.current = pool !== null
        } else {
          if (pool && pool.dispose().status !== 'completed') {
            latchQuarantine()
          }
          poolRef.current = null
        }
        scheduleRef.current = null
        disposedRef.current = true
      }

      if (requestIdRef.current !== null) {
        const requestId = requestIdRef.current
        try {
          cancelFrameRef.current(requestId)
        } catch {
          latchQuarantine()
          browserBoundaryFailureCountRef.current = incrementBounded(
            browserBoundaryFailureCountRef.current
          )
        } finally {
          requestIdRef.current = null
          finishUnmount()
        }
        return
      }
      finishUnmount()
    }
  }, [])

  useImperativeHandle(
    forwardedRef,
    () => ({
      acquireSurface(request) {
        const pool = poolRef.current
        if (isCompositorQuarantined()) {
          return { status: 'compositor-quarantined', lease: null }
        }
        if (!pool || disposedRef.current) {
          return { status: 'compositor-unavailable', lease: null }
        }
        return pool.acquire(request)
      },
      startFrameLoop(callback) {
        if (isCompositorQuarantined()) return 'compositor-quarantined'
        if (disposedRef.current) return 'compositor-disposed'
        if (!poolRef.current || !mountedRef.current) {
          return 'compositor-unavailable'
        }
        if (runningRef.current) return 'already-running'
        runningRef.current = true
        callbackRef.current = callback
        loopGenerationRef.current = incrementBounded(loopGenerationRef.current)
        return scheduleRef.current?.() ?? 'compositor-unavailable'
      },
      stopFrameLoop,
      shutdown,
      snapshot: () => ({
        state: resolveState(
          poolRef.current,
          isCompositorQuarantined(),
          disposedRef.current,
          runningRef.current
        ),
        scheduledFrameCount: scheduledFrameCountRef.current,
        completedFrameCount: completedFrameCountRef.current,
        staleFrameRejectionCount: staleFrameRejectionCountRef.current,
        frameFailureCount: frameFailureCountRef.current,
        browserBoundaryFailureCount: browserBoundaryFailureCountRef.current,
        activeRequestCount: requestIdRef.current === null ? 0 : 1,
        loopGeneration: loopGenerationRef.current,
        pool: poolRef.current?.snapshot() ?? null,
      }),
    }),
    []
  )

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0"
      data-testid="projection-effect-compositor"
      style={{ isolation: 'isolate' }}
    >
      <canvas
        ref={webgl2CanvasRef}
        className="absolute inset-0 h-full w-full"
        data-effect-surface-backend="webgl2"
        data-testid="projection-effect-webgl2-canvas"
        style={{ mixBlendMode: 'screen', zIndex: 0 }}
      />
      <canvas
        ref={canvas2dCanvasRef}
        className="absolute inset-0 h-full w-full"
        data-effect-surface-backend="canvas2d"
        data-testid="projection-effect-canvas2d-canvas"
        style={{ mixBlendMode: 'screen', zIndex: 1 }}
      />
    </div>
  )
})

function resolveState(
  pool: ProjectionEffectSurfacePool | null,
  quarantined: boolean,
  disposed: boolean,
  running: boolean
): ProjectionEffectCompositorState {
  if (quarantined) return 'quarantined'
  if (disposed) return 'disposed'
  if (!pool) return 'unavailable'
  return running ? 'running' : 'idle'
}

function defaultRequestFrame(callback: FrameRequestCallback): number {
  return window.requestAnimationFrame(callback)
}

function defaultCancelFrame(requestId: number): void {
  window.cancelAnimationFrame(requestId)
}

function incrementBounded(value: number): number {
  return Math.min(MAX_LEDGER_COUNT, value + 1)
}
