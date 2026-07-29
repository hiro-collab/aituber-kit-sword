import type { NextApiRequest, NextApiResponse } from 'next'

type HealthResponse =
  | {
      schema_version: 'aituber_health.v1'
      ok: true
      status: 'ready'
      service_id: 'aituber_kit'
    }
  | {
      schema_version: 'aituber_health.v1'
      ok: false
      status: 'method_not_allowed'
      service_id: 'aituber_kit'
    }

const READY: HealthResponse = Object.freeze({
  schema_version: 'aituber_health.v1',
  ok: true,
  status: 'ready',
  service_id: 'aituber_kit',
})

export default function handler(
  req: NextApiRequest,
  res: NextApiResponse<HealthResponse>
) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    return res.status(405).json({
      schema_version: 'aituber_health.v1',
      ok: false,
      status: 'method_not_allowed',
      service_id: 'aituber_kit',
    })
  }
  return res.status(200).json(READY)
}
