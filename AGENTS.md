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
- **Every schema change syncs to `slsv.example.yml`.** Adding, renaming, removing, or changing a field in `config.ts` (zod schema) MUST update `packages/cli/templates/slsv.example.yml` in the same change — show the new knob, its default, and a one-line note.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

When the user types `/graphify`, use the installed graphify skill or instructions before doing anything else.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts.
- Dirty graphify-out/ files are expected after hooks or incremental updates; dirty graph files are not a reason to skip graphify.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).

---

# slsv — simple local-AWS serverless framework

One `slsv.yml` describes the whole app. `slsv dev` brings the entire stack up on Floci. Later, `slsv deploy --target aws` hits real AWS — no handler rewrites.

## Publishing (release)

Two packages ship to npm: `@slsv/sdk` (scope `@slsv` — npm org owned by `vincent.ri`) and
`@slsv/cli` (CLI, binary `slsv`). They're **version-locked** (changesets `fixed`) — always released together at
the same version. Managed by **changesets**:

```
pnpm changeset          # describe a change, pick bump (patch/minor/major)
pnpm version-packages   # apply: bumps both package.jsons + changelogs
pnpm release            # pnpm build && pnpm -r publish --access public --no-git-checks
```

`pnpm release` uses `pnpm -r publish`, NOT `changeset publish` (changesets 2.31.0's
publisher masks real publish errors as a cryptic TypeError — see release.yml). pnpm
rewrites the CLI's `@slsv/sdk: workspace:*` → the real version (never `npm publish`).

## Hard rule: every resource runs in Floci

slsv provisions ALL resources through their native AWS API against Floci
(localhost:4566) — no sibling containers, no sidecars, no bypass. Lambda, Dynamo,
SQS, S3, EventBridge, Secrets, IAM, Logs via their SDK APIs; Valkey via the
ElastiCache API; Postgres + MySQL via the RDS API. If a new resource type can't be
driven through Floci's API, that's a blocker — do NOT wire it as a sidecar.

## What this is NOT

- Not a Lambda-only tool (full multi-service support: HTTP, SQS, EventBridge, DynamoDB, S3, Secrets, CloudWatch, Valkey, Postgres, MySQL)
- Not a CloudFormation/SAM/SST wrapper — direct AWS SDK v3, idempotent get-or-create
- Not an AWS emulator — **Floci** (`flociorg/floci`) owns that; slsv is the orchestration + DX layer. Same port 4566 as LocalStack.

## Monorepo (pnpm workspaces)

```
packages/cli/    # name: "@slsv/cli"  — CLI tool (commander), deployer, bundler, dev loop
packages/sdk/    # name: "@slsv/sdk"  — cloud-agnostic handler SDK (db/queue/storage/cache/secret)
packages/cli/templates/demo/         — canonical reference app (scaffolded by `slsv init --demo`)
```

**Build:** `pnpm build` (all), `pnpm --filter @slsv/cli build`, `pnpm --filter @slsv/sdk build`
**Lint:** `pnpm lint` or per-package `pnpm --filter @slsv/cli lint`
**Test:** `pnpm test`
**Dev CLI:** `pnpm --filter @slsv/cli dev` (tsx watch), or `pnpm --filter @slsv/cli build:link` to re-link

## Phase 1 services (locked)

Lambda · API Gateway · SQS · EventBridge · DynamoDB · S3 · Secrets Manager · IAM exec role · CloudWatch Logs · Valkey (ElastiCache API, `type: redis|valkey`) · Postgres + MySQL (RDS API)

## Architecture — pointers

Full spec: `docs/architecture/overview.md` + `docs/services/*` + `docs/architecture/*.md`.

Deep specs (workers, CloudFront, custom domains, IAM, caches, databases, reconcile/plan, env/stages) live in docs — do not duplicate them here. Key invariants only:

- Env-var portability boundary: handlers resolve `DATABASE_*` / `QUEUE_*` / `BUCKET_*` / `REDIS_*` / `SECRET_*` injected at deploy; never hardcode ARNs/URLs.
- No state file — deploy is idempotent get-or-create; `slsv plan` is the two-way diff; reconcile prunes orphans (stateless auto-pruned, data stores report-only unless `autoRemove: true`).
- One `<app>-<stage>` namespace for every resource; `SLSV_STAGE` injected into functions.

See `docs/architecture/overview.md`, `docs/architecture/iam.md`, `docs/architecture/reconcile.md`, `docs/architecture/stages.md`, `docs/architecture/secrets.md` and `docs/services/*.md` for full details.

## Conventions

- No CloudFormation/state file — idempotent SDK calls
- No raw `@aws-sdk` in handler code — always via `@slsv/sdk`
- SQL: postgres/mysql provisioned via the RDS API (init_sql runs once on first creation); hosted/BYO DB → connection string in `secrets:`, connect with your own driver/ORM
- Mark deliberate shortcuts with `// ponytail:` comment + ceiling + upgrade path
- esbuild bundles handlers to CJS with `bundle: true`, `minify: true` (+ `keepNames`) and NO externals — `@slsv/sdk` and `@aws-sdk/*` are inlined into one `handler.js`.

## Cleanup rule (before commit)

No dead code lands in this repo. Before any commit/PR, scan:

- **Dead imports/fields** — grep every imported symbol + every private field; if nothing reads it, delete it.
- **Dead config flags** — if a field is accepted by the zod schema but no code reads it, delete it (or honor it — never silently ignore).
- **YAGNI abstractions** — interfaces with one impl, options bags nothing passes, factory wrappers around one function. Delete until a second caller exists.
- **Single-call-site helpers** — if the function body fits in the call site, inline it.
- **Misleading config** — a knob users will set expecting behavior is worse than no knob. If you can't honor it, drop the field.

Reference docs (e.g. `packages/cli/templates/slsv.example.yml`) are exempt — they're docs, not code.
