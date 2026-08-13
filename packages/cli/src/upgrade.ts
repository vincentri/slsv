import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

// `slsv upgrade` — self-update the globally installed CLI.
//
// Resolves the latest published version straight from the npm registry (NOT the package
// manager's cached `latest` dist-tag — pnpm's metadata cache has served stale versions,
// e.g. `latest` pointing at 0.1.3 while 0.1.4 is out), then reinstalls through whichever
// package manager owns the running binary, pinned to the exact version. Linked/local
// installs (dev checkouts) can't be auto-updated — they get relink guidance instead.

export type InstallMethod = "npm" | "pnpm" | "yarn" | "link" | "local" | "unknown";

export interface InstallInfo {
  method: InstallMethod;
  /** Dev checkout a linked install points at (for relink guidance). */
  linkTarget?: string;
}

/** Numeric part-wise semver compare — "0.1.4" < "0.1.15". Plain x.y.z only. */
export function compareSemver(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

/** Reinstall command per package manager, pinned to the exact resolved version. */
export function installCommand(method: InstallMethod, version: string): string[] {
  switch (method) {
    case "npm":
      return ["npm", "i", "-g", `@slsv/cli@${version}`];
    case "pnpm":
      return ["pnpm", "add", "-g", `@slsv/cli@${version}`];
    case "yarn":
      return ["yarn", "global", "add", `@slsv/cli@${version}`];
    default:
      return [];
  }
}

/**
 * Figure out how the running CLI was installed from its module URL.
 * `realPath` is the realpath of the module file: a symlink inside a known global
 * location means `npm link`/`pnpm build:link` → a dev checkout, not a real install.
 */
export function detectInstall(moduleUrl: string, realPath?: string): InstallInfo {
  const p = fileURLToPath(moduleUrl);
  if (/[/\\]global[/\\]v\d+[/\\]/.test(p) && p.includes("node_modules/@slsv/cli/")) {
    return { method: "pnpm" };
  }
  if (/[/\\]yarn[/\\]global[/\\]/.test(p) && p.includes("node_modules/@slsv/cli/")) {
    return { method: "yarn" };
  }
  if (/[/\\]lib[/\\]node_modules[/\\]@slsv[/\\]cli[/\\]/.test(p)) {
    if (realPath && realPath !== p) return { method: "link", linkTarget: realPath };
    return { method: "npm" };
  }
  if (p.includes("node_modules/@slsv/cli/")) return { method: "local" };
  return { method: "unknown" };
}

function safeRealpath(p: string): string | undefined {
  try {
    return realpathSync(p);
  } catch {
    return undefined;
  }
}

async function fetchLatest(registry: string): Promise<string> {
  const res = await fetch(`${registry}/@slsv/cli/latest`);
  if (!res.ok) {
    throw new Error(`Could not reach the npm registry (${res.status} ${res.statusText})`);
  }
  const data = (await res.json()) as { version?: string };
  if (!data.version) throw new Error("Registry response did not include a version field");
  return data.version;
}

export async function runUpgrade(opts: {
  moduleUrl: string;
  currentVersion: string;
  force?: boolean;
  registry?: string;
}): Promise<void> {
  const { moduleUrl, currentVersion, force } = opts;
  const registry = (
    opts.registry ??
    process.env.npm_config_registry ??
    "https://registry.npmjs.org/"
  ).replace(/\/+$/, "");

  const install = detectInstall(moduleUrl, safeRealpath(fileURLToPath(moduleUrl)));

  let latest: string;
  try {
    latest = await fetchLatest(registry);
  } catch (e) {
    console.error(`✗ ${(e as Error).message}`);
    process.exit(1);
  }

  if (!force && compareSemver(currentVersion, latest) >= 0) {
    console.log(`slsv is already up to date (v${currentVersion}).`);
    console.log("Pass --force to reinstall anyway.");
    return;
  }

  const cmd = installCommand(install.method, latest);
  if (cmd.length === 0) {
    console.error("✗ Can't auto-update this install.");
    if (install.method === "link") {
      console.error(`  slsv is linked from a dev checkout (${install.linkTarget}).`);
      console.error("  Rebuild + relink it there instead of upgrading.");
    } else if (install.method === "local") {
      console.error("  slsv is a local dependency of this project, not a global install.");
      console.error(`  Install it globally with: npm i -g @slsv/cli@${latest}`);
    } else {
      console.error(`  Install the latest manually with: npm i -g @slsv/cli@${latest}`);
    }
    process.exit(1);
  }

  console.log(`Upgrading slsv v${currentVersion} → v${latest} (${install.method})...`);
  const res = spawnSync(cmd[0], cmd.slice(1), { stdio: "inherit" });
  if (res.status !== 0) {
    console.error(
      `\n✗ Upgrade failed (${cmd[0]} exited with ${res.status ?? res.error?.message}).`,
    );
    process.exit(1);
  }
  console.log(`\n✓ slsv upgraded to v${latest} — run 'slsv --version' to confirm.`);
}
