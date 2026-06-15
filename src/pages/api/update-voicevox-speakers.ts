import type { NextApiRequest, NextApiResponse } from 'next'
import fs from 'fs/promises'
import path from 'path'
import {
  isRestrictedMode,
  createRestrictedModeErrorResponse,
} from '@/utils/restrictedMode'
import { resolveTrustedServiceUrl } from '@/utils/serverUrlSecurity'
import { enforceLocalApiRequest } from '@/utils/localApiSecurity'

interface Style {
  name: string
  id: number
  type: string
}

interface Speaker {
  name: string
  speaker_uuid: string
  styles: Style[]
}

interface VoicevoxSpeaker {
  speaker: string
  id: number
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  if (
    !enforceLocalApiRequest(req, res, { feature: 'update-voicevox-speakers' })
  ) {
    return
  }
  if (isRestrictedMode()) {
    return res
      .status(403)
      .json(createRestrictedModeErrorResponse('update-voicevox-speakers'))
  }

  try {
    // APIからデータを取得
    const rawServerUrl = Array.isArray(req.query.serverUrl)
      ? req.query.serverUrl[0]
      : req.query.serverUrl
    const serverUrl = resolveTrustedServiceUrl({
      requestUrl: rawServerUrl,
      envUrl: process.env.VOICEVOX_SERVER_URL,
      fallbackUrl: 'http://localhost:50021',
      allowedUrlsEnv: [
        process.env.VOICEVOX_ALLOWED_SERVER_URLS,
        process.env.AITUBER_ALLOWED_SERVICE_URLS,
      ]
        .filter(Boolean)
        .join(','),
    })
    if (!serverUrl) {
      return res.status(400).json({ error: 'Invalid server URL' })
    }
    const speakersUrl = new URL('/speakers', `${serverUrl}/`)
    const response = await fetch(speakersUrl)

    if (!response.ok) {
      throw new Error(
        `VOICEVOX server responded with status: ${response.status}`
      )
    }

    const speakers: Speaker[] = await response.json()

    // VOICEVOX形式に変換
    const voicevoxSpeakers: VoicevoxSpeaker[] = speakers.flatMap((speaker) =>
      speaker.styles.map((style) => ({
        speaker: `${speaker.name}/${style.name}`,
        id: style.id,
      }))
    )

    // JSONファイルに書き込み
    const filePath = path.join(process.cwd(), 'public/speakers.json')
    await fs.writeFile(
      filePath,
      JSON.stringify(voicevoxSpeakers, null, 2) + '\n'
    )

    res.status(200).json({ message: 'Speakers file updated successfully' })
  } catch (error) {
    console.error('Error updating VOICEVOX speakers:', error)
    res.status(500).json({ error: 'Failed to update VOICEVOX speakers file' })
  }
}
