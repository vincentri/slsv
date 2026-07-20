# @slsv/cli

## 0.1.2

### Patch Changes

- AWS: clear stale alias routing weights before attaching Provisioned Concurrency. A `live` alias left with `RoutingConfig.AdditionalVersionWeights` (from prior state) can't take Provisioned Concurrency — AWS rejects it and `UpdateAlias` otherwise leaves the weights intact, dead-locking the deploy. The PC path now clears them.
  - @slsv/sdk@0.1.2
