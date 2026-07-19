import { spawnSync } from "child_process";
import { rmSync, mkdirSync, existsSync } from "fs";

const OUT = "docs/reference/sdk";

// ponytail: typedoc-plugin-markdown emits a tree of .md files matching the TS module structure.
// typedoc.json (repo root) holds the config so `pnpm exec typedoc` runs with no flags.
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

if (!existsSync("typedoc.json")) {
  console.error("✗ typedoc.json missing at repo root");
  process.exit(1);
}

const r = spawnSync("pnpm", ["exec", "typedoc"], { stdio: "inherit" });
if (r.status !== 0) process.exit(r.status ?? 1);
console.log(`✓ ${OUT}/`);