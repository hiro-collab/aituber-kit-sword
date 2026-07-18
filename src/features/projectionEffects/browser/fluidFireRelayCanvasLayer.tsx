import { useEffect, useRef } from 'react'
import { createRoot } from 'react-dom/client'
import { fluidFireRelayDefinition } from '../plugins/fluidFireRelay/definition'
import type {
  FluidFireRelayFrameObserver,
  FluidFireRelayRendererSnapshot,
} from '../plugins/fluidFireRelay/renderer'
import type {
  ProjectionEffectFrameContext,
  ProjectionEffectSession,
} from '../rendererPlugin'
import {
  DEFAULT_FLUID_FIRE_RELAY_PARAMETERS,
  isFluidFireRelayParameters,
  type FluidFireRelayParameters,
} from '../settings'
import {
  NEUTRAL_AVATAR_LIGHTING_CONTRIBUTION,
  resetAvatarLightingContribution,
  type AvatarLightingContribution,
} from '../avatarLighting'
import {
  ProjectionEffectCompositor,
  type ProjectionEffectCompositorController,
} from './projectionEffectCompositor'
import { createFluidFireRelayPooledRuntime } from './fluidFireRelayPooledRuntime'

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
  createSession?(observer: FluidFireRelayFrameObserver): ProjectionEffectSession
}

export const FluidFireRelayCanvasLayer = ({
  enabled,
  parameters,
  createSession,
}: FluidFireRelayCanvasLayerProps) => {
  const layerRef = useRef<HTMLDivElement | null>(null)
  const enabledRef = useRef(enabled)
  const createSessionRef = useRef(createSession)
  const reconcileRef = useRef<(() => void) | null>(null)
  const dependencyEffectInitializedRef = useRef(false)
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
    const layer = layerRef.current
    if (!layer) return

    let mounted = true
    let compositorUnmounted = false
    let startTimer: ReturnType<typeof setTimeout> | null = null
    let compositor: ProjectionEffectCompositorController | null = null
    let lifecycleTail: Promise<void> = Promise.resolve()
    let lifecycleRevision = 0
    let lifecycleQuarantined = false
    let runtime: ReturnType<typeof createFluidFireRelayPooledRuntime> | null =
      null
    const compositorHost = document.createElement('div')
    compositorHost.dataset.fluidRelayCompositorHost = 'true'
    layer.appendChild(compositorHost)
    const compositorRoot = createRoot(compositorHost)

    const unmountCompositor = () => {
      if (compositorUnmounted) return
      compositorUnmounted = true
      compositorRoot.unmount()
      compositorHost.remove()
    }

    const reconcile = async (revision: number): Promise<void> => {
      const activeRuntime = runtime
      if (activeRuntime) {
        runtime = null
        const stopped = await activeRuntime.dispose()
        if (
          stopped === 'cleanup-unproved' ||
          stopped === 'runtime-quarantined'
        ) {
          lifecycleQuarantined = true
          layer.dataset.effectStatus = 'runtime-quarantined'
        }
      }
      if (
        revision !== lifecycleRevision ||
        !mounted ||
        !enabledRef.current ||
        !compositor ||
        lifecycleQuarantined
      ) {
        resetAvatarLightingContribution()
        return
      }
      const nextRuntime = createFluidFireRelayPooledRuntime({
        compositor,
        getParameters: () => parametersRef.current,
        drawFrame: ({ canvas, context }, snapshot, frameContext) => {
          const width = Math.max(1, canvas.clientWidth || window.innerWidth)
          const height = Math.max(1, canvas.clientHeight || window.innerHeight)
          const pixelRatio = Math.min(
            MAX_PIXEL_RATIO,
            Math.max(1, window.devicePixelRatio || 1)
          )
          const targetWidth = Math.ceil(width * pixelRatio)
          const targetHeight = Math.ceil(height * pixelRatio)
          if (canvas.width !== targetWidth) canvas.width = targetWidth
          if (canvas.height !== targetHeight) canvas.height = targetHeight
          context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)
          drawFluidFireRelayFrame(
            context,
            width,
            height,
            snapshot,
            frameContext
          )
          layer.dataset.effectFrameCount = String(snapshot.frameCount)
          return deriveFluidFireRelayAvatarLighting(snapshot, frameContext)
        },
        onStatusChange: (status) => {
          if (mounted) layer.dataset.effectStatus = status
        },
        createSession: createSessionRef.current,
      })
      runtime = nextRuntime
      const started = await nextRuntime.start()
      if (started === 'cleanup-unproved' || started === 'runtime-quarantined') {
        lifecycleQuarantined = true
        layer.dataset.effectStatus = 'runtime-quarantined'
      } else if (mounted && started !== 'completed') {
        layer.dataset.effectStatus = started
      }
    }

    const enqueueReconcile = () => {
      lifecycleRevision += 1
      const revision = lifecycleRevision
      lifecycleTail = lifecycleTail
        .then(() => reconcile(revision))
        .catch(() => {
          lifecycleQuarantined = true
          layer.dataset.effectStatus = 'runtime-quarantined'
          resetAvatarLightingContribution()
        })
    }
    reconcileRef.current = enqueueReconcile

    const startRuntimeWhenReady = () => {
      startTimer = null
      if (!mounted || !compositor) return
      if (compositor.snapshot().state === 'unavailable') {
        layer.dataset.effectStatus = 'surface-unavailable'
        return
      }
      enqueueReconcile()
    }

    layer.dataset.effectStatus = enabledRef.current ? 'starting' : 'disabled'
    compositorRoot.render(
      <ProjectionEffectCompositor
        ref={(nextCompositor) => {
          if (!nextCompositor || startTimer !== null) return
          compositor = nextCompositor
          if (!mounted) {
            queueMicrotask(unmountCompositor)
            return
          }
          startTimer = setTimeout(startRuntimeWhenReady, 0)
        }}
      />
    )

    return () => {
      mounted = false
      enabledRef.current = false
      reconcileRef.current = null
      resetAvatarLightingContribution()
      if (startTimer !== null) {
        clearTimeout(startTimer)
        startTimer = null
      }
      lifecycleRevision += 1
      const activeRuntime = runtime
      runtime = null
      const directDisposal = activeRuntime
        ? activeRuntime.dispose().then(() => undefined)
        : Promise.resolve()
      lifecycleTail = Promise.all([lifecycleTail, directDisposal]).then(
        () => undefined
      )
      void lifecycleTail.then(unmountCompositor, unmountCompositor)
    }
  }, [])

  useEffect(() => {
    enabledRef.current = enabled
    createSessionRef.current = createSession
    if (!enabled) resetAvatarLightingContribution()
    if (!dependencyEffectInitializedRef.current) {
      dependencyEffectInitializedRef.current = true
      return
    }
    reconcileRef.current?.()
  }, [createSession, enabled])

  return (
    <div
      ref={layerRef}
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 h-full w-full"
      data-projection-effect-id={EFFECT_ID}
      data-effect-status={enabled ? 'registered' : 'disabled'}
      data-testid="fluid-fire-relay-layer"
      hidden={!enabled}
    ></div>
  )
}

export function deriveFluidFireRelayAvatarLighting(
  snapshot: Readonly<FluidFireRelayRendererSnapshot>,
  frameContext: ProjectionEffectFrameContext
): Readonly<AvatarLightingContribution> {
  const temperature = finiteClampedEnergy(snapshot.temperatureEnergy)
  const density = finiteClampedEnergy(snapshot.densityEnergy)
  const bloomGain = finiteClampedNumber(
    frameContext.parameters.bloomGain,
    0,
    1.5
  )
  if (temperature === null || density === null || bloomGain === null) {
    return NEUTRAL_AVATAR_LIGHTING_CONTRIBUTION
  }

  const intensityScale = Math.min(
    1.5,
    1 + temperature * 0.08 + density * 0.025 + bloomGain * 0.04
  )
  return Object.freeze({
    status: 'active',
    intensityScale,
    warmthClass: temperature > 0.1 ? 'warm' : 'neutral',
  })
}

function finiteClampedEnergy(value: unknown): number | null {
  return finiteClampedNumber(value, 0, MAX_ENERGY)
}

function finiteClampedNumber(
  value: unknown,
  minimum: number,
  maximum: number
): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return Math.min(maximum, Math.max(minimum, value))
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
