import { sql, cache } from '@slsv/sdk'
import * as schema from '../schema'

// Typed Drizzle usage: pass your schema (backend/schema.ts) to sql() for column-checked
// queries. sql() manages a pooled connection cached per container — no connect()/end().
export const handler = async (event: any) => {
  const db = sql('analytics', { schema })
  for (const record of event.Records ?? []) {
    const { code, url, at } = JSON.parse(record.body) as { code: string; url: string; at: string }
    // Typed insert — column names + types checked against schema.clicks.
    await db.insert(schema.clicks).values({ code, url, clickedAt: new Date(at) })
    await cache('links').set(`url:${code}`, url, { ttl: 3600 })
    console.log(`[click] recorded code=${code}`)
  }
}
