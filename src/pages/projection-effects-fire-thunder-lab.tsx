import Head from 'next/head'
import { useRef, useState } from 'react'
import {
  FireThunderLabCanvasLayer,
  type FireThunderLabController,
} from '@/features/projectionEffects/browser/fireThunderLabCanvasLayer'
import { FIRE_EFFECT_ID } from '@/features/projectionEffects/plugins/fire/definition'
import { THUNDER_BALL_EFFECT_ID } from '@/features/projectionEffects/plugins/thunderBall/definition'

const IDLE_STATUSES = new Set([
  'stopped',
  'emergency-stopped',
  'reset',
  'no-active-effect',
])

const FireThunderLabPage = () => {
  const controllerRef = useRef<FireThunderLabController | null>(null)
  const [status, setStatus] = useState('idle')
  const [reducedMotion, setReducedMotion] = useState(false)

  const startFire = () => {
    setStatus('starting-fire')
    void controllerRef.current?.start(FIRE_EFFECT_ID)
  }
  const startThunder = () => {
    setStatus('starting-thunder')
    void controllerRef.current?.start(THUNDER_BALL_EFFECT_ID)
  }
  const stop = () => {
    setStatus('stopping')
    void controllerRef.current?.stop()
  }
  const reset = () => {
    setStatus('resetting')
    void controllerRef.current?.reset()
  }
  const emergencyStop = () => {
    setStatus('emergency-stopping')
    void controllerRef.current?.emergencyStop()
  }

  return (
    <>
      <Head>
        <title>Fire + Thunder Projection Lab</title>
      </Head>
      <main
        className="relative h-screen w-screen overflow-hidden bg-[radial-gradient(circle_at_50%_58%,_#172554_0%,_#071126_36%,_#020617_68%,_#000_100%)] text-white"
        data-testid="fire-thunder-lab-stage"
      >
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_78%,_rgba(249,115,22,0.12)_0%,_transparent_40%),radial-gradient(circle_at_50%_48%,_rgba(59,130,246,0.16)_0%,_transparent_42%)]"
        />
        <div
          aria-hidden="true"
          className="absolute inset-x-[12%] bottom-[8%] h-px bg-gradient-to-r from-transparent via-cyan-200/30 to-transparent shadow-[0_0_45px_rgba(56,189,248,0.28)]"
        />
        <FireThunderLabCanvasLayer
          ref={controllerRef}
          onStatusChange={(result) =>
            setStatus(IDLE_STATUSES.has(result.status) ? 'idle' : result.status)
          }
          reducedMotion={reducedMotion}
        />

        <section className="pointer-events-auto absolute left-1/2 top-6 z-10 w-[min(94vw,760px)] -translate-x-1/2 rounded-2xl border border-cyan-200/25 bg-slate-950/72 p-4 shadow-2xl shadow-blue-950/60 backdrop-blur">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="mr-auto text-lg font-semibold tracking-wide text-cyan-100">
              Elemental Projection Studio
            </h1>
            <output
              aria-live="polite"
              className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] ${
                status === 'idle'
                  ? 'bg-emerald-400/15 text-emerald-200'
                  : 'bg-cyan-400/15 text-cyan-100'
              }`}
              data-testid="fire-thunder-lab-status"
            >
              {status}
            </output>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              className="rounded-lg bg-orange-500 px-4 py-2 font-semibold text-white shadow-lg shadow-orange-950/40 hover:bg-orange-400"
              onClick={startFire}
              type="button"
            >
              Start Fire
            </button>
            <button
              className="rounded-lg bg-blue-500 px-4 py-2 font-semibold text-white shadow-lg shadow-blue-950/50 hover:bg-blue-400"
              onClick={startThunder}
              type="button"
            >
              Start Thunder
            </button>
            <button
              className="rounded-lg border border-white/20 bg-white/10 px-4 py-2 font-medium hover:bg-white/15"
              onClick={stop}
              type="button"
            >
              Stop
            </button>
            <button
              className="rounded-lg border border-cyan-200/25 bg-cyan-200/10 px-4 py-2 font-medium hover:bg-cyan-200/15"
              onClick={reset}
              type="button"
            >
              Reset
            </button>
            <button
              className="rounded-lg border border-red-300/40 bg-red-500/20 px-4 py-2 font-semibold text-red-100 hover:bg-red-500/30"
              onClick={emergencyStop}
              type="button"
            >
              Emergency Stop
            </button>
          </div>

          <label className="mt-3 flex w-fit items-center gap-2 text-sm text-slate-200">
            <input
              checked={reducedMotion}
              className="h-4 w-4 accent-cyan-400"
              onChange={(event) => setReducedMotion(event.target.checked)}
              type="checkbox"
            />
            Reduced motion (Thunder)
          </label>
        </section>

        <p className="absolute bottom-5 left-1/2 z-10 -translate-x-1/2 rounded-full border border-white/10 bg-black/45 px-4 py-2 text-center text-xs text-slate-300 backdrop-blur">
          Fire rises for 8 seconds · Thunder charges for 5 seconds · every
          effect returns to idle
        </p>
      </main>
    </>
  )
}

export default FireThunderLabPage
