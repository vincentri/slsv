// ponytail: lazy per-request connect. No pool — local dev, 1 user, sub-second ops.
// Real prod should use a pool, but that's a different product.
import pg from 'pg'
import mysql from 'mysql2/promise'

export type SqlConn = { type: 'postgres' | 'mysql'; url: string }

const isPg = (url: string) => url.startsWith('postgres://') || url.startsWith('postgresql://')

export async function listTables(conn: SqlConn): Promise<{ name: string; type: string }[]> {
  if (isPg(conn.url)) {
    const c = new pg.Client({ connectionString: conn.url })
    await c.connect()
    try {
      const r = await c.query(`
        SELECT table_name AS name, table_type AS type
        FROM information_schema.tables
        WHERE table_schema = 'public'
        ORDER BY table_name
      `)
      return r.rows.map((row: any) => ({ name: row.name, type: row.type }))
    } finally {
      await c.end()
    }
  }
  const c = await mysql.createConnection(conn.url)
  try {
    const [rows] = await c.query(`
      SELECT TABLE_NAME AS name, TABLE_TYPE AS type
      FROM information_schema.tables
      WHERE TABLE_SCHEMA = DATABASE()
      ORDER BY TABLE_NAME
    `)
    return (rows as any[]).map((row) => ({ name: row.name, type: row.type }))
  } finally {
    await c.end()
  }
}

// ponytail: SELECT * LIMIT — Postgres/SQLite syntax. MySQL accepts LIMIT without OFFSET.
export async function peekTable(
  conn: SqlConn,
  table: string,
  limit = 100,
): Promise<{ columns: string[]; rows: Record<string, unknown>[] }> {
  // Validate identifier — no quoting hell, just block obviously bad chars.
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(table)) throw new Error('Invalid table name')

  if (isPg(conn.url)) {
    const c = new pg.Client({ connectionString: conn.url })
    await c.connect()
    try {
      const cols = await c.query(
        `
        SELECT column_name FROM information_schema.columns
        WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position
      `,
        [table],
      )
      const columns = cols.rows.map((r: any) => r.column_name)
      const r = await c.query(`SELECT * FROM "${table}" LIMIT $1`, [limit])
      return { columns, rows: r.rows as Record<string, unknown>[] }
    } finally {
      await c.end()
    }
  }
  const c = await mysql.createConnection(conn.url)
  try {
    const [cols] = await c.query(
      `
      SELECT COLUMN_NAME AS column_name FROM information_schema.columns
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION
    `,
      [table],
    )
    const columns = (cols as any[]).map((r) => r.column_name)
    const [rows] = await c.query(`SELECT * FROM \`${table}\` LIMIT ?`, [limit])
    return { columns, rows: rows as Record<string, unknown>[] }
  } finally {
    await c.end()
  }
}

// ponytail: read-only enforcement is best-effort. For trusted local dev only.
// Reject anything that doesn't start with SELECT/WITH (after trim+strip-leading-comments).
export async function runQuery(
  conn: SqlConn,
  sql: string,
): Promise<{ columns: string[]; rows: Record<string, unknown>[] }> {
  const stripped = sql
    .replace(/--.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .trim()
  if (!/^(SELECT|WITH|EXPLAIN)\b/i.test(stripped)) {
    throw new Error('Read-only: queries must start with SELECT, WITH, or EXPLAIN')
  }

  if (isPg(conn.url)) {
    const c = new pg.Client({ connectionString: conn.url })
    await c.connect()
    try {
      const r = await c.query(stripped)
      const columns = r.fields?.map((f: any) => f.name) ?? []
      return { columns, rows: r.rows as Record<string, unknown>[] }
    } finally {
      await c.end()
    }
  }
  const c = await mysql.createConnection(conn.url)
  try {
    const [rows, fields] = await c.query(stripped)
    const columns = (fields as any[]).map((f) => f.name)
    return { columns, rows: rows as Record<string, unknown>[] }
  } finally {
    await c.end()
  }
}
