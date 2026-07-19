import { forwardRef } from 'react'
import VrmViewer from '@/components/vrmViewer'
import {
  FireThunderLabCanvasLayer,
  type FireThunderLabCanvasLayerProps,
  type FireThunderLabController,
} from './fireThunderLabCanvasLayer'

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
      >
        <FireThunderLabCanvasLayer
          ref={forwardedRef}
          onStatusChange={onStatusChange}
          reducedMotion={reducedMotion}
        />
      </div>
    </div>
  )
})

AvatarFireThunderLabOverlay.displayName = 'AvatarFireThunderLabOverlay'
