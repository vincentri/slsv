import { build } from "esbuild";
import AdmZip from "adm-zip";
import path from "path";

// ponytail: fallback so esbuild finds @slsv/sdk from CLI's own node_modules
// when the user's project hasn't installed it (before npm publish)
const CLI_NODE_MODULES = [path.resolve(import.meta.dirname, "..", "node_modules")];

export async function bundleHandler(
  handlerPath: string,
  cwd: string,
): Promise<{ zip: Uint8Array; handlerRef: string }> {
  // handlerPath: ./src/api.handler → file=./src/api, export=handler
  const lastDot = handlerPath.lastIndexOf(".");
  const filePart = handlerPath.slice(0, lastDot);
  const exportName = handlerPath.slice(lastDot + 1);

  const entryPoint = path.resolve(cwd, filePart + ".ts");

  const result = await build({
    entryPoints: [entryPoint],
    bundle: true,
    platform: "node",
    target: "node20",
    format: "cjs",
    write: false,
    // ponytail: bundle everything (incl @aws-sdk). Floci/Lambda base image
    // doesn't ship lib-dynamodb, so don't externalize. Bigger zip, always works.
    // minify halves the bundle (~4.8M → 2.4M) — aws-sdk+drizzle dominate, so the win
    // is real; node20 runs minified JS unchanged and stack traces stay usable via names.
    minify: true,
    keepNames: true,
    sourcemap: false,
    nodePaths: CLI_NODE_MODULES,
  });

  const zip = new AdmZip();
  zip.addFile("handler.js", Buffer.from(result.outputFiles![0].contents));
  return { zip: zip.toBuffer(), handlerRef: `handler.${exportName}` };
}
