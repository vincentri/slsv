# slsv

One config file. One command. Full AWS serverless stack running locally.

```yaml
# slsv.yml
app: my-app
functions:
  api:
    runtime: nodejs20
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
cp .env.example .env
pnpm install
slsv dev
```

`slsv dev` does:

1. Starts Floci (+ Valkey cache if caches declared)
2. Deploys all resources (IAM, DynamoDB, S3, SQS, Lambda, API Gateway, EventBridge)
3. Watches `src/` — file change → rebundle → hot-reload Lambda in ~1s

---

## Other commands

```sh
slsv deploy              # deploy to local (same as dev without watch)
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
    runtime: nodejs20
    handler: ./src/api.handler
    http: # HTTP trigger
      - method: GET
        path: /health
      - method: ANY
        path: /api/{proxy+}

  worker:
    runtime: nodejs20
    handler: ./src/worker.handler
    queue: { name: jobs } # SQS trigger

  cron:
    runtime: nodejs20
    handler: ./src/cron.handler
    cron: { schedule: '0 8 * * *' } # EventBridge cron (5-field)

queues:
  jobs: { type: sqs }                                  # standard SQS
  # ordered: { type: sqs, fifo: true }                 # FIFO ordering + dedup
  # with-dlq:
  #   type: sqs
  #   visibilityTimeout: 60                            # seconds
  #   dlq: dead                                        # logical name of another queue
  # dead: { type: sqs }

buckets:
  uploads: {}

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
```

---

## Handler code

Use `@slsv/sdk` — no raw AWS SDK imports. Works on any cloud slsv supports.

```ts
import { db, queue, storage, cache } from '@slsv/sdk'

// DynamoDB
await db('orders').put({ id: '1', createdAt: new Date().toISOString() })
await db('orders').get({ id: '1' })
await db('orders').scan()

// SQS
await queue('jobs').send({ userId: '123' })

// S3
await storage('uploads').put('file.txt', 'hello')
await storage('uploads').getText('file.txt')

// Redis / Valkey (by name — isolated keyspaces; `type: redis` and `type: valkey` are aliases)
await cache('session').set('user:1', JSON.stringify(data), { ttl: 3600 })
await cache('ratelimit').incr('ip:1.2.3.4')
```

---

## Development workflow (working on slsv itself)

### After editing `packages/cli/`

```sh
pnpm --filter slsv build       # rebuild CLI
# OR for watch mode:
pnpm --filter slsv dev         # tsx watch (no link update needed, runs directly)
```

If `slsv` binary on PATH needs updating:

```sh
pnpm --filter slsv build:link  # rebuild + re-link global binary
```

### After editing `packages/sdk/`

```sh
pnpm --filter @slsv/sdk build  # rebuild SDK (examples pick up dist/)
```

### Build + test everything

```sh
pnpm build   # all packages
pnpm test    # all packages
pnpm lint    # type-check all packages
```

### Type-check only (fast)

```sh
pnpm --filter slsv lint
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
        types.ts       # Provider interface
        aws/           # AwsProvider (Floci + real AWS)
  sdk/         # @slsv/sdk — import this in your handlers
    src/
      index.ts         # db / queue / storage / cache exports
      resolve.ts       # logical name → env var (DATABASE_X, QUEUE_X, ...)
      providers/aws/   # DynamoDB, SQS, S3, Valkey impls

examples/
  invoice-app/ # reference app — always must work with slsv dev
```

---

## Migrate to real AWS

```sh
slsv deploy --target aws
```

Same code. No handler rewrites. `@slsv/sdk` resolves env vars injected by slsv — same names locally and on AWS.

Needs: `AWS_REGION` env + standard AWS credentials (`~/.aws/credentials` or env vars).
