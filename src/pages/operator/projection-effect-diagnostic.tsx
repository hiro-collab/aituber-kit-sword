import Head from 'next/head'
import { useRef, useState } from 'react'
import {
  createProjectionEffectDiagnosticController,
  type ProjectionEffectDiagnosticAction,
  type ProjectionEffectDiagnosticController,
  type ProjectionEffectDiagnosticResult,
} from '@/features/projectionEffects/browser/projectionEffectDiagnosticController'

type DiagnosticView = Readonly<{
  event_id: string | null
  status: ProjectionEffectDiagnosticResult['status'] | 'idle' | 'inflight'
  result_class:
    | ProjectionEffectDiagnosticResult['result_class']
    | 'not_run'
    | 'awaiting_correlated_receipt'
}>

const INITIAL_VIEW: DiagnosticView = Object.freeze({
  event_id: null,
  status: 'idle',
  result_class: 'not_run',
})

const INFLIGHT_VIEW: DiagnosticView = Object.freeze({
  event_id: null,
  status: 'inflight',
  result_class: 'awaiting_correlated_receipt',
})

const ACTIONS: ReadonlyArray<
  Readonly<{ action: ProjectionEffectDiagnosticAction; label: string }>
> = Object.freeze([
  Object.freeze({ action: 'fire_start', label: 'Fire start' }),
  Object.freeze({ action: 'thunder_start', label: 'Thunder start' }),
  Object.freeze({ action: 'stop', label: 'Stop' }),
  Object.freeze({ action: 'reset', label: 'Reset' }),
])

const projectDiagnosticResult = (
  result: ProjectionEffectDiagnosticResult
): DiagnosticView =>
  Object.freeze({
    event_id: result.event_id,
    status: result.status,
    result_class: result.result_class,
  })

const ProjectionEffectDiagnosticOperator = () => {
  const controllerRef = useRef<ProjectionEffectDiagnosticController | null>(
    null
  )
  if (!controllerRef.current) {
    controllerRef.current = createProjectionEffectDiagnosticController()
  }
  const requestInFlightRef = useRef(false)
  const [requestInFlight, setRequestInFlight] = useState(false)
  const [diagnostic, setDiagnostic] = useState<DiagnosticView>(INITIAL_VIEW)

  const runDiagnostic = async (action: ProjectionEffectDiagnosticAction) => {
    if (requestInFlightRef.current) return
    requestInFlightRef.current = true
    setRequestInFlight(true)
    setDiagnostic(INFLIGHT_VIEW)
    try {
      const result = await controllerRef.current!.execute(action)
      setDiagnostic(projectDiagnosticResult(result))
    } catch {
      setDiagnostic(
        Object.freeze({
          event_id: null,
          status: 'rejected',
          result_class: 'delivery_unconfirmed',
        })
      )
    } finally {
      requestInFlightRef.current = false
      setRequestInFlight(false)
    }
  }

  const verdict =
    diagnostic.status === 'completed'
      ? 'VERIFIED'
      : diagnostic.status === 'idle'
        ? 'NOT RUN'
        : diagnostic.status === 'inflight'
          ? 'PENDING'
          : 'DEGRADED'

  return (
    <>
      <Head>
        <title>Projection Effect Operator Diagnostic</title>
      </Head>
      <main className="mx-auto max-w-3xl space-y-6 p-6 text-slate-950">
        <header className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-700">
            Operator diagnostic only
          </p>
          <h1 className="text-2xl font-semibold">
            Projection Effect Delivery Diagnostic
          </h1>
          <p>
            This page verifies the existing delivery contract with bounded,
            fixed catalog actions. It never grants normal AI or user authority.
          </p>
        </header>

        <section
          aria-labelledby="projection-effect-diagnostic-actions"
          className="space-y-3 rounded-lg border border-slate-300 p-4"
        >
          <h2
            className="font-semibold"
            id="projection-effect-diagnostic-actions"
          >
            Fixed diagnostic actions
          </h2>
          <div className="flex flex-wrap gap-2">
            {ACTIONS.map(({ action, label }) => (
              <button
                className="rounded border border-slate-400 px-4 py-2 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={requestInFlight}
                key={action}
                onClick={() => void runDiagnostic(action)}
                type="button"
              >
                {label}
              </button>
            ))}
          </div>
          <p className="text-sm text-slate-700">
            One request may be in flight. VERIFIED appears only after a
            correlated completed receipt; every other terminal outcome is
            DEGRADED.
          </p>
        </section>

        <section
          aria-labelledby="projection-effect-diagnostic-result"
          className="space-y-3 rounded-lg border border-slate-300 p-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2
              className="font-semibold"
              id="projection-effect-diagnostic-result"
            >
              Diagnostic result
            </h2>
            <output
              aria-live="polite"
              className="rounded-full border border-slate-400 px-3 py-1 text-sm font-semibold"
              data-testid="projection-effect-diagnostic-verdict"
            >
              {verdict}
            </output>
          </div>
          <dl
            className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2 font-mono text-sm"
            data-testid="projection-effect-diagnostic-result-fields"
          >
            <dt>event_id</dt>
            <dd>{diagnostic.event_id ?? 'null'}</dd>
            <dt>status</dt>
            <dd>{diagnostic.status}</dd>
            <dt>result_class</dt>
            <dd>{diagnostic.result_class}</dd>
          </dl>
        </section>

        <aside className="rounded-lg border border-amber-400 bg-amber-50 p-4 text-sm">
          No Journal write is performed here. Journal evidence requires a future
          Control-issued event.
        </aside>
      </main>
    </>
  )
}

export default ProjectionEffectDiagnosticOperator
