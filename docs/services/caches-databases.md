# Caches & Databases

Beyond DynamoDB tables, slsv provisions **ElastiCache (Redis/Valkey)** and **RDS (Postgres/MySQL)** through their native AWS APIs. Local-mode provisions against Floci; both services have known Floci quirks bridged by the local paths.

## Caches (ElastiCache)

```yaml
caches:
  session:
    type: redis                  # redis | valkey — both provision valkey under the hood
    nodeType: cache.t4g.small    # aws-only
    nodes: 2                     # aws-only
    serverless: true             # aws-only — ElastiCache Serverless
```

The SDK:

```ts
import { cache } from "@slsv/sdk";
const session = cache("session");
await session.set("u_123", { name: "Ada" }, { ttl: 3600 });
const u = await session.get("u_123");
```

### Node group (default)

One **replication group** per `caches.<name>`, provisioned via `CreateReplicationGroup` (`redis.ts:26`). Not `CreateCacheCluster` — that only supports memcached.

`CreateReplicationGroup` passes `TransitEncryptionEnabled: false` (real AWS requires it explicit; keeps the plain `redis://` string valid).

Endpoint resolution splits by target:

- **`--target aws`** — read from `DescribeReplicationGroups` → `ConfigurationEndpoint`, fallback `NodeGroups[0].PrimaryEndpoint`. Provisions **asynchronously (~5–10 min)** — endpoint isn't populated until `available`, so `redis.ts` polls (`waitForCacheEndpoint`).
- **`--target local`** — Floci's API returns an unreachable `localhost:6379` for every group and doesn't publish the valkey port to the host. `ensureLocalCache` reads the valkey container's floci-network IP (`192.168.107.x`) via `docker inspect floci-valkey-<app>-<stage>-<name>` and injects `redis://<ip>:6379`. Same reachability model RDS gets for free.

### Serverless mode (`serverless: true`, aws-only)

Opts into **ElastiCache Serverless** (`CreateServerlessCache` / `DescribeServerlessCaches` / teardown `DeleteServerlessCache`) instead of a node group — auto-scales, pay-per-use, no `nodeType`/`nodes`.

`--target local` ignores it: the local branch (`ensureLocalCache`) runs _before_ the serverless check and `continue`s. Floci doesn't implement `CreateServerlessCache` (returns `UnsupportedOperation`).

Serverless is **TLS-only** (AWS forces transit encryption), so `ensureServerlessCache` returns a `rediss://` endpoint (vs the node path's plain `redis://`). The SDK's ioredis client enables TLS from the `rediss://` scheme with no change.

Provisions asynchronously (~minutes) — `waitForServerlessEndpoint` polls until the endpoint populates.

### Liveness/recreate (--target local only)

Floci's group registry desyncs from container lifecycle (a group reads `available` with no container behind it, e.g. after a Floci restart → recreate-every-run + orphans). The `docker inspect` doubles as the liveness check: no container IP ⇒ stale group ⇒ `DeleteReplicationGroup` + recreate so Floci respawns it.

### Reconcile for caches

Never pruned by reconcile — only `slsv destroy` removes caches. `slsv status` lists via `DescribeReplicationGroups`; serverless caches won't show there yet (no `DescribeServerlessCaches` pass).

## Databases (RDS)

```yaml
databases:
  primary:
    type: postgres              # postgres | mysql
    instanceClass: db.t4g.small  # aws-only
    storage: 20                  # GB, aws-only
    multiAz: false               # aws-only
    name: app                    # initial database name
    init_sql: |                  # runs once on first creation
      CREATE TABLE users (
        id SERIAL PRIMARY KEY,
        email TEXT UNIQUE NOT NULL
      );
    skipFinalSnapshot: true      # destroy default (true) — no snapshot
```

### Local (Floci)

One RDS DB instance per `databases.<name>`, provisioned via `CreateDBInstance` (`databases.ts:34`). Floci assigns slsv-local network IPs (`192.168.107.x`) reachable from BOTH the host (UI inspector) and Lambda inside floci.

`init_sql` runs once on first creation (when `CreateDBInstance` succeeds, not on `AlreadyExists`), mirroring docker-entrypoint-initdb.d semantics.

Master creds are fixed local-dev defaults (`postgres`/`postgres` for postgres; `admin`/`adminadmin` for mysql — NOT `root`, which conflicts with mysql's built-in root@localhost).

**Liveness/recreate (`--target local` only):** an instance can read `available` after a Floci restart that killed its container, so the endpoint resolves but the DB is dead. Because **Floci fronts the RDS port itself** (a bare TCP connect succeeds even with no container behind it), the check is a real protocol handshake (`SELECT 1` via the same `pg`/`mysql2` clients), NOT a socket probe. On failure, delete + recreate respawns the container and re-runs `init_sql` (fresh DB).

AWS is never touched — a real `available` instance is reachable, and handshaking it from the CLI host would false-negative through the VPC and rebuild a live prod DB.

### SQL via Drizzle

```ts
import { sql } from "@slsv/sdk";
import { pgTable, serial, text } from "@slsv/sdk/pg-core";

const users = pgTable("users", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
});

export const handler = async () => {
  const db = sql("primary", { schema: { users } });
  const rows = await db.select().from(users);
  return { rows };
};
```

`sql(name, { schema? })` resolves the same `DATABASE_<NAME>` env — the CLI injects a `postgres://` / `mysql://` **connection string** there for RDS dbs (vs a table name for dynamo), sniffs the dialect from the URL scheme, and returns a **Drizzle** client cached per container. Pass `{ schema }` for the typed relational API; omit it and the query builder + raw SQL still work.

`pgCore` and `mysqlCore` are namespaced (they share column names) — `import * as pgCore from "@slsv/sdk"` re-exports both.

### BYO / hosted DBs

For a DB slsv doesn't host (Supabase, Neon, self-managed RDS), there's **no `databases` type** — put the connection string in `secrets:` and connect with your own driver. See [Secrets](../architecture/secrets.md).

### Reconcile for RDS

- **In yml, not in AWS** → `create` (with `init_sql`).
- **In AWS, not in yml** → `orphan` by default. Set `autoRemove: true` to `DeleteDBInstance` with `SkipFinalSnapshot`.
- RDS orphan delete always skips the final snapshot (the removed yml no longer carries `skipFinalSnapshot`).
- `slsv destroy` (yml-agnostic) always sets `SkipFinalSnapshot: true` — a drifted destroy can't know to snapshot. Use `skipFinalSnapshot: false` + destroy while it's still in the yml if you need one.