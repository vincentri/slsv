import { describe, expect, it } from "vitest";
import { compareSemver, detectInstall, installCommand } from "./upgrade.js";

describe("compareSemver", () => {
  it("returns 0 for equal versions", () => {
    expect(compareSemver("0.1.4", "0.1.4")).toBe(0);
    expect(compareSemver("0.1.4", "0.1.4.0")).toBe(0);
  });

  it("compares patch, minor, and major numerically", () => {
    expect(compareSemver("0.1.4", "0.1.15")).toBe(-1); // numeric, not lexicographic
    expect(compareSemver("0.1.15", "0.1.4")).toBe(1);
    expect(compareSemver("0.2.0", "0.1.9")).toBe(1);
    expect(compareSemver("1.0.0", "0.9.9")).toBe(1);
    expect(compareSemver("0.1.0", "0.0.9")).toBe(1);
  });
});

describe("installCommand", () => {
  it("pins the exact version for npm/pnpm/yarn", () => {
    expect(installCommand("npm", "0.2.0")).toEqual(["npm", "i", "-g", "@slsv/cli@0.2.0"]);
    expect(installCommand("pnpm", "0.2.0")).toEqual(["pnpm", "add", "-g", "@slsv/cli@0.2.0"]);
    expect(installCommand("yarn", "0.2.0")).toEqual(["yarn", "global", "add", "@slsv/cli@0.2.0"]);
  });

  it("returns no command for non-global installs", () => {
    expect(installCommand("link", "0.2.0")).toEqual([]);
    expect(installCommand("local", "0.2.0")).toEqual([]);
    expect(installCommand("unknown", "0.2.0")).toEqual([]);
  });
});

describe("detectInstall", () => {
  const npmGlobal =
    "file:///Users/x/.nvm/versions/node/v24.18.0/lib/node_modules/@slsv/cli/dist/cli.js";
  const pnpmGlobal =
    "file:///Users/x/Library/pnpm/global/v11/1237c-19f8f7ab2eb-cf61623af08a5f3f/node_modules/@slsv/cli/dist/cli.js";
  const yarnGlobal =
    "file:///Users/x/.config/yarn/global/node_modules/@slsv/cli/dist/cli.js";
  const npmLinked =
    "file:///Users/x/.nvm/versions/node/v26.4.0/lib/node_modules/@slsv/cli/dist/cli.js";
  const local = "file:///Users/x/app/node_modules/@slsv/cli/dist/cli.js";
  const devCheckout = "file:///Users/x/repo/packages/cli/dist/cli.js";

  it("detects a real npm global install (not a symlink)", () => {
    expect(detectInstall(npmGlobal, "/Users/x/.nvm/versions/node/v24.18.0/lib/node_modules/@slsv/cli/dist/cli.js")).toEqual({ method: "npm" });
  });

  it("detects a pnpm global install", () => {
    expect(detectInstall(pnpmGlobal, pnpmGlobal)).toEqual({ method: "pnpm" });
  });

  it("detects a yarn global install", () => {
    expect(detectInstall(yarnGlobal, yarnGlobal)).toEqual({ method: "yarn" });
  });

  it("detects an npm link into a dev checkout", () => {
    const repoCli = "/Users/x/repo/packages/cli/dist/cli.js";
    expect(detectInstall(npmLinked, repoCli)).toEqual({ method: "link", linkTarget: repoCli });
  });

  it("detects a project-local dependency", () => {
    expect(detectInstall(local, local)).toEqual({ method: "local" });
  });

  it("falls back to unknown for unrecognized locations", () => {
    expect(detectInstall(devCheckout, devCheckout)).toEqual({ method: "unknown" });
  });
});
