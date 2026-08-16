---
"@slsv/cli": patch
"@slsv/sdk": patch
---

Reconcile now prunes secrets dropped from slsv.yml under the same `autoRemove` gate as data stores (report-only by default; deleted with `ForceDeleteWithoutRecovery` when `autoRemove: true`). `slsv plan` classifies secret orphans as destructive deletes accordingly. Stage prefix keeps sibling stages' secrets untouched.
