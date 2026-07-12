import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { rmSync, mkdirSync, writeFileSync } from "fs";
import path from "path";
import os from "os";
import { loadConfig, ConfigError } from "./config.js";

// Exercises the `stages:` overlay: deep-merge, scalar override, and null-removal trigger swap.
describe("loadConfig stage overlay", () => {
  let tmp: string;
  const write = (yml: string) => writeFileSync(path.join(tmp, "slsv.yml"), yml);

  beforeEach(() => {
    tmp = path.join(os.tmpdir(), `slsv-cfg-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tmp, { recursive: true });
  });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  const base = `
app: shop
functions:
  worker:
    runtime: nodejs22
    handler: ./src/worker.handler
    timeout: 30
    queue: { name: jobs }
queues:
  jobs: { type: sqs }
stages:
  prod:
    functions:
      worker:
        timeout: 300
  dev:
    functions:
      worker:
        queue: null
        event:
          pattern:
            source: ['orders']
`;

  it("base (no stage block match) is unchanged", () => {
    write(base);
    const cfg = loadConfig(tmp, "nonexistent");
    expect(cfg.functions!.worker.timeout).toBe(30);
    expect(cfg.functions!.worker.queue).toEqual({ name: "jobs" });
  });

  it("prod overlay overrides only the scalar it names", () => {
    write(base);
    const cfg = loadConfig(tmp, "prod");
    expect(cfg.functions!.worker.timeout).toBe(300);
    expect(cfg.functions!.worker.queue).toEqual({ name: "jobs" }); // untouched
  });

  it("dev overlay swaps queue trigger for event via null-removal", () => {
    write(base);
    const cfg = loadConfig(tmp, "dev");
    expect(cfg.functions!.worker.queue).toBeUndefined(); // removed by `queue: null`
    expect(cfg.functions!.worker.event?.pattern).toEqual({ source: ["orders"] });
    expect(cfg.functions!.worker.timeout).toBe(30); // inherited
  });

  it("the stages key never leaks into the validated config", () => {
    write(base);
    const cfg = loadConfig(tmp, "prod") as Record<string, unknown>;
    expect(cfg.stages).toBeUndefined();
  });
});

describe("api custom domain config", () => {
  let tmp: string;
  const write = (yml: string) => writeFileSync(path.join(tmp, "slsv.yml"), yml);
  beforeEach(() => {
    tmp = path.join(os.tmpdir(), `slsv-apidomain-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tmp, { recursive: true });
  });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it("accepts a bare domain (zone auto-derived, token from env)", () => {
    write(`app: shop\napi:\n  domain: api.myapp.com\n`);
    const cfg = loadConfig(tmp, "dev");
    expect(cfg.api!.domain).toBe("api.myapp.com");
  });
});

describe("api cors config", () => {
  let tmp: string;
  const write = (yml: string) => writeFileSync(path.join(tmp, "slsv.yml"), yml);
  beforeEach(() => {
    tmp = path.join(os.tmpdir(), `slsv-cors-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tmp, { recursive: true });
  });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it("accepts the legacy origins-array shape", () => {
    write(`app: shop\napi:\n  cors: ["https://myapp.com"]\n`);
    const cfg = loadConfig(tmp, "dev");
    expect(cfg.api!.cors).toEqual(["https://myapp.com"]);
  });

  it("accepts the object shape with credentials", () => {
    write(
      `app: shop\napi:\n  cors:\n    origins: ["https://myapp.com"]\n    credentials: true\n    methods: ["GET", "POST"]\n`,
    );
    const cfg = loadConfig(tmp, "dev");
    expect(cfg.api!.cors).toEqual({
      origins: ["https://myapp.com"],
      credentials: true,
      methods: ["GET", "POST"],
    });
  });

  it("accepts cors: false (gateway CORS disabled)", () => {
    write(`app: shop\napi:\n  cors: false\n`);
    const cfg = loadConfig(tmp, "dev");
    expect(cfg.api!.cors).toBe(false);
  });

  it("rejects unknown keys in the object shape", () => {
    write(`app: shop\napi:\n  cors:\n    origins: ["https://myapp.com"]\n    creds: true\n`);
    expect(() => loadConfig(tmp, "dev")).toThrow(ConfigError);
  });
});

describe("api auth (Lambda authorizer) config", () => {
  let tmp: string;
  const write = (yml: string) => writeFileSync(path.join(tmp, "slsv.yml"), yml);
  beforeEach(() => {
    tmp = path.join(os.tmpdir(), `slsv-apiauth-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tmp, { recursive: true });
  });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it("accepts api.auth + a per-route auth:false opt-out", () => {
    write(
      [
        "app: shop",
        "functions:",
        "  api:",
        "    runtime: nodejs22",
        "    handler: ./src/api.handler",
        "    http:",
        "      - { method: GET, path: /me }",
        "      - { method: GET, path: /health, auth: false }",
        "api:",
        "  auth:",
        "    function: authorizer",
        "    ttl: 60",
        "",
      ].join("\n"),
    );
    const cfg = loadConfig(tmp, "dev");
    expect(cfg.api!.auth).toEqual({ function: "authorizer", ttl: 60 });
    expect(cfg.functions!.api.http![1].auth).toBe(false);
  });

  it("rejects api.auth without a function", () => {
    write(`app: shop\napi:\n  auth:\n    ttl: 60\n`);
    expect(() => loadConfig(tmp, "dev")).toThrow(ConfigError);
  });
});

describe("bucket config", () => {
  let tmp: string;
  const write = (yml: string) => writeFileSync(path.join(tmp, "slsv.yml"), yml);
  beforeEach(() => {
    tmp = path.join(os.tmpdir(), `slsv-bucket-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tmp, { recursive: true });
  });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it("accepts an empty bucket body (legacy `name: {}` shape)", () => {
    write(`app: shop\nbuckets:\n  uploads: {}\n`);
    const cfg = loadConfig(tmp, "dev");
    expect(cfg.buckets!.uploads).toEqual({});
  });

  it("accepts a bare bucket key (YAML null treated as {})", () => {
    write(`app: shop\nbuckets:\n  uploads:\n`);
    const cfg = loadConfig(tmp, "dev");
    expect(cfg.buckets!.uploads).toEqual({});
  });

  it("stage overlay `buckets.<name>: null` still REMOVES the bucket (not silently coerced)", () => {
    write(`
app: shop
buckets:
  uploads: {}
  public:
    publicRead: true
stages:
  prod:
    buckets:
      uploads: null
`);
    const cfg = loadConfig(tmp, "prod");
    expect(cfg.buckets!.uploads).toBeUndefined();
    expect(cfg.buckets!.public).toEqual({ publicRead: true });
  });

  it("accepts publicRead + cors", () => {
    write(`
app: shop
buckets:
  public:
    publicRead: true
    cors: ['https://app.example.com']
`);
    const cfg = loadConfig(tmp, "dev");
    expect(cfg.buckets!.public).toEqual({
      publicRead: true,
      cors: ["https://app.example.com"],
    });
  });

  it("rejects unknown bucket properties", () => {
    write(`
app: shop
buckets:
  weird:
    publicRead: true
    versioning: true
`);
    expect(() => loadConfig(tmp, "dev")).toThrow(/Invalid slsv\.yml/);
    expect(() => loadConfig(tmp, "dev")).toThrow(/versioning|publicRead/);
  });
});

describe("loadConfig error UX", () => {
  let tmp: string;
  const write = (yml: string) => writeFileSync(path.join(tmp, "slsv.yml"), yml);

  beforeEach(() => {
    tmp = path.join(os.tmpdir(), `slsv-cfg-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tmp, { recursive: true });
  });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it("missing file throws ConfigError naming the cwd", () => {
    expect(() => loadConfig(tmp, "dev")).toThrow(ConfigError);
    expect(() => loadConfig(tmp, "dev")).toThrow(/No slsv.yml found/);
  });

  it("invalid YAML throws ConfigError", () => {
    write("app: shop\n  functions: [unclosed");
    expect(() => loadConfig(tmp, "dev")).toThrow(ConfigError);
    expect(() => loadConfig(tmp, "dev")).toThrow(/not valid YAML/);
  });

  it("schema violation throws ConfigError with path-prefixed lines, not a raw zod dump", () => {
    write(`
app: shop
functions:
  api:
    runtime: nodejs22
    handler: ./src/api.handler
    timeout: 9999
`);
    let err: unknown;
    try {
      loadConfig(tmp, "dev");
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ConfigError);
    const msg = (err as ConfigError).message;
    expect(msg).toMatch(/Invalid slsv\.yml/);
    expect(msg).toMatch(/functions\.api\.timeout/); // path-prefixed
    expect(msg).not.toMatch(/ZodError|\bat /); // no stack / zod class dump
  });
});
