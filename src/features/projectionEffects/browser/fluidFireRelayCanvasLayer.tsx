import { useEffect, useRef } from 'react'
import { ProjectionEffectRegistry } from '../registry'
import { fluidFireRelayDefinition } from '../plugins/fluidFireRelay/definition'
import {
  FluidFireRelayRenderer,
  type FluidFireRelayRendererSnapshot,
} from '../plugins/fluidFireRelay/renderer'
import type { ProjectionEffectFrameContext } from '../rendererPlugin'
import {
  DEFAULT_FLUID_FIRE_RELAY_PARAMETERS,
  isFluidFireRelayParameters,
  type FluidFireRelayParameters,
} from '../settings'

const EFFECT_ID = fluidFireRelayDefinition.id
const MAX_PIXEL_RATIO = 2
const MAX_ENERGY = 4
const PLUME_COUNT = 18

export function resolveProjectionEffectSelection(
  queryValue: unknown,
  configuredValue: unknown,
  allowTestQueryOverride = false
): typeof EFFECT_ID | null {
  if (allowTestQueryOverride && queryValue !== undefined) {
    return queryValue === EFFECT_ID ? EFFECT_ID : null
  }
  return configuredValue === EFFECT_ID ? EFFECT_ID : null
}

export interface FluidFireRelayCanvasLayerProps {
  enabled: boolean
  parameters?: FluidFireRelayParameters
}

export const FluidFireRelayCanvasLayer = ({
  enabled,
  parameters,
}: FluidFireRelayCanvasLayerProps) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const parametersRef = useRef<FluidFireRelayParameters>(
    isFluidFireRelayParameters(parameters)
      ? parameters
      : DEFAULT_FLUID_FIRE_RELAY_PARAMETERS
  )

  useEffect(() => {
    parametersRef.current = isFluidFireRelayParameters(parameters)
      ? parameters
      : DEFAULT_FLUID_FIRE_RELAY_PARAMETERS
  }, [parameters])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!enabled || !canvas) return

    let drawingContext = canvas.getContext('2d')
    if (!drawingContext) {
      canvas.dataset.effectStatus = 'unavailable'
      return
    }

    let disposed = false
    let contextLost = false
    let animationFrame: number | null = null
    let previousFrameMs: number | null = null
    let pixelRatio = 1

    const resize = () => {
      const width = Math.max(1, canvas.clientWidth || window.innerWidth)
      const height = Math.max(1, canvas.clientHeight || window.innerHeight)
      pixelRatio = Math.min(
        MAX_PIXEL_RATIO,
        Math.max(1, window.devicePixelRatio || 1)
      )
      canvas.width = Math.ceil(width * pixelRatio)
      canvas.height = Math.ceil(height * pixelRatio)
      drawingContext?.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)
    }

    const registry = new ProjectionEffectRegistry()
    registry.register({
      definition: fluidFireRelayDefinition,
      createRenderer: () =>
        new FluidFireRelayRenderer((snapshot, frameContext) => {
          if (!drawingContext || disposed || contextLost) return
          drawFluidFireRelayFrame(
            drawingContext,
            canvas.width / pixelRatio,
            canvas.height / pixelRatio,
            snapshot,
            frameContext
          )
          canvas.dataset.effectFrameCount = String(snapshot.frameCount)
        }),
    })
    const session = registry.createSession(EFFECT_ID)

    const scheduleFrame = () => {
      if (disposed || contextLost || animationFrame !== null) return
      animationFrame = window.requestAnimationFrame((nowMs) => {
        animationFrame = null
        void runFrame(nowMs)
      })
    }

    const runFrame = async (nowMs: number) => {
      if (disposed || contextLost) return
      const deltaMs = Math.min(
        100,
        Math.max(0, previousFrameMs === null ? 16 : nowMs - previousFrameMs)
      )
      previousFrameMs = nowMs
      const result = await session.update({
        nowMs,
        deltaMs,
        parameters: parametersRef.current,
      })
      if (disposed) return
      canvas.dataset.effectStatus = result.status
      scheduleFrame()
    }

    const handleContextLost = (event: Event) => {
      event.preventDefault()
      contextLost = true
      if (animationFrame !== null) {
        window.cancelAnimationFrame(animationFrame)
        animationFrame = null
      }
      canvas.dataset.effectStatus = 'context-lost'
    }

    const handleContextRestored = () => {
      if (disposed) return
      drawingContext = canvas.getContext('2d')
      if (!drawingContext) {
        canvas.dataset.effectStatus = 'unavailable'
        return
      }
      contextLost = false
      previousFrameMs = null
      resize()
      canvas.dataset.effectStatus = 'recovering'
      scheduleFrame()
    }

    resize()
    canvas.dataset.effectStatus = 'starting'
    canvas.addEventListener('contextlost', handleContextLost)
    canvas.addEventListener('contextrestored', handleContextRestored)
    window.addEventListener('resize', resize)

    void session.start().then((result) => {
      if (disposed) return
      canvas.dataset.effectStatus = result.status
      scheduleFrame()
    })

    return () => {
      disposed = true
      if (animationFrame !== null) {
        window.cancelAnimationFrame(animationFrame)
      }
      canvas.removeEventListener('contextlost', handleContextLost)
      canvas.removeEventListener('contextrestored', handleContextRestored)
      window.removeEventListener('resize', resize)
      void session.dispose()
    }
  }, [enabled])

  if (!enabled) return null

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 h-full w-full"
      data-projection-effect-id={EFFECT_ID}
      data-effect-status="registered"
      data-testid="fluid-fire-relay-layer"
      style={{ mixBlendMode: 'screen' }}
    />
  )
}

export function drawFluidFireRelayFrame(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  snapshot: Readonly<FluidFireRelayRendererSnapshot>,
  frameContext: ProjectionEffectFrameContext
): void {
  const density = Math.min(MAX_ENERGY, Math.max(0, snapshot.densityEnergy))
  const temperature = Math.min(
    MAX_ENERGY,
    Math.max(0, snapshot.temperatureEnergy)
  )
  const pressure = Math.min(MAX_ENERGY, Math.max(0, snapshot.pressureEnergy))
  const bloomGain = Math.min(
    1.5,
    Math.max(
      0,
      typeof frameContext.parameters.bloomGain === 'number'
        ? frameContext.parameters.bloomGain
        : 0
    )
  )
  const timeSeconds = frameContext.nowMs / 1000

  context.clearRect(0, 0, width, height)
  context.save()
  context.globalCompositeOperation = 'screen'

  for (let index = 0; index < PLUME_COUNT; index += 1) {
    const phase = index / PLUME_COUNT
    const sway = Math.sin(timeSeconds * 0.8 + index * 1.73)
    const rise = (timeSeconds * (0.04 + pressure * 0.012) + phase) % 1
    const x = width * (0.12 + phase * 0.76) + sway * width * 0.035
    const y = height * (0.98 - rise * 0.82)
    const radius =
      Math.max(18, Math.min(width, height) * 0.035) *
      (0.72 + density * 0.18 + phase * 0.35)
    const gradient = context.createRadialGradient(x, y, 0, x, y, radius)
    const hotAlpha = Math.min(
      0.82,
      (0.12 + temperature * 0.18) * (0.65 + bloomGain)
    )
    const coolAlpha = Math.min(
      0.56,
      (0.08 + density * 0.12) * (0.7 + bloomGain * 0.6)
    )
    gradient.addColorStop(0, `rgba(255, 238, 170, ${hotAlpha})`)
    gradient.addColorStop(0.34, `rgba(255, 92, 40, ${hotAlpha * 0.78})`)
    gradient.addColorStop(0.72, `rgba(52, 126, 255, ${coolAlpha})`)
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0)')
    context.fillStyle = gradient
    context.beginPath()
    context.arc(x, y, radius, 0, Math.PI * 2)
    context.fill()
  }

  context.restore()
}
