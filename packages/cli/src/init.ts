import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

// Injected by tsup at build time (see tsup.config.ts) — the SDK version this CLI ships with.
declare const __SDK_VERSION__: string

export type Template = 'minimal' | 'demo'
export type Stack = 'backend' | 'frontend' | 'fullstack'

export function initScaffold(
  name: string,
  parentDir: string,
  template: Template = 'minimal',
  stack: Stack = 'fullstack',
) {
  const dir = path.join(parentDir, name)
  const hasBackend = stack !== 'frontend'
  const hasFrontend = stack !== 'backend'

  if (template === 'minimal') {
    if (hasBackend) {
      mkdirSync(path.join(dir, 'src'), { recursive: true })
      mkdirSync(path.join(dir, 'test'), { recursive: true })
      writeFileSync(path.join(dir, 'package.json'), PKG_JSON(name, dir))
      writeFileSync(path.join(dir, 'tsconfig.json'), TSCONFIG)
      writeFileSync(path.join(dir, '.env.example'), MINIMAL_ENV_EXAMPLE)
      writeFileSync(path.join(dir, 'src/api.ts'), MINIMAL_API_HANDLER)
    }
    if (hasFrontend) {
      mkdirSync(path.join(dir, 'frontend/src'), { recursive: true })
      writeFileSync(path.join(dir, 'frontend/index.html'), FRONTEND_HTML(name))
      writeFileSync(path.join(dir, 'frontend/package.json'), FRONTEND_PKG_JSON(name))
      writeFileSync(path.join(dir, 'frontend/vite.config.ts'), FRONTEND_VITE_CONFIG)
      writeFileSync(
        path.join(dir, 'frontend/src/main.ts'),
        hasBackend ? FRONTEND_MAIN_FULLSTACK : FRONTEND_MAIN_STANDALONE,
      )
    }
    if (!hasBackend) {
      writeFileSync(path.join(dir, '.env.example'), FRONTEND_ENV_EXAMPLE)
    }
    writeFileSync(path.join(dir, 'slsv.yml'), MINIMAL_SLSV_YML(name, stack))
    writeFileSync(path.join(dir, '.gitignore'), GITIGNORE)
  } else {
    copyDemoTemplate(dir, name)
  }
}

function copyDemoTemplate(dir: string, name: string) {
  cpSync(demoTemplateDir(), dir, {
    recursive: true,
    filter: (src) =>
      !src.includes(`${path.sep}node_modules${path.sep}`) &&
      path.basename(src) !== 'package-lock.json',
  })
  replaceInFile(path.join(dir, 'slsv.yml'), /^app: .+$/m, `app: ${name}`)
  replaceInFile(path.join(dir, 'package.json'), /"name": "[^"]+"/, `"name": "${name}"`)
  replaceInFile(
    path.join(dir, 'package.json'),
    /"@slsv\/sdk": "workspace:\*"/,
    `"@slsv/sdk": "${sdkDependency(dir)}"`,
  )
}

function sdkDependency(dir: string) {
  const localSdk = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../../packages/sdk',
  )
  return existsSync(localSdk) ? `file:${path.relative(dir, localSdk)}` : `^${__SDK_VERSION__}`
}

function demoTemplateDir() {
  const here = path.dirname(fileURLToPath(import.meta.url))
  const dirs = [
    path.resolve(here, '../templates/demo'),
    path.resolve(here, '../../../examples/demo'),
  ]
  const dir = dirs.find(existsSync)
  if (!dir) throw new Error('Demo template not found. Run from repo or build templates.')
  return dir
}

function replaceInFile(file: string, search: RegExp, replacement: string) {
  writeFileSync(file, readFileSync(file, 'utf8').replace(search, replacement))
}

export function initOutroMessage(
  name: string,
  stack: Stack,
  template: Template = 'minimal',
): string {
  const base = `cd ${name} && cp .env.example .env`
  const deps = template === 'demo' ? 'npm install && ' : ''
  const fe = 'cd frontend && npm install && cd ..'
  const run = 'slsv dev'
  if (stack === 'backend') return `${base} && ${deps}${run}`
  if (stack === 'frontend') return `cd ${name} && ${fe} && ${run}`
  return `${base} && ${deps}${fe} && ${run}`
}

// ─── Minimal template ──────────────────────────────────────────────────────

const MINIMAL_SLSV_YML = (name: string, stack: Stack = 'fullstack') => {
  const backendBlock = `
functions:
  api:
    runtime: nodejs22
    handler: ./src/api.handler
    http:
      - method: ANY
        path: /api/{proxy+}

databases:
  items:
    type: dynamodb
    partitionKey:
      name: id
      type: S`

  const frontendBlock = `
frontend:
  src: ./frontend
  build: npm run build`

  const parts = [`app: ${name}`]
  if (stack !== 'frontend') parts.push(backendBlock)
  if (stack !== 'backend') parts.push(frontendBlock)
  return parts.join('\n') + '\n'
}

const MINIMAL_ENV_EXAMPLE = `# No secrets required for the minimal template
# Copy to .env and run: slsv dev
`

const MINIMAL_API_HANDLER = `import { json, router } from '@slsv/sdk'

type Link = { id: string; url: string; createdAt: string }

const links = new Map<string, Link>()

export const handler = router([
  {
    method: 'GET',
    path: '/api/health',
    handler: () => json({ status: 'ok' }),
  },
  {
    method: 'POST',
    path: '/api/links',
    handler: async (req) => {
      const body = req.body as { url?: string } | undefined
      if (!body?.url) return json({ error: 'url is required' }, 400)

      const link = {
        id: Date.now().toString(),
        url: body.url,
        createdAt: new Date().toISOString(),
      }
      links.set(link.id, link)
      return json(link, 201)
    },
  },
  {
    method: 'GET',
    path: '/api/links',
    handler: async () => json([...links.values()]),
  },
])
`

const PKG_JSON = (name: string, dir: string) =>
  JSON.stringify(
    {
      name,
      version: '0.1.0',
      private: true,
      type: 'module',
      scripts: {
        build: 'tsc',
        test: 'vitest run',
      },
      dependencies: {
        // file: link to the local SDK when scaffolding from a source checkout (dev);
        // published version once @slsv/sdk is on npm. Same logic as the demo template.
        '@slsv/sdk': sdkDependency(dir),
      },
      devDependencies: {
        typescript: '^5.4.0',
        '@types/node': '^20.0.0',
        vitest: '^1.4.0',
      },
    },
    null,
    2,
  )

const TSCONFIG = JSON.stringify(
  {
    compilerOptions: {
      target: 'ES2022',
      module: 'ESNext',
      moduleResolution: 'bundler',
      strict: true,
      esModuleInterop: true,
      skipLibCheck: true,
      noEmit: true,
    },
    include: ['src', 'test'],
  },
  null,
  2,
)

const GITIGNORE = `node_modules/
dist/
.env
.env.*
!.env*.example
.slsv/
`

// ─── Frontend scaffold ────────────────────────────────────────────────────

const FRONTEND_HTML = (name: string) => `<!DOCTYPE html>
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
`

const FRONTEND_PKG_JSON = (name: string) =>
  JSON.stringify(
    {
      name: `${name}-frontend`,
      version: '0.1.0',
      private: true,
      type: 'module',
      scripts: {
        dev: 'vite',
        build: 'vite build',
        preview: 'vite preview',
      },
      devDependencies: {
        vite: '^5.0.0',
        typescript: '^5.4.0',
      },
    },
    null,
    2,
  )

const FRONTEND_VITE_CONFIG = `import { defineConfig } from 'vite'

export default defineConfig({
  server: {
    proxy: {
      '/api': {
        target: process.env.SLSV_API_URL || 'http://localhost:4566',
        changeOrigin: true,
      },
    },
  },
})
`

const FRONTEND_ENV_EXAMPLE = `# No secrets required for the frontend-only template
# Copy to .env and run: slsv dev
`

const FRONTEND_MAIN_STANDALONE = `const app = document.querySelector<HTMLDivElement>('#app')!
app.innerHTML = '<h1>Hello from slsv</h1>'
`

const FRONTEND_MAIN_FULLSTACK = `const app = document.querySelector<HTMLDivElement>('#app')!
app.innerHTML = '<h1>Loading…</h1>'

fetch('/api/health')
  .then(r => r.json())
  .then(data => { app.innerHTML = \`<h1>API says: \${JSON.stringify(data)}</h1>\` })
  .catch(() => { app.innerHTML = '<h1>API unreachable — is slsv dev running?</h1>' })
`
