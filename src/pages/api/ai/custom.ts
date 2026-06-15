import { NextApiRequest, NextApiResponse } from 'next'
import { handleCustomApi } from '@/lib/api-services/customApi'
import { pipeResponse } from '@/utils/pipeResponse'
import {
  getTrustedRequestUrl,
  normalizeHttpUrl,
} from '@/utils/serverUrlSecurity'
import { enforceLocalApiRequest } from '@/utils/localApiSecurity'

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb',
    },
  },
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return res.status(405).json({
      error: 'Method Not Allowed',
      errorCode: 'METHOD_NOT_ALLOWED',
    })
  }
  if (!enforceLocalApiRequest(req, res, { feature: 'ai/custom' })) {
    return
  }

  const {
    messages,
    stream,
    customApiUrl = '',
    customApiHeaders = '{}',
    customApiBody = '{}',
    customApiIncludeMimeType = false,
    threadId,
  } = req.body

  // ヘッダー: フロントエンド設定をベースに、サーバーサイド環境変数で上書きマージ
  const frontHeaders = customApiHeaders === '' ? '{}' : customApiHeaders
  const serverHeaders = process.env.CUSTOM_API_HEADERS || ''

  // ボディ: フロントエンド設定をベースに、サーバーサイド環境変数で上書きマージ
  const frontBody = customApiBody === '' ? '{}' : customApiBody
  const serverBody = process.env.CUSTOM_API_BODY || ''

  // サーバーサイド環境変数を優先（秘匿設定）
  const apiUrl = resolveCustomApiUrl(customApiUrl, {
    hasServerSecrets: Boolean(serverHeaders || serverBody),
  })
  if (!apiUrl) {
    return res.status(400).json({
      error: 'Invalid or untrusted customApiUrl',
      errorCode: 'CustomAPIInvalidRequest',
    })
  }

  let mergedHeaders = frontHeaders
  if (serverHeaders) {
    try {
      const front = JSON.parse(frontHeaders)
      const server = JSON.parse(serverHeaders)
      mergedHeaders = JSON.stringify({ ...front, ...server })
    } catch (e) {
      console.warn('Failed to parse/merge custom API headers:', e)
      mergedHeaders = serverHeaders
    }
  }

  let mergedBody = frontBody
  if (serverBody) {
    try {
      const front = JSON.parse(frontBody)
      const server = JSON.parse(serverBody)
      mergedBody = JSON.stringify({ ...front, ...server })
    } catch (e) {
      console.warn('Failed to parse/merge custom API body:', e)
      mergedBody = serverBody
    }
  }

  // threadIdをmergedBodyに注入
  if (threadId) {
    try {
      const bodyObj = JSON.parse(mergedBody)
      bodyObj.threadId = threadId
      mergedBody = JSON.stringify(bodyObj)
    } catch (e) {
      console.warn('Failed to inject threadId into mergedBody:', e)
    }
  }

  try {
    const response = await handleCustomApi(
      messages,
      apiUrl,
      mergedHeaders,
      mergedBody,
      stream,
      customApiIncludeMimeType
    )

    return pipeResponse(response, res)
  } catch (error) {
    console.error('Error in Custom API call:', error)

    if (error instanceof Response) {
      return pipeResponse(error, res)
    }

    if (error instanceof Error) {
      const isClientError =
        error instanceof TypeError ||
        error.message.includes('Invalid URL') ||
        error.message.includes('customApiUrl')
      return res.status(isClientError ? 400 : 500).json({
        error: error.message,
        errorCode: isClientError ? 'CustomAPIInvalidRequest' : 'CustomAPIError',
      })
    }

    return res.status(500).json({
      error: 'Unexpected Error',
      errorCode: 'CustomAPIError',
    })
  }
}

function resolveCustomApiUrl(
  requestUrl: string,
  { hasServerSecrets }: { hasServerSecrets: boolean }
): string | null {
  if (process.env.CUSTOM_API_URL?.trim()) {
    return normalizeHttpUrl(process.env.CUSTOM_API_URL, { allowPath: true })
  }

  if (hasServerSecrets || process.env.CUSTOM_API_REQUIRE_ALLOWLIST === 'true') {
    return getTrustedRequestUrl(requestUrl, {
      allowPath: true,
      allowedUrlsEnv: process.env.CUSTOM_API_ALLOWED_URLS,
    })
  }

  return normalizeHttpUrl(requestUrl, { allowPath: true })
}
