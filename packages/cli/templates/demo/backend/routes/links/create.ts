import { json, post, type Middleware } from "@slsv/sdk";
import { shortId, store } from "../../lib/store";

// Middleware: gate this mutating route behind an API key. Call next() to continue, or return a
// response to short-circuit. Listing/redirecting stay public — only create carries the guard.
// ponytail: literal demo key — real apps read it at runtime with secret('API_KEY').
const requireApiKey: Middleware = (req, next) =>
  req.headers["x-api-key"] === "demo-key" ? next() : json({ error: "unauthorized" }, 401);

// POST /api/links — creates a short link. Path '/' (grouped under '/links'; mount adds '/api').
// Per-route middleware, so it's key-gated on its own.
export const create = post("/", { middleware: [requireApiKey] }, (req) => {
  const body = req.body as { url?: string } | undefined;
  if (!body?.url) return json({ error: "url is required" }, 400);

  const id = shortId();
  const link = { id, url: body.url, createdAt: new Date().toISOString() };
  store.set(id, link);
  return json(link, 201);
});
