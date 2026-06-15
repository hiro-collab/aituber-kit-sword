import type { NextApiRequest, NextApiResponse } from 'next'
import axios from 'axios'
import { resolveTrustedServiceUrl } from '@/utils/serverUrlSecurity'
import { enforceLocalApiRequest } from '@/utils/localApiSecurity'

type Data = {
  audio?: ArrayBuffer
  error?: string
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<Data>
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  if (!enforceLocalApiRequest(req, res, { feature: 'tts-voicevox' })) {
    return
  }

  const { text, speaker, speed, pitch, intonation, serverUrl } = req.body
  const apiUrl = resolveTrustedServiceUrl({
    requestUrl: serverUrl,
    envUrl: process.env.VOICEVOX_SERVER_URL,
    fallbackUrl: 'http://localhost:50021',
    allowedUrlsEnv: [
      process.env.VOICEVOX_ALLOWED_SERVER_URLS,
      process.env.AITUBER_ALLOWED_SERVICE_URLS,
    ]
      .filter(Boolean)
      .join(','),
  })

  if (!apiUrl) {
    return res.status(400).json({ error: 'Invalid VOICEVOX server URL' })
  }

  try {
    const queryUrl = new URL('/audio_query', `${apiUrl}/`)
    queryUrl.searchParams.set('speaker', String(speaker))
    queryUrl.searchParams.set('text', String(text))

    // 1. Audio Query の生成
    const queryResponse = await axios.post(queryUrl.toString(), null, {
      headers: {
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    })

    const queryData = queryResponse.data
    queryData.speedScale = speed
    queryData.pitchScale = pitch
    queryData.intonationScale = intonation

    // 2. 音声合成
    const synthesisUrl = new URL('/synthesis', `${apiUrl}/`)
    synthesisUrl.searchParams.set('speaker', String(speaker))

    const synthesisResponse = await axios.post(
      synthesisUrl.toString(),
      queryData,
      {
        headers: {
          'Content-Type': 'application/json',
          Accept: 'audio/wav',
        },
        responseType: 'arraybuffer',
        timeout: 30000,
      }
    )

    res.setHeader('Content-Type', 'audio/wav')
    res.end(Buffer.from(synthesisResponse.data))
  } catch (error) {
    console.error('Error in VOICEVOX TTS:', error)
    res.status(500).json({ error: 'Internal Server Error' })
  }
}
