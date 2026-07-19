# Stores (DynamoDB & S3)

Two store types today: DynamoDB tables and S3 buckets. Both provisioned through their native AWS APIs against Floci or real AWS.

## DynamoDB

```yaml
databases:
  links:
    type: dynamodb
    partitionKey: id
    sortKey: createdAt             # optional
    gsi:                           # optional
      - name: byUser
        partitionKey: userId
        sortKey: createdAt

functions:
  api:
    handler: ./src/api.handler
    databases: [links]             # lint-only — accessor cross-check
```

Handler:

```ts
import { db } from "@slsv/sdk";
const links = db("links");
await links.put({ id: "l_1", url: "https://example.com", createdAt: 1700000000 });
const got = await links.get({ id: "l_1" });
```

The SDK resolves `DATABASE_LINKS` → `DynamoDBDocumentClient` (see [reference/sdk/index.md](../reference/sdk/index.md)).

### Reconcile for Dynamo

- **In yml, not in AWS** → `create` (get-or-create).
- **In AWS, not in yml** → `orphan` by default. Set `autoRemove: true` to `delete` (drops the data).
- **In both, keys differ** → `replace` reported. DynamoDB partition/sort keys are immutable; deploy never silently drops data to change one.

`DeleteTable` only runs under `autoRemove: true` AND the orphan scan picks it up.

## S3 buckets

```yaml
buckets:
  uploads: {}
  # or:
  #   publicRead: true    # browser reads objects via bucket URL
  #   cors: [origin, ...] # browser PUT/GET cross-origin
```

```ts
import { storage } from "@slsv/sdk";
const uploads = storage("uploads");
await uploads.put("avatars/u1.png", buffer, { contentType: "image/png" });
const url = await uploads.presign("avatars/u1.png", { expiresIn: 3600 });
```

### `publicRead: true`

Browser reads objects via the bucket URL directly. slsv adds an `s3:GetObject` policy and disables the public-access blocks.

### `cors: [...]`

Browser PUT/GET cross-origin (for presigned URLs from a different origin). Pair with `publicRead` when allowing GET.

### Frontend hosting bucket

The S3 static-site bucket (`<app>-<stage>-frontend` + CloudFront distribution) is a **slsv-managed build artifact** — created by `deployFrontend`, not declared under `buckets:`. It holds only the last build output and is **re-created every deploy**. When `frontend:` is dropped from the yml, this bucket is auto-torn down (via `emptyAndDeleteBucket` + `destroyDistribution`) like a stateless orphan, NOT report-only.

### Reconcile for S3

- **In yml, not in AWS** → `create` (get-or-create).
- **In AWS, not in yml** → `orphan` by default. Set `autoRemove: true` to `emptyAndDeleteBucket`.
- The frontend bucket is excluded from the orphan scan while `frontend:` is configured.

## Reconcile field coverage

| | Field diff | Mutable? |
|--|--|--|
| DynamoDB | partition/sort key, GSI | not mutable |
| S3 | presence-only | — |

Mutable drift (`PutBucketPolicy`, `PutBucketCors`, etc.) is a follow-up — deploy-side coverage today is Lambda + API CORS only.