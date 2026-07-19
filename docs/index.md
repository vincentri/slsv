---
title: slsv
---

# slsv

**One `slsv.yml` describes the whole app.** `slsv dev` brings the entire stack up on [Floci](https://github.com/flociorg/floci) (a local AWS emulator on `:4566`). Later, `slsv deploy --target aws` hits real AWS — no handler rewrites.

```bash
# scaffold
pnpm dlx @slsv/cli init my-app
cd my-app

# develop locally against Floci
pnpm install
slsv dev

# ship to real AWS
slsv deploy --target aws
```

## Why slsv

- **No CloudFormation, no state file.** Idempotent AWS SDK v3 calls. yml is always the source of truth.
- **Cloud-portable handlers.** Code resolves resources by logical name (`db('invoices')`, `queue('jobs')`) — the CLI injects the right env var at deploy. Switch from Floci to AWS without touching handlers.
- **Full multi-service.** HTTP, SQS, EventBridge, DynamoDB, S3, Secrets Manager, CloudWatch, ElastiCache, RDS (Postgres + MySQL) — all driven through their native AWS APIs against Floci or real AWS.
- **One CLI, one yml, one stage.** `slsv deploy --stage prod` namespaces every resource so dev and prod coexist in one account.

## What's here

<div class="grid cards" markdown>

-   :material-rocket-launch: **[Getting started](getting-started.md)**

    Scaffold an app and run it locally in under a minute.

-   :material-sitemap: **[Architecture](architecture/overview.md)**

    Cloud-portability boundary, provider model, Floci, IAM, secrets, reconcile.

-   :material-cloud: **[Services](services/lambda.md)**

    Per-service deep dives: Lambda, API Gateway, queues/events, stores, caches/databases.

-   :material-book-open-variant: **[Reference](reference/slsv-yml.md)**

    Auto-generated [`slsv.yml` schema](reference/slsv-yml.md), [`@slsv/sdk` API](reference/sdk/index.md), [CLI commands](reference/cli/index.md).

</div>

## The yml

```yaml
app: my-app

functions:
  api:
    runtime: nodejs22
    handler: ./src/api.handler
    http:
      - method: GET
        path: /links
      - method: POST
        path: /links

queues:
  jobs: {}

databases:
  links:
    type: dynamodb
    partitionKey: id
```

Full schema: [reference/slsv-yml.md](reference/slsv-yml.md).

## License

MIT.