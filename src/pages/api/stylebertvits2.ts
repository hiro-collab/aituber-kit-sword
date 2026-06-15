import type { NextApiRequest, NextApiResponse } from 'next'
import {
  getTrustedRequestUrl,
  normalizeHttpUrl,
} from '@/utils/serverUrlSecurity'
import { enforceLocalApiRequest } from '@/utils/localApiSecurity'

type Data = {
  audio?: Buffer
  error?: string
}

const getLanguageCode = (selectLanguage: string): string => {
  switch (selectLanguage) {
    case 'ja':
      return 'JP'
    case 'en':
      return 'EN'
    case 'zh-CN':
    case 'zh-TW':
      return 'ZH'
    default:
      return 'EN'
  }
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<Data>
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  if (!enforceLocalApiRequest(req, res, { feature: 'stylebertvits2' })) {
    return
  }

  const body = req.body // JSON.parse を削除
  const message = body.message
  const stylebertvits2ModelId = body.stylebertvits2ModelId
  const stylebertvits2ServerUrl = resolveStyleBertVits2ServerUrl(
    body.stylebertvits2ServerUrl
  )
  const stylebertvits2ApiKey =
    body.stylebertvits2ApiKey || process.env.STYLEBERTVITS2_API_KEY
  const stylebertvits2Style = body.stylebertvits2Style
  const stylebertvits2SdpRatio = body.stylebertvits2SdpRatio
  const stylebertvits2Length = body.stylebertvits2Length
  const selectLanguage = getLanguageCode(body.selectLanguage)

  if (!stylebertvits2ServerUrl) {
    return res
      .status(400)
      .json({ error: 'Invalid Style-Bert-VITS2 server URL' })
  }

  try {
    const parsedServerUrl = new URL(stylebertvits2ServerUrl)
    if (parsedServerUrl.hostname !== 'api.runpod.ai') {
      const queryParams = new URLSearchParams({
        text: message,
        model_id: stylebertvits2ModelId,
        style: stylebertvits2Style,
        sdp_ratio: stylebertvits2SdpRatio,
        length: stylebertvits2Length,
        language: selectLanguage,
      })

      const voice = await fetch(
        `${stylebertvits2ServerUrl.replace(/\/$/, '')}/voice?${queryParams}`,
        {
          method: 'GET',
          headers: {
            'Content-Type': 'audio/wav',
          },
        }
      )

      if (!voice.ok) {
        throw new Error(
          `サーバーからの応答が異常です。ステータスコード: ${voice.status}`
        )
      }

      const arrayBuffer = await voice.arrayBuffer()
      const buffer = Buffer.from(arrayBuffer)
      res.writeHead(200, {
        'Content-Type': 'audio/wav',
        'Content-Length': buffer.length,
      })
      res.end(buffer)
    } else {
      const voice = await fetch(
        `${stylebertvits2ServerUrl.replace(/\/$/, '')}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${stylebertvits2ApiKey}`,
          },
          body: JSON.stringify({
            input: {
              action: '/voice',
              model_id: stylebertvits2ModelId,
              text: message,
              style: stylebertvits2Style,
              sdp_ratio: stylebertvits2SdpRatio,
              length: stylebertvits2Length,
              language: selectLanguage,
            },
          }),
        }
      )

      if (!voice.ok) {
        throw new Error(
          `サーバーからの応答が異常です。ステータスコード: ${voice.status}`
        )
      }

      const voiceData = await voice.json()
      const base64Audio = voiceData.output.voice
      const buffer = Buffer.from(base64Audio, 'base64')

      res.writeHead(200, {
        'Content-Type': 'audio/wav',
        'Content-Length': buffer.length,
      })
      res.end(buffer)
    }
  } catch (error: any) {
    console.error('Error in Style-Bert-VITS2 TTS:', error)
    res.status(500).json({ error: 'Internal Server Error' })
  }
}

function resolveStyleBertVits2ServerUrl(
  requestUrl: string | null | undefined
): string | null {
  if (process.env.STYLEBERTVITS2_SERVER_URL?.trim()) {
    return normalizeHttpUrl(process.env.STYLEBERTVITS2_SERVER_URL, {
      allowPath: true,
    })
  }

  return getTrustedRequestUrl(requestUrl, {
    allowPath: true,
    allowedRemoteHosts: ['api.runpod.ai'],
    allowedUrlsEnv: [
      process.env.STYLEBERTVITS2_ALLOWED_SERVER_URLS,
      process.env.AITUBER_ALLOWED_SERVICE_URLS,
    ]
      .filter(Boolean)
      .join(','),
  })
}
