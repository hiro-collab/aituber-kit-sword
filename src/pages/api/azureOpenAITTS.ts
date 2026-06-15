import { NextApiRequest, NextApiResponse } from 'next'
import { AzureOpenAI } from 'openai'
import { enforceLocalApiRequest } from '@/utils/localApiSecurity'

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  if (!enforceLocalApiRequest(req, res, { feature: 'azureOpenAITTS' })) {
    return
  }

  const { message, voice, speed, apiKey, endpoint } = req.body

  const azureTTSKey = apiKey || process.env.AZURE_TTS_KEY
  const azureTTSEndpoint = resolveAzureTtsEndpoint(endpoint)

  if (!message || !voice || !speed || !azureTTSKey || !azureTTSEndpoint) {
    return res.status(400).json({ error: 'Missing required parameters' })
  }

  try {
    const url = new URL(azureTTSEndpoint)
    const pathParts = url.pathname.split('/')
    let deploymentName = pathParts.find((part) => part === 'deployments')
      ? pathParts[pathParts.indexOf('deployments') + 1]
      : 'tts'
    const apiVersion =
      url.searchParams.get('api-version') || '2024-02-15-preview'

    const azureOpenAI = new AzureOpenAI({
      apiKey: azureTTSKey,
      endpoint: azureTTSEndpoint,
      apiVersion: apiVersion,
      deployment: deploymentName,
    })

    const mp3 = await azureOpenAI.audio.speech.create({
      model: deploymentName,
      voice: voice,
      input: message,
      speed: speed,
    })

    const buffer = Buffer.from(await mp3.arrayBuffer())

    res.setHeader('Content-Type', 'audio/mpeg')
    res.send(buffer)
  } catch (error) {
    console.error('Azure OpenAI TTS error:', error)
    res.status(500).json({ error: 'Failed to generate speech' })
  }
}

function resolveAzureTtsEndpoint(endpoint: unknown): string {
  const candidate =
    process.env.AZURE_TTS_ENDPOINT ||
    (typeof endpoint === 'string' ? endpoint : '')
  try {
    const url = new URL(candidate)
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      !url.hostname.endsWith('.openai.azure.com')
    ) {
      return ''
    }
    url.hash = ''
    return url.toString()
  } catch {
    return ''
  }
}
