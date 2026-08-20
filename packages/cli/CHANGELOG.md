# @slsv/cli

## 0.2.5

### Patch Changes

- 2f8194b: fix(frontend): support `frontend.env` — stage overlays deep-merge over base (stage wins per key), values injected into the frontend build command; `slsv plan` now flags a frontend build-env change (env hash tagged onto the frontend bucket) instead of "No changes"
  - @slsv/sdk@0.2.5

## 0.2.4

### Patch Changes

- 2585f79: chore: deslop passes 1-5 — dedup, pagination, lint fixes
- Updated dependencies [2585f79]
  - @slsv/sdk@0.2.4

## 0.2.3

### Patch Changes

- dbac253: New `bucket:` function trigger — S3 event notifications. `bucket: { name, events?: [created|removed], prefix?, suffix? }` or an array of those blocks (multiple buckets/filters fan-in to one function). Wired via AddPermission + PutBucketNotificationConfiguration, merged per declared bucket so add/change/remove converge on redeploy. Lint validates the target bucket is declared; a trigger-target bucket no longer warns as unused. Verified end-to-end on Floci.
- a19da05: EventBridge publish support: `emit(detailType, detail, { source? })` in @slsv/sdk puts an event on the default bus (Source defaults to the app name via new SLSV_APP env, injected into every function), throwing on per-entry failure. Exec role gains `events:PutEvents` scoped to the default bus, so producers need no manual IAM. Consumers keep subscribing with `event: { pattern }` — works across separate slsv apps on the shared default bus. Verified end-to-end on Floci.
- 2f73d89: Reconcile now prunes secrets dropped from slsv.yml under the same `autoRemove` gate as data stores (report-only by default; deleted with `ForceDeleteWithoutRecovery` when `autoRemove: true`). `slsv plan` classifies secret orphans as destructive deletes accordingly. Stage prefix keeps sibling stages' secrets untouched.
- Updated dependencies [dbac253]
- Updated dependencies [a19da05]
- Updated dependencies [2f73d89]
  - @slsv/sdk@0.2.3

## 0.2.2

### Patch Changes

- 418d74f: feat(frontend): `cacheTtl` sets CloudFront edge DefaultTTL (converged on redeploy); `invalidate` (default true) flushes the edge cache (`/*`) after each redeploy so the new build serves immediately
- Updated dependencies [418d74f]
  - @slsv/sdk@0.2.2

## 0.2.1

### Patch Changes

- f9acfb3: `frontend.domain` — custom domain for the S3/CloudFront frontend, provisioned end-to-end like `api.domain`: us-east-1 ACM cert (DNS-validated via Cloudflare), CloudFront Aliases + ViewerCertificate, public CNAME. `frontend.certArn` reuses a pre-validated cert. Aliases converge on redeploy; destroy cleans cert + both DNS records discovery-based. Also ships `workers:` (ECS Fargate container jobs, `worker('name').run(payload)` from the SDK).
- Updated dependencies [f9acfb3]
  - @slsv/sdk@0.2.1

## 0.2.0

### Minor Changes

- bef572f: New `slsv upgrade` command — resolves the latest published version directly from the npm
  registry (bypassing the package manager's cached `latest` dist-tag) and reinstalls the
  global CLI through whichever package manager owns the running binary (npm/pnpm/yarn),
  pinned to the exact version. `--force` reinstalls even when already current. Linked/local
  installs (dev checkouts) print relink guidance instead of attempting an update.

### Patch Changes

- @slsv/sdk@0.2.0

## 0.1.4

### Patch Changes

- 3b1116d: `slsv --version` now reports the real package version (tsup inlines it from
  package.json at build) instead of a hardcoded `0.0.1` that never got bumped.
- 928772b: Reconcile no longer aborts a successful deploy when it can't prune a leftover
  `<app>-<stage>-frontend` bucket. A cross-account / permission-denied stray bucket
  now warns and continues instead of throwing; `slsv destroy` remains the
  authoritative teardown.
- 2a93bdb: Fix `PermanentRedirect` (301) crash on deploy when a leftover `<app>-<stage>-frontend`
  bucket lives in a different region than the current deploy (region changed between deploys).
  The S3 client now sets `followRegionRedirects: true`, so reconcile can reach across and
  delete the stray bucket instead of throwing.
  - @slsv/sdk@0.1.4

## 0.1.3

### Patch Changes

- AWS: recreate the `live` alias each Provisioned Concurrency deploy (delete + create) instead of updating in place. AWS refuses to attach PC to an alias carrying stale config (e.g. version-weight routing), and UpdateAlias can't reliably strip it — a fresh alias guarantees a clean, PC-attachable state.
  - @slsv/sdk@0.1.3

## 0.1.2

### Patch Changes

- AWS: clear stale alias routing weights before attaching Provisioned Concurrency. A `live` alias left with `RoutingConfig.AdditionalVersionWeights` (from prior state) can't take Provisioned Concurrency — AWS rejects it and `UpdateAlias` otherwise leaves the weights intact, dead-locking the deploy. The PC path now clears them.
  - @slsv/sdk@0.1.2
