import type { NextApiRequest, NextApiResponse } from 'next'
import fs from 'fs/promises'
import path from 'path'
import {
  isRestrictedMode,
  createRestrictedModeErrorResponse,
} from '@/utils/restrictedMode'
import {
  normalizePathSeparators,
  resolveInsideDirectory,
} from '@/utils/serverPathSecurity'
import { enforceLocalApiRequest } from '@/utils/localApiSecurity'

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  if (!enforceLocalApiRequest(req, res, { feature: 'update-pose-rotation' })) {
    return
  }

  if (isRestrictedMode()) {
    return res
      .status(403)
      .json(createRestrictedModeErrorResponse('update-pose-rotation'))
  }

  const { jsonPath, angleDeg } = req.body
  if (typeof jsonPath !== 'string' || typeof angleDeg !== 'number') {
    return res.status(400).json({ error: 'Invalid parameters' })
  }

  const safePosePath = validatePoseJsonPath(jsonPath)
  if (!safePosePath) {
    return res.status(400).json({ error: 'Invalid pose path' })
  }

  try {
    const posesDir = path.resolve(process.cwd(), 'public', 'poses')
    const filePath = resolveInsideDirectory(posesDir, safePosePath)
    const content = await fs.readFile(filePath, 'utf-8')
    const json = JSON.parse(content)
    json.yRotationOffsetDeg = angleDeg
    await fs.writeFile(filePath, JSON.stringify(json, null, 2))
    return res.status(200).json({ message: 'Pose rotation updated' })
  } catch (e) {
    console.error('Failed to update pose rotation:', e)
    return res.status(500).json({ error: 'Failed to update file' })
  }
}

function validatePoseJsonPath(jsonPath: string): string | null {
  const normalized = normalizePathSeparators(jsonPath).replace(/^\/+/, '')
  const prefix = 'poses/'
  if (!normalized.startsWith(prefix)) return null

  const relativePosePath = normalized.slice(prefix.length)
  if (!relativePosePath || relativePosePath.includes('..')) return null
  if (!relativePosePath.endsWith('.json')) return null
  if (!/^[A-Za-z0-9._/-]+$/.test(relativePosePath)) return null

  return relativePosePath
}
