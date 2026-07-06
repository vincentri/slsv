import { json, queue, redirect, router, type Middleware } from '@slsv/sdk'

const clicks = queue('clicks')
const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
const links = new Map<string, { id: string; url: string; createdAt: string }>()

// Middleware: gate mutating routes behind an API key. Call next() to continue, or return a
// response to short-circuit. Attach globally via router(routes, [mw]) or per-route below.
// ponytail: literal demo key — real apps read it at runtime with secret('API_KEY').
const requireApiKey: Middleware = (req, next) =>
  req.headers['x-api-key'] === 'demo-key' ? next() : json({ error: 'unauthorized' }, 401)

export const handler = router([
  {
    method: 'GET',
    path: '/api/links',
    handler: () => json([...links.values()]),
  },
  {
    method: 'POST',
    path: '/api/links',
    // Creating a link needs the key; listing/redirecting is public.
    middleware: [requireApiKey],
    handler: async (req) => {
      const body = req.body as { url?: string } | undefined
      if (!body?.url) return json({ error: 'url is required' }, 400)

      const id = shortId()
      const link = { id, url: body.url, createdAt: new Date().toISOString() }
      links.set(id, link)
      return json(link, 201)
    },
  },
  {
    method: 'GET',
    path: '/api/r/{id}',
    handler: async (req) => {
      const link = links.get(req.params.id)
      if (!link) return json({ error: 'not found' }, 404)

      await clicks.send({ id: link.id, ts: Date.now() }, { delaySeconds: 0 })
      return redirect(link.url, 301)
    },
  },
])

function shortId() {
  let id = ''
  for (let i = 0; i < 6; i++) id += alphabet[Math.floor(Math.random() * alphabet.length)]
  return id
}
