# @slsv/cli

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
