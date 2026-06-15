import settingsStore from '@/features/stores/settings'
import { Message } from '../messages/messages'
import i18next from 'i18next'
import toastStore from '@/features/stores/toast'

function handleApiError(errorCode: string): string {
  const languageCode = settingsStore.getState().selectLanguage
  i18next.changeLanguage(languageCode)
  return i18next.t(`Errors.${errorCode || 'AIAPIError'}`)
}

type DifyErrorCause = {
  errorCode?: string
  detail?: string
}

function getDifyErrorCause(error: unknown): DifyErrorCause {
  if (!error || typeof error !== 'object' || !('cause' in error)) {
    return {}
  }

  return ((error as { cause?: DifyErrorCause }).cause ?? {}) as DifyErrorCause
}

export async function getDifyChatResponseStream(
  messages: Message[],
  apiKey: string,
  url: string,
  conversationId: string
): Promise<ReadableStream<string>> {
  const response = await fetch('/api/difyChat/', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query: messages[messages.length - 1].content,
      apiKey,
      url,
      conversationId,
      stream: true,
    }),
  })

  try {
    if (!response.ok) {
      const responseBody = await response.json().catch(() => ({}))
      const errorDetail =
        responseBody.detail || responseBody.error || response.statusText
      throw new Error(
        `API request to Dify failed with status ${response.status} and body ${errorDetail}`,
        { cause: { errorCode: responseBody.errorCode, detail: errorDetail } }
      )
    }

    return new ReadableStream({
      async start(controller) {
        let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
        try {
          if (!response.body) {
            throw new Error('API response from Dify is empty', {
              cause: { errorCode: 'AIAPIError' },
            })
          }

          reader = response.body.getReader()
          const decoder = new TextDecoder('utf-8')
          let buffer = ''

          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            buffer += decoder.decode(value, { stream: true })

            // 改行で分割し、最後の不完全な行をバッファに保持
            let lines = buffer.split('\n')
            buffer = lines.pop() || ''

            lines.forEach((line) => {
              if (line.startsWith('data:')) {
                const jsonStr = line.slice(5) // 'data:' プレフィックスを除去
                try {
                  const data = JSON.parse(jsonStr)
                  if (
                    data.event === 'agent_message' ||
                    data.event === 'message'
                  ) {
                    controller.enqueue(data.answer)
                    settingsStore.setState({
                      difyConversationId: data.conversation_id,
                    })
                  }
                } catch (error) {
                  console.error('Error parsing JSON:', error)
                }
              }
            })
          }
        } catch (error) {
          console.error(`Error fetching Dify API response:`, error)

          toastStore.getState().addToast({
            message: i18next.t('Errors.AIAPIError'),
            type: 'error',
            tag: 'dify-api-error',
          })
        } finally {
          controller.close()
          if (reader) {
            reader.releaseLock()
          }
        }
      },
    })
  } catch (error: any) {
    const cause = getDifyErrorCause(error)
    const errorCode = cause.errorCode || 'AIAPIError'
    const errorMessage = handleApiError(errorCode)
    const message =
      errorCode === 'AIAPIError' && cause.detail
        ? `${errorMessage}: ${cause.detail}`
        : errorMessage
    toastStore.getState().addToast({
      message,
      type: 'error',
      tag: 'dify-api-error',
    })
    throw error
  }
}
