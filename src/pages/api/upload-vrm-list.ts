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
const formOptions = {
  maxFileSize: 200 * 1024 * 1024,
  filter: ({ mimetype }: { mimetype: string | null }) =>
    mimetype === 'application/octet-stream' || mimetype === 'model/vrm',
}
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  if (!enforceLocalApiRequest(req, res, { feature: 'upload-vrm-list' })) {
    return
  }

  if (isRestrictedMode()) {
    return res
      .status(403)
      .json(createRestrictedModeErrorResponse('upload-vrm-list'))
  }

  const form = formidable(formOptions)

  try {
    const [fields, files] = await form.parse(req)
    const file = files.file?.[0]

    if (!file) {
      return res.status(400).json({ error: 'No file uploaded' })
    }

    if (!file.originalFilename?.toLowerCase().endsWith('.vrm')) {
      return res.status(400).json({
        error: 'Invalid file type',
        message: 'Only VRM files can be uploaded',
      })
    }

    const vrmDir = path.resolve(process.cwd(), 'public/vrm')
    if (!fs.existsSync(vrmDir)) {
      fs.mkdirSync(vrmDir, { recursive: true })
    }

    const filename = sanitizeUploadFilename(
      file.originalFilename,
      'uploaded.vrm'
    )
    const newPath = resolveInsideDirectory(vrmDir, filename)
    await fs.promises.copyFile(file.filepath, newPath)

    res.status(200).json({
      path: `/vrm/${filename}`,
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
