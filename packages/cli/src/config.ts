import { readFileSync, existsSync } from 'fs'
import { parse } from 'yaml'
import { z, ZodError } from 'zod'
import path from 'path'

const HttpRoute = z.object({
  method: z.string(),
  path: z.string(),
})

const FunctionConfig = z.object({
  runtime: z.enum(['nodejs22']),
  handler: z.string(),
  http: z.array(HttpRoute).optional(),
  queue: z.object({ name: z.string() }).optional(),
  cron: z.object({ schedule: z.string() }).optional(),
  event: z.object({ pattern: z.record(z.any()) }).optional(), // EventBridge event-pattern trigger
  timeout: z.number().int().min(1).max(900).optional(), // seconds (Lambda hard limit 900)
  memory: z.number().int().min(128).max(10240).optional(), // MB, 1MB steps
  environment: z.record(z.string()).optional(), // custom env vars (bindings still win)
})

const QueueConfig = z.object({
  type: z.enum(['sqs']),
  fifo: z.boolean().optional(),
  visibilityTimeout: z.number().int().positive().max(43200).optional(),
  dlq: z.string().optional(),
})

const KeyAttr = z.object({
  name: z.string(),
  type: z.enum(['S', 'N', 'B']),
})

const DynamoDbConfig = z.object({
  type: z.literal('dynamodb'),
  partitionKey: KeyAttr,
  sortKey: KeyAttr.optional(),
  gsi: z
    .array(
      z.object({
        name: z.string(),
        partitionKey: KeyAttr,
        sortKey: KeyAttr.optional(),
      }),
    )
    .optional(),
})

const SqlConfig = z.object({
  type: z.enum(['postgres', 'mysql']),
  name: z.string().optional(), // actual DB name for local container; defaults to logical key
  init_sql: z.string().optional(), // path to SQL file run once on local container init
  instanceClass: z.string().optional(), // RDS instance class, default 'db.t3.micro'
  storage: z.number().int().min(20).max(65536).optional(), // GB, default 20
  multiAz: z.boolean().optional(), // default false
})

const DatabaseConfig = z.discriminatedUnion('type', [DynamoDbConfig, SqlConfig])

const CacheConfig = z.object({
  type: z.enum(['redis', 'valkey']),
  nodeType: z.string().optional(), // ElastiCache node type, default 'cache.t3.micro'
  nodes: z.number().int().min(1).max(5).optional(), // NumCacheNodes, default 1
})

const FrontendConfig = z.object({
  src: z.string(),
  build: z.string().optional(),
  cloudfront: z.boolean().optional(),
})

const AppConfig = z.object({
  app: z.string(),
  functions: z.record(FunctionConfig).optional(),
  queues: z.record(QueueConfig).optional(),
  buckets: z.record(z.object({})).optional(),
  databases: z.record(DatabaseConfig).optional(),
  caches: z.record(CacheConfig).optional(),
  secrets: z.array(z.string()).optional(),
  frontend: FrontendConfig.optional(),
})

export type AppConfig = z.infer<typeof AppConfig>
export type DynamoDbDef = z.infer<typeof DynamoDbConfig>
export type FrontendDef = z.infer<typeof FrontendConfig>

// Deep-merge an overlay onto a base: objects merge recursively, arrays/scalars replace,
// and an explicit `null` in the overlay removes the key (needed to swap e.g. a queue
// trigger for an event trigger between stages).
function deepMerge(base: any, over: any): any {
  if (over === null || typeof over !== 'object' || Array.isArray(over)) return over
  if (base === null || typeof base !== 'object' || Array.isArray(base)) return { ...over }
  const out: any = { ...base }
  for (const [k, v] of Object.entries(over)) {
    if (v === null) delete out[k]
    else out[k] = k in base ? deepMerge(base[k], v) : v
  }
  return out
}

export function loadConfig(cwd: string = process.cwd(), stage = 'dev'): AppConfig {
  const cfgPath = path.join(cwd, 'slsv.yml')
  if (!existsSync(cfgPath)) {
    throw new ConfigError(`No slsv.yml found in ${cwd}`)
  }
  const raw = readFileSync(cfgPath, 'utf-8')
  let parsed: Record<string, any>
  try {
    parsed = (parse(raw) ?? {}) as Record<string, any>
  } catch (e: any) {
    // yaml lib embeds line/column in the message already.
    throw new ConfigError(`slsv.yml is not valid YAML:\n  ${e.message}`)
  }
  // `stages.<stage>` overlays the base config; the `stages` key itself is dropped before
  // validation (zod strips it anyway, but be explicit) and the merged result is validated.
  const { stages, ...base } = parsed
  const overlay = stages?.[stage]
  const merged = overlay ? deepMerge(base, overlay) : base
  try {
    return AppConfig.parse(merged)
  } catch (e) {
    if (e instanceof ZodError) {
      // ponytail: zod's default messages are generic ("Expected number", "Invalid enum
      // value"). Path prefix tells WHERE; message tells WHAT. For truly bespoke copy
      // ("timeout must be ≤ 900"), override per-rule via zod's `{ message: ... }` arg.
      const lines = e.issues.map((i) => {
        const p = i.path.length ? i.path.join('.') : '(root)'
        return `  ${p}: ${i.message}`
      })
      throw new ConfigError(`Invalid slsv.yml:\n${lines.join('\n')}`)
    }
    throw e
  }
}

// Friendly, catchable config-load failure. cli.ts catches this once and prints without
// a stack trace; other thrown errors surface normally (genuine bugs).
export class ConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConfigError'
  }
}
