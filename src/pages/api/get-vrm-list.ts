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
    return res.status(200).json(assetManifest.vrm)
  }
  if (!enforceLocalApiRequest(req, res, { feature: 'get-vrm-list' })) {
    return
  }

  const vrmDir = path.join(process.cwd(), 'public/vrm')

  try {
    if (!fs.existsSync(vrmDir)) {
      return res.status(404).json({ error: 'VRM directory not found' })
    }
    const files = await fs.promises.readdir(vrmDir)
    const vrmFiles = files.filter(
      (file) => Boolean(sanitizePathSegment(file)) && file.endsWith('.vrm')
    )
    res.status(200).json(vrmFiles)
  } catch (error) {
    console.error('Error reading VRM directory:', error)
    res.status(500).json({
      error: 'Failed to get VRM file list',
    })
  }
}
