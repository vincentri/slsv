---
'@slsv/cli': minor
'@slsv/sdk': minor
---

`slsv dev`: hot-reload env changes and default to stage `local`

- Editing a `.env*` file during `slsv dev` now redeploys env/secrets (was code-only, so env
  edits were silently ignored — and `dotenv` never overwrote an already-set key, so a changed
  value couldn't re-enter the running process at all).
- `slsv dev` now runs under stage `local` (was `dev`), keeping local Floci resources
  (`<app>-local-*`) distinct from a real server `dev` stack (`<app>-dev-*`). Override with
  `--stage`. Other commands still default to `dev`.
