import { NextApiRequest, NextApiResponse } from 'next'
import formidable from 'formidable'
import fs from 'fs'
import path from 'path'
import { IMAGE_CONSTANTS } from '@/constants/images'
import {
  isRestrictedMode,
  createRestrictedModeErrorResponse,
} from '@/utils/restrictedMode'
import {
  normalizePathSeparators,
  resolveInsideDirectory,
} from '@/utils/serverPathSecurity'
import { enforceLocalApiRequest } from '@/utils/localApiSecurity'

export const config = {
  api: {
    bodyParser: false,
  },
}

const formOptions: formidable.Options = {
  maxFileSize: IMAGE_CONSTANTS.MAX_FILE_SIZE,
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
  if (!enforceLocalApiRequest(req, res, { feature: 'upload-image' })) {
    return
  }

  if (isRestrictedMode()) {
    return res
      .status(403)
      .json(createRestrictedModeErrorResponse('upload-image'))
  }

  const form = formidable(formOptions)

  try {
    const [fields, files] = await form.parse(req)
    const file = files.file?.[0]

    if (!file) {
      return res.status(400).json({ error: 'No file uploaded' })
    }

    const extension = path.extname(file.originalFilename || '').toLowerCase()

    if (!IMAGE_CONSTANTS.VALID_EXTENSIONS.includes(extension as any)) {
      return res.status(400).json({
        error: 'Invalid file type',
        message: 'Only JPG, PNG, GIF and WebP images can be uploaded',
      })
    }

    // Additional MIME type validation for security
    if (!IMAGE_CONSTANTS.VALID_MIME_TYPES.includes(file.mimetype as any)) {
      return res.status(400).json({
        error: 'Invalid MIME type',
        message: 'File content does not match allowed image types',
      })
    }

    const imagesDir = path.resolve(
      process.cwd(),
      IMAGE_CONSTANTS.UPLOAD_DIRECTORY
    )
    if (!fs.existsSync(imagesDir)) {
      fs.mkdirSync(imagesDir, { recursive: true })
    }

    const timestamp = Date.now()

    const safeBaseName = sanitizeImageBaseName(file.originalFilename, extension)
    const filename = `${timestamp}_${safeBaseName}${extension}`
    const newPath = resolveInsideDirectory(imagesDir, filename)

    await fs.promises.copyFile(file.filepath, newPath)

    res.status(200).json({
      path: `/images/uploaded/${filename}`,
      filename,
    })
  } catch (error) {
    res.status(500).json({ error: 'Failed to upload file' })
  }
}

function sanitizeImageBaseName(
  filename: string | null | undefined,
  extension: string
): string {
  const normalized = normalizePathSeparators(filename || 'image')
  const baseName = path.basename(normalized, extension)
  const sanitized = baseName
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .substring(0, IMAGE_CONSTANTS.MAX_FILENAME_LENGTH)

  return sanitized || 'image'
}
