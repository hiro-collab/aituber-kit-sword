/**
 * Memory Restore API
 *
 * ローカルファイルからメモリを復元するAPI
 * Requirements: 5.7, 5.8
 */

import { NextApiRequest, NextApiResponse } from 'next'
import fs from 'fs'
import path from 'path'
import { Message } from '@/features/messages/messages'
import {
  isRestrictedMode,
  createRestrictedModeErrorResponse,
} from '@/utils/restrictedMode'
import {
  resolveInsideDirectory,
  sanitizePathSegment,
} from '@/utils/serverPathSecurity'
import { enforceLocalApiRequest } from '@/utils/localApiSecurity'

interface MemoryRestoreRequest {
  filename: string
}

interface MemoryRestoreResponse {
  messages: Message[]
  restoredCount: number
  embeddingCount: number
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' })
  }
  if (!enforceLocalApiRequest(req, res, { feature: 'memory-restore' })) {
    return
  }

  if (isRestrictedMode()) {
    return res
      .status(403)
      .json(createRestrictedModeErrorResponse('memory-restore'))
  }

  try {
    const { filename } = req.body as MemoryRestoreRequest

    if (!filename) {
      return res.status(400).json({ message: 'Filename is required' })
    }

    const safeFileName = sanitizeLogFileName(filename)
    if (!safeFileName) {
      return res.status(400).json({ message: 'Invalid filename' })
    }

    const logsDir = path.resolve(process.cwd(), 'logs')
    const filePath = resolveInsideDirectory(logsDir, safeFileName)

    // ファイルの存在確認
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ message: 'File not found' })
    }

    // ファイルの読み込み
    const content = fs.readFileSync(filePath, 'utf-8')
    const messages = JSON.parse(content)

    if (!Array.isArray(messages)) {
      return res.status(400).json({ message: 'Invalid file format' })
    }

    // Embeddingを持つメッセージの数をカウント
    const embeddingCount = messages.filter(
      (msg: Message) => msg.embedding && Array.isArray(msg.embedding)
    ).length

    const response: MemoryRestoreResponse = {
      messages,
      restoredCount: messages.length,
      embeddingCount,
    }

    res.status(200).json(response)
  } catch (error) {
    console.error('Error restoring memory:', error)
    res.status(500).json({ message: 'Error restoring memory' })
  }
}

function sanitizeLogFileName(filename: string): string | null {
  const safeFileName = sanitizePathSegment(filename)
  if (!safeFileName) return null
  if (!/^log_[A-Za-z0-9._-]+\.json$/.test(safeFileName)) return null
  return safeFileName
}
