import { defineConfig } from "tsup";
import { readFileSync } from "node:fs";

// Inline the SDK version at build time so scaffolds pin the SDK version this CLI was built
// against — changesets bumps packages/sdk/package.json and it propagates automatically,
// no hardcoded string to keep in sync.
const sdkVersion = JSON.parse(readFileSync("../sdk/package.json", "utf8")).version;

export default defineConfig({
  entry: ["src/cli.ts"],
  format: ["esm"],
  target: "node20",
  banner: { js: "#!/usr/bin/env node" },
  define: { __SDK_VERSION__: JSON.stringify(sdkVersion) },
  clean: true,
});
