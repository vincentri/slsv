import { json, router, storage } from '@slsv/sdk'

// Three endpoints covering the three bucket patterns:
//   - GET  /api/files/*   → public bucket, served via signed URL
//   - POST /api/upload-url → uploads bucket, returns presigned PUT for browser
//   - PUT  /api/files/*   → uploads bucket, function-side write (alternative)
export const handler = router([
  {
    method: 'POST',
    path: '/api/upload-url',
    handler: async (req) => {
      const body = req.body as { key?: string; contentType?: string } | undefined
      if (!body?.key) return json({ error: 'key is required' }, 400)

      // 60s window is tight on purpose — these URLs let anyone with the link
      // upload to your bucket. Tighten or shorten as needed.
      const url = await storage('uploads').putSignedUrl(body.key, {
        expiresIn: 60,
        contentType: body.contentType,
      })
      return json({ url, key: body.key })
    },
  },

  {
    method: 'GET',
    path: '/api/files/{key+}',
    handler: async (req) => {
      const key = req.params.key
      // For public buckets you could return the direct URL — but signed URLs
      // work for both public and private and let you add an expiry.
      const url = await storage('public').getSignedUrl(key, { expiresIn: 3600 })
      return json({ url })
    },
  },

  {
    method: 'PUT',
    path: '/api/files/{key+}',
    handler: async (req) => {
      const key = req.params.key
      const body = req.body as string | Uint8Array | undefined
      if (!body) return json({ error: 'body is required' }, 400)

      // Function-side write — use when you need to mutate/validate before storing.
      await storage('private').put(key, body, req.headers['content-type'])
      return json({ ok: true, key })
    },
  },
])