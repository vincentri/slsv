---
'@slsv/cli': minor
---

`api.cors.origins` is now optional

Declare shared CORS (credentials/methods/headers/exposeHeaders) once in the base config and let
each stage add only its own `origins` overlay. A merged config with no `origins` is valid locally
(`slsv dev` — Floci/Quarkus owns CORS, the gateway config is ignored) and rejected on
`--target aws` when `credentials: true` (an open `*` is invalid for credentialed requests) with a
clear message pointing at `stages.<name>.api.cors.origins`. Previously a missing `origins` failed
with a cryptic `api.cors: Invalid input`, and — because `slsv dev` now defaults to stage `local` —
broke local dev for apps using the base-CORS/per-stage-origins pattern.
