import { render, screen } from '@testing-library/react'
import { ProjectionVisualStrictAssistantBubble } from '@/components/projectionVisualStrictAssistantBubble'

describe('ProjectionVisualStrictAssistantBubble', () => {
  afterEach(() => jest.restoreAllMocks())

  it('renders nothing for null', () => {
    const { container } = render(
      <ProjectionVisualStrictAssistantBubble message={null} />
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('renders exactly one escaped assistant bubble from its readonly value', () => {
    const listener = jest.spyOn(window, 'addEventListener')
    const storage = jest.spyOn(Storage.prototype, 'setItem')
    const { container } = render(
      <ProjectionVisualStrictAssistantBubble
        message={{ id: 'assistant_001', content: '<script>safe text</script>' }}
      />
    )
    const bubble = screen.getByLabelText('アシスタントの会話内容')
    expect(container.querySelectorAll('aside')).toHaveLength(1)
    expect(bubble).toHaveAttribute('data-assistant-message-id', 'assistant_001')
    expect(bubble).toHaveTextContent('<script>safe text</script>')
    expect(bubble.querySelector('script')).toBeNull()
    expect(listener).not.toHaveBeenCalled()
    expect(storage).not.toHaveBeenCalled()
  })
})
