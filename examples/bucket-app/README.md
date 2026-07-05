# bucket-app

Three S3 patterns in one slsv app. Run with `slsv dev` and exercise each bucket.

## Buckets

| Bucket | Config | Use case |
|---|---|---|
| `private` | `{}` | Only Lambda reads/writes — internal artifacts, processed data |
| `public` | `publicRead: true` | Browser fetches objects directly via the bucket URL (avatars, static assets) |
| `uploads` | `cors: [...]` | Browser uploads directly via presigned PUT, function reads for processing |

## Endpoints

### `POST /api/upload-url` — request a presigned upload URL

```sh
curl -X POST http://localhost:4566/api/upload-url \
  -H 'content-type: application/json' \
  -d '{"key":"avatars/1.jpg","contentType":"image/jpeg"}'
```

Response:
```json
{ "url": "http://...", "key": "avatars/1.jpg" }
```

Browser then `PUT`s the file directly to that URL. No Lambda hop.

### `GET /api/files/{key+}` — get a (signed) download URL

```sh
curl http://localhost:4566/api/files/avatars/1.jpg
```

Works for any bucket; signed URL adds an expiry.

### `PUT /api/files/{key+}` — function-side write

```sh
curl -X PUT http://localhost:4566/api/files/notes/hello.txt \
  -H 'content-type: text/plain' \
  -d 'hello world'
```

Use when you need to mutate/validate before storing.

## SDK shape

```ts
import { storage } from '@slsv/sdk'

await storage('private').put(key, body, contentType)
await storage('public').getSignedUrl(key, { expiresIn: 3600 })
await storage('uploads').putSignedUrl(key, { expiresIn: 60, contentType: 'image/jpeg' })
```

`cors:` on the bucket is what lets the browser's preflight succeed against the presigned URL.