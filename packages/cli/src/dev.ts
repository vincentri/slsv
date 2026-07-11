import chokidar from "chokidar";
import path from "path";
import { spawn, spawnSync } from "child_process";
import { existsSync, writeFileSync } from "fs";
import type { AppConfig } from "./config.js";
import type { AwsProvider } from "./providers/aws/index.js";
import { bundleHandler } from "./bundle.js";
import { lintApp } from "./lint.js";

// Get the frontend deps ready before starting its dev server (pnpm-only). pnpm gates native
// build scripts (vite's esbuild) and exits non-zero — and pnpm 11 ignores the
// onlyBuiltDependencies allowlist — so we drop a pnpm-workspace.yaml with
// `dangerouslyAllowAllBuilds` (the only setting pnpm 11 honors from a file), then install if
// node_modules is missing. Writing the file also fixes apps scaffolded before it shipped.
function ensureFrontendDeps(dir: string) {
  const ws = path.join(dir, "pnpm-workspace.yaml");
  if (!existsSync(ws)) writeFileSync(ws, "dangerouslyAllowAllBuilds: true\n");
  if (!existsSync(path.join(dir, "node_modules"))) {
    console.log("  installing frontend deps...");
    spawnSync("pnpm", ["install"], { cwd: dir, stdio: "inherit", shell: true });
  }
}

export async function startDev(
  cfg: AppConfig,
  provider: AwsProvider,
  cwd: string,
  stage = "dev",
  apiUrl?: string,
) {
  if (cfg.frontend) {
    // Frontend dev server via the frontend's own package manager (detected from its lockfile).
    const frontendSrcDir = path.resolve(cwd, cfg.frontend.src);
    const frontendDir = existsSync(path.join(frontendSrcDir, "package.json"))
      ? frontendSrcDir
      : path.dirname(frontendSrcDir);
    if (existsSync(frontendDir)) {
      const env = { ...process.env, ...(apiUrl ? { SLSV_API_URL: apiUrl } : {}) };
      ensureFrontendDeps(frontendDir);
      const vite = spawn("pnpm", ["run", "dev"], {
        cwd: frontendDir,
        env,
        stdio: "inherit",
        shell: true,
      });
      vite.on("error", (e) => console.error("[frontend]", e.message));
      process.on("exit", () => vite.kill());
    }
  }

  if (!cfg.functions || Object.keys(cfg.functions).length === 0) return;

  for (const name of Object.keys(cfg.functions)) {
    provider.tailLogs(`${cfg.app}-${stage}-${name}`, true).catch(() => {});
  }

  // Watch the whole project — handler paths live wherever slsv.yml points (backend/, src/, …),
  // not a fixed dir. Ignore deps, build output, VCS, and the frontend (vite owns its own reload).
  const feDir = cfg.frontend ? path.dirname(path.resolve(cwd, cfg.frontend.src)) : null;
  const ignored = (p: string) =>
    p.includes(`${path.sep}node_modules${path.sep}`) ||
    p.includes(`${path.sep}dist${path.sep}`) ||
    p.includes(`${path.sep}.git${path.sep}`) ||
    (feDir !== null && (p === feDir || p.startsWith(feDir + path.sep)));

  console.log(`\nWatching ${cwd}...`);

  const reload = async () => {
    console.log("\nChange detected — rebundling...");
    // Same preflight deploy runs — a lint failure (bad handler/export, undeclared SDK name)
    // must fail the reload loudly, not silently leave the old code running.
    try {
      lintApp(cfg, cwd);
    } catch (e) {
      console.error(`  ✗ ${(e as Error).message}`);
      console.error("  ⚠ NOT deployed — API still running the previous version. Fix the above to reload.");
      return;
    }
    for (const [name, fn] of Object.entries(cfg.functions!)) {
      const fnName = `${cfg.app}-${stage}-${name}`;
      try {
        const { zip } = await bundleHandler(fn.handler, cwd, !!fn.http);
        await provider.updateFunctionCode(fnName, zip);
        console.log(`  ✓ ${fnName}`);
      } catch (e) {
        console.error(`  ✗ ${fnName}:`, (e as Error).message);
      }
    }
  };

  // Rebundle on edits AND on new/removed files — splitting the router into more files (a fresh
  // `add`) should reload too, not just `change`. New `functions:` entries still need a restart
  // (cfg is a startup snapshot; provisioning a new Lambda isn't a live-reload concern).
  const watcher = chokidar
    .watch(cwd, { ignoreInitial: true, ignored })
    .on("change", reload)
    .on("add", reload)
    .on("unlink", reload);

  await new Promise<void>((resolve) => {
    const shutdown = () => {
      void watcher.close().finally(() => {
        resolve();
        process.exit(0);
      });
    };
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
  });
}
