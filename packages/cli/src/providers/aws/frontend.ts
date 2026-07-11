import {
  S3Client,
  CreateBucketCommand,
  HeadBucketCommand,
  PutBucketWebsiteCommand,
  PutBucketPolicyCommand,
  PutPublicAccessBlockCommand,
  PutObjectCommand,
  PutBucketTaggingCommand,
} from "@aws-sdk/client-s3";
import {
  CloudFrontClient,
  ListDistributionsCommand,
  CreateDistributionCommand,
  GetDistributionConfigCommand,
  UpdateDistributionCommand,
  DeleteDistributionCommand,
  TagResourceCommand,
  waitUntilDistributionDeployed,
  type DistributionSummary,
} from "@aws-sdk/client-cloudfront";
import { createServer } from "node:http";
import { execSync } from "child_process";
import { createReadStream, readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import { asTagArray } from "./tags.js";
import { paginate } from "./index.js";
import type { FrontendDef } from "../../config.js";

const MIME: Record<string, string> = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "application/javascript",
  ".mjs": "application/javascript",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".txt": "text/plain",
  ".xml": "application/xml",
};

function walkDir(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => join(e.parentPath, e.name));
}

function runBuild(frontend: FrontendDef, cwd: string, apiUrl?: string) {
  if (!frontend.build) return;
  console.log(`  Building: ${frontend.build}`);
  // Auto-inject the deployed API base as VITE_SLSV_API_URL. Never touches VITE_API_URL, so
  // a user-set one (shell / frontend/.env) still wins in the frontend's resolution.
  execSync(frontend.build, {
    cwd,
    stdio: "inherit",
    env: { ...process.env, VITE_SLSV_API_URL: apiUrl ?? "" },
  });
}

// ponytail: native http+fs, no npx/npm fetch — dies when parent exits.
export async function deployFrontendLocal(
  frontend: FrontendDef,
  cwd: string,
  apiUrl?: string,
): Promise<string> {
  runBuild(frontend, cwd, apiUrl);
  const root = resolve(cwd, frontend.src);
  const mime = MIME;
  const send = (
    res: import("node:http").ServerResponse,
    code: number,
    body: string | Buffer,
    type?: string,
  ) => {
    res.writeHead(code, { "content-type": type ?? "application/octet-stream" });
    res.end(body);
  };
  const server = createServer((req, res) => {
    const url = (req.url ?? "/").split("?")[0];
    let filePath = join(root, url === "/" ? "/index.html" : url);
    try {
      const st = statSync(filePath);
      if (st.isDirectory()) filePath = join(filePath, "index.html");
    } catch {
      filePath = join(root, "index.html"); // SPA fallback
    }
    createReadStream(filePath)
      .on("open", () => {
        const type = mime[extname(filePath).toLowerCase()] ?? "application/octet-stream";
        res.writeHead(200, { "content-type": type });
      })
      .on("error", () => send(res, 404, "Not found"))
      .pipe(res);
  });
  // Best-effort preview server: a prior `slsv deploy` (local) leaves its server on :3000, so a
  // second deploy would hit EADDRINUSE. The backend is already provisioned by this point — don't
  // let a busy port crash the whole deploy. Warn and carry on (something's already serving it).
  server.on("error", (e: NodeJS.ErrnoException) => {
    if (e.code === "EADDRINUSE")
      console.warn("  ⚠ port 3000 in use — frontend preview not started (another slsv deploy?).");
    else console.warn(`  ⚠ frontend preview server error: ${e.message}`);
  });
  server.listen(3000);
  process.on("exit", () => server.close());
  return "http://localhost:3000";
}

export async function deployFrontendAws(
  s3: S3Client,
  cf: CloudFrontClient,
  frontend: FrontendDef,
  appName: string,
  cwd: string,
  region: string,
  tags: Record<string, string>,
  apiUrl?: string,
): Promise<string> {
  const bucket = `${appName}-frontend`;
  const src = resolve(cwd, frontend.src);
  // With CloudFront, /api/* is same-origin, so leave the relative default (no injected var)
  // instead of pointing the build at the API Gateway domain directly.
  runBuild(frontend, cwd, frontend.cloudfront ? undefined : apiUrl);

  try {
    await s3.send(new HeadBucketCommand({ Bucket: bucket }));
  } catch {
    await s3.send(new CreateBucketCommand({ Bucket: bucket }));
  }

  await s3.send(
    new PutBucketTaggingCommand({ Bucket: bucket, Tagging: { TagSet: asTagArray(tags) } }),
  );

  await s3.send(
    new PutPublicAccessBlockCommand({
      Bucket: bucket,
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: false,
        IgnorePublicAcls: false,
        BlockPublicPolicy: false,
        RestrictPublicBuckets: false,
      },
    }),
  );

  await s3.send(
    new PutBucketPolicyCommand({
      Bucket: bucket,
      Policy: JSON.stringify({
        Version: "2012-10-17",
        Statement: [
          {
            Effect: "Allow",
            Principal: "*",
            Action: "s3:GetObject",
            Resource: `arn:aws:s3:::${bucket}/*`,
          },
        ],
      }),
    }),
  );

  await s3.send(
    new PutBucketWebsiteCommand({
      Bucket: bucket,
      WebsiteConfiguration: {
        IndexDocument: { Suffix: "index.html" },
        ErrorDocument: { Key: "index.html" },
      },
    }),
  );

  const files = walkDir(src);
  console.log(`  Uploading ${files.length} files → s3://${bucket}`);
  await Promise.all(
    files.map((file) => {
      const key = relative(src, file).replace(/\\/g, "/");
      const ext = extname(file).toLowerCase();
      return s3.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: readFileSync(file),
          ContentType: MIME[ext] ?? "application/octet-stream",
        }),
      );
    }),
  );

  const s3WebsiteDomain = `${bucket}.s3-website-${region}.amazonaws.com`;
  if (frontend.cloudfront) {
    const apiDomain = apiUrl ? new URL(apiUrl).hostname : undefined;
    return ensureDistribution(cf, appName, s3WebsiteDomain, apiDomain, tags);
  }
  return `http://${s3WebsiteDomain}`;
}

// Idempotent: finds an existing distribution by its Comment tag (`slsv:<appName>`) instead of
// tracking an id, so redeploys don't create duplicates. ~15-20 min to first become deployed —
// this returns as soon as CloudFront accepts the config, it doesn't wait for that.
async function ensureDistribution(
  cf: CloudFrontClient,
  appName: string,
  s3WebsiteDomain: string,
  apiDomain: string | undefined,
  tags: Record<string, string>,
): Promise<string> {
  const comment = `slsv:${appName}`;
  const existing = await paginate<DistributionSummary>((Marker) =>
    cf.send(new ListDistributionsCommand({ Marker })).then((r) => ({
      items: r.DistributionList?.Items ?? [],
      next: r.DistributionList?.IsTruncated ? r.DistributionList?.NextMarker : undefined,
    })),
  );
  const found = existing.find((d) => d.Comment === comment);
  if (found) return `https://${found.DomainName}`;

  const s3OriginId = "slsv-s3-frontend";
  const apiOriginId = "slsv-api-gateway";

  const origins = [
    {
      Id: s3OriginId,
      DomainName: s3WebsiteDomain,
      CustomOriginConfig: {
        HTTPPort: 80,
        HTTPSPort: 443,
        OriginProtocolPolicy: "http-only" as const,
        OriginSslProtocols: { Quantity: 1, Items: ["TLSv1.2" as const] },
      },
    },
    ...(apiDomain
      ? [
          {
            Id: apiOriginId,
            DomainName: apiDomain,
            CustomOriginConfig: {
              HTTPPort: 80,
              HTTPSPort: 443,
              OriginProtocolPolicy: "https-only" as const,
              OriginSslProtocols: { Quantity: 1, Items: ["TLSv1.2" as const] },
            },
          },
        ]
      : []),
  ];

  const res = await cf.send(
    new CreateDistributionCommand({
      DistributionConfig: {
        CallerReference: `${appName}-${Date.now()}`,
        Comment: comment,
        Enabled: true,
        DefaultRootObject: "index.html",
        Origins: { Quantity: origins.length, Items: origins },
        DefaultCacheBehavior: {
          TargetOriginId: s3OriginId,
          ViewerProtocolPolicy: "redirect-to-https",
          AllowedMethods: {
            Quantity: 2,
            Items: ["GET", "HEAD"],
            CachedMethods: { Quantity: 2, Items: ["GET", "HEAD"] },
          },
          ForwardedValues: {
            QueryString: false,
            Cookies: { Forward: "none" },
          },
          MinTTL: 0,
          Compress: true,
        },
        CacheBehaviors: apiDomain
          ? {
              Quantity: 1,
              Items: [
                {
                  PathPattern: "/api/*",
                  TargetOriginId: apiOriginId,
                  ViewerProtocolPolicy: "redirect-to-https",
                  AllowedMethods: {
                    Quantity: 7,
                    Items: ["GET", "HEAD", "OPTIONS", "PUT", "PATCH", "POST", "DELETE"],
                    CachedMethods: { Quantity: 2, Items: ["GET", "HEAD"] },
                  },
                  // AWS-managed policies (can't be combined with ForwardedValues): CachingDisabled
                  // + AllViewerExceptHostHeader — forwards all query/headers/cookies EXCEPT Host.
                  // Forwarding the viewer Host (the CloudFront domain) to an HTTP API origin makes
                  // API Gateway 403 — it routes by its own execute-api Host. IDs are global/constant.
                  CachePolicyId: "4135ea2d-6df8-44a3-9df3-4b5a84be39ad", // CachingDisabled
                  OriginRequestPolicyId: "b689b0a8-53d0-40ab-baf2-68738e2966ac", // AllViewerExceptHostHeader
                },
              ],
            }
          : { Quantity: 0 },
        CustomErrorResponses: {
          Quantity: 2,
          Items: [
            {
              ErrorCode: 403,
              ResponseCode: "200",
              ResponsePagePath: "/index.html",
              ErrorCachingMinTTL: 0,
            },
            {
              ErrorCode: 404,
              ResponseCode: "200",
              ResponsePagePath: "/index.html",
              ErrorCachingMinTTL: 0,
            },
          ],
        },
      },
    }),
  );
  await cf.send(
    new TagResourceCommand({
      Resource: res.Distribution!.ARN!,
      Tags: { Items: asTagArray(tags) },
    }),
  );
  return `https://${res.Distribution!.DomainName}`;
}

// ponytail: disable→wait→delete is ~15-20 min total; logs progress so destroy doesn't look hung.
export async function destroyDistribution(
  cf: CloudFrontClient,
  appName: string,
): Promise<"deleted" | "none"> {
  const comment = `slsv:${appName}`;
  const items = await paginate<DistributionSummary>((Marker) =>
    cf.send(new ListDistributionsCommand({ Marker })).then((r) => ({
      items: r.DistributionList?.Items ?? [],
      next: r.DistributionList?.IsTruncated ? r.DistributionList?.NextMarker : undefined,
    })),
  );
  const found = items.find((d) => d.Comment === comment);
  if (!found) return "none";

  const { DistributionConfig, ETag } = await cf.send(
    new GetDistributionConfigCommand({ Id: found.Id }),
  );
  let deleteETag = ETag;
  if (DistributionConfig!.Enabled) {
    console.log("  disabling CloudFront distribution (this takes a few minutes)...");
    const updated = await cf.send(
      new UpdateDistributionCommand({
        Id: found.Id,
        IfMatch: ETag,
        DistributionConfig: { ...DistributionConfig!, Enabled: false },
      }),
    );
    console.log("  waiting for distribution to finish disabling (~10-20 min)...");
    await waitUntilDistributionDeployed({ client: cf, maxWaitTime: 1800 }, { Id: found.Id });
    deleteETag = updated.ETag;
  }

  console.log("  deleting CloudFront distribution...");
  await cf.send(new DeleteDistributionCommand({ Id: found.Id, IfMatch: deleteETag }));
  return "deleted";
}
