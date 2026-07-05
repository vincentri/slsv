import { describe, it, expect, vi } from 'vitest'

// Mock drivers + drizzle so the test never opens a real pool or touches a DB.
// Each drizzle adapter returns a tagged sentinel carrying the pool, so we can assert which
// dialect makeSql picked from the connection-string scheme.
vi.mock('pg', () => ({ default: { Pool: vi.fn((cfg) => ({ pg: cfg })) } }))
vi.mock('mysql2/promise', () => ({ default: { createPool: vi.fn((s) => ({ mysql: s })) } }))
vi.mock('drizzle-orm/node-postgres', () => ({
  drizzle: vi.fn((pool, opts) => ({ dialect: 'pg', pool, opts })),
}))
vi.mock('drizzle-orm/mysql2', () => ({
  drizzle: vi.fn((pool, opts) => ({ dialect: 'mysql', pool, opts })),
}))

import { makeSql } from './sql.js'

describe('makeSql', () => {
  it('picks the postgres adapter for a postgres:// url', () => {
    const db = makeSql('postgres://u:p@host:5432/app') as any
    expect(db.dialect).toBe('pg')
  })

  it('picks the mysql adapter for a mysql:// url', () => {
    const db = makeSql('mysql://u:p@host:3306/app') as any
    expect(db.dialect).toBe('mysql')
  })

  it('passes schema through and sets mysql mode only when schema is given', () => {
    const schema = { users: {} }
    const pgDb = makeSql('postgres://u:p@h/pgschema', { schema }) as any
    expect(pgDb.opts).toEqual({ schema })

    const myDb = makeSql('mysql://u:p@h/myschema', { schema }) as any
    expect(myDb.opts).toEqual({ schema, mode: 'default' })
  })

  it('caches one client per connection string', () => {
    const a = makeSql('postgres://u:p@h/cachetest')
    const b = makeSql('postgres://u:p@h/cachetest')
    expect(a).toBe(b) // second call served from cache
  })
})
