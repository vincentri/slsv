// Drizzle typed mirror of schema.sql. init_sql (schema.sql) creates the real `clicks`
// table; this describes it in TS so `sql('analytics', { schema }).query.clicks` and typed
// inserts work. Keep the two in sync by hand — slsv runs no migrations.
//
// Import the builders from @slsv/sdk (re-exported drizzle pg-core), never `drizzle-orm`
// directly — that keeps a single drizzle copy so your schema stays type-compatible with the
// client sql() returns.
import { pgCore as t } from '@slsv/sdk'

export const clicks = t.pgTable('clicks', {
  id: t.bigserial('id', { mode: 'number' }).primaryKey(),
  code: t.text('code').notNull(),
  url: t.text('url').notNull(),
  clickedAt: t.timestamp('clicked_at', { withTimezone: true }).notNull(),
})
