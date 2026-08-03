import { type FormEvent, useRef, useState } from 'react'
import {
  ProjectionVisualStrictAssistantBubble,
  type ProjectionVisualStrictAssistantMessage,
} from '@/components/projectionVisualStrictAssistantBubble'

const REQUEST_MODE = 'minimal-transient-text-v1'
const TOKEN = /^[A-Za-z0-9_.:-]{1,180}$/
const createRequestId = (kind: 'session' | 'turn') =>
  `ait_${kind}_${globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)}`

const ProjectionVisualMinimal = () => {
  const [query, setQuery] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState(false)
  const [assistant, setAssistant] =
    useState<ProjectionVisualStrictAssistantMessage | null>(null)
  const pendingRef = useRef(false)

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const text = query.trim()
    if (!text || pendingRef.current) return
    pendingRef.current = true
    setPending(true)
    setError(false)
    setAssistant(null)
    const sessionId = createRequestId('session')
    const turnId = createRequestId('turn')
    try {
      const result = await fetch('/api/thoughtCoreChat/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Sword-AIT-Request-Mode': REQUEST_MODE,
        },
        body: JSON.stringify({ query: text, sessionId, turnId }),
      })
      if (!result.ok) throw new Error()
      const data = await result.json()
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
      setAssistant({ id: data.assistantMessageId, content })
    } catch {
      setError(true)
      setAssistant(null)
    } finally {
      pendingRef.current = false
      setPending(false)
    }
  }

  return (
    <main className="projection-visual-minimal">
      <ProjectionVisualStrictAssistantBubble message={assistant} />
      {error ? <p role="alert">Request failed</p> : null}
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
