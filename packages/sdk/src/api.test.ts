import { describe, expect, it } from 'vitest'
import { json, redirect, request, router, text } from './api.js'

describe('api helpers', () => {
  it('normalizes HTTP API v2 events', () => {
    const req = request<{ name: string }>(
      {
        rawPath: '/api/users/42',
        rawQueryString: 'active=true',
        headers: { 'Content-Type': 'application/json' },
        body: '{"name":"Ada"}',
        requestContext: { http: { method: 'POST' } },
      },
      '/api/users/{id}',
    )

    expect(req.method).toBe('POST')
    expect(req.path).toBe('/api/users/42')
    expect(req.headers['content-type']).toBe('application/json')
    expect(req.query.active).toBe('true')
    expect(req.params.id).toBe('42')
    expect(req.body?.name).toBe('Ada')
  })

  it('matches greedy proxy routes', async () => {
    const handler = router([
      {
        method: 'ANY',
        path: '/api/{proxy+}',
        handler: (req) => json({ proxy: req.params.proxy }),
      },
    ])

    const res = await handler({
      rawPath: '/api/links/123/click',
      requestContext: { http: { method: 'GET' } },
    })

    expect(JSON.parse(res.body)).toEqual({ proxy: 'links/123/click' })
  })

  it('returns not found when no route matches', async () => {
    const handler = router([{ method: 'GET', path: '/api/ok', handler: () => json({ ok: true }) }])
    const res = await handler({ rawPath: '/api/missing', requestContext: { http: { method: 'GET' } } })

    expect(res.statusCode).toBe(404)
  })

  it('returns a clean error for invalid JSON bodies', async () => {
    const handler = router([{ method: 'POST', path: '/api/links', handler: () => json({ ok: true }) }])
    const res = await handler({
      rawPath: '/api/links',
      body: '{',
      requestContext: { http: { method: 'POST' } },
    })

    expect(res.statusCode).toBe(400)
    expect(JSON.parse(res.body)).toEqual({ error: 'Invalid JSON body' })
  })

  it('builds common responses', () => {
    expect(json({ ok: true }).headers['content-type']).toBe('application/json')
    expect(text('ok').headers['content-type']).toBe('text/plain; charset=utf-8')
    expect(redirect('/login').headers.location).toBe('/login')
  })
})
