# @slsv/sdk

## 0.2.2

### Patch Changes

- 418d74f: feat(frontend): `cacheTtl` sets CloudFront edge DefaultTTL (converged on redeploy); `invalidate` (default true) flushes the edge cache (`/*`) after each redeploy so the new build serves immediately

## 0.2.1

### Patch Changes

- f9acfb3: `frontend.domain` — custom domain for the S3/CloudFront frontend, provisioned end-to-end like `api.domain`: us-east-1 ACM cert (DNS-validated via Cloudflare), CloudFront Aliases + ViewerCertificate, public CNAME. `frontend.certArn` reuses a pre-validated cert. Aliases converge on redeploy; destroy cleans cert + both DNS records discovery-based. Also ships `workers:` (ECS Fargate container jobs, `worker('name').run(payload)` from the SDK).

## 0.2.0

## 0.1.4

## 0.1.3

## 0.1.2
