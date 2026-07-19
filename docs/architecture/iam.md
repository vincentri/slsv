# IAM exec role

`ensureExecRole` (`providers/aws/iam.ts:85`) creates **one role per app+stage**: `<app>-<stage>-exec`. Every Lambda in that stage assumes it.

Attached:

1. **`AWSLambdaBasicExecutionRole`** (managed) — CloudWatch Logs writes.
2. **Inline `slsv-data` policy** — dynamodb / sqs / s3 / secretsmanager / events actions scoped to `<app>-<stage>-*` resource ARNs.

A function can only touch its own app+stage's resources. Two apps in the same account can't see each other's data.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "dynamodb:GetItem",
        "dynamodb:PutItem",
        "dynamodb:Query",
        "dynamodb:Scan",
        "dynamodb:UpdateItem",
        "dynamodb:DeleteItem"
      ],
      "Resource": "arn:aws:dynamodb:us-east-1:<acct>:table/myapp-dev-*"
    }
    // ... sqs, s3, secretsmanager, events
  ]
}
```

`deleteExecRole` (`providers/aws/iam.ts:127`) tears it down on `slsv destroy`.

## Why a per-app+stage role, not per-function

slsv injects every binding (`DATABASE_*`, `QUEUE_*`, `BUCKET_*`, `SECRET_*`) into every function. There's no per-function resource list — one role + inline policy scoped by `<app>-<stage>-*` covers it. True per-fn least-priv needs a `uses:` declaration in slsv.yml; not implemented yet.

## Floci notes

Floci **ignores IAM**. Functions with no role work locally. The role is created and attached for the AWS path so real AWS doesn't deny data access.

## Tracing

`tracing: true` on a function adds X-Ray perms to the exec role (no separate role — the existing policy gets `xray:PutTraceSegments` etc.).

## Custom tags

The role (and every other resource) is tagged via `slsvTags` (`providers/aws/tags.ts`) with:

- `slsv:managed-by=slsv`
- `slsv:app=<app>`
- `slsv:stage=<stage>`
- plus any user `tags: {}` from slsv.yml (slsv: keys win — user can't clobber them)

Per-stage tag overrides work via the `stages:` overlay for free.

## Reconcile

The exec role is **not** in the reconcile orphan scan — it's created in `setup()` once per stage and torn down only by `slsv destroy`. Two apps sharing an account get separate roles, no interference.