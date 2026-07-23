---
"slsv": patch
---

`slsv --version` now reports the real package version (tsup inlines it from
package.json at build) instead of a hardcoded `0.0.1` that never got bumped.
