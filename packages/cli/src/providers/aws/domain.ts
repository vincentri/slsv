import {
  ApiGatewayV2Client,
  GetApisCommand,
  GetDomainNameCommand,
  GetDomainNamesCommand,
  CreateDomainNameCommand,
  DeleteDomainNameCommand,
  GetApiMappingsCommand,
  CreateApiMappingCommand,
  DeleteApiMappingCommand,
} from "@aws-sdk/client-apigatewayv2";
import {
  ACMClient,
  RequestCertificateCommand,
  DescribeCertificateCommand,
  ListCertificatesCommand,
  DeleteCertificateCommand,
} from "@aws-sdk/client-acm";
import type { AppConfig } from "../../config.js";
import { cfZoneIdForDomain, cfUpsertCname, cfDeleteByName } from "./cloudflare.js";

type Api = NonNullable<AppConfig["api"]>;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const stripDot = (s: string) => s.replace(/\.$/, "");

// Provision an API Gateway custom domain end-to-end: ACM cert (DNS-validated via the DNS
// provider's API), regional custom domain name, API mapping, and the public CNAME → the
// api-gw target. Fully automated — no manual DNS. aws-only (Floci has no ACM/custom domains).
// The ACM cert MUST be in the same region as the API (regional endpoint), which the caller's
// ACM client already targets.
export async function ensureApiDomain(
  apigw: ApiGatewayV2Client,
  acm: ACMClient,
  api: Api,
  appName: string,
): Promise<string> {
  const domain = api.domain!;
  const zoneId = await cfZoneIdForDomain(domain);

  const certArn = api.certArn ?? (await ensureCert(acm, domain, zoneId));

  // Regional custom domain name. Idempotent: create only if absent.
  const existing = await apigw
    .send(new GetDomainNameCommand({ DomainName: domain }))
    .catch((e: any) => {
      if (e?.name === "NotFoundException") return null;
      throw e;
    });
  if (!existing) {
    await apigw.send(
      new CreateDomainNameCommand({
        DomainName: domain,
        DomainNameConfigurations: [
          { CertificateArn: certArn, EndpointType: "REGIONAL", SecurityPolicy: "TLS_1_2" },
        ],
      }),
    );
  }
  const desc = await apigw.send(new GetDomainNameCommand({ DomainName: domain }));
  const target = desc.DomainNameConfigurations?.[0]?.ApiGatewayDomainName;
  if (!target) throw new Error(`custom domain ${domain}: no ApiGatewayDomainName yet`);

  // API mapping → the app's HTTP API ($default stage — slsv runs one stage per API).
  const apis = await apigw.send(new GetApisCommand({}));
  const apiId = apis.Items?.find((a) => a.Name === appName)?.ApiId;
  if (!apiId) throw new Error(`custom domain ${domain}: HTTP API ${appName} not found`);
  // Mount this app's API under its base path (undefined = root mapping, single-app domain). API GW
  // strips the key before routing. Re-key in place if `basePath` changed for this app.
  const key = api.basePath; // never "" — schema enforces min(1); API GW rejects an empty key
  const mappings = await apigw.send(new GetApiMappingsCommand({ DomainName: domain }));
  const mine = mappings.Items?.find((m) => m.ApiId === apiId);
  if (!mine) {
    await apigw.send(
      new CreateApiMappingCommand({ DomainName: domain, ApiId: apiId, Stage: "$default", ApiMappingKey: key }),
    );
  } else if ((mine.ApiMappingKey ?? undefined) !== (key ?? undefined)) {
    await apigw.send(new DeleteApiMappingCommand({ DomainName: domain, ApiMappingId: mine.ApiMappingId! }));
    await apigw.send(
      new CreateApiMappingCommand({ DomainName: domain, ApiId: apiId, Stage: "$default", ApiMappingKey: key }),
    );
  }

  // Point the public domain at the api-gw target (DNS-only, not proxied — user can enable
  // Cloudflare's proxy afterward once it verifies).
  await cfUpsertCname(zoneId, domain, target, false);

  // Changed subdomain? Tear down the previous domain now mapped to this same API.
  await sweepApiDomains(apigw, acm, appName, { keep: domain });
  return `https://${domain}`;
}

// Discovery-based cleanup of custom domains mapped to this app's API — the single path for both
// "changed subdomain" (deploy, keep the current one) and "destroy" (remove every one, even a
// domain already dropped from the yml). Enumerates API-GW domains, keeps only those mapped to our
// apiId, and tears each down via destroyApiDomain (name + mapping + cert + both Cloudflare
// records). For the domain still in the yml we forward `opts.current` so its BYO `certArn` is
// honored (cert left alone); every other (old/dropped) domain is treated as slsv-minted. That's
// safe because destroyApiDomain only deletes a cert whose ACM DomainName EXACTLY equals the
// domain, so a BYO wildcard (`*.myapp.com`) never matches.
//   - deploy (opts.keep set): failures warn + continue — a stray old domain must not block a deploy.
//   - destroy (opts.blockOnError): failures are collected and thrown so the destroy step reports ✗
//     and the command exits non-zero (matches the rest of destroy), after attempting every domain.
// ponytail: reads one page of GetDomainNames (paginate if an account fronts >100 domains); a BYO
// exact-match (non-wildcard) cert on an old domain WOULD be deleted — rare, note it if hit.
export async function sweepApiDomains(
  apigw: ApiGatewayV2Client,
  acm: ACMClient,
  appName: string,
  opts: { keep?: string; current?: Api; blockOnError?: boolean } = {},
): Promise<number> {
  const apis = await apigw.send(new GetApisCommand({}));
  const apiId = apis.Items?.find((a) => a.Name === appName)?.ApiId;
  if (!apiId) return 0;

  const domains = await apigw.send(new GetDomainNamesCommand({}));
  const failures: string[] = [];
  let removed = 0;
  for (const d of domains.Items ?? []) {
    const name = d.DomainName;
    if (!name || name === opts.keep) continue;
    const mappings = await apigw.send(new GetApiMappingsCommand({ DomainName: name }));
    if (!mappings.Items?.some((m) => m.ApiId === apiId)) continue;
    const api = opts.current?.domain === name ? opts.current : { domain: name };
    console.log(opts.keep ? `  pruning old custom domain ${name} (replaced by ${opts.keep})` : `  removing custom domain ${name}`);
    try {
      // appName → mapping-aware: on a shared domain this only drops THIS app's mapping and keeps
      // the domain/cert/CF records while siblings are still mounted.
      await destroyApiDomain(apigw, acm, api, appName);
      removed++;
    } catch (e: any) {
      if (opts.blockOnError) failures.push(`${name}: ${e?.message ?? e}`);
      else console.warn(`  ⚠ could not prune old domain ${name}: ${e?.message ?? e}`);
    }
  }
  if (failures.length) throw new Error(`failed to remove custom domain(s): ${failures.join("; ")}`);
  return removed;
}

async function ensureCert(acm: ACMClient, domain: string, zoneId: string): Promise<string> {
  // Reuse a cert already requested for this exact domain, else request one (DNS validation).
  const list = await acm.send(new ListCertificatesCommand({ MaxItems: 100 }));
  let arn = list.CertificateSummaryList?.find((c) => c.DomainName === domain)?.CertificateArn;
  if (!arn) {
    // ponytail: idempotency token derived from the domain (this env has no Math.random) — a
    // retry within ACM's token window reuses the request instead of minting duplicate certs.
    const req = await acm.send(
      new RequestCertificateCommand({
        DomainName: domain,
        ValidationMethod: "DNS",
        IdempotencyToken: domain.replace(/[^A-Za-z0-9]/g, "").slice(0, 32),
      }),
    );
    arn = req.CertificateArn!;
  }

  // ACM populates the validation ResourceRecord asynchronously; add it via the DNS provider as
  // soon as it appears, then poll to ISSUED (~1-5 min once the CNAME resolves).
  let rrWritten = false;
  for (let i = 0; i < 60; i++) {
    const cert = (await acm.send(new DescribeCertificateCommand({ CertificateArn: arn })))
      .Certificate!;
    if (cert.Status === "ISSUED") return arn!;
    if (cert.Status && cert.Status !== "PENDING_VALIDATION")
      throw new Error(`cert ${domain} status ${cert.Status}`);
    const rr = cert.DomainValidationOptions?.[0]?.ResourceRecord;
    if (rr?.Name && rr.Value && !rrWritten) {
      await cfUpsertCname(zoneId, stripDot(rr.Name), stripDot(rr.Value), false);
      rrWritten = true;
    }
    await sleep(5000);
  }
  throw new Error(`cert ${domain} not ISSUED after ~5min — check DNS validation`);
}

const getMappings = (apigw: ApiGatewayV2Client, domain: string) =>
  apigw
    .send(new GetApiMappingsCommand({ DomainName: domain }))
    .then((r) => r.Items ?? [])
    .catch((e: any) => {
      if (e?.name === "NotFoundException") return [];
      throw e;
    });

// Teardown. **Shared-domain-aware:** when `appName` is given, first delete only THIS app's mapping;
// if any other app is still mapped on the domain, stop — the domain name, cert, and Cloudflare
// records are shared, so tearing them down would outage siblings. Only when this app is the last
// (or the sole) mapping does it do FULL cleanup: delete the API GW custom domain name (cascades the
// mapping), the slsv-minted ACM cert, and BOTH Cloudflare records (public + ACM validation CNAME).
// Single-app domains behave exactly as before (its mapping deleted → 0 remaining → full teardown).
// A BYO `certArn` and its validation record belong to the user, so those are left. NOT
// best-effort/silent: a real failure (missing token, cert stuck in-use) THROWS so the destroy step
// prints ✗ and exits non-zero. Only "already gone" is treated as success (idempotent re-run).
export async function destroyApiDomain(
  apigw: ApiGatewayV2Client,
  acm: ACMClient,
  api: Api,
  appName?: string,
): Promise<void> {
  const domain = api.domain!;

  // Remove only this app's mapping, then bail if siblings remain (shared domain).
  if (appName) {
    const apis = await apigw.send(new GetApisCommand({}));
    const apiId = apis.Items?.find((a) => a.Name === appName)?.ApiId;
    if (apiId) {
      const mine = (await getMappings(apigw, domain)).find((m) => m.ApiId === apiId);
      if (mine?.ApiMappingId) {
        await apigw.send(new DeleteApiMappingCommand({ DomainName: domain, ApiMappingId: mine.ApiMappingId }));
      }
    }
    const remaining = await getMappings(apigw, domain);
    if (remaining.length > 0) {
      console.log(`  kept shared custom domain ${domain} (${remaining.length} app(s) still mapped)`);
      return;
    }
  }

  // Capture the slsv-minted cert + its validation record name BEFORE deleting anything (skip
  // when the user brought their own cert — not ours to delete).
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

  // Domain name first — releases the cert so ACM will let us delete it.
  await apigw.send(new DeleteDomainNameCommand({ DomainName: domain })).catch((e: any) => {
    if (e?.name !== "NotFoundException") throw e;
  });

  // Cloudflare records — token REQUIRED. cfZoneIdForDomain throws a clear error if the token is
  // missing/lacks access, instead of the old silent skip that left records behind. Idempotent:
  // cfDeleteByName is a no-op when the record is already gone.
  const zoneId = await cfZoneIdForDomain(domain);
  await cfDeleteByName(zoneId, domain);
  if (validationName) await cfDeleteByName(zoneId, validationName);

  // DeleteCertificate races the domain-name release — API Gateway frees the cert only
  // eventually (seconds–minutes), so a one-shot delete hits ResourceInUse. Retry until it frees.
  if (certArn) await deleteCertWhenFree(acm, certArn);
}

async function deleteCertWhenFree(acm: ACMClient, arn: string): Promise<void> {
  for (let i = 0; i < 18; i++) {
    try {
      await acm.send(new DeleteCertificateCommand({ CertificateArn: arn }));
      return;
    } catch (e: any) {
      if (/NotFound/i.test(e?.name ?? "")) return; // already gone
      if (e?.name !== "ResourceInUseException") throw e;
      await sleep(10000); // still attached — wait for API Gateway to release it
    }
  }
  throw new Error(`ACM cert still in use after ~3min (${arn}) — re-run destroy to finish`);
}
