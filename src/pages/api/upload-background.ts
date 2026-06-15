import { NextApiRequest, NextApiResponse } from 'next'
import formidable from 'formidable'
import fs from 'fs'
import path from 'path'
import {
  isRestrictedMode,
  createRestrictedModeErrorResponse,
} from '@/utils/restrictedMode'
import { enforceLocalApiRequest } from '@/utils/localApiSecurity'
import { resolveInsideDirectory } from '@/utils/serverPathSecurity'

export const config = {
  api: {
    bodyParser: false,
  },
}
const formOptions: formidable.Options = {
  maxFileSize: 100 * 1024 * 1024, // 100MB
  filter: (part) => {
    return part.mimetype?.startsWith('image/') || false
  },
}
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  if (!enforceLocalApiRequest(req, res, { feature: 'upload-background' })) {
    return
  }

  if (isRestrictedMode()) {
    return res
      .status(403)
      .json(createRestrictedModeErrorResponse('upload-background'))
  }

  const form = formidable(formOptions)

  try {
    const [fields, files] = await form.parse(req)
    const file = files.file?.[0]

    if (!file) {
      return res.status(400).json({ error: 'No file uploaded' })
    }

    const validExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp']
    const extension = path.extname(file.originalFilename || '').toLowerCase()

    if (!validExtensions.includes(extension)) {
      return res.status(400).json({
        error: 'Invalid file type',
        message: 'Only JPG, PNG, GIF and WebP images can be uploaded',
      })
    }

    const bgDir = path.resolve(process.cwd(), 'public/backgrounds')
    if (!fs.existsSync(bgDir)) {
      fs.mkdirSync(bgDir, { recursive: true })
    }

    const filename = sanitizeUploadFilename(
      file.originalFilename,
      `background${extension}`
    )
    const newPath = resolveInsideDirectory(bgDir, filename)
    await fs.promises.copyFile(file.filepath, newPath)

    res.status(200).json({
      path: `/backgrounds/${filename}`,
    })
  } catch (error) {
    res.status(500).json({ error: 'Failed to upload file' })
  }
}
function sanitizeUploadFilename(
  filename: string | null | undefined,
  fallback: string
): string {
  const baseName = path.basename(
    String(filename || fallback).replace(/\\/g, '/')
  )
  const sanitized = baseName
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/\.+/g, '.')
    .slice(0, 120)

  return sanitized && sanitized !== '.' && sanitized !== '..'
    ? sanitized
    : fallback
}
