# Secrets

**Runtime fetch — never baked into env.** `ensureSecrets` (`providers/aws/secrets.ts`) upserts each `secrets:` value into Secrets Manager as `<app>-<stage>-<NAME>` (`.env.<stage>` is the source of truth) and injects **only the SM id** as `SECRET_<NAME>` — the plaintext value never touches the Lambda env.

Handlers read it at runtime:

```ts
import { secret } from "@slsv/sdk";

export const handler = async () => {
  const apiKey = await secret("STRIPE_KEY");
  // ...
};
```

`@slsv/sdk`'s `secret(name)` resolves `SECRET_<NAME>` → `GetSecretValue` (Floci locally, real SM in prod via `AWS_ENDPOINT_URL`) → cached per container (`providers/aws/secret.ts`).

## Why runtime, not env

Baking secrets into the Lambda env would:

1. Show them in plaintext in the AWS console and `GetFunctionConfiguration` output.
2. Require a function redeploy every time you rotate.
3. Make env-var diffs a churn vector.

Runtime fetch + per-container cache gives you rotation on next cold start, no redeploy.

## Declaring secrets

```yaml
# slsv.yml
secrets:
  - STRIPE_KEY
  - DATABASE_URL
  - JWT_SECRET
```

Each name becomes:

- `SECRET_STRIPE_KEY=<app>-<stage>-STRIPE_KEY` in the function env (SM id)
- `<app>-<stage>-STRIPE_KEY` as the Secrets Manager entry (the value, upserted from `.env.<stage>`)

## `secret()` caching

Per-container cache (`providers/aws/secret.ts`) — no TTL. A rotated secret is picked up on the next cold start.

```ts
// first call in this container
const a = await secret("STRIPE_KEY"); // → GetSecretValue

// second call in same container
const b = await secret("STRIPE_KEY"); // → cached, no API call
```

## Floci notes

Floci implements Secrets Manager at `:4566/secretsmanager`. `GetSecretValue` works the same. `AWS_ENDPOINT_URL=http://host.docker.internal:4566` (injected for `--target local` only) routes the SDK to Floci.

## BYO / hosted databases

For a DB slsv doesn't host (Supabase, Neon, self-managed RDS), there's **no `databases` type** — put the connection string in `secrets:` (it's a password) and connect with your own driver:

```ts
import { secret } from "@slsv/sdk";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

export const handler = async () => {
  const url = await secret("DATABASE_URL");
  const client = postgres(url);
  const db = drizzle(client);
  // ...
};
```

`secrets:` is the only mechanism for anything sensitive that slsv doesn't provision.