import { readFileSync, existsSync, readdirSync } from 'fs'
import path from 'path'
import type { AppConfig } from './config.js'
import { ConfigError } from './config.js'

// Preflight lint run before every dev/deploy: does slsv.yml actually match the code?
// Three checks — (1) each function's handler file exists and exports the named symbol,
// (2) every @slsv/sdk accessor call (db/sql/queue/cache/storage/secret) names a resource
// declared in the yml (+ warn on declared-but-unused), (3) queue/dlq triggers point at a
// real queue. Errors abort the deploy (thrown as ConfigError, printed without a stack);
// warnings just print. Catches the class of bug that otherwise fails deep in esbuild or at
// runtime with a cryptic message.

// SDK accessor → the yml block it must resolve against, for human-readable errors.
const ACCESSOR_LABEL: Record<string, string> = {
  db: 'dynamodb database',
  sql: 'postgres/mysql database',
  queue: 'queue',
  cache: 'cache',
  storage: 'bucket',
  secret: 'secret',
}

// Directories/files never worth scanning for SDK calls.
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'frontend', '.git', '.slsv'])
const isScannable = (f: string) =>
  f.endsWith('.ts') && !f.endsWith('.d.ts') && !f.endsWith('.test.ts')

function sourceFiles(cwd: string): string[] {
  // Node 20+ recursive listing; cheap enough for a project tree.
  return readdirSync(cwd, { recursive: true, encoding: 'utf8' })
    .filter((rel) => isScannable(rel) && !rel.split(path.sep).some((seg) => SKIP_DIRS.has(seg)))
    .map((rel) => path.join(cwd, rel))
}

export function lintApp(cfg: AppConfig, cwd: string): void {
  const errors: string[] = []
  const warnings: string[] = []

  // Valid logical names per accessor, derived from the yml.
  const dbs = Object.entries(cfg.databases ?? {})
  const nameSets: Record<string, Set<string>> = {
    db: new Set(dbs.filter(([, d]) => d.type === 'dynamodb').map(([k]) => k)),
    sql: new Set(dbs.filter(([, d]) => d.type !== 'dynamodb').map(([k]) => k)),
    queue: new Set(Object.keys(cfg.queues ?? {})),
    cache: new Set(Object.keys(cfg.caches ?? {})),
    storage: new Set(Object.keys(cfg.buckets ?? {})),
    secret: new Set(cfg.secrets ?? []),
  }
  const referenced = Object.fromEntries(
    Object.keys(ACCESSOR_LABEL).map((k) => [k, new Set<string>()]),
  ) as Record<string, Set<string>>

  // --- Check 1: handler files + exports (mirror bundle.ts's `file.export` resolution) ---
  for (const [name, fn] of Object.entries(cfg.functions ?? {})) {
    const dot = fn.handler.lastIndexOf('.')
    if (dot < 1) {
      errors.push(`function ${name}: handler '${fn.handler}' must be '<file>.<export>' (e.g. ./src/api.handler)`)
      continue
    }
    const filePart = fn.handler.slice(0, dot)
    const exportName = fn.handler.slice(dot + 1)
    // bundle.ts compiles `${filePart}.ts` — check the same path so lint matches reality.
    const entry = path.resolve(cwd, `${filePart}.ts`)
    if (!existsSync(entry)) {
      errors.push(`function ${name}: handler file not found: ${filePart}.ts (handler: ${fn.handler})`)
      continue
    }
    if (!exportsSymbol(readFileSync(entry, 'utf8'), exportName))
      errors.push(`function ${name}: ${filePart}.ts does not export '${exportName}'`)
  }

  // --- Check 2: SDK accessor names ↔ yml. Only trust calls of names actually imported from
  // '@slsv/sdk' (avoids false positives on same-named local methods like `this.queue()`). ---
  for (const file of sourceFiles(cwd)) {
    const src = readFileSync(file, 'utf8')
    const imported = sdkImports(src) // localName -> accessor (handles `db as ddb` aliases)
    if (!imported.size) continue
    const rel = path.relative(cwd, file)
    for (const [local, accessor] of imported) {
      const call = new RegExp(`\\b${local}\\s*\\(\\s*['"]([^'"]+)['"]`, 'g')
      for (const m of src.matchAll(call)) {
        const logical = m[1]
        referenced[accessor].add(logical)
        if (!nameSets[accessor].has(logical))
          errors.push(
            `${rel}: ${local}('${logical}') — no ${ACCESSOR_LABEL[accessor]} '${logical}' in slsv.yml`,
          )
      }
    }
  }
  // Declared but never referenced anywhere in code — likely dead config (warning, not fatal).
  for (const accessor of Object.keys(nameSets))
    for (const declared of nameSets[accessor])
      if (!referenced[accessor].has(declared))
        warnings.push(`${ACCESSOR_LABEL[accessor]} '${declared}' declared in slsv.yml but never used in code`)

  // --- Check 3: trigger targets exist ---
  for (const [name, fn] of Object.entries(cfg.functions ?? {}))
    if (fn.queue && !nameSets.queue.has(fn.queue.name))
      errors.push(`function ${name}: queue trigger '${fn.queue.name}' not declared in queues:`)
  for (const [name, q] of Object.entries(cfg.queues ?? {}))
    if (q.dlq && !nameSets.queue.has(q.dlq))
      errors.push(`queue ${name}: dlq '${q.dlq}' not declared in queues:`)

  for (const w of warnings) console.warn(`⚠ lint: ${w}`)
  if (errors.length)
    throw new ConfigError(`slsv.yml does not match code (${errors.length}):\n${errors.map((e) => `  ✗ ${e}`).join('\n')}`)
}

// Parse `import { db, queue as q } from '@slsv/sdk'` → Map(local -> accessor). Only accessors
// we know about are returned. ponytail: static single-line import shape (what scaffolds emit);
// a `import * as slsv` namespace or multi-line split isn't parsed — add if a real app needs it.
function sdkImports(src: string): Map<string, string> {
  const out = new Map<string, string>()
  const m = src.match(/import\s*\{([^}]*)\}\s*from\s*['"]@slsv\/sdk['"]/)
  if (!m) return out
  for (const tok of m[1].split(',')) {
    const [orig, alias] = tok.trim().split(/\s+as\s+/)
    const accessor = orig?.trim()
    if (accessor && accessor in ACCESSOR_LABEL) out.set((alias ?? orig).trim(), accessor)
  }
  return out
}

// True if source has a top-level export of `name`. Covers the shapes handlers use:
// `export const/function/async function/let/var/class name`, and `export { name }` /
// `export { x as name }`. ponytail: regex, not AST — a re-export from another module
// (`export * from`) or a computed export slips through; fine for the scaffolded handler shape.
function exportsSymbol(src: string, name: string): boolean {
  const n = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  if (new RegExp(`export\\s+(async\\s+)?(function|const|let|var|class)\\s+${n}\\b`).test(src)) return true
  // `export { a, b as name }` — check any export-brace block for `name` as the exported id.
  for (const m of src.matchAll(/export\s*\{([^}]*)\}/g))
    if (m[1].split(',').some((t) => t.trim().split(/\s+as\s+/).pop()?.trim() === name)) return true
  return false
}
