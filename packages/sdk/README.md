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

### HTTP (`router`, middleware)

Zero-dep mini-framework — no Hono/Nest. `router` dispatches Lambda events (APIGW v1 + v2),
`json`/`redirect` build responses. Middleware is onion-model: call `next()` to continue or
return a response to short-circuit.

```ts
import { router, json } from "@slsv/sdk";

const auth = (req, next) =>
  req.headers.authorization ? next() : json({ error: "unauthorized" }, 401);

export const handler = router(
  [
    { method: "GET", path: "/users/{id}", handler: (req) => json({ id: req.params.id }) },
    { method: "POST", path: "/users", handler: async (req) => json(req.body, 201) },
  ],
  [auth], // global middleware; per-route via route.middleware
);
```

### SQL (`sql`, Drizzle)

`sql(name)` resolves `DATABASE_<NAME>` (a postgres/mysql conn string), sniffs the dialect,
returns a cached Drizzle client. Pass `{ schema }` (your table defs) for the typed API;
omit it and the query builder + raw `sql\`\`` still work.

```ts
import { sql } from "@slsv/sdk";
import { sql as raw } from "drizzle-orm";
import * as schema from "./schema";

const db = sql("app", { schema });
const users = await db.query.users.findMany(); // typed
await db.execute(raw`SELECT 1`); // raw
```

See the [main README](https://github.com/vincentri/slsv#readme).

## Install

```sh
pnpm add @slsv/sdk
```

MIT
