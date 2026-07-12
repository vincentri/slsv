import { describe, it, expect } from "vitest";
import { classify, type LiveState } from "./plan.js";
import type { AppConfig } from "../../config.js";

// classify() is the pure two-way diff (yml vs live). Build a cfg + a hand-authored live state
// and assert the create/update/replace/delete/orphan buckets.

const EMPTY: LiveState = {
  functions: [],
  tables: [],
  databases: [],
  buckets: [],
  queues: [],
  secrets: [],
  caches: [],
};

const cfg = (over: Partial<AppConfig>): AppConfig => ({ app: "shop", ...over }) as AppConfig;
const find = (r: ReturnType<typeof classify>, kind: string, name: string) =>
  r.changes.find((c) => c.kind === kind && c.name === name);

describe("classify", () => {
  it("flags a create when a function is in yml but not live", () => {
    const r = classify(cfg({ functions: { api: { handler: "a.h", runtime: "nodejs22" } as any } }), "dev", EMPTY);
    expect(find(r, "function", "api")?.action).toBe("create");
  });

  it("flags an update when a mutable Lambda field drifts", () => {
    const r = classify(
      cfg({ functions: { api: { handler: "a.h", runtime: "nodejs22", memory: 512 } as any } }),
      "dev",
      { ...EMPTY, functions: [{ name: "shop-dev-api", memory: 256, timeout: 30, arch: "arm64" }] },
    );
    const c = find(r, "function", "api");
    expect(c?.action).toBe("update");
    expect(c?.detail).toContain("memory 256→512");
  });

  it("flags a replace when an immutable Lambda field (architecture) drifts", () => {
    const r = classify(
      cfg({ functions: { api: { handler: "a.h", runtime: "nodejs22", architecture: "x86_64" } as any } }),
      "dev",
      { ...EMPTY, functions: [{ name: "shop-dev-api", memory: 256, timeout: 30, arch: "arm64" }] },
    );
    expect(find(r, "function", "api")?.action).toBe("replace");
  });

  it("reports no change when a function matches (defaults applied)", () => {
    const r = classify(
      cfg({ functions: { api: { handler: "a.h", runtime: "nodejs22" } as any } }),
      "dev",
      { ...EMPTY, functions: [{ name: "shop-dev-api", memory: 256, timeout: 30, ephemeral: 512, arch: "arm64" }] },
    );
    expect(r.changes).toHaveLength(0);
  });

  it("prunes (delete) a Lambda orphan regardless of autoRemove", () => {
    const r = classify(cfg({}), "dev", { ...EMPTY, functions: [{ name: "shop-dev-old" }] });
    const c = find(r, "function", "old");
    expect(c?.action).toBe("delete");
    expect(c?.destructive).toBeFalsy();
  });

  it("flags a replace when a Dynamo partition key changes", () => {
    const r = classify(
      cfg({ databases: { orders: { type: "dynamodb", partitionKey: { name: "pk", type: "S" } } as any } }),
      "dev",
      { ...EMPTY, tables: [{ name: "shop-dev-orders", partitionKey: "id" }] },
    );
    expect(find(r, "table", "orders")?.action).toBe("replace");
  });

  it("keeps a data-store orphan (orphan action) when autoRemove is false (default)", () => {
    const r = classify(cfg({}), "dev", { ...EMPTY, tables: ["shop-dev-orders"].map((name) => ({ name })) });
    const c = find(r, "table", "orders");
    expect(c?.action).toBe("orphan");
  });

  it("deletes a data-store orphan destructively when autoRemove is true", () => {
    const r = classify(cfg({ autoRemove: true }), "dev", {
      ...EMPTY,
      tables: [{ name: "shop-dev-orders" }],
    });
    const c = find(r, "table", "orders");
    expect(c?.action).toBe("delete");
    expect(c?.destructive).toBe(true);
  });

  it("orphans a queue/secret/cache the deploy never prunes", () => {
    const r = classify(cfg({ autoRemove: true }), "dev", {
      ...EMPTY,
      queues: ["shop-dev-jobs"],
      secrets: ["shop-dev-API_KEY"],
      caches: ["shop-dev-session"],
    });
    expect(find(r, "queue", "jobs")?.action).toBe("orphan");
    expect(find(r, "secret", "API_KEY")?.action).toBe("orphan");
    expect(find(r, "cache", "session")?.action).toBe("orphan");
  });

  it("matches a fifo queue by its .fifo suffix (no false create/delete)", () => {
    const r = classify(
      cfg({ queues: { jobs: { type: "sqs", fifo: true } as any } }),
      "dev",
      { ...EMPTY, queues: ["shop-dev-jobs.fifo"] },
    );
    expect(r.changes).toHaveLength(0);
  });

  it("does NOT orphan an auto-provisioned DLQ (`dlq: true`)", () => {
    const r = classify(
      cfg({ queues: { jobs: { type: "sqs", dlq: true } as any } }),
      "dev",
      { ...EMPTY, queues: ["shop-dev-jobs", "shop-dev-jobsFailed"] },
    );
    expect(r.changes).toHaveLength(0);
  });

  it("does NOT orphan a named DLQ auto-provisioned by slsv (not declared in yml)", () => {
    const r = classify(
      cfg({ queues: { jobs: { type: "sqs", dlq: "myDlq" } as any } }),
      "dev",
      { ...EMPTY, queues: ["shop-dev-jobs", "shop-dev-myDlq"] },
    );
    expect(r.changes).toHaveLength(0);
  });

  it("orphans a queue slsv never created (genuinely stray)", () => {
    const r = classify(cfg({}), "dev", { ...EMPTY, queues: ["shop-dev-stranger"] });
    expect(find(r, "queue", "stranger")?.action).toBe("orphan");
  });
});
