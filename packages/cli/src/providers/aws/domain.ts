import {
  ApiGatewayV2Client,
  GetApisCommand,
  GetDomainNameCommand,
  GetDomainNamesCommand,
  CreateDomainNameCommand,
  DeleteDomainNameCommand,
  GetApiMappingsCommand,
  CreateApiMappingCommand,
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
  const mappings = await apigw.send(new GetApiMappingsCommand({ DomainName: domain }));
  if (!mappings.Items?.some((m) => m.ApiId === apiId)) {
    await apigw.send(
      new CreateApiMappingCommand({ DomainName: domain, ApiId: apiId, Stage: "$default" }),
    );
  }

  // Point the public domain at the api-gw target (DNS-only, not proxied — user can enable
  // Cloudflare's proxy afterward once it verifies).
  await cfUpsertCname(zoneId, domain, target, false);

  // Changed subdomain? Tear down the previous domain now mapped to this same API.
  await pruneOldApiDomains(apigw, acm, appName, domain);
  return `https://${domain}`;
}

// After ensuring the current domain, tear down any OTHER custom domain still mapped to this
// app's API — i.e. the old subdomain after `api.domain` is changed. Without this, a rename
// orphans the old domain name + mapping + slsv-minted cert + both Cloudflare records forever
// (destroy is yml-driven, so it only ever knows the current domain). Discovery-based: enumerate
// domains, keep the ones mapped to our apiId, drop the current one. destroyApiDomain treats each
// as slsv-minted (no certArn) — safe because it only deletes a cert whose ACM DomainName exactly
// equals the old domain, so a BYO wildcard (DomainName `*.myapp.com`) never matches.
// Failures warn and continue (a stray old domain must not block the deploy).
// ponytail: reads one page of GetDomainNames (paginate if an account fronts >100 domains); a BYO
// exact-match (non-wildcard) cert on the old domain WOULD be deleted — rare, note it if hit.
async function pruneOldApiDomains(
  apigw: ApiGatewayV2Client,
  acm: ACMClient,
  appName: string,
  keepDomain: string,
): Promise<void> {
  const apis = await apigw.send(new GetApisCommand({}));
  const apiId = apis.Items?.find((a) => a.Name === appName)?.ApiId;
  if (!apiId) return;

  const domains = await apigw.send(new GetDomainNamesCommand({}));
  for (const d of domains.Items ?? []) {
    const name = d.DomainName;
    if (!name || name === keepDomain) continue;
    const mappings = await apigw.send(new GetApiMappingsCommand({ DomainName: name }));
    if (!mappings.Items?.some((m) => m.ApiId === apiId)) continue;
    console.log(`  pruning old custom domain ${name} (replaced by ${keepDomain})`);
    await destroyApiDomain(apigw, acm, { domain: name }).catch((e: any) =>
      console.warn(`  ⚠ could not prune old domain ${name}: ${e?.message ?? e}`),
    );
  }
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

// Teardown: FULL cleanup — nothing left behind. Deletes the API GW custom domain name (cascades
// its mapping), the slsv-minted ACM cert, and BOTH Cloudflare records (public CNAME + the ACM
// validation CNAME). A BYO `certArn` and its validation record belong to the user, so those are
// left. NOT best-effort/silent: a real failure (missing token, cert stuck in-use) THROWS so the
// destroy step prints ✗ and exits non-zero — an earlier version swallowed everything and printed
// a lying ✓ while records survived. Only "already gone" is treated as success (idempotent re-run).
export async function destroyApiDomain(
  apigw: ApiGatewayV2Client,
  acm: ACMClient,
  api: Api,
): Promise<void> {
  const domain = api.domain!;

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
