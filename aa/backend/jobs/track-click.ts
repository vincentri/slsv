import { Client } from 'pg'
import { cache } from '@slsv/sdk'

export const handler = async (event: any) => {
  const client = new Client({ connectionString: process.env.DATABASE_ANALYTICS })
  await client.connect()
  try {
    for (const record of event.Records ?? []) {
      const { code, url, at } = JSON.parse(record.body) as { code: string; url: string; at: string }
      await client.query('INSERT INTO clicks (code, url, clicked_at) VALUES ($1, $2, $3)', [code, url, at])
      await cache('links').set(`url:${code}`, url, { ttl: 3600 })
      console.log(`[click] recorded code=${code}`)
    }
  } finally {
    await client.end()
  }
}
