import { readFileSync } from 'fs'
import path from 'path'
import {
  CreateDBInstanceCommand,
  DescribeDBInstancesCommand,
  type RDSClient,
} from '@aws-sdk/client-rds'
import pg from 'pg'
import mysql from 'mysql2/promise'
import { envKey } from '../../env-key.js'
import type { AppConfig } from '../../config.js'

// Per-engine provisioning constants. Ministack spins up a real DB process per instance.
// postgres: master user 'postgres'/'postgres' (matches the old container defaults).
// mysql: master user 'admin'/'adminadmin' — NOT 'root', which conflicts with mysql's
// built-in root@localhost and crashes the container on first boot.
const ENGINE_CFG = {
  postgres: { masterUser: 'postgres', masterPass: 'postgres', port: 5432, scheme: 'postgres' },
  mysql: { masterUser: 'admin', masterPass: 'adminadmin', port: 3306, scheme: 'mysql' },
} as const

type SqlEngine = keyof typeof ENGINE_CFG

// Each databases.<name> of type postgres|mysql → its own RDS DB instance (one per name).
// Ministack emulates RDS: CreateDBInstance spins up a real DB process and returns its
// endpoint (a slsv-local network IP, reachable from both the host and Lambda inside ministack).
// Target-agnostic: the client endpoint decides where the call goes (ministack locally, real AWS otherwise).
//
// init_sql runs ONLY on first creation (when CreateDBInstance succeeds, not on AlreadyExists),
// mirroring docker-entrypoint-initdb.d "runs once on fresh" semantics.
export async function ensureDbInstances(
  client: RDSClient,
  databases: AppConfig['databases'],
  appName: string,
  cwd: string,
): Promise<Record<string, string>> {
  const envVars: Record<string, string> = {}
  if (!databases) return envVars
  for (const [name, cfg] of Object.entries(databases)) {
    if (cfg.type !== 'postgres' && cfg.type !== 'mysql') continue
    const engine = cfg.type as SqlEngine
    const ec = ENGINE_CFG[engine]
    const instanceId = `${appName}-${name}`
    const dbName = cfg.name ?? name

    const existing = await describeInstance(client, instanceId)
    const created = !existing
    if (!existing) {
      try {
        await client.send(
          new CreateDBInstanceCommand({
            DBInstanceIdentifier: instanceId,
            Engine: engine,
            DBName: dbName,
            MasterUsername: ec.masterUser,
            MasterUserPassword: ec.masterPass,
            DBInstanceClass: 'db.t3.micro',
            AllocatedStorage: 20,
          }),
        )
      } catch (e: any) {
        // Race: created between our describe + create — not fatal, proceed to describe.
        if (e.name !== 'DBInstanceAlreadyExists') throw e
      }
    }

    let inst = await waitForAvailable(client, instanceId)
    const addr = inst?.Endpoint?.Address
    const port = inst?.Endpoint?.Port ?? ec.port
    if (!addr)
      throw new Error(`databases.${name}: could not resolve RDS endpoint for ${instanceId}`)
    const url = `${ec.scheme}://${ec.masterUser}:${ec.masterPass}@${addr}:${port}/${dbName}`
    envVars[envKey('DATABASE', name)] = url

    // init_sql: only on first creation, after the instance accepts connections.
    if (created && cfg.init_sql) {
      const sql = readFileSync(path.join(cwd, cfg.init_sql), 'utf8')
      await runInitSql(engine, url, sql)
    }
  }
  return envVars
}

async function describeInstance(client: RDSClient, instanceId: string) {
  const r = await client
    .send(new DescribeDBInstancesCommand({ DBInstanceIdentifier: instanceId }))
    .catch(() => null)
  return r?.DBInstances?.[0] ?? undefined
}

// ponytail: polls DescribeDBInstances up to 120s. Ministack is ~2-5s; real AWS is minutes.
async function waitForAvailable(client: RDSClient, instanceId: string, maxMs = 120_000) {
  const start = Date.now()
  while (Date.now() - start < maxMs) {
    const inst = await describeInstance(client, instanceId)
    const status = inst?.DBInstanceStatus
    if (status === 'available') return inst
    if (status === 'failed') throw new Error(`RDS instance ${instanceId} failed to provision`)
    await sleep(2000)
  }
  throw new Error(`RDS instance ${instanceId} did not become available within ${maxMs / 1000}s`)
}

async function runInitSql(engine: SqlEngine, url: string, sql: string) {
  if (engine === 'postgres') {
    const c = new pg.Client({ connectionString: url })
    await c.connect()
    try {
      await c.query(sql)
    } finally {
      await c.end()
    }
  } else {
    const c = await mysql.createConnection(url)
    try {
      await c.query(sql)
    } finally {
      await c.end()
    }
  }
}

// External databases: BYO connection string from process.env (DATABASE_<NAME>). Not provisioned.
export function collectExternalDatabaseEnvs(
  databases: AppConfig['databases'],
  env: Record<string, string | undefined>,
): Record<string, string> {
  const result: Record<string, string> = {}
  if (!databases) return result
  for (const [name, cfg] of Object.entries(databases)) {
    if (cfg.type !== 'external') continue
    const key = envKey('DATABASE', name)
    const value = env[key]
    if (!value) {
      console.warn(
        `  ⚠ databases.${name}: env "${key}" not set — functions will not have this connection string`,
      )
      continue
    }
    result[key] = value
  }
  return result
}

// External DB urls for the UI inspector (postgres/mysql are discovered live via RDS API).
export function collectExternalDatabaseUrls(
  databases: AppConfig['databases'],
  env: Record<string, string | undefined> = process.env,
): { name: string; type: string; url: string }[] {
  if (!databases) return []
  const out: { name: string; type: string; url: string }[] = []
  for (const [name, cfg] of Object.entries(databases)) {
    if (cfg.type !== 'external') continue
    const url = env[envKey('DATABASE', name)]
    if (!url) continue
    out.push({ name, type: cfg.type, url })
  }
  return out
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}
