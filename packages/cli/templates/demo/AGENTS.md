# AGENTS.md — how this app works (slsv)

This is a **slsv** app. One `slsv.yml` describes the whole backend — functions, HTTP routes,
queues, crons, databases, buckets, caches, secrets. `slsv dev` runs the entire stack locally
against Floci (a local AWS emulator on :4566); `slsv deploy --target aws` provisions the same
stack on real AWS with **no handler changes**.

## Commands (pnpm only — never npm/yarn)

- `pnpm install` — at repo root, and again in `frontend/` if it exists.
- `slsv dev` — run the whole stack locally (Floci), hot-reloads handlers.
- `slsv deploy --stage <stage> --target aws` — deploy to real AWS.
- `slsv destroy --stage <stage> --target aws` — tear the stack down.
- `slsv plan --target aws` — preview changes (create/update/replace/delete).
- `pnpm test` — run tests.

Every command takes `--stage <name>` (default `dev`). Stages namespace all resources
(`<app>-<stage>-<name>`), so dev and prod stacks coexist in one account.

## Golden rule: handlers import `@slsv/sdk`, NEVER raw `@aws-sdk`

Resolve resources by **logical name**, never by ARN/URL. slsv injects the env at deploy so the
same code runs locally and on AWS:

- `db('links')` → DynamoDB (get/put/query). Declare `databases: { links: { type: dynamodb, ... } }`.
- `sql('main')` → Postgres/MySQL via Drizzle. Declare `databases: { main: { type: postgres, ... } }`.
- `queue('jobs')` → SQS. Declare `queues: { jobs: {...} }`.
- `storage('media')` → S3. Declare `buckets: { media: {} }`.
- `cache('session')` → Redis/Valkey. Declare `caches: { session: {...} }`.
- `secret('DATABASE_URL')` → Secrets Manager value at runtime. Declare `secrets: [DATABASE_URL]`.

The name in code MUST match a name in `slsv.yml` — `slsv dev`/`deploy` lint this and fail fast.

## HTTP handlers use the SDK router (don't add Hono/Express)

```ts
import { router, json } from "@slsv/sdk";
export const handler = router([
  { method: "GET", path: "/health", handler: () => json({ ok: true }) },
  { method: "GET", path: "/links/{id}", handler: (req) => json({ id: req.params.id }) },
]);
```

Path params: `{id}`, greedy `{id+}`. Middleware is onion-model: `router(routes, [mw])`.

## Triggers — one per function, split by TRIGGER not by feature

```yaml
functions:
  api:     { http:  [{ method: ANY, path: /v1/{proxy+} }] }   # HTTP
  worker:  { queue: { name: jobs } }                          # SQS consumer
  nightly: { cron:  { schedule: "0 2 * * *" } }               # scheduled
  onEvent: { event: { pattern: {...} } }                      # EventBridge
```

One HTTP function with many routes (via `router`) is FASTER than many tiny functions — it stays
warm, avoiding cold starts. Split into separate functions only for a different trigger, or
genuinely different scaling/memory needs.

## Secrets & env

- Secrets: names in `secrets:`, values in `.env` files (gitignored). Injected as an SM id,
  fetched at runtime with `secret('NAME')` — the value never sits in the Lambda env.
- Env file precedence (first wins): `.env.local` (local-only, loaded by `slsv dev` — never
  deployed) → `.env.<stage>` → `.env`. Put local-machine overrides in `.env.local`.
- Custom env per function: `functions.<fn>.environment: { KEY: value }`.

## Layout

- `backend/` — handlers (deploy as Lambdas).
- `frontend/` — optional Vite static site (S3 + CloudFront if enabled).
- `slsv.yml` — the manifest and single source of truth. Remove a resource here and the next
  deploy removes it (data stores are report-only unless `autoRemove: true`).

Full schema: the slsv docs / `slsv.example.yml`.
