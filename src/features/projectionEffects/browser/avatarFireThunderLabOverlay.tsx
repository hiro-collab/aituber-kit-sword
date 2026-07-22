import { forwardRef } from 'react'
import VrmViewer from '@/components/vrmViewer'
import {
  FireThunderLabCanvasLayer,
  type FireThunderLabCanvasLayerProps,
  type FireThunderLabController,
  type FireThunderLabVisualParameterOverrides,
} from './fireThunderLabCanvasLayer'

export const AVATAR_CAST_VISUAL_PARAMETER_OVERRIDES = {
  fire: {
    emitterX: 0.3,
    emitterY: -0.25,
    pointSize: 46,
  },
  thunderBall: {
    centerX: 0.28,
    centerY: -0.06,
    lineWidth: 3.8,
    orbRadius: 0.32,
  },
} as const satisfies Readonly<FireThunderLabVisualParameterOverrides>

export type AvatarFireThunderLabOverlayProps = Pick<
  FireThunderLabCanvasLayerProps,
  'onStatusChange' | 'reducedMotion'
>

export const AvatarFireThunderLabOverlay = forwardRef<
  FireThunderLabController,
  AvatarFireThunderLabOverlayProps
>(function AvatarFireThunderLabOverlay(
  { onStatusChange, reducedMotion = false },
  forwardedRef
) {
  return (
    <div
      className="pointer-events-none absolute inset-0 isolate"
      data-testid="avatar-fire-thunder-overlay"
    >
      <div
        className="absolute inset-0 z-0"
        data-testid="avatar-fire-thunder-avatar-layer"
      >
        <VrmViewer />
      </div>
      <div
        className="pointer-events-none absolute inset-0 z-10"
        data-testid="avatar-fire-thunder-effect-layer"
        data-projection-anchor-contract="fixed-stage-relative"
      >
        <FireThunderLabCanvasLayer
          ref={forwardedRef}
          onStatusChange={onStatusChange}
          visualParameterOverrides={AVATAR_CAST_VISUAL_PARAMETER_OVERRIDES}
          reducedMotion={reducedMotion}
        />
      </div>
    </div>
  )
})

AvatarFireThunderLabOverlay.displayName = 'AvatarFireThunderLabOverlay'
