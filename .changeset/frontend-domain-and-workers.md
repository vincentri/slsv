---
"@slsv/cli": patch
"@slsv/sdk": patch
---

`frontend.domain` — custom domain for the S3/CloudFront frontend, provisioned end-to-end like `api.domain`: us-east-1 ACM cert (DNS-validated via Cloudflare), CloudFront Aliases + ViewerCertificate, public CNAME. `frontend.certArn` reuses a pre-validated cert. Aliases converge on redeploy; destroy cleans cert + both DNS records discovery-based. Also ships `workers:` (ECS Fargate container jobs, `worker('name').run(payload)` from the SDK).
