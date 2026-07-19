import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

// Injected by tsup at build time (see tsup.config.ts) — the SDK version this CLI ships with.
declare const __SDK_VERSION__: string;

export type Template = "minimal" | "demo" | "api-db";
export type Stack = "backend" | "frontend" | "fullstack";

export function initScaffold(
  name: string,
  parentDir: string,
  template: Template = "minimal",
  stack: Stack = "fullstack",
) {
  const dir = path.join(parentDir, name);
  const hasBackend = stack !== "frontend";
  const hasFrontend = stack !== "backend";

  if (template === "api-db") {
    scaffoldApiDb(dir, name);
    writeFileSync(path.join(dir, "AGENTS.md"), agentsMd());
    return;
  }

  if (template === "minimal") {
    if (hasBackend) {
      mkdirSync(path.join(dir, "backend/routes/links"), { recursive: true });
      mkdirSync(path.join(dir, "backend/routes/health"), { recursive: true });
      mkdirSync(path.join(dir, "backend/lib"), { recursive: true });
      mkdirSync(path.join(dir, "test"), { recursive: true });
      writeFileSync(path.join(dir, "package.json"), PKG_JSON(name, dir));
      writeFileSync(path.join(dir, "tsconfig.json"), TSCONFIG);
      writeFileSync(path.join(dir, ".env.example"), MINIMAL_ENV_EXAMPLE);
      // File-based routing: root loader + one file per handler, aggregated per feature folder.
      // Add an endpoint = new file + one line in that feature's index; scales to many routes.
      writeFileSync(path.join(dir, "backend/routes/route.ts"), MINIMAL_ROUTE_LOADER);
      writeFileSync(path.join(dir, "backend/lib/store.ts"), MINIMAL_STORE);
      writeFileSync(path.join(dir, "backend/routes/health/index.ts"), MINIMAL_HEALTH_INDEX);
      writeFileSync(path.join(dir, "backend/routes/health/check.ts"), MINIMAL_HEALTH_CHECK);
      writeFileSync(path.join(dir, "backend/routes/links/index.ts"), MINIMAL_LINKS_INDEX);
      writeFileSync(path.join(dir, "backend/routes/links/list.ts"), MINIMAL_LINKS_LIST);
      writeFileSync(path.join(dir, "backend/routes/links/create.ts"), MINIMAL_LINKS_CREATE);
      writeFileSync(path.join(dir, "test/route.test.ts"), MINIMAL_API_TEST);
      writeFileSync(path.join(dir, "vitest.config.ts"), VITEST_CONFIG);
    }
    if (hasFrontend) {
      mkdirSync(path.join(dir, "frontend/src"), { recursive: true });
      writeFileSync(path.join(dir, "frontend/index.html"), FRONTEND_HTML(name));
      writeFileSync(path.join(dir, "frontend/package.json"), FRONTEND_PKG_JSON(name));
      writeFileSync(path.join(dir, "frontend/vite.config.ts"), FRONTEND_VITE_CONFIG);
      writeFileSync(
        path.join(dir, "frontend/src/main.ts"),
        hasBackend ? FRONTEND_MAIN_FULLSTACK : FRONTEND_MAIN_STANDALONE,
      );
      writeFileSync(path.join(dir, "frontend/src/vite-env.d.ts"), FRONTEND_VITE_ENV_DTS);
      writeFileSync(path.join(dir, "frontend/pnpm-workspace.yaml"), PNPM_WORKSPACE);
    }
    if (!hasBackend) {
      writeFileSync(path.join(dir, ".env.example"), FRONTEND_ENV_EXAMPLE);
    }
    writeFileSync(path.join(dir, "slsv.yml"), MINIMAL_SLSV_YML(name, stack));
    writeFileSync(path.join(dir, ".gitignore"), GITIGNORE);
    writeFileSync(path.join(dir, "pnpm-workspace.yaml"), PNPM_WORKSPACE);
    writeStageEnvFiles(dir); // .env.local / .env.dev / .env.prod (no secrets in this template)
  } else {
    copyDemoTemplate(dir, name);
  }
  writeFileSync(path.join(dir, "AGENTS.md"), agentsMd());
}

function copyDemoTemplate(dir: string, name: string) {
  cpSync(demoTemplateDir(), dir, {
    recursive: true,
    filter: (src) =>
      !src.includes(`${path.sep}node_modules${path.sep}`) &&
      path.basename(src) !== "package-lock.json",
  });
  replaceInFile(path.join(dir, "slsv.yml"), /^app: .+$/m, `app: ${name}`);
  replaceInFile(path.join(dir, "package.json"), /"name": "[^"]+"/, `"name": "${name}"`);
  replaceInFile(
    path.join(dir, "package.json"),
    /"@slsv\/sdk": "workspace:\*"/,
    `"@slsv/sdk": "${sdkDependency(dir)}"`,
  );
  // The demo's tracked files are only the `.env*.example` twins (real `.env.*` is gitignored, so
  // it never ships in the package) — generate the real per-stage env files here.
  writeStageEnvFiles(dir, {
    local: "WEBHOOK_SECRET=dev-secret\n",
    dev: "WEBHOOK_SECRET=dev-secret\n",
    prod: "WEBHOOK_SECRET=CHANGE_ME_prod_webhook_secret\n",
  });
}

// api-db: API-only app wired to an EXTERNAL Postgres via a connection string (Supabase/Neon/
// self-host). No `databases:` block — slsv doesn't provision it. DATABASE_URL rides in `secrets:`,
// fetched at cold start, and a lazy drizzle client connects on first query. Ships the drizzle-kit
// `db:generate` flow (schema.ts is the DDL source of truth; you apply the SQL yourself).
function scaffoldApiDb(dir: string, name: string) {
  mkdirSync(path.join(dir, "backend/database/queries"), { recursive: true });
  mkdirSync(path.join(dir, "backend/routes/health"), { recursive: true });
  mkdirSync(path.join(dir, "backend/routes/users"), { recursive: true });
  mkdirSync(path.join(dir, "test"), { recursive: true });

  writeFileSync(path.join(dir, "slsv.yml"), API_DB_SLSV_YML(name));
  writeFileSync(path.join(dir, "package.json"), API_DB_PKG_JSON(name, dir));
  writeFileSync(path.join(dir, "tsconfig.json"), API_DB_TSCONFIG);
  writeFileSync(path.join(dir, "drizzle.config.ts"), API_DB_DRIZZLE_CONFIG);
  writeFileSync(path.join(dir, "vitest.config.ts"), VITEST_CONFIG);
  writeFileSync(path.join(dir, ".gitignore"), GITIGNORE);
  writeFileSync(path.join(dir, "pnpm-workspace.yaml"), PNPM_WORKSPACE);
  writeFileSync(path.join(dir, ".env.example"), API_DB_ENV_EXAMPLE);
  writeFileSync(path.join(dir, ".env.local"), API_DB_ENV_LOCAL(name));
  writeFileSync(path.join(dir, ".env.dev"), API_DB_ENV_DEV(name));
  writeFileSync(path.join(dir, ".env.prod"), API_DB_ENV_PROD(name));

  writeFileSync(path.join(dir, "backend/database/schema.ts"), API_DB_SCHEMA);
  writeFileSync(path.join(dir, "backend/database/index.ts"), API_DB_CLIENT);
  writeFileSync(path.join(dir, "backend/database/queries/users.ts"), API_DB_QUERY_USERS);

  writeFileSync(path.join(dir, "backend/routes/route.ts"), API_DB_ROUTE_LOADER);
  writeFileSync(path.join(dir, "backend/routes/health/index.ts"), MINIMAL_HEALTH_INDEX);
  writeFileSync(path.join(dir, "backend/routes/health/check.ts"), API_DB_HEALTH_CHECK);
  writeFileSync(path.join(dir, "backend/routes/users/index.ts"), API_DB_USERS_INDEX);
  writeFileSync(path.join(dir, "backend/routes/users/get.ts"), API_DB_USERS_GET);

  writeFileSync(path.join(dir, "test/route.test.ts"), API_DB_ROUTE_TEST);
}

function sdkDependency(dir: string) {
  const localSdk = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../../packages/sdk",
  );
  return existsSync(localSdk) ? `file:${path.relative(dir, localSdk)}` : `^${__SDK_VERSION__}`;
}

function demoTemplateDir() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const dir = path.resolve(here, "../templates/demo");
  if (!existsSync(dir))
    throw new Error("Demo template not found. Run from repo or build templates.");
  return dir;
}

// The scaffold-time AGENTS.md — single source is templates/demo/AGENTS.md (also shipped in the
// demo via cpSync). Read lazily so the generated templates (minimal, api-db) get the same doc
// with no duplicated copy to drift.
function agentsMd(): string {
  return readFileSync(path.join(demoTemplateDir(), "AGENTS.md"), "utf-8");
}

function replaceInFile(file: string, search: RegExp, replacement: string) {
  writeFileSync(file, readFileSync(file, "utf8").replace(search, replacement));
}

// Every scaffold ships the three per-stage env files: `.env.local` (loaded by `slsv dev`,
// stage `local`), `.env.dev`, and `.env.prod`. All git-ignored (the app's .gitignore ignores
// `.env.*`) so they can hold real values/secrets without being committed. `vars` seeds each with
// starter KEY=value lines (placeholders); omit for a template with no secrets.
const STAGE_ENV_HEADER = {
  local: `# .env.local — loaded by \`slsv dev\` (stage: local). Local-machine overrides; highest
# precedence, git-ignored, never sent to the cloud. Put local-only values/secrets here.
`,
  dev: `# .env.dev — loaded by \`slsv deploy --stage dev\` (your server dev stack). git-ignored.
# Falls back to .env for any name not set here.
`,
  prod: `# .env.prod — loaded by \`slsv deploy --stage prod\`. git-ignored.
# Falls back to .env for any name not set here.
`,
};

function writeStageEnvFiles(dir: string, vars: { local?: string; dev?: string; prod?: string } = {}) {
  writeFileSync(path.join(dir, ".env.local"), STAGE_ENV_HEADER.local + (vars.local ?? ""));
  writeFileSync(path.join(dir, ".env.dev"), STAGE_ENV_HEADER.dev + (vars.dev ?? ""));
  writeFileSync(path.join(dir, ".env.prod"), STAGE_ENV_HEADER.prod + (vars.prod ?? ""));
}

export function initOutroMessage(
  name: string,
  stack: Stack,
  template: Template = "minimal",
): string {
  // api-db ships a ready .env.local (edit its DATABASE_URL for `slsv dev`) — no cp, no frontend.
  if (template === "api-db")
    return `cd ${name} && pnpm install && (edit .env.local DATABASE_URL) && slsv dev`;

  // .env.local ships with every scaffold now, so `slsv dev` reads it directly — no cp needed.
  const base = `cd ${name}`;
  const fe = `cd frontend && pnpm install && cd ..`;
  const run = "slsv dev";
  if (stack === "backend") return `${base} && pnpm install && ${run}`;
  if (stack === "frontend") return `cd ${name} && ${fe} && ${run}`;
  return `${base} && pnpm install && ${fe} && ${run}`;
}

// ─── Minimal template ──────────────────────────────────────────────────────

const MINIMAL_SLSV_YML = (name: string, stack: Stack = "fullstack") => {
  const backendBlock = `
functions:
  api:
    runtime: nodejs24
    handler: ./backend/routes/route.handler
    http:
      - method: ANY
        path: /api/{proxy+}`;

  const frontendBlock = `
frontend:
  src: ./frontend/dist
  build: cd frontend && pnpm install && pnpm run build`;

  const parts = [`app: ${name}`];
  if (stack !== "frontend") parts.push(backendBlock);
  if (stack !== "backend") parts.push(frontendBlock);
  return parts.join("\n") + "\n";
};

const MINIMAL_ENV_EXAMPLE = `# No secrets required for the minimal template
# Copy to .env and run: slsv dev
`;

// File-based routing. Root loader spreads each feature's route array into one router; every
// handler is its own file under routes/<feature>/, collected by that folder's index.ts.
const MINIMAL_ROUTE_LOADER = `import { router } from '@slsv/sdk'
import { healthRoutes } from './health'
import { linkRoutes } from './links'

// slsv.yml functions.api.handler points here. New feature = new folder + import + spread.
export const handler = router([...linkRoutes, ...healthRoutes])
`;

const MINIMAL_STORE = `// Shared in-memory store for the demo routes. Swap for db('links') when you add a table.
export type Link = { id: string; url: string; createdAt: string }

export const links = new Map<string, Link>()
`;

const MINIMAL_HEALTH_CHECK = `import { get, json } from '@slsv/sdk'

// Path is relative to the API mount (slsv.yml \`path: /api/{proxy+}\`) — API Gateway strips the
// '/api' prefix, so this route is '/health', not '/api/health'. Change the mount, routes inherit.
export const check = get('/health', () => json({ status: 'ok' }))
`;

const MINIMAL_HEALTH_INDEX = `import { check } from './check'

export const healthRoutes = [check]
`;

const MINIMAL_LINKS_LIST = `import { get, json } from '@slsv/sdk'
import { links } from '../../lib/store'

// Path '/' — links/index.ts groups it under '/links' (the slsv.yml '/api/{proxy+}' mount adds '/api').
export const list = get('/', () => json([...links.values()]))
`;

const MINIMAL_LINKS_CREATE = `import { json, post } from '@slsv/sdk'
import { links } from '../../lib/store'

export const create = post('/', (req) => {
  const body = req.body as { url?: string } | undefined
  if (!body?.url) return json({ error: 'url is required' }, 400)

  const link = { id: Date.now().toString(), url: body.url, createdAt: new Date().toISOString() }
  links.set(link.id, link)
  return json(link, 201)
})
`;

const MINIMAL_LINKS_INDEX = `import { group } from '@slsv/sdk'
import { create } from './create'
import { list } from './list'

// One file per handler, grouped under '/links'. The slsv.yml '/api/{proxy+}' mount adds the
// '/api' prefix, so these serve at '/api/links'. Add an endpoint = new file + one entry here.
export const linkRoutes = group('/links', [list, create])
`;

// Example unit test — invoke the handler with a fake API Gateway event, assert the response.
// No AWS, no Floci. Run with \`pnpm test\`.
const MINIMAL_API_TEST = `import { describe, it, expect } from 'vitest'
import { handler } from '../backend/routes/route.js'

// slsv.yml mounts the fn at '/api/{proxy+}', so API Gateway passes the sub-path (below '/api')
// in pathParameters.proxy. The router matches routes relative to the mount ('/links'), so pass
// the sub-path here — 'links', not '/api/links'.
const call = (method: string, sub: string, body?: unknown) =>
  handler({
    httpMethod: method,
    path: \`/api/\${sub}\`,
    pathParameters: { proxy: sub },
    headers: {},
    body: body === undefined ? undefined : JSON.stringify(body),
  } as never) as Promise<{ statusCode: number; body: string }>

describe('api', () => {
  it('health check returns ok', async () => {
    const res = await call('GET', 'health')
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).status).toBe('ok')
  })

  it('rejects a link with no url (400)', async () => {
    const res = await call('POST', 'links', {})
    expect(res.statusCode).toBe(400)
  })

  it('creates a link, then lists it', async () => {
    const created = await call('POST', 'links', { url: 'https://slsv.dev' })
    expect(created.statusCode).toBe(201)
    const id = JSON.parse(created.body).id
    const list = JSON.parse((await call('GET', 'links')).body)
    expect(list.some((l: { id: string }) => l.id === id)).toBe(true)
  })
})
`;

// Pin test discovery so a scaffold nested inside another repo doesn't inherit a
// parent vitest.config walked up the tree (wrong `include` → "No test files found").
const VITEST_CONFIG = `import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: { include: ['test/**/*.test.ts'] },
})
`;

const PKG_JSON = (name: string, dir: string) =>
  JSON.stringify(
    {
      name,
      version: "0.1.0",
      private: true,
      type: "module",
      scripts: {
        build: "tsc",
        test: "vitest run",
      },
      dependencies: {
        // file: link to the local SDK when scaffolding from a source checkout (dev);
        // published version once @slsv/sdk is on npm. Same logic as the demo template.
        "@slsv/sdk": sdkDependency(dir),
      },
      devDependencies: {
        typescript: "^7.0.0",
        "@types/node": "^26.0.0",
        vite: "^8.0.0",
        vitest: "^4.1.0",
      },
    },
    null,
    2,
  );

const TSCONFIG = JSON.stringify(
  {
    compilerOptions: {
      target: "ES2022",
      module: "ESNext",
      moduleResolution: "bundler",
      strict: true,
      esModuleInterop: true,
      skipLibCheck: true,
      noEmit: true,
    },
    include: ["backend", "test"],
  },
  null,
  2,
);

// pnpm 10+ blocks native build scripts by default and exits non-zero, breaking `pnpm install`
// (esbuild arrives via the @slsv/sdk toolchain at the root and via vite in the frontend). pnpm
// 11 ignores the safer `onlyBuiltDependencies` allowlist from a config file, so this is the only
// setting it honors. Shipped at app root + frontend/. Inert for npm/yarn.
const PNPM_WORKSPACE = `dangerouslyAllowAllBuilds: true
`;

const GITIGNORE = `node_modules/
dist/
.env
.env.*
!.env*.example
.slsv/
`;

// ─── api-db template (external Postgres via URL) ───────────────────────────

const API_DB_SLSV_YML = (name: string) => `app: ${name}

functions:
  api:
    runtime: nodejs24
    handler: ./backend/routes/route.handler
    http:
      - method: ANY
        path: /api/{proxy+}
    environment:
      DB_SSL: "off" # dev/local: no TLS. database/index.ts: "off" => ssl:false, else ssl:"require"

# External Postgres (Supabase/Neon/self-host): the connection string rides in secrets:, NOT a
# databases: block — slsv doesn't provision or migrate it. Handlers fetch it at cold start.
secrets:
  - DATABASE_URL

stages:
  prod:
    functions:
      api:
        environment:
          DB_SSL: "on" # prod: any non-"off" value => ssl:"require"
`;

const API_DB_ENV_EXAMPLE = `# Reference. Put the real value in .env.local (\`slsv dev\`), .env.dev, or .env.prod.
# slsv upserts this into Secrets Manager and injects only the secret id — the value is fetched
# at runtime, never baked into the Lambda env.
DATABASE_URL=postgres://user:password@host:5432/dbname
`;

const API_DB_ENV_LOCAL = (name: string) => `# .env.local — loaded by \`slsv dev\` (stage: local). DB_SSL is "off" (slsv.yml) → no TLS.
# Point this at your LOCAL Postgres (git-ignored, never sent to the cloud).
DATABASE_URL=postgres://postgres:postgres@localhost:5432/${name}_local
`;

const API_DB_ENV_DEV = (name: string) => `# .env.dev — loaded by \`slsv deploy --stage dev\` (server dev stack). DB_SSL "off" → no TLS.
# Point this at your dev Postgres (a Supabase/Neon dev branch or a dev RDS).
DATABASE_URL=postgres://postgres:postgres@DEV-HOST:5432/${name}_dev
`;

const API_DB_ENV_PROD = (name: string) => `# prod stage. DB_SSL is "on" (slsv.yml stages.prod) → ssl:"require".
# TODO: fill with the real prod Postgres URL before \`slsv deploy --stage prod\`.
DATABASE_URL=postgres://USER:PASSWORD@PROD-HOST:5432/${name}_prod
`;

const API_DB_DRIZZLE_CONFIG = `import { defineConfig } from "drizzle-kit";

// schema.ts is the source of truth for the DDL. \`pnpm db:generate\` diffs it and writes SQL
// migration files — it does NOT touch the DB. You apply the SQL yourself (psql/CI); slsv never
// runs migrations (external DB). DATABASE_URL comes from --env-file=.env.dev (see package.json).
export default defineConfig({
  schema: "./backend/database/schema.ts",
  out: "./backend/database/migrations",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL! },
});
`;

const API_DB_SCHEMA = `import { pgTable, uuid, text, timestamp } from "drizzle-orm/pg-core";

// Starter table. Edit this, then \`pnpm db:generate\` to emit the migration SQL, and apply it
// yourself. This file is the typed source of truth the queries import.
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  name: text("name"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
`;

const API_DB_CLIENT = `import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

// Lazy Postgres client. Build it on FIRST query, not at import — the route prelude
// (backend/routes/route.ts) fetches DATABASE_URL into process.env at cold start, which runs
// before any handler body. The Proxy keeps every \`db.x\` call site unchanged while deferring
// the connection until env is populated.
let real: PostgresJsDatabase<typeof schema> | undefined;

function build() {
  const url = process.env.DATABASE_URL;
  if (!url)
    throw new Error("slsv: DATABASE_URL missing — declare it in secrets: (loaded at cold start)");
  const client = postgres(url, {
    max: Number(process.env.DB_POOL_MAX ?? 3), // keep low for serverless/pgBouncer
    idle_timeout: 20,
    connect_timeout: 10,
    prepare: false, // safe with transaction poolers (Supabase 6543, pgBouncer)
    ssl: process.env.DB_SSL === "off" ? false : "require",
  });
  return drizzle(client, { schema });
}

// ponytail: Proxy defers client creation to first query so env is populated first. Drop it if
// this module ever gets an explicit async init.
export const db = new Proxy({} as PostgresJsDatabase<typeof schema>, {
  get: (_t, p) => ((real ??= build()) as never)[p],
});
`;

const API_DB_QUERY_USERS = `import { eq } from "drizzle-orm";
import { db } from "../index";
import { users } from "../schema";

// One query per concern; add more files under queries/ as the app grows.
export async function getUserById(id: string) {
  return db.query.users.findFirst({ where: eq(users.id, id) });
}
`;

const API_DB_ROUTE_LOADER = `import { router, secret } from '@slsv/sdk'
import { healthRoutes } from './health'
import { userRoutes } from './users'

// slsv.yml functions.api.handler points here. New feature = new folder + import + spread.
const dispatch = router([...userRoutes, ...healthRoutes])

// Cold-start prelude: pull the DATABASE_URL secret into process.env once, before any handler
// runs, so the lazy db client (backend/database/index.ts) can read it synchronously. secret()
// caches per container, so this is a first-invocation cost only.
let envReady = false
export const handler = async (event: unknown) => {
  if (!envReady) {
    process.env.DATABASE_URL ??= await secret('DATABASE_URL')
    envReady = true
  }
  return dispatch(event as never)
}
`;

const API_DB_HEALTH_CHECK = `import { get, json } from '@slsv/sdk'

// Path is relative to the API mount (slsv.yml \`path: /api/{proxy+}\`) — serves at '/api/health'.
export const check = get('/health', () => json({ status: 'ok' }))
`;

const API_DB_USERS_INDEX = `import { group } from '@slsv/sdk'
import { getOne } from './get'

// Grouped under '/users' (mount adds '/api' → '/api/users'). Add an endpoint = new file + entry.
export const userRoutes = group('/users', [getOne])
`;

const API_DB_USERS_GET = `import { get, json } from '@slsv/sdk'
import { getUserById } from '../../database/queries/users'

// GET /api/users/{id} — proof the external Postgres round-trips through a query module.
export const getOne = get('/{id}', async (req) => {
  const user = await getUserById(req.params.id)
  return user ? json(user) : json({ error: 'not found' }, 404)
})
`;

const API_DB_ROUTE_TEST = `import { describe, it, expect, beforeAll } from 'vitest'

// The handler's cold-start prelude does \`process.env.DATABASE_URL ??= await secret(...)\`. Set a
// dummy URL first so it skips the Secrets Manager fetch (no Floci here). Health doesn't touch the
// DB, so no real connection is made; DB routes are verified end-to-end via \`slsv dev\`.
let handler: (e: unknown) => Promise<{ statusCode: number; body: string }>

beforeAll(async () => {
  process.env.DATABASE_URL = 'postgres://localhost:5432/test'
  ;({ handler } = (await import('../backend/routes/route.js')) as {
    handler: (e: unknown) => Promise<{ statusCode: number; body: string }>
  })
})

// slsv.yml mounts the fn at '/api/{proxy+}', so API Gateway passes the sub-path in
// pathParameters.proxy. The router matches routes relative to the mount ('/health').
const call = (method: string, sub: string) =>
  handler({ httpMethod: method, path: \`/api/\${sub}\`, pathParameters: { proxy: sub }, headers: {} })

describe('api', () => {
  it('health check returns ok', async () => {
    const res = await call('GET', 'health')
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).status).toBe('ok')
  })

  it('404s an unknown route', async () => {
    const res = await call('GET', 'nope')
    expect(res.statusCode).toBe(404)
  })
})
`;

const API_DB_TSCONFIG = JSON.stringify(
  {
    ...(JSON.parse(TSCONFIG) as Record<string, unknown>),
    compilerOptions: {
      ...(JSON.parse(TSCONFIG) as { compilerOptions: Record<string, unknown> }).compilerOptions,
      types: ["node"], // drizzle/postgres need node globals (process, Buffer)
    },
  },
  null,
  2,
);

const API_DB_PKG_JSON = (name: string, dir: string) =>
  JSON.stringify(
    {
      name,
      version: "0.1.0",
      private: true,
      type: "module",
      scripts: {
        build: "tsc",
        test: "vitest run",
        // Offline: diffs schema.ts → SQL migration files. Never touches the DB (you apply the
        // SQL yourself). --env-file loads DATABASE_URL for the config; generate ignores creds.
        "db:generate": "node --env-file=.env.dev node_modules/drizzle-kit/bin.cjs generate",
      },
      dependencies: {
        "@slsv/sdk": sdkDependency(dir),
        "drizzle-orm": "^0.45.2",
        postgres: "^3.4.9",
      },
      devDependencies: {
        "drizzle-kit": "^0.31.10",
        typescript: "^7.0.0",
        "@types/node": "^26.0.0",
        vitest: "^4.1.0",
      },
    },
    null,
    2,
  );

// ─── Frontend scaffold ────────────────────────────────────────────────────

const FRONTEND_HTML = (name: string) => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${name}</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
`;

const FRONTEND_PKG_JSON = (name: string) =>
  JSON.stringify(
    {
      name: `${name}-frontend`,
      version: "0.1.0",
      private: true,
      type: "module",
      scripts: {
        dev: "vite",
        build: "vite build",
        preview: "vite preview",
        lint: "oxlint . && tsc --noEmit",
        format: "oxfmt .",
        "format:check": "oxfmt --check .",
      },
      devDependencies: {
        oxfmt: "^0.58.0",
        oxlint: "^1.73.0",
        typescript: "^7.0.0",
        vite: "^8.0.0",
      },
    },
    null,
    2,
  ) + "\n";

const FRONTEND_VITE_CONFIG = `import { defineConfig } from "vite";

export default defineConfig({
  server: {
    proxy: {
      "/api": {
        target: process.env.SLSV_API_URL || "http://localhost:4566",
        changeOrigin: true,
      },
    },
  },
});
`;

const FRONTEND_ENV_EXAMPLE = `# No secrets required for the frontend-only template
# Copy to .env and run: slsv dev
`;

const FRONTEND_MAIN_STANDALONE = `const app = document.querySelector<HTMLDivElement>("#app")!;
app.innerHTML = "<h1>Hello from slsv</h1>";
`;

const FRONTEND_MAIN_FULLSTACK = `const app = document.querySelector<HTMLDivElement>("#app")!;
app.innerHTML = "<h1>Loading…</h1>";

// API base: your VITE_API_URL wins; else slsv injects the deployed API Gateway URL as
// VITE_SLSV_API_URL at build; else '' (relative → local \`slsv dev\` proxies /api).
const API = import.meta.env.VITE_API_URL || import.meta.env.VITE_SLSV_API_URL || "";

fetch(\`\${API}/api/health\`)
  .then((r) => r.json())
  .then((data) => {
    app.innerHTML = \`<h1>API says: \${JSON.stringify(data)}</h1>\`;
  })
  .catch(() => {
    app.innerHTML = "<h1>API unreachable — is slsv dev running?</h1>";
  });
`;

// Vite env typings so import.meta.env.VITE_* typechecks. Written to src/vite-env.d.ts.
const FRONTEND_VITE_ENV_DTS = `/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  readonly VITE_SLSV_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
`;
