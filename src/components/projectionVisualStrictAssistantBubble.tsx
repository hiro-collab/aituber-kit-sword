export type ProjectionVisualStrictAssistantMessage = Readonly<{
  id: string
  content: string
}>

export const ProjectionVisualStrictAssistantBubble = ({
  message,
}: {
  message: ProjectionVisualStrictAssistantMessage | null
}) => {
  if (message === null) return null
  return (
    <aside
      className="td-assistant-bubble"
      role="status"
      aria-live="polite"
      aria-label="アシスタントの会話内容"
      data-assistant-message-id={message.id}
    >
      <div className="td-assistant-bubble-text">{message.content}</div>
      <span className="td-assistant-bubble-tail" aria-hidden="true" />
    </aside>
  )
}
