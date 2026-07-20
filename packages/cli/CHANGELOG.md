# @slsv/cli

## 0.1.3

### Patch Changes

- AWS: recreate the `live` alias each Provisioned Concurrency deploy (delete + create) instead of updating in place. AWS refuses to attach PC to an alias carrying stale config (e.g. version-weight routing), and UpdateAlias can't reliably strip it — a fresh alias guarantees a clean, PC-attachable state.
  - @slsv/sdk@0.1.3

## 0.1.2

### Patch Changes

- AWS: clear stale alias routing weights before attaching Provisioned Concurrency. A `live` alias left with `RoutingConfig.AdditionalVersionWeights` (from prior state) can't take Provisioned Concurrency — AWS rejects it and `UpdateAlias` otherwise leaves the weights intact, dead-locking the deploy. The PC path now clears them.
  - @slsv/sdk@0.1.2
