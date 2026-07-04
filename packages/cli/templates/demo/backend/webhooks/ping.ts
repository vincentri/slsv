import { queue } from '@slsv/sdk'

export const handler = async (event: any) => {
  const secret = event.headers?.['x-webhook-secret']
  if (secret !== process.env.WEBHOOK_SECRET) return { statusCode: 401, body: 'Unauthorized' }

  const body = JSON.parse(event.body ?? '{}') as { code: string; url: string }
  await queue('clicks').send({ ...body, at: new Date().toISOString() })

  return { statusCode: 200, body: 'ok' }
}
