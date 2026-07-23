---
"slsv": patch
---

Reconcile no longer aborts a successful deploy when it can't prune a leftover
`<app>-<stage>-frontend` bucket. A cross-account / permission-denied stray bucket
now warns and continues instead of throwing; `slsv destroy` remains the
authoritative teardown.
