# Plan: `slsv init` — Stack Selection + Dynamic slsv.yml

## Goal

Add a `stack` prompt to `slsv init` so users choose **backend**, **frontend**, or **fullstack**. Generate `slsv.yml` (and scaffold files) dynamically based on the choice.

---

## Current State

- `init.ts` has two templates: `minimal` (HTTP fn + DynamoDB table) and `demo` (HTTP + webhook + SQS + cron)
- `cli.ts` prompts for app name only, then calls `initScaffold(name, cwd, template)`
- `config.ts`: `functions: z.record(FunctionConfig)` is **required** — no frontend-only yml is currently valid
- `FrontendConfig` schema exists: `{ src: string, build?: string, cloudfront?: boolean }`
- `frontendUrl` is already output by `deploy` and `dev`

---

## What Changes

### 1. `packages/cli/src/config.ts` — make `functions` optional

```yaml
# frontend-only yml needs no functions
```

Change: `functions: z.record(FunctionConfig)` → `functions: z.record(FunctionConfig).optional()`

Guard all 6 call sites with `?? {}`:

- `dev.ts:10` — `Object.keys(cfg.functions)` → `Object.keys(cfg.functions ?? {})`
- `dev.ts:18` — `Object.entries(cfg.functions)` → `Object.entries(cfg.functions ?? {})`
- `deploy.ts:23` — `Object.keys(cfg.functions)` → `Object.keys(cfg.functions ?? {})`
- `deploy.ts:43` — `cfg.functions` → `cfg.functions ?? {}`
- `deploy.ts:46,47,48` — same
- `providers/aws/index.ts:63` — `Object.keys(cfg.functions)` → `Object.keys(cfg.functions ?? {})`

---

### 2. `packages/cli/src/cli.ts` — add `stack` prompt

After the app name prompt, add a `select` prompt:

```
? What are you building?
  ❯ Fullstack (API + frontend)      [default for interactive]
    Backend only (API + database)
    Frontend only (static site)
```

`--yes` / non-TTY: default to `fullstack` (maximally useful for new users).  
`--demo` still works; it implies `fullstack` (current demo already has both).

Pass `stack` to `initScaffold`.

---

### 3. `packages/cli/src/init.ts` — dynamic yml generation

Add `Stack` type: `'backend' | 'frontend' | 'fullstack'`

Update `initScaffold(name, cwd, template, stack)` signature.

**Templates × Stack matrix:**

|         | backend                 | frontend                          | fullstack                         |
| ------- | ----------------------- | --------------------------------- | --------------------------------- |
| minimal | fn + table, no frontend | frontend block only, no functions | fn + table + frontend block       |
| demo    | current demo yml        | n/a (demo is backend-heavy)       | current demo yml + frontend block |

**Files scaffolded per stack:**

**backend** (no change from current `minimal`):

```
my-app/
  slsv.yml         # functions + tables, NO frontend block
  src/api.ts
  tsconfig.json
  package.json
  .env.example
```

**frontend** (new):

```
my-app/
  slsv.yml         # frontend: { src: ./frontend, build: "npm run build" }, NO functions
  frontend/
    index.html     # basic HTML with a script tag
    package.json   # { "scripts": { "build": "vite build", "dev": "vite" }, "devDeps": { "vite": "..." } }
    vite.config.ts # minimal vite config
    src/
      main.ts      # console.log("hello from slsv frontend")
  .env.example
```

**fullstack** (new):

```
my-app/
  slsv.yml         # functions + tables + frontend block
  src/api.ts       # same as backend
  frontend/
    index.html
    package.json
    vite.config.ts
    src/main.ts    # fetches /api/hello
  tsconfig.json
  package.json
  .env.example
```

---

### slsv.yml shapes

**backend (minimal)**

```yaml
app: my-app
functions:
  api:
    runtime: nodejs20
    handler: ./src/api.handler
    http:
      - method: ANY
        path: /api/{proxy+}
tables:
  items:
    partitionKey: id
```

**frontend only**

```yaml
app: my-app
frontend:
  src: ./frontend
  build: npm run build
```

**fullstack**

```yaml
app: my-app
functions:
  api:
    runtime: nodejs20
    handler: ./src/api.handler
    http:
      - method: ANY
        path: /api/{proxy+}
tables:
  items:
    partitionKey: id
frontend:
  src: ./frontend
  build: npm run build
```

---

### 4. `outro` message per stack

- **backend**: `cd my-app && cp .env.example .env && slsv dev`
- **frontend**: `cd my-app && cd frontend && npm install && cd .. && slsv dev`
- **fullstack**: `cd my-app && cp .env.example .env && cd frontend && npm install && cd .. && slsv dev`

---

## Files Modified

| File                                      | Change                                          |
| ----------------------------------------- | ----------------------------------------------- |
| `packages/cli/src/config.ts`              | `functions` → optional, `?? {}` guards          |
| `packages/cli/src/cli.ts`                 | Add `stack` select prompt; pass to initScaffold |
| `packages/cli/src/init.ts`                | Add `Stack` type, dynamic yml + file generation |
| `packages/cli/src/dev.ts`                 | `cfg.functions ?? {}` guards                    |
| `packages/cli/src/deploy.ts`              | `cfg.functions ?? {}` guards                    |
| `packages/cli/src/providers/aws/index.ts` | `cfg.functions ?? {}` guard                     |

**No new dependencies.** `@clack/prompts` already installed (used for name prompt).

---

## Out of Scope

- Frontend deployment to real S3/CloudFront (already implemented in AwsProvider)
- Demo template frontend variant (low value, demo is backend showcase)
- `--stack` CLI flag (prompt is sufficient; power users use `--yes` + edit yml)

---

## GSTACK REVIEW REPORT

_Pending review._
