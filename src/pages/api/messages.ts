import { NextApiRequest, NextApiResponse } from 'next'
import {
  isRestrictedMode,
  createRestrictedModeErrorResponse,
} from '@/utils/restrictedMode'
import { enforceLocalApiRequest } from '@/utils/localApiSecurity'

type MessageType = 'direct_send' | 'ai_generate' | 'user_input'

interface ReceivedMessage {
  timestamp: number
  message: string
  type: MessageType
  systemPrompt?: string
  useCurrentSystemPrompt?: boolean
  image?: string
}

interface MessageQueue {
  messages: ReceivedMessage[]
  lastAccessed: number
}

let messagesPerClient = new Map<string, MessageQueue>()

const CLIENT_TIMEOUT = 1000 * 60 * 5 // 5分
const MAX_MESSAGES_PER_REQUEST = 20
const MAX_MESSAGE_CHARS = 4000
const MAX_CLIENT_ID_CHARS = 128
const MAX_IMAGE_CHARS = 10_000_000 // 約7.5MBのbase64画像に相当
const ALLOW_EXTERNAL_SYSTEM_PROMPT =
  process.env.ALLOW_EXTERNAL_SYSTEM_PROMPT === 'true'
const MESSAGE_TYPES: MessageType[] = [
  'direct_send',
  'ai_generate',
  'user_input',
]

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb',
    },
  },
}

const handler = (req: NextApiRequest, res: NextApiResponse) => {
  if (isRestrictedMode()) {
    return res.status(403).json(createRestrictedModeErrorResponse('messages'))
  }
  if (!enforceLocalApiRequest(req, res, { feature: 'messages' })) {
    return
  }

  const clientId = req.query.clientId as string
  const type = (req.query.type as MessageType) || 'direct_send'

  if (!isValidClientId(clientId)) {
    res.status(400).json({ error: 'Client ID is required' })
    return
  }
  if (!MESSAGE_TYPES.includes(type)) {
    res.status(400).json({ error: 'Invalid message type' })
    return
  }

  if (req.method === 'POST') {
    const { messages, systemPrompt, useCurrentSystemPrompt, image } = req.body

    if (!Array.isArray(messages) || messages.length === 0) {
      res.status(400).json({ error: 'Messages array is required' })
      return
    }
    if (messages.length > MAX_MESSAGES_PER_REQUEST) {
      res.status(413).json({ error: 'Too many messages' })
      return
    }
    if (
      messages.some(
        (message) =>
          typeof message !== 'string' ||
          message.length > MAX_MESSAGE_CHARS ||
          !message.trim()
      )
    ) {
      res.status(400).json({ error: 'Messages must be non-empty strings' })
      return
    }
    if (systemPrompt && typeof systemPrompt !== 'string') {
      res.status(400).json({ error: 'System prompt is not a string' })
      return
    }
    if (useCurrentSystemPrompt && typeof useCurrentSystemPrompt !== 'boolean') {
      res.status(400).json({ error: 'useCurrentSystemPrompt is not a boolean' })
      return
    }
    // nullをundefinedに正規化
    const sanitizedImage =
      image === null || image === undefined ? undefined : image
    if (sanitizedImage !== undefined && typeof sanitizedImage !== 'string') {
      res.status(400).json({ error: 'Image is not a string' })
      return
    }
    if (
      typeof sanitizedImage === 'string' &&
      sanitizedImage.length > MAX_IMAGE_CHARS
    ) {
      res.status(413).json({ error: 'Image payload is too large' })
      return
    }
    if (
      typeof sanitizedImage === 'string' &&
      !/^data:image\/(?:png|jpeg|jpg|gif|webp);base64,/i.test(sanitizedImage)
    ) {
      res.status(400).json({ error: 'Image must be a base64 image data URI' })
      return
    }

    // クライアントキューのクリーンアップ
    cleanupClientQueues()

    // クライアントのキューが存在しない場合は作成
    if (!messagesPerClient.has(clientId)) {
      messagesPerClient.set(clientId, {
        messages: [],
        lastAccessed: Date.now(),
      })
    }
    const clientQueue = messagesPerClient.get(clientId)!

    // メッセージをクライアントのキューに追加
    const timestamp = Date.now()
    messages.forEach((message) => {
      clientQueue.messages.push({
        timestamp,
        message,
        type,
        systemPrompt: ALLOW_EXTERNAL_SYSTEM_PROMPT ? systemPrompt : undefined,
        useCurrentSystemPrompt: ALLOW_EXTERNAL_SYSTEM_PROMPT
          ? useCurrentSystemPrompt
          : type === 'ai_generate'
            ? true
            : undefined,
        image: sanitizedImage,
      })
    })
    clientQueue.lastAccessed = timestamp

    res.status(201).json({ message: 'Successfully sent' })
  } else if (req.method === 'GET') {
    // クライアントのキューが存在しない場合は作成
    if (!messagesPerClient.has(clientId)) {
      messagesPerClient.set(clientId, {
        messages: [],
        lastAccessed: Date.now(),
      })
    }

    // クライアントのキューから全てのメッセージを取得
    const clientQueue = messagesPerClient.get(clientId)!
    const newMessages = clientQueue.messages

    res.status(200).json({ messages: newMessages })

    // キューをクリア
    clientQueue.messages = []
    clientQueue.lastAccessed = Date.now()
  } else {
    res.status(405).json({ error: 'Method not allowed' })
  }
}

// 古いクライアントのキューを削除
function cleanupClientQueues() {
  const now = Date.now()
  for (const [clientId, queue] of messagesPerClient.entries()) {
    if (now - queue.lastAccessed > CLIENT_TIMEOUT) {
      messagesPerClient.delete(clientId)
    }
  }
}

function isValidClientId(clientId: unknown): clientId is string {
  const reservedIds = new Set(['__proto__', 'prototype', 'constructor'])
  return (
    typeof clientId === 'string' &&
    clientId.length > 0 &&
    clientId.length <= MAX_CLIENT_ID_CHARS &&
    !reservedIds.has(clientId) &&
    /^[A-Za-z0-9._:-]+$/.test(clientId)
  )
}

export default handler
