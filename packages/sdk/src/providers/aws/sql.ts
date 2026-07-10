import { drizzle as pgDrizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { drizzle as mysqlDrizzle } from "drizzle-orm/mysql2";
import pg from "pg";
import mysql from "mysql2/promise";

// Cache one Drizzle client per connection string for the container's lifetime — one pool
// per warm Lambda, not per call (same rationale as getSecret's cache).
const cache = new Map<string, unknown>();

/**
 * Return type of makeSql/sql: a Drizzle client plus `.$client` (the underlying pg Pool —
 * the raw-SQL escape hatch). drizzle() adds $client as an intersection, not part of the
 * base NodePgDatabase, so we re-state it here.
 */
export type SqlClient<TSchema extends Record<string, unknown> = Record<string, never>> =
  NodePgDatabase<TSchema> & { $client: InstanceType<typeof pg.Pool> };

/**
 * Postgres/MySQL access via Drizzle. `connString` is the DATABASE_<NAME> value slsv injects
 * (a `postgres://` or `mysql://` URL). The dialect is sniffed from the URL scheme.
 *
 * Pass `{ schema }` (your drizzle table defs) for the typed relational API (`db.query.*`);
 * omit it and the query builder (`db.select().from(t)`) + raw SQL (`db.execute(sql\`…\`)`)
 * still work. The underlying pool is reachable via `db.$client`.
 *
 * No migrations — `init_sql` in slsv.yml owns the actual DDL; `schema.ts` is the optional
 * typed mirror of those tables.
 */
export function makeSql<TSchema extends Record<string, unknown> = Record<string, never>>(
  connString: string,
  opts: { schema?: TSchema } = {},
): SqlClient<TSchema> {
  const cached = cache.get(connString);
  if (cached) return cached as SqlClient<TSchema>;

  // ponytail: both dialect drivers (pg + mysql2) are bundled into every handler. esbuild
  // inlines both branches; dynamic-import the used one only if bundle size ever matters.
  // drizzle()'s overloads reject an explicit `undefined` 2nd arg, so branch on schema.
  const isMysql = /^mysql:/i.test(connString);
  let client;
  if (isMysql) {
    const pool = mysql.createPool(connString);
    // mysql2 needs `mode` only when a schema is supplied.
    client = opts.schema
      ? mysqlDrizzle(pool, { schema: opts.schema, mode: "default" })
      : mysqlDrizzle(pool);
  } else {
    const pool = new pg.Pool({ connectionString: connString });
    client = opts.schema ? pgDrizzle(pool, { schema: opts.schema }) : pgDrizzle(pool);
  }

  cache.set(connString, client);
  // ponytail: mysql runtime returns MySql2Database but we type as NodePgDatabase for one
  // return type — the query-builder / `.query.*` / `.$client` surface is structurally the
  // same, so user code types fine. Dialect-only APIs (e.g. mysql `.$returningId`) aren't
  // typed; drop to `db.$client` for those.
  return client as unknown as SqlClient<TSchema>;
}
