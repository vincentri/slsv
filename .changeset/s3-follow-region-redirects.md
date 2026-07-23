---
"slsv": patch
---

Fix `PermanentRedirect` (301) crash on deploy when a leftover `<app>-<stage>-frontend`
bucket lives in a different region than the current deploy (region changed between deploys).
The S3 client now sets `followRegionRedirects: true`, so reconcile can reach across and
delete the stray bucket instead of throwing.
