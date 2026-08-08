import { type FormEvent, useRef, useState } from 'react'
import { ProjectionVisualStrictAssistantBubble } from '@/components/projectionVisualStrictAssistantBubble'
import { useProjectionVisualTransientThoughtRequest } from '@/hooks/useProjectionVisualTransientThoughtRequest'

const ProjectionVisualMinimal = () => {
  const [query, setQuery] = useState('')
  const rootRef = useRef<HTMLElement>(null)
  const transient = useProjectionVisualTransientThoughtRequest({
    rootRef,
    enabled: true,
  })

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    void transient.submitText(query)
  }

  return (
    <main
      ref={rootRef}
      className="projection-visual-minimal"
      data-presentation-cleanup={transient.cleanupReceipt}
    >
      <ProjectionVisualStrictAssistantBubble message={transient.assistant} />
      {transient.error ? <p role="alert">Request failed</p> : null}
      {transient.pending || transient.assistant ? (
        <button type="button" onClick={transient.stop}>
          Stop
        </button>
      ) : null}
      <form aria-label="minimal text request" onSubmit={submit}>
        <label>
          Message
          <input
            aria-label="minimal text message"
            value={query}
            disabled={transient.pending}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <button type="submit" disabled={transient.pending || !query.trim()}>
          Send
        </button>
      </form>
    </main>
  )
}

export default ProjectionVisualMinimal
