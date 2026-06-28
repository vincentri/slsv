# slsv — simple local-AWS serverless framework

One `slsv.yml` describes the whole app. `slsv dev` brings the entire stack up on MiniStack. Later, `slsv deploy --target aws` hits real AWS — no handler rewrites.

## Hard rule: every resource runs in MiniStack

slsv provisions ALL resources through their native AWS API against MiniStack
(localhost:4566) — no sibling containers, no sidecars, no bypass. Lambda, Dynamo,
SQS, S3, EventBridge, Secrets, IAM, Logs via their SDK APIs; Redis via the
ElastiCache API; Postgres + MySQL via the RDS API. Anything declared in slsv.yml
MUST be creatable, describable, and deletable through the AWS SDK pointed at
MiniStack. If a new resource type can't be driven through MiniStack's API, that's
a blocker — do NOT wire it as a sidecar container. The CLI must always run
end-to-end against MiniStack alone.

## What this is NOT

- Not a Lambda-only tool (full multi-service support: HTTP, SQS, EventBridge, DynamoDB, S3, Secrets, CloudWatch, Redis, Postgres, MySQL)
- Not a CloudFormation/SAM/SST wrapper — direct AWS SDK v3, idempotent get-or-create
- Not an AWS emulator — **MiniStack** (`ministackorg/ministack`) owns that; slsv is the orchestration + DX layer. Same port 4566 as LocalStack. Health = `GET /`; global reset = `POST /_ministack/reset`

## Monorepo (pnpm workspaces)

```
packages/cli/    # name: "slsv"       — CLI tool (commander), deployer, bundler, dev loop
packages/sdk/    # name: "@slsv/sdk"  — cloud-agnostic handler SDK (db/queue/storage/cache)
packages/ui/     # name: "@slsv/ui"   — React dashboard (Vite + Tailwind); served by `slsv ui`; shows logs, queues, tables
examples/demo/                       — canonical reference app, always must work
```

**Build:** `pnpm build` (all), `pnpm --filter slsv build`, `pnpm --filter @slsv/sdk build`
**Lint:** `pnpm lint` or per-package `pnpm --filter slsv lint`
**Test:** `pnpm test`
**Dev CLI:** `pnpm --filter slsv dev` (tsx watch), or `pnpm --filter slsv build:link` to re-link

## Phase 1 services (locked)

Lambda · API Gateway · SQS · EventBridge · DynamoDB · S3 · Secrets Manager · IAM exec role · CloudWatch Logs · Redis (ElastiCache API) · Postgres + MySQL (RDS API)

## Key architecture decisions

### Provider abstraction

`packages/cli/src/providers/types.ts` — `Provider` interface. `AwsProvider` is the only impl today. GCP later = new impl, zero user change.

### Cloud portability boundary = env vars

slsv injects `TABLE_<NAME>`, `QUEUE_<NAME>`, `BUCKET_<NAME>`, `REDIS_<NAME>` into every function at deploy time. Handler code resolves by logical name, never by ARN/URL directly.

### @slsv/sdk

Handlers import `@slsv/sdk`, never raw `@aws-sdk/*`. `db('invoices')` → resolves `TABLE_INVOICES` env → DynamoDBDocumentClient. Same for `queue()`, `storage()`, `cache()`. Provider selected via `SLSV_PROVIDER` env (injected by CLI at deploy, default `aws`).

### Multi-store (multiple instances of same type)

Each store block is a map. `caches: { session: ..., ratelimit: ... }` → `REDIS_SESSION` and `REDIS_RATELIMIT` → `cache('session')` vs `cache('ratelimit')` are isolated. Works the same for tables/queues/buckets/databases.

### Caches locally

One ElastiCache cluster per `caches.<name>`, provisioned via `CreateCacheCluster` against MiniStack. MiniStack assigns sequential ports starting at 16379 and publishes them to the host. Lambda (executing inside the ministack container) cannot reach `localhost:16379` — the CLI substitutes `host.docker.internal:16379` in the env var so Lambda hits the host-published port. The UI inspector (on the host) uses the raw `localhost` endpoint from `DescribeCacheClusters`.

### Databases locally

Four database types, each driven through its native API against MiniStack:

- **dynamodb** — `CreateTable` against MiniStack's DynamoDB API (unchanged).
- **postgres / mysql** — one RDS DB instance per `databases.<name>`, provisioned via `CreateDBInstance`. MiniStack assigns slsv-local network IPs (e.g. `192.168.107.x`) that are reachable from BOTH the host (UI inspector) and Lambda inside ministack — no host override needed. `init_sql` runs once on first creation (when `CreateDBInstance` succeeds, not on `AlreadyExists`), mirroring docker-entrypoint-initdb.d semantics. Master creds are fixed local-dev defaults (`postgres`/`postgres` for postgres; `admin`/`adminadmin` for mysql — NOT `root`, which conflicts with mysql's built-in root@localhost).
- **external** — BYO connection string from `DATABASE_<NAME>` env var. Not provisioned.

### AWS_ENDPOINT_URL

Injected into functions **only** for `--target local`. For `--target aws` it is omitted so the SDK uses real endpoints.

## slsv.yml schema (key blocks)

```yaml
app: my-app
functions:
  api:
    runtime: nodejs20 # only runtime in phase 1
    handler: ./src/api.handler # file.export
    http: [{ method, path }] # OR queue: { name } OR cron: { schedule }
queues: { name: { type: sqs } }
tables: { name: { partitionKey, sortKey?, gsi? } }
buckets: { name: {} }
databases: { name: { type: dynamodb|postgres|mysql|external, ... } } # dynamodb/postgres/mysql provisioned via their APIs; external = BYO URL
caches: { name: { type: redis } }
secrets: [ENV_VAR_NAME]
```

## Templates (slsv init)

- `slsv init` → interactive prompt (@clack/prompts) → **minimal** template (1 HTTP fn + 1 table)
- `slsv init <name>` → skip prompt
- `slsv init --demo` → full demo (HTTP + webhook + SQS job + cron)
- Demo template uses `paymentWebhook` (x-webhook-secret header, no Stripe). `.env.example` works as-is.
- `slsv init --yes` → headless/CI (name = folder name)

## Critical files

| File                                          | Purpose                                                                                                                                                                                          |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/cli/src/config.ts`                  | zod schema for slsv.yml                                                                                                                                                                          |
| `packages/cli/src/providers/types.ts`         | Provider interface                                                                                                                                                                               |
| `packages/cli/src/providers/aws/index.ts`     | AwsProvider impl                                                                                                                                                                                 |
| `packages/cli/src/providers/aws/ministack.ts` | docker-compose gen + health wait                                                                                                                                                                 |
| `packages/cli/src/providers/aws/functions.ts` | esbuild bundle → zip → Lambda deploy                                                                                                                                                             |
| `packages/cli/src/deploy.ts`                  | orchestration order                                                                                                                                                                              |
| `packages/cli/src/init.ts`                    | scaffold templates (minimal + demo)                                                                                                                                                              |
| `packages/cli/src/env-key.ts`                 | shared env var name util (`TABLE_FOO`, `QUEUE_BAR`, etc.)                                                                                                                                        |
| `packages/cli/src/ui.ts`                      | `slsv ui` command — serves packages/ui via Vite dev server                                                                                                                                       |
| `packages/sdk/src/index.ts`                   | db/queue/storage/cache exports                                                                                                                                                                   |
| `packages/sdk/src/resolve.ts`                 | logical name → env var                                                                                                                                                                           |
| `packages/ui/src/`                            | React dashboard — logs, queues, tables viewer; Vite + Tailwind                                                                                                                                   |
| `packages/ui/src/views/BucketBrowser.tsx`     | S3 detail: **Objects** tab (breadcrumb folder nav via `Delimiter:'/'`) + **Properties** tab (full AWS S3 console parity — all 12 sections)                                                       |
| `packages/ui/server/inspect.ts` → `getBucket` | Fetches all S3 control-plane properties; each call safe-wrapped — MiniStack may return errors for unsupported APIs; UI renders AWS default label ("Disabled", "0 configurations") when undefined |
| `packages/ui/src/components/ui/detail.tsx`    | Shared `Section` + `Row` components for all service detail tabs                                                                                                                                  |

## UI conventions

- **Sidebar is flat** — no nested resource dropdown; each service row shows a count badge; click navigates to the table list view for that service
- **S3 Properties** mirrors AWS console order (overview → versioning → tags → encryption → intelligent-tiering → logging → notifications → EventBridge → acceleration → object lock → requester pays → website → permissions/policy)

## Conventions

- No CloudFormation/state file — idempotent SDK calls
- No raw `@aws-sdk` in handler code — always via `@slsv/sdk`
- SQL: postgres/mysql provisioned via the RDS API (init_sql runs once on first creation); `external` = BYO driver/ORM with URL from env
- Mark deliberate shortcuts with `// ponytail:` comment + ceiling + upgrade path
- esbuild bundles to CJS, `external: ['@aws-sdk/*']` (provided by Lambda runtime)
