import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { existsSync, readFileSync, statSync } from 'fs'
import { hydrateRoot } from 'react-dom/client'
import { TextEncoder } from 'util'
import PreparedSampleSttOperator from '@/pages/operator/prepared-sample-stt'

Object.assign(global, { TextEncoder })
const { renderToString } =
  require('react-dom/server') as typeof import('react-dom/server')

const SHARED_VECTOR_FILE = 'm4_cross_repo_attempt_vectors.v0.json'
const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const readSharedVectors = () => {
  const fixturePath = process.env.SWORD_M4_SHARED_VECTOR_PATH
  if (!fixturePath) return null
  if (!fixturePath.endsWith(SHARED_VECTOR_FILE) || !existsSync(fixturePath)) {
    throw new Error(
      'configured M4 shared vector fixture is missing or unexpected'
    )
  }
  const size = statSync(fixturePath).size
  if (size < 1 || size > 64 * 1024) {
    throw new Error('configured M4 shared vector fixture has an invalid size')
  }
  let value: unknown
  try {
    value = JSON.parse(readFileSync(fixturePath, 'utf8'))
  } catch {
    throw new Error('configured M4 shared vector fixture is malformed')
  }
  if (
    !isRecord(value) ||
    value.schema_version !== 'm4_cross_repo_attempt_vectors.v0' ||
    typeof value.canonical_conversation_attempt_ref !== 'string' ||
    !isRecord(value.invalid_conversation_attempt_refs) ||
    Object.keys(value.invalid_conversation_attempt_refs).length !== 7 ||
    !Object.values(value.invalid_conversation_attempt_refs).every(
      (ref) => typeof ref === 'string'
    )
  ) {
    throw new Error('configured M4 shared vector fixture has an invalid shape')
  }
  return {
    canonicalConversationAttemptRef: value.canonical_conversation_attempt_ref,
    invalidConversationAttemptRefs: Object.values(
      value.invalid_conversation_attempt_refs
    ) as string[],
  }
}

const sharedVectors = readSharedVectors()
let mockIsListening = false
const conversationAttemptRef =
  sharedVectors?.canonicalConversationAttemptRef ??
  'm4.prepared_sample_attempt:0123456789abcdef0123456789abcdef'
const invalidConversationAttemptRefs =
  sharedVectors?.invalidConversationAttemptRefs ?? ['not-a-canonical-ref']
const startListening = jest.fn(async () => {
  mockIsListening = true
  return true
})
const stopListening = jest.fn(async () => {
  mockIsListening = false
})

jest.mock('@/hooks/useBrowserSpeechRecognition', () => ({
  useBrowserSpeechRecognition: jest.fn(() => ({
    userMessage: 'stale rendered transcript',
    isListening: mockIsListening,
    startListening,
    stopListening,
  })),
}))

const dispatchDiagnostic = (detail: Record<string, unknown>) => {
  window.dispatchEvent(
    new CustomEvent('projection-visual-stt-diagnostic', { detail })
  )
}

const setParentPreflightQuery = (query = '') => {
  window.history.replaceState(
    {},
    '',
    `/operator/prepared-sample-stt?${
      query ||
      `conversation_attempt_ref=${conversationAttemptRef}&selected_sample_id=voice.local_sample_001&sample_index_preflight_class=prepared_sample_index_verified&sample_index_preflight_ref=m4.sample_index_preflight_001`
    }`
  )
}

const prepareRunInputs = () => {
  fireEvent.change(screen.getByLabelText('Expected prepared-sample text'), {
    target: { value: 'prepared sample' },
  })
}

describe('PreparedSampleSttOperator', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    mockIsListening = false
    startListening.mockClear()
    stopListening.mockClear()
    setParentPreflightQuery()
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('keeps SSR and the first client render query-independent and non-actionable', async () => {
    jest.useRealTimers()
    setParentPreflightQuery()
    const validQueryServerHtml = renderToString(<PreparedSampleSttOperator />)
    window.history.replaceState({}, '', '/operator/prepared-sample-stt')
    const missingQueryServerHtml = renderToString(<PreparedSampleSttOperator />)

    expect(validQueryServerHtml).toBe(missingQueryServerHtml)

    const container = document.createElement('div')
    container.innerHTML = validQueryServerHtml
    document.body.appendChild(container)
    expect(
      within(container).getByTestId('prepared-sample-parent-preflight')
    ).toHaveTextContent('parent_preflight_mount_pending')
    expect(
      within(container).getByRole('button', {
        name: 'Start bounded attempt',
      })
    ).toBeDisabled()
    expect(container).not.toHaveTextContent('voice.local_sample_001')

    setParentPreflightQuery()
    const recoverableErrors: unknown[] = []
    let root: ReturnType<typeof hydrateRoot> | null = null
    try {
      await act(async () => {
        root = hydrateRoot(container, <PreparedSampleSttOperator />, {
          onRecoverableError: (error) => recoverableErrors.push(error),
        })
      })

      expect(recoverableErrors).toEqual([])
      expect(
        within(container).getByTestId('prepared-sample-parent-preflight')
      ).toHaveTextContent(
        'selected_sample_id=voice.local_sample_001 sample_index_preflight_class=prepared_sample_index_verified'
      )
      expect(
        within(container).getByRole('button', {
          name: 'Start bounded attempt',
        })
      ).toBeEnabled()
      expect(startListening).not.toHaveBeenCalled()
    } finally {
      if (root) {
        await act(async () => {
          root?.unmount()
        })
      }
      container.remove()
    }
  })

  it('uses the latest active browser-STT diagnostic transcript for matching', async () => {
    render(<PreparedSampleSttOperator />)
    prepareRunInputs()

    dispatchDiagnostic({
      controller: 'browser_stt',
      event: 'onresult_final',
      transcript: 'outside attempt',
    })
    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: 'Start bounded attempt' })
      )
    })
    dispatchDiagnostic({
      controller: 'other_controller',
      event: 'onresult_final',
      transcript: 'ignored',
    })
    dispatchDiagnostic({
      controller: 'browser_stt',
      event: 'onresult_interim',
      transcript: 'outdated transcript',
    })
    dispatchDiagnostic({
      controller: 'browser_stt',
      event: 'onresult_final',
      transcript: 'prepared sample',
    })

    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: 'Record final result' })
      )
    })

    expect(screen.getByText('Result events').nextSibling).toHaveTextContent('2')
    expect(screen.getByText('Final results').nextSibling).toHaveTextContent('1')
    expect(
      screen.getByText('sample_index_preflight_class').nextSibling
    ).toHaveTextContent('prepared_sample_index_verified')
    expect(
      screen.getByText('last_attempt_content_match_class').nextSibling
    ).toHaveTextContent('matched')
    expect(
      screen.getByText('last_attempt_stop_class').nextSibling
    ).toHaveTextContent('final_result_recorded')
    expect(screen.getByText('Stability').nextSibling).toHaveTextContent(
      'incomplete_attempt_set'
    )
    expect(stopListening).toHaveBeenCalledTimes(1)
  })

  it('records timeout stop and content classes and prevents duplicate completion', async () => {
    render(<PreparedSampleSttOperator />)
    prepareRunInputs()
    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: 'Start bounded attempt' })
      )
    })
    dispatchDiagnostic({
      controller: 'browser_stt',
      event: 'onresult_final',
      transcript: 'prepared sample',
    })

    await act(async () => {
      jest.advanceTimersByTime(10_000)
      fireEvent.click(
        screen.getByRole('button', { name: 'Record final result' })
      )
    })

    expect(screen.getByTestId('prepared-sample-stt-status')).toHaveTextContent(
      'attempt_timeout'
    )
    expect(screen.getByText('Result events').nextSibling).toHaveTextContent('1')
    expect(screen.getByText('Final results').nextSibling).toHaveTextContent('1')
    expect(screen.getByText('Stability').nextSibling).toHaveTextContent(
      'incomplete_attempt_set'
    )
    expect(
      screen.getByText('last_attempt_content_match_class').nextSibling
    ).toHaveTextContent('timed_out')
    expect(
      screen.getByText('last_attempt_stop_class').nextSibling
    ).toHaveTextContent('attempt_timeout')
    expect(stopListening).toHaveBeenCalledTimes(1)
  })

  it('fails closed for a missing parent preflight query', () => {
    window.history.replaceState({}, '', '/operator/prepared-sample-stt')
    render(<PreparedSampleSttOperator />)
    expect(
      screen.getByTestId('prepared-sample-parent-preflight')
    ).toHaveTextContent('parent_preflight_query_required')
    expect(
      screen.getByRole('button', { name: 'Start bounded attempt' })
    ).toBeDisabled()
    expect(startListening).not.toHaveBeenCalled()
  })

  it.each([
    'Voice.local_sample_001',
    '1voice.local_sample_001',
    'voice%3Alocal_sample_001',
    'ab',
  ])(
    'fails closed before startListening for an invalid selected sample ID %s',
    (selectedSampleId) => {
      setParentPreflightQuery(
        `conversation_attempt_ref=${conversationAttemptRef}&selected_sample_id=${selectedSampleId}&sample_index_preflight_class=prepared_sample_index_verified&sample_index_preflight_ref=m4.sample_index_preflight_001`
      )
      render(<PreparedSampleSttOperator />)

      expect(
        screen.getByTestId('prepared-sample-parent-preflight')
      ).toHaveTextContent('parent_preflight_query_invalid')
      expect(
        screen.getByRole('button', { name: 'Start bounded attempt' })
      ).toBeDisabled()
      expect(startListening).not.toHaveBeenCalled()
    }
  )

  it('fails closed for other invalid parent preflight query parameters', () => {
    setParentPreflightQuery(
      'conversation_attempt_ref=bad%20ref&selected_sample_id=voice.local_sample_001&sample_index_preflight_class=unverified&sample_index_preflight_ref=m4.sample_index_preflight_001'
    )
    render(<PreparedSampleSttOperator />)

    expect(
      screen.getByTestId('prepared-sample-parent-preflight')
    ).toHaveTextContent('parent_preflight_query_invalid')
    expect(
      screen.getByRole('button', { name: 'Start bounded attempt' })
    ).toBeDisabled()
    expect(startListening).not.toHaveBeenCalled()
  })

  it.each(invalidConversationAttemptRefs)(
    'fails closed before startListening for invalid conversation attempt ref %s',
    (invalidRef) => {
      setParentPreflightQuery(
        `conversation_attempt_ref=${invalidRef}&selected_sample_id=voice.local_sample_001&sample_index_preflight_class=prepared_sample_index_verified&sample_index_preflight_ref=m4.sample_index_preflight_001`
      )
      render(<PreparedSampleSttOperator />)

      expect(
        screen.getByTestId('prepared-sample-parent-preflight')
      ).toHaveTextContent('parent_preflight_query_invalid')
      expect(
        screen.getByRole('button', { name: 'Start bounded attempt' })
      ).toBeDisabled()
      expect(startListening).not.toHaveBeenCalled()
    }
  )

  it('does not materialize TurnInput or a submission path', () => {
    const source = readFileSync(
      require.resolve('@/pages/operator/prepared-sample-stt'),
      'utf8'
    )

    expect(source).not.toContain('TurnInput')
    expect(source).not.toContain('thoughtCoreChat')
  })
})
