import { resolve } from "./resolve.js";
import { makeDb } from "./providers/aws/db.js";
import { makeQueue } from "./providers/aws/queue.js";
import { makeStorage } from "./providers/aws/storage.js";
import { makeCache } from "./providers/aws/cache.js";
import { getSecret } from "./providers/aws/secret.js";
import { makeSql } from "./providers/aws/sql.js";

export {
  json,
  redirect,
  router,
  type ApiHandler,
  type ApiRequest,
  type ApiResponse,
  type LambdaEvent,
  type Middleware,
  type Route,
} from "./api.js";

export type {
  DbClient,
  QueueClient,
  StorageClient,
  CacheClient,
  Item,
  Key,
  QueryOptions,
  ReceivedMessage,
} from "./types.js";

/** DynamoDB table by logical name from slsv.yml */
export function db(name: string) {
  return makeDb(resolve("DATABASE", name));
}

/** SQS queue by logical name from slsv.yml */
export function queue(name: string) {
  return makeQueue(resolve("QUEUE", name));
}

/** S3 bucket by logical name from slsv.yml */
export function storage(name: string) {
  return makeStorage(resolve("BUCKET", name));
}

/** Redis cache by logical name from slsv.yml */
export function cache(name: string) {
  return makeCache(resolve("REDIS", name));
}

/**
 * Secrets Manager value by logical name from slsv.yml `secrets:`.
 * Fetched at runtime (never baked into the function env) and cached per container.
 */
export function secret(name: string) {
  return getSecret(resolve("SECRET", name));
}

/**
 * Postgres/MySQL via Drizzle, by logical name from slsv.yml `databases:` (type postgres|mysql).
 * Pass `{ schema }` (your drizzle table defs) for the typed relational API; omit it and the
 * query builder + raw SQL still work. See makeSql for details.
 */
export function sql<TSchema extends Record<string, unknown> = Record<string, never>>(
  name: string,
  opts: { schema?: TSchema } = {},
) {
  return makeSql(resolve("DATABASE", name), opts);
}

// Drizzle schema builders + raw-SQL tag, re-exported so handlers never import `drizzle-orm`
// directly (same rule as `@aws-sdk`). This guarantees ONE drizzle-orm copy — the SDK's — so a
// schema you build with these is type-compatible with the client `sql()` returns (avoids the
// dual-package hazard when @slsv/sdk is a file: link). pg-core and mysql-core share column
// names, so they're namespaced.
export * as pgCore from "drizzle-orm/pg-core";
export * as mysqlCore from "drizzle-orm/mysql-core";
// drizzle's `sql` template for raw fragments — renamed to avoid colliding with slsv's sql().
export { sql as sqlExpr } from "drizzle-orm";
export type { SqlClient } from "./providers/aws/sql.js";
