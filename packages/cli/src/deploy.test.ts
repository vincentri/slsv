import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { loadEnv } from "./deploy.js";

const tmp = () => mkdtempSync(path.join(tmpdir(), "slsv-env-"));

describe("loadEnv precedence", () => {
  beforeEach(() => {
    delete process.env.FOO;
    delete process.env.BAR;
  });

  it("local > stage > base (target=local, first load wins)", () => {
    const d = tmp();
    writeFileSync(path.join(d, ".env"), "FOO=base\nBAR=base");
    writeFileSync(path.join(d, ".env.dev"), "FOO=stage");
    writeFileSync(path.join(d, ".env.local"), "FOO=local");
    loadEnv(d, "dev", "local");
    expect(process.env.FOO).toBe("local");
    expect(process.env.BAR).toBe("base");
  });

  it("skips .env.local when target=aws", () => {
    const d = tmp();
    writeFileSync(path.join(d, ".env"), "FOO=base");
    writeFileSync(path.join(d, ".env.local"), "FOO=local");
    loadEnv(d, "dev", "aws");
    expect(process.env.FOO).toBe("base");
  });

  it("override=true picks up an edited value while keeping precedence", () => {
    const d = tmp();
    writeFileSync(path.join(d, ".env"), "FOO=base");
    writeFileSync(path.join(d, ".env.local"), "FOO=old");
    loadEnv(d, "dev", "local");
    expect(process.env.FOO).toBe("old");

    // simulate editing .env.local, then a dev hot-reload
    writeFileSync(path.join(d, ".env.local"), "FOO=new");
    loadEnv(d, "dev", "local", true);
    expect(process.env.FOO).toBe("new"); // .env.local still wins, now with the fresh value
  });
});
