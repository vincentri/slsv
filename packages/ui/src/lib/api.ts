let current =
  (typeof localStorage !== 'undefined' ? localStorage.getItem('slsv-account') : null) ?? ''
export const setAccount = (a: string) => {
  current = a
}

export const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
const API_BASE = isTauri ? 'http://localhost:4567' : ''

export class SsoExpiredError extends Error {
  constructor(public readonly profile: string) {
    super(`SSO token expired: ${profile}`)
    this.name = 'SsoExpiredError'
  }
}

async function get<T>(path: string): Promise<T> {
  const r = await fetch(API_BASE + path)
  if (!r.ok) {
    const err = await r.json().catch(() => ({ error: r.statusText }))
    if (err.error === 'SSO_EXPIRED') throw new SsoExpiredError(err.profile ?? '')
    throw new Error(err.error ?? r.statusText)
  }
  return r.json()
}

const scoped = (path: string) => `/api/v1/${current}${path}`

export type AccountMeta = { name: string; region: string; endpoint?: string; kind: 'local' | 'aws' }

export type FunctionSummary = {
  name: string
  runtime?: string
  memory?: number
  timeout?: number
  lastModified?: string
}

type LogGroupSummary = { name: string; storedBytes: number }

type BusSummary = { name: string }

type TopologyRoute = {
  method: string
  path: string
  functionName: string
  handler?: string
}

type AppTopology = {
  routes?: TopologyRoute[]
  webhooks?: TopologyRoute[]
  cronJobs?: { name: string; functionName: string; schedule: string; handler?: string }[]
  queueConsumers?: { queueName: string; functionName: string; handler?: string }[]
  frontend?: { src?: string; build?: string; devUrl?: string }
  relationships?: { fromKind: string; from: string; toKind: string; to: string; label: string }[]
}

export type Overview = {
  account: string
  region: string
  databases: { name: string; count: number }[]
  queues: { name: string; depth: string }[]
  buckets: { name: string; created?: string }[]
  functions: FunctionSummary[]
  logGroups: LogGroupSummary[]
  apis: { id: string; name: string; url: string }[]
  secrets: string[]
  caches: { name: string }[]
  buses: BusSummary[]
  sqlDatabases: { name: string; type: string; tables: number }[]
  topology?: AppTopology
}

export type SqlTable = { name: string; type: string }
export type SqlQueryResult = { columns: string[]; rows: Record<string, unknown>[] }

export type LambdaConfig = {
  name: string
  arn: string
  state?: string
  lastUpdateStatus?: string
  version: string
  packageType: string
  architectures: string[]
  runtime?: string
  handler?: string
  memory: number
  timeout: number
  ephemeralStorage: number
  codeSize: number
  codeSha256: string
  lastModified?: string
  role: string
  layers: string[]
  tracingMode?: string
  dlqTarget?: string
  logGroup?: string
  env: Record<string, string>
}

export type SecretMeta = {
  name: string
  arn?: string
  createdDate?: string
  lastChangedDate?: string
  lastAccessedDate?: string
  rotationEnabled: boolean
  rotationRules?: { AutomaticallyAfterDays?: number } | null
  tags: Record<string, string>
}

export type EventBusRule = {
  name: string
  state?: string
  scheduleExpression?: string
  eventPattern?: string
  description?: string
  arn?: string
}

type RuleTarget = { id: string; arn: string }
export type RuleDetail = EventBusRule & { targets: RuleTarget[] }

type ApiRoute = { method: string; path: string; integration?: string }
type ApiStage = { name: string; url: string; createdDate?: string; lastUpdated?: string }
export type ApiDetail = { id: string; routes: ApiRoute[]; stages: ApiStage[] }

export type ScanResult = { items: Record<string, unknown>[]; cursor?: string }
export type LogEvent = { time?: number; msg?: string }
export type QueueMsg = { id?: string; body?: string }
type ObjMeta = { key: string; size: number; modified?: string }
export type ObjectDetail = {
  key: string
  size: number
  modified?: string
  contentType: string
  etag?: string
  storageClass?: string
  metadata?: Record<string, string>
  versionId?: string
  serverSideEncryption?: string
  expires?: string
  cacheControl?: string
  contentEncoding?: string
  contentDisposition?: string
  checksumAlgorithm?: string
}
export type ObjectAcl = {
  key: string
  owner: string | null
  grants: { grantee: string; permission: string }[]
}
export type BucketListResult = {
  prefix: string
  folders: string[]
  objects: ObjMeta[]
  nextToken?: string
}
export type BucketMeta = {
  name: string
  arn: string
  region: string
  created?: string
  owner?: string
  versioning?: string
  encryption?: string
  tags?: Record<string, string>
  serverAccessLogging?: string
  eventNotifications?: number
  eventBridge?: boolean
  transferAcceleration?: string
  objectLock?: string
  requesterPays?: string
  website?: string
  policy?: string
  cors?: string
  publicAccessBlock?: {
    blockPublicAcls: boolean
    ignorePublicAcls: boolean
    blockPublicPolicy: boolean
    restrictPublicBuckets: boolean
  }
  ownershipControls?: string
  aclGrants?: { grantee: string; permission: string }[]
  objectCount: number
  totalSize: number
}
type CacheKey = { key: string; type: string; ttl: number; value: string | null }
export type CacheScan = { keys: CacheKey[]; cursor?: string }

export const api = {
  accounts: () => get<AccountMeta[]>('/api/accounts'),
  overview: () => get<Overview>(scoped('/overview')),

  getFunction: (name: string) => get<LambdaConfig>(scoped(`/function/${encodeURIComponent(name)}`)),
  getApi: (id: string) => get<ApiDetail>(scoped(`/apigw/${id}`)),
  getSecret: (name: string) => get<SecretMeta>(scoped(`/secret/${encodeURIComponent(name)}`)),
  getBus: (name: string) => get<EventBusRule[]>(scoped(`/bus/${encodeURIComponent(name)}`)),
  getRule: (bus: string, rule: string) =>
    get<RuleDetail>(scoped(`/rule?${new URLSearchParams({ bus, rule })}`)),

  scanTable: (name: string, cursor?: string, index?: string) =>
    get<ScanResult>(
      scoped(
        `/table/${name}?${new URLSearchParams({ ...(cursor && { cursor }), ...(index && { index }) })}`,
      ),
    ),
  queryTable: (name: string, params: Record<string, string>) =>
    get<ScanResult>(scoped(`/table/${name}/query?${new URLSearchParams(params)}`)),
  peekQueue: (name: string, max = 10) => get<QueueMsg[]>(scoped(`/queue/${name}?max=${max}`)),
  listObjects: (
    name: string,
    opts: { prefix?: string; token?: string; search?: string; limit?: number } = {},
  ) => {
    const p = new URLSearchParams()
    if (opts.prefix) p.set('prefix', opts.prefix)
    if (opts.token) p.set('token', opts.token)
    if (opts.search) p.set('search', opts.search)
    if (opts.limit) p.set('limit', String(opts.limit))
    return get<BucketListResult>(scoped(`/bucket/${name}?${p}`))
  },
  getBucket: (name: string) => get<BucketMeta>(scoped(`/bucket/${name}/properties`)),
  getObject: (name: string, key: string) =>
    get<{ contentType: string; body: string }>(
      scoped(`/bucket/${name}/object?key=${encodeURIComponent(key)}`),
    ),
  rawObjectUrl: (name: string, key: string) =>
    API_BASE + scoped(`/bucket/${name}/raw?key=${encodeURIComponent(key)}`),
  headObject: (name: string, key: string) =>
    get<ObjectDetail>(scoped(`/bucket/${name}/object?key=${encodeURIComponent(key)}&head=1`)),
  getObjectAcl: (name: string, key: string) =>
    get<ObjectAcl>(scoped(`/bucket/${name}/object-acl?key=${encodeURIComponent(key)}`)),
  deleteObject: async (name: string, key: string) => {
    const r = await fetch(
      API_BASE + scoped(`/bucket/${name}/object?key=${encodeURIComponent(key)}`),
      { method: 'DELETE' },
    )
    if (!r.ok) throw new Error(`Delete failed: ${r.statusText}`)
  },

  // group = full log group name e.g. /aws/lambda/fn or custom
  tailLogs: (group: string, since?: number, filter?: string) =>
    get<LogEvent[]>(
      scoped(
        `/logs?${new URLSearchParams({ group, ...(since && { since: String(since) }), ...(filter && { filter }) })}`,
      ),
    ),

  scanCache: (name: string, cursor?: string, match?: string) =>
    get<CacheScan>(
      scoped(
        `/cache/${name}?${new URLSearchParams({ ...(cursor && { cursor }), ...(match && { match }) })}`,
      ),
    ),

  listSqlTables: (db: string) => get<SqlTable[]>(scoped(`/sql/${db}/tables`)),
  peekSqlTable: (db: string, table: string, limit = 100) =>
    get<SqlQueryResult>(scoped(`/sql/${db}/table/${encodeURIComponent(table)}?limit=${limit}`)),
  runSqlQuery: (db: string, sql: string) =>
    fetch(`${API_BASE}/api/v1/${current}/sql/${db}/query`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sql }),
    }).then(async (r) => {
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? r.statusText)
      return r.json() as Promise<SqlQueryResult>
    }),
}
