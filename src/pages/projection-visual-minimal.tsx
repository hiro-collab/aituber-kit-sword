import { type FormEvent, useLayoutEffect, useRef, useState } from 'react'
import {
  ProjectionVisualStrictAssistantBubble,
  type ProjectionVisualStrictAssistantMessage,
} from '@/components/projectionVisualStrictAssistantBubble'

const REQUEST_MODE = 'minimal-transient-text-v1'
const TOKEN = /^[A-Za-z0-9_.:-]{1,180}$/
const createRequestId = (kind: 'session' | 'turn') =>
  `ait_${kind}_${globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)}`

type RequestPhase =
  | 'request_active'
  | 'response_visible'
  | 'stop_pending'
  | 'presentation_cleanup_complete'
  | 'presentation_cleanup_unknown'
type ActiveRequest = {
  epoch: number
  sessionId: string
  turnId: string
  assistantMessageId: string | null
  controller: AbortController
  phase: RequestPhase
}
const isTerminal = (phase: RequestPhase) =>
  phase === 'presentation_cleanup_complete' ||
  phase === 'presentation_cleanup_unknown'
const owns = (
  active: ActiveRequest | null,
  request: ActiveRequest,
  phase: RequestPhase
) =>
  Boolean(
    active &&
      active.epoch === request.epoch &&
      active.sessionId === request.sessionId &&
      active.turnId === request.turnId &&
      active.phase === phase
  )

const ProjectionVisualMinimal = () => {
  const [query, setQuery] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState(false)
  const [assistant, setAssistant] =
    useState<ProjectionVisualStrictAssistantMessage | null>(null)
  const [cleanupEpoch, setCleanupEpoch] = useState(0)
  const rootRef = useRef<HTMLElement>(null)
  const epochRef = useRef(0)
  const activeRef = useRef<ActiveRequest | null>(null)

  useLayoutEffect(() => {
    const request = activeRef.current
    if (!request || request.epoch !== cleanupEpoch || request.phase !== 'stop_pending') {
      return
    }
    let next: RequestPhase = 'presentation_cleanup_unknown'
    try {
      if (!rootRef.current) throw new Error()
      const residue =
        request.assistantMessageId !== null &&
        Array.from(
          rootRef.current.querySelectorAll('[data-assistant-message-id]')
        ).some(
          (node) =>
            node.getAttribute('data-assistant-message-id') ===
            request.assistantMessageId
        )
      next = residue
        ? 'presentation_cleanup_unknown'
        : 'presentation_cleanup_complete'
    } catch {}
    if (!owns(activeRef.current, request, 'stop_pending')) return
    request.phase = next
    setPending(false)
  }, [cleanupEpoch])

  const stop = () => {
    const request = activeRef.current
    if (
      !request ||
      (request.phase !== 'request_active' &&
        request.phase !== 'response_visible')
    ) {
      return
    }
    const assistantMessageId = request.assistantMessageId
    request.phase = 'stop_pending'
    request.controller.abort()
    setAssistant((current) =>
      assistantMessageId !== null && current?.id === assistantMessageId
        ? null
        : current
    )
    setError(false)
    setCleanupEpoch(request.epoch)
  }

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const text = query.trim()
    const previous = activeRef.current
    if (!text || (previous && !isTerminal(previous.phase))) return
    setPending(true)
    setError(false)
    setAssistant(null)
    const sessionId = createRequestId('session')
    const turnId = createRequestId('turn')
    const request: ActiveRequest = {
      epoch: ++epochRef.current,
      sessionId,
      turnId,
      assistantMessageId: null,
      controller: new AbortController(),
      phase: 'request_active',
    }
    activeRef.current = request
    try {
      const result = await fetch('/api/thoughtCoreChat/', {
        method: 'POST',
        signal: request.controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'X-Sword-AIT-Request-Mode': REQUEST_MODE,
        },
        body: JSON.stringify({ query: text, sessionId, turnId }),
      })
      if (!owns(activeRef.current, request, 'request_active')) return
      if (!result.ok) throw new Error()
      const data = await result.json()
      if (!owns(activeRef.current, request, 'request_active')) return
      const keys =
        data && typeof data === 'object' ? Object.keys(data).sort() : []
      const content =
        data && typeof data.response === 'string' ? data.response.trim() : ''
      if (
        keys.join(',') !== 'assistantMessageId,response,sessionId,turnId' ||
        data.sessionId !== sessionId ||
        data.turnId !== turnId ||
        typeof data.assistantMessageId !== 'string' ||
        !TOKEN.test(data.assistantMessageId) ||
        !content ||
        content.length > 8_000 ||
        /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(content)
      ) {
        throw new Error()
      }
      request.assistantMessageId = data.assistantMessageId
      request.phase = 'response_visible'
      setAssistant({ id: data.assistantMessageId, content })
    } catch {
      if (!owns(activeRef.current, request, 'request_active')) return
      request.phase = 'presentation_cleanup_unknown'
      setError(true)
      setAssistant((current) =>
        current?.id === request.assistantMessageId ? null : current
      )
    } finally {
      const active = activeRef.current
      if (
        active?.epoch === request.epoch &&
        active.sessionId === request.sessionId &&
        active.turnId === request.turnId &&
        isTerminal(active.phase)
      ) {
        setPending(false)
      }
    }
  }

  const cleanupPhase = activeRef.current?.phase
  const cleanupReceipt =
    cleanupPhase && isTerminal(cleanupPhase) ? cleanupPhase : undefined

  return (
    <main
      ref={rootRef}
      className="projection-visual-minimal"
      data-presentation-cleanup={cleanupReceipt}
    >
      <ProjectionVisualStrictAssistantBubble message={assistant} />
      {error ? <p role="alert">Request failed</p> : null}
      {pending || assistant ? (
        <button type="button" onClick={stop}>
          Stop
        </button>
      ) : null}
      <form aria-label="minimal text request" onSubmit={submit}>
        <label>
          Message
          <input
            aria-label="minimal text message"
            value={query}
            disabled={pending}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <button type="submit" disabled={pending || !query.trim()}>
          Send
        </button>
      </form>
    </main>
  )
}

export default ProjectionVisualMinimal
