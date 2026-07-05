import type { Provider, DbClient, QueueClient, StorageClient, CacheClient } from './types.js'
export {
  json,
  redirect,
  router,
  type ApiHandler,
  type ApiRequest,
  type ApiResponse,
  type LambdaEvent,
  type Route,
} from './api.js'

import { resolve } from './resolve.js'
import { makeDb } from './providers/aws/db.js'
import { makeQueue } from './providers/aws/queue.js'
import { makeStorage } from './providers/aws/storage.js'
import { makeCache } from './providers/aws/cache.js'
import { getSecret } from './providers/aws/secret.js'

export type {
  DbClient,
  QueueClient,
  StorageClient,
  CacheClient,
  Item,
  Key,
  QueryOptions,
  ReceivedMessage,
} from './types.js'

// slsv injects SLSV_PROVIDER at deploy time. Default 'aws'.
// GCP/Azure providers register here once implemented — handler code never changes.
const PROVIDERS: Record<string, Provider> = {
  aws: { db: makeDb, queue: makeQueue, storage: makeStorage, cache: makeCache, secret: getSecret },
}

function provider(): Provider {
  const name = process.env.SLSV_PROVIDER ?? 'aws'
  const p = PROVIDERS[name]
  if (!p)
    throw new Error(
      `slsv: unknown provider "${name}". Available: ${Object.keys(PROVIDERS).join(', ')}`,
    )
  return p
}

/** DynamoDB table (AWS) / Firestore collection (GCP) by logical name from slsv.yml */
export function db(name: string): DbClient {
  return provider().db(resolve('DATABASE', name))
}

/** SQS queue (AWS) / Pub-Sub topic (GCP) by logical name from slsv.yml */
export function queue(name: string): QueueClient {
  return provider().queue(resolve('QUEUE', name))
}

/** S3 bucket (AWS) / GCS bucket (GCP) by logical name from slsv.yml */
export function storage(name: string): StorageClient {
  return provider().storage(resolve('BUCKET', name))
}

/** Redis cache by logical name from slsv.yml */
export function cache(name: string): CacheClient {
  return provider().cache(resolve('REDIS', name))
}

/**
 * Secrets Manager value by logical name from slsv.yml `secrets:`.
 * Fetched at runtime (never baked into the function env) and cached per container.
 *   const jwt = await secret('JWT_SECRET')
 */
export function secret(name: string): Promise<string> {
  return provider().secret(resolve('SECRET', name))
}
