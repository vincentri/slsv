import { readFileSync } from 'fs'
import { parse } from 'yaml'
import { z } from 'zod'
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
})

const QueueConfig = z.object({
  type: z.enum(['sqs']),
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
  type: z.enum(['postgres', 'mysql', 'external']),
  name: z.string().optional(), // actual DB name for local container; defaults to logical key
  init_sql: z.string().optional(), // path to SQL file run once on local container init
})

const DatabaseConfig = z.discriminatedUnion('type', [DynamoDbConfig, SqlConfig])

const CacheConfig = z.object({
  type: z.enum(['redis']),
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

export function loadConfig(cwd: string = process.cwd()): AppConfig {
  const cfgPath = path.join(cwd, 'slsv.yml')
  const raw = readFileSync(cfgPath, 'utf-8')
  const parsed = parse(raw)
  return AppConfig.parse(parsed)
}
