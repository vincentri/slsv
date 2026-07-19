# API Gateway

**One HTTP API per stage** (named `<app>-<stage>`), not one shared API split by internal stages. Deploying prod can't touch dev's routes; no stage-variable routing.

## Declaring routes

```yaml
functions:
  api:
    handler: ./src/api.handler
    http:
      - method: GET
        path: /links
      - method: POST
        path: /links
      - method: GET
        path: /users/{id}      # path params
      - method: GET
        path: /files/{path+}   # greedy path params

api:
  cors: ["https://myapp.com"]    # see CORS below
  auth:                          # see Authorizer below
    function: authorizer
  domain: api.myapp.com          # see Custom domain below
```

The handler is a tiny zero-dep router from `@slsv/sdk` — see [reference/sdk/index.md](../reference/sdk/index.md).

## CORS

The HTTP API gets a permissive CORS config by default (`AllowOrigins/Methods/Headers: ['*']`) so the S3 frontend can call it. **`api.cors` in slsv.yml locks it down.** Two shapes (normalized in `buildCors`):

```yaml
# Array — overrides just AllowOrigins. Methods/headers stay '*'.
api:
  cors: ["https://myapp.com", "https://staging.myapp.com"]

# Object — full control.
api:
  cors:
    origins: ["https://myapp.com"]
    methods: ["GET", "POST"]
    headers: ["content-type", "authorization"]
    credentials: true
```

**`credentials: true`** (needed for `fetch(url, { credentials: 'include' })`) sets `AllowCredentials: true`, but the browser/AWS rule is that credentials are **incompatible with `*`** on origin, methods, AND headers. So `buildCors`:

- Forces explicit origins (deploy **throws `ConfigError`** on `origins:['*']`+credentials).
- Swaps `*` method/header defaults for concrete lists (methods `GET,POST,PUT,PATCH,DELETE,OPTIONS`; headers `content-type,authorization`) — override either via the object.

Unlike CloudFront (create-only), CORS is **drift-corrected every deploy** via `UpdateApiCommand`.

!!! warning "Floci CORS verification"
    Floci doesn't emit `access-control-*` response headers at request time (a preflight OPTIONS returns 200 with no CORS headers). The config is correct and enforced on real AWS; verify the stored config, not the response headers, locally.

## Authorizer (`api.auth`)

A **Lambda REQUEST authorizer** protects every http route (`apigw.ts: ensureAuthorizer`).

```yaml
api:
  auth:
    function: authorizer      # a trigger-less function
    identitySource: $request.header.Authorization  # default
    ttl: 300                   # AuthorizerResultTtlInSeconds, default 300
```

- **Whole-API default** — once `api.auth` is set, every http route gets `AuthorizationType: CUSTOM` + the authorizer.
- A route opts out with `auth: false` (`ensureRoute` converges both directions — adding/removing auth takes effect on redeploy).
- The authorizer function is a **trigger-less fn** (no `http`/`queue`/`cron`/`event`) — deployed like any fn, just referenced here.
- API Gateway invokes it before the route handler. It returns `{ isAuthorized: bool, context? }` (simple-response mode, `EnableSimpleResponses: true`):
  - `false` → **403**, the route fn never runs
  - `true` → request continues; `context` reaches the route at `event.requestContext.authorizer.lambda`
- The **lookup is entirely the handler's** (DB via `db()`/`sql()`, `secret()`, JWT, external HTTP) — slsv injects the same env bindings, no SDK change.
- Named `<app>-<stage>-authz`, get-or-create.
- Dropping `api.auth` unprotects routes then `DeleteAuthorizer` (after the route loop — AWS refuses deleting an in-use authorizer).
- `deleteHttpApi` cascades it on destroy.
- `lint.ts` errors if `api.auth.function` isn't a declared fn.

!!! warning "Authorizer context in `slsv dev`"
    Floci enforces allow/deny but drops the authorizer `context` — `event.requestContext.authorizer` is **null locally even on allow**, so `context` passthrough only works on real AWS (`...authorizer.lambda`). Don't rely on authorizer context in `slsv dev`; re-derive it in the handler locally.

## Custom domain (`api.domain`, aws-only)

Point a real domain (`api.myapp.com`) at the HTTP API, provisioned **end-to-end, zero manual DNS** (`providers/aws/domain.ts`).

```yaml
api:
  domain: api.myapp.com
  # certArn: arn:aws:acm:us-east-1:...  # reuse a pre-validated cert
```

Flow (on `--target aws`):

1. `RequestCertificate` (DNS-validated ACM cert)
2. Auto-write the validation CNAME in Cloudflare (`CLOUDFLARE_API_TOKEN` in env)
3. Poll `DescribeCertificate` to `ISSUED` (~1–5 min)
4. `CreateDomainName` (**REGIONAL**, `TLS_1_2`)
5. `CreateApiMapping` onto the app's `$default` stage
6. Upsert the public CNAME → the api-gw target (`d-xxx.execute-api...`, DNS-only/unproxied)

Cloudflare only today — no zone field, `cfZoneIdForDomain` lists the token's zones and picks the one whose name is a suffix of the domain (longest match). Skipped on `--target local`.

Destroy is yml-driven (needs `api.domain` in the yml) and does **full cleanup**: `DeleteDomainName` → `DeleteCertificate` → delete both Cloudflare records. A BYO `certArn` and its validation record are **left** (the user's, not slsv's to delete).

## CloudFront single-domain mode (`frontend.cloudfront: true`)

S3 static-website endpoints are HTTP-only by design. Opt in to provision one CloudFront distribution with two origins: S3 website (custom origin, HTTP) for `/*`, API Gateway for `/api/*` (managed policies `CachingDisabled` + `AllViewerExceptHostHeader`). `CustomErrorResponses` (403/404 → `/index.html`, 200) handle SPA routing.

Because `/api/*` becomes same-origin under the CloudFront domain, `deployFrontendAws` skips the `VITE_SLSV_API_URL` injection in this mode — relative `/api` just works, no CORS needed.

!!! note "CloudFront is create-only"
    Idempotent by `Comment`, but does NOT update an existing distribution. A config fix needs `slsv destroy --target aws` + redeploy. Deploy and destroy each take ~15–20 min (CloudFront config propagation).

## Frontend → API wiring

On `--target aws` the frontend (S3 static site) and API (API Gateway) are different origins, so the frontend can't use relative `/api/*` (that hits S3). slsv **auto-injects the deployed API Gateway URL** into the frontend build as `VITE_SLSV_API_URL` (`runBuild`).

The scaffolded frontend resolves its API base as:

```ts
const base = import.meta.env.VITE_API_URL || import.meta.env.VITE_SLSV_API_URL || '';
```

A **user-set `VITE_API_URL` wins** (custom domain), else slsv's injected URL, else `''` = relative (local `slsv dev` proxies `/api` → backend).

## SDK quick reference

The router handles both APIGW v1 (`httpMethod`/`path`) and v2 (`requestContext.http`) shapes. `request()` builds a normalized `ApiRequest` (lowercased headers, query, path params). `json()` / `redirect()` build responses. Errors: bad JSON → 400, uncaught → 500, no match → 404.

Middleware is onion-model (`Middleware = (req, next) => ApiResponse`): call `next()` to continue, or return a response to short-circuit. Global chain via `router(routes, [mw])` + per-route `route.middleware`. Runs only for a **matched** route — a 404 never enters the chain.

!!! warning "Body parse timing"
    `request()` parses body eagerly, so bad JSON → 400 **before** middleware sees it. Auth can't run auth-before-parse yet.