import fs from 'fs'
import path from 'path'
import { NextApiRequest, NextApiResponse } from 'next'
import { isRestrictedMode } from '@/utils/restrictedMode'
import assetManifest from '@/constants/assetManifest.json'
import { enforceLocalApiRequest } from '@/utils/localApiSecurity'
import {
  resolveInsideDirectory,
  sanitizePathSegment,
} from '@/utils/serverPathSecurity'

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  if (isRestrictedMode()) {
    return res.status(200).json(assetManifest.slides.folders)
  }
  if (!enforceLocalApiRequest(req, res, { feature: 'getSlideFolders' })) {
    return
  }

  const slidesDir = path.resolve(process.cwd(), 'public', 'slides')

  try {
    const folders = fs
      .readdirSync(slidesDir, { withFileTypes: true })
      .filter((dirent) => dirent.isDirectory())
      .filter((dirent) => {
        if (!sanitizePathSegment(dirent.name)) return false
        const folderPath = resolveInsideDirectory(slidesDir, dirent.name)
        const hasSlidesFile = fs.existsSync(
          resolveInsideDirectory(folderPath, 'slides.md')
        )
        const hasScriptsFile = fs.existsSync(
          resolveInsideDirectory(folderPath, 'scripts.json')
        )
        return hasSlidesFile && hasScriptsFile
      })
      .map((dirent) => dirent.name)

    res.status(200).json(folders)
  } catch (error) {
    console.error('Error reading slides directory:', error)
    res.status(500).json({ error: 'Unable to read slides directory' })
  }
}
