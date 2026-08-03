import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import ProjectionVisualMinimal from '@/pages/projection-visual-minimal'

describe('projection-visual-minimal', () => {
  const originalFetch = global.fetch

  afterEach(() => {
    global.fetch = originalFetch
    delete (window as any).__projectionVisualSpeechOutputSummaryV0
    delete (window as any).__projectionVisualSpeechOutputParityV0
    jest.restoreAllMocks()
  })

  it('keeps idle, pending, success, duplicate, and failure page-local', async () => {
    const summary = { prior: true }
    const parity = { prior: true }
    ;(window as any).__projectionVisualSpeechOutputSummaryV0 = summary
    ;(window as any).__projectionVisualSpeechOutputParityV0 = parity
    const storage = jest.spyOn(Storage.prototype, 'setItem')
    let finish!: (value: Response) => void
    global.fetch = jest.fn(
      () => new Promise<Response>((resolve) => (finish = resolve))
    ) as typeof fetch

    const { container } = render(<ProjectionVisualMinimal />)
    expect(container.querySelectorAll('aside')).toHaveLength(0)
    fireEvent.change(screen.getByLabelText('minimal text message'), {
      target: { value: 'operator text' },
    })
    const form = screen.getByRole('form', { name: 'minimal text request' })
    fireEvent.submit(form)
    fireEvent.submit(form)
    expect(global.fetch).toHaveBeenCalledTimes(1)
    expect(container.querySelectorAll('aside')).toHaveLength(0)
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0]
    const request = JSON.parse(init.body)
    expect(url).toBe('/api/thoughtCoreChat/')
    expect(Object.keys(request).sort()).toEqual(['query', 'sessionId', 'turnId'])
    expect(init.headers).toEqual({
      'Content-Type': 'application/json',
      'X-Sword-AIT-Request-Mode': 'minimal-transient-text-v1',
    })
    await act(async () =>
      finish({
        ok: true,
        json: async () => ({
          sessionId: request.sessionId,
          turnId: request.turnId,
          assistantMessageId: 'assistant_001',
          response: 'strict response',
        }),
      } as Response)
    )
    const bubble = screen.getByLabelText('アシスタントの会話内容')
    expect(container.querySelectorAll('aside')).toHaveLength(1)
    expect(bubble).toHaveAttribute('data-assistant-message-id', 'assistant_001')
    expect(bubble).toHaveTextContent('strict response')

    ;(global.fetch as jest.Mock).mockRejectedValueOnce(new Error('private'))
    fireEvent.change(screen.getByLabelText('minimal text message'), {
      target: { value: 'failure' },
    })
    fireEvent.submit(form)
    await waitFor(() => expect(container.querySelectorAll('aside')).toHaveLength(0))
    expect(screen.getByRole('alert')).toHaveTextContent('Request failed')
    expect(global.fetch).toHaveBeenCalledTimes(2)
    expect((global.fetch as jest.Mock).mock.calls.map(([calledUrl]) => calledUrl)).toEqual([
      '/api/thoughtCoreChat/', '/api/thoughtCoreChat/',
    ])
    expect(storage).not.toHaveBeenCalled()
    expect((window as any).__projectionVisualSpeechOutputSummaryV0).toBe(summary)
    expect((window as any).__projectionVisualSpeechOutputParityV0).toBe(parity)
  })
})
