// Cloud-agnostic interfaces. AWS impl today; GCP/Azure implement the same shapes.

export type Item = Record<string, any>
export type Key = Record<string, any>

export interface QueryOptions {
  /** GSI / secondary index name to query against */
  index?: string
  /** Max items to return */
  limit?: number
  /** Sort-key condition, e.g. { gt: '2024-01-01' } or { beginsWith: 'inv#' } */
  sort?: { eq?: any; lt?: any; lte?: any; gt?: any; gte?: any; beginsWith?: string }
}

export interface DbClient {
  get(key: Key): Promise<Item | undefined>
  put(item: Item): Promise<void>
  delete(key: Key): Promise<void>
  /** Query by partition key equality (+ optional sort condition / index) */
  query(partition: Key, opts?: QueryOptions): Promise<Item[]>
  scan(): Promise<Item[]>
  batchGet(keys: Key[]): Promise<Item[]>
  batchPut(items: Item[]): Promise<void>
  /** Atomic multi-item write. Each op put OR delete. */
  transactWrite(ops: Array<{ put?: Item; delete?: Key }>): Promise<void>
}

export interface ReceivedMessage {
  body: any
  /** Opaque handle used to delete the message after processing */
  receiptHandle: string
}

export interface QueueClient {
  send(body: any): Promise<void>
  sendBatch(bodies: any[]): Promise<void>
  receive(opts?: { max?: number; waitSeconds?: number }): Promise<ReceivedMessage[]>
  delete(receiptHandle: string): Promise<void>
}

export interface StorageClient {
  put(key: string, body: string | Uint8Array, contentType?: string): Promise<void>
  get(key: string): Promise<Uint8Array | undefined>
  getText(key: string): Promise<string | undefined>
  list(prefix?: string): Promise<string[]>
  delete(key: string): Promise<void>
}

export interface CacheClient {
  get(key: string): Promise<string | undefined>
  set(key: string, value: string, opts?: { ttl?: number }): Promise<void>
  del(key: string): Promise<void>
  incr(key: string): Promise<number>
  exists(key: string): Promise<boolean>
}

export interface Provider {
  db(physicalName: string): DbClient
  queue(physicalUrlOrName: string): QueueClient
  storage(physicalName: string): StorageClient
  cache(redisUrl: string): CacheClient
  secret(secretId: string): Promise<string>
}
