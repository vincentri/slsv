# @slsv/sdk

## 0.2.5

## 0.2.4

### Patch Changes

- 2585f79: chore: deslop passes 1-5 — dedup, pagination, lint fixes

## 0.2.3

### Patch Changes

- dbac253: New `bucket:` function trigger — S3 event notifications. `bucket: { name, events?: [created|removed], prefix?, suffix? }` or an array of those blocks (multiple buckets/filters fan-in to one function). Wired via AddPermission + PutBucketNotificationConfiguration, merged per declared bucket so add/change/remove converge on redeploy. Lint validates the target bucket is declared; a trigger-target bucket no longer warns as unused. Verified end-to-end on Floci.
- a19da05: EventBridge publish support: `emit(detailType, detail, { source? })` in @slsv/sdk puts an event on the default bus (Source defaults to the app name via new SLSV_APP env, injected into every function), throwing on per-entry failure. Exec role gains `events:PutEvents` scoped to the default bus, so producers need no manual IAM. Consumers keep subscribing with `event: { pattern }` — works across separate slsv apps on the shared default bus. Verified end-to-end on Floci.
- 2f73d89: Reconcile now prunes secrets dropped from slsv.yml under the same `autoRemove` gate as data stores (report-only by default; deleted with `ForceDeleteWithoutRecovery` when `autoRemove: true`). `slsv plan` classifies secret orphans as destructive deletes accordingly. Stage prefix keeps sibling stages' secrets untouched.

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
