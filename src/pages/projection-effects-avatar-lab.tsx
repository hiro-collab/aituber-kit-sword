import Head from 'next/head'
import { useRef, useState } from 'react'
import { AvatarFireThunderLabOverlay } from '@/features/projectionEffects/browser/avatarFireThunderLabOverlay'
import type { FireThunderLabController } from '@/features/projectionEffects/browser/fireThunderLabCanvasLayer'
import type { ProjectionEffectHostResult } from '@/features/projectionEffects/effectHost'
import { FIRE_EFFECT_ID } from '@/features/projectionEffects/plugins/fire/definition'
import { THUNDER_BALL_EFFECT_ID } from '@/features/projectionEffects/plugins/thunderBall/definition'

const IDLE_STATUSES = new Set([
  'stopped',
  'emergency-stopped',
  'reset',
  'no-active-effect',
])

const AvatarFireThunderLabPage = () => {
  const controllerRef = useRef<FireThunderLabController | null>(null)
  const [status, setStatus] = useState('idle')
  const [reducedMotion, setReducedMotion] = useState(false)

  const updateStatus = (result: Readonly<ProjectionEffectHostResult>) => {
    setStatus(IDLE_STATUSES.has(result.status) ? 'idle' : result.status)
  }

  return (
    <>
      <Head>
        <title>Avatar Fire + Thunder Projection Lab</title>
      </Head>
      <main
        className="relative isolate h-screen w-screen overflow-hidden bg-[#00ff00] text-white"
        data-testid="avatar-fire-thunder-lab-stage"
      >
        <AvatarFireThunderLabOverlay
          ref={controllerRef}
          intentRole="manual"
          onStatusChange={updateStatus}
          reducedMotion={reducedMotion}
        />

        <section
          className="pointer-events-auto absolute left-1/2 top-6 z-20 w-[min(94vw,760px)] -translate-x-1/2 rounded-2xl border border-cyan-200/25 bg-slate-950/75 p-4 shadow-2xl shadow-blue-950/60 backdrop-blur"
          data-testid="avatar-fire-thunder-controls"
        >
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="mr-auto text-lg font-semibold tracking-wide text-cyan-100">
              Avatar Elemental Projection Lab
            </h1>
            <output
              aria-live="polite"
              className="rounded-full bg-cyan-400/15 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-cyan-100"
              data-testid="avatar-fire-thunder-status"
            >
              {status}
            </output>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              data-testid="avatar-fire-button"
              onClick={() => {
                setStatus('starting-fire')
                void controllerRef.current?.start(FIRE_EFFECT_ID)
              }}
              type="button"
            >
              Start Fire
            </button>
            <button
              data-testid="avatar-thunder-button"
              onClick={() => {
                setStatus('starting-thunder')
                void controllerRef.current?.start(THUNDER_BALL_EFFECT_ID)
              }}
              type="button"
            >
              Start Thunder
            </button>
            <button
              data-testid="avatar-effect-stop"
              onClick={() => {
                setStatus('stopping')
                void controllerRef.current?.stop()
              }}
              type="button"
            >
              Stop
            </button>
            <button
              data-testid="avatar-effect-reset"
              onClick={() => {
                setStatus('resetting')
                void controllerRef.current?.reset()
              }}
              type="button"
            >
              Reset
            </button>
            <button
              data-testid="avatar-effect-emergency-stop"
              onClick={() => {
                setStatus('emergency-stopping')
                void controllerRef.current?.emergencyStop()
              }}
              type="button"
            >
              Emergency Stop
            </button>
          </div>

          <label className="mt-3 flex w-fit items-center gap-2 text-sm text-slate-200">
            <input
              checked={reducedMotion}
              data-testid="avatar-reduced-motion"
              onChange={(event) => setReducedMotion(event.target.checked)}
              type="checkbox"
            />
            Reduced motion (Thunder)
          </label>
        </section>
      </main>
    </>
  )
}

export default AvatarFireThunderLabPage
