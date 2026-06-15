import { Message } from '@/features/messages/messages'

export type LatestAssistantMessageEntry = {
  id?: string
  content: string
}

/**
 * chatLogから最新のアシスタントメッセージのコンテンツを取得する
 * @param chatLog メッセージログ
 * @returns 最新のアシスタントメッセージの文字列コンテンツ、存在しない場合は空文字
 */
export const getLatestAssistantMessageEntry = (
  chatLog: Message[] | null | undefined
): LatestAssistantMessageEntry => {
  if (!chatLog || chatLog.length === 0) {
    return { content: '' }
  }

  // 配列の末尾から逆順に検索してパフォーマンスを向上
  for (let i = chatLog.length - 1; i >= 0; i--) {
    const msg = chatLog[i]
    if (msg.role === 'assistant') {
      if (typeof msg.content === 'string') {
        return { id: msg.id, content: msg.content }
      } else if (Array.isArray(msg.content)) {
        const textContent = msg.content.find(
          (item: { type: string }) => item.type === 'text'
        )
        return {
          id: msg.id,
          content: textContent && 'text' in textContent ? textContent.text : '',
        }
      }
      return { id: msg.id, content: '' }
    }
  }

  return { content: '' }
}

export const getLatestAssistantMessage = (
  chatLog: Message[] | null | undefined
): string => getLatestAssistantMessageEntry(chatLog).content
