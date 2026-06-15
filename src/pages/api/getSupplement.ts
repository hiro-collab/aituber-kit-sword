import type { NextApiRequest, NextApiResponse } from 'next'
import fs from 'fs/promises'
import path from 'path'
import { isRestrictedMode } from '@/utils/restrictedMode'
import {
  resolveInsideDirectory,
  sanitizePathSegment,
} from '@/utils/serverPathSecurity'
import { enforceLocalApiRequest } from '@/utils/localApiSecurity'
import assetManifest from '@/constants/assetManifest.json'

type ResponseData = {
  content?: string
  message?: string
  error?: string
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ResponseData>
) {
  if (isRestrictedMode()) {
    if (req.method !== 'GET') {
      return res.status(405).json({ message: 'Method Not Allowed' })
    }
    const { slideName } = req.query
    if (typeof slideName !== 'string' || !slideName) {
      return res.status(400).json({
        message: 'Bad Request: Missing or invalid slideName query parameter',
      })
    }
    const sanitizedSlideName = sanitizePathSegment(slideName)
    if (!sanitizedSlideName) {
      return res.status(400).json({
        message:
          'Bad Request: Invalid slideName contains invalid characters or path traversal attempts.',
      })
    }
    const supplements =
      (assetManifest.slides?.supplements as
        | Record<string, string>
        | undefined) ?? {}
    const content = supplements[sanitizedSlideName] ?? ''
    return res.status(200).json({ content })
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ message: 'Method Not Allowed' })
  }
  if (!enforceLocalApiRequest(req, res, { feature: 'getSupplement' })) {
    return
  }

  const { slideName } = req.query

  if (typeof slideName !== 'string' || !slideName) {
    return res.status(400).json({
      message: 'Bad Request: Missing or invalid slideName query parameter',
    })
  }

  const sanitizedSlideName = sanitizePathSegment(slideName)
  if (!sanitizedSlideName) {
    return res.status(400).json({
      message:
        'Bad Request: Invalid slideName contains invalid characters or path traversal attempts.',
    })
  }

  const slidesDir = path.resolve(process.cwd(), 'public', 'slides')
  const slideDir = resolveInsideDirectory(slidesDir, sanitizedSlideName)
  const filePath = resolveInsideDirectory(slideDir, 'supplement.txt')

  try {
    const content = await fs.readFile(filePath, 'utf-8')
    res.status(200).json({ content })
  } catch (error: any) {
    // ファイルが存在しない場合は空の内容を返す (エラーではなく正常系として扱う)
    if (error.code === 'ENOENT') {
      res.status(200).json({ content: '' })
    } else {
      console.error(`Error reading file: ${filePath}`, error)
      res.status(500).json({
        message: 'Internal Server Error',
      })
    }
  }
}
