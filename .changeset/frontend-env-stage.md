---
"@slsv/cli": patch
---

fix(frontend): support `frontend.env` — stage overlays deep-merge over base (stage wins per key), values injected into the frontend build command; `slsv plan` now flags a frontend build-env change (env hash tagged onto the frontend bucket) instead of "No changes"
