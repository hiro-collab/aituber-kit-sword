import { NextApiRequest, NextApiResponse } from 'next'
import fs from 'fs'
import path from 'path'
import { isRestrictedMode } from '@/utils/restrictedMode'
import assetManifest from '@/constants/assetManifest.json'
import { enforceLocalApiRequest } from '@/utils/localApiSecurity'
import { sanitizePathSegment } from '@/utils/serverPathSecurity'

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  if (isRestrictedMode()) {
    return res.status(200).json(assetManifest.backgrounds)
  }
  if (!enforceLocalApiRequest(req, res, { feature: 'get-background-list' })) {
    return
  }

  try {
    const backgroundsDir = path.join(process.cwd(), 'public/backgrounds')

    if (!fs.existsSync(backgroundsDir)) {
      fs.mkdirSync(backgroundsDir, { recursive: true })
      return res.status(200).json([])
    }

    const files = fs.readdirSync(backgroundsDir)
    const imageFiles = files.filter((file) => {
      if (!sanitizePathSegment(file)) return false
      const extension = path.extname(file).toLowerCase()
      return ['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(extension)
    })

    res.status(200).json(imageFiles)
  } catch (error) {
    console.error('Error fetching background list:', error)
    res.status(500).json({ error: 'Failed to fetch background list' })
  }
}
