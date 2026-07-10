import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { rmSync, mkdirSync, writeFileSync } from "fs";
import path from "path";
import os from "os";
import { lintApp } from "./lint.js";
import { ConfigError } from "./config.js";
import type { AppConfig } from "./config.js";

describe("lintApp", () => {
  let tmp: string;
  const write = (rel: string, src: string) => {
    const p = path.join(tmp, rel);
    mkdirSync(path.dirname(p), { recursive: true });
    writeFileSync(p, src);
  };

  beforeEach(() => {
    tmp = path.join(os.tmpdir(), `slsv-lint-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tmp, { recursive: true });
  });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  const fn = (handler: string, extra = {}) => ({
    runtime: "nodejs22" as const,
    handler,
    ...extra,
  });

  it("passes when yml matches code", () => {
    write(
      "src/api.ts",
      `import { db } from '@slsv/sdk'\nexport const handler = async () => db('links')`,
    );
    const cfg = {
      app: "x",
      functions: { api: fn("./src/api.handler", { http: [{ method: "GET", path: "/" }] }) },
      databases: { links: { type: "dynamodb", partitionKey: { name: "id", type: "S" } } },
    } as unknown as AppConfig;
    expect(() => lintApp(cfg, tmp)).not.toThrow();
  });

  it("errors on missing handler file", () => {
    const cfg = { app: "x", functions: { api: fn("./src/ghost.handler") } } as unknown as AppConfig;
    expect(() => lintApp(cfg, tmp)).toThrow(ConfigError);
    expect(() => lintApp(cfg, tmp)).toThrow(/handler file not found/);
  });

  it("errors when the named export is missing", () => {
    write("src/api.ts", `export const other = 1`);
    const cfg = { app: "x", functions: { api: fn("./src/api.handler") } } as unknown as AppConfig;
    expect(() => lintApp(cfg, tmp)).toThrow(/does not export 'handler'/);
  });

  it("accepts `export { x as handler }`", () => {
    write("src/api.ts", `const go = async () => 1\nexport { go as handler }`);
    const cfg = { app: "x", functions: { api: fn("./src/api.handler") } } as unknown as AppConfig;
    expect(() => lintApp(cfg, tmp)).not.toThrow();
  });

  it("errors when SDK call names an undeclared resource", () => {
    write(
      "src/api.ts",
      `import { queue } from '@slsv/sdk'\nexport const handler = async () => queue('nope').send({})`,
    );
    const cfg = { app: "x", functions: { api: fn("./src/api.handler") } } as unknown as AppConfig;
    expect(() => lintApp(cfg, tmp)).toThrow(/no queue 'nope' in slsv\.yml/);
  });

  it("does not flag same-named methods that are not SDK imports", () => {
    // `this.queue(...)` must not be mistaken for the SDK `queue()` accessor.
    write(
      "src/api.ts",
      `class C { queue(n: string){return n} }\nexport const handler = async () => new C().queue('anything')`,
    );
    const cfg = { app: "x", functions: { api: fn("./src/api.handler") } } as unknown as AppConfig;
    expect(() => lintApp(cfg, tmp)).not.toThrow();
  });

  it("respects import aliases", () => {
    write(
      "src/api.ts",
      `import { cache as c } from '@slsv/sdk'\nexport const handler = async () => c('bad').get('k')`,
    );
    const cfg = { app: "x", functions: { api: fn("./src/api.handler") } } as unknown as AppConfig;
    expect(() => lintApp(cfg, tmp)).toThrow(/no cache 'bad'/);
  });

  it("distinguishes db (dynamo) from sql (postgres/mysql)", () => {
    write(
      "src/api.ts",
      `import { db } from '@slsv/sdk'\nexport const handler = async () => db('pg')`,
    );
    // 'pg' is a postgres db, so db('pg') is wrong (should be sql('pg'))
    const cfg = {
      app: "x",
      functions: { api: fn("./src/api.handler") },
      databases: { pg: { type: "postgres" } },
    } as unknown as AppConfig;
    expect(() => lintApp(cfg, tmp)).toThrow(/no dynamodb database 'pg'/);
  });

  it("errors on a queue trigger with no matching queue", () => {
    write("src/api.ts", `export const handler = async () => 1`);
    const cfg = {
      app: "x",
      functions: { w: fn("./src/api.handler", { queue: { name: "missing" } }) },
    } as unknown as AppConfig;
    expect(() => lintApp(cfg, tmp)).toThrow(/queue trigger 'missing' not declared/);
  });

  it("warns (does not throw) on a declared-but-unused resource", () => {
    write("src/api.ts", `export const handler = async () => 1`);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const cfg = {
      app: "x",
      functions: { api: fn("./src/api.handler") },
      secrets: ["UNUSED"],
    } as unknown as AppConfig;
    expect(() => lintApp(cfg, tmp)).not.toThrow();
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/secret 'UNUSED'.*never used/));
    warn.mockRestore();
  });
});
