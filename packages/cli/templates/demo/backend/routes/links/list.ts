import { get, json } from "@slsv/sdk";
import { store } from "../../lib/store";

// GET /api/links — public. Path is '/' because links/index.ts groups it under '/links' (the
// slsv.yml `/api/{proxy+}` mount adds the `/api`).
export const list = get("/", () => json([...store.values()]));
