# @slsv/sdk

Cloud-agnostic handler SDK for [slsv](https://github.com/vincentri/slsv). Resolve
resources by logical name — never by ARN/URL — so the same handler runs on Floci
locally and real AWS in prod.

```ts
import { db, queue, storage, cache, secret, sql } from "@slsv/sdk";

const invoices = db("invoices"); // → DynamoDB (DATABASE_INVOICES)
await invoices.put({ id: "1", total: 42 });

await queue("jobs").send({ hello: "world" }); // → SQS
const token = await secret("STRIPE_KEY"); // → Secrets Manager, runtime fetch
```

Also ships a zero-dep HTTP mini-framework (`router`, `json`, middleware) and `sql()`
(Drizzle over postgres/mysql). See the [main README](https://github.com/vincentri/slsv#readme).

## Install

```sh
pnpm add @slsv/sdk
```

MIT
