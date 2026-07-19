---
'@slsv/cli': patch
---

Shared custom domain via `api.basePath`

Multiple separate slsv apps can now share one custom `domain`, each mounted under its own base path
(`api.example.com/qualify`, `/auth`, …) via an API Gateway v2 mapping key. API Gateway strips the
base path, so every app keeps `path: /v1/{proxy+}`. Changing `basePath` re-keys the mapping in
place. Teardown is mapping-aware: `slsv destroy` on one app removes only that app's mapping and
leaves the shared domain + cert + DNS alone while siblings are still mounted — only the last app out
tears them down. Single-app domains (no `basePath`) behave exactly as before.
