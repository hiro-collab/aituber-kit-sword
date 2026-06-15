export type ReviewProofMessageClass =
  | 'command_accepted_unconfirmed'
  | 'normal_conversation_fallback'
  | 'empty'

const COMMAND_ACCEPTED_UNCONFIRMED_MESSAGE =
  'コマンドは送信済みです。実際に変わったかは未確認です。目視または別センサーで確認してください。'

export const classifyReviewProofMessage = (
  message: string
): ReviewProofMessageClass => {
  const normalized = message.replace(/\s+/g, ' ').trim()
  if (!normalized) return 'empty'

  const mentionsExternalConfirmation =
    normalized.includes('外部確認') ||
    normalized.includes('未確認') ||
    normalized.includes('別センサー') ||
    normalized.toLowerCase().includes('external observation') ||
    normalized.toLowerCase().includes('physical state')
  const mentionsCommandSubmitted =
    normalized.includes('送信') ||
    normalized.includes('submitted') ||
    normalized.includes('execute_succeeded')

  return mentionsExternalConfirmation && mentionsCommandSubmitted
    ? 'command_accepted_unconfirmed'
    : 'normal_conversation_fallback'
}

export const compactReviewProofMessage = (message: string): string => {
  const normalized = message.replace(/\s+/g, ' ').trim()
  if (!normalized) return ''

  if (
    classifyReviewProofMessage(normalized) === 'command_accepted_unconfirmed'
  ) {
    return COMMAND_ACCEPTED_UNCONFIRMED_MESSAGE
  }

  return message.trim()
}
