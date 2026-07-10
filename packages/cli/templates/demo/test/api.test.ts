import { describe, it, expect, beforeAll } from "vitest";

// Example: unit-test a slsv handler by invoking it with a fake API Gateway event — no AWS, no
// Floci. The router (from @slsv/sdk) dispatches on method + path and returns { statusCode, body }.
//
// backend/api.ts calls queue("clicks") at module load, which reads QUEUE_CLICKS — set a dummy
// value before importing so the module resolves. These tests exercise only routes that DON'T
// send to SQS (the /api/r/{id} redirect does; test its 404 path, which returns first).

type LambdaResponse = { statusCode: number; body: string };
let handler: (e: unknown) => Promise<LambdaResponse>;

beforeAll(async () => {
  process.env.QUEUE_CLICKS = "http://localhost:4566/000000000000/demo-dev-clicks";
  ({ handler } = (await import("../backend/api.js")) as {
    handler: (e: unknown) => Promise<LambdaResponse>;
  });
});

const call = (method: string, path: string, opts: { key?: boolean; body?: unknown } = {}) =>
  handler({
    httpMethod: method,
    path,
    headers: opts.key ? { "x-api-key": "demo-key" } : {},
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });

describe("demo backend router", () => {
  it("lists links publicly (empty at first)", async () => {
    const res = await call("GET", "/api/links");
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual([]);
  });

  it("rejects create without the API key (401)", async () => {
    const res = await call("POST", "/api/links", { body: { url: "https://example.com" } });
    expect(res.statusCode).toBe(401);
  });

  it("validates that url is required (400)", async () => {
    const res = await call("POST", "/api/links", { key: true, body: {} });
    expect(res.statusCode).toBe(400);
  });

  it("creates a link with the key, then lists it", async () => {
    const created = await call("POST", "/api/links", { key: true, body: { url: "https://slsv.dev" } });
    expect(created.statusCode).toBe(201);
    const link = JSON.parse(created.body);
    expect(link.url).toBe("https://slsv.dev");
    expect(link.id).toHaveLength(6);

    const list = JSON.parse((await call("GET", "/api/links")).body);
    expect(list.some((l: { id: string }) => l.id === link.id)).toBe(true);
  });

  it("404s an unknown short link", async () => {
    const res = await call("GET", "/api/r/nope99");
    expect(res.statusCode).toBe(404);
  });
});
