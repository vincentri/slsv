# Stages & targets

Every command takes `--stage <name>` (default `dev`). Stage namespaces **all** resources — names become `<app>-<stage>-<name>` (e.g. `myapp-prod-api`), so dev and prod coexist in one account.

```bash
slsv dev --stage staging
slsv deploy --stage prod --target aws
slsv destroy --stage staging
slsv logs api --stage prod --follow
```

Stage names must match `^[a-z0-9-]+$` — enforced in `cli.ts:14`. `SLSV_STAGE` is injected into every function's env.

## How names are derived

A single derivation point in `deploy.ts`:

```ts
const prefix = `${app}-${stage}`;
// passed as `appName` to every provider file (lambda/sqs/dynamodb/etc.)
```

Each provider prefixes its own resource names with it. Drop in a new stage, get a fully isolated stack — no cross-talk between `dev` and `prod`.

## Env / secret precedence

Loads in order; the first load wins (dotenv never overwrites an already-set key):

1. **`.env.local`** — `--target local` only. Local-machine overrides; never sent to the cloud; git-ignored. Mirrors Vite/Next convention.
2. **`.env.<stage>`** — stage-specific values.
3. **`.env`** — base defaults.

`provider.target` gates the `.env.local` load in `deploy.ts`.

```bash
# example .env.prod
DATABASE_URL=postgres://prod-db.example.com/app
STRIPE_KEY=sk_live_...
```

## Per-stage overrides (`stages:` overlay)

Optional top-level `stages: { <name>: {...} }`. `loadConfig(cwd, stage)` deep-merges `stages[stage]` over the base, then validates the merged result. The `stages` key itself is stripped before validation.

Merge rules (`deepMerge` in `config.ts:209`):

- objects merge recursively
- scalars / arrays replace
- explicit `null` **removes** a base key

```yaml
app: my-app

functions:
  api:
    handler: ./src/api.handler
    http: [{ method: GET, path: /jobs }]

queues:
  jobs: {}

stages:
  dev:
    # dev uses EventBridge, prod uses the SQS queue
    functions:
      api:
        event:
          pattern:
            source: [myapp.jobs]
        queue: null
```

The base config is the `dev` default; override only what differs. The above dev stage invokes `api` on every EventBridge event matching `myapp.jobs`, while prod keeps the queue-driven trigger.

## Targets

| | `--target local` (default) | `--target aws` |
|--|--|--|
| AWS API endpoint | `http://host.docker.internal:4566` (Floci) | real AWS region |
| Emulator | Floci required | — |
| Cost | free | billable |
| Auth | none | env-var AWS creds / IAM role |
| Lambda cold start | none | real cold start (mitigated by `provisionedConcurrency`) |
| `provisionedConcurrency` | skipped (no cold starts locally) | honored |

Without `--target`, the default is `local`. **`slsv destroy` after a real deploy must pass `--target aws`** — default destroys hit Floci and leave the AWS stack running.

See [Architecture → Stages & targets](stages.md) for the merge mechanics, or [Reconcile & prune](reconcile.md) for drift handling between stages.