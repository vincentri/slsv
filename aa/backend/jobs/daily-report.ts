import { Client } from 'pg'
import { cache, db, storage } from '@slsv/sdk'

export const handler = async () => {
  const date = new Date().toISOString().split('T')[0]
  const cacheKey = `report:${date}`
  const cached = await cache('links').get(cacheKey)
  if (cached) {
    await storage('reports').put(`daily/${date}.csv`, cached, 'text/csv')
    console.log(`Daily report: cache hit -> reports/daily/${date}.csv`)
    return
  }

  const links = await db('links').scan()

  const client = new Client({ connectionString: process.env.DATABASE_ANALYTICS })
  await client.connect()
  const { rows } = await client.query<{ code: string; clicks: string }>(
    "SELECT code, COUNT(*) AS clicks FROM clicks WHERE clicked_at >= NOW() - INTERVAL '24 hours' GROUP BY code"
  )
  await client.end()

  const clickMap = Object.fromEntries(rows.map(r => [r.code, r.clicks]))
  const csv = [
    'code,url,createdAt,clicks24h',
    ...links.map((l: any) => `${l.code},${l.url},${l.createdAt},${clickMap[l.code] ?? 0}`),
  ].join('\n')

  await cache('links').set(cacheKey, csv, { ttl: 3600 })
  await storage('reports').put(`daily/${date}.csv`, csv, 'text/csv')
  console.log(`Daily report: ${links.length} links, ${rows.length} active -> reports/daily/${date}.csv`)
}
