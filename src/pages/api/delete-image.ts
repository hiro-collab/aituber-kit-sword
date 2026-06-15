import { NextApiRequest, NextApiResponse } from 'next'
import fs from 'fs'
import path from 'path'
import { IMAGE_CONSTANTS } from '@/constants/images'
import {
  isRestrictedMode,
  createRestrictedModeErrorResponse,
} from '@/utils/restrictedMode'
import {
  resolveInsideDirectory,
  sanitizePathSegment,
} from '@/utils/serverPathSecurity'
import { enforceLocalApiRequest } from '@/utils/localApiSecurity'

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'DELETE') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  if (!enforceLocalApiRequest(req, res, { feature: 'delete-image' })) {
    return
  }

  if (isRestrictedMode()) {
    return res
      .status(403)
      .json(createRestrictedModeErrorResponse('delete-image'))
  }

  const { filename } = req.body

  if (!filename || typeof filename !== 'string') {
    return res.status(400).json({ error: 'Filename is required' })
  }

  const safeFileName = validateUploadedImageFileName(filename)
  if (!safeFileName) {
    return res.status(400).json({ error: 'Invalid filename' })
  }

  try {
    const imagesDir = path.resolve(process.cwd(), 'public/images/uploaded')
    const filePath = resolveInsideDirectory(imagesDir, safeFileName)

    // Check if file exists
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File not found' })
    }

    // Delete the file
    await fs.promises.unlink(filePath)

    res.status(200).json({
      success: true,
      message: 'File deleted successfully',
      filename: safeFileName,
    })
  } catch (error) {
    console.error('Failed to delete file:', error)
    res.status(500).json({ error: 'Failed to delete file' })
  }
}

function validateUploadedImageFileName(filename: string): string | null {
  const safeFileName = sanitizePathSegment(filename)
  if (!safeFileName) return null

  const extension = path.extname(safeFileName).toLowerCase()
  if (!IMAGE_CONSTANTS.VALID_EXTENSIONS.includes(extension as any)) {
    return null
  }

  return safeFileName
}
