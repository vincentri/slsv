import { readFileSync } from 'fs'
import path from 'path'
import {
  CreateDBInstanceCommand,
  DeleteDBInstanceCommand,
  DescribeDBInstancesCommand,
  type CreateDBInstanceCommandInput,
  type RDSClient,
} from '@aws-sdk/client-rds'
import pg from 'pg'
import mysql from 'mysql2/promise'
import { envKey } from '../../env-key.js'
import { asTagArray } from './tags.js'
import type { AppConfig } from '../../config.js'

// Per-engine provisioning constants. floci spins up a real DB process per instance.
// postgres: master user 'postgres'/'postgres' (matches the old container defaults).
// mysql: master user 'admin'/'adminadmin' — NOT 'root', which conflicts with mysql's
// built-in root@localhost and crashes the container on first boot.
const ENGINE_CFG = {
  postgres: { masterUser: 'postgres', masterPass: 'postgres', port: 5432, scheme: 'postgres' },
  mysql: { masterUser: 'admin', masterPass: 'adminadmin', port: 3306, scheme: 'mysql' },
} as const

type SqlEngine = keyof typeof ENGINE_CFG

// Each databases.<name> of type postgres|mysql → its own RDS DB instance (one per name).
// floci emulates RDS: CreateDBInstance spins up a real DB process and returns its
// endpoint (a slsv-local network IP, reachable from both the host and Lambda inside floci).
// Target-agnostic: the client endpoint decides where the call goes (floci locally, real AWS otherwise).
//
// init_sql runs ONLY on first creation (when CreateDBInstance succeeds, not on AlreadyExists),
// mirroring docker-entrypoint-initdb.d "runs once on fresh" semantics.
export async function ensureDbInstances(
  client: RDSClient,
  databases: AppConfig['databases'],
  appName: string,
  cwd: string,
  tags: Record<string, string>,
  local: boolean,
): Promise<Record<string, string>> {
  const envVars: Record<string, string> = {}
  if (!databases) return envVars
  for (const [name, cfg] of Object.entries(databases)) {
    if (cfg.type !== 'postgres' && cfg.type !== 'mysql') continue
    const engine = cfg.type as SqlEngine
    const ec = ENGINE_CFG[engine]
    const instanceId = `${appName}-${name}`
    const dbName = cfg.name ?? name

    const createInput: CreateDBInstanceCommandInput = {
      DBInstanceIdentifier: instanceId,
      Engine: engine,
      DBName: dbName,
      MasterUsername: ec.masterUser,
      MasterUserPassword: ec.masterPass,
      // ponytail: knobs apply on --target aws; floci runs single-instance regardless.
      DBInstanceClass: cfg.instanceClass ?? 'db.t3.micro',
      AllocatedStorage: cfg.storage ?? 20,
      MultiAZ: cfg.multiAz ?? false,
      Tags: asTagArray(tags),
    }

    const existing = await describeInstance(client, instanceId)
    let created = !existing
    if (!existing) {
      try {
        await client.send(new CreateDBInstanceCommand(createInput))
      } catch (e: any) {
        // Race: created between our describe + create — not fatal, proceed to describe.
        if (e.name !== 'DBInstanceAlreadyExists') throw e
      }
    }

    let inst = await waitForAvailable(client, instanceId)
    let addr = inst?.Endpoint?.Address
    let port = inst?.Endpoint?.Port ?? ec.port
    if (!addr)
      throw new Error(`databases.${name}: could not resolve RDS endpoint for ${instanceId}`)

    // ponytail: --target local only. Floci's RDS registry can desync from container lifecycle
    // (an instance reads `available` after a Floci restart that killed its container) — the
    // endpoint resolves but refuses connections. Verify reachability; if dead, recreate so
    // Floci respawns the container (and re-run init_sql on the fresh DB). AWS is never touched:
    // a real `available` instance is reachable, and TCP-dialing it from the CLI host would
    // false-negative through the VPC and wrongly rebuild a live prod DB. Same treatment as
    // redis.ts. Remove once Floci keeps its RDS registry in sync with container lifecycle.
    if (local && !(await isDbAlive(engine, ec, addr, port, dbName))) {
      await client
        .send(new DeleteDBInstanceCommand({ DBInstanceIdentifier: instanceId, SkipFinalSnapshot: true }))
        .catch(() => {})
      await waitForGone(client, instanceId)
      await client.send(new CreateDBInstanceCommand(createInput)).catch((e: any) => {
        if (e.name !== 'DBInstanceAlreadyExists') throw e
      })
      inst = await waitForAvailable(client, instanceId)
      addr = inst?.Endpoint?.Address
      port = inst?.Endpoint?.Port ?? ec.port
      if (!addr)
        throw new Error(`databases.${name}: could not resolve RDS endpoint for ${instanceId}`)
      created = true // fresh DB → init_sql must re-run
    }

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

// Liveness check: a *real* DB handshake (SELECT 1), NOT a TCP connect — Floci fronts the RDS
// port itself, so a bare socket connects even when the backing container is dead. Only a
// protocol-level query distinguishes a live DB from a desynced one. Retries to avoid a false
// negative on an instance that just flipped `available` but isn't accepting its first
// connection yet.
async function isDbAlive(
  engine: SqlEngine,
  ec: (typeof ENGINE_CFG)[SqlEngine],
  host: string,
  port: number,
  dbName: string,
  attempts = 3,
): Promise<boolean> {
  for (let i = 0; i < attempts; i++) {
    try {
      if (engine === 'postgres') {
        const c = new pg.Client({
          host, port, user: ec.masterUser, password: ec.masterPass,
          database: dbName, connectionTimeoutMillis: 3000,
        })
        await c.connect()
        try { await c.query('select 1') } finally { await c.end() }
      } else {
        const c = await mysql.createConnection({
          host, port, user: ec.masterUser, password: ec.masterPass,
          database: dbName, connectTimeout: 3000,
        })
        try { await c.query('select 1') } finally { await c.end() }
      }
      return true
    } catch {
      if (i < attempts - 1) await sleep(1000)
    }
  }
  return false
}

// Poll DescribeDBInstances until the instance is gone after a delete, so the recreate doesn't
// race an in-flight teardown. ponytail: proceed on timeout — recreate swallows AlreadyExists.
async function waitForGone(client: RDSClient, instanceId: string, maxMs = 30_000) {
  const start = Date.now()
  while (Date.now() - start < maxMs) {
    if (!(await describeInstance(client, instanceId))) return
    await sleep(1000)
  }
}

async function describeInstance(client: RDSClient, instanceId: string) {
  const r = await client
    .send(new DescribeDBInstancesCommand({ DBInstanceIdentifier: instanceId }))
    .catch(() => null)
  return r?.DBInstances?.[0] ?? undefined
}

// ponytail: polls DescribeDBInstances up to 120s. floci is ~2-5s; real AWS is minutes.
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

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}
