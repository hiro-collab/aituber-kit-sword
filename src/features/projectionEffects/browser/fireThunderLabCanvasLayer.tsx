import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import {
  PROJECTION_EFFECT_COMMAND_SCHEMA_VERSION,
  type ProjectionEffectResetCommand,
  type ProjectionEffectStartCommand,
  type ProjectionEffectStopCommand,
} from '../effectCommand'
import type { ProjectionEffectHostResult } from '../effectHost'
import {
  createFireThunderLabHost,
  type FireThunderLabEffectId,
} from '../lab/fireThunderLabRegistry'
import { FIRE_EFFECT_ID } from '../plugins/fire/definition'
import {
  FireWebGl2Surface,
  type FireParticleSurface,
} from '../plugins/fire/renderer'
import { THUNDER_BALL_EFFECT_ID } from '../plugins/thunderBall/definition'
import type {
  ThunderBallFrame,
  ThunderBallSurface,
} from '../plugins/thunderBall/renderer'

export interface FireThunderLabController {
  start(
    effectId: FireThunderLabEffectId
  ): Promise<ProjectionEffectHostResult | null>
  stop(): Promise<ProjectionEffectHostResult | null>
  reset(): Promise<ProjectionEffectHostResult | null>
  emergencyStop(): Promise<ProjectionEffectHostResult | null>
}

export interface FireThunderLabCanvasLayerProps {
  reducedMotion?: boolean
  webgl2Available?: boolean
  waitFrame?: (durationMs: number) => Promise<void>
  createFireSurface?: (canvas: HTMLCanvasElement) => FireParticleSurface
  createThunderSurface?: (canvas: HTMLCanvasElement) => ThunderBallSurface
  onStatusChange?: (result: Readonly<ProjectionEffectHostResult>) => void
}

const MAX_PIXEL_RATIO = 2

export const FireThunderLabCanvasLayer = forwardRef<
  FireThunderLabController,
  FireThunderLabCanvasLayerProps
>(function FireThunderLabCanvasLayer(
  {
    reducedMotion = false,
    webgl2Available,
    waitFrame,
    createFireSurface = defaultFireSurface,
    createThunderSurface = defaultThunderSurface,
    onStatusChange,
  },
  forwardedRef
) {
  const fireCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const thunderCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const hostRef = useRef<ReturnType<typeof createFireThunderLabHost> | null>(
    null
  )
  const animationFrameRef = useRef<number | null>(null)
  const lastEffectIdRef = useRef<FireThunderLabEffectId | null>(null)
  const mountedRef = useRef(false)
  const reducedMotionRef = useRef(reducedMotion)
  const onStatusChangeRef = useRef(onStatusChange)
  const scheduleFrameRef = useRef<(() => void) | null>(null)
  const cancelFrameRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    reducedMotionRef.current = reducedMotion
  }, [reducedMotion])

  useEffect(() => {
    onStatusChangeRef.current = onStatusChange
  }, [onStatusChange])

  useEffect(() => {
    const fireCanvas = fireCanvasRef.current
    const thunderCanvas = thunderCanvasRef.current
    if (!fireCanvas || !thunderCanvas) return

    mountedRef.current = true
    const host = createFireThunderLabHost({
      createFireSurface: () => createFireSurface(fireCanvas),
      createThunderSurface: () => createThunderSurface(thunderCanvas),
      webgl2Available:
        webgl2Available ??
        typeof globalThis.WebGL2RenderingContext !== 'undefined',
      waitFrame,
    })
    hostRef.current = host

    const cancelFrame = () => {
      if (animationFrameRef.current === null) return
      window.cancelAnimationFrame(animationFrameRef.current)
      animationFrameRef.current = null
    }
    const scheduleFrame = () => {
      if (
        !mountedRef.current ||
        host.activeEffectId === null ||
        animationFrameRef.current !== null
      ) {
        return
      }
      animationFrameRef.current = window.requestAnimationFrame(async () => {
        animationFrameRef.current = null
        const result = await host.renderFrame()
        if (!mountedRef.current) return
        if (
          result.status !== 'frame-rendered' &&
          result.status !== 'frame-skipped'
        ) {
          onStatusChangeRef.current?.(result)
        }
        if (host.activeEffectId !== null) scheduleFrame()
      })
    }
    cancelFrameRef.current = cancelFrame
    scheduleFrameRef.current = scheduleFrame

    return () => {
      mountedRef.current = false
      cancelFrame()
      scheduleFrameRef.current = null
      cancelFrameRef.current = null
      hostRef.current = null
      const effectId = lastEffectIdRef.current
      if (effectId) {
        void host.dispatch(stopCommand(effectId, 'emergency'))
      }
    }
  }, [createFireSurface, createThunderSurface, waitFrame, webgl2Available])

  async function stopOrReset(
    mode: 'normal' | 'emergency'
  ): Promise<ProjectionEffectHostResult | null> {
    const host = hostRef.current
    const effectId = lastEffectIdRef.current
    if (!host || !effectId || !mountedRef.current) return null
    cancelFrameRef.current?.()
    const result = await host.dispatch(stopCommand(effectId, mode))
    if (mountedRef.current) onStatusChangeRef.current?.(result)
    return result
  }

  async function resetLastEffect(): Promise<ProjectionEffectHostResult | null> {
    const host = hostRef.current
    const effectId = lastEffectIdRef.current
    if (!host || !effectId || !mountedRef.current) return null
    cancelFrameRef.current?.()
    const result = await host.dispatch(resetCommand(effectId))
    if (mountedRef.current) onStatusChangeRef.current?.(result)
    return result
  }

  useImperativeHandle(
    forwardedRef,
    () => ({
      async start(effectId) {
        const host = hostRef.current
        if (!host || !mountedRef.current) return null
        lastEffectIdRef.current = effectId
        const parameters =
          effectId === THUNDER_BALL_EFFECT_ID
            ? { reducedMotion: reducedMotionRef.current }
            : {}
        const result = await host.dispatch(startCommand(effectId, parameters))
        if (!mountedRef.current) return result
        onStatusChangeRef.current?.(result)
        if (result.status === 'started') scheduleFrameRef.current?.()
        return result
      },
      async stop() {
        return stopOrReset('normal')
      },
      async reset() {
        return resetLastEffect()
      },
      async emergencyStop() {
        return stopOrReset('emergency')
      },
    }),
    []
  )

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0"
      data-testid="fire-thunder-lab-layer"
    >
      <canvas
        ref={fireCanvasRef}
        className="absolute inset-0 h-full w-full"
        data-testid="fire-thunder-lab-fire-canvas"
        style={{ mixBlendMode: 'screen' }}
      />
      <canvas
        ref={thunderCanvasRef}
        className="absolute inset-0 h-full w-full"
        data-testid="fire-thunder-lab-thunder-canvas"
        style={{ mixBlendMode: 'screen' }}
      />
    </div>
  )
})

class ThunderCanvas2dLabSurface implements ThunderBallSurface {
  private readonly context: CanvasRenderingContext2D
  private disposed = false

  constructor(private readonly canvas: HTMLCanvasElement) {
    const context = canvas.getContext('2d')
    if (!context) throw new Error('thunder lab requires Canvas 2D')
    this.context = context
  }

  draw(frame: Readonly<ThunderBallFrame>): void {
    if (this.disposed) return
    const width = Math.max(1, this.canvas.clientWidth || window.innerWidth)
    const height = Math.max(1, this.canvas.clientHeight || window.innerHeight)
    const pixelRatio = Math.min(
      MAX_PIXEL_RATIO,
      Math.max(1, window.devicePixelRatio || 1)
    )
    const targetWidth = Math.ceil(width * pixelRatio)
    const targetHeight = Math.ceil(height * pixelRatio)
    if (this.canvas.width !== targetWidth) this.canvas.width = targetWidth
    if (this.canvas.height !== targetHeight) this.canvas.height = targetHeight

    const { context } = this
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)
    context.clearRect(0, 0, width, height)
    context.save()
    context.globalCompositeOperation = 'screen'
    context.globalAlpha = frame.config.masterIntensity
    context.lineCap = 'round'
    context.lineJoin = 'round'
    context.lineWidth = frame.config.lineWidth
    context.strokeStyle = '#d8f4ff'
    context.shadowColor = '#4d8dff'
    context.shadowBlur = frame.config.postProcessing
      ? 12 * frame.config.bloomGain
      : 0

    for (const ribbon of frame.ribbons) {
      if (ribbon.points.length < 2) continue
      context.beginPath()
      ribbon.points.forEach((point, index) => {
        const x = ((point.x + 1) * width) / 2
        const y = ((1 - point.y) * height) / 2
        if (index === 0) context.moveTo(x, y)
        else context.lineTo(x, y)
      })
      context.stroke()
    }
    context.restore()
  }

  clear(): void {
    if (this.disposed) return
    this.context.setTransform(1, 0, 0, 1, 0, 0)
    this.context.clearRect(0, 0, this.canvas.width, this.canvas.height)
  }

  dispose(): void {
    if (this.disposed) return
    this.clear()
    this.disposed = true
  }
}

function defaultFireSurface(canvas: HTMLCanvasElement): FireParticleSurface {
  return new FireWebGl2Surface(canvas)
}

function defaultThunderSurface(canvas: HTMLCanvasElement): ThunderBallSurface {
  return new ThunderCanvas2dLabSurface(canvas)
}

function startCommand(
  effectId: FireThunderLabEffectId,
  parameters: Readonly<Record<string, unknown>>
): ProjectionEffectStartCommand {
  return {
    schemaVersion: PROJECTION_EFFECT_COMMAND_SCHEMA_VERSION,
    commandId: nextCommandId(effectId, 'start'),
    effectId,
    action: 'start',
    parameters,
    speechCompletion: 'finished',
  }
}

function stopCommand(
  effectId: FireThunderLabEffectId,
  mode: 'normal' | 'emergency'
): ProjectionEffectStopCommand {
  return {
    schemaVersion: PROJECTION_EFFECT_COMMAND_SCHEMA_VERSION,
    commandId: nextCommandId(effectId, mode),
    effectId,
    action: 'stop',
    mode,
  }
}

function resetCommand(
  effectId: FireThunderLabEffectId
): ProjectionEffectResetCommand {
  return {
    schemaVersion: PROJECTION_EFFECT_COMMAND_SCHEMA_VERSION,
    commandId: nextCommandId(effectId, 'reset'),
    effectId,
    action: 'reset',
  }
}

let commandSequence = 0

function nextCommandId(
  effectId: FireThunderLabEffectId,
  action: string
): string {
  commandSequence = (commandSequence + 1) % 1_000_000
  return `lab.${effectId}.${action}.${commandSequence}`
}
