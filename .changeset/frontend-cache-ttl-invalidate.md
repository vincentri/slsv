---
"@slsv/cli": patch
"@slsv/sdk": patch
---

feat(frontend): `cacheTtl` sets CloudFront edge DefaultTTL (converged on redeploy); `invalidate` (default true) flushes the edge cache (`/*`) after each redeploy so the new build serves immediately
