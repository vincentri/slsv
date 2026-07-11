import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { rmSync, existsSync, readFileSync, mkdirSync } from "fs";
import path from "path";
import os from "os";
import { initScaffold } from "./init.js";

describe("initScaffold", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = path.join(os.tmpdir(), `slsv-init-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tmp, { recursive: true });
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("writes slsv.yml for backend stack", () => {
    initScaffold("myapp", tmp, "minimal", "backend");
    const yml = readFileSync(path.join(tmp, "myapp", "slsv.yml"), "utf-8");
    expect(yml).toMatch(/app: myapp/);
    expect(yml).toMatch(/functions:/);
    expect(existsSync(path.join(tmp, "myapp", "backend", "routes", "route.ts"))).toBe(true);
  });

  it("scaffolds the api-db template wired to an external Postgres", () => {
    initScaffold("dbapp", tmp, "api-db", "backend");
    const app = path.join(tmp, "dbapp");
    const yml = readFileSync(path.join(app, "slsv.yml"), "utf-8");
    expect(yml).toMatch(/app: dbapp/);
    expect(yml).toMatch(/secrets:/);
    expect(yml).toMatch(/DATABASE_URL/);
    expect(existsSync(path.join(app, "drizzle.config.ts"))).toBe(true);
    expect(existsSync(path.join(app, "backend", "database", "index.ts"))).toBe(true);
    expect(existsSync(path.join(app, "backend", "database", "schema.ts"))).toBe(true);
    expect(readFileSync(path.join(app, "package.json"), "utf-8")).toMatch(/drizzle-orm/);
    // backend-only: no frontend scaffolded
    expect(existsSync(path.join(app, "frontend"))).toBe(false);
  });

  it("writes slsv.yml for frontend stack without functions", () => {
    initScaffold("fe", tmp, "minimal", "frontend");
    const yml = readFileSync(path.join(tmp, "fe", "slsv.yml"), "utf-8");
    expect(yml).toMatch(/app: fe/);
    expect(yml).not.toMatch(/functions:/);
    expect(existsSync(path.join(tmp, "fe", "frontend", "index.html"))).toBe(true);
  });
});
