import { startServer, type Account } from '@slsv/ui/server'
import { loadConfig } from './config.js'
import { collectExternalDatabaseUrls } from './providers/aws/databases.js'
import type { AppConfig } from './config.js'

function buildTopology(cfg: AppConfig) {
  const functions = cfg.functions ?? {}
  const routes = Object.entries(functions).flatMap(([functionName, fn]) =>
    (fn.http ?? []).map((route) => ({
      method: route.method,
      path: route.path,
      functionName,
      handler: fn.handler,
    })),
  )
  const webhooks = routes.filter(
    (route) =>
      route.path.toLowerCase().startsWith('/webhooks') ||
      route.functionName.toLowerCase().includes('webhook'),
  )
  const cronJobs = Object.entries(functions)
    .filter(
      (
        entry,
      ): entry is [string, (typeof entry)[1] & { cron: NonNullable<(typeof entry)[1]['cron']> }] =>
        !!entry[1].cron,
    )
    .map(([name, fn]) => ({
      name,
      functionName: name,
      schedule: fn.cron.schedule,
      handler: fn.handler,
    }))
  const queueConsumers = Object.entries(functions)
    .filter(
      (
        entry,
      ): entry is [
        string,
        (typeof entry)[1] & { queue: NonNullable<(typeof entry)[1]['queue']> },
      ] => !!entry[1].queue,
    )
    .map(([functionName, fn]) => ({
      queueName: fn.queue.name,
      functionName,
      handler: fn.handler,
    }))
  const relationships = [
    ...routes.map((route) => ({
      fromKind: 'route',
      from: `${route.method} ${route.path}`,
      toKind: 'function',
      to: route.functionName,
      label: 'invokes',
    })),
    ...queueConsumers.map((consumer) => ({
      fromKind: 'queue',
      from: consumer.queueName,
      toKind: 'function',
      to: consumer.functionName,
      label: 'triggers',
    })),
    ...cronJobs.map((job) => ({
      fromKind: 'cron',
      from: job.schedule,
      toKind: 'function',
      to: job.functionName,
      label: 'schedules',
    })),
  ]

  return {
    routes,
    webhooks,
    cronJobs,
    queueConsumers,
    frontend: cfg.frontend ? { src: cfg.frontend.src, build: cfg.frontend.build } : undefined,
    relationships,
  }
}

// `slsv ui` = the generic inspector pointed at one MiniStack account.
// caches + SQL DBs (postgres/mysql) are discovered live via their AWS APIs
// (ElastiCache + RDS) — see inspect.ts. Only `external` DB urls are passed
// statically here (BYO connection string, not discoverable).
export async function startUi(opts: { target: 'local' | 'aws'; port: number; cwd: string }) {
  const cfg = await loadConfig(opts.cwd)

  const sqlDatabases = collectExternalDatabaseUrls(cfg.databases ?? {})

  const account: Account =
    opts.target === 'local'
      ? {
          name: cfg.app,
          endpoint: 'http://localhost:4566',
          region: 'us-east-1',
          sqlDatabases,
          topology: buildTopology(cfg),
        }
      : {
          name: cfg.app,
          region: process.env.AWS_REGION ?? 'us-east-1',
          sqlDatabases,
          topology: buildTopology(cfg),
        }

  startServer({ accounts: [account], port: opts.port })
}
