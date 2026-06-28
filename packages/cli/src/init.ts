import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

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
      writeFileSync(path.join(dir, 'package.json'), PKG_JSON(name))
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
  return existsSync(localSdk) ? `file:${path.relative(dir, localSdk)}` : '^0.1.0'
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

tables:
  items:
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

const MINIMAL_API_HANDLER = `import { db } from '@slsv/sdk'

export const handler = async (event: any) => {
  const method = event.httpMethod as string
  const path = event.path as string

  if (path === '/api/health') return json(200, { status: 'ok' })

  if (method === 'POST' && path.startsWith('/api/items')) {
    const body = JSON.parse(event.body ?? '{}')
    const id = Date.now().toString()
    await db('items').put({ id, ...body })
    return json(201, { id })
  }

  if (method === 'GET' && path.startsWith('/api/items')) {
    return json(200, await db('items').scan())
  }

  return json(404, { error: 'not found' })
}

function json(statusCode: number, body: unknown) {
  return { statusCode, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
}
`

// ─── Demo template ──────────────────────────────────────────────────────────

const DEMO_SLSV_YML = (name: string) => `app: ${name}

functions:
  api:
    runtime: nodejs22
    handler: ./src/api.handler
    http:
      - method: ANY
        path: /api/{proxy+}
      - method: GET
        path: /health

  paymentWebhook:
    runtime: nodejs22
    handler: ./src/webhooks/payment.handler
    http:
      - method: POST
        path: /webhooks/payment

  sendReceipt:
    runtime: nodejs22
    handler: ./src/jobs/send-receipt.handler
    queue:
      name: emailQueue

  dailyInvoice:
    runtime: nodejs22
    handler: ./src/jobs/daily-invoice.handler
    cron:
      schedule: "0 8 * * *"

queues:
  emailQueue:
    type: sqs

tables:
  invoices:
    partitionKey:
      name: id
      type: S
    sortKey:
      name: createdAt
      type: S

buckets:
  receipts: {}

secrets:
  - WEBHOOK_SECRET
  - JWT_SECRET
`

// Values are valid as-is for local dev — no external signup required
const DEMO_ENV_EXAMPLE = `WEBHOOK_SECRET=local-webhook-secret
JWT_SECRET=local-jwt-secret
`

const DEMO_API_HANDLER = `import { db } from '@slsv/sdk'

export const handler = async (event: any) => {
  const method = event.httpMethod as string
  const path = event.path as string

  if (path === '/api/health') return json(200, { status: 'ok' })

  if (method === 'POST' && path.startsWith('/api/invoices')) {
    const body = JSON.parse(event.body ?? '{}')
    const id = Date.now().toString()
    const createdAt = new Date().toISOString()
    await db('invoices').put({ id, createdAt, ...body })
    return json(201, { id, createdAt })
  }

  if (method === 'GET' && path.startsWith('/api/invoices')) {
    return json(200, await db('invoices').scan())
  }

  return json(404, { error: 'not found' })
}

function json(statusCode: number, body: unknown) {
  return { statusCode, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
}
`

const PAYMENT_HANDLER = `import { queue } from '@slsv/sdk'

export const handler = async (event: any) => {
  const secret = event.headers?.['x-webhook-secret']
  if (secret !== process.env.WEBHOOK_SECRET) {
    return { statusCode: 401, body: 'Unauthorized' }
  }

  const body = JSON.parse(event.body ?? '{}') as { invoiceId: string; email: string; amount: number }

  await queue('emailQueue').send({
    email: body.email,
    invoiceId: body.invoiceId,
  })

  return { statusCode: 200, body: 'ok' }
}
`

const SEND_RECEIPT_HANDLER = `import { storage } from '@slsv/sdk'

export const handler = async (event: any) => {
  for (const record of event.Records ?? []) {
    const { email, invoiceId } = JSON.parse(record.body) as { email: string; invoiceId: string }
    console.log(\`Sending receipt to \${email} for invoice \${invoiceId}\`)

    await storage('receipts').put(
      \`receipts/\${invoiceId}.txt\`,
      \`Receipt for invoice \${invoiceId} sent to \${email} at \${new Date().toISOString()}\`,
    )
  }
}
`

const DAILY_INVOICE_HANDLER = `import { db } from '@slsv/sdk'

export const handler = async () => {
  const invoices = await db('invoices').scan()
  console.log(\`Daily summary: \${invoices.length} invoices\`)
  return { processed: invoices.length }
}
`

// ─── Shared ─────────────────────────────────────────────────────────────────

const PKG_JSON = (name: string) =>
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
        '@slsv/sdk': '^0.1.0',
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
