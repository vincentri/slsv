import { createServer } from 'http'
import { createReadStream, statSync, existsSync } from 'fs'
import path from 'path'
import { GetObjectCommand } from '@aws-sdk/client-s3'
import { makeClients, type Clients } from './clients.js'
import type { Account } from './config.js'
import {
  overview,
  scanTable,
  queryTable,
  peekQueue,
  listObjects,
  getObject,
  headObject,
  getObjectAcl,
  deleteObject,
  getBucket,
  tailLogs,
  scanCache,
  getFunction,
  getApi,
  getSecret,
  getBus,
  getRule,
  resolveSqlConn,
} from './inspect.js'
import { listTables, peekTable, runQuery } from './sql.js'

type Entry = { config: Account; clients: Clients }

function isAuthError(e: any): boolean {
  return (
    e.name === 'ExpiredTokenException' ||
    e.name === 'UnauthorizedException' ||
    e.name === 'CredentialsProviderError' ||
    e.$metadata?.httpStatusCode === 401
  )
}

export function startServer(opts: { accounts: Account[]; port?: number }) {
  const port = opts.port ?? 4567
  // one client-set per account, built lazily, cached
  const entries = new Map<string, Entry>()
  const get = (name: string): Entry => {
    if (!entries.has(name)) {
      const config = opts.accounts.find((a) => a.name === name)
      if (!config) throw new Error(`Unknown account: ${name}`)
      entries.set(name, { config, clients: makeClients(config) })
    }
    return entries.get(name)!
  }

  const uiDist = resolveUiDist()

  const json = (res: any, body: unknown, code = 200) => {
    res.writeHead(code, { 'content-type': 'application/json', 'access-control-allow-origin': '*' })
    res.end(JSON.stringify(body))
  }

  const server = createServer(async (req, res) => {
    const url = new URL(req.url!, `http://localhost:${port}`)
    const p = url.pathname
    const q = url.searchParams

    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'access-control-allow-origin': '*',
        'access-control-allow-headers': '*',
      })
      return res.end()
    }

    try {
      // account list (no account scope)
      if (p === '/api/accounts') {
        return json(
          res,
          opts.accounts.map((a) => ({
            name: a.name,
            region: a.region ?? 'us-east-1',
            endpoint: a.endpoint,
            kind: a.endpoint ? 'local' : 'aws',
          })),
        )
      }

      // /api/v1/<account>/<resource>/...
      if (p.startsWith('/api/v1/')) {
        const seg = p.replace('/api/v1/', '').split('/').filter(Boolean)
        const [acctName, resource, ...rest] = seg
        const { config, clients } = get(acctName)

        try {
          if (resource === 'overview') return json(res, await overview(clients, config))

          if (resource === 'table' && rest[0]) {
            if (rest[1] === 'query')
              return json(
                res,
                await queryTable(clients, rest[0], {
                  pk: q.get('pk') ?? '',
                  pkName: q.get('pkName') ?? 'id',
                  sk: q.get('sk') ?? undefined,
                  op: q.get('op') ?? undefined,
                  index: q.get('index') ?? undefined,
                  limit: Number(q.get('limit') ?? 100),
                  cursor: q.get('cursor') ?? undefined,
                }),
              )
            return json(
              res,
              await scanTable(clients, rest[0], {
                cursor: q.get('cursor') ?? undefined,
                index: q.get('index') ?? undefined,
                limit: Number(q.get('limit') ?? 100),
              }),
            )
          }

          if (resource === 'queue' && rest[0])
            return json(res, await peekQueue(clients, rest[0], Number(q.get('max') ?? 10)))

          if (resource === 'bucket' && rest[0]) {
            const key = q.get('key') ?? ''
            if (rest[1] === 'object') {
              if (req.method === 'DELETE') {
                await deleteObject(clients, rest[0], key)
                return json(res, { ok: true })
              }
              if (q.has('head')) return json(res, await headObject(clients, rest[0], key))
              return json(res, await getObject(clients, rest[0], key))
            }
            if (rest[1] === 'object-acl')
              return json(res, await getObjectAcl(clients, rest[0], key))
            if (rest[1] === 'raw') {
              try {
                const r = await clients.s3.send(new GetObjectCommand({ Bucket: rest[0], Key: key }))
                const bytes = await r.Body!.transformToByteArray()
                const ext = key.split('.').pop()?.toLowerCase() ?? ''
                const extTypes: Record<string, string> = {
                  jpg: 'image/jpeg',
                  jpeg: 'image/jpeg',
                  png: 'image/png',
                  gif: 'image/gif',
                  webp: 'image/webp',
                  svg: 'image/svg+xml',
                  pdf: 'application/pdf',
                  mp4: 'video/mp4',
                  webm: 'video/webm',
                  mp3: 'audio/mpeg',
                  txt: 'text/plain',
                  json: 'application/json',
                }
                const ct =
                  r.ContentType && r.ContentType !== 'application/octet-stream'
                    ? r.ContentType
                    : (extTypes[ext] ?? 'application/octet-stream')
                const buf = Buffer.from(bytes)
                res.writeHead(200, {
                  'Content-Type': ct,
                  'Content-Length': String(buf.length),
                  'Cache-Control': 'no-store',
                })
                res.end(buf)
              } catch (e: any) {
                res.writeHead(404, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ error: e.message ?? 'not found' }))
              }
              return
            }
            if (rest[1] === 'properties')
              return json(res, await getBucket(clients, config, rest[0]))
            return json(
              res,
              await listObjects(
                clients,
                rest[0],
                q.get('prefix') ?? undefined,
                q.get('token') ?? undefined,
                q.get('search') ?? undefined,
                Number(q.get('limit') ?? 200),
              ),
            )
          }

          if (resource === 'secret' && rest[0])
            return json(res, await getSecret(clients, decodeURIComponent(rest[0])))

          if (resource === 'bus' && rest[0])
            return json(res, await getBus(clients, decodeURIComponent(rest[0])))

          if (resource === 'rule') {
            const bus = q.get('bus') ?? 'default'
            const rule = q.get('rule')
            if (!rule) return json(res, { error: 'missing rule' }, 400)
            return json(res, await getRule(clients, bus, rule))
          }

          if (resource === 'apigw' && rest[0])
            return json(res, await getApi(clients, config, rest[0]))

          if (resource === 'function' && rest[0])
            return json(res, await getFunction(clients, rest[0]))

          if (resource === 'logs') {
            const group = q.get('group')
            if (!group) return json(res, { error: 'missing group' }, 400)
            return json(
              res,
              await tailLogs(clients, group, {
                since: q.get('since') ? Number(q.get('since')) : undefined,
                limit: Number(q.get('limit') ?? 100),
                filter: q.get('filter') ?? undefined,
              }),
            )
          }

          if (resource === 'cache' && rest[0])
            return json(
              res,
              await scanCache(clients, rest[0], {
                cursor: q.get('cursor') ?? undefined,
                match: q.get('match') ?? undefined,
                limit: Number(q.get('limit') ?? 100),
              }),
            )

          if (resource === 'sql' && rest[0]) {
            const conn = await resolveSqlConn(clients, config, rest[0])
            if (!conn) return json(res, { error: `Unknown database: ${rest[0]}` }, 404)
            if (rest[1] === 'tables') return json(res, await listTables(conn))
            if (rest[1] === 'table' && rest[2])
              return json(res, await peekTable(conn, rest[2], Number(q.get('limit') ?? 100)))
            if (rest[1] === 'query') {
              const body = await readBody(req)
              return json(res, await runQuery(conn, body.sql ?? ''))
            }
          }

          return json(res, { error: 'not found' }, 404)
        } catch (inner: any) {
          if (config.profile && isAuthError(inner)) {
            return json(res, { error: 'SSO_EXPIRED', profile: config.profile }, 401)
          }
          throw inner
        }
      }

      serveStatic(res, p, uiDist)
    } catch (e: any) {
      json(res, { error: e.message }, 500)
    }
  })

  server.listen(port, () => {
    console.log(`\ninspector → http://localhost:${port}`)
    console.log(`accounts: ${opts.accounts.map((a) => a.name).join(', ')}`)
  })
  return server
}

function readBody(req: any): Promise<any> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf-8') || '{}'))
      } catch (e) {
        reject(e)
      }
    })
    req.on('error', reject)
  })
}

function serveStatic(res: any, pathname: string, distDir: string | null) {
  if (!distDir) {
    res.writeHead(503)
    return res.end('UI dist not found. Run: pnpm --filter @slsv/ui build')
  }
  let file = path.join(distDir, pathname === '/' ? 'index.html' : pathname)
  if (!existsSync(file)) file = path.join(distDir, 'index.html') // SPA fallback
  try {
    const stat = statSync(file)
    const mime: Record<string, string> = {
      '.html': 'text/html',
      '.js': 'application/javascript',
      '.css': 'text/css',
      '.svg': 'image/svg+xml',
      '.ico': 'image/x-icon',
      '.woff2': 'font/woff2',
    }
    res.writeHead(200, {
      'content-type': mime[path.extname(file)] ?? 'application/octet-stream',
      'content-length': stat.size,
    })
    createReadStream(file).pipe(res)
  } catch {
    res.writeHead(404)
    res.end('not found')
  }
}

function resolveUiDist(): string | null {
  // same package: dist-server/ sits next to dist/
  const candidate = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'dist')
  return existsSync(candidate) ? candidate : null
}
