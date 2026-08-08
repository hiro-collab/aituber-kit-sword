import { act, fireEvent, render, screen } from '@testing-library/react'
import { createHash, webcrypto } from 'crypto'
import { TextEncoder as NodeTextEncoder } from 'util'
import ProjectionVisualMinimal from '@/pages/projection-visual-minimal'

describe('projection-visual-minimal', () => {
  const originalFetch = global.fetch
  const originalCrypto = globalThis.crypto
  const originalTextEncoder = globalThis.TextEncoder

  const deferred = <T,>() => {
    let resolve!: (value: T) => void
    let reject!: (reason: unknown) => void
    const promise = new Promise<T>((yes, no) => {
      resolve = yes
      reject = no
    })
    return { promise, resolve, reject }
  }

  const validResponse = (
    init: RequestInit | undefined,
    assistantMessageId: string,
    response: string
  ) => {
    const request = JSON.parse(String(init?.body))
    const responseBytes = new NodeTextEncoder().encode(response)
    const responseSha256 = createHash('sha256')
      .update(responseBytes)
      .digest('hex')
    const decisionEventId = `evt_${createHash('sha256')
      .update(`${request.sessionId}:${request.turnId}`)
      .digest('hex')
      .slice(0, 32)}`
    return {
      sessionId: request.sessionId,
      turnId: request.turnId,
      assistantMessageId,
      response,
      responseSha256,
      responseUtf8Bytes: responseBytes.byteLength,
      providerAttemptEvidence: {
        evidenceClass: 'sword.thought_core.provider_authorship.v1',
        decisionEventId,
        assistantMessageId,
        upstreamAttemptCount: 1,
        retryCount: 0,
        fallbackCount: 0,
        attemptTerminalClass: 'upstream_response_accepted',
        authorshipClass:
          'official_broker_decision_response_deterministic_presentation',
      },
    }
  }

  beforeEach(() => {
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: webcrypto,
    })
    Object.defineProperty(globalThis, 'TextEncoder', {
      configurable: true,
      value: NodeTextEncoder,
    })
  })

  afterEach(() => {
    global.fetch = originalFetch
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: originalCrypto,
    })
    Object.defineProperty(globalThis, 'TextEncoder', {
      configurable: true,
      value: originalTextEncoder,
    })
    delete (window as any).__projectionVisualSpeechOutputSummaryV0
    delete (window as any).__projectionVisualSpeechOutputParityV0
    jest.restoreAllMocks()
  })

  it('stops a visible response and permits only paired React error guards', async () => {
    const summary = { prior: true }
    const parity = { prior: true }
    ;(window as any).__projectionVisualSpeechOutputSummaryV0 = summary
    ;(window as any).__projectionVisualSpeechOutputParityV0 = parity
    const storage = jest.spyOn(Storage.prototype, 'setItem')
    const added: Array<{
      type: string
      listener: EventListenerOrEventListenerObject
      stack: string
    }> = []
    const removed: Array<{
      type: string
      listener: EventListenerOrEventListenerObject
    }> = []
    const add = window.addEventListener.bind(window)
    const remove = window.removeEventListener.bind(window)
    jest.spyOn(window, 'addEventListener').mockImplementation(
      (type, listener, options) => {
        added.push({ type, listener, stack: new Error().stack ?? '' })
        add(type, listener, options)
      }
    )
    jest.spyOn(window, 'removeEventListener').mockImplementation(
      (type, listener, options) => {
        removed.push({ type, listener })
        remove(type, listener, options)
      }
    )
    const abort = jest.spyOn(AbortController.prototype, 'abort')
    global.fetch = jest.fn(async (_url, init) => {
      return {
        ok: true,
        json: async () => validResponse(
          init,
          'assistant_001',
          'strict response'
        ),
      } as Response
    }) as typeof fetch

    const { container } = render(<ProjectionVisualMinimal />)
    fireEvent.change(screen.getByLabelText('minimal text message'), {
      target: { value: 'operator text' },
    })
    const form = screen.getByRole('form', { name: 'minimal text request' })
    fireEvent.submit(form)
    await screen.findByText('strict response')
    expect(global.fetch).toHaveBeenCalledTimes(1)
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0]
    const request = JSON.parse(init.body)
    expect(url).toBe('/api/thoughtCoreChat/')
    expect(Object.keys(request).sort()).toEqual(['query', 'sessionId', 'turnId'])
    expect(init.headers).toEqual({
      'Content-Type': 'application/json',
      'X-Sword-AIT-Request-Mode': 'minimal-transient-text-v1',
    })
    expect(init.signal).toBeInstanceOf(AbortSignal)
    const bubble = screen.getByLabelText('アシスタントの会話内容')
    expect(bubble).toHaveAttribute('data-assistant-message-id', 'assistant_001')
    const unrelated = document.createElement('aside')
    unrelated.dataset.assistantMessageId = 'unrelated_001'
    const residue = document.createElement('aside')
    residue.dataset.assistantMessageId = 'assistant_001'
    container.firstElementChild?.append(unrelated, residue)
    const stop = screen.getByRole('button', { name: 'Stop' })
    act(() => {
      stop.click()
      stop.click()
    })
    expect(abort).toHaveBeenCalledTimes(1)
    expect(screen.queryByLabelText('アシスタントの会話内容')).toBeNull()
    expect(unrelated).toBeInTheDocument()
    expect(container.firstElementChild).toHaveAttribute(
      'data-presentation-cleanup',
      'presentation_cleanup_unknown'
    )
    expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled()
    expect(storage).not.toHaveBeenCalled()
    expect(added).toHaveLength(4)
    expect(removed).toHaveLength(4)
    for (const registration of added) {
      expect(registration.type).toBe('error')
      expect(typeof registration.listener).toBe('function')
      expect((registration.listener as EventListener & { name: string }).name).toBe(
        'handleWindowError'
      )
      expect(registration.stack).toMatch(
        /at (?:Object\.)?invokeGuardedCallbackDev .*node_modules[\\/]react-dom[\\/]cjs[\\/]react-dom\.development\.js/
      )
      expect(removed.filter((entry) =>
        entry.type === registration.type &&
        entry.listener === registration.listener
      )).toHaveLength(1)
    }
    expect(removed.every((entry) => added.some((registration) =>
      registration.type === entry.type &&
      registration.listener === entry.listener
    ))).toBe(true)
    expect((window as any).__projectionVisualSpeechOutputSummaryV0).toBe(summary)
    expect((window as any).__projectionVisualSpeechOutputParityV0).toBe(parity)
  })

  it('fences stop-before-response and ignores late resolve and reject', async () => {
    const first = deferred<Response>()
    const second = deferred<Response>()
    const abort = jest.spyOn(AbortController.prototype, 'abort')
    global.fetch = jest.fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise) as typeof fetch
    const { container } = render(<ProjectionVisualMinimal />)
    const input = screen.getByLabelText('minimal text message')
    const form = screen.getByRole('form', { name: 'minimal text request' })
    fireEvent.change(input, { target: { value: 'first' } })
    fireEvent.submit(form)
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }))
    expect(container.firstElementChild).toHaveAttribute(
      'data-presentation-cleanup',
      'presentation_cleanup_complete'
    )
    const firstBody = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body)
    await act(async () => first.resolve({ ok: true, json: async () =>
      validResponse(
        { body: JSON.stringify(firstBody) },
        'late_001',
        'late response'
      ) } as Response))
    expect(screen.queryByText('late response')).toBeNull()

    fireEvent.change(input, { target: { value: 'second' } })
    fireEvent.submit(form)
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }))
    await act(async () => second.reject(new Error('late private reject')))
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByLabelText('アシスタントの会話内容')).toBeNull()
    expect(global.fetch).toHaveBeenCalledTimes(2)
    expect(abort).toHaveBeenCalledTimes(2)
  })
})
