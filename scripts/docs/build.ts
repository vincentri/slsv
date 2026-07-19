import { spawnSync } from "child_process";

// ponytail: chain the three generators, then shell out to mkdocs --strict. Strict mode fails
// the build on broken refs / missing nav entries — that's our drift detector.
const steps: Array<[string, string, string[]]> = [
  ["zod schema  → slsv-yml.md", "tsx", ["scripts/docs/schema.ts"]],
  ["commander   → cli/*.md", "tsx", ["scripts/docs/cli.ts"]],
  ["typedoc     → sdk/*.md", "tsx", ["scripts/docs/sdk.ts"]],
  ["mkdocs build (strict)", "mkdocs", ["build", "--strict"]],
];

for (const [label, cmd, args] of steps) {
  console.log(`\n→ ${label}`);
  const r = spawnSync(cmd, args, { stdio: "inherit" });
  if (r.status !== 0) {
    console.error(`\n✗ ${label} failed`);
    process.exit(r.status ?? 1);
  }
}

console.log("\n✓ docs built → ./site/");
console.log("  preview locally: mkdocs serve");
console.log("  deploy: gh-deploy runs in CI on push to main");