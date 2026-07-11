import { get, json } from "@slsv/sdk";

// GET /health — liveness probe. slsv.yml routes GET /health to this function.
export const check = get("/health", () => json({ ok: true }));
