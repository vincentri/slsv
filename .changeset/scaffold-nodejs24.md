---
'@slsv/cli': patch
---

Scaffolds now default to the `nodejs24` runtime

`slsv init` (minimal + `--demo`) and the reference `slsv.example.yml` now use `runtime: nodejs24`
instead of `nodejs22`. Both remain valid; existing apps are unaffected (change the `runtime` field
yourself to move).
