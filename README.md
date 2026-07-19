# slsv

One config file. One command. Full AWS serverless stack running locally.

```yaml
# slsv.yml
app: my-app
functions:
  api:
    runtime: nodejs24
    handler: ./src/api.handler
    http:
      - method: GET
        path: /health
databases:
  items:
    type: dynamodb
    partitionKey: { name: id, type: S }
```

```sh
slsv dev   # Floci up → deploy → watch for changes
```

---

## Requirements

- Node 20+
- pnpm 9+
- Docker (for Floci)

---

## Install

> ### Requirement: pnpm (mandatory)
>
> **slsv apps are pnpm-only — this is not optional.** `slsv dev`, `slsv deploy`'s
> frontend build, and every scaffold assume pnpm and will fail without it
> (`slsv dev` spawns `pnpm` directly; `npm install` over the scaffold's
> `pnpm-workspace.yaml` throws `ERESOLVE`). Install it first:
>
> ```sh
> npm i -g pnpm
> ```
>
> (The global CLI itself installs with any manager — the pnpm requirement is for
> the app you build with it.)

```sh
pnpm add -g @slsv/cli    # or: npm i -g @slsv/cli
```

Installs the `slsv` command and pulls in `@slsv/sdk` automatically — import it in
your handlers. (The CLI ships as `@slsv/cli` because npm blocks the bare name
`slsv` as too similar to existing packages; the command you run is still `slsv`.)

### From source (working on slsv itself)

```sh
git clone <repo>
cd slsv
pnpm install
pnpm build:link          # build + link `slsv` to your PATH
```

---

## Create an app

```sh
slsv init                # interactive prompt → minimal template (1 fn + 1 table)
slsv init my-app         # skip prompt
slsv init my-app --demo  # full demo (HTTP + webhook + SQS + cron)
```

---

## Run locally

```sh
cd my-app
pnpm install
slsv dev
```

Scaffolds ship `.env.local` (loaded by `slsv dev`), plus `.env.dev` / `.env.prod` for later
deploys — all git-ignored. Put local secrets in `.env.local`; no `cp` needed.

`slsv dev` does:

1. Starts Floci (+ Valkey cache if caches declared)
2. Deploys all resources (IAM, DynamoDB, S3, SQS, Lambda, API Gateway, EventBridge)
3. Watches the project — a code change → rebundle → hot-reload Lambda in ~1s; a `.env*`
   change → redeploy env/secrets so edited values take effect without a restart

Runs under stage **`local`** (resources named `<app>-local-*`), kept separate from a real
server `dev` stack. Every command takes `--stage <name>` to switch; `dev` defaults to `local`,
all others default to `dev`.

---

## Other commands

```sh
slsv deploy              # deploy to local, no watch (stage `dev` by default; add --stage local to match `slsv dev`)
slsv deploy --target aws # deploy to real AWS (needs AWS_REGION + credentials)
slsv logs api            # tail CloudWatch logs for function "api"
slsv logs api -f         # follow (live tail)
slsv destroy             # stop Floci
```

---

## slsv.yml reference

```yaml
app: my-app

functions:
  api:
    runtime: nodejs24
    handler: ./src/api.handler
    http: # HTTP trigger
      - method: GET
        path: /health
      - method: ANY
        path: /api/{proxy+}

  worker:
    runtime: nodejs24
    handler: ./src/worker.handler
    queue: { name: jobs } # SQS trigger

  cron:
    runtime: nodejs24
    handler: ./src/cron.handler
    cron: { schedule: "0 8 * * *" } # EventBridge cron (5-field)

queues:
  jobs: { type: sqs } # standard SQS
  # ordered: { type: sqs, fifo: true }                 # FIFO ordering + dedup
  # with-dlq:
  #   type: sqs
  #   visibilityTimeout: 60                            # seconds
  #   dlq: dead                                        # logical name of another queue
  # dead: { type: sqs }

buckets:
  uploads: {} # private — only Lambda reads/writes
  public-assets: # browser reads objects directly via bucket URL
    publicRead: true
  user-uploads: # browser uploads directly via presigned PUT
    cors: ["https://app.example.com"]

databases: # slsv injects DATABASE_<NAME> into every function
  orders: # dynamodb — db('orders') → DATABASE_ORDERS
    type: dynamodb
    partitionKey: { name: id, type: S }
    sortKey: { name: createdAt, type: S } # optional
    gsi: # optional (dynamodb only)
      - name: byUser
        partitionKey: { name: userId, type: S }
  primary: # postgres/mysql via RDS API — db('primary') → DATABASE_PRIMARY
    type: postgres
    # instanceClass: db.t3.small        # RDS instance class (--target aws only)
    # storage: 100                      # GB (--target aws only)
    # multiAz: true                     # (--target aws only)

caches: # valkey (write `type: redis` or `type: valkey` — same backend)
  session: { type: valkey }
  ratelimit: { type: valkey }
  # big:
  #   type: valkey
  #   nodeType: cache.r6g.large         # ElastiCache node type (--target aws only)
  #   nodes: 3                          # read replicas (--target aws only)

secrets:
  - JWT_SECRET # read from .env, injected into every function

api: # optional — HTTP API settings (aws-only unless noted)
  # cors: ["https://app.example.com"]   # lock CORS to these origins (omit → open '*')
  domain: api.myapp.com # custom domain, provisioned end-to-end (ACM cert + DNS via Cloudflare)
  # basePath: myapp                     # share ONE domain across apps — see below
  # certArn: arn:aws:acm:...            # reuse an existing cert instead of slsv minting one
```

### Custom domain

`api.domain` puts the HTTP API on a real domain with **zero manual DNS** (`--target aws`): slsv
requests a DNS-validated ACM cert, writes the validation + public CNAME via Cloudflare (needs
`CLOUDFLARE_API_TOKEN`), and finds the owning zone itself. Skipped on `slsv dev` (Floci has no ACM).

**One domain, many apps (`api.basePath`).** Point several separate slsv apps at the *same* `domain`,
each mounted under its own path:

```yaml
# api/qualify/slsv.yml        # api/auth/slsv.yml
api:                          # api:
  domain: api.myapp.com       #   domain: api.myapp.com
  basePath: qualify           #   basePath: auth
functions:
  api:
    http:
      - { method: ANY, path: /v1/{proxy+} }   # UNCHANGED — API GW strips the base path
```

→ `api.myapp.com/qualify/v1/...` and `api.myapp.com/auth/v1/...`. How it works:

- The prefix is an **API Gateway v2 mapping key**, not a route. API GW strips `/qualify` before
  forwarding, so every app keeps `path: /v1/{proxy+}` — no route rewrites.
- Each app keeps its own `slsv.yml`, gateway, and deploy/scale/teardown lifecycle. Deploy order
  doesn't matter — the first app provisions the domain + cert, the rest reuse it (idempotent by
  domain name). Changing an app's `basePath` re-keys its mapping in place.
- **Teardown is sibling-safe.** `slsv destroy` on one app removes only *that app's* mapping and
  leaves the shared domain, cert, and DNS alone while other apps are still mounted — only the
  **last app out** tears them down. Omit `basePath` for a single-app domain (mapping at the root);
  its teardown is unchanged.

### Buckets

Three patterns, pick per-bucket:

```yaml
buckets:
  uploads: {} # private — only Lambda reads/writes
  public-assets: # browser reads objects directly via the bucket URL
    publicRead: true
  user-uploads: # browser uploads directly via presigned PUT
    cors: ["https://app.example.com"]
```

| Config             | What slsv does                                                                            | When to use                                                           |
| ------------------ | ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `{}`               | Creates the bucket, tags it. Private — no public access.                                  | Function-side read/write only (processed data, internal artifacts)    |
| `publicRead: true` | Disables the 4 public-access blocks + attaches `s3:GetObject` policy for `Principal: '*'` | Avatars, processed images, static assets the browser fetches directly |
| `cors: [...]`      | Adds `PutBucketCors` allowing the listed origins, GET/PUT/POST/HEAD, all headers          | Browser uploads/downloads via presigned URLs from a different origin  |

`publicRead` + `cors` can be combined, but only do that for assets you actually want public. Pair `cors:` with `putSignedUrl()`/`getSignedUrl()` in the SDK — without those, CORS is half a feature.

The demo template (`slsv init --demo`) covers each pattern end to end.

---

## Handler code

Use `@slsv/sdk` — no raw AWS SDK imports. Works on any cloud slsv supports.

```ts
import { db, queue, storage, cache } from "@slsv/sdk";

// DynamoDB
await db("orders").put({ id: "1", createdAt: new Date().toISOString() });
await db("orders").get({ id: "1" });
await db("orders").scan();

// SQS
await queue("jobs").send({ userId: "123" });

// S3
await storage("uploads").put("file.txt", "hello");
const bytes = await storage("uploads").get("file.txt");
const text = bytes ? new TextDecoder().decode(bytes) : undefined;
// Presigned URLs — pair with `cors:` on the bucket so the browser can PUT/GET directly.
const putUrl = await storage("user-uploads").putSignedUrl("avatars/1.jpg", {
  expiresIn: 60,
  contentType: "image/jpeg",
});
const getUrl = await storage("public-assets").getSignedUrl("logo.png", { expiresIn: 3600 });

// Redis / Valkey (by name — isolated keyspaces; `type: redis` and `type: valkey` are aliases)
await cache("session").set("user:1", JSON.stringify(data), { ttl: 3600 });
await cache("ratelimit").incr("ip:1.2.3.4");
```

---

## Development workflow (working on slsv itself)

### After editing `packages/cli/`

```sh
pnpm --filter @slsv/cli build       # rebuild CLI
# OR for watch mode:
pnpm --filter @slsv/cli dev         # tsx watch (no link update needed, runs directly)
```

If `slsv` binary on PATH needs updating:

```sh
pnpm --filter @slsv/cli build:link  # rebuild + re-link global binary
```

### After editing `packages/sdk/`

```sh
pnpm --filter @slsv/sdk build  # rebuild SDK (scaffolds pick up dist/)
```

### Build + test everything

```sh
pnpm build   # all packages
pnpm test    # all packages
pnpm lint    # type-check all packages
```

### Type-check only (fast)

```sh
pnpm --filter @slsv/cli lint
pnpm --filter @slsv/sdk lint
```

---

## Project structure

```
packages/
  cli/         # the slsv CLI tool
    src/
      cli.ts           # commands: init | dev | deploy | logs | destroy
      config.ts        # slsv.yml zod schema
      deploy.ts        # deploy orchestrator
      init.ts          # scaffold templates (minimal + demo)
      bundle.ts        # esbuild handler → zip
      dev.ts           # chokidar hot-reload loop
      providers/
        aws/           # AwsProvider (deploy + destroy + reconcile)
  sdk/         # @slsv/sdk — import this in your handlers
    src/
      index.ts         # db / queue / storage / cache exports
      resolve.ts       # logical name → env var (DATABASE_X, QUEUE_X, ...)
      providers/aws/   # DynamoDB, SQS, S3, Valkey impls
```

---

## Migrate to real AWS

```sh
slsv deploy --target aws
```

Same code. No handler rewrites. `@slsv/sdk` resolves env vars injected by slsv — same names locally and on AWS.

Needs: `AWS_REGION` env + standard AWS credentials (`~/.aws/credentials` or env vars).
