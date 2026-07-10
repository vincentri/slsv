import { describe, expect, it } from "vitest";
import { get, json, post, redirect, request, router, type Middleware } from "./api.js";

describe("api helpers", () => {
  it("normalizes HTTP API v2 events", () => {
    const req = request<{ name: string }>(
      {
        rawPath: "/api/users/42",
        rawQueryString: "active=true",
        headers: { "Content-Type": "application/json" },
        body: '{"name":"Ada"}',
        requestContext: { http: { method: "POST" } },
      },
      "/api/users/{id}",
    );

    expect(req.method).toBe("POST");
    expect(req.path).toBe("/api/users/42");
    expect(req.headers["content-type"]).toBe("application/json");
    expect(req.query.active).toBe("true");
    expect(req.params.id).toBe("42");
    expect(req.body?.name).toBe("Ada");
  });

  it("matches greedy proxy routes", async () => {
    const handler = router([
      {
        method: "ANY",
        path: "/api/{proxy+}",
        handler: (req) => json({ proxy: req.params.proxy }),
      },
    ]);

    const res = await handler({
      rawPath: "/api/links/123/click",
      requestContext: { http: { method: "GET" } },
    });

    expect(JSON.parse(res.body)).toEqual({ proxy: "links/123/click" });
  });

  it("returns not found when no route matches", async () => {
    const handler = router([{ method: "GET", path: "/api/ok", handler: () => json({ ok: true }) }]);
    const res = await handler({
      rawPath: "/api/missing",
      requestContext: { http: { method: "GET" } },
    });

    expect(res.statusCode).toBe(404);
  });

  it("returns a clean error for invalid JSON bodies", async () => {
    const handler = router([
      { method: "POST", path: "/api/links", handler: () => json({ ok: true }) },
    ]);
    const res = await handler({
      rawPath: "/api/links",
      body: "{",
      requestContext: { http: { method: "POST" } },
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toEqual({ error: "Invalid JSON body" });
  });

  it("builds common responses", () => {
    expect(json({ ok: true }).headers["content-type"]).toBe("application/json");
    expect(redirect("/login").headers.location).toBe("/login");
  });

  it("runs global + per-route middleware in onion order", async () => {
    const order: string[] = [];
    const global: Middleware = async (_req, next) => {
      order.push("global-in");
      const res = await next();
      order.push("global-out");
      return res;
    };
    const routeMw: Middleware = async (_req, next) => {
      order.push("route-in");
      return next();
    };
    const handle = router(
      [
        {
          path: "/api/ok",
          handler: () => {
            order.push("handler");
            return json({ ok: true });
          },
          middleware: [routeMw],
        },
      ],
      [global],
    );
    const res = await handle({ rawPath: "/api/ok", requestContext: { http: { method: "GET" } } });
    expect(res.statusCode).toBe(200);
    expect(order).toEqual(["global-in", "route-in", "handler", "global-out"]);
  });

  it("middleware can short-circuit without calling the handler (auth)", async () => {
    let handlerRan = false;
    const requireAuth: Middleware = (req, next) =>
      req.headers.authorization ? next() : json({ error: "unauthorized" }, 401);
    const handle = router([
      {
        path: "/api/secret",
        handler: () => {
          handlerRan = true;
          return json({ ok: true });
        },
        middleware: [requireAuth],
      },
    ]);
    const res = await handle({
      rawPath: "/api/secret",
      requestContext: { http: { method: "GET" } },
    });
    expect(res.statusCode).toBe(401);
    expect(handlerRan).toBe(false);
  });

  it("method helpers build routes and carry middleware", async () => {
    const requireAuth: Middleware = (req, next) =>
      req.headers.authorization ? next() : json({ error: "unauthorized" }, 401);
    const handle = router([
      get("/api/thing", () => json({ read: true })),
      post("/api/thing", { middleware: [requireAuth] }, () => json({ wrote: true }, 201)),
    ]);

    const read = await handle({ rawPath: "/api/thing", requestContext: { http: { method: "GET" } } });
    expect(read.statusCode).toBe(200);
    expect(JSON.parse(read.body)).toEqual({ read: true });

    const blocked = await handle({
      rawPath: "/api/thing",
      requestContext: { http: { method: "POST" } },
    });
    expect(blocked.statusCode).toBe(401);

    const wrote = await handle({
      rawPath: "/api/thing",
      headers: { authorization: "token" },
      requestContext: { http: { method: "POST" } },
    });
    expect(wrote.statusCode).toBe(201);
    expect(JSON.parse(wrote.body)).toEqual({ wrote: true });
  });
});
