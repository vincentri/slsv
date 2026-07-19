# Reconcile & prune

slsv keeps **no state file**. Drift is a **two-way** diff — desired (`slsv.yml`) vs actual (AWS) — not Terraform's three-way (config vs recorded-state vs reality). The yml is always the source of truth; there's no "last-applied" to go stale.

## Drift contract

| | In AWS | Not in AWS |
|--|--|--|
| **In yml** | `update` (mutable fields converge on deploy) | `create` on next deploy |
| **Not in yml** | `delete` (under `autoRemove: true`) / `orphan` (report-only) | — |

Actions:

- **`create`** — get-or-create idempotently.
- **`update`** — converge mutable fields via `UpdateFunctionConfiguration`, `UpdateApiCommand`, etc.
- **`replace`** — immutable field changed (Lambda `architecture`, Dynamo partition/sort key, RDS engine, SQS `fifo`). Deploy never silently destroys a stateful resource to change one.
- **`delete`** — under `autoRemove: true`, DELETE data stores dropped from the yml.
- **`orphan`** — data store dropped from yml, reported but left alone. Remove via `slsv destroy`.

## `slsv plan`

Read-only preview of all of the above (`providers/aws/plan.ts`). Enumerates live AWS with the same `paginate()` + `List*`/`Describe*` calls reconcile uses, then `classify()` (pure, unit-tested in `plan.test.ts`) buckets each resource into one of the five actions.

```bash
slsv plan                    # default local
slsv plan --target aws       # against real AWS
```

`slsv deploy` runs `plan` first and prints the diff. On `--target aws`, a destructive delete (data store under `autoRemove: true`) prompts a confirm unless `--yes`.

## What's pruned vs reported

| Resource | Reconcile action when yml drops it |
|----------|------------------------------------|
| Lambda | **always pruned** (stateless, exact-named `<app>-<stage>-<fn>`) |
| EventBridge rule | **always pruned** (a dropped cron/event trigger would otherwise keep firing) |
| Frontend (S3 + CloudFront) | **always pruned** (build artifact, re-created every deploy) |
| DynamoDB / S3 / RDS | report-only by default; **`delete` only under `autoRemove: true`** |
| SQS queues | never pruned by reconcile; `slsv destroy` only |
| Secrets | never pruned by reconcile; `slsv destroy` only |
| Caches | never pruned by reconcile; `slsv destroy` only |

Default is safe-for-prod: dropping a store from the yml can't silently take its data with it. Set `autoRemove: true` to opt into destructive deletes on deploy.

```yaml
# slsv.yml
autoRemove: false  # default — report-only
```

## Prune details

- All `List*` calls drained via `paginate()` (`index.ts:66`) — correct past one page.
- Pruned Lambda cleanup:
  - `DeleteFunction` errors **surfaced** (a real failure is `⚠ could not prune …` and skipped) — before, `.catch(() => {})` hid every failure while logging "pruned".
  - **Log group deleted** too (was left before).
  - On `--target local`, the **Floci container is swept** (`docker rm`) — Floci keeps running the removed fn otherwise.
- Dangling API-GW integrations / SQS ESMs of a pruned function are still left (inert, harmless).

## `slsv destroy` (separate from reconcile)

Discovery-based, **NOT yml-driven**. Destroy enumerates every resource deployed under the `<app>-<stage>-` prefix and deletes what it finds — so a resource already removed from the yml is still torn down.

```bash
slsv destroy --stage dev --target aws    # MUST pass --target aws after a real deploy
```

Verified end-to-end on Floci: deploy → remove a fn+table+secret from the yml → `destroy` still deletes `<app>-<stage>-{fn,table,secret}`, while sibling apps (`fx-dev-*`, `aa3-dev-*`) are untouched.

Caveats:

- **Prefix match, not tag match** — a sibling stack whose name extends this prefix (`myapp-dev-` vs stage `dev-2` → `myapp-dev-2-*`) could be swept.
- RDS destroy always skips the final snapshot (a drifted destroy can't know to snapshot).
- Step-tracked + resilient: each delete runs through `step(label, fn)`; a real failure is recorded and the sweep continues. At the end, any failures are listed and the command **throws non-zero** so partial teardown is never silently reported as done.

## `slsv plan` field coverage

v1 field-diffs only what's cheap to read:

- Lambda: memory, timeout, arch
- Dynamo: keys (partition/sort)
- RDS: class, storage, multiAz, engine
- S3 / SQS / cache: presence-only

Mutable drift is **reported** in plan, but the deploy-side `Update*` coverage is partial today (Lambda + API CORS converge; SQS/S3/RDS/cache converge is a follow-up).