# Getting started

## Prerequisites

- **Node** 22+
- **pnpm** 11+ (`corepack enable`)
- **Docker** (for [Floci](https://github.com/flociorg/floci) — the local AWS emulator)
- For real-AWS deploys: AWS credentials with permission to manage the services in your yml

## Scaffold

```bash
pnpm dlx @slsv/cli init my-app
cd my-app
```

The CLI prompts for a template:

| Template | What's in it |
|----------|--------------|
| `minimal` | 1 HTTP function + in-memory store |
| `demo` | HTTP + queue + cron + webhook + stores |
| `api-db` | API-only, external Postgres via connection string in `secrets:` |

Skip the prompt in CI:

```bash
pnpm dlx @slsv/cli init my-app --yes
```

## Install + dev

```bash
pnpm install
slsv dev
```

`slsv dev` boots Floci, deploys your stack to it on `:4566`, then watches `src/` for changes. Press `Ctrl+C` to stop.

The CLI prints the API and frontend URLs when they're ready:

```
API → http://localhost:4566/local/my-app-dev
Frontend → http://localhost:5173
```

## Deploy to real AWS

```bash
slsv deploy --target aws
```

The first deploy creates every resource in your yml. Subsequent deploys are idempotent — only changed resources are touched. To see the diff before deploying:

```bash
slsv plan --target aws
```

A destructive change (e.g. dropping a table from the yml with `autoRemove: true`) prompts for confirmation unless you pass `--yes`.

## Tear down

```bash
slsv destroy --target aws        # billable AWS
slsv destroy --target local       # Floci only
```

Discovery-based — enumerates `<app>-<stage>-*` resources and deletes them. Safe to re-run.

## Project layout

```
my-app/
├── slsv.yml          # the whole app
├── package.json
├── pnpm-workspace.yaml
├── backend/          # Lambda handlers
│   └── src/
│       └── api.ts
└── frontend/         # Vite (only with `fullstack` stack)
    └── src/
```

See [Architecture](architecture/overview.md) for how slsv maps yml → AWS, or [Services](services/lambda.md) for per-service details.