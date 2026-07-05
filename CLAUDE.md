# slsv — simple local-AWS serverless framework

One `slsv.yml` describes the whole app. `slsv dev` brings the entire stack up on Floci. Later, `slsv deploy --target aws` hits real AWS — no handler rewrites.

## Publishing (release)

Two packages ship to npm: `@slsv/sdk` (scope `@slsv` — npm org owned by `vincent.ri`) and
`slsv` (CLI). They're **version-locked** (changesets `fixed`) — always released together at
the same version. Managed by **changesets**:

```
pnpm changeset          # describe a change, pick bump (patch/minor/major)
pnpm version-packages   # apply: bumps both package.jsons + changelogs
pnpm release            # pnpm build && changeset publish
```

`changeset publish` publishes in dependency order and rewrites the CLI's
`@slsv/sdk: workspace:*` → the real version (never `npm publish` — it ships a literal
`workspace:*`). Versions are immutable: every release needs a new number (changesets handles
it). `access: public` is set (scoped package). The `init.ts` SDK fallback is **auto-synced** —
`tsup.config.ts` inlines `packages/sdk/package.json` version as `__SDK_VERSION__`, so a bump
propagates to scaffolds with no manual edit. From a source checkout, `sdkDependency()` still
writes a `file:` link to local `packages/sdk` instead.

## Hard rule: every resource runs in Floci

slsv provisions ALL resources through their native AWS API against Floci
(localhost:4566) — no sibling containers, no sidecars, no bypass. Lambda, Dynamo,
SQS, S3, EventBridge, Secrets, IAM, Logs via their SDK APIs; Valkey via the
ElastiCache API; Postgres + MySQL via the RDS API. Anything declared in slsv.yml
MUST be creatable, describable, and deletable through the AWS SDK pointed at
Floci. If a new resource type can't be driven through Floci's API, that's
a blocker — do NOT wire it as a sidecar container. The CLI must always run
end-to-end against Floci alone.

## What this is NOT

- Not a Lambda-only tool (full multi-service support: HTTP, SQS, EventBridge, DynamoDB, S3, Secrets, CloudWatch, Valkey, Postgres, MySQL)
- Not a CloudFormation/SAM/SST wrapper — direct AWS SDK v3, idempotent get-or-create
- Not an AWS emulator — **Floci** (`flociorg/floci`) owns that; slsv is the orchestration + DX layer. Same port 4566 as LocalStack. Health = `GET /`; global reset = `POST /_floci/reset`

## Monorepo (pnpm workspaces)

```
packages/cli/    # name: "slsv"       — CLI tool (commander), deployer, bundler, dev loop
packages/sdk/    # name: "@slsv/sdk"  — cloud-agnostic handler SDK (db/queue/storage/cache/secret)
# packages/ui/   — PLANNED, NOT IN REPO. React dashboard + `slsv ui` command do not exist yet.
packages/cli/templates/demo/         — canonical reference app (scaffolded by `slsv init --demo`)
```

Only `packages/cli` and `packages/sdk` exist today. Anything below describing `packages/ui/`,
`slsv ui`, or an "inspector"/dashboard is aspirational until that package lands.

**Build:** `pnpm build` (all), `pnpm --filter slsv build`, `pnpm --filter @slsv/sdk build`
**Lint:** `pnpm lint` or per-package `pnpm --filter slsv lint`
**Test:** `pnpm test`
**Dev CLI:** `pnpm --filter slsv dev` (tsx watch), or `pnpm --filter slsv build:link` to re-link

## Phase 1 services (locked)

Lambda · API Gateway · SQS · EventBridge · DynamoDB · S3 · Secrets Manager · IAM exec role · CloudWatch Logs · Valkey (ElastiCache API, `type: redis|valkey`) · Postgres + MySQL (RDS API)

## Key architecture decisions

### Provider abstraction

`packages/cli/src/providers/types.ts` — `Provider` interface. `AwsProvider` is the only impl today. GCP later = new impl, zero user change.

### Cloud portability boundary = env vars

slsv injects `DATABASE_<NAME>`, `QUEUE_<NAME>`, `BUCKET_<NAME>`, `REDIS_<NAME>` into every function at deploy time. Handler code resolves by logical name, never by ARN/URL directly.

### @slsv/sdk

Handlers import `@slsv/sdk`, never raw `@aws-sdk/*`. `db('invoices')` → resolves `DATABASE_INVOICES` env → DynamoDBDocumentClient (or SQL connection). Same for `queue()`, `storage()`, `cache()`. Provider selected via `SLSV_PROVIDER` env (injected by CLI at deploy, default `aws`).

### Multi-store (multiple instances of same type)

Each store block is a map. `caches: { session: ..., ratelimit: ... }` → `REDIS_SESSION` and `REDIS_RATELIMIT` → `cache('session')` vs `cache('ratelimit')` are isolated. Works the same for databases/queues/buckets/caches.

### Caches locally

One ElastiCache Redis/Valkey **replication group** per `caches.<name>`, provisioned via `CreateReplicationGroup` against Floci (`redis.ts`). NOT `CreateCacheCluster` — that only supports memcached; Redis/Valkey requires the replication-group API. `CreateReplicationGroup` passes `TransitEncryptionEnabled: false` (real AWS requires it explicit; keeps the plain `redis://` string valid). Teardown uses `DeleteReplicationGroup`.

Endpoint resolution splits by target (`ensureCacheClusters(..., local)`):
- **`--target aws`** — read from `DescribeReplicationGroups` → `ConfigurationEndpoint`, fallback `NodeGroups[0].PrimaryEndpoint` (`extractEndpoint`). Provisions **asynchronously (~5-10 min)** — endpoint isn't populated until `available`, so `redis.ts` polls (`waitForCacheEndpoint`) before reading it.
- **`--target local`** — ponytail bridge for two Floci ElastiCache-emulation defects: (1) its API returns an **unreachable `localhost:6379`** for every group and doesn't publish the valkey port to the host, so `ensureLocalCache` reads the valkey container's floci-network IP (`192.168.107.x`) via `docker inspect floci-valkey-<app>-<stage>-<name>` and injects `redis://<ip>:6379` — same reachability model RDS gets for free; (2) its group **registry desyncs from container lifecycle** (a group reads `available` with no container behind it, e.g. after a Floci restart → recreate-every-run + orphans). The `docker inspect` doubles as the liveness check: no container IP ⇒ stale group ⇒ `DeleteReplicationGroup` + recreate so Floci respawns it. Ceiling: assumes Docker CLI + `floci-valkey-<id>` naming; remove the whole local branch once Floci returns the container IP in `ConfigurationEndpoint` like RDS does. (Filed against Floci: endpoint should be the container IP; registry should track container lifecycle.)

### Databases locally

Three database types, each driven through its native API against Floci:

- **dynamodb** — `CreateTable` against Floci's DynamoDB API (unchanged).
- **postgres / mysql** — one RDS DB instance per `databases.<name>`, provisioned via `CreateDBInstance`. Floci assigns slsv-local network IPs (e.g. `192.168.107.x`) that are reachable from BOTH the host (UI inspector) and Lambda inside floci — no host override needed. `init_sql` runs once on first creation (when `CreateDBInstance` succeeds, not on `AlreadyExists`), mirroring docker-entrypoint-initdb.d semantics. Master creds are fixed local-dev defaults (`postgres`/`postgres` for postgres; `admin`/`adminadmin` for mysql — NOT `root`, which conflicts with mysql's built-in root@localhost). **Liveness/recreate (`--target local` only, `isDbAlive`):** same Floci registry-desync as caches — an instance can read `available` after a Floci restart that killed its container, so the endpoint resolves but the DB is dead. Because **Floci fronts the RDS port itself** (a bare TCP connect succeeds even with no container behind it), the check is a real protocol handshake (`SELECT 1` via the same `pg`/`mysql2` clients), NOT a socket probe; on failure `redis.ts`-style delete + recreate respawns the container and re-runs `init_sql` (fresh DB). AWS is never touched — a real `available` instance is reachable, and handshaking it from the CLI host would false-negative through the VPC and rebuild a live prod DB. Remove once Floci keeps its RDS registry in sync with container lifecycle.

For a DB slsv doesn't host (Supabase, Neon, self-managed RDS), there is no `databases` type — put the connection string in `secrets:` (it's a password) and connect with your own driver, reading it at runtime: `const url = await secret('DATABASE_URL')`. No provisioning.

### AWS_ENDPOINT_URL

Injected into functions **only** for `--target local`. For `--target aws` it is omitted so the SDK uses real endpoints. **A Lambda runs inside the Floci container**, where `localhost` is the container itself — so the injected value is `http://host.docker.internal:4566` (`LAMBDA_LOCAL_ENDPOINT` in `index.ts`), NOT `localhost:4566` (which the CLI's own host-side clients use). Same reason, injected resource URLs (e.g. a `QUEUE_<NAME>` QueueUrl that Floci returns with a `localhost` host) are rewritten `localhost:4566` → `host.docker.internal:4566` before deploy, because the SQS SDK dials the QueueUrl's host directly and ignores `AWS_ENDPOINT_URL`.

### Secrets (runtime fetch — never baked into env)

`ensureSecrets` (`providers/aws/secrets.ts`) upserts each `secrets:` value into Secrets
Manager as `<app>-<stage>-<NAME>` (`.env.<stage>` is the source of truth) and injects **only
the SM id** as `SECRET_<NAME>` — the plaintext value never touches the Lambda env. Handlers
read it at runtime: `const s = await secret('NAME')` (`@slsv/sdk`), which resolves
`SECRET_<NAME>` → `GetSecretValue` (Floci locally, real SM in prod via `AWS_ENDPOINT_URL`)
→ cached per container (`providers/aws/secret.ts`). ponytail: cache has no TTL, so a rotated
secret is picked up on the next cold start.

### Stages (`--stage`, default `dev`)

Every command takes `--stage <name>` (`dev`/`deploy`/`logs`/`destroy`). Stage namespaces
**all** resources: names become `<app>-<stage>-<name>` (e.g. `myapp-prod-api`), so dev and
prod stacks coexist in one account. Single derivation point: `deploy.ts` builds
`prefix = ${app}-${stage}` and passes it as the `appName` every provider already used — the
provider files are stage-agnostic. Secrets follow suit (SM secret id `<prefix>-<NAME>`).
Per-stage secret values load from `.env.<stage>` (falls back to `.env`; stage file wins
since dotenv never overwrites).
`SLSV_STAGE` is injected into every function. Stage name must match `^[a-z0-9-]+$`.
(UI inspector still reads unprefixed names — TODO when UI gets stage-aware.)

**Per-stage overrides (`stages:` overlay):** optional top-level `stages: { <name>: {...} }`.
`loadConfig(cwd, stage)` (`config.ts`) deep-merges `stages[stage]` over the base, then
validates the merged result — the `stages` key is stripped before validation, so no schema
entry is needed. Merge rules (`deepMerge`): objects merge recursively, scalars/arrays
replace, and `key: null` **removes** a base key (enables trigger swaps, e.g. `queue: null`
+ `event: {...}` so dev uses EventBridge while prod keeps SQS). Base config is the `dev`
default; override only what differs. Covered by `config.test.ts`.

### Reconcile / orphan prune

Every deploy ends with `provider.reconcile(cfg, stage)` (`index.ts`) so removing a resource
from `slsv.yml` actually tears it down — keeps the manifest the source of truth. Safety
split: **Lambda functions + EventBridge rules are auto-pruned** (stateless, exact-named
`<app>-<stage>-<fn>` / `<app>-<stage>-<fn>-evt`, the common rename/remove case — a dropped
cron/event trigger would otherwise leave its rule firing, which is wrong behavior, not
cosmetic). **Data stores (DynamoDB / S3 / RDS) are report-only** — an orphan table/bucket/db
is warned about, never silently deleted (would lose data); use `slsv destroy` to remove
intentionally. All `List*` calls are drained via the `paginate()` helper (`index.ts`), so
prune is correct past one page. ponytail ceilings: dangling API-GW integrations / SQS
event-source-mappings / log groups of a pruned function are left (inert, harmless) — not
yet swept.

### IAM exec role

`ensureExecRole` (`iam.ts`) creates ONE role per app+stage: `<app>-<stage>-exec`. It attaches
`AWSLambdaBasicExecutionRole` (logs) **and** an inline `slsv-data` policy granting
dynamodb/sqs/s3/secretsmanager/events actions **scoped to `<app>-<stage>-*` resource ARNs** —
so a function can only touch its own app+stage's resources. (Before: a single global
logs-only role — functions were denied all data access on real AWS; it only "worked" because
Floci ignores IAM.) `deleteExecRole` tears it down on `slsv destroy`. ponytail: app+stage
scope, not per-function — slsv injects every binding into every function, so there's no
per-function resource list; true per-fn least-priv needs a `uses:` declaration in slsv.yml.

### Tagging

Every provisioned resource is tagged (`tags.ts` → `slsvTags`): `slsv:managed-by=slsv`,
`slsv:app=<app>`, `slsv:stage=<stage>`, plus any user `tags: {}` from slsv.yml (slsv: keys
win — user can't clobber them). Tags build once in `deploy.ts`, stored on the `AwsProvider`
in `setup()` (runs before all provisioning), passed to each provisioner. Applied on
**create** (redeploy doesn't re-tag — ponytail; add Tag* calls if drift matters). Shapes
differ: Lambda/SQS take a `{k:v}` map, everything else `[{Key,Value}]` (`asTagArray`); S3
create has no Tags param so buckets tag via a separate `PutBucketTagging` call. Per-stage tag
overrides work via the `stages:` overlay for free.

### Frontend → API wiring

On `--target aws` the frontend (S3 static site) and API (API Gateway) are different origins,
so the frontend can't use relative `/api/*` (that hits S3). slsv **auto-injects the deployed
API Gateway URL** into the frontend build as `VITE_SLSV_API_URL` (`runBuild` sets it in the
build env; `apiUrl` threaded `deploy.ts → deployFrontend → runBuild`). The scaffolded
frontend resolves its API base as `VITE_API_URL || VITE_SLSV_API_URL || ''` (`frontend/src/
api.ts` helper): a **user-set `VITE_API_URL` wins** (custom domain), else slsv's injected URL,
else `''` = relative (local `slsv dev` proxies `/api` → backend). The HTTP API gets a
permissive **CORS** config (`apigw.ts`, `AllowOrigins/Methods/Headers: ['*']`) so the S3
origin can call it. Existing hand-written frontends must adopt the same `api()` base to work
on aws. Opt in to `frontend.cloudfront: true` for the single-domain HTTPS upgrade (below) —
without it this two-domain + CORS + HTTP-only setup is what runs.

### CloudFront (`frontend.cloudfront: true`, aws-only)

S3 static-website endpoints are HTTP-only by design (the HTTPS REST endpoint doesn't support
index.html/SPA fallback), so opting in provisions one CloudFront distribution with two origins:
S3 website endpoint (custom origin, HTTP to origin) for `/*`, and the API Gateway domain for
`/api/*` (caching disabled, all methods, forwards query/headers/cookies via legacy
`ForwardedValues`). `CustomErrorResponses` (403/404 → `/index.html`, 200) handle SPA routing.
Because `/api/*` becomes same-origin under the CloudFront domain, `deployFrontendAws` skips the
`VITE_SLSV_API_URL` injection in this mode (relative `/api` just works — no CORS needed either).
Idempotent via `ListDistributions` + find-by-`Comment` (`slsv:<appName>`), no id tracked.
Returns `https://<domain>.cloudfront.net`. ponytail: default CloudFront domain only (custom
domain needs an ACM cert in us-east-1 + `Aliases` + DNS — separate feature); public S3 bucket
kept (not OAC-private) since it's the existing setup. Deploy and destroy each take ~15-20 min
(CloudFront config propagation) — `destroy` disables the distribution, waits for it to reach
`Deployed`, then deletes it (`providers/aws/frontend.ts`: `ensureDistribution`/
`destroyDistribution`). CloudFront's client always targets `us-east-1` (global service),
regardless of the app's deploy region (`clients.ts`).

### slsv status

`slsv status [--stage] [--target local|aws]` (`AwsProvider.status`) lists what's actually
deployed for `<app>-<stage>` — functions/tables/queues/buckets/databases/caches, grouped
with counts. Read-only; reuses `paginate()` + the `<app>-<stage>-` prefix filter.

`slsv destroy [--stage] [--target local|aws]` tears the stack down — including the HTTP API
(`deleteHttpApi`, cascades its routes/integrations/stages), the per-app+stage IAM role, and
the **frontend hosting bucket** (`<app>-<stage>-frontend`, created by deployFrontend not
declared under `buckets:` — so destroy adds it explicitly). RDS delete uses
`SkipFinalSnapshot` (per-db `skipFinalSnapshot`, default true — no snapshot).
**`--target` matters:** without it (default `local`) destroy hits Floci — so after a real
deploy you MUST `slsv destroy --target aws`, or the real (billable) RDS/ElastiCache keep
running. Only `--target local` stops the emulator afterward. **Idempotent:** every delete
swallows "already gone" via one pattern (`/(NotFound|NoSuch|DoesNotExist|NonExistent)/i`) —
services name their not-found errors differently (`ResourceNotFoundException`, `NoSuchBucket`,
`QueueDoesNotExist`, `ReplicationGroupNotFoundFault`, ...), so a partial or re-run destroy
never fails.

**One API Gateway per stage** (named `<app>-<stage>`), NOT one shared API split by internal
stages — keeps each stage's API fully isolated like every other resource (deploying prod
can't touch dev's routes; no stage-variable routing). ARNs (API-GW invoke permission,
EventBridge rule permission) derive region+account from the **function ARN**, never
hardcoded — a hardcoded `us-east-1:000000000000` only matches Floci and 500s on real AWS.

### Provisioned concurrency (warm Lambdas)

`provisionedConcurrency: N` keeps N instances warm (no cold start). **`--target aws` only** —
skipped on Floci (no real cold starts; same stance as cache `nodeType`). It can't attach to
`$LATEST`, so `deployFunctions` (aws path only): waits for the code update to settle,
`PublishVersion`, points a `live` alias at it, `PutProvisionedConcurrencyConfig` on the
alias, sets `fnOutput.arn` to the alias ARN so every trigger (apigw/ESM/EventBridge) wires
to the warm alias, then GCs old published versions. Opt-in per function — the only branch is
inside `deployFunctions`; non-provisioned functions stay on `$LATEST` unchanged. `destroy`
needs nothing extra — `DeleteFunction` cascades versions/aliases/config. ponytail: warms in
the background (deploy returns before it's `Ready`); GC keeps only the live version.

### Function triggers

`http` · `queue` (SQS) · `cron` (EventBridge schedule) · `event` (EventBridge event-pattern
— `event: { pattern: {...} }`, default bus, invokes on match). `cron` and `event` are wired
together in `eventbridge.ts` (`ensureCronTriggers` + `ensureEventTriggers`), rule names
`<app>-<stage>-<fn>` and `<app>-<stage>-<fn>-evt`. Reconcile sweeps both: a rule whose
trigger (or whole function) was removed from the yml is pruned (targets cleared first —
AWS refuses DeleteRule while targets exist). Sending events (to test) is app side:
PutEvents via SDK/CLI onto the default bus.

## slsv.yml schema (key blocks)

```yaml
app: my-app
functions:
  api:
    runtime: nodejs20 # only runtime in phase 1
    handler: ./src/api.handler # file.export
    http: [{ method, path }] # OR queue: { name } OR cron: { schedule } OR event: { pattern }
    timeout?: 30 # secs, 1-900 (default 30)
    memory?: 256 # MB, 128-10240 (default 256)
    architecture?: arm64 # arm64 (default) | x86_64; set at create only (immutable)
    ephemeralStorage?: 512 # /tmp MB, 512-10240 (default 512)
    tracing?: true # X-Ray active tracing (adds xray perms to exec role)
    reservedConcurrency?: 10 # PutFunctionConcurrency (separate call); 0 throttles all
    provisionedConcurrency?: 2 # warm instances (--target aws only); publishes a version + `live` alias, triggers point at the alias
    environment?: { KEY: value } # custom env; slsv bindings (DATABASE_*, etc) always win
queues: { name: { type: sqs, fifo?: bool, visibilityTimeout?: secs, dlq?: name } }
buckets: {
  name: {}
  # or:
  #   publicRead: true    # browser reads objects via bucket URL (s3:GetObject policy + blocks disabled)
  #   cors: [origin, ...] # browser PUT/GET cross-origin (presigned URLs); pair with publicRead when allowing GET
}
databases: { name: { type: dynamodb|postgres|mysql, ... } } # dynamodb: partitionKey, sortKey?, gsi? — postgres/mysql: instanceClass?, storage?, multiAz?, name?, init_sql?, skipFinalSnapshot? (default true — destroy takes no snapshot). All provisioned via their APIs. Hosted/BYO DB → put its URL in secrets:, not here
caches: { name: { type: redis|valkey, nodeType?, nodes? } } # both types provision valkey under the hood; knobs apply on --target aws
secrets: [ENV_VAR_NAME]
tags: { KEY: value } # optional; custom tags added to every resource (on top of slsv:* tags)
logRetentionDays: 14 # optional; CloudWatch log retention (default 14, 0 = never). Must be a CloudWatch-allowed value; applied every deploy
stages: { <name>: { <partial-config> } } # optional; deep-merged over base for --stage <name> (null removes a key)
```

## Templates (slsv init)

- `slsv init` → interactive prompt (@clack/prompts) → **minimal** template (1 HTTP fn + 1 table)
- `slsv init <name>` → skip prompt
- `slsv init --demo` → full demo (HTTP + webhook + SQS job + cron)
- Demo template uses `paymentWebhook` (x-webhook-secret header, no Stripe). `.env.example` works as-is.
- `slsv init --yes` → headless/CI (name = folder name)

**SDK dependency in scaffolds:** both templates set `@slsv/sdk` via `sdkDependency(dir)` in
`init.ts` — a `file:` link to the local `packages/sdk` when scaffolding from a source
checkout (dev), else `^0.1.0`. ⚠️ **`@slsv/sdk` is NOT published to npm yet** — so a
scaffold made by a *published* CLI (falling back to `^0.1.0`) will fail `npm install` with a
404. Publishing `@slsv/sdk` is a hard release prerequisite. (Bundling still inlines the SDK
into the Lambda, but the app's `npm install`/typecheck needs the dep resolvable.)

## Critical files

| File                                          | Purpose                                                                                                                                                                                          |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/cli/src/config.ts`                  | zod schema for slsv.yml                                                                                                                                                                          |
| `packages/cli/src/providers/types.ts`         | Provider interface                                                                                                                                                                               |
| `packages/cli/src/providers/aws/index.ts`     | AwsProvider impl                                                                                                                                                                                 |
| `packages/cli/src/providers/aws/index.ts` | Floci endpoint health check                                                                                                                                                                 |
| `packages/cli/src/providers/aws/functions.ts` | esbuild bundle → zip → Lambda deploy                                                                                                                                                             |
| `packages/cli/src/deploy.ts`                  | orchestration order                                                                                                                                                                              |
| `packages/cli/src/init.ts`                    | scaffold templates (minimal + demo)                                                                                                                                                              |
| `packages/cli/src/env-key.ts`                 | shared env var name util (`DATABASE_FOO`, `QUEUE_BAR`, etc.)                                                                                                                                        |
| `packages/cli/src/providers/aws/iam.ts`       | `ensureExecRole`/`deleteExecRole` — per-app+stage role + scoped inline `slsv-data` policy                                                                                                        |
| `packages/cli/src/providers/aws/secrets.ts`   | `ensureSecrets` — upsert to Secrets Manager, inject `SECRET_<NAME>=<id>` (never the value)                                                                                                       |
| `packages/sdk/src/index.ts`                   | db/queue/storage/cache/secret exports                                                                                                                                                                   |
| `packages/sdk/src/resolve.ts`                 | logical name → env var                                                                                                                                                                           |

## Conventions

- No CloudFormation/state file — idempotent SDK calls
- No raw `@aws-sdk` in handler code — always via `@slsv/sdk`
- SQL: postgres/mysql provisioned via the RDS API (init_sql runs once on first creation); hosted/BYO DB → connection string in `secrets:`, connect with your own driver/ORM
- Mark deliberate shortcuts with `// ponytail:` comment + ceiling + upgrade path
- esbuild bundles handlers to CJS with `bundle: true` and NO externals — `@slsv/sdk` AND `@aws-sdk/*` are inlined into one self-contained `handler.js` (the Floci/Lambda base image doesn't ship `lib-dynamodb`, so bundling everything is deliberate: bigger zip, always works). `@slsv/sdk` is never published/deployed separately; the `file:` link is bundle-time only.
