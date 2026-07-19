---
'@slsv/cli': patch
---

`slsv init` scaffolds ship `.env.local`, `.env.dev`, `.env.prod`

Every template (minimal, demo, api-db) now generates the three per-stage env files by default:
`.env.local` (loaded by `slsv dev`, stage `local`), `.env.dev`, and `.env.prod`. All git-ignored,
so `slsv dev` reads `.env.local` directly — no more `cp .env.example .env` step. api-db seeds each
with a stage-appropriate `DATABASE_URL`; the demo seeds `WEBHOOK_SECRET`.
