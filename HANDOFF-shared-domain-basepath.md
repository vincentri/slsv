# Handoff: Shared-domain base-path mapping for slsv

## Goal

Serve multiple **separate slsv apps** under one custom domain, routed by base path:

```
dev-api.procurebot.ai/qualify/v1/...   → app: qualify   (api/qualify)
dev-api.procurebot.ai/auth/v1/...      → app: auth      (api/auth)
dev-api.procurebot.ai/tender/v1/...    → app: tender    (api/tender)
```

Each app keeps its own `slsv.yml`, gateway, deploy/scale/teardown lifecycle.
The `/qualify`, `/auth`, `/tender` prefix comes from an **API Gateway v2 API
mapping key**, not the route path. API GW **strips the base path** before
forwarding, so every app's route stays `path: /v1/{proxy+}` — unchanged.

## Why core changes are needed

`packages/cli/src/providers/aws/domain.ts` was written assuming **one custom
domain = one app**. Sharing a domain across apps breaks three spots. One is a
teardown footgun that outages sibling apps.

Files touched: `packages/cli/src/providers/aws/domain.ts`,
`packages/cli/src/config.ts`. ~40–60 lines.

---

## Change 1 — config field

`packages/cli/src/config.ts`, in `ApiConfig` (next to `domain` / `certArn`, ~line 145):

```ts
// Base path under `domain` to mount this app's API (API GW v2 mapping key).
// Omit for a domain owned entirely by one app (mapping at root). When set,
// multiple apps can share one `domain`, each under its own path, e.g.
// dev-api.procurebot.ai/qualify. API GW strips the base path before routing,
// so routes stay /v1/{proxy+}.
basePath: z.string().optional(),
```

Keep `.strict()` — the field must be declared or it's silently dropped.

---

## Change 2 — create the mapping with a key

`domain.ts`, in `ensureApiDomain`, replace the mapping block (~lines 67–72):

```ts
const mappings = await apigw.send(new GetApiMappingsCommand({ DomainName: domain }));
const key = api.basePath; // undefined => root mapping (single-app domain)
const mine = mappings.Items?.find((m) => m.ApiId === apiId);
if (!mine) {
  await apigw.send(
    new CreateApiMappingCommand({
      DomainName: domain,
      ApiId: apiId,
      Stage: "$default",
      ApiMappingKey: key,
    }),
  );
} else if ((mine.ApiMappingKey ?? undefined) !== (key ?? undefined)) {
  // basePath changed for this app — re-key: delete old mapping, create new.
  await apigw.send(
    new DeleteApiMappingCommand({ DomainName: domain, ApiMappingId: mine.ApiMappingId! }),
  );
  await apigw.send(
    new CreateApiMappingCommand({
      DomainName: domain,
      ApiId: apiId,
      Stage: "$default",
      ApiMappingKey: key,
    }),
  );
}
```

Add `DeleteApiMappingCommand` to the `@aws-sdk/client-apigatewayv2` import at
the top of the file.

> Note: an empty-string `ApiMappingKey` is rejected by API GW — pass `undefined`
> for root, not `""`. `z.string().optional()` gives `undefined` when omitted, so
> fine as long as nobody writes `basePath: ""` in yml.

---

## Change 3 — shared-aware teardown (the footgun)

**Current behavior:** `slsv destroy` on any app runs
`DeleteDomainNameCommand(domain)`, which **cascades every mapping on that
domain**, deletes the shared ACM cert (its `DomainName` matches), and deletes the
public Cloudflare CNAME. On a shared host, destroying `auth` **also kills
qualify and tender.** Data-loss / outage class — mandatory fix.

**Required behavior:** destroy removes only *this app's* mapping. It deletes the
domain name + cert + CF records **only when this app was the last mapping** on
the domain.

Rewrite `destroyApiDomain` (`domain.ts` ~line 158). It needs the app's `apiId`
to find its own mapping, so pass `appName` in. Update the caller in
`packages/cli/src/providers/aws/index.ts:150`.

```ts
export async function destroyApiDomain(
  apigw: ApiGatewayV2Client,
  acm: ACMClient,
  api: Api,
  appName?: string, // needed to find THIS app's mapping on a shared domain
): Promise<void> {
  const domain = api.domain!;

  // Remove only this app's mapping first. On a shared domain this leaves
  // sibling apps' mappings intact.
  if (appName) {
    const apis = await apigw.send(new GetApisCommand({}));
    const apiId = apis.Items?.find((a) => a.Name === appName)?.ApiId;
    if (apiId) {
      const mappings = await apigw.send(new GetApiMappingsCommand({ DomainName: domain }))
        .catch((e: any) => {
          if (e?.name === "NotFoundException") return { Items: [] as any[] };
          throw e;
        });
      const mine = mappings.Items?.find((m) => m.ApiId === apiId);
      if (mine?.ApiMappingId) {
        await apigw.send(
          new DeleteApiMappingCommand({ DomainName: domain, ApiMappingId: mine.ApiMappingId }),
        );
      }
      // Other apps still mounted here? Stop — domain, cert, CF records are shared.
      const remaining = await apigw.send(new GetApiMappingsCommand({ DomainName: domain }))
        .catch(() => ({ Items: [] as any[] }));
      if ((remaining.Items?.length ?? 0) > 0) {
        console.log(`  kept shared custom domain ${domain} (${remaining.Items!.length} app(s) still mapped)`);
        return;
      }
    }
  }

  // Last app out (or single-app domain) — full teardown as before.
  let certArn: string | undefined;
  let validationName: string | undefined;
  if (!api.certArn) {
    const list = await acm.send(new ListCertificatesCommand({ MaxItems: 100 }));
    certArn = list.CertificateSummaryList?.find((c) => c.DomainName === domain)?.CertificateArn;
    if (certArn) {
      const rr = (await acm.send(new DescribeCertificateCommand({ CertificateArn: certArn })))
        .Certificate?.DomainValidationOptions?.[0]?.ResourceRecord;
      if (rr?.Name) validationName = stripDot(rr.Name);
    }
  }

  await apigw.send(new DeleteDomainNameCommand({ DomainName: domain })).catch((e: any) => {
    if (e?.name !== "NotFoundException") throw e;
  });

  const zoneId = await cfZoneIdForDomain(domain);
  await cfDeleteByName(zoneId, domain);
  if (validationName) await cfDeleteByName(zoneId, validationName);

  if (certArn) await deleteCertWhenFree(acm, certArn);
}
```

Caller update — `packages/cli/src/providers/aws/index.ts:150`:

```ts
destroyApiDomain(this.clients.apigw, this.clients.acm, cfg.api!, cfg.app),
```

(Use whatever holds the app name in that scope — same value passed to
`ensureApiDomain(..., appName)` at index.ts:717.)

The internal `pruneOldApiDomains` call at `domain.ts:110` passes no `appName`
(`destroyApiDomain(apigw, acm, { domain: name })`) — leave it. Those are genuine
orphan single-app domains being fully removed; skipping the mapping-aware branch
is correct there.

---

## Change 4 — verify prune under shared host

`pruneOldApiDomains` (`domain.ts:93`) keys on this app's `apiId`, so it prunes
only *other* domains still mapped to **this** app (an old subdomain after a
rename). It ignores sibling apps on the shared domain (different apiIds). Safe as
written — just confirm with a test that deploying `auth` to the shared host does
**not** prune `qualify`'s mapping.

---

## Per-app slsv.yml (after core is done)

Each app: point at the shared domain, declare its base path, leave the route.

`api/qualify/slsv.yml`:
```yaml
api:
  domain: dev-api.procurebot.ai   # prod: api.procurebot.ai
  basePath: qualify
functions:
  api:
    http:
      - method: ANY
        path: /v1/{proxy+}        # unchanged — base path is stripped by API GW
```

`api/auth/slsv.yml` → `basePath: auth`, `api/tender/slsv.yml` → `basePath: tender`.
Same `domain`. Deploy order doesn't matter — first app provisions the domain +
cert, the rest reuse (idempotent by DomainName).

---

## Frontend / env

Frontend has **no hardcoded host** — single env var holds the full base incl
version. Update per service:

```
# qualify
API_URL=https://dev-api.procurebot.ai/qualify/v1
NEXT_PUBLIC_API_URL=https://dev-api.procurebot.ai/qualify/v1
```

Files: `qualify-app/.env.local.example`, `.env.local`, and the real dev/prod env.

---

## Tests

Add to `packages/cli` test suite (mock the AWS SDK clients):

1. **create mapping with key** — `ensureApiDomain` with `basePath: "auth"` calls
   `CreateApiMappingCommand` with `ApiMappingKey: "auth"`.
2. **root mapping unchanged** — no `basePath` → `ApiMappingKey: undefined`.
3. **re-key** — existing mapping under old key + changed `basePath` → delete then
   create.
4. **shared teardown keeps siblings (critical)** — domain has mappings for
   `qualify` + `auth`; `destroyApiDomain(..., "auth")` deletes only auth's
   mapping, does **not** call `DeleteDomainNameCommand` or `DeleteCertificate`,
   returns with `qualify` still mapped.
5. **last app out** — domain has only `auth`; destroy deletes the mapping **and**
   the domain + cert + CF records.

---

## Known limits / notes

- **Concurrent first deploy** — two apps deploying to a brand-new shared domain at
  the exact same time race on `CreateDomainNameCommand` (both see it absent). The
  cert is race-safe (idempotency token derived from the domain dedupes at ACM).
  Domain-create loser errors; rerun fixes. Not worth locking for a 3-app manual
  deploy — `# ponytail: rerun on the rare concurrent-first-deploy collision`.
- **basePath must not be `""`** — API GW rejects an empty mapping key. Omit the
  field for root; don't set it to empty string.
- **Route path stays `/v1/{proxy+}`** in every app — the base path is stripped by
  the mapping before the request reaches the API. Do **not** write
  `/qualify/v1/...` in the route.

## Checklist

- [ ] `config.ts`: add `basePath`
- [ ] `domain.ts`: import `DeleteApiMappingCommand`
- [ ] `domain.ts`: mapping-with-key + re-key (Change 2)
- [ ] `domain.ts`: shared-aware `destroyApiDomain` + `appName` param (Change 3)
- [ ] `index.ts:150`: pass app name to `destroyApiDomain`
- [ ] tests 1–5
- [ ] `api/{qualify,auth,tender}/slsv.yml`: `domain` + `basePath`
- [ ] frontend env vars per service
- [ ] deploy qualify → verify `dev-api.procurebot.ai/qualify/v1` live
- [ ] deploy auth + tender → verify all three, then `slsv destroy auth` and
      confirm qualify + tender still serve
