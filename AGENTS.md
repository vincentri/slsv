<!-- headroom:rtk-instructions -->

# RTK (Rust Token Killer) - Token-Optimized Commands

When running shell commands, **always prefix with `rtk`**. This reduces context
usage by 60-90% with zero behavior change. If rtk has no filter for a command,
it passes through unchanged — so it is always safe to use.

## Key Commands

```bash
# Git (59-80% savings)
rtk git status          rtk git diff            rtk git log

# Files & Search (60-75% savings)
rtk ls <path>           rtk read <file>         rtk grep <pattern>
rtk find <pattern>      rtk diff <file>

# Test (90-99% savings) — shows failures only
rtk pytest tests/       rtk cargo test          rtk test <cmd>

# Build & Lint (80-90% savings) — shows errors only
rtk tsc                 rtk lint                rtk cargo build
rtk prettier --check    rtk mypy                rtk ruff check

# Analysis (70-90% savings)
rtk err <cmd>           rtk log <file>          rtk json <file>
rtk summary <cmd>       rtk deps                rtk env

# GitHub (26-87% savings)
rtk gh pr view <n>      rtk gh run list         rtk gh issue list

# Infrastructure (85% savings)
rtk docker ps           rtk kubectl get         rtk docker logs <c>

# Package managers (70-90% savings)
rtk pip list            rtk pnpm install        rtk npm run <script>
```

## Rules

- In command chains, prefix each segment: `rtk git add . && rtk git commit -m "msg"`
- For debugging, use raw command without rtk prefix
- `rtk proxy <cmd>` runs command without filtering but tracks usage
- **Never delete examples** (demo templates, `slsv.example.yml`, scaffold templates, reference apps). They are documentation, not dead code. Add a `ponytail:` deprecation comment instead of deletion.
- **Every schema change syncs to `slsv.example.yml`.** Adding, renaming, removing, or changing a field in `config.ts` (zod schema) MUST update `packages/cli/templates/slsv.example.yml` in the same change — show the new knob, its default, and a one-line note. The reference is the contract; drifting it = silent trap for the next person.

<!-- /headroom:rtk-instructions -->

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

When the user types `/graphify`, use the installed graphify skill or instructions before doing anything else.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- Dirty graphify-out/ files are expected after hooks or incremental updates; dirty graph files are not a reason to skip graphify. Only skip graphify if the task is about stale or incorrect graph output, or the user explicitly says not to use it.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).

---

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

**Build:** `pnpm build` (all), `pnpm --filter @slsv/cli build`, `pnpm --filter @slsv/sdk build`
**Lint:** `pnpm lint` or per-package `pnpm --filter @slsv/cli lint`
**Test:** `pnpm test`
**Dev CLI:** `pnpm --filter @slsv/cli dev` (tsx watch), or `pnpm --filter @slsv/cli build:link` to re-link

## Phase 1 services (locked)

Lambda · API Gateway · SQS · EventBridge · DynamoDB · S3 · Secrets Manager · IAM exec role · CloudWatch Logs · Valkey (ElastiCache API, `type: redis|valkey`) · Postgres + MySQL (RDS API)

## Key architecture decisions

### Cloud portability boundary = env vars

slsv injects `DATABASE_<NAME>`, `QUEUE_<NAME>`, `BUCKET_<NAME>`, `REDIS_<NAME>` into every function at deploy time. Handler code resolves by logical name, never by ARN/URL directly.

### @slsv/sdk

Handlers import `@slsv/sdk`, never raw `@aws-sdk/*`. `db('invoices')` → resolves `DATABASE_INVOICES` env → DynamoDBDocumentClient. Same for `queue()`, `storage()`, `cache()`. `queue().send(body, { delaySeconds })` maps to the SQS `DelaySeconds` (0-900); ponytail: standard queues only — FIFO rejects per-message delay (set it on the queue).

**HTTP layer (`sdk/src/api.ts`)** — a zero-dep mini-framework so handlers don't pull Hono/Nest:
`router(routes, middleware?)` dispatches Lambda events (parses BOTH APIGW v1 `httpMethod`/`path`
and v2 `requestContext.http` shapes) → `request()` builds a normalized `ApiRequest` (lowercased
headers, query, path params `{id}` + greedy `{id+}`, JSON body); `json()`/`redirect()` build
responses. Errors: bad JSON → 400, uncaught → 500, no match → 404. **Middleware** is onion-model
(`Middleware = (req, next) => ApiResponse`): call `next()` to continue, or return a response to
short-circuit (auth guard: `req.headers.authorization ? next() : json(…,401)`). Global chain via
`router(routes, [mw])` + per-route `route.middleware`, run global→route→handler→unwind
(`compose()`; guards double-`next()`). Runs only for a MATCHED route — a 404 never enters the
chain. ponytail: `request()` parses body eagerly, so bad JSON → 400 before middleware sees it
(auth can't run auth-before-parse yet). Gaps vs Hono, add when hit: route groups/basePath,
non-JSON body (form/multipart), zod validation hook, cookies. Tested in `api.test.ts`.

**DynamoDB and SQL are different data models, so different accessors.** `db(name)` is the
DynamoDB KV client (get/put/query-by-partition — `DbClient` in `types.ts`). SQL databases
(`type: postgres|mysql`) use **`sql(name, { schema? })`** (`providers/aws/sql.ts` →
`makeSql`), which resolves the same `DATABASE_<NAME>` env — the CLI injects a `postgres://`
/ `mysql://` **connection string** there for RDS dbs (vs a table name for dynamo) — sniffs
the dialect from the URL scheme, and returns a **Drizzle** client (pg/`node-postgres` or
`mysql2`), cached per container like `secret()`. Pass `{ schema }` (your drizzle table
defs) for the typed relational API (`db.query.*`, typed inserts); omit it and the query
builder (`db.select().from(t)`) + raw SQL (`db.execute(sql\`…\`)`, or drop to the pool via
`db.$client`) still work. **No migrations** — `init_sql` owns the DDL; a drizzle `schema.ts`
is the optional typed *mirror* of those tables, kept in sync by hand. Drizzle not Prisma:
pure TS, bundles into the single `handler.js` (Prisma's query-engine binary would break
esbuild's no-externals model). ponytail: both dialect drivers (`pg`+`mysql2`) bundled into
every handler; return typed as `NodePgDatabase` for one signature (mysql structurally
compatible for the query surface). Hosted/BYO SQL (Supabase/Neon) still has no `databases`
type — conn string in `secrets:`, wire Drizzle yourself over `secret()`. Demo shows both
styles: `backend/jobs/track-click.ts` (typed, `{ schema }`) and `daily-report.ts` (raw via
`$client`).

### Multi-store (multiple instances of same type)

Each store block is a map. `caches: { session: ..., ratelimit: ... }` → `REDIS_SESSION` and `REDIS_RATELIMIT` → `cache('session')` vs `cache('ratelimit')` are isolated. Works the same for databases/queues/buckets/caches.

### Caches locally

One ElastiCache Redis/Valkey **replication group** per `caches.<name>`, provisioned via `CreateReplicationGroup` against Floci (`redis.ts`). NOT `CreateCacheCluster` — that only supports memcached; Redis/Valkey requires the replication-group API. `CreateReplicationGroup` passes `TransitEncryptionEnabled: false` (real AWS requires it explicit; keeps the plain `redis://` string valid). Teardown uses `DeleteReplicationGroup`.

**Serverless mode (`caches.<name>.serverless: true`, aws-only):** opts into ElastiCache
Serverless (`CreateServerlessCache` / `DescribeServerlessCaches` / teardown
`DeleteServerlessCache`) instead of a node group — auto-scales, pay-per-use, no `nodeType`/
`nodes`. **`--target local` ignores it**: the local branch (`ensureLocalCache`) runs _before_
the serverless check and `continue`s, so a serverless-flagged cache runs as a node group on
Floci — because Floci doesn't implement `CreateServerlessCache` (verified: returns
`UnsupportedOperation`). Same skip-on-local stance as `provisionedConcurrency`/`nodeType`.
Serverless is **TLS-only** (AWS forces transit encryption), so `ensureServerlessCache` returns
a `rediss://` endpoint (vs the node path's plain `redis://`); the SDK's ioredis client enables
TLS from the `rediss://` scheme with no change. Provisions asynchronously (~minutes) —
`waitForServerlessEndpoint` polls until the endpoint populates, mirroring the node path's
`waitForCacheEndpoint`. Destroy branches on `this.target === 'aws' && serverless` (local always
`DeleteReplicationGroup`). ponytail: `slsv status` still lists caches via
`DescribeReplicationGroups`, so serverless caches won't show there yet — add a
`DescribeServerlessCaches` pass when status needs it. Remove the whole local-node-group
fallback for serverless caches once Floci implements the serverless API.

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

### Stages (`--stage`; `slsv dev` defaults `local`, everything else `dev`)

**`slsv dev` defaults to stage `local`** (local Floci stack) — deliberately distinct from a
real server `dev` stack (`slsv deploy --stage dev`) so the two never share resource names
(`<app>-local-*` vs `<app>-dev-*`). All other commands (`deploy`/`plan`/`logs`/`destroy`)
default to `dev`. Every command takes `--stage <name>` to override. Stage namespaces
**all** resources: names become `<app>-<stage>-<name>` (e.g. `myapp-prod-api`), so dev and
prod stacks coexist in one account. Single derivation point: `deploy.ts` builds
`prefix = ${app}-${stage}` and passes it as the `appName` every provider already used — the
provider files are stage-agnostic. Secrets follow suit (SM secret id `<prefix>-<NAME>`).
Env/secret values load in precedence order (dotenv never overwrites an already-set key, so the
first load wins): **`.env.local`** (only on `--target local`, e.g. `slsv dev` — local-machine
overrides never sent to the cloud, git-ignored; mirrors Vite/Next) → **`.env.<stage>`** →
**`.env`**. `provider.target` gates the `.env.local` load in `deploy.ts` (shared by dev+deploy).
`SLSV_STAGE` is injected into every function. Stage name must match `^[a-z0-9-]+$`.
(UI inspector still reads unprefixed names — TODO when UI gets stage-aware.)

**Per-stage overrides (`stages:` overlay):** optional top-level `stages: { <name>: {...} }`.
`loadConfig(cwd, stage)` (`config.ts`) deep-merges `stages[stage]` over the base, then
validates the merged result — the `stages` key is stripped before validation, so no schema
entry is needed. Merge rules (`deepMerge`): objects merge recursively, scalars/arrays
replace, and `key: null` **removes** a base key (enables trigger swaps, e.g. `queue: null`

- `event: {...}` so dev uses EventBridge while prod keeps SQS). Base config is the `dev`
  default; override only what differs. Covered by `config.test.ts`.

### Reconcile / orphan prune

Every deploy ends with `provider.reconcile(cfg, stage)` (`index.ts`) so removing a resource
from `slsv.yml` actually tears it down — keeps the manifest the source of truth. Safety
split: **Lambda functions + EventBridge rules are auto-pruned** (stateless, exact-named
`<app>-<stage>-<fn>` / `<app>-<stage>-<fn>-evt`, the common rename/remove case — a dropped
cron/event trigger would otherwise leave its rule firing, which is wrong behavior, not
cosmetic). **Data stores (DynamoDB / S3 buckets / RDS) are report-only by default** (`autoRemove`,
top-level, default **false** — safe-for-prod: dropping a store from the yml can't silently take
its data with it). An orphan table/bucket/db is warned and left until `slsv destroy`. Set
**`autoRemove: true`** (opt-in, destructive) to DELETE such orphans on the next deploy (via
`handleOrphan` → `DeleteTableCommand` / `emptyAndDeleteBucket` / `DeleteDBInstanceCommand` with
`SkipFinalSnapshot`) so the manifest becomes the full source of truth — the store takes its data
with it. (SQS queues, secrets, and caches are **never** pruned by reconcile at all — only
`slsv destroy` removes them; `slsv plan` reports them as `orphan`.)
RDS orphan delete always skips the final snapshot (the removed yml no longer carries
`skipFinalSnapshot`). **Exception — the frontend (S3 hosting bucket `<app>-<stage>-frontend` +
CloudFront distribution) is auto-torn-down** when `frontend:` is dropped from the yml: it's a
slsv-managed BUILD ARTIFACT (created by deployFrontend, not declared under `buckets:`, holds
only the last build output, re-created every deploy), so it prunes like a stateless orphan,
NOT report-only — via `emptyAndDeleteBucket` (shared with destroy) + `destroyDistribution`
(idempotent by Comment; ~15-20 min but only on the one redeploy that removes frontend). While
a frontend IS configured, the bucket is excluded from the orphan scan. (Bug history: the
exclusion name was built as `${lcPrefix}-frontend` with a double dash — `bb-dev--frontend` vs
the real `bb-dev-frontend` — so the frontend bucket was warned as an orphan on every deploy;
`lcPrefix` already carries the trailing `-`.) All `List*` calls are drained via the
`paginate()` helper (`index.ts`), so
prune is correct past one page. **Pruned Lambda cleanup:** the `DeleteFunction` error is NOT
swallowed — an already-gone fn is a no-op, but a real failure (IAM denial, throttle, stuck fn)
is **surfaced** (`⚠ could not prune …`) and skipped, and `pruned function` only prints on
actual success (before: `.catch(() => {})` hid every failure yet still logged "pruned" — the
fn survived while the log claimed removal). The pruned fn's **log group is deleted** too (was
left before), and on `--target local` its **Floci container is swept** (`docker rm`, same
container-lifecycle desync destroy handles — else Floci keeps running the removed fn and a
pruned cron/queue trigger still fires). ponytail ceilings: dangling API-GW integrations / SQS
event-source-mappings of a pruned function are still left (inert, harmless) — not yet swept.

### Drift model & `slsv plan`

slsv keeps **no state file**, so drift is a **two-way** diff — desired (`slsv.yml`) vs actual
(AWS) — not Terraform's three-way (config vs recorded-state vs reality). yml is always the
source of truth; there's no "last-applied" to go stale. The contract:

- **In yml, not in AWS** → `create` on deploy (get-or-create).
- **In AWS, not in yml (orphan)** → Lambda always pruned (stateless); data stores (Dynamo/S3/
  RDS) `delete` only under `autoRemove: true` else reported (`orphan`); SQS/secrets/caches never
  pruned by deploy (`orphan`, remove via `slsv destroy`).
- **In both, config differs** → deploy **converges** *mutable* fields toward yml (already true
  for Lambda config via `UpdateFunctionConfiguration` and API CORS via `UpdateApiCommand`;
  SQS/S3/RDS/cache converge is a follow-up). *Immutable* fields (Lambda `architecture`, Dynamo
  partition/sort key, RDS engine, SQS `fifo`) can't update in place → reported as `replace`;
  deploy **never** silently destroys a stateful resource to change one (SQS `fifo` flips the
  queue name, so it surfaces as delete+create naturally).

`slsv plan` (`providers/aws/plan.ts`) is the **read-only** preview of all of the above — it
enumerates live AWS with the same `paginate()` + `List*`/`Describe*` calls reconcile uses, then
`classify()` (pure, unit-tested in `plan.test.ts`) buckets each resource into
`create`/`update`/`replace`/`delete`/`orphan`. `slsv deploy` runs it first and prints the diff;
on `--target aws` a **destructive** delete (data store under `autoRemove: true`) prompts a
confirm unless `--yes`. v1 field-diffs only what's cheap to read (Lambda memory/timeout/arch,
Dynamo keys, RDS class/storage/multiAz/engine); S3/SQS/cache are presence-only. **ponytail
follow-ups:** (1) widen deploy-side `Update*` coverage to SQS (`SetQueueAttributes`), S3
(`PutBucketPolicy`/`PutBucketCors`), RDS (`ModifyDBInstance`), cache
(`ModifyReplicationGroup`) — plan already *reports* this drift, auto-fix is the increment;
(2) switch destroy/prune from prefix-match to tag-match (`slsv:app`+`slsv:stage`, already
tagged) to close the `myapp-dev-` vs `myapp-dev-2-*` wrong-stack sweep; (3) a stage lock
(DynamoDB conditional-put) for concurrent-deploy races.

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
permissive **CORS** config (`apigw.ts` `buildCors`, `AllowOrigins/Methods/Headers: ['*']`) so
the S3 origin can call it. **`api.cors` in slsv.yml** locks it down, two shapes (normalized in
`buildCors`): an **array** of origins (`['https://myapp.com']`) overrides just `AllowOrigins`
(methods/headers stay `*`); an **object** `{ origins, methods?, headers?, credentials? }` gives
full control. **`credentials: true`** (needed for `fetch(url, { credentials: 'include' })` —
cookies / an Authorization header treated as a credential) sets `AllowCredentials: true`, but
the browser/AWS rule is that credentials are **incompatible with `*`** on origin, methods, AND
headers — so `buildCors` forces explicit origins (deploy **throws `ConfigError`** on
`origins:['*']` **or missing `origins`** + credentials) and swaps the `*` method/header defaults
for concrete lists (methods `GET,POST,PUT,PATCH,DELETE,OPTIONS`; headers
`content-type,authorization` — override either via the object). **`origins` is optional** so
shared cors (credentials/methods/headers/exposeHeaders) lives in the base config and each stage
adds only its own `origins` (the common pattern: base is invalid standalone, valid once a stage
overlays origins). The credentials+no-origins throw is **`--target aws` only** — on `slsv dev`
CORS is Floci/Quarkus-owned (the gateway config is ignored), so `buildCors(cors, isLocal)` skips
the throw and emits a permissive local config (no `AllowCredentials`, since `*`+credentials is
itself invalid) rather than blocking dev. Omit `api.cors` → `['*']` (the open default, needed for
the two-origin S3-frontend setup). Threaded `deploy.ts (cfg.api?.cors) → wireHttp → ensureApiGateway →
ensureHttpApi`. Unlike CloudFront (create-only), CORS is **drift-corrected every deploy** via
`UpdateApiCommand`, so changing `api.cors` takes effect on redeploy (verified on Floci: the
stored `CorsConfiguration` matches — `AllowCredentials:true` + the specific origin/methods/
headers). ponytail: **Floci doesn't emit `access-control-*` response headers at request time**
(a preflight OPTIONS returns 200 with no CORS headers), so browser CORS can't be exercised in
`slsv dev` — the config is correct and enforced on real AWS; verify the stored config, not the
response headers, locally. Existing hand-written
frontends must adopt the same `api()` base to work
on aws. Opt in to `frontend.cloudfront: true` for the single-domain HTTPS upgrade (below) —
without it this two-domain + CORS + HTTP-only setup is what runs.

### CloudFront (`frontend.cloudfront: true`, aws-only)

S3 static-website endpoints are HTTP-only by design (the HTTPS REST endpoint doesn't support
index.html/SPA fallback), so opting in provisions one CloudFront distribution with two origins:
S3 website endpoint (custom origin, HTTP to origin) for `/*`, and the API Gateway domain for
`/api/*` (all methods, AWS-managed policies `CachingDisabled` + **`AllViewerExceptHostHeader`** —
NOT legacy `ForwardedValues`/`Headers: ['*']`, which forwarded the viewer `Host` (the CloudFront
domain) to the HTTP API origin and made API Gateway **403** every `/api/*` request; the managed
policy forwards everything **except Host** so API GW sees its own `execute-api` host). Managed
policy IDs are global constants. `CustomErrorResponses` (403/404 → `/index.html`, 200) handle SPA
routing. ponytail: CloudFront is create-only (idempotent by `Comment`) — it does NOT update an
existing distribution, so a config fix like this needs `slsv destroy --target aws` + redeploy (or
a manual console edit) to take effect on already-deployed distributions.
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

### API custom domain (`api.domain`, aws-only)

Point a real domain (`api.myapp.com`) at the HTTP API, provisioned **end-to-end, zero manual
DNS** (`providers/aws/domain.ts`: `ensureApiDomain`/`destroyApiDomain`). User config is a single
field — `api.domain` — plus a `CLOUDFLARE_API_TOKEN` in env (Zone.DNS edit). Because the only
manual step in a custom domain is the DNS validation record, slsv writes DNS itself via the
provider's API — today **Cloudflare only** (`providers/aws/cloudflare.ts`, plain `fetch`, no SDK).
No zone field: `cfZoneIdForDomain` lists the token's zones and picks the one whose name is a suffix
of the domain (longest match — `api.myapp.com` → zone `myapp.com`). Flow on `--target aws`:
`RequestCertificate` (DNS-validated ACM cert) → auto-write the validation CNAME in Cloudflare →
poll `DescribeCertificate` to `ISSUED` (~1-5 min) → `CreateDomainName` (**REGIONAL**, `TLS_1_2`) →
`CreateApiMapping` onto the app's `$default` stage (with `ApiMappingKey = api.basePath`, undefined
= root) → upsert the public CNAME → the api-gw target
(`d-xxx.execute-api…`, DNS-only/unproxied). Idempotent throughout (reuse existing
cert/domain-name/mapping).

**Shared domain (`api.basePath`):** multiple separate slsv apps can share ONE `domain`, each
mounted under its own base path (`api.x.com/qualify`, `/auth`, `/tender`) — the mapping key, NOT
the route (API GW strips the base path, so every app keeps `path: /v1/{proxy+}`). Each app keeps
its own slsv.yml/gateway/lifecycle; deploy order is irrelevant (first app provisions the
domain+cert, the rest reuse by DomainName). Changing an app's `basePath` re-keys in place (delete
+ recreate the mapping). **Teardown is mapping-aware to avoid outaging siblings**
(`destroyApiDomain(..., appName)`): it deletes only THIS app's mapping, then — if any other app is
still mapped on the domain — **stops** (domain name, cert, and Cloudflare records are shared);
only the LAST app out does the full `DeleteDomainName` + cert + CF teardown. A single-app domain
(no `basePath`) is unchanged: its lone mapping deletes → 0 remaining → full teardown, exactly as
before. `sweepApiDomains` forwards `appName` so both destroy and the rename-prune are shared-safe.
ponytail: two apps deploying to a brand-new shared domain at the exact same instant race on
`CreateDomainName` (both see it absent) — the loser errors, rerun fixes; not worth a lock for a
manual multi-app deploy. The cert **must be in the API's deploy region** (regional endpoint) — so
`clients.acm` tracks the app region, NOT the us-east-1 CloudFront uses. `api.certArn` skips ACM
(reuse a pre-validated cert, e.g. a wildcard). Deploy wires it in `deploy.ts` after `wireHttp` and,
when set, **replaces `apiUrl`** so the frontend build gets the custom domain injected
(`VITE_SLSV_API_URL`). Skipped on `--target local` (Floci has no ACM/custom-domain API). Destroy is
**discovery-based** (like the rest of destroy): `sweepApiDomains` enumerates every API-GW domain
mapped to this app's API and tears each down, so a domain **already dropped from the yml is still
removed** (previously destroy was yml-driven and skipped it). The yml is only consulted to honor a
**BYO `certArn`** on the domain still in it (`opts.current`) — that cert is left alone; every other
(old/dropped) domain is treated as slsv-minted. Each teardown is **FULL cleanup, nothing left
behind**: `DeleteDomainName` (cascades the mapping) → `DeleteCertificate` (the
slsv-minted ACM cert) → delete **both** Cloudflare records (public CNAME + the ACM validation
CNAME). A **BYO `certArn`** and its validation record are **left** (the user's, not slsv's to
delete). Order matters: domain name is deleted first so ACM releases the cert; the validation
record name is captured (via `DescribeCertificate`) before the cert is gone. **Two teardown
gotchas, both fixed — do not regress:** (a) **destroy must load `.env`** (the `cli.ts` destroy
action runs `dotenv` like deploy) so `CLOUDFLARE_API_TOKEN` is present — without it, DNS cleanup was
silently skipped and every Cloudflare record survived while the step printed a **lying `✓`**. (b)
`DeleteCertificate` **races the domain-name release** (API GW frees the cert only eventually,
seconds–minutes) → a one-shot delete hits `ResourceInUseException`; `deleteCertWhenFree`
**retries ~18×/10s** until it frees. Cleanup is **NOT swallow-and-continue**: a missing token or a
stuck-in-use cert **throws** so the destroy step prints `✗` + exits non-zero instead of falsely
reporting done (only "already gone"/NotFound counts as success). ponytail ceilings: (1) Cloudflare
only — Route53/other DNS = a future `dns.provider` field (dropped for now; `api.domain` alone
implies Cloudflare); (2) `cfZoneIdForDomain` reads one page (`per_page=50`) — paginate if a token
fronts >50 zones; (3) create-only for a GIVEN domain's config (a cert/endpoint-type change on the
SAME domain needs destroy+redeploy, same as CloudFront) — **but changing `api.domain` to a new
subdomain IS handled**: after wiring the new domain, `ensureApiDomain` calls `pruneOldApiDomains`,
which enumerates API-GW domains, finds any OTHER one still mapped to this app's API, and runs the
full `destroyApiDomain` on it (old domain name + mapping + slsv-minted cert + both Cloudflare
records). Discovery-based so it doesn't need the old value from the yml. Safe for BYO certs: only a
cert whose ACM `DomainName` exactly equals the old domain is deleted, so a wildcard
(`*.myapp.com`) never matches. Prune failures warn + continue (a stray old domain can't block the
deploy). Dropping `api.domain` entirely (not changing it) isn't cleaned on *deploy* — prune runs
only when a new domain is set — but `slsv destroy` removes it either way now (destroy is
discovery-based, doesn't need the domain in the yml). Ceilings: reads one page of
`GetDomainNames` (paginate if >100 domains); a BYO exact-match (non-wildcard) cert on the old
domain WOULD be deleted. (4) apex domains work but Cloudflare
CNAME-flattening is on the user; (5) shares one domain/stage — multi-stage on one domain
(`api-prod`/`api-dev`) is the user's naming job.

`slsv destroy [--stage] [--target local|aws]` tears the stack down. **Discovery-based, NOT
yml-driven:** destroy ENUMERATES every resource deployed under the `<app>-<stage>-` prefix
(`ListFunctions`/`ListTables`/`ListBuckets`/`ListQueues`/`ListSecrets`/
`DescribeReplicationGroups`+`DescribeServerlessCaches`/`DescribeDBInstances`/`DescribeLogGroups`,
all `paginate()`d — log groups swept by `/aws/lambda/<prefix>` discovery, `listLambdaLogGroups`,
so an orphan group whose Lambda is already gone is deleted too)
and deletes what it finds — so a resource the user already **removed from slsv.yml** (yml drifted
from AWS) is STILL torn down. (Before: destroy iterated `cfg.functions`/`cfg.databases`/… — a
service dropped from the yml was invisible to destroy and survived on real AWS: "my lambda and
dynamodb not removed".) Verified end-to-end on Floci: deploy → remove a fn+table+secret from the
yml → `destroy` still deletes `<app>-<stage>-{fn,table,secret}`, while sibling apps
(`fx-dev-*`, `aa3-dev-*`) are untouched. Includes the HTTP API (`deleteHttpApi`, cascades
routes/integrations/stages), the per-app+stage IAM role (fixed name `<app>-<stage>-exec`),
CloudFront (found by `Comment`), and the **frontend hosting bucket** (`<app>-<stage>-frontend`,
swept by the S3 prefix scan — no longer a yml special-case). RDS discovery has no yml so it
**always `SkipFinalSnapshot: true`** (a drifted destroy can't know to snapshot; use
`skipFinalSnapshot: false` + destroy while it's still in the yml if you need one).
ponytail: **prefix match, not tag match** — a sibling stack whose name extends this prefix
(`myapp-dev-` vs stage `dev-2` → `myapp-dev-2-*`) could be swept; same ceiling reconcile's prune
accepts. Switch to the Resource Groups Tagging API (`slsv:app`+`slsv:stage`) if stacks ever share
a name prefix.
**`--target` matters:** without it (default `local`) destroy hits Floci — so after a real
deploy you MUST `slsv destroy --target aws`, or the real (billable) RDS/ElastiCache keep
running. Only `--target local` stops the emulator afterward. **Idempotent:** every delete
swallows "already gone" via one pattern (`GONE` = `/(NotFound|NoSuch|DoesNotExist|NonExistent)/i`,
module-level, shared with reconcile) — services name their not-found errors differently
(`ResourceNotFoundException`, `NoSuchBucket`, `QueueDoesNotExist`,
`ReplicationGroupNotFoundFault`, ...), so a partial or re-run destroy never fails.
**Step-tracked + resilient:** each delete runs through a `step(label, fn)` wrapper that prints
progress like deploy (`    Lambda api … ✓` / `· already gone` / `✗ <err>`); an already-gone
resource is success, and a REAL failure is **recorded and the sweep CONTINUES** (before: one
non-`GONE` error, e.g. RDS `InvalidDBInstanceState`, threw and skipped every later step —
CloudFront/IAM/EventBridge/container sweep never ran, leaving billable resources behind). At
the end, any failures are listed and the command **throws (exits non-zero)** so a partial
teardown is never silently reported as done.

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

### API authorizer (`api.auth`, Lambda REQUEST)

`api.auth` protects the HTTP API with a **Lambda REQUEST authorizer** (`apigw.ts`:
`ensureAuthorizer`). **Whole-API default** — once `api.auth` is set, EVERY http route gets
`AuthorizationType: CUSTOM` + the authorizer; a route opts out with `auth: false`
(`ensureRoute` converges both directions, so adding/removing auth takes effect on redeploy).
`api.auth.function` names a **trigger-less function** (no http/queue/cron/event — deployed like
any fn, just referenced here); API Gateway invokes it before the route handler and it returns
`{ isAuthorized: bool, context? }` (simple-response mode, `EnableSimpleResponses: true`) — deny
→ **403**, the route fn never runs; `context` reaches the route at
`event.requestContext.authorizer.lambda`. The **lookup is entirely the handler's** (DB via
`db()`/`sql()`, `secret()`, JWT, external HTTP — slsv injects the same env bindings, no SDK
change); slsv only wires the authorizer (`CreateAuthorizer`, `AuthorizerUri` = the fn's
lambda:path invoke arn, `IdentitySource` default `$request.header.Authorization`,
`AuthorizerResultTtlInSeconds` default 300) + grants `apigateway.amazonaws.com` invoke on it
(source arn `.../authorizers/<id>`, same pattern as route invoke perms). Named `<app>-<stage>-authz`,
get-or-create; dropping `api.auth` unprotects routes then `DeleteAuthorizer` (after the route
loop — AWS refuses deleting an in-use authorizer). `deleteHttpApi` cascades it on destroy, and
`lint.ts` errors if `api.auth.function` isn't a declared fn. ponytail: (1) create-only — a
changed `identitySource`/`ttl` on an existing authorizer isn't converged (destroy+redeploy, same
as the custom domain); (2) Lambda REQUEST only (no JWT / IAM-policy mode / per-route different
authorizers — add if hit); (3) **Floci enforces allow/deny but drops the authorizer `context`** —
verified end-to-end on Floci: missing identity source → 401, `isAuthorized:false` → 403,
`true` → 200, and `auth:false` routes stay public; but `event.requestContext.authorizer` is
**null locally even on allow**, so `context` passthrough only works on real AWS
(`…authorizer.lambda`). Don't rely on the authorizer context in `slsv dev`; re-derive it in the
handler locally.

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
    runtime: nodejs24 # nodejs22 | nodejs24 — honored (maps to `<runtime>.x`); platform (AWS/Floci) must support it
    handler: ./src/api.handler # file.export
    http: [{ method, path, auth? }] # OR queue: { name } OR cron: { schedule } OR event: { pattern }. auth: false = leave this route public when api.auth is set
    # a trigger-less fn (handler only, no http/queue/cron/event) is valid — used as an api.auth authorizer
    timeout?: 30 # secs, 1-900 (default 30)
    memory?: 256 # MB, 128-10240 (default 256)
    architecture?: arm64 # arm64 (default) | x86_64; set at create only (immutable)
    ephemeralStorage?: 512 # /tmp MB, 512-10240 (default 512)
    tracing?: true # X-Ray active tracing (adds xray perms to exec role)
    reservedConcurrency?: 10 # PutFunctionConcurrency (separate call); 0 throttles all
    provisionedConcurrency?: 2 # warm instances (--target aws only); publishes a version + `live` alias, triggers point at the alias
    environment?: { KEY: value } # custom env; slsv bindings (DATABASE_*, etc) always win
api: { cors?: false | [origin, ...] | { origins?, methods?, headers?, exposeHeaders?, credentials? }, domain?, basePath?, certArn?, auth? } # cors: HTTP API CORS. false = disable gateway CORS (handler owns it). Array = AllowOrigins (omit → '*', methods/headers stay '*'). Object = full control; origins optional (declare shared cors in base, add per-stage origins). credentials:true (for fetch credentials:'include') forces explicit origins + concrete methods/headers ('*' or missing origins is invalid with credentials — deploy rejects it on --target aws; ignored on `slsv dev`, Floci owns CORS). exposeHeaders: response headers JS may read cross-origin. domain: custom API domain, aws-only, provisioned end-to-end — ACM DNS-validated cert (deploy region, NOT us-east-1) + regional custom domain + API mapping + public CNAME, zero manual DNS; slsv writes DNS via Cloudflare (env CLOUDFLARE_API_TOKEN) and auto-finds the owning zone from the domain; certArn reuses an existing cert. basePath: mount this app under a path on `domain` (API-GW v2 mapping key) so multiple separate slsv apps SHARE one domain (`api.x.com/qualify`, `/auth`); API GW strips it so routes stay `/v1/{proxy+}`; omit for a single-app domain (root mapping); must be non-empty; destroy removes only this app's mapping and tears the domain/cert down with the LAST app out. See "API custom domain" below. auth: { function, identitySource?, ttl? } = Lambda REQUEST authorizer protecting EVERY route (opt out per route with auth:false); function names a trigger-less fn returning { isAuthorized, context? }. See "API authorizer" below
queues: { name: { type: sqs, fifo?: bool, visibilityTimeout?: secs, dlq?: name } }
buckets: {
    name: {},
    # or:
    #   publicRead: true    # browser reads objects via bucket URL (s3:GetObject policy + blocks disabled)
    #   cors: [origin, ...] # browser PUT/GET cross-origin (presigned URLs); pair with publicRead when allowing GET
  }
databases: { name: { type: dynamodb|postgres|mysql, ... } } # dynamodb: partitionKey, sortKey?, gsi? — postgres/mysql: instanceClass?, storage?, multiAz?, name?, init_sql?, skipFinalSnapshot? (default true — destroy takes no snapshot). All provisioned via their APIs. Hosted/BYO DB → put its URL in secrets:, not here
caches: { name: { type: redis|valkey, nodeType?, nodes?, serverless? } } # both types provision valkey under the hood; knobs apply on --target aws. serverless: true → ElastiCache Serverless on aws (rediss://, auto-scale); ignored locally (node group — Floci lacks the serverless API)
secrets: [ENV_VAR_NAME]
tags: { KEY: value } # optional; custom tags added to every resource (on top of slsv:* tags)
logRetentionDays: 14 # optional; CloudWatch log retention (default 14, 0 = never). Must be a CloudWatch-allowed value; applied every deploy
autoRemove: false # optional (default false, safe); true = on deploy DELETE data stores (DynamoDB/S3/RDS) dropped from the yml — destructive. false = report-only, remove via `slsv destroy`
stages: { <name>: { <partial-config> } } # optional; deep-merged over base for --stage <name> (null removes a key)
```

## Templates (slsv init)

- `slsv init` → interactive prompt (@clack/prompts) → **minimal** template (1 HTTP fn + 1 table)
- `slsv init <name>` → skip prompt
- `slsv init --demo` → full demo (HTTP + webhook + SQS job + cron)
- Demo template uses `paymentWebhook` (x-webhook-secret header, no Stripe). `.env.example` works as-is.
- **pnpm-only.** slsv apps use **pnpm** exclusively — the hint, scaffolds, `slsv dev`, and the frontend `build:` command all assume pnpm. Mixing npm/yarn breaks: running `npm install` over a pnpm `node_modules` throws `ERESOLVE`.
- **pnpm build-script gate.** pnpm 10+ blocks native build scripts by default and **exits non-zero** on any ignored build → `ERR_PNPM_IGNORED_BUILDS`, breaking `&&` chains. esbuild is a build-script dep at BOTH the app root (via the `@slsv/sdk` file:-link toolchain) and the frontend (via vite). **pnpm 11 silently ignores the `onlyBuiltDependencies` allowlist from a config file** (also ignores `.npmrc`/env/CLI-flag variants) — the _only_ setting it honors from a file is `dangerouslyAllowAllBuilds: true` (camelCase) in `pnpm-workspace.yaml`. So scaffolds ship that file at **app root + `frontend/`** (static in demo; `PNPM_WORKSPACE` const written at both in `init.ts` minimal). Trade-off: allows all deps' postinstalls (fine for a trusted dev scaffold). Verified end-to-end on pnpm 11.5.2.
- The `Next:` hint is hardcoded pnpm: `pnpm install` at root **and** `frontend/`, then `slsv dev`.
- **Frontend `build:`** (both templates) is `cd frontend && pnpm install && pnpm run build` — pnpm install is exit-0 via the shipped `dangerouslyAllowAllBuilds` file, and it builds to `frontend/dist` (which `frontend.src` points at — deploying the _build output_, not raw source, or the browser gets raw TS → blank page).
- **`slsv dev` frontend runner (`dev.ts`)**: `ensureFrontendDeps()` writes the `dangerouslyAllowAllBuilds` `pnpm-workspace.yaml` if missing (fixes apps scaffolded before it shipped) + `pnpm install`s if `node_modules` is absent, then spawns `pnpm run dev`.
- `slsv init --yes` → headless/CI (name = folder name)

**SDK dependency in scaffolds:** both templates set `@slsv/sdk` via `sdkDependency(dir)` in
`init.ts` — a `file:` link to the local `packages/sdk` when scaffolding from a source
checkout (dev), else `^0.1.0`. ⚠️ **`@slsv/sdk` is NOT published to npm yet** — so a
scaffold made by a _published_ CLI (falling back to `^0.1.0`) will fail `npm install` with a 404. Publishing `@slsv/sdk` is a hard release prerequisite. (Bundling still inlines the SDK
into the Lambda, but the app's `npm install`/typecheck needs the dep resolvable.)

## Critical files

| File                                          | Purpose                                                                                                                                                                                       |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/cli/src/config.ts`                  | zod schema for slsv.yml                                                                                                                                                                       |
| `packages/cli/src/providers/aws/index.ts`     | AwsProvider — deploy + destroy + reconcile                                                                                                                                                    |
| `packages/cli/src/providers/aws/index.ts`     | Floci endpoint health check                                                                                                                                                                   |
| `packages/cli/src/providers/aws/functions.ts` | esbuild bundle → zip → Lambda deploy (bounded-parallel, `mapLimit` concurrency 8 — each fn blocks on `waitUntilFunctionUpdatedV2` up to 120s, so serial deploy scaled linearly with fn count) |
| `packages/cli/src/deploy.ts`                  | orchestration order                                                                                                                                                                           |
| `packages/cli/src/providers/aws/plan.ts`      | `slsv plan` — read-only two-way diff (yml vs AWS); `classify()` pure, `computePlan()` enumerates                                                                                              |
| `packages/cli/src/lint.ts`                    | `lintApp` — preflight: slsv.yml ↔ code (handler/export exists, SDK names declared, triggers resolve)                                                                                          |
| `packages/cli/src/init.ts`                    | scaffold templates (minimal + demo)                                                                                                                                                           |
| `packages/cli/src/env-key.ts`                 | shared env var name util (`DATABASE_FOO`, `QUEUE_BAR`, etc.)                                                                                                                                  |
| `packages/cli/src/providers/aws/iam.ts`       | `ensureExecRole`/`deleteExecRole` — per-app+stage role + scoped inline `slsv-data` policy                                                                                                     |
| `packages/cli/src/providers/aws/secrets.ts`   | `ensureSecrets` — upsert to Secrets Manager, inject `SECRET_<NAME>=<id>` (never the value)                                                                                                    |
| `packages/sdk/src/index.ts`                   | db/queue/storage/cache/secret/sql exports                                                                                                                                                     |
| `packages/sdk/src/providers/aws/sql.ts`       | `makeSql` — postgres/mysql conn string → Drizzle client (dialect sniff, per-container cache)                                                                                                  |
| `packages/sdk/src/resolve.ts`                 | logical name → env var                                                                                                                                                                        |

### Preflight lint (dev + deploy)

`deploy()` calls **`lintApp(cfg, cwd)`** (`lint.ts`) before any provisioning — so both `slsv
dev` and `slsv deploy` (they share `deploy()`) fail fast when slsv.yml doesn't match the code,
with a clear message instead of a cryptic esbuild crash or a runtime 500. Three checks:

1. **Handler + export** — each `functions.<fn>.handler` (`file.export`) resolves to an existing
   `<file>.ts` (same path `bundle.ts` compiles) that actually exports the named symbol (regex,
   covers `export const/function/{ x as handler }`).
2. **SDK names ↔ yml** — scans project `.ts` (skips node_modules/dist/frontend/tests) for
   `@slsv/sdk` accessor calls and cross-checks the logical name: `db('x')`→dynamodb db, `sql`→
   postgres/mysql db, `queue`/`cache`/`storage`→queues/caches/buckets, `secret`→secrets. Only
   counts names **imported from `@slsv/sdk`** (per-file, alias-aware) so a same-named local
   method like `this.queue()` isn't a false positive. Undeclared name = error; declared-but-
   never-referenced = warning.
3. **Triggers** — a function's `queue: { name }` trigger and a queue's `dlq:` both must name a
   declared queue.
   Errors throw `ConfigError` (printed sans stack, exit 1); warnings print and continue. ponytail:
   regex not AST — `import * as slsv`, multi-line SDK imports, and `export * from` re-exports slip
   through; extend if a real app hits them. Tested in `lint.test.ts`; the demo template lints clean
   (dropped the unused `ADMIN_KEY` secret to keep it warning-free on fresh scaffold).

### CLI flag hardening (`cli.ts`)

`deploy`/`destroy` set **`.allowExcessArguments(false)`** + **`--target` via `new
Option(...).choices(['local','aws'])`**. Kills a silent footgun: `slsv destroy -- target aws`
(space after `--`) made commander treat `target aws` as ignored operands and fall back to
`--target local`, so a "real AWS" destroy quietly hit Floci and left the billable stack running.
Now it errors (`too many arguments`); a bad value like `--target awss` (which `makeClients`
would otherwise treat as aws) is rejected too.

## Conventions

- No CloudFormation/state file — idempotent SDK calls
- No raw `@aws-sdk` in handler code — always via `@slsv/sdk`
- SQL: postgres/mysql provisioned via the RDS API (init_sql runs once on first creation); hosted/BYO DB → connection string in `secrets:`, connect with your own driver/ORM
- Mark deliberate shortcuts with `// ponytail:` comment + ceiling + upgrade path
- esbuild bundles handlers to CJS with `bundle: true`, `minify: true` (+ `keepNames` so stack traces stay readable) and NO externals — `@slsv/sdk` AND `@aws-sdk/*` are inlined into one self-contained `handler.js` (the Floci/Lambda base image doesn't ship `lib-dynamodb`, so bundling everything is deliberate: always works). minify roughly halves the bundle (~4.8M → 2.4M — aws-sdk+drizzle dominate); `keepNames` preserves class/fn names so `instanceof`/`e.name` error checks and traces survive minification. `@slsv/sdk` is never published/deployed separately; the `file:` link is bundle-time only.

## Cleanup rule (before commit)

No dead code lands in this repo. Before any commit/PR, scan:

- **Dead imports/fields** — grep every imported symbol + every private field; if nothing reads it, delete it.
- **Dead config flags** — if a field is accepted by the zod schema but no code reads it, the flag is a lie. Delete it (or honor it — never silently ignore).
- **YAGNI abstractions** — interfaces with one impl, options bags nothing passes, factory wrappers around one function, helper params documented as "for future callers". Delete until a second caller exists.
- **Single-call-site helpers** — a `withRoleRetry`-style helper used once is fine, but if the function body fits in the call site, inline it.
- **Misleading config** — a knob users will set expecting behavior is worse than no knob. If you can't honor it, drop the field.

Reference docs (e.g. `packages/cli/templates/slsv.example.yml`) are exempt — they're docs, not code.
