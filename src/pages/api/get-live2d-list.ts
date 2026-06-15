import { NextApiRequest, NextApiResponse } from 'next'
import fs from 'fs'
import path from 'path'
import {
  isLive2DEnabled,
  createLive2DRestrictionErrorResponse,
} from '@/utils/live2dRestriction'
import { isRestrictedMode } from '@/utils/restrictedMode'
import assetManifest from '@/constants/assetManifest.json'
import { enforceLocalApiRequest } from '@/utils/localApiSecurity'
import {
  resolveInsideDirectory,
  sanitizePathSegment,
} from '@/utils/serverPathSecurity'

interface Live2DModelInfo {
  path: string
  name: string
  expressions: string[]
  motions: string[]
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  if (!isLive2DEnabled()) {
    return res.status(403).json(createLive2DRestrictionErrorResponse())
  }

  if (isRestrictedMode()) {
    return res.status(200).json(assetManifest.live2d)
  }
  if (!enforceLocalApiRequest(req, res, { feature: 'get-live2d-list' })) {
    return
  }

  const live2dDir = path.resolve(process.cwd(), 'public/live2d')

  try {
    if (!fs.existsSync(live2dDir)) {
      return res.status(404).json({ error: 'Live2D directory not found' })
    }

    const folders = await fs.promises.readdir(live2dDir, {
      withFileTypes: true,
    })
    const live2dModels: Live2DModelInfo[] = []

    for (const folder of folders) {
      if (folder.isDirectory()) {
        if (!sanitizePathSegment(folder.name)) continue
        const folderPath = resolveInsideDirectory(live2dDir, folder.name)
        const files = await fs.promises.readdir(folderPath)
        const model3File = files.find(
          (file) =>
            Boolean(sanitizePathSegment(file)) && file.endsWith('.model3.json')
        )

        if (model3File) {
          const modelPath = `/live2d/${folder.name}/${model3File}`
          const fullPath = resolveInsideDirectory(folderPath, model3File)
          const modelContent = await fs.promises.readFile(fullPath, 'utf-8')
          const modelJson = JSON.parse(modelContent)

          // Extract expressions and motions from model3.json
          const expressions =
            modelJson.FileReferences.Expressions?.map(
              (exp: { Name: string }) => exp.Name
            ) || []
          const motions = Object.keys(modelJson.FileReferences.Motions || {})

          live2dModels.push({
            path: modelPath,
            name: folder.name,
            expressions,
            motions,
          })
        }
      }
    }

    res.status(200).json(live2dModels)
  } catch (error) {
    console.error('Error reading Live2D directory:', error)
    res.status(500).json({
      error: 'Failed to get Live2D model list',
    })
  }
}
