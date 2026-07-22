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
import type { FireP027Surface } from '../plugins/fire/p027/contracts'
import type { FireP027Renderer } from '../plugins/fire/p027/renderer'
import { FireP027WebGlEngine } from '../plugins/fire/p027/webglEngine'
import { THUNDER_BALL_EFFECT_ID } from '../plugins/thunderBall/definition'
import type {
  ThunderBallFrame,
  ThunderBallRibbon,
  ThunderBallSurface,
} from '../plugins/thunderBall/renderer'
import {
  FireThunderPooledSurfaces,
  compositorOperationCompleted,
} from './fireThunderPooledSurfaces'
import {
  ProjectionEffectCompositor,
  type ProjectionEffectCompositorController,
} from './projectionEffectCompositor'

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
  createFireSurface?: (canvas: HTMLCanvasElement) => FireP027Surface
  createThunderSurface?: (canvas: HTMLCanvasElement) => ThunderBallSurface
  onStatusChange?: (result: Readonly<ProjectionEffectHostResult>) => void
}

const MAX_PIXEL_RATIO = 2

export const FIRE_THUNDER_LAB_VISUAL_PARAMETERS = {
  fire: {
    emitterX: 0,
    emitterY: -0.52,
    particleBudget: 2_400,
    emissionRate: 420,
    lifetimeMs: 1_800,
    upwardSpeed: 0.78,
    noiseStrength: 0.52,
    dissipation: 0.974,
    pointSize: 72,
    temperature: 0.93,
    masterIntensity: 1,
    bloomGain: 0.92,
    internalResolutionScale: 0.9,
    updateRateHz: 60,
    postProcessing: true,
  },
  thunderBall: {
    centerX: 0,
    centerY: -0.04,
    orbRadius: 0.48,
    anchorCount: 32,
    sparkBudget: 28,
    emissionRate: 16,
    lifetimeMs: 1_200,
    segmentCount: 24,
    orbitSpeed: 0.85,
    wrinkleStrength: 0.22,
    lineWidth: 4.6,
    masterIntensity: 1,
    bloomGain: 1.15,
    internalResolutionScale: 1,
    updateRateHz: 60,
    postProcessing: true,
  },
} as const

export interface ThunderLabVisualPlan {
  bloomBlur: number
  centerX: number
  centerY: number
  coreRadius: number
  glowLineWidth: number
  haloRadius: number
  lineWidth: number
  masterAlpha: number
  orbRadius: number
  pulse: number
}

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
  const compositorRef = useRef<ProjectionEffectCompositorController | null>(
    null
  )
  const hostRef = useRef<ReturnType<typeof createFireThunderLabHost> | null>(
    null
  )
  const pooledSurfacesRef = useRef<FireThunderPooledSurfaces | null>(null)
  const fireRendererRef = useRef<FireP027Renderer | null>(null)
  const cleanupPromiseRef = useRef<Promise<void>>(Promise.resolve())
  const readyPromiseRef = useRef<Promise<void>>(Promise.resolve())
  const effectGenerationRef = useRef(0)
  const cleanupUnprovedRef = useRef(false)
  const lastEffectIdRef = useRef<FireThunderLabEffectId | null>(null)
  const mountedRef = useRef(false)
  const reducedMotionRef = useRef(reducedMotion)
  const onStatusChangeRef = useRef(onStatusChange)

  useEffect(() => {
    reducedMotionRef.current = reducedMotion
  }, [reducedMotion])

  useEffect(() => {
    onStatusChangeRef.current = onStatusChange
  }, [onStatusChange])

  useEffect(() => {
    const compositor = compositorRef.current
    if (!compositor) return

    effectGenerationRef.current += 1
    const generation = effectGenerationRef.current
    mountedRef.current = true
    let pooledSurfaces: FireThunderPooledSurfaces | null = null
    let host: ReturnType<typeof createFireThunderLabHost> | null = null
    const ready = cleanupPromiseRef.current.then(() => {
      if (
        !mountedRef.current ||
        effectGenerationRef.current !== generation ||
        cleanupUnprovedRef.current
      ) {
        return
      }
      pooledSurfaces = new FireThunderPooledSurfaces({
        compositor,
        createFireSurface,
        createThunderSurface,
      })
      host = createFireThunderLabHost({
        createFireSurface: () => pooledSurfaces!.createFireSurface(),
        createThunderSurface: () => pooledSurfaces!.createThunderSurface(),
        onFireRendererCreated: (renderer) => {
          if (effectGenerationRef.current === generation) {
            fireRendererRef.current = renderer
          }
        },
        webgl2Available:
          webgl2Available ??
          typeof globalThis.WebGL2RenderingContext !== 'undefined',
        waitFrame,
      })
      pooledSurfacesRef.current = pooledSurfaces
      hostRef.current = host
    })
    readyPromiseRef.current = ready

    return () => {
      if (effectGenerationRef.current === generation) {
        mountedRef.current = false
      }
      compositor.stopFrameLoop()
      const effectId = lastEffectIdRef.current
      if (hostRef.current === host) hostRef.current = null
      if (pooledSurfacesRef.current === pooledSurfaces) {
        pooledSurfacesRef.current = null
      }
      fireRendererRef.current = null
      lastEffectIdRef.current = null

      cleanupPromiseRef.current = ready
        .then(async () => {
          if (!host || !pooledSurfaces) {
            const compositorState = compositor.snapshot().state
            if (
              compositorState === 'disposed' ||
              compositorState === 'quarantined'
            ) {
              if (compositor.shutdown() !== 'completed') {
                cleanupUnprovedRef.current = true
              }
            }
            return
          }
          let hostCleanupProved = true
          if (effectId) {
            try {
              const result = await host.dispatch(
                stopCommand(effectId, 'emergency')
              )
              hostCleanupProved =
                result.status === 'emergency-stopped' ||
                result.status === 'no-active-effect'
            } catch {
              hostCleanupProved = false
            }
          }

          if (!hostCleanupProved) {
            cleanupUnprovedRef.current = true
            pooledSurfaces.quarantineActive()
          } else if (pooledSurfaces.disposeActive() !== 'completed') {
            cleanupUnprovedRef.current = true
            pooledSurfaces.quarantineActive()
          }

          const compositorState = compositor.snapshot().state
          if (
            compositorState === 'disposed' ||
            compositorState === 'quarantined'
          ) {
            if (compositor.shutdown() !== 'completed') {
              cleanupUnprovedRef.current = true
              pooledSurfaces.quarantineActive()
            }
          }
        })
        .catch(() => {
          cleanupUnprovedRef.current = true
          pooledSurfaces?.quarantineActive()
          const compositorState = compositor.snapshot().state
          if (
            compositorState === 'disposed' ||
            compositorState === 'quarantined'
          ) {
            compositor.shutdown()
          }
        })
    }
  }, [createFireSurface, createThunderSurface, waitFrame, webgl2Available])

  async function stopOrReset(
    mode: 'normal' | 'emergency'
  ): Promise<ProjectionEffectHostResult | null> {
    const host = hostRef.current
    const effectId = lastEffectIdRef.current
    if (!host || !effectId || !mountedRef.current) return null
    compositorRef.current?.stopFrameLoop()
    const result = await host.dispatch(stopCommand(effectId, mode))
    if (host.activeEffectId === null && effectId === FIRE_EFFECT_ID) {
      fireRendererRef.current = null
    }
    if (mountedRef.current) onStatusChangeRef.current?.(result)
    return result
  }

  async function resetLastEffect(): Promise<ProjectionEffectHostResult | null> {
    const host = hostRef.current
    const effectId = lastEffectIdRef.current
    if (!host || !effectId || !mountedRef.current) return null
    compositorRef.current?.stopFrameLoop()
    if (effectId === FIRE_EFFECT_ID && fireRendererRef.current) {
      try {
        fireRendererRef.current.reset()
      } catch {
        const cleanup = await host.dispatch(stopCommand(effectId, 'emergency'))
        cleanupUnprovedRef.current = true
        pooledSurfacesRef.current?.quarantineActive()
        fireRendererRef.current = null
        if (mountedRef.current) onStatusChangeRef.current?.(cleanup)
        return cleanup
      }
    }
    const result = await host.dispatch(resetCommand(effectId))
    if (effectId === FIRE_EFFECT_ID) fireRendererRef.current = null
    if (mountedRef.current) onStatusChangeRef.current?.(result)
    return result
  }

  useImperativeHandle(
    forwardedRef,
    () => ({
      async start(effectId) {
        await readyPromiseRef.current
        const host = hostRef.current
        const compositor = compositorRef.current
        if (!host || !compositor || !mountedRef.current) return null
        if (host.activeEffectId !== null) compositor.stopFrameLoop()
        lastEffectIdRef.current = effectId
        const parameters =
          effectId === THUNDER_BALL_EFFECT_ID
            ? {
                ...FIRE_THUNDER_LAB_VISUAL_PARAMETERS.thunderBall,
                reducedMotion: reducedMotionRef.current,
              }
            : FIRE_THUNDER_LAB_VISUAL_PARAMETERS.fire
        const result = await host.dispatch(startCommand(effectId, parameters))
        if (effectId !== FIRE_EFFECT_ID || result.status !== 'started') {
          fireRendererRef.current = null
        }
        if (!mountedRef.current) return result
        onStatusChangeRef.current?.(result)
        if (result.status === 'started') {
          const loopStatus = compositor.startFrameLoop(async () => {
            const frameResult = await host.renderFrame()
            if (!mountedRef.current) return
            if (
              frameResult.status !== 'frame-rendered' &&
              frameResult.status !== 'frame-skipped'
            ) {
              onStatusChangeRef.current?.(frameResult)
            }
            if (host.activeEffectId === null) {
              fireRendererRef.current = null
              compositor.stopFrameLoop()
            }
          })
          if (!compositorOperationCompleted(loopStatus)) {
            const cleanup = await host.dispatch(
              stopCommand(effectId, 'emergency')
            )
            if (mountedRef.current) onStatusChangeRef.current?.(cleanup)
            return cleanup
          }
        }
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
      <ProjectionEffectCompositor
        ref={compositorRef}
        unmountPoolOwnership="external-deferred"
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
    const plan = buildThunderLabVisualPlan(frame, width, height)
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)
    context.clearRect(0, 0, width, height)
    context.save()
    context.globalCompositeOperation = 'screen'
    drawThunderOrb(context, plan)

    context.globalAlpha = plan.masterAlpha * 0.28
    context.lineCap = 'round'
    context.lineJoin = 'round'
    context.lineWidth = plan.glowLineWidth
    context.strokeStyle = '#3c74ff'
    context.shadowColor = '#4d8dff'
    context.shadowBlur = plan.bloomBlur

    for (const ribbon of frame.ribbons) {
      strokeRibbon(context, ribbon, width, height)
    }

    context.globalAlpha = plan.masterAlpha
    context.lineWidth = plan.lineWidth
    context.strokeStyle = '#e8fbff'
    context.shadowColor = '#bce9ff'
    context.shadowBlur = plan.bloomBlur * 0.48

    for (const ribbon of frame.ribbons) {
      strokeRibbon(context, ribbon, width, height)
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

export function buildThunderLabVisualPlan(
  frame: Readonly<ThunderBallFrame>,
  width: number,
  height: number
): ThunderLabVisualPlan {
  const safeWidth = Math.max(1, width)
  const safeHeight = Math.max(1, height)
  const visualUnit = Math.min(safeWidth, safeHeight) / 2
  const pulse = clamp(frame.config.orbPulse, 0, 1)
  const orbRadius = Math.max(8, frame.config.orbRadius * visualUnit)
  const bloomGain = Math.max(0, frame.config.bloomGain)
  const lineWidth = Math.max(1, frame.config.lineWidth)
  return {
    bloomBlur: frame.config.postProcessing ? Math.max(8, 18 * bloomGain) : 0,
    centerX: ((clamp(frame.config.centerX, -1, 1) + 1) * safeWidth) / 2,
    centerY: ((1 - clamp(frame.config.centerY, -1, 1)) * safeHeight) / 2,
    coreRadius: orbRadius * (0.1 + pulse * 0.055),
    glowLineWidth: lineWidth * 3.2,
    haloRadius: orbRadius * (0.72 + pulse * 0.2),
    lineWidth,
    masterAlpha: clamp(frame.config.masterIntensity, 0, 1),
    orbRadius,
    pulse,
  }
}

function drawThunderOrb(
  context: CanvasRenderingContext2D,
  plan: Readonly<ThunderLabVisualPlan>
): void {
  const halo = context.createRadialGradient(
    plan.centerX,
    plan.centerY,
    0,
    plan.centerX,
    plan.centerY,
    plan.haloRadius
  )
  halo.addColorStop(0, 'rgba(238, 253, 255, 0.98)')
  halo.addColorStop(0.11, 'rgba(142, 227, 255, 0.9)')
  halo.addColorStop(0.38, 'rgba(51, 103, 255, 0.45)')
  halo.addColorStop(1, 'rgba(30, 64, 175, 0)')
  context.globalAlpha = plan.masterAlpha
  context.fillStyle = halo
  context.beginPath()
  context.arc(plan.centerX, plan.centerY, plan.haloRadius, 0, Math.PI * 2)
  context.fill()

  context.shadowColor = '#bce9ff'
  context.shadowBlur = plan.bloomBlur
  context.fillStyle = '#f5feff'
  context.beginPath()
  context.arc(plan.centerX, plan.centerY, plan.coreRadius, 0, Math.PI * 2)
  context.fill()

  context.globalAlpha = plan.masterAlpha * 0.74
  context.strokeStyle = '#79b8ff'
  context.lineWidth = Math.max(1.5, plan.lineWidth * 0.52)
  context.beginPath()
  context.arc(
    plan.centerX,
    plan.centerY,
    plan.orbRadius * (0.34 + plan.pulse * 0.08),
    0,
    Math.PI * 2
  )
  context.stroke()
}

function strokeRibbon(
  context: CanvasRenderingContext2D,
  ribbon: Readonly<ThunderBallRibbon>,
  width: number,
  height: number
): void {
  if (ribbon.points.length < 2) return
  context.beginPath()
  ribbon.points.forEach((point, index) => {
    const x = ((point.x + 1) * width) / 2
    const y = ((1 - point.y) * height) / 2
    if (index === 0) context.moveTo(x, y)
    else context.lineTo(x, y)
  })
  context.stroke()
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value))
}

function defaultFireSurface(canvas: HTMLCanvasElement): FireP027Surface {
  return new FireP027WebGlEngine(canvas)
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
