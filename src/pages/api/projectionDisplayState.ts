import type { NextApiRequest, NextApiResponse } from 'next'

import { enforceLocalApiRequest } from '@/utils/localApiSecurity'
import {
  createRestrictedModeErrorResponse,
  isRestrictedMode,
} from '@/utils/restrictedMode'
import {
  sanitizeSpeechOutputSummary,
  type SpeechOutputSummary,
} from '@/utils/speechOutputParitySummary'

type CharacterPosition = {
  x: number
  y: number
  z: number
  scale: number
}

type CharacterRotation = {
  x: number
  y: number
  z: number
}

type ModelType = 'vrm' | 'live2d' | 'pngtuber'

type ProjectionDisplaySettings = {
  modelType?: ModelType
  selectedVrmPath?: string
  selectedLive2DPath?: string
  selectedPNGTuberPath?: string
  characterName?: string
  showCharacterName?: boolean
  fixedCharacterPosition?: boolean
  characterPosition?: CharacterPosition
  characterRotation?: CharacterRotation
  lightingIntensity?: number
}

type ProjectionDisplayState = {
  version: 1
  sequence: number
  updatedAt: string | null
  assistantMessage: string
  assistantMessageId: string | null
  speechOutputSummary: SpeechOutputSummary | null
  settings: ProjectionDisplaySettings
}

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '16kb',
    },
  },
}

const MAX_ASSISTANT_MESSAGE_CHARS = 1600
const MAX_STRING_CHARS = 512

let latestDisplayState: ProjectionDisplayState = {
  version: 1,
  sequence: 0,
  updatedAt: null,
  assistantMessage: '',
  assistantMessageId: null,
  speechOutputSummary: null,
  settings: {},
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const clampString = (value: unknown, maxChars: number) =>
  typeof value === 'string' ? value.slice(0, maxChars) : undefined

const readSafeId = (value: unknown): string | null => {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return /^[a-zA-Z0-9._:-]{1,128}$/.test(trimmed) ? trimmed : null
}

const readModelType = (value: unknown): ModelType | undefined =>
  value === 'vrm' || value === 'live2d' || value === 'pngtuber'
    ? value
    : undefined

const clampNumber = (
  value: unknown,
  fallback: number,
  min: number,
  max: number
) => {
  const numberValue = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numberValue)) {
    return fallback
  }
  return Math.min(max, Math.max(min, numberValue))
}

const readPosition = (value: unknown): CharacterPosition | undefined => {
  if (!isRecord(value)) return undefined
  return {
    x: clampNumber(value.x, 0, -20, 20),
    y: clampNumber(value.y, 0, -20, 20),
    z: clampNumber(value.z, 0, -20, 20),
    scale: clampNumber(value.scale, 1, 0.1, 10),
  }
}

const readRotation = (value: unknown): CharacterRotation | undefined => {
  if (!isRecord(value)) return undefined
  return {
    x: clampNumber(value.x, 0, -20, 20),
    y: clampNumber(value.y, 0, -20, 20),
    z: clampNumber(value.z, 0, -20, 20),
  }
}

const sanitizeSettings = (value: unknown): ProjectionDisplaySettings => {
  if (!isRecord(value)) return {}

  return {
    modelType: readModelType(value.modelType),
    selectedVrmPath: clampString(value.selectedVrmPath, MAX_STRING_CHARS),
    selectedLive2DPath: clampString(value.selectedLive2DPath, MAX_STRING_CHARS),
    selectedPNGTuberPath: clampString(
      value.selectedPNGTuberPath,
      MAX_STRING_CHARS
    ),
    characterName: clampString(value.characterName, 80),
    showCharacterName:
      typeof value.showCharacterName === 'boolean'
        ? value.showCharacterName
        : undefined,
    fixedCharacterPosition:
      typeof value.fixedCharacterPosition === 'boolean'
        ? value.fixedCharacterPosition
        : undefined,
    characterPosition: readPosition(value.characterPosition),
    characterRotation: readRotation(value.characterRotation),
    lightingIntensity: clampNumber(value.lightingIntensity, 1, 0, 3),
  }
}

const handler = (req: NextApiRequest, res: NextApiResponse) => {
  if (isRestrictedMode()) {
    return res
      .status(403)
      .json(createRestrictedModeErrorResponse('projectionDisplayState'))
  }
  if (
    !enforceLocalApiRequest(req, res, { feature: 'projectionDisplayState' })
  ) {
    return
  }

  if (req.method === 'GET') {
    const updatedAtMs = latestDisplayState.updatedAt
      ? Date.parse(latestDisplayState.updatedAt)
      : NaN
    return res.status(200).json({
      ok: true,
      state: latestDisplayState,
      ageMs: Number.isFinite(updatedAtMs) ? Date.now() - updatedAtMs : null,
    })
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST')
    return res.status(405).json({ ok: false, error: 'method_not_allowed' })
  }

  if (!isRecord(req.body)) {
    return res.status(400).json({ ok: false, error: 'invalid_body' })
  }

  latestDisplayState = {
    version: 1,
    sequence: latestDisplayState.sequence + 1,
    updatedAt: new Date().toISOString(),
    assistantMessage:
      clampString(req.body.assistantMessage, MAX_ASSISTANT_MESSAGE_CHARS) || '',
    assistantMessageId: readSafeId(req.body.assistantMessageId),
    speechOutputSummary: sanitizeSpeechOutputSummary(
      req.body.speechOutputSummary
    ),
    settings: sanitizeSettings(req.body.settings),
  }

  return res.status(200).json({ ok: true, state: latestDisplayState })
}

export default handler
