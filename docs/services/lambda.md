# Lambda

Each function declared under `functions.<name>` in `slsv.yml` becomes one Lambda. Handlers live in your repo; slsv bundles them to a single CJS file via esbuild and uploads as a zip.

## Declaring a function

```yaml
functions:
  api:
    runtime: nodejs22      # nodejs22 | nodejs24 — maps to <runtime>.x
    handler: ./src/api.handler   # file.export
    http:
      - method: GET
        path: /links
        auth: false        # opt out of api.auth on this route (if api.auth is set)
      - method: POST
        path: /links
    timeout: 30            # 1–900 seconds (default 30)
    memory: 256            # 128–10240 MB (default 256)
    architecture: arm64     # arm64 (default) | x86_64 — immutable
    ephemeralStorage: 512  # /tmp in MB, 512–10240 (default 512)
    tracing: true          # X-Ray active tracing
    reservedConcurrency: 10  # PutFunctionConcurrency; 0 throttles all
    provisionedConcurrency: 2 # --target aws only — warm instances
    environment:            # custom env; slsv bindings (DATABASE_*, etc) always win
      LOG_LEVEL: info
```

A trigger-less function (no `http` / `queue` / `cron` / `event`) is valid — used as an [`api.auth`](api-gateway.md) authorizer.

## Bundle + deploy

`packages/cli/src/bundle.ts` wraps esbuild:

- `bundle: true`, `minify: true`, `keepNames: true`, **no externals**
- `@slsv/sdk` AND `@aws-sdk/*` are inlined into one self-contained `handler.js`
- The Floci/Lambda base image doesn't ship `lib-dynamodb`, so bundling everything is deliberate
- `keepNames` preserves class/fn names so `instanceof` / `e.name` error checks survive minification

Deploy uses bounded-parallel `mapLimit` (concurrency 8) — each fn blocks on `waitUntilFunctionUpdatedV2` up to 120s, so serial deploy scaled linearly with fn count.

## Environment

slsv injects every function with:

- `DATABASE_<NAME>` → table name (DynamoDB) **or** `postgres://` / `mysql://` conn string (RDS)
- `QUEUE_<NAME>` → SQS QueueUrl
- `BUCKET_<NAME>` → S3 bucket name
- `REDIS_<NAME>` → `redis://...` (plain) or `rediss://...` (TLS, serverless cache)
- `SECRET_<NAME>` → Secrets Manager id (the value is fetched at runtime — never baked in)
- `SLSV_STAGE` → the active stage
- `AWS_ENDPOINT_URL` → `http://host.docker.internal:4566` for `--target local`; **omitted** for `--target aws`
- any user `environment: {}` from the yml (slsv bindings always win)

## Provisioned concurrency

`provisionedConcurrency: N` keeps N instances warm. `--target aws` only — skipped on Floci (no real cold starts). Can't attach to `$LATEST`, so `deployFunctions` (aws path only):

1. Wait for the code update to settle
2. `PublishVersion`
3. Point a `live` alias at it
4. `PutProvisionedConcurrencyConfig` on the alias
5. Set `fnOutput.arn` to the alias ARN so every trigger wires to the warm alias
6. GC old published versions

Warms in the background — deploy returns before it's `Ready`.

## IAM

The function assumes the per-app+stage exec role (`[IAM](iam.md)`). For data access, the inline `slsv-data` policy grants scoped actions on `<app>-<stage>-*` resources. `tracing: true` adds X-Ray perms.

## Triggers

| Trigger | yml shape | Source |
|---------|-----------|--------|
| HTTP | `http: [{ method, path, auth? }]` | API Gateway route → invoke |
| Queue | `queue: { name }` | SQS event-source mapping |
| Cron | `cron: { schedule }` | EventBridge schedule rule |
| Event | `event: { pattern: {...} }` | EventBridge event-pattern rule (default bus) |

See [Queues & Events](queues-events.md) for the EventBridge wiring, [API Gateway](api-gateway.md) for HTTP routes, [Reconcile & prune](../architecture/reconcile.md) for what happens when triggers are removed.

## Logs

CloudWatch log group `/aws/lambda/<app>-<stage>-<fn>`. Retention: `logRetentionDays` (default 14, `0` = never). Must be a CloudWatch-allowed value.

```bash
slsv logs api                  # tail last 100 lines
slsv logs api --follow         # follow new output
slsv logs api --target aws     # real AWS
```

## Pre-flight lint

`deploy()` calls `lintApp(cfg, cwd)` before any provisioning. Both `slsv dev` and `slsv deploy` fail fast when `slsv.yml` doesn't match the code (`lint.ts:37`):

1. **Handler + export** — `functions.<fn>.handler` resolves to an existing `.ts` file that exports the named symbol.
2. **SDK names ↔ yml** — scans project `.ts` for `@slsv/sdk` accessor calls (`db('x')`, `queue`, `cache`, etc.) and cross-checks the logical name against the yml. Undeclared name → error; declared-but-never-referenced → warning.
3. **Triggers** — `queue: { name }` and a queue's `dlq:` both must name a declared queue.

Errors throw `ConfigError` (printed sans stack, exit 1); warnings print and continue.